'use strict';
/**
 * AION 2 – Werkzeuge fürs Ingame-HUD (reine Rechnung, keine KI-Anfragen, keine Spieldateien):
 * - Feldbosse: Respawn ab Kill (Knopf „getötet“) → Countdown als Spiel-Timer (erscheint im Overlay).
 * - Feste Events (Kaira, Artefakt-Belagerung, Executors) in Serverzeit der Region → nächste Termine.
 * - Daily-/Weekly-Tracker, der sich beim Reset selbst zurücksetzt (Reset-Uhrzeit einstellbar).
 * - Regeneration (Odyle-Energie, Belohnungszähler): Zeit bis voll.
 * - Upgrade-Rechner (Erfolgschance → erwartete Versuche/Kosten) und Crafting-Rechner (Materialliste).
 *
 * Startdaten: Community-Stand Oktober 2026 (u. a. aion2atlas.app, metabot.gg). Alles ist änderbar –
 * Respawn-Zeiten und Kontingente können sich mit Patches ändern. Kein Bezug zu NCSOFT.
 */
const { zonedToUtc } = require('../ics');
const { nowIso } = require('../../core/util');

const GAME = 'aion2';
const SOURCE = 'Community-Stand 10/2026 (aion2atlas.app, metabot.gg) – änderbar';
const REGIONS = { eu: { label: 'Europa', tz: 'Europe/Berlin' }, 'na-east': { label: 'NA Ost', tz: 'America/New_York' }, 'na-west': { label: 'NA West', tz: 'America/Los_Angeles' } };

// Feldbosse: [Name, Gebiet, Ort, Respawn in Minuten] – Respawn beginnt mit dem Kill
const FIELD_BOSSES = [
  ['Black Warrior Aed', 'Altgard', 'Nameless Graveyard', 30], ['Faithful Rajit', 'Altgard', 'Sanctuary Watch Post', 30], ['Kernon of the West', 'Verteron', 'Cantas Valley', 30],
  ['Melted Danar', 'Altgard', 'Dredgion Crash Site', 30], ['Neikel of the East', 'Verteron', 'Cantas Valley', 30], ['Rotten Kutar', 'Verteron', 'Elun River Swamp', 30],
  ['Berserker Vargor', 'Altgard', 'Sanctuary Watch Post', 60], ['Blooming Korin', 'Verteron', 'Elun River Midstream', 60],
  ['Blood Warrior Lannar', 'Altgard', 'Moslan Forest', 90], ['Bodyguard Teegant', 'Verteron', 'Fortress Ruins', 90],
  ['Blue Wave Kelpina', 'Altgard', 'Forest of Purification', 120], ['Chaser Taulo', 'Verteron', 'Aulau Village', 120], ['Deceiver Trid', 'Altgard', 'Urtumheim', 120],
  ['High Overseer Nutah', 'Altgard', 'Dranactus', 120], ['Kusan the Mad Gladiator', 'Verteron', 'Fortress Ruins', 120], ['Predator Garsan', 'Altgard', 'Moslan Forest', 120],
  ['Ritualist Garshim', 'Verteron', 'Fortress Ruins', 120], ['Scholar Aulla', 'Verteron', 'Aulau Village', 120],
  ['Addicted Hardirun', 'Altgard', 'Pafnite Burial Ground', 180], ['Advisor Resana', 'Altgard', 'Dranactus', 180], ['Bloodfang Pnyn', 'Verteron', 'Tolbas Forest', 180],
  ['Furious Saursus', 'Verteron', 'Tolbas Forest', 180], ['Harvest Manager Moshav', 'Verteron', 'Drana Plantation', 180], ['Heretic Layla', 'Verteron', 'Artamia Plateau', 180],
  ['Special Operations Leader Linx', 'Altgard', 'Basfelt Ruins', 180], ['Veteran Shujakan', 'Altgard', 'Black Claw Village', 180],
  ['Black Tentacle Lawa', 'Verteron', 'Artamia Gorge', 240], ['Centurion Demiros', 'Verteron', 'Artamia Plateau', 240], ['Desecrator Newbold', 'Altgard', 'Basfelt Ruins', 240],
  ['Executioner Barthien', 'Altgard', 'Gribade Canyon West', 240], ['Forest Warrior Aullamu', 'Verteron', 'Aulau Village', 240], ['Sentinel K\'nash', 'Verteron', 'Drana Plantation', 240],
  ['Specter Archon Axios', 'Altgard', 'Basfelt Ruins', 240], ['Visionary Karuka', 'Altgard', 'Black Claw Village', 240],
  ['Dark Shadow Vishwada', 'Altgard', 'Ragta Fortress', 360], ['Divine Ansas', 'Verteron', 'Artamia Plateau', 360], ['Drakan Battalion Weapon Guruta', 'Altgard', 'Gribade Canyon East', 360],
  ['Phantasm Kasia', 'Verteron', 'Garden of the Illusion God', 360], ['Researcher Setram', 'Verteron', 'Nahid Legion Fortress', 360], ['Sharp Shylak', 'Altgard', 'Impetusium Plaza', 360],
  ['Silent Dartan', 'Verteron', 'Artamia Plateau South', 360], ['Silent Dartan', 'Altgard', 'Forest of Purification', 360],
  ['Soul Ruler Kashapa', 'Verteron', 'Artamia Plateau East', 360], ['Soul Ruler Kashapa', 'Altgard', 'Pafnite Burial Ground', 360],
  ['Argo, the Spirit King', 'Abyss', 'Siel\'s Right Wing', 720], ['Eternal Gartua', 'Verteron', 'Isle of Eternity', 720], ['High Commander Lagta', 'Verteron', 'Red Forest', 720],
  ['High Commander Lagta', 'Altgard', 'Ragta Fortress', 720], ['Immortal Gartua', 'Altgard', 'Isle of Immortality', 720],
].map(([name, zone, area, respawn]) => ({ id: (name + '@' + zone).toLowerCase().replace(/[^a-z0-9@]+/g, '-'), name, zone, area, respawn }));

// Feste Events (Serverzeit der Region): every = Intervall ab Startzeit, days = Wochentage (0 = So)
const EVENTS = [
  { id: 'kaira', name: 'Watcher Kaira (Weltboss)', where: 'Lower Reshanta · Black Fragments', every: 180, start: '01:00', durationMin: 30 },
  { id: 'siege', name: 'Artefakt-Belagerung', where: 'Lower Reshanta · drei Artefakt-Punkte', days: [1, 4, 6], at: '21:00', durationMin: 30, pvp: true },
  { id: 'executors', name: 'Executors Argo, Kaira, Tamasa', where: 'Lower Reshanta', days: [1, 4, 6], at: '21:30', durationMin: 30 },
];

// Daily/Weekly (Kontingente laut Community-Stand; eigene Einträge möglich)
const DEFAULT_TASKS = [
  { id: 'duty', label: 'Duty Missions (5/Tag)', period: 'daily' },
  { id: 'nightmare', label: 'Nightmare (2 Versuche/Tag)', period: 'daily' },
  { id: 'shugo', label: 'Shugo-Festival-Schlüssel (3/Tag)', period: 'daily' },
  { id: 'invasion', label: 'Dimensional-Invasion-Schlüssel (1/Tag)', period: 'daily' },
  { id: 'rift', label: 'Spacetime Rift (alle 3 h, optional)', period: 'daily' },
  { id: 'raids', label: 'Raids (4 Versuche je Raid)', period: 'weekly' },
  { id: 'ascension', label: 'Ascension Trial (3 Einträge)', period: 'weekly' },
  { id: 'subjugation', label: 'Subjugation-Tickets (3)', period: 'weekly' },
  { id: 'fissure', label: 'Unknown Fissure (14 Einträge)', period: 'weekly' },
  { id: 'abyss', label: 'Abyss-Zeit (7 h je Ebene)', period: 'weekly' },
  { id: 'pass', label: 'Daeva Pass – Wochen-EXP', period: 'weekly' },
];

// Regeneration: amount pro everyMin, Obergrenze cap
const REGEN = {
  odyle: { label: 'Odyle-Energie', amount: 15, everyMin: 180, cap: 560 },
  conquest: { label: 'Conquest-Belohnungen', amount: 1, everyMin: 480, cap: 21 },
  transcendence: { label: 'Transcendence-Belohnungen', amount: 1, everyMin: 720, cap: 14 },
  nightmare: { label: 'Nightmare-Versuche', amount: 2, everyMin: 1440, cap: 14 },
  shugo: { label: 'Shugo-Schlüssel', amount: 3, everyMin: 1440, cap: 12 },
};

const hm = (s) => s.split(':').map(Number);
function wallParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
/** Zeitpunkt „Tag + offset, hh:mm Serverzeit“ als Date. */
function at(base, dayOffset, h, mi, tz) { return new Date(zonedToUtc(base.y, base.mo, base.d + dayOffset, h, mi, 0, tz)); }

class Aion2 {
  constructor(s) { this.s = s; }
  cfg() { return { region: 'eu', resetTime: '05:00', weeklyDay: 3, ...(this.s.settings.get('gaming')?.aion2 || {}) }; }
  tz() { return (REGIONS[this.cfg().region] || REGIONS.eu).tz; }
  get(key, def) { try { return JSON.parse(this.s.gaming.context.getState('aion2:' + key) || 'null') ?? def; } catch { return def; } }
  put(key, v) { this.s.gaming.context.setState('aion2:' + key, v); this.s.bus.emit('game:data', { game: GAME }); }

  // ---------- Feste Events ----------
  /** Nächste Termine aller festen Events (bis 8 Tage voraus), laufende zuerst. */
  events(now = new Date()) {
    const tz = this.tz(); const base = wallParts(now, tz); const out = [];
    for (const e of EVENTS) {
      const times = [];
      for (let d = -1; d <= 8 && times.length < 3; d++) {
        if (e.every) {
          const [sh, sm] = hm(e.start);
          for (let m = sh * 60 + sm; m < 1440; m += e.every) { const t = at(base, d, Math.floor(m / 60), m % 60, tz); if (t.getTime() + e.durationMin * 60000 > now.getTime()) times.push(t); }
        } else {
          const t0 = at(base, d, ...hm(e.at), tz); const wd = wallParts(t0, tz).wd;
          if (e.days.includes(wd) && t0.getTime() + e.durationMin * 60000 > now.getTime()) times.push(t0);
        }
      }
      const next = times.sort((a, b) => a - b)[0];
      if (next) out.push({ id: e.id, name: e.name, where: e.where, pvp: !!e.pvp, start: next.toISOString(), end: new Date(next.getTime() + e.durationMin * 60000).toISOString(), running: next <= now, following: times[1]?.toISOString() || null });
    }
    return { region: this.cfg().region, regionLabel: (REGIONS[this.cfg().region] || REGIONS.eu).label, events: out.sort((a, b) => (b.running - a.running) || a.start.localeCompare(b.start)), source: SOURCE };
  }

  // ---------- Feldbosse ----------
  bossList() {
    const own = this.get('bossEdits', {}); // { id: respawnMin } eigene Korrekturen
    return FIELD_BOSSES.map((b) => ({ ...b, respawn: Number(own[b.id]) || b.respawn, edited: !!own[b.id] }));
  }
  bosses({ query = '', zone = '' } = {}, now = Date.now()) {
    const kills = this.get('kills', {});
    const q = String(query).toLowerCase();
    const list = this.bossList().filter((b) => (!zone || b.zone === zone) && (!q || (b.name + ' ' + b.area + ' ' + b.zone).toLowerCase().includes(q))).map((b) => {
      const k = kills[b.id]; const next = k ? Date.parse(k) + b.respawn * 60000 : null;
      return { ...b, lastKill: k || null, nextSpawn: next ? new Date(next).toISOString() : null, up: next ? next <= now : null };
    });
    // Zuerst: bald fällig, dann bekannte, dann der Rest
    list.sort((a, b) => (a.nextSpawn && b.nextSpawn ? a.nextSpawn.localeCompare(b.nextSpawn) : a.nextSpawn ? -1 : b.nextSpawn ? 1 : a.respawn - b.respawn || a.name.localeCompare(b.name)));
    return { bosses: list, zones: [...new Set(FIELD_BOSSES.map((b) => b.zone))], source: SOURCE };
  }
  /** Boss getötet (jetzt oder vor x Minuten) → Respawn-Countdown als Spiel-Timer (Overlay). */
  killed(bossId, { minutesAgo = 0 } = {}) {
    const b = this.bossList().find((x) => x.id === bossId);
    if (!b) throw new Error('Boss unbekannt');
    const at = new Date(Date.now() - Math.max(0, Number(minutesAgo) || 0) * 60000);
    const kills = this.get('kills', {}); kills[b.id] = at.toISOString(); this.put('kills', kills);
    const ends = new Date(at.getTime() + b.respawn * 60000);
    const G = this.s.gaming;
    for (const t of G.timers({ game: GAME })) if (t.note === 'boss:' + b.id && !t.fired) G.removeTimer?.(t.id);
    if (ends > new Date()) G.addTimer({ game: GAME, label: `${b.name} (${b.zone})`, kind: 'event', endsAt: ends.toISOString(), note: 'boss:' + b.id });
    return { ...b, lastKill: at.toISOString(), nextSpawn: ends.toISOString() };
  }
  clearKill(bossId) { const kills = this.get('kills', {}); delete kills[bossId]; this.put('kills', kills); return true; }
  /** Respawn-Zeit eines Bosses korrigieren (Patch geändert) – null setzt den Community-Wert zurück. */
  setRespawn(bossId, minutes) {
    if (!FIELD_BOSSES.some((b) => b.id === bossId)) throw new Error('Boss unbekannt');
    const own = this.get('bossEdits', {});
    if (minutes == null || minutes === '') delete own[bossId]; else own[bossId] = Math.max(5, Math.min(7 * 1440, Math.round(Number(minutes))));
    this.put('bossEdits', own); return this.bossList().find((b) => b.id === bossId);
  }

  // ---------- Daily / Weekly ----------
  /** Letzter Reset (täglich bzw. wöchentlich) vor now in Serverzeit. */
  lastReset(period, now = new Date()) {
    const c = this.cfg(); const tz = this.tz(); const base = wallParts(now, tz); const [h, m] = hm(c.resetTime || '05:00');
    let t = at(base, 0, h, m, tz);
    if (t > now) t = at(base, -1, h, m, tz);
    if (period === 'weekly') { for (let i = 0; i < 8 && wallParts(t, tz).wd !== Number(c.weeklyDay ?? 3); i++) t = at(wallParts(t, tz), -1, h, m, tz); }
    return t;
  }
  nextReset(period, now = new Date()) {
    const last = this.lastReset(period, now); const tz = this.tz(); const [h, m] = hm(this.cfg().resetTime || '05:00');
    return at(wallParts(last, tz), period === 'weekly' ? 7 : 1, h, m, tz);
  }
  tasks(now = new Date()) {
    const items = this.get('tasks', null) || DEFAULT_TASKS;
    const done = this.get('done', {});
    const out = items.map((t) => { const d = done[t.id]; const valid = d && Date.parse(d) >= this.lastReset(t.period, now).getTime(); return { ...t, done: !!valid }; });
    return { tasks: out, nextDaily: this.nextReset('daily', now).toISOString(), nextWeekly: this.nextReset('weekly', now).toISOString(), resetTime: this.cfg().resetTime, weeklyDay: this.cfg().weeklyDay, region: this.cfg().region, source: SOURCE };
  }
  toggleTask(taskId, value = true) {
    const done = this.get('done', {});
    if (value) done[taskId] = nowIso(); else delete done[taskId];
    this.put('done', done); return this.tasks();
  }
  addTask({ label, period = 'daily' }) {
    const l = String(label || '').trim().slice(0, 80); if (!l) throw new Error('Bezeichnung fehlt');
    if (!['daily', 'weekly'].includes(period)) throw new Error('daily oder weekly');
    const items = this.get('tasks', null) || [...DEFAULT_TASKS];
    items.push({ id: 'own-' + Date.now().toString(36), label: l, period }); this.put('tasks', items); return this.tasks();
  }
  removeTask(taskId) { const items = (this.get('tasks', null) || [...DEFAULT_TASKS]).filter((t) => t.id !== taskId); this.put('tasks', items); return this.tasks(); }
  /** Reset-Uhrzeit aus dem Ingame-Countdown („Daily recharge in 7:12“) übernehmen. */
  resetFromCountdown(countdown, now = new Date()) {
    const m = String(countdown || '').match(/(\d{1,2})\s*[:h]\s*(\d{1,2})/); if (!m) throw new Error('Countdown wie 7:12 eingeben');
    const t = new Date(now.getTime() + (Number(m[1]) * 60 + Number(m[2])) * 60000);
    const p = wallParts(t, this.tz()); const mins = Math.round((p.h * 60 + p.mi) / 5) * 5;
    const resetTime = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    this.s.settings.update({ gaming: { aion2: { ...this.cfg(), resetTime } } });
    return this.tasks(now);
  }

  // ---------- Rechner ----------
  /** Regeneration: aktueller Wert → Zeit bis voll (bzw. bis Zielwert). */
  regen(kind, current, { target = null, now = Date.now() } = {}) {
    const r = REGEN[kind]; if (!r) throw new Error('Unbekannte Ressource');
    const cur = Math.max(0, Number(current) || 0); const goal = Math.min(r.cap, target == null ? r.cap : Number(target));
    const steps = Math.max(0, Math.ceil((goal - cur) / r.amount));
    const minutes = steps * r.everyMin; // ohne Restzeit des laufenden Intervalls → obere Schätzung
    return { kind, label: r.label, current: cur, target: goal, cap: r.cap, minutes, at: new Date(now + minutes * 60000).toISOString(), full: cur >= r.cap, note: 'Ohne die Restzeit des laufenden Intervalls (höchstens so lange).' };
  }
  regenKinds() { return Object.entries(REGEN).map(([id, r]) => ({ id, ...r })); }

  /** Upgrade: Chance in %, Kosten pro Versuch → erwartete Versuche/Kosten, 50/90/99-%-Grenzen. */
  upgrade({ chance, costPerTry = 0, budgetTries = null }) {
    const p = Number(chance) / 100;
    if (!(p > 0 && p <= 1)) throw new Error('Erfolgschance in % (größer 0, höchstens 100)');
    const triesFor = (q) => (p >= 1 ? 1 : Math.ceil(Math.log(1 - q) / Math.log(1 - p)));
    const expTries = 1 / p; const c = Math.max(0, Number(costPerTry) || 0);
    return { chance: Math.round(p * 1000) / 10, expectedTries: Math.round(expTries * 10) / 10, expectedCost: Math.round(expTries * c),
      tries50: triesFor(0.5), tries90: triesFor(0.9), tries99: triesFor(0.99), cost90: triesFor(0.9) * c,
      withinBudget: budgetTries ? Math.round((1 - (1 - p) ** Number(budgetTries)) * 1000) / 10 : null };
  }
  /** Crafting: Materialien (Menge × Preis) × Anzahl → Gesamtkosten; Rezepte speicherbar. */
  craft({ materials = [], count = 1, sellPrice = null }) {
    const n = Math.max(1, Math.floor(Number(count) || 1));
    const rows = materials.filter((m) => m && m.name).map((m) => ({ name: String(m.name).slice(0, 60), qty: Math.max(0, Number(m.qty) || 0), price: Math.max(0, Number(m.price) || 0) }))
      .map((m) => ({ ...m, need: m.qty * n, cost: m.qty * n * m.price }));
    const total = rows.reduce((a, m) => a + m.cost, 0);
    return { count: n, rows, total, perItem: Math.round(total / n), profit: sellPrice != null ? Math.round(Number(sellPrice) * n - total) : null };
  }
  recipes() { return this.get('recipes', []); }
  saveRecipe({ name, materials, sellPrice = null }) {
    const nm = String(name || '').trim().slice(0, 60); if (!nm) throw new Error('Name fehlt');
    const list = this.recipes().filter((r) => r.name !== nm); list.push({ name: nm, materials: (materials || []).slice(0, 20), sellPrice }); this.put('recipes', list.slice(-40)); return list;
  }
  removeRecipe(name) { const list = this.recipes().filter((r) => r.name !== name); this.put('recipes', list); return list; }
}

module.exports = { Aion2, FIELD_BOSSES, EVENTS, DEFAULT_TASKS, REGEN, REGIONS };
