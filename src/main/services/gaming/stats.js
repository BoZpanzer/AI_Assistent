'use strict';
const { id, nowIso } = require('../../core/util');
const { localDay } = require('../costguard');
const log = require('../../core/logger').scope('stats');

/**
 * Spielstatistiken – deterministisch im Code berechnet, ohne KI, lokal gespeichert.
 *
 * Zeiträume:
 *   session = aktuelle Spielsitzung laut Prozesserkennung (seit Spielstart); läuft das Spiel nicht,
 *             die zuletzt beendete Sitzung
 *   today   = lokaler Kalendertag des PCs (Wechsel um 00:00)
 *   total   = alle gespeicherten Daten
 *
 * Escape from Tarkov (Quelle: Raid-Start/-Ende aus den Log-Dateien des Spiels; Ergebnis und Kills
 * gibt das Log nicht her → manuelle Erfassung, als „manuell“ gekennzeichnet):
 *   Raids            alle erfassten Raids im Zeitraum
 *   Überlebensrate   (überlebt + Run-Through) / Raids mit bekanntem Ergebnis; Raids ohne Ergebnis zählen nicht mit
 *   Tode             Raids mit Ergebnis „gestorben“ (KIA); MIA/verlassen zählen nicht als Tod
 *   PMC-/KI-Kills    Summe über Raids, bei denen die Zahl erfasst wurde
 *   K/D (PMC)        PMC-Kills / Tode, nur über Raids mit erfassten PMC-Kills und bekanntem Ergebnis;
 *                    ohne Tode nicht definiert (Anzeige „–“)
 *   Die Überlebensrate ist KEINE Winrate.
 *
 * League of Legends (Quelle: gespeicherte Matches aus League-Client bzw. Riot-API, i. d. R. Ranked Solo/Duo):
 *   Siege/Niederlagen, Winrate = Siege / Spiele. Konter = eigene Bilanz gegen den Lane-Gegner aus
 *   analysierten Spielen – eigene Daten, keine Community-Statistik.
 */
const OUTCOMES = { survived: 'überlebt', runthrough: 'Run-Through', died: 'gestorben', mia: 'MIA', left: 'verlassen' };
const SURVIVED = new Set(['survived', 'runthrough']);
const PERIOD_LABEL = { session: 'in dieser Sitzung', today: 'heute', total: 'insgesamt' };

/** \b ist in JS-Regex nicht Unicode-fähig („\büberlebt“ trifft nie) → Wortgrenzen mit \p{L} nachbilden. */
const BOUNDARY = '(?:(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])|(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}]))';
const U = (re) => new RegExp(re.source.split('\\b').join(BOUNDARY), re.flags.includes('u') ? re.flags : re.flags + 'u');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const num = (v) => (v == null ? '–' : String(v).replace('.', ','));

class GameStats {
  constructor(s) { this.s = s; }
  get db() { return this.s.db; }

  /** Zeitfenster [from, to) als ISO-Zeitstempel oder Tagesfilter. */
  window(game, period = 'today', now = new Date()) {
    if (period === 'today') return { day: localDay(now) };
    if (period === 'session') {
      const sess = this.db.get('SELECT start_at, end_at FROM game_sessions WHERE game=? ORDER BY start_at DESC LIMIT 1', game);
      return sess ? { from: sess.start_at, to: sess.end_at || null } : { from: this.s.costGuard?.sessionStart || nowIso() };
    }
    return {};
  }
  events(game, kind, period, now) {
    const w = this.window(game, period, now);
    const where = ['game=?', 'kind=?', 'deleted=0']; const args = [game, kind];
    if (w.day) { where.push('day=?'); args.push(w.day); }
    if (w.from) { where.push('at>=?'); args.push(w.from); }
    if (w.to) { where.push('at<=?'); args.push(w.to); }
    return this.db.all(`SELECT * FROM game_stat_events WHERE ${where.join(' AND ')} ORDER BY at DESC`, ...args).map((r) => ({ ...r, data: JSON.parse(r.data || '{}') }));
  }

  // ---------------------------------------------------------------- Tarkov: erfassen
  /** Aus dem Spiel-Log: Raid gestartet. Doppelte Log-Zeilen/Neustarts erzeugen keinen zweiten Raid (dedupe = Raid-ID). */
  raidStarted({ raidId, map = null, type = null, at = nowIso() }) {
    if (!raidId) return null;
    const dedupe = `eft:raid:${raidId}:${localDay(new Date(at))}`; // Kurz-IDs können sich nach Tagen wiederholen
    if (this.db.get('SELECT 1 AS x FROM game_stat_events WHERE dedupe=?', dedupe)) return null;
    const ev = { id: id('st'), at, data: { raidId, map, type, outcome: null, pmcKills: null, aiKills: null } };
    this.db.run('INSERT INTO game_stat_events(id,game,kind,at,day,session,source,dedupe,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      ev.id, 'eft', 'raid', at, localDay(new Date(at)), null, 'log', dedupe, JSON.stringify(ev.data), nowIso());
    this.s.bus?.emit('game:stats', { game: 'eft' });
    return ev.id;
  }
  raidEnded({ raidId, at = nowIso() }) {
    const row = raidId && this.db.get("SELECT id, data FROM game_stat_events WHERE game='eft' AND kind='raid' AND json_extract(data,'$.raidId')=? ORDER BY at DESC LIMIT 1", raidId);
    if (!row) return null;
    const data = { ...JSON.parse(row.data), endedAt: at };
    this.db.run('UPDATE game_stat_events SET data=?, updated_at=? WHERE id=?', JSON.stringify(data), nowIso(), row.id);
    this.s.bus?.emit('game:stats', { game: 'eft' });
    return row.id;
  }

  /**
   * Ergebnis erfassen oder korrigieren. Ohne `id` wird der jüngste Log-Raid ohne Ergebnis (max. 3 h alt)
   * ergänzt; gibt es keinen, entsteht ein manueller Raid.
   */
  recordRaid({ id: eid = null, outcome, pmcKills = null, aiKills = null, map = null, type = null, at = null } = {}) {
    if (outcome != null && !Object.hasOwn(OUTCOMES, outcome)) throw new Error('Unbekanntes Raid-Ergebnis');
    const count = (v, label) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 60) throw new Error(`${label}: bitte eine ganze Zahl zwischen 0 und 60`);
      return n;
    };
    const k = count(pmcKills, 'PMC-Kills'); const ai = count(aiKills, 'KI-Kills');
    let row = eid ? this.db.get("SELECT * FROM game_stat_events WHERE id=? AND game='eft' AND kind='raid'", eid) : null;
    if (eid && !row) throw new Error('Raid nicht gefunden');
    if (!row) {
      const since = new Date(Date.now() - 3 * 3600_000).toISOString();
      row = this.db.get("SELECT * FROM game_stat_events WHERE game='eft' AND kind='raid' AND deleted=0 AND at>=? AND json_extract(data,'$.outcome') IS NULL ORDER BY at DESC LIMIT 1", since);
    }
    if (row) {
      const data = { ...JSON.parse(row.data || '{}') };
      if (outcome !== undefined) data.outcome = outcome;
      if (pmcKills !== undefined) data.pmcKills = k;
      if (aiKills !== undefined) data.aiKills = ai;
      if (map) data.map = map;
      if (type) data.type = type;
      data.manualResult = true;
      this.db.run('UPDATE game_stat_events SET data=?, updated_at=? WHERE id=?', JSON.stringify(data), nowIso(), row.id);
      this.s.bus?.emit('game:stats', { game: 'eft' });
      return { id: row.id, ...data, source: row.source };
    }
    const when = at || nowIso();
    const data = { raidId: null, map, type, outcome: outcome ?? null, pmcKills: k, aiKills: ai, manualResult: true };
    const nid = id('st');
    this.db.run('INSERT INTO game_stat_events(id,game,kind,at,day,session,source,dedupe,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      nid, 'eft', 'raid', when, localDay(new Date(when)), null, 'manual', null, JSON.stringify(data), nowIso());
    this.s.bus?.emit('game:stats', { game: 'eft' });
    return { id: nid, ...data, source: 'manual' };
  }
  remove(eid) {
    const r = this.db.run('UPDATE game_stat_events SET deleted=1, updated_at=? WHERE id=?', nowIso(), eid);
    this.s.bus?.emit('game:stats', {});
    return r.changes > 0;
  }

  // ---------------------------------------------------------------- Tarkov: auswerten
  tarkov(period = 'today', now = new Date()) {
    const raids = this.events('eft', 'raid', period, now);
    const known = raids.filter((r) => r.data.outcome);
    const survived = known.filter((r) => SURVIVED.has(r.data.outcome)).length;
    const deaths = known.filter((r) => r.data.outcome === 'died').length;
    const withPmc = raids.filter((r) => Number.isInteger(r.data.pmcKills));
    const withAi = raids.filter((r) => Number.isInteger(r.data.aiKills));
    const kdBase = withPmc.filter((r) => r.data.outcome);
    const kdDeaths = kdBase.filter((r) => r.data.outcome === 'died').length;
    const kdKills = kdBase.reduce((a, r) => a + r.data.pmcKills, 0);
    return {
      game: 'eft', period, raids: raids.length, withOutcome: known.length, unknownOutcome: raids.length - known.length,
      survived, deaths, survivalRate: pct(survived, known.length),
      pmcKills: withPmc.length ? withPmc.reduce((a, r) => a + r.data.pmcKills, 0) : null, pmcKillsRaids: withPmc.length,
      aiKills: withAi.length ? withAi.reduce((a, r) => a + r.data.aiKills, 0) : null, aiKillsRaids: withAi.length,
      kd: kdDeaths > 0 ? Math.round((kdKills / kdDeaths) * 100) / 100 : null, kdNote: kdDeaths === 0 ? (kdBase.length ? 'keine Tode' : 'keine Daten') : null,
      byType: { pmc: raids.filter((r) => r.data.type === 'pmc').length, scav: raids.filter((r) => r.data.type === 'scav').length },
      manual: raids.filter((r) => r.source === 'manual' || r.data.manualResult).length,
      recent: raids.slice(0, 12).map((r) => ({ id: r.id, at: r.at, source: r.source, ...r.data })),
      source: 'Tarkov-Log (Raids) + manuelle Erfassung (Ergebnis/Kills)',
    };
  }

  // ---------------------------------------------------------------- League of Legends
  lol(period = 'today', now = new Date()) {
    const w = this.window('league', period, now);
    let rows = this.db.all('SELECT summary, played_at FROM lol_matches ORDER BY played_at DESC LIMIT 2000');
    rows = rows.filter((r) => (!w.day || localDay(new Date(r.played_at)) === w.day) && (!w.from || r.played_at >= w.from) && (!w.to || r.played_at <= w.to));
    const games = rows.map((r) => { try { return JSON.parse(r.summary); } catch { return null; } }).filter(Boolean);
    const wins = games.filter((g) => g.win).length;
    const kills = games.reduce((a, g) => a + (g.kills || 0), 0), deaths = games.reduce((a, g) => a + (g.deaths || 0), 0), assists = games.reduce((a, g) => a + (g.assists || 0), 0);
    return { game: 'league', period, games: games.length, wins, losses: games.length - wins, winrate: pct(wins, games.length),
      kills, deaths, assists, kda: games.length ? Math.round(((kills + assists) / Math.max(1, deaths)) * 100) / 100 : null,
      source: 'gespeicherte Matches (League-Client / Riot-API)' };
  }

  /**
   * Konter aus eigenen Spielen: Bilanz gegen Lane-Gegner. Mit `vs` die eigenen Champions, die gegen
   * diesen Gegner am besten liefen. Unter 3 Spielen nur als Hinweis, nicht als belastbar markiert.
   */
  counters({ vs = null, limit = 200, min = 1 } = {}) {
    const league = this.s.gaming?.league;
    const rows = this.db.all('SELECT match_id FROM lol_matches ORDER BY played_at DESC LIMIT ?', limit);
    const deep = rows.map((r) => league?.getDeep?.(r.match_id)).filter((d) => d?.opponent?.champion && d.champion);
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const agg = (list, key) => {
      const m = new Map();
      for (const d of list) { const k = key(d); const x = m.get(k) || { champion: k, games: 0, wins: 0 }; x.games++; if (d.win) x.wins++; m.set(k, x); }
      return [...m.values()].filter((x) => x.games >= min).map((x) => ({ ...x, winrate: pct(x.wins, x.games), reliable: x.games >= 5 }));
    };
    const out = { analyzedGames: deep.length, source: 'eigene analysierte Spiele (Riot-Timeline), keine Community-Statistik' };
    if (vs) {
      const list = deep.filter((d) => norm(d.opponent.champion) === norm(vs));
      out.vs = list[0]?.opponent?.champion || vs;
      out.overall = list.length ? { games: list.length, wins: list.filter((d) => d.win).length, winrate: pct(list.filter((d) => d.win).length, list.length) } : null;
      out.bestPicks = agg(list, (d) => d.champion).sort((a, b) => b.winrate - a.winrate || b.games - a.games).slice(0, 5);
    } else {
      out.hardest = agg(deep, (d) => d.opponent.champion).filter((x) => x.games >= 2).sort((a, b) => a.winrate - b.winrate || b.games - a.games).slice(0, 6);
    }
    return out;
  }

  // ---------------------------------------------------------------- Sprache / Chat ohne KI
  /** Erkennt einfache Statistikfragen und Erfassungen und beantwortet sie ohne Sprachmodell. Sonst null. */
  answer(text) {
    const t = String(text || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 200) return null;
    const ctx = this.s.gaming?.context?.state?.() || {};
    const runningEft = (this.s.gaming?.context?.running || []).includes('eft');
    const activeGame = ctx.active?.id || null;
    const mentionsLol = U(/\b(lol|league|ranked|champ\w*)\b/).test(t);
    const mentionsEft = U(/\b(tarkov|eft|raids?|scav|pmc|extrahiert|überlebt)\b/).test(t);
    const game = mentionsLol ? 'league' : mentionsEft ? 'eft' : activeGame === 'league' || activeGame === 'eft' ? activeGame : null;
    const period = U(/\b(sitzung|session|diese runde|seit spielstart)\b/).test(t) ? 'session' : U(/\b(insgesamt|gesamt|total|alle zeiten|bisher|overall)\b/).test(t) ? 'total' : U(/\bheute\b/).test(t) ? 'today'
      : (game === 'eft' ? runningEft : (this.s.gaming?.context?.running || []).includes('league')) ? 'session' : 'today';
    const P = PERIOD_LABEL[period];

    // --- Erfassung: „Raid überlebt, 3 Kills und 5 Scavs“, „Raid gestorben“, „Run-Through“
    const rec = t.match(U(/\b(raid|runde)\b.*\b(überlebt|extrahiert|gestorben|tot|getötet|run.?through|mia|verlassen)\b|^(überlebt|extrahiert|gestorben|run.?through)\b/));
    // Nur bei ausdrücklichem „Raid/Runde“ oder kurzer Meldung während Tarkov aktiv ist (nicht „… ist gestorben“ im Alltag)
    if (rec && (rec[1] || (game === 'eft' && t.length <= 40)) && !/[?]|wie|wieviel/.test(t)) {
      const w = rec[2] || rec[3];
      const outcome = /überlebt|extrahiert/.test(w) ? 'survived' : /run/.test(w) ? 'runthrough' : /mia/.test(w) ? 'mia' : /verlassen/.test(w) ? 'left' : 'died';
      const pm = t.match(/(\d+)\s*(?:pmc|spieler|player)?\s*kills?/); const am = t.match(U(/(\d+)\s*(?:scavs?|ki|bots?|ai|npcs?)\b/));
      const r = this.recordRaid({ outcome, pmcKills: pm && !U(/scav|ki\b|bot|ai\b/).test(pm[0]) ? Number(pm[1]) : undefined, aiKills: am ? Number(am[1]) : undefined });
      const st = this.tarkov('session');
      return { text: `Eingetragen: Raid ${OUTCOMES[outcome]}${Number.isInteger(r.pmcKills) ? `, ${r.pmcKills} PMC-Kills` : ''}${Number.isInteger(r.aiKills) ? `, ${r.aiKills} KI-Kills` : ''} (manuell erfasst). Überlebensrate in dieser Sitzung: ${st.survivalRate == null ? '–' : num(st.survivalRate) + ' %'}.`, deterministic: 'stats-record' };
    }

    const asksRate = /überlebensrate|survival.?rate|überlebens.?quote/.test(t);
    const asksKd = U(/\bk\s*\/\s*d\b|\bkd\b|kill.?death/).test(t);
    const asksKills = U(/\bkills?\b/).test(t) && U(/\b(wie ?viele|anzahl|meine)\b/).test(t);
    const asksRaids = U(/\bwie ?viele raids\b|\braids? (heute|insgesamt|diese)/).test(t);
    const asksWin = U(/\b(winrate|win.?rate|siegquote|gewinnrate|siege|niederlagen|gewonnen|verloren)\b/).test(t);
    const counter = t.match(U(/\b(?:konter|counter)\w*\b(?:\s+(?:gegen|für|zu|vs\.?))?\s+([a-zà-ÿ' .]{2,20})\??$/));

    if ((counter || U(/\b(schwerste|schwierigste)\w* (gegner|matchups?)\b/).test(t)) && (game === 'league' || mentionsLol)) {
      const vs = counter?.[1]?.trim().replace(/[?.!]+$/, '').replace(/\s+(?:in|bei|für)\s+(?:lol|league).*$/, '').replace(/\s+(?:lol|league)$/, '').trim() || null;
      const c = this.counters(vs ? { vs } : {});
      if (!c.analyzedGames) return { text: 'Für Konter brauche ich analysierte LoL-Spiele mit Lane-Gegner (Spielanalyse auf der LoL-Seite). Bisher liegen keine vor.', deterministic: 'stats' };
      if (vs) {
        if (!c.overall) return { text: `Gegen ${vs} habe ich in deinen ${c.analyzedGames} analysierten Spielen keine Lane-Duelle gefunden. Allgemeine Konter-Tipps liefert die Matchup-Karte (KI-Einschätzung, nicht statistisch belegt).`, deterministic: 'stats' };
        const best = c.bestPicks.map((x) => `${x.champion} ${num(x.winrate)} % (${x.games} ${x.games === 1 ? 'Spiel' : 'Spiele'})`).join(', ');
        return { text: `Gegen ${c.vs}: ${c.overall.wins} von ${c.overall.games} gewonnen (${num(c.overall.winrate)} %). Deine Picks: ${best}.${c.overall.games < 5 ? ' Wenig Daten – noch nicht belastbar.' : ''} Quelle: deine analysierten Spiele.`, deterministic: 'stats' };
      }
      if (!c.hardest.length) return { text: 'Noch zu wenige Lane-Duelle (mind. 2 gegen denselben Champion) für eine Auswertung.', deterministic: 'stats' };
      return { text: 'Deine schwierigsten Lane-Gegner: ' + c.hardest.map((x) => `${x.champion} ${num(x.winrate)} % (${x.games})`).join(', ') + '. Quelle: deine analysierten Spiele.', deterministic: 'stats' };
    }

    if ((asksWin && game !== 'eft') || (game === 'league' && (asksKd || asksKills))) {
      const s = this.lol(period);
      if (!s.games) return { text: `${P[0].toUpperCase() + P.slice(1)} sind keine LoL-Spiele gespeichert.`, deterministic: 'stats' };
      return { text: `LoL ${P}: ${s.wins} Siege, ${s.losses} Niederlagen – Winrate ${num(s.winrate)} % aus ${s.games} ${s.games === 1 ? 'Spiel' : 'Spielen'}. KDA ${num(s.kda)}.`, deterministic: 'stats' };
    }
    if (game === 'eft' || asksRate || asksRaids || (asksKd && game !== 'league')) {
      if (!(asksRate || asksKd || asksKills || asksRaids || (asksWin && game === 'eft'))) return null;
      const s = this.tarkov(period);
      if (!s.raids) return { text: `${P[0].toUpperCase() + P.slice(1)} sind keine Tarkov-Raids erfasst.`, deterministic: 'stats' };
      const parts = [];
      if (asksRate || asksWin) parts.push(s.survivalRate == null ? `Überlebensrate: noch kein Raid-Ergebnis eingetragen (${s.raids} Raids erfasst)` : `Überlebensrate ${num(s.survivalRate)} % (${s.survived} von ${s.withOutcome} Raids mit Ergebnis${s.unknownOutcome ? `, ${s.unknownOutcome} ohne Ergebnis` : ''})`);
      if (asksWin) parts.push('Tarkov kennt keine Siege – das ist die Überlebensrate, keine Winrate');
      if (asksKills) parts.push(`${s.pmcKills == null ? 'PMC-Kills nicht erfasst' : `${s.pmcKills} PMC-Kills`}${s.aiKills == null ? '' : `, ${s.aiKills} KI-Kills`}`);
      if (asksKd) parts.push(s.kd == null ? `K/D: – (${s.kdNote || 'keine Daten'})` : `K/D ${num(s.kd)}`);
      if (asksRaids || !parts.length) parts.push(`${s.raids} Raids`);
      return { text: `Tarkov ${P}: ${parts.join(' · ')}.`, deterministic: 'stats' };
    }
    return null;
  }
}

module.exports = { GameStats, OUTCOMES };
