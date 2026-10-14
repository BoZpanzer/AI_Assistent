'use strict';
/**
 * Coaching außerhalb des Spiels (reine Rechnung auf deinen gespeicherten Ranked-Spielen, kein LLM):
 * - Tilt/Session: Winrate nach Niederlagen-Serien, nach Spielanzahl am Stück und nach Tageszeit.
 * - Wochenbericht: diese Woche gegen die Vorwoche, Zielerreichung, Ziel-Vorschläge aus den Fehlermustern.
 * Aussagen nur ab genügend Spielen – sonst „zu wenig Daten“ statt Behauptungen.
 */
const SESSION_GAP_MS = 90 * 60000; // Abstand zwischen Spielstarts, ab dem eine neue Session beginnt
const MIN_BUCKET = 5;
const pct = (w, n) => (n ? Math.round((w / n) * 100) : null);
const HOURS = [['morgens', 5, 12], ['nachmittags', 12, 18], ['abends', 18, 22], ['nachts', 22, 29]];

/** games: [{ playedAt (ISO), win, duration (s) }] in beliebiger Reihenfolge. */
function sessionStats(games) {
  const list = games.filter((g) => g.playedAt).map((g) => ({ ...g, t: Date.parse(g.playedAt) })).filter((g) => Number.isFinite(g.t)).sort((a, b) => a.t - b.t);
  const n = list.length; const wins = list.filter((g) => g.win).length;
  const streak = { 0: [0, 0], 1: [0, 0], 2: [0, 0] }; const idx = { '1–2': [0, 0], '3–4': [0, 0], '5+': [0, 0] }; const hour = Object.fromEntries(HOURS.map(([h]) => [h, [0, 0]]));
  let lossRun = 0; let pos = 0; let prev = null;
  for (const g of list) {
    if (!prev || g.t - prev.t > SESSION_GAP_MS) { lossRun = 0; pos = 0; }
    pos++;
    const sk = Math.min(2, lossRun); streak[sk][0] += g.win ? 1 : 0; streak[sk][1]++;
    const ik = pos <= 2 ? '1–2' : pos <= 4 ? '3–4' : '5+'; idx[ik][0] += g.win ? 1 : 0; idx[ik][1]++;
    let h = new Date(g.t).getHours(); if (h < 5) h += 24;
    const hk = HOURS.find(([, a, b]) => h >= a && h < b)?.[0]; if (hk) { hour[hk][0] += g.win ? 1 : 0; hour[hk][1]++; }
    lossRun = g.win ? 0 : lossRun + 1; prev = g;
  }
  const fmt = (o) => Object.fromEntries(Object.entries(o).map(([k, [w, c]]) => [k, { games: c, winrate: c >= MIN_BUCKET ? pct(w, c) : null }]));
  const res = { games: n, winrate: pct(wins, n), afterLosses: fmt(streak), gameInSession: fmt(idx), timeOfDay: fmt(hour), findings: [] };
  // aktuelle Session (letztes Spiel vor < 90 Min.)
  const last = list[list.length - 1];
  if (last && Date.now() - last.t < SESSION_GAP_MS + (last.duration || 1800) * 1000) {
    let i = list.length - 1; while (i > 0 && list[i].t - list[i - 1].t <= SESSION_GAP_MS) i--;
    const sess = list.slice(i); let run = 0; for (let j = sess.length - 1; j >= 0 && !sess[j].win; j--) run++;
    res.currentSession = { games: sess.length, wins: sess.filter((g) => g.win).length, lossStreak: run };
  }
  if (n < 20) return res;
  const a2 = res.afterLosses[2]; const g5 = res.gameInSession['5+'];
  if (a2.winrate != null && a2.winrate <= res.winrate - 10) res.findings.push({ id: 'tilt-streak', title: 'Nach zwei Niederlagen wird es schlechter', text: `Nach 2+ Niederlagen in Folge gewinnst du ${a2.winrate} % (${a2.games} Spiele), sonst ${res.winrate} %. Nach der zweiten Niederlage lohnt sich eine Pause.` });
  if (g5.winrate != null && g5.winrate <= res.winrate - 10) res.findings.push({ id: 'long-session', title: 'Lange Sessions kosten Siege', text: `Ab dem 5. Spiel am Stück: ${g5.winrate} % (${g5.games} Spiele) gegen ${res.winrate} % insgesamt.` });
  const hs = Object.entries(res.timeOfDay).filter(([, v]) => v.winrate != null);
  if (hs.length >= 2) {
    hs.sort((x, y) => x[1].winrate - y[1].winrate);
    const [worst, best] = [hs[0], hs[hs.length - 1]];
    if (best[1].winrate - worst[1].winrate >= 15) res.findings.push({ id: 'time-of-day', title: `${worst[0][0].toUpperCase() + worst[0].slice(1)} läuft es schlechter`, text: `${worst[0]}: ${worst[1].winrate} % (${worst[1].games} Spiele), ${best[0]}: ${best[1].winrate} % (${best[1].games} Spiele).` });
  }
  return res;
}

/** Soll nach diesem Spiel eine Pause vorgeschlagen werden? Nur wenn die eigenen Zahlen es hergeben. */
function breakHint(st) {
  const cs = st.currentSession; const a2 = st.afterLosses?.[2];
  if (!cs || cs.lossStreak < 2 || a2?.winrate == null || st.games < 20) return null;
  if (a2.winrate > st.winrate - 10) return null;
  return `${cs.lossStreak} Niederlagen in Folge. Nach so einer Serie gewinnst du nur ${a2.winrate} % (sonst ${st.winrate} %, aus ${a2.games} Spielen). Kurze Pause?`;
}

/** Ziel-Vorschläge aus den Fehlermustern (messbar, so dass die Nachbesprechung sie prüfen kann). */
function suggestGoals(patterns, avg) {
  const out = [];
  const ids = new Set((patterns?.findings || []).map((f) => f.id));
  const A = patterns?.averages || {};
  if (ids.has('early-deaths') || ids.has('ganked')) out.push({ text: `Max. ${Math.max(0, Math.floor((A.earlyDeaths ?? 2) - 1))} Tode vor Minute 14`, metric: 'earlyDeaths', target: Math.max(0, Math.floor((A.earlyDeaths ?? 2) - 1)), why: ids.has('ganked') ? 'Viele frühe Tode mit dem gegnerischen Jungler' : 'Zu viele frühe Tode' });
  if ((ids.has('lane-loss') || ids.has('midgame-farm') || ids.has('gold-behind')) && avg?.csPerMin != null) out.push({ text: `${(Math.round((avg.csPerMin + 0.5) * 2) / 2).toFixed(1)} CS/min`, metric: 'csPerMin', target: Math.round((avg.csPerMin + 0.5) * 2) / 2, why: ids.has('midgame-farm') ? 'Farm bricht nach der Lane-Phase ein' : 'Rückstand in der Lane' });
  if ((ids.has('control-wards') || ids.has('vision-loss')) && avg?.vision != null) out.push({ text: `Vision ${Math.round(avg.vision * 1.2)}`, metric: 'vision', target: Math.round(avg.vision * 1.2), why: 'Wenig Sicht' });
  if ((ids.has('caught') || ids.has('solo-deaths') || ids.has('obj-deaths')) && avg?.avgD != null) out.push({ text: `Max. ${Math.max(2, Math.floor(avg.avgD - 1))} Tode`, metric: 'deaths', target: Math.max(2, Math.floor(avg.avgD - 1)), why: 'Viele Tode' });
  return out.slice(0, 3);
}

/** Erfüllt ein Spiel ein Ziel? null = nicht messbar. deep (optional) für frühe Tode. */
function goalMet(goal, m, deep) {
  if (goal.target == null) return null;
  if (goal.metric === 'csPerMin') return m.csPerMin >= goal.target;
  if (goal.metric === 'deaths') return m.deaths <= goal.target;
  if (goal.metric === 'vision') return m.vision != null ? m.vision >= goal.target : null;
  if (goal.metric === 'earlyDeaths') return deep?.earlyDeaths != null ? deep.earlyDeaths <= goal.target : null;
  return null;
}

/** Wochenbericht: games/prev mit { ...summary, playedAt, deep }. */
function weekly(games, prevGames, goals, patterns, avg) {
  const agg = (list) => {
    if (!list.length) return null;
    const n = list.length; const s = (f) => list.reduce((a, x) => a + (f(x) || 0), 0);
    const deep = list.filter((x) => x.deep?.hasTimeline);
    return { games: n, winrate: pct(s((x) => (x.win ? 1 : 0)), n), csPerMin: +(s((x) => x.csPerMin) / n).toFixed(1), deaths: +(s((x) => x.deaths) / n).toFixed(1),
      vision: (() => { const v = list.filter((x) => x.vision != null); return v.length ? Math.round(v.reduce((a, x) => a + x.vision, 0) / v.length) : null; })(),
      earlyDeaths: deep.length ? +(deep.reduce((a, x) => a + (x.deep.earlyDeaths || 0), 0) / deep.length).toFixed(1) : null };
  };
  const cur = agg(games); const prev = agg(prevGames);
  const goalsOut = goals.map((g) => {
    const r = games.map((m) => goalMet(g, m, m.deep)).filter((x) => x != null);
    return { ...g, met: r.filter(Boolean).length, measured: r.length };
  });
  return { week: cur, previous: prev, goals: goalsOut, suggestions: suggestGoals(patterns, avg).filter((s) => !goals.some((g) => g.metric === s.metric)) };
}

module.exports = { sessionStats, breakHint, suggestGoals, goalMet, weekly, SESSION_GAP_MS };
