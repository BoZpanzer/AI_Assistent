'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Stardew Valley – Spielstand lesen (nur lesend, lokale Speicherdatei unter %APPDATA%\StardewValley\Saves):
 * Datum, Geld, Freundschaften (Herzen), Geburtstage der Dorfbewohner (stehen im Spielstand) und der
 * Stand der Bündel im Gemeinschaftszentrum. Keine eingebauten Spieldaten.
 */
const SEASONS = ['spring', 'summer', 'fall', 'winter'];
const SEASON_DE = { spring: 'Frühling', summer: 'Sommer', fall: 'Herbst', winter: 'Winter' };
const ROOMS_DE = { Pantry: 'Vorratskammer', 'Crafts Room': 'Handwerksraum', 'Fish Tank': 'Aquarium', 'Boiler Room': 'Heizungsraum', Vault: 'Tresor', Bulletin: 'Schwarzes Brett', 'Abandoned Joja Mart': 'Joja-Markt' };

const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1] : null; };

function savesDir() { return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'StardewValley', 'Saves'); }

/** Neuester Spielstand (Ordner mit gleichnamiger Datei) oder der eingestellte. */
function findSave(preferred, dir = savesDir()) {
  if (preferred && fs.existsSync(preferred)) return preferred;
  let best = null;
  try {
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, d);
      try { const st = fs.statSync(f); if (!best || st.mtimeMs > best.t) best = { f, t: st.mtimeMs }; } catch { /* kein Spielstand */ }
    }
  } catch { return null; }
  return best?.f || null;
}

/** XML-Spielstand → Übersicht. */
function parseSave(xml) {
  const player = xml.match(/<player>([\s\S]*?)<\/player>/)?.[1] || '';
  const out = {
    farmer: tag(player, 'name'), farm: tag(player, 'farmName'), money: Number(tag(player, 'money') || 0),
    year: Number(tag(xml, 'year') || 1), season: tag(xml, 'currentSeason'), day: Number(tag(xml, 'dayOfMonth') || 1),
  };
  // Freundschaften: <friendshipData><item><key><string>Abigail</string></key><value><Friendship><Points>…
  const fd = player.match(/<friendshipData>([\s\S]*?)<\/friendshipData>/)?.[1] || '';
  out.friends = [...fd.matchAll(/<item>\s*<key>\s*<string>([^<]+)<\/string>\s*<\/key>\s*<value>\s*<Friendship>([\s\S]*?)<\/Friendship>/g)]
    .map(([, name, f]) => ({ name, points: Number(tag(f, 'Points') || 0), hearts: Math.floor(Number(tag(f, 'Points') || 0) / 250), status: tag(f, 'Status'), giftsThisWeek: Number(tag(f, 'GiftsThisWeek') || 0) }))
    .sort((a, b) => b.points - a.points);
  // Geburtstage aus den NPC-Einträgen des Spielstands
  const npcs = new Map();
  for (const m of xml.matchAll(/<NPC[^>]*>([\s\S]*?)<\/NPC>/g)) {
    const b = m[1]; const name = tag(b, 'name'); const s = tag(b, 'birthday_Season'); const d = Number(tag(b, 'birthday_Day') || 0);
    if (name && s && d && SEASONS.includes(s) && !npcs.has(name)) npcs.set(name, { name, season: s, day: d });
  }
  out.birthdays = [...npcs.values()];
  // Bündel: bundleData „Raum/ID“ → „Name/Belohnung/Items/Farbe/Anzahl“; Fortschritt im CommunityCenter-Eintrag
  const bd = xml.match(/<bundleData>([\s\S]*?)<\/bundleData>/)?.[1] || '';
  const defs = [...bd.matchAll(/<key>\s*<string>([^<]+)<\/string>\s*<\/key>\s*<value>\s*<string>([^<]*)<\/string>/g)].map(([, k, v]) => {
    const [room, idx] = k.split('/'); const parts = v.split('/');
    const items = (parts[2] || '').trim().split(/\s+/).filter(Boolean); const slots = Math.floor(items.length / 3);
    const need = parts[4] && /^\d+$/.test(parts[4]) ? Number(parts[4]) : slots;
    return { room, id: Number(idx), name: parts[0], slots, need };
  });
  const cc = xml.match(/xsi:type="CommunityCenter"[\s\S]*?<bundles>([\s\S]*?)<\/bundles>/)?.[1] || '';
  const prog = new Map([...cc.matchAll(/<key>\s*<int>(\d+)<\/int>\s*<\/key>\s*<value>\s*<ArrayOfBoolean>([\s\S]*?)<\/ArrayOfBoolean>/g)].map(([, id, arr]) => [Number(id), [...arr.matchAll(/<boolean>(true|false)<\/boolean>/g)].map((x) => x[1] === 'true')]));
  out.bundles = defs.map((d) => { const p = prog.get(d.id) || []; const done = p.slice(0, d.slots).filter(Boolean).length; return { ...d, roomDe: ROOMS_DE[d.room] || d.room, done: Math.min(done, d.need), complete: done >= d.need }; });
  return out;
}

/** Geburtstage in den nächsten n Tagen ab Spieldatum (Stardew: 4 Jahreszeiten à 28 Tage). */
function upcomingBirthdays(save, n = 7) {
  const idx = (s, d) => SEASONS.indexOf(s) * 28 + (d - 1);
  const today = idx(save.season, save.day);
  const friends = new Map(save.friends.map((f) => [f.name, f]));
  return save.birthdays.map((b) => ({ ...b, inDays: (idx(b.season, b.day) - today + 112) % 112, seasonDe: SEASON_DE[b.season], hearts: friends.get(b.name)?.hearts ?? null }))
    .filter((b) => b.inDays <= n).sort((a, b) => a.inDays - b.inDays);
}

class Stardew {
  constructor(s) { this.s = s; }
  read() {
    const f = findSave(this.s.settings.get('gaming')?.stardewSave || null);
    if (!f) return { found: false, dir: savesDir() };
    const save = parseSave(fs.readFileSync(f, 'utf8'));
    const st = fs.statSync(f);
    const bundles = save.bundles;
    return { found: true, file: f, savedAt: new Date(st.mtimeMs).toISOString(), ...save, seasonDe: SEASON_DE[save.season] || save.season,
      upcoming: upcomingBirthdays(save, 7), bundlesOpen: bundles.filter((b) => !b.complete), bundlesDone: bundles.filter((b) => b.complete).length, bundlesTotal: bundles.length };
  }
}

module.exports = { Stardew, parseSave, upcomingBirthdays, findSave, SEASON_DE };
