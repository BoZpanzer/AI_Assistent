'use strict';
const log = require('../core/logger').scope('costguard');

/**
 * Kostenbremse für die Gemini-API.
 *
 * JARVIS zählt Token pro Tag und Modell (Gemini-Provider). Daraus schätzt es die Kosten mit
 * ungefähren Listenpreisen pro Modellfamilie. Weil Googles echte Preise und der Wechselkurs abweichen
 * können, lässt sich die Schätzung mit dem echten Stand aus Google AI Studio „eichen“: Ab dann gilt
 * echter Stand + geschätzter Verbrauch seitdem.
 *
 * Stufen: ok → warn (≥ Warnschwelle oder Hochrechnung über Budget) → brake (≥ 95 %):
 *   - Analysen laufen über das schnelle Modell statt Pro, immer kurze Denktiefe
 *   - Hintergrund-KI pausiert (LoL-KI-Zusammenfassungen/Matchup-Tipps, automatische Seitenanalyse)
 *   Chat und Sprache bleiben nutzbar. Bei 100 % stoppt Google selbst (Ausgabenobergrenze).
 */
// USD pro 1 Mio. Token (Eingabe, Eingabe aus Cache, Ausgabe inkl. Denken) – Näherung, Stand 2026
const PRICES = [
  { re: /embedding/, in: 0.15, cached: 0.15, out: 0 },
  { re: /live|native-audio/, in: 3.0, cached: 0.3, out: 12.0 },
  { re: /lite/, in: 0.1, cached: 0.01, out: 0.4 },
  { re: /pro/, in: 2.0, cached: 0.2, out: 12.0 },
  { re: /flash/, in: 0.5, cached: 0.05, out: 3.0 },
];
const DEFAULT_PRICE = { in: 0.5, cached: 0.05, out: 3.0 };
const priceFor = (model) => PRICES.find((p) => p.re.test(String(model))) || DEFAULT_PRICE;

/** Kosten (USD) für einen Verbrauchseintrag {in, cached, out, think}. */
function costUsd(model, x) {
  const p = priceFor(model);
  const cached = Math.min(x.cached || 0, x.in || 0);
  return (((x.in || 0) - cached) * p.in + cached * p.cached + ((x.out || 0) + (x.think || 0)) * p.out) / 1e6;
}

class CostGuard {
  constructor(s) { this.s = s; this.lastLevel = null; }
  cfg() { return { monthlyEur: 5, warnPct: 80, brake: true, usdToEur: 0.86, ...(this.s.settings.get('aiBudget') || {}) }; }
  meta(k) { try { return JSON.parse(this.s.system.meta('costguard:' + k) || 'null'); } catch { return null; } }
  setMeta(k, v) { this.s.system.setMeta('costguard:' + k, JSON.stringify(v)); }

  dayUsage(day) { try { return JSON.parse(this.s.system.meta('gemini:usage:' + day) || '{}'); } catch { return {}; } }
  /** Geschätzte Kosten eines Tages in € (nach Modell). */
  dayEur(day) {
    const m = this.dayUsage(day).models || {};
    return Object.entries(m).reduce((a, [model, x]) => a + costUsd(model, x), 0) * this.cfg().usdToEur;
  }

  /** Echten Stand aus AI Studio übernehmen (gilt für den laufenden Monat). */
  calibrate(eur) {
    const v = Number(String(eur).replace(',', '.'));
    if (!Number.isFinite(v) || v < 0 || v > 10000) throw new Error('Bitte einen Betrag in € eingeben, z. B. 0,69');
    const now = new Date();
    this.setMeta('anchor', { eur: v, at: now.toISOString(), month: now.toISOString().slice(0, 7), dayEurAtAnchor: this.dayEur(now.toISOString().slice(0, 10)) });
    this.lastLevel = null;
    return this.status();
  }

  /** Geschätzter Stand im laufenden Monat (UTC-Monat wie bei Googles Abrechnung ungefähr). */
  monthEur(now = new Date()) {
    const month = now.toISOString().slice(0, 7);
    const today = now.toISOString().slice(0, 10);
    const a = this.meta('anchor');
    let sum = 0; let calibrated = false;
    if (a && a.month === month) {
      calibrated = true;
      sum = a.eur;
      const aDay = a.at.slice(0, 10);
      for (let d = new Date(aDay + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= today; d = new Date(d.getTime() + 86400000)) {
        const day = d.toISOString().slice(0, 10);
        sum += day === aDay ? Math.max(0, this.dayEur(day) - (a.dayEurAtAnchor || 0)) : this.dayEur(day);
      }
    } else {
      for (let d = new Date(month + '-01T00:00:00Z'); d.toISOString().slice(0, 10) <= today; d = new Date(d.getTime() + 86400000)) sum += this.dayEur(d.toISOString().slice(0, 10));
    }
    return { eur: sum, calibrated, calibratedAt: calibrated ? a.at : null };
  }

  status(now = new Date()) {
    const c = this.cfg();
    const { eur, calibrated, calibratedAt } = this.monthEur(now);
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const elapsed = Math.max(1 / 24, (now.getTime() - start) / 86400000);
    const days = (end - start) / 86400000;
    // Hochrechnung erst ab ~2 Tagen Daten sinnvoll, sonst täuschen Einzelspitzen
    const projected = elapsed >= 2 ? (eur / elapsed) * days : null;
    const pct = c.monthlyEur > 0 ? (eur / c.monthlyEur) * 100 : 0;
    const level = c.monthlyEur <= 0 ? 'ok' : pct >= 95 ? 'brake' : (pct >= c.warnPct || (projected != null && projected > c.monthlyEur * 1.05)) ? 'warn' : 'ok';
    const today = this.dayEur(now.toISOString().slice(0, 10));
    return { eur: +eur.toFixed(2), budget: c.monthlyEur, pct: Math.round(pct), projected: projected == null ? null : +projected.toFixed(2), today: +today.toFixed(3), level, braking: level === 'brake' && c.brake !== false, calibrated, calibratedAt, estimate: true };
  }

  braking() { try { return this.status().braking; } catch { return false; } }

  /** Regelmäßig prüfen und bei Stufenwechsel melden (einmal pro Monat und Stufe). */
  check() {
    const st = this.status();
    const month = new Date().toISOString().slice(0, 7);
    if (st.level !== 'ok' && st.level !== this.lastLevel) {
      const fmt = (v) => v.toFixed(2).replace('.', ',') + ' €';
      const body = st.level === 'brake'
        ? `Geschätzt ${fmt(st.eur)} von ${fmt(st.budget)} verbraucht. Sparstufe aktiv: Analysen über das schnelle Modell, Hintergrund-KI (LoL-Tipps, Seitenanalyse) pausiert. Chat und Sprache laufen weiter.`
        : `Geschätzt ${fmt(st.eur)} von ${fmt(st.budget)} verbraucht${st.projected != null ? ` – bei diesem Tempo etwa ${fmt(st.projected)} am Monatsende` : ''}. Einstellungen → Gemini / KI zeigt, was am meisten kostet.`;
      this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: `budget:${month}:${st.level}`, title: st.level === 'brake' ? 'Gemini-Budget fast aufgebraucht' : 'Gemini-Budget: Achtung', body });
      log.info(`Budget-Stufe ${st.level}: ${st.eur} € / ${st.budget} €`);
    }
    this.lastLevel = st.level;
    return st;
  }
}

module.exports = { CostGuard, costUsd, priceFor };
