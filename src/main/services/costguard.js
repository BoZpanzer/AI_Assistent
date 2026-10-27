'use strict';
const log = require('../core/logger').scope('costguard');

/**
 * Lokale Kostenkontrolle für die Gemini-API (Schätzung, keine Anbieter-Abrechnung).
 *
 * Jeder kostenpflichtige Aufruf läuft über Gemini.cloud(): vorher wird eine Schätzung als
 * Reservierung in die Tabelle ai_ledger geschrieben, danach durch den gemeldeten Verbrauch ersetzt.
 * Dadurch zählen laufende und parallele Aufrufe sofort mit, und ein Absturz/Neustart setzt das
 * Tagesbudget nicht zurück: nicht abgeschlossene Reservierungen werden beim Start als „unbestätigt“
 * mit ihrer Schätzung weitergezählt.
 *
 * Grenzen (alle in €, umgerechnet mit dem eingestellten Kurs):
 *   - Tag (lokaler Kalendertag des PCs, Wechsel um 00:00)
 *   - Sitzung (seit dem Start von JARVIS)
 *   - Monat (lokaler Kalendermonat, optional mit echtem Stand aus AI Studio „geeicht“)
 * Bei Erreichen einer Grenze sperrt JARVIS weitere Cloud-Aufrufe lokal. Das ist KEINE garantierte
 * Abrechnungsobergrenze: Google rechnet nach eigener Zählung und Zeitzone ab, Preise können sich
 * ändern, und ein bereits laufender Aufruf kann die Grenze noch überschreiten.
 */

// Offizielle Listenpreise (bezahlter Tarif, Standard) in USD pro 1 Mio. Token.
// Quelle: https://ai.google.dev/gemini-api/docs/pricing, abgerufen am 19.10.2026.
// `from` = ab diesem Datum gültig (angekündigte Preisänderungen). Unbekannte Modelle → teuerster Eintrag.
const PRICES_AS_OF = '2026-10-20';
const PRICES = [
  { re: /embedding/, in: 0.15, cached: 0.15, out: 0 },
  // Sprachausgabe (TTS): Text rein, Audio raus; ab 01.01.2027 doppelt
  // Ältere 2.5-Generation (weiterhin verfügbar, deutlich günstiger)
  { re: /2\.5-flash-lite/, in: 0.10, inAudio: 0.30, cached: 0.01, out: 0.40 },
  { re: /2\.5-flash(?!-lite)/, in: 0.30, inAudio: 1.0, cached: 0.03, out: 2.5 },
  { re: /2\.5-pro/, in: 1.25, cached: 0.125, out: 10.0 },
  { re: /3\.5-flash-lite/, in: 0.30, cached: 0.03, out: 2.5 },
  { re: /3\.1-flash-lite/, in: 0.25, inAudio: 0.5, cached: 0.025, out: 1.5 },
  { re: /lite/, in: 0.30, cached: 0.03, out: 2.5 },
  { re: /gemini-4-argon/, steps: [{ from: '0000', in: 2.0, cached: 0.1, out: 10.0 }, { from: '2026-12-01', in: 4.0, cached: 0.2, out: 20.0 }] },
  { re: /pro/, in: 2.0, cached: 0.2, out: 12.0 },
  { re: /3-flash-preview/, in: 0.50, inAudio: 1.0, cached: 0.05, out: 3.0 },
  { re: /3\.[6-9]-flash|flash-latest/, steps: [{ from: '0000', in: 0.75, cached: 0.075, out: 3.75 }, { from: '2027-01-01', in: 1.5, cached: 0.15, out: 7.5 }] },
  { re: /flash/, in: 0.75, cached: 0.075, out: 3.75 },
];
const FALLBACK_PRICE = { in: 2.0, cached: 0.2, out: 12.0 }; // vorsichtig: unbekannt = so teuer wie Pro
const GROUNDING_USD = 0.014; // Google-Suche: 5 000/Monat frei, danach 14 $ / 1 000

function priceFor(model, at = new Date()) {
  const p = PRICES.find((x) => x.re.test(String(model || '')));
  if (!p) return FALLBACK_PRICE;
  if (!p.steps) return p;
  const day = (at instanceof Date ? at : new Date(at)).toISOString().slice(0, 10);
  return [...p.steps].reverse().find((s) => day >= s.from) || p.steps[0];
}

/** Kosten (USD) für einen Verbrauchseintrag { in, cached, out, think, inAudio, outAudio }. */
function costUsd(model, x, at = new Date()) {
  const p = priceFor(model, at);
  const inAudio = Math.min(x.inAudio || 0, x.in || 0);
  const cached = Math.min(x.cached || 0, Math.max(0, (x.in || 0) - inAudio));
  const inText = Math.max(0, (x.in || 0) - inAudio - cached);
  const outAudio = Math.min(x.outAudio || 0, x.out || 0);
  const outText = Math.max(0, (x.out || 0) - outAudio) + (x.think || 0);
  return (inText * p.in + cached * p.cached + inAudio * (p.inAudio ?? p.in) + outText * p.out + outAudio * (p.outAudio ?? p.out)) / 1e6;
}

/** Gemini usageMetadata → { in, cached, out, think, inAudio, outAudio }. */
function normalizeUsage(u) {
  if (!u) return null;
  const mod = (list, m) => (Array.isArray(list) ? list.filter((d) => String(d.modality).toUpperCase() === m).reduce((a, d) => a + (d.tokenCount || 0), 0) : 0);
  return {
    in: (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0),
    cached: u.cachedContentTokenCount || 0,
    out: u.candidatesTokenCount || u.responseTokenCount || 0,
    think: u.thoughtsTokenCount || 0,
    inAudio: mod(u.promptTokensDetails, 'AUDIO'),
    outAudio: mod(u.candidatesTokensDetails || u.responseTokensDetails, 'AUDIO'),
  };
}

/** Lokales Datum JJJJ-MM-TT (Zeitzone des PCs). */
const localDay = (d = new Date()) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

class BudgetError extends Error {
  constructor(message, scope) { super(message); this.code = 'BUDGET'; this.scope = scope; }
}

/** Sparsamer Standardmodus (dokumentiert in docs/KOSTEN_UND_DATENSCHUTZ.md). */
const DEFAULT_BUDGET = { monthlyEur: 5, dailyEur: 0.25, sessionEur: 0.15, warnPct: 80, hardStop: true, usdToEur: 0.86, brake: true };

class CostGuard {
  constructor(s, { now = () => new Date() } = {}) {
    this.s = s; this.now = now; this.lastLevel = null; this.sessionStart = now().toISOString(); this.warned = new Set();
    // Reservierungen eines abgebrochenen Laufs zählen weiter (mit ihrer Schätzung).
    try {
      const n = this.s.db.run("UPDATE ai_ledger SET status='unsettled' WHERE status='reserved'");
      if (n?.changes) log.warn(`${n.changes} nicht abgeschlossene Cloud-Aufrufe aus dem letzten Lauf werden mit ihrer Schätzung gezählt`);
    } catch (e) { log.debug('ledger', e); }
  }
  cfg() { return { ...DEFAULT_BUDGET, ...(this.s.settings.get('aiBudget') || {}) }; }
  meta(k) { try { return JSON.parse(this.s.db.get('SELECT value FROM meta WHERE key=?', 'costguard:' + k)?.value || 'null'); } catch { return null; } }
  setMeta(k, v) { this.s.db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'costguard:' + k, JSON.stringify(v)); }
  eur(usd) { return usd * this.cfg().usdToEur; }

  /** Summe (USD) im Ledger; offene/unbestätigte Einträge zählen mit max(Schätzung, gemeldet). */
  ledgerUsd(where, ...args) {
    const r = this.s.db.get(`SELECT COALESCE(SUM(CASE WHEN status IN ('reserved','unsettled') THEN MAX(est_usd, usd) ELSE usd END), 0) AS usd FROM ai_ledger WHERE ${where}`, ...args);
    return r?.usd || 0;
  }

  /** Alte Verbrauchsdaten (vor Einführung des Ledgers) für Tage ohne Ledger-Einträge. */
  legacyDayUsd(day) {
    if (this.s.db.get('SELECT 1 AS x FROM ai_ledger WHERE day=? LIMIT 1', day)) return 0;
    let cur = {};
    try { cur = JSON.parse(this.s.db.get('SELECT value FROM meta WHERE key=?', 'gemini:usage:' + day)?.value || '{}'); } catch { cur = {}; }
    return Object.entries(cur.models || {}).reduce((a, [model, x]) => a + costUsd(model, x, day), 0);
  }

  dayEur(day = localDay(this.now())) { return this.eur(this.ledgerUsd('day=?', day) + this.legacyDayUsd(day)); }
  sessionEur() { return this.eur(this.ledgerUsd('at>=?', this.sessionStart)); }

  /** Echten Stand aus AI Studio übernehmen (gilt für den laufenden Monat). */
  calibrate(eur) {
    const v = Number(String(eur).replace(',', '.'));
    if (!Number.isFinite(v) || v < 0 || v > 10000) throw new Error('Bitte einen Betrag in € eingeben, z. B. 0,69');
    const now = this.now();
    this.setMeta('anchor', { eur: v, at: now.toISOString(), month: localDay(now).slice(0, 7) });
    this.lastLevel = null;
    return this.status();
  }

  monthEur(now = this.now()) {
    const month = localDay(now).slice(0, 7);
    const a = this.meta('anchor');
    if (a && a.month === month) {
      return { eur: a.eur + this.eur(this.ledgerUsd('at>=?', a.at)), calibrated: true, calibratedAt: a.at };
    }
    let legacy = 0;
    for (let d = new Date(now.getFullYear(), now.getMonth(), 1); localDay(d) <= localDay(now); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) legacy += this.legacyDayUsd(localDay(d));
    return { eur: this.eur(this.ledgerUsd("substr(day,1,7)=?", month) + legacy), calibrated: false, calibratedAt: null };
  }

  /**
   * Vor einem Aufruf: Schätzung reservieren. Wirft BudgetError, wenn dadurch eine Grenze überschritten würde.
   * Gibt die Ledger-ID zurück.
   */
  reserve({ feature, model, estUsd = 0, now = this.now() }) {
    const c = this.cfg();
    const add = this.eur(estUsd);
    if (c.hardStop !== false) {
      const day = this.dayEur(localDay(now));
      if (c.dailyEur > 0 && day + add > c.dailyEur) throw new BudgetError(`Tagesbudget für Cloud-KI erreicht (geschätzt ${fmt(day)} von ${fmt(c.dailyEur)}). Weitere Gemini-Aufrufe sind bis Mitternacht gesperrt; lokale Funktionen laufen weiter. Grenze: Einstellungen → Gemini / KI.`, 'day');
      const ses = this.sessionEur();
      if (c.sessionEur > 0 && ses + add > c.sessionEur) throw new BudgetError(`Sitzungsbudget für Cloud-KI erreicht (geschätzt ${fmt(ses)} von ${fmt(c.sessionEur)} seit dem Start von JARVIS). Weitere Gemini-Aufrufe sind gesperrt, bis du das Budget erhöhst oder JARVIS neu startest.`, 'session');
      const mon = this.monthEur(now).eur;
      if (c.monthlyEur > 0 && mon + add > c.monthlyEur) throw new BudgetError(`Monatsbudget für Cloud-KI erreicht (geschätzt ${fmt(mon)} von ${fmt(c.monthlyEur)}). Weitere Gemini-Aufrufe sind gesperrt.`, 'month');
    }
    const id = require('node:crypto').randomUUID();
    this.s.db.run('INSERT INTO ai_ledger(id,at,day,feature,model,status,est_usd,usd) VALUES(?,?,?,?,?,?,?,0)', id, now.toISOString(), localDay(now), String(feature || 'other').slice(0, 40), String(model || '').slice(0, 80), 'reserved', estUsd);
    this.s.bus?.emit('cloud:usage', {});
    return id;
  }

  /** Nach dem Aufruf: gemeldeten Verbrauch eintragen (ohne Verbrauchsdaten bleibt die Schätzung stehen). */
  settle(id, { usage = null, model = null, status = 'done', extraUsd = 0 } = {}) {
    const row = this.s.db.get('SELECT model, est_usd, at FROM ai_ledger WHERE id=?', id);
    if (!row) return;
    const m = model || row.model;
    const u = usage || {};
    const usd = usage ? costUsd(m, u, row.at) + extraUsd : status === 'failed' ? 0 : row.est_usd;
    this.s.db.run('UPDATE ai_ledger SET status=?, model=?, usd=?, in_tok=?, cached_tok=?, out_tok=?, think_tok=? WHERE id=?',
      status === 'failed' ? 'failed' : 'done', m, usd, u.in || 0, u.cached || 0, u.out || 0, u.think || 0, id);
    this.s.bus?.emit('cloud:usage', {});
    this.warnIfNeeded();
  }

  /** Welche Grenze ist (ohne neue Reservierung) bereits erreicht? */
  exceeded() {
    const c = this.cfg();
    if (c.hardStop === false) return null;
    if (c.dailyEur > 0 && this.dayEur() >= c.dailyEur) return 'day';
    if (c.sessionEur > 0 && this.sessionEur() >= c.sessionEur) return 'session';
    if (c.monthlyEur > 0 && this.monthEur().eur >= c.monthlyEur) return 'month';
    return null;
  }

  groundingUsd(now = this.now()) {
    const month = localDay(now).slice(0, 7);
    const n = this.s.db.get("SELECT COUNT(*) AS n FROM ai_ledger WHERE feature='research' AND substr(day,1,7)=?", month)?.n || 0;
    return n >= 5000 ? GROUNDING_USD : 0;
  }

  status(now = this.now()) {
    const c = this.cfg();
    const { eur, calibrated, calibratedAt } = this.monthEur(now);
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const elapsed = Math.max(1 / 24, (now - start) / 86400000);
    const days = (end - start) / 86400000;
    const projected = elapsed >= 2 ? (eur / elapsed) * days : null;
    const pct = c.monthlyEur > 0 ? (eur / c.monthlyEur) * 100 : 0;
    const today = this.dayEur(localDay(now));
    const session = this.sessionEur();
    const dayPct = c.dailyEur > 0 ? (today / c.dailyEur) * 100 : 0;
    const blocked = this.exceeded();
    const level = blocked ? 'blocked' : c.monthlyEur <= 0 ? 'ok' : pct >= 95 ? 'brake' : (pct >= c.warnPct || dayPct >= c.warnPct || (projected != null && projected > c.monthlyEur * 1.05)) ? 'warn' : 'ok';
    const inflight = this.s.db.get("SELECT COUNT(*) AS n FROM ai_ledger WHERE status='reserved'")?.n || 0;
    return {
      eur: +eur.toFixed(2), budget: c.monthlyEur, pct: Math.round(pct), projected: projected == null ? null : +projected.toFixed(2),
      today: +today.toFixed(3), dailyBudget: c.dailyEur, session: +session.toFixed(3), sessionBudget: c.sessionEur,
      level, blocked, braking: (level === 'brake' || level === 'blocked') && c.brake !== false, calibrated, calibratedAt, inflight,
      estimate: true, pricesAsOf: PRICES_AS_OF, usdToEur: c.usdToEur,
    };
  }

  braking() { try { return this.status().braking; } catch { return false; } }

  /** Verbrauch pro Funktion/Modell (für die Anzeige „Was kostet am meisten?“). */
  report(days = 7, now = this.now()) {
    const from = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1));
    const rows = this.s.db.all("SELECT feature, model, COUNT(*) AS n, SUM(CASE WHEN status IN ('reserved','unsettled') THEN MAX(est_usd, usd) ELSE usd END) AS usd, SUM(in_tok) AS tin, SUM(out_tok + think_tok) AS tout, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM ai_ledger WHERE day>=? GROUP BY feature, model ORDER BY usd DESC", from);
    return rows.map((r) => ({ feature: r.feature, model: r.model, requests: r.n, failed: r.failed, inputTokens: r.tin, outputTokens: r.tout, eur: +this.eur(r.usd || 0).toFixed(4) }));
  }

  warnIfNeeded() {
    const c = this.cfg();
    const day = localDay(this.now());
    const today = this.dayEur(day);
    if (c.dailyEur > 0 && today >= c.dailyEur * (c.warnPct / 100)) {
      const key = 'day:' + day + ':' + (today >= c.dailyEur ? 'stop' : 'warn');
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.s.notifications?.push({ category: 'system', origin: 'system', dedupeKey: 'budget:' + key, title: today >= c.dailyEur ? 'Cloud-KI für heute gesperrt' : 'Cloud-KI: Tagesbudget fast erreicht', body: `Geschätzt ${fmt(today)} von ${fmt(c.dailyEur)} heute. Lokale Funktionen laufen weiter.` });
      }
    }
  }

  /** Regelmäßig prüfen und bei Stufenwechsel melden (einmal pro Monat und Stufe). */
  check() {
    const st = this.status();
    const month = localDay(this.now()).slice(0, 7);
    if (st.level !== 'ok' && st.level !== this.lastLevel) {
      const body = st.level === 'blocked'
        ? `Cloud-KI gesperrt (${{ day: 'Tagesbudget', session: 'Sitzungsbudget', month: 'Monatsbudget' }[st.blocked]} erreicht). Geschätzt ${fmt(st.eur)} von ${fmt(st.budget)} im Monat. Lokale Funktionen laufen weiter.`
        : st.level === 'brake'
          ? `Geschätzt ${fmt(st.eur)} von ${fmt(st.budget)} verbraucht. Sparstufe aktiv: kein Pro-Modell, kurze Denktiefe, Hintergrund-KI pausiert.`
          : `Geschätzt ${fmt(st.eur)} von ${fmt(st.budget)} verbraucht${st.projected != null ? ` – bei diesem Tempo etwa ${fmt(st.projected)} am Monatsende` : ''}. Einstellungen → Gemini / KI zeigt, was am meisten kostet.`;
      this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: `budget:${month}:${st.level}:${st.blocked || ''}`, title: st.level === 'blocked' ? 'Cloud-KI gesperrt' : st.level === 'brake' ? 'Gemini-Budget fast aufgebraucht' : 'Gemini-Budget: Achtung', body });
      log.info(`Budget-Stufe ${st.level}: ${st.eur} € / ${st.budget} €`);
    }
    this.lastLevel = st.level;
    return st;
  }
}

function fmt(v) { return (Number(v) || 0).toFixed(2).replace('.', ',') + ' €'; }

module.exports = { CostGuard, BudgetError, costUsd, priceFor, normalizeUsage, localDay, PRICES_AS_OF, DEFAULT_BUDGET, GROUNDING_USD };
