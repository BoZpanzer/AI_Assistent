'use strict';
/**
 * LoL Objective-Timer aus der lokalen Live Client Data API (allgamedata.events).
 *
 * Verlässlich (aus echten Ereignissen im Match): Respawns nach einem Kill – Drache 5:00, Elder 6:00,
 * Baron 6:00. Die ERSTEN Spawnzeiten hängen vom Patch ab; die Standardwerte unten sind der Stand,
 * den JARVIS kennt, und lassen sich in den Einstellungen anpassen. Die Oberfläche kennzeichnet sie.
 * Nur Anzeige – JARVIS steuert nichts im Spiel.
 */
const DEFAULTS = { dragon: 300, dragonRespawn: 300, elderRespawn: 360, grubs: 480, herald: 900, atakhan: 1200, baron: 1500, baronRespawn: 360 };

function teamOf(name, players) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  const p = (players || []).find((x) => [x.riotIdGameName, x.summonerName, x.riotId, String(x.riotId || '').split('#')[0]].filter(Boolean).some((v) => String(v).toLowerCase() === n));
  return p?.team || null;
}

/**
 * @returns {Array<{id,label,spawnAt,remaining,state,estimated,note}>} sortiert nach nächstem Spawn.
 * state: 'up' (steht), 'soon' (≤ 60 s), 'waiting'; estimated=true → Standard-Startzeit (Patch-abhängig).
 */
function objectives(events = [], players = [], seconds = 0, myTeam = null, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  const ev = (events || []).filter((e) => e && typeof e.EventTime === 'number').sort((a, b) => a.EventTime - b.EventTime);
  const out = [];
  const add = (id, label, spawnAt, estimated, note) => {
    const remaining = Math.round(spawnAt - seconds);
    out.push({ id, label, spawnAt: Math.round(spawnAt), remaining, state: remaining <= 0 ? 'up' : remaining <= 60 ? 'soon' : 'waiting', estimated, note: note || null });
  };
  const side = (team) => (!team || !myTeam ? '' : team === myTeam ? ' (dein Team)' : ' (Gegner)');

  // Drachen
  const dragons = ev.filter((e) => e.EventName === 'DragonKill');
  const counts = {};
  for (const d of dragons) if (!/elder/i.test(d.DragonType || '')) { const t = teamOf(d.KillerName, players) || '?'; counts[t] = (counts[t] || 0) + 1; }
  const soul = Object.entries(counts).find(([, n]) => n >= 4);
  const lastDragon = dragons.at(-1);
  if (!lastDragon) add('dragon', 'Drache', c.dragon, true);
  else {
    const elder = !!soul || /elder/i.test(lastDragon.DragonType || '');
    const by = teamOf(lastDragon.KillerName, players);
    add(elder ? 'elder' : 'dragon', elder ? 'Elder-Drache' : 'Drache', lastDragon.EventTime + (elder ? c.elderRespawn : c.dragonRespawn), false,
      `letzter: ${lastDragon.DragonType || 'Drache'}${lastDragon.Stolen === 'True' || lastDragon.Stolen === true ? ' (gestohlen)' : ''}${side(by)}${soul ? ` · Seele: ${soul[0] === myTeam ? 'dein Team' : 'Gegner'}` : ''}`);
  }

  // Voidgrubs / Herald / Atakhan – einmalig (nach dem Kill verschwinden sie aus der Liste)
  const killed = (re) => ev.some((e) => re.test(e.EventName || ''));
  if (!killed(/Horde|Grub/i) && seconds < c.herald) add('grubs', 'Voidgrubs', c.grubs, true);
  if (!killed(/Herald/i) && seconds < c.baron) add('herald', 'Herold', c.herald, true);
  if (!killed(/Atakhan/i) && seconds < c.atakhan + 600) add('atakhan', 'Atakhan', c.atakhan, true);

  // Baron
  const lastBaron = ev.filter((e) => e.EventName === 'BaronKill').at(-1);
  if (!lastBaron) add('baron', 'Baron', c.baron, true);
  else add('baron', 'Baron', lastBaron.EventTime + c.baronRespawn, false, `letzter${side(teamOf(lastBaron.KillerName, players))} – Buff bis ${fmt(lastBaron.EventTime + 180)}`);

  return out.sort((a, b) => a.spawnAt - b.spawnAt);
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

module.exports = { objectives, DEFAULTS, fmt };
