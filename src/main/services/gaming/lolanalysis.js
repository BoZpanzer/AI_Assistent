'use strict';
/**
 * LoL-Tiefenanalyse aus Spiel- und Timeline-Daten (League-Client oder Riot-API).
 * Alles wird aus echten Daten berechnet: Tode (Minute, Ort, allein/überzahl), Lane-Phase
 * (CS/Gold/XP bei 10 und 15 Minuten gegen den direkten Gegner), Objectives (dabei oder nicht,
 * Tode kurz bevor der Gegner Drache/Baron holt) und Vision. Orte und Anwesenheit bei Objectives sind
 * aus Minuten-Positionen abgeleitet und daher „ungefähr“. Es gibt keine Vergleichswerte aus dem Netz –
 * Muster entstehen aus deinen eigenen Spielen (z. B. Siege gegen Niederlagen).
 */

const ROLE = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MIDDLE', MID: 'MIDDLE', BOTTOM: 'BOTTOM', BOT: 'BOTTOM', UTILITY: 'UTILITY', SUPPORT: 'UTILITY' };
const ROLE_DE = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot (ADC)', UTILITY: 'Support' };
const PITS = { DRAGON: { x: 9866, y: 4414 }, BARON_NASHOR: { x: 5007, y: 10471 }, RIFTHERALD: { x: 5007, y: 10471 }, HORDE: { x: 5007, y: 10471 } };
const MON_DE = { DRAGON: 'Drache', BARON_NASHOR: 'Baron', RIFTHERALD: 'Herold', HORDE: 'Leerenlarven', ATAKHAN: 'Atakhan' };
const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Zone auf der Karte (Summoner's Rift, blaue Basis unten links). Ungefähr. */
function zone(pos, teamId) {
  if (!pos || pos.x == null) return 'unbekannt';
  const { x, y } = pos;
  if (x < 4200 && y < 4200) return teamId === 100 ? 'eigene Basis' : 'gegnerische Basis';
  if (x > 10600 && y > 10600) return teamId === 200 ? 'eigene Basis' : 'gegnerische Basis';
  if ((x < 2200 && y > 4200) || (y > 12600 && x < 10600)) return 'Toplane';
  if ((y < 2200 && x > 4200) || (x > 12600 && y < 10600)) return 'Botlane';
  if (Math.abs(x - y) < 1300) return 'Midlane';
  if (Math.abs(x + y - 14800) < 1500) return 'Fluss';
  const blueSide = x + y < 14800;
  return (teamId === 100) === blueSide ? 'eigener Jungle' : 'gegnerischer Jungle';
}

/** Spieldaten aus LCU (v4-ähnlich) oder Riot match-v5 vereinheitlichen. */
function normalizeGame(game, puuid) {
  const info = game?.info || game;
  if (!info) return null;
  const v5 = Array.isArray(info.participants) && info.participants[0] && 'puuid' in info.participants[0];
  const parts = (info.participants || []).map((p) => {
    if (v5) {
      return { id: p.participantId, puuid: p.puuid, teamId: p.teamId, championId: p.championId, champion: p.championName, role: ROLE[p.teamPosition] || ROLE[p.individualPosition] || null, win: !!p.win,
        kills: p.kills, deaths: p.deaths, assists: p.assists, cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0), vision: p.visionScore, wardsPlaced: p.wardsPlaced, wardsKilled: p.wardsKilled,
        controlWards: p.visionWardsBoughtInGame ?? p.detectorWardsPlaced, damage: p.totalDamageDealtToChampions, damageTaken: p.totalDamageTaken, gold: p.goldEarned };
    }
    const ident = (game.participantIdentities || []).find((x) => x.participantId === p.participantId);
    const st = p.stats || {};
    const lane = String(p.timeline?.lane || '').toUpperCase(); const r = String(p.timeline?.role || '').toUpperCase();
    let role = lane === 'JUNGLE' ? 'JUNGLE' : lane === 'TOP' ? 'TOP' : lane === 'MIDDLE' || lane === 'MID' ? 'MIDDLE' : lane === 'BOTTOM' || lane === 'BOT' ? (r.includes('SUPPORT') ? 'UTILITY' : r.includes('CARRY') ? 'BOTTOM' : null) : null;
    if (!role && (p.spell1Id === 11 || p.spell2Id === 11)) role = 'JUNGLE'; // Zerschmettern
    return { id: p.participantId, puuid: ident?.player?.puuid, teamId: p.teamId, championId: p.championId, champion: null, role, win: !!st.win,
      kills: st.kills, deaths: st.deaths, assists: st.assists, cs: (st.totalMinionsKilled || 0) + (st.neutralMinionsKilled || 0), vision: st.visionScore, wardsPlaced: st.wardsPlaced, wardsKilled: st.wardsKilled,
      controlWards: st.visionWardsBoughtInGame, damage: st.totalDamageDealtToChampions, damageTaken: st.totalDamageTaken, gold: st.goldEarned };
  });
  // Bot-Duo ohne klare Rolle: mehr CS = ADC, weniger = Support
  for (const t of [100, 200]) {
    const bot = parts.filter((p) => p.teamId === t && !p.role);
    if (bot.length === 2) { bot.sort((a, b) => b.cs - a.cs); bot[0].role = 'BOTTOM'; bot[1].role = 'UTILITY'; }
  }
  const me = parts.find((p) => p.puuid === puuid);
  const duration = Number(info.gameDuration > 20000 ? info.gameDuration / 1000 : info.gameDuration) || 0; // v5 kann ms liefern
  const gameId = info.gameId; const platform = info.platformId;
  return { me, parts, duration, gameId, matchId: game?.metadata?.matchId || (platform ? `${platform}_${gameId}` : String(gameId)), queueId: info.queueId };
}

function framesOf(tl) { return tl?.info?.frames || tl?.frames || []; }
function pf(frame, id) { const f = frame?.participantFrames || {}; return f[id] || f[String(id)] || Object.values(f).find((x) => x.participantId === id) || null; }
function atMinute(frames, min) { return frames.find((f) => Math.round((f.timestamp || 0) / 60000) === min) || null; }
function posAt(frames, id, ts) {
  let best = null; let bd = Infinity;
  for (const f of frames) { const d = Math.abs((f.timestamp || 0) - ts); if (d < bd) { bd = d; best = f; } }
  return pf(best, id)?.position || null;
}
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

/** Ein Spiel analysieren. Gibt null zurück, wenn der Spieler nicht gefunden wird. */
function analyzeGame(game, timeline, puuid) {
  const g = normalizeGame(game, puuid);
  if (!g?.me) return null;
  const { me, parts } = g;
  const opp = parts.find((p) => p.teamId !== me.teamId && p.role && p.role === me.role) || null;
  const team = parts.filter((p) => p.teamId === me.teamId);
  const frames = framesOf(timeline);
  const events = frames.flatMap((f) => f.events || []);
  const mins = g.duration / 60 || 1;
  const out = {
    matchId: g.matchId, gameId: g.gameId, win: me.win, role: me.role, roleDe: ROLE_DE[me.role] || null, championId: me.championId, champion: me.champion, durationMin: round(mins, 0),
    kills: me.kills, deaths: me.deaths, assists: me.assists,
    kp: round(((me.kills + me.assists) / Math.max(1, team.reduce((a, p) => a + (p.kills || 0), 0))) * 100, 0),
    damageShare: round((me.damage / Math.max(1, team.reduce((a, p) => a + (p.damage || 0), 0))) * 100, 0),
    visionPerMin: round((me.vision || 0) / mins, 2), wardsPlaced: me.wardsPlaced ?? null, controlWards: me.controlWards ?? null,
    opponent: opp ? { championId: opp.championId, champion: opp.champion } : null,
    hasTimeline: frames.length > 0,
  };
  if (!frames.length) return out;

  for (const m of [10, 15]) {
    const f = atMinute(frames, m);
    const a = pf(f, me.id); const b = opp ? pf(f, opp.id) : null;
    if (!a) continue;
    const cs = (a.minionsKilled || 0) + (a.jungleMinionsKilled || 0);
    out['csAt' + m] = cs; out['goldAt' + m] = a.totalGold ?? null;
    if (b) {
      out['csDiff' + m] = cs - ((b.minionsKilled || 0) + (b.jungleMinionsKilled || 0));
      out['goldDiff' + m] = a.totalGold != null && b.totalGold != null ? a.totalGold - b.totalGold : null;
      out['xpDiff' + m] = a.xp != null && b.xp != null ? a.xp - b.xp : null;
    }
  }

  // Tode
  const kills = events.filter((e) => e.type === 'CHAMPION_KILL');
  out.deathsDetail = kills.filter((e) => e.victimId === me.id).map((e) => {
    const enemies = 1 + (e.assistingParticipantIds || []).length;
    return { min: round(e.timestamp / 60000, 1), zone: zone(e.position, me.teamId), enemies, solo: enemies === 1 };
  });
  out.earlyDeaths = out.deathsDetail.filter((d) => d.min < 14).length;
  out.firstDeathMin = out.deathsDetail[0]?.min ?? null;
  out.soloKills = kills.filter((e) => e.killerId === me.id && !(e.assistingParticipantIds || []).length).length;

  // Objectives (Drache, Baron, Herold, Larven)
  const epic = events.filter((e) => e.type === 'ELITE_MONSTER_KILL');
  const teamOf = (pid) => parts.find((p) => p.id === pid)?.teamId;
  let teamTaken = 0; let present = 0; let enemyTaken = 0; let deadBefore = 0; const lost = [];
  for (const e of epic) {
    const t = e.killerTeamId || teamOf(e.killerId);
    const pit = PITS[e.monsterType] || e.position;
    if (t === me.teamId) {
      teamTaken++;
      if (dist(posAt(frames, me.id, e.timestamp), pit) <= 3200 || e.killerId === me.id || (e.assistingParticipantIds || []).includes(me.id)) present++;
    } else if (t) {
      enemyTaken++;
      const died = out.deathsDetail.find((d) => d.min * 60000 <= e.timestamp && e.timestamp - d.min * 60000 <= 75000);
      if (died) { deadBefore++; lost.push(`${MON_DE[e.monsterType] || e.monsterType} (${round(e.timestamp / 60000, 0)}. Min.)`); }
    }
  }
  out.objectives = { teamTaken, enemyTaken, presentPct: teamTaken ? round((present / teamTaken) * 100, 0) : null, deathsBeforeEnemyObjective: deadBefore, lostWhileDead: lost };
  return out;
}

/**
 * Muster über mehrere Spiele – nur mit genug Daten und nur aus deinen eigenen Zahlen.
 * Jeder Befund enthält die Belege (Werte, Anzahl Spiele).
 */
function patterns(list) {
  const games = list.filter(Boolean);
  const n = games.length;
  const res = { games: n, wins: games.filter((g) => g.win).length, findings: [], strengths: [], averages: {} };
  if (n < 3) return res;
  const wins = games.filter((g) => g.win); const losses = games.filter((g) => !g.win);
  const tl = games.filter((g) => g.hasTimeline);
  const deaths = tl.flatMap((g) => g.deathsDetail || []);
  const A = res.averages;
  A.deaths = round(avg(games.map((g) => g.deaths)));
  A.earlyDeaths = round(avg(tl.map((g) => g.earlyDeaths)));
  A.csAt10 = round(avg(tl.map((g) => g.csAt10).filter((v) => v != null)), 0);
  A.csDiff10 = round(avg(tl.map((g) => g.csDiff10).filter((v) => v != null)), 0);
  A.goldDiff15 = round(avg(tl.map((g) => g.goldDiff15).filter((v) => v != null)), 0);
  A.visionPerMin = round(avg(games.map((g) => g.visionPerMin).filter((v) => v != null)), 2);
  A.controlWards = round(avg(games.map((g) => g.controlWards).filter((v) => v != null)));
  A.objectivePresence = round(avg(tl.map((g) => g.objectives?.presentPct).filter((v) => v != null)), 0);
  A.kp = round(avg(games.map((g) => g.kp).filter((v) => v != null)), 0);
  const add = (arr, id, title, text, evidence, weight) => arr.push({ id, title, text, evidence, weight });

  if (tl.length >= 3) {
    const many = tl.filter((g) => g.earlyDeaths >= 2).length;
    if (A.earlyDeaths >= 1.5 || many / tl.length >= 0.5) add(res.findings, 'early-deaths', 'Zu viele frühe Tode', `Vor Minute 14 stirbst du im Schnitt ${A.earlyDeaths}-mal; in ${many} von ${tl.length} Spielen mindestens zweimal. Jeder frühe Tod kostet Gold, XP und Lane-Druck.`, { avg: A.earlyDeaths, games: `${many}/${tl.length}` }, 3 + A.earlyDeaths);
    if (deaths.length >= 6) {
      const risky = deaths.filter((d) => d.zone === 'Fluss' || d.zone === 'gegnerischer Jungle').length;
      const share = risky / deaths.length;
      if (share >= 0.4) add(res.findings, 'death-zones', 'Tode im Fluss / gegnerischen Jungle', `${Math.round(share * 100)} % deiner Tode (${risky} von ${deaths.length}) passieren ungefähr im Fluss oder im gegnerischen Jungle – oft Facechecks ohne Sicht oder zu tiefes Vorgehen.`, { share: Math.round(share * 100), deaths: deaths.length }, 2 + share * 3);
      const solo = deaths.filter((d) => d.solo).length / deaths.length;
      if (solo >= 0.4) add(res.findings, 'solo-deaths', 'Viele 1-gegen-1-Tode', `${Math.round(solo * 100)} % deiner Tode sind Solo-Tode (nur ein Gegner beteiligt). Prüfe Matchup-Stärke, Cooldowns und Trades.`, { share: Math.round(solo * 100) }, 2 + solo * 2);
      const outnumbered = deaths.filter((d) => d.enemies >= 3).length / deaths.length;
      if (outnumbered >= 0.4) add(res.findings, 'caught', 'Oft von mehreren erwischt', `${Math.round(outnumbered * 100)} % deiner Tode passieren gegen 3 oder mehr Gegner – typisch für Seitenlanes ohne Info oder zu spätes Zurückziehen.`, { share: Math.round(outnumbered * 100) }, 2 + outnumbered * 2);
    }
    const dbo = tl.reduce((a, g) => a + (g.objectives?.deathsBeforeEnemyObjective || 0), 0);
    if (dbo / tl.length >= 0.5) add(res.findings, 'obj-deaths', 'Tode kurz vor gegnerischen Objectives', `In ${tl.length} Spielen bist du ${dbo}-mal kurz bevor der Gegner Drache/Baron/Herold geholt hat gestorben. Vor Objectives lieber sicher stehen und Sicht machen.`, { count: dbo, games: tl.length }, 3);
    if (A.objectivePresence != null && A.objectivePresence < 50 && !['TOP'].includes(majorRole(games))) add(res.findings, 'obj-presence', 'Selten bei Objectives', `Bei nur ca. ${A.objectivePresence} % der Drachen/Barone deines Teams warst du in der Nähe (aus Minuten-Positionen geschätzt).`, { pct: A.objectivePresence }, 1.5);
    const cw = avg(wins.filter((g) => g.hasTimeline && g.csAt10 != null).map((g) => g.csAt10)); const cl = avg(losses.filter((g) => g.hasTimeline && g.csAt10 != null).map((g) => g.csAt10));
    if (wins.length >= 2 && losses.length >= 2 && cw != null && cl != null && cw - cl >= 10) add(res.findings, 'lane-loss', 'In Niederlagen schlechtere Lane-Phase', `CS bei 10 Min.: ${round(cw, 0)} in Siegen gegen ${round(cl, 0)} in Niederlagen. Deine Spiele entscheiden sich oft schon in der Lane – Farmen unter Druck üben.`, { wins: round(cw, 0), losses: round(cl, 0) }, 2.5);
    if (A.goldDiff15 != null && A.goldDiff15 <= -400) add(res.findings, 'gold-behind', 'Hinter dem Lane-Gegner bei 15 Min.', `Gegen deinen direkten Gegner liegst du bei 15 Minuten im Schnitt ${Math.abs(A.goldDiff15)} Gold zurück (CS-Differenz bei 10 Min.: ${A.csDiff10 ?? '–'}).`, { goldDiff15: A.goldDiff15, csDiff10: A.csDiff10 }, 2.5);
    if (A.goldDiff15 != null && A.goldDiff15 >= 400) add(res.strengths, 'lane-strong', 'Starke Lane-Phase', `Bei 15 Min. im Schnitt +${A.goldDiff15} Gold gegen deinen Gegner.`, { goldDiff15: A.goldDiff15 }, 1);
  }
  if (A.controlWards != null && A.controlWards < 1 && majorRole(games) !== null) add(res.findings, 'control-wards', 'Kaum Kontrollwards', `Im Schnitt ${A.controlWards} Kontrollwards pro Spiel. Eine pro Rückkehr zur Basis ist eine gute Faustregel.`, { avg: A.controlWards }, 1.5);
  const vw = avg(wins.map((g) => g.visionPerMin).filter((v) => v != null)); const vl = avg(losses.map((g) => g.visionPerMin).filter((v) => v != null));
  if (wins.length >= 2 && losses.length >= 2 && vw && vl && vl < vw * 0.8) add(res.findings, 'vision-loss', 'Weniger Sicht in Niederlagen', `Vision pro Minute: ${round(vw, 2)} in Siegen, ${round(vl, 2)} in Niederlagen.`, { wins: round(vw, 2), losses: round(vl, 2) }, 1.2);
  if (A.kp != null && A.kp >= 60) add(res.strengths, 'kp', 'Hohe Kill-Beteiligung', `Ø ${A.kp} % Kill-Beteiligung.`, { kp: A.kp }, 1);
  res.findings.sort((a, b) => b.weight - a.weight);
  res.focus = res.findings.slice(0, 3).map((f) => f.title);
  return res;
}

function majorRole(games) {
  const c = {}; for (const g of games) if (g.role) c[g.role] = (c[g.role] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

module.exports = { analyzeGame, patterns, zone, normalizeGame, ROLE_DE };
