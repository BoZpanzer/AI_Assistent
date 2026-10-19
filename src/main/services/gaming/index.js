'use strict';
const { kitLayout } = require('./kits');
const fs = require('node:fs');
const path = require('node:path');
const { id, nowIso, safeJson, truncate } = require('../../core/util');
const { validate } = require('../../core/validate');
const { GameContext } = require('./context');
const { GameCache } = require('./cache');
const { Tarkov, exitKind } = require('./tarkov');
const { TarkovMaps } = require('./tarkovmaps');
const { League } = require('./league');
const { Wiki } = require('./wiki');
const { GameProgress } = require('./progress');
const { GameReview } = require('./review');

/**
 * Widget registry. The orchestrator may only pick from these types; params are
 * validated; the renderer has a fixed component per type. No model-generated
 * HTML/JS is ever rendered.
 */
const WIDGETS = {
  'game-research': { title: 'Recherche', params: { query: { type: 'string', maxLength: 300 } } },
  'wiki': { title: 'Wiki', params: { query: { type: 'string', maxLength: 200 }, page: { type: 'string', maxLength: 200 } } },
  'notes': { title: 'Eigene Notizen', params: {} },
  'timers': { title: 'Timer', params: { kinds: { type: 'array', items: { type: 'string' } } } },
  'map': { title: 'Interaktive Karte', params: { map: { type: 'string', maxLength: 60 } } },
  'checklist': { title: 'Checkliste', params: { name: { type: 'string', maxLength: 60 } } },
  'sources': { title: 'Gespeicherte Quellen', params: {} },
  'other-games': { title: 'Andere Spiele – Benachrichtigungen', params: {} },
  'tarkov-raid': { title: 'Raid-Status & Hilfe', params: { map: { type: 'string', maxLength: 60 }, tab: { type: 'string', enum: ['overview', 'exits', 'quests', 'keys', 'bosses'] } } },
  'tarkov-quests': { title: 'Quest-Informationen', params: { map: { type: 'string', maxLength: 60 }, query: { type: 'string', maxLength: 120 } } },
  'tarkov-raidplan': { title: 'Raid-Planer', params: { map: { type: 'string', maxLength: 60 } } },
  'tarkov-companion': { title: 'Raid-Begleiter', params: {} },
  'tarkov-needed': { title: 'Benötigte Items', params: { kappaOnly: { type: 'boolean' } } },
  'tarkov-hideout': { title: 'Hideout', params: {} },
  'tarkov-item': { title: 'Item-Details', params: { query: { type: 'string', maxLength: 120 }, keysOnly: { type: 'boolean' } } },
  'lol-overview': { title: 'Performance', params: {} },
  'lol-champions': { title: 'Champions & Rollen', params: {} },
  'lol-matches': { title: 'Letzte Spiele', params: {} },
  'lol-coaching': { title: 'Coaching & Insights', params: {} },
  'lol-live': { title: 'Live-Match', params: {} },
  'lol-champion': { title: 'Championinfo', params: { champion: { type: 'string', maxLength: 40 } } },
  'lol-goals': { title: 'Trainingsziele', params: {} },
  'rok-planner': { title: 'Entwicklungsplanung', params: {} },
  'lol-champselect': { title: 'Championauswahl', params: {} },
  'lol-review': { title: 'Nachbesprechung', params: {} },
  'lol-mistakes': { title: 'Fehleranalyse', params: {} },
  'lol-game': { title: 'Spielanalyse', params: { matchId: { type: 'string', maxLength: 40 } } },
  playtime: { title: 'Spielzeit & Session-Log', params: {} },
  news: { title: 'Patch-Notes', params: {} },
  servers: { title: 'Server-Status', params: {} },
  deals: { title: 'Wunschliste im Angebot', params: {} },
  'rok-speedups': { title: 'Speedup-Rechner', params: {} },
  'ark-breeding': { title: 'Zucht & Prägung', params: {} },
  'cs2-matches': { title: 'Match-Nachbesprechung', params: {} },
  'racing-laps': { title: 'Rundenanalyse', params: {} },
  'pubg-matches': { title: 'Match-Nachbesprechung', params: {} },
  'stardew-farm': { title: 'Mein Hof', params: {} },
  'wiki-lists': { title: 'Checklisten aus dem Wiki', params: {} },
  'tarkov-economy': { title: 'Händler, Crafts & Tausch', params: {} },
  'lol-progress': { title: 'Rang-Verlauf & Champion-Pool', params: {} },
  'tarkov-ammo': { title: 'Munition', params: { caliber: { type: 'string', maxLength: 30 } } },
  'game-stats': { title: 'Statistiken', params: { period: { type: 'string', enum: ['session', 'today', 'total'] } } },
  'factorio-calc': { title: 'Verhältnis-Rechner', params: {} },
  'lol-coach': { title: 'Wochenbericht & Session', params: {} },
  progress: { title: 'Mein Spielstand', params: { category: { type: 'string', maxLength: 30 } } },
  ask: { title: 'Frag JARVIS', params: {} },
  links: { title: 'Tools & Links', params: {} },
};

/** Neue Widgets je Spiel – kommen automatisch dazu (eigene Layouts: einmalig, danach entscheidest du). */
// Game-specific existing widgets: reuse supported functionality instead of creating empty placeholders.
const GAME_EXTRAS = Object.freeze({
  ark: ['ark-breeding'], ark_asa: ['ark-breeding'],
  cs2: ['cs2-matches'], pubg: ['pubg-matches'],
  assettocorsa: ['racing-laps'], raceroom: ['racing-laps'], mxbikes: ['racing-laps'],
  stardew: ['stardew-farm'], factorio: ['factorio-calc'],
});
const SERVER_GAMES = new Set(['minecraft', 'arma3', 'rust', 'ark', 'ark_asa', 'palworld', 'cs2', 'sandstorm', 'pixark', 'hytale', 'terraria', 'theforest']);
function extrasFor(p) {
  if (p.integration === 'league') return ['game-stats', 'lol-game', 'lol-coach', 'lol-progress', 'playtime', 'news'];
  if (p.integration === 'tarkov') return ['game-stats', 'tarkov-economy', 'tarkov-ammo', 'playtime'];
  if (p.integration === 'rok') return ['rok-speedups', 'playtime'];
  return [...(GAME_EXTRAS[p.id] || []), 'wiki-lists', 'playtime',
    ...(p.steamAppId ? ['news'] : []),
    ...(SERVER_GAMES.has(p.id) ? ['servers'] : []),
    ...(p.steamAppId ? ['deals'] : [])];
}
const LAYOUTS = {
  tarkov: [{ type: 'map' }, { type: 'tarkov-raidplan' }, { type: 'tarkov-companion' }, { type: 'tarkov-needed' }, { type: 'tarkov-hideout' }, { type: 'tarkov-raid' }, { type: 'tarkov-quests' }, { type: 'progress' }, { type: 'tarkov-item', params: { keysOnly: true } }, { type: 'checklist', params: { name: 'Raid-Checkliste' } }, { type: 'other-games' }],
  league: [{ type: 'lol-overview' }, { type: 'lol-champselect' }, { type: 'lol-review' }, { type: 'lol-game' }, { type: 'lol-mistakes' }, { type: 'lol-coach' }, { type: 'lol-champions' }, { type: 'lol-matches' }, { type: 'lol-coaching' }, { type: 'lol-live' }, { type: 'lol-goals' }, { type: 'other-games' }],
  rok: [{ type: 'progress' }, { type: 'timers', params: { kinds: ['build', 'research', 'training', 'custom'] } }, { type: 'rok-planner' }, { type: 'game-research', params: { query: '' } }, { type: 'notes' }, { type: 'sources' }, { type: 'other-games' }],
  generic: [{ type: 'ask' }, { type: 'progress' }, { type: 'game-research', params: { query: '' } }, { type: 'wiki' }, { type: 'notes' }, { type: 'timers' }, { type: 'sources' }, { type: 'other-games' }],
};

const TIMER_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  game: { type: 'string', maxLength: 80 }, label: { type: 'string', minLength: 1, maxLength: 120 },
  kind: { type: 'string', enum: ['build', 'research', 'training', 'taming', 'breeding', 'crafting', 'event', 'custom'] },
  minutes: { type: 'number', minimum: 0.1, maximum: 60 * 24 * 60 }, endsAt: { type: 'string', format: 'date-time' }, note: { type: 'string', maxLength: 300 },
  repeatMinutes: { type: 'number', minimum: 5, maximum: 60 * 24 * 31 }, until: { type: 'string', format: 'date-time' }, series: { type: 'string', maxLength: 40 } } };

class Gaming {
  constructor(ctx) {
    this.db = ctx.db; this.bus = ctx.bus; this.settings = ctx.settings; this.gemini = ctx.gemini; this.platformCapture = () => ctx.platform?.captureAroundCursor?.(); this.notifications = ctx.notifications; this.brain = ctx.brain; this.web = ctx.web;
    this.dataDir = ctx.paths.data;
    this.cache = new GameCache(ctx.db);
    const sub = { ...ctx, gameCache: this.cache };
    this.context = new GameContext(sub);
    this.tarkov = new Tarkov(sub);
    this.tarkovMaps = new TarkovMaps(this, sub);
    this.league = new League(sub);
    this.wiki = new Wiki(sub);
    this.progress = new GameProgress(sub);
    this.review = new GameReview(this);
    this.focus = null; // contextual widget pushed by the orchestrator
  }

  // ----- layout -----
  layout(gid) {
    const p = this.context.profile(gid);
    if (!p) return null;
    const base = LAYOUTS[p.integration] || LAYOUTS.generic;
    let custom = safeJson(this.context.getState('layout:' + gid), null);
    const extras = extrasFor(p);
    // Neue Widgets einmalig auch in eigene Layouts aufnehmen (danach entscheidet der Nutzer selbst)
    if (custom) {
      const seen = safeJson(this.context.getState('layout:added:' + gid), []) || [];
      const add = extras.filter((t) => !seen.includes(t));
      if (add.length) {
        custom = [...custom, ...add.filter((t) => !custom.some((w) => w.type === t)).map((type) => ({ type }))];
        this.context.setState('layout:' + gid, custom); this.context.setState('layout:added:' + gid, [...seen, ...add]);
      }
    }
    let widgets = (custom || (p.designWidgets && p.integration === 'generic' ? p.designWidgets : p.kit && p.integration === 'generic' ? kitLayout(p) : base)).map((w) => ({ ...w, params: w.params || {} }));
    // Selbst angelegte Checklisten (aus dem Wiki) immer anzeigen
    for (const name of safeJson(this.context.getState('checklists:' + gid), []) || []) if (!widgets.some((w) => w.type === 'checklist' && w.params?.name === name)) widgets.push({ type: 'checklist', params: { name } });
    if (!custom) {
      const missing = extras.filter((t) => !widgets.some((w) => w.type === t)).map((type) => ({ type, params: {} }));
      const at = widgets.findIndex((w) => w.type === 'other-games');
      if (missing.length) widgets = at >= 0 ? [...widgets.slice(0, at), ...missing, ...widgets.slice(at)] : [...widgets, ...missing];
    }
    if (p.integration === 'generic') {
      if (!p.wiki) widgets = widgets.filter(w => w.type !== 'wiki');
      if (!(p.links || []).length && !p.schedule) widgets = widgets.filter(w => w.type !== 'links');
      // Generic layouts must not expose specialist widgets from unrelated games.
      const specialist = new Set(['ark-breeding', 'cs2-matches', 'pubg-matches', 'racing-laps', 'stardew-farm', 'factorio-calc']);
      const allowed = new Set(GAME_EXTRAS[p.id] || []);
      widgets = widgets.filter(w => !specialist.has(w.type) || allowed.has(w.type));
    }
    const focus = this.focus && this.focus.game === gid ? this.focus : null;
    return { game: p, widgets, focus, widgetTitles: Object.fromEntries(Object.entries(WIDGETS).map(([k, v]) => [k, v.title])) };
  }

  /** Validated widget request (from orchestrator or UI). */
  pushWidget(gid, type, params = {}) {
    const def = WIDGETS[type];
    if (!def) throw new Error('Unbekanntes Widget: ' + type);
    const p = this.context.profile(gid);
    if (!p) throw new Error('Unbekanntes Spiel');
    if (type.startsWith('tarkov-') && p.integration !== 'tarkov') throw new Error('Widget passt nicht zum Spiel');
    if (type.startsWith('lol-') && p.integration !== 'league') throw new Error('Widget passt nicht zum Spiel');
    const specialist = new Set(['ark-breeding', 'cs2-matches', 'pubg-matches', 'racing-laps', 'stardew-farm', 'factorio-calc']);
    if (specialist.has(type) && !(GAME_EXTRAS[p.id] || []).includes(type)) throw new Error('Widget passt nicht zum Spiel');
    const v = validate({ type: 'object', additionalProperties: false, properties: def.params }, params);
    if (!v.ok) throw new Error(v.errors.join('; '));
    this.focus = { game: gid, type, params: v.value, at: nowIso() };
    this.bus.emit('game:focus', this.focus);
    return this.focus;
  }

  // ----- timers (estimates — never presented as verified game state) -----
  addTimer(input) {
    const v = validate(TIMER_SCHEMA, input);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    const prof = this.context.resolve(d.game || '') || null;
    if (!prof) throw new Error('Spiel unbekannt');
    const ends = d.endsAt ? new Date(d.endsAt) : new Date(Date.now() + (d.minutes || 0) * 60000);
    if (isNaN(ends) || ends <= new Date()) throw new Error('Timer-Ende liegt in der Vergangenheit');
    const tid = id('tm');
    const until = d.until ? new Date(d.until) : null;
    if (until && isNaN(until)) throw new Error('until ungültig');
    this.db.run('INSERT INTO game_timers(id,game,label,kind,ends_at,created_at,note,repeat_min,until,series) VALUES(?,?,?,?,?,?,?,?,?,?)', tid, prof.id, d.label, d.kind || 'custom', ends.toISOString(), nowIso(), d.note || '',
      d.repeatMinutes ? Math.round(d.repeatMinutes) : null, until ? until.toISOString() : null, d.series || (d.repeatMinutes ? id('ts') : null));
    this.bus.emit('game:timers', {});
    return this.timer(tid);
  }
  timer(tid) { const r = this.db.get('SELECT * FROM game_timers WHERE id=?', tid); return r ? this.timerPublic(r) : null; }
  timerPublic(r) {
    const p = this.context.profile(r.game);
    return { id: r.id, game: r.game, gameName: p?.name || r.game, label: r.label, kind: r.kind, endsAt: r.ends_at, createdAt: r.created_at, fired: !!r.fired, note: r.note, origin: 'timer', estimate: true, repeatMin: r.repeat_min || null, until: r.until || null, series: r.series || null };
  }
  timers({ game, includeFired = false } = {}) {
    let sql = 'SELECT * FROM game_timers WHERE 1=1'; const p = [];
    if (game) { sql += ' AND game=?'; p.push(game); }
    if (!includeFired) sql += ' AND (fired=0 OR ends_at>?)', p.push(new Date(Date.now() - 6 * 3600000).toISOString());
    sql += ' ORDER BY fired, ends_at LIMIT 100';
    return this.db.all(sql, ...p).map((r) => this.timerPublic(r));
  }
  /** Alle offenen Timer einer Serie entfernen (z. B. Prägung neu takten). */
  removeSeries(series) { const n = this.db.run('DELETE FROM game_timers WHERE series=? AND fired=0', series); this.bus.emit('game:timers', {}); return n; }
  removeTimer(tid) { const t = this.timer(tid); this.db.run('DELETE FROM game_timers WHERE id=?', tid); this.bus.emit('game:timers', {}); return t; }

  /** Fire due timers → notification ("estimated", not verified game state). */
  checkTimers(now = new Date()) {
    const nick = this.settings.get('nickname') || 'Chef';
    const due = this.db.all('SELECT * FROM game_timers WHERE fired=0 AND ends_at<=?', now.toISOString());
    for (const r of due) {
      this.db.run('UPDATE game_timers SET fired=1 WHERE id=?', r.id);
      // Wiederkehrend: nächsten Termin anlegen (verpasste überspringen), bis „until“
      if (r.repeat_min) {
        let next = Date.parse(r.ends_at) + r.repeat_min * 60000;
        while (next <= now.getTime()) next += r.repeat_min * 60000;
        if (!r.until || next <= Date.parse(r.until)) this.db.run('INSERT INTO game_timers(id,game,label,kind,ends_at,created_at,note,repeat_min,until,series) VALUES(?,?,?,?,?,?,?,?,?,?)', id('tm'), r.game, r.label, r.kind, new Date(next).toISOString(), nowIso(), r.note || '', r.repeat_min, r.until, r.series);
      }
      const p = this.context.profile(r.game);
      this.notifications.push({ category: 'gaming', origin: 'timer', game: r.game, dedupeKey: 'timer:' + r.id,
        title: `${p?.short || p?.name || r.game}: ${r.label}`,
        body: `${nick}, dein ${r.label}-Timer ist abgelaufen. (Gespeicherter Timer – kein bestätigter Spielstatus.)` });
    }
    if (due.length) this.bus.emit('game:timers', {});
    return due.length;
  }

  /** Tarkov-Fortschritt für Planer/Questziele: erledigte/fehlgeschlagene Quests, Level, Spielmodus. */
  eftProgress() {
    const items = this.progress.list('eft');
    const names = (st) => new Set(items.filter((x) => x.category === 'quest' && x.status === st).map((x) => x.name));
    const lvl = Number(this.tracker?.status?.level ?? String(items.find((x) => /(pmc[- ]?)?level/i.test(x.name))?.value || '').match(/\d+/)?.[0]);
    return { done: names('done'), failed: names('failed'), level: Number.isFinite(lvl) && lvl > 0 ? lvl : null, gameMode: this.tracker?.tdMode?.() || 'regular' };
  }

  /**
   * Eigene Position in Tarkov (aus einem Screenshot-Dateinamen). Mit tarkov.dev-Karte (affine Kalibrierung)
   * werden auch Bildkoordinaten 0..1 und der Blickwinkel auf dem Bild mitgeschickt (für Karte und Overlay).
   */
  setEftPosition({ x, y, z, fx = 0, fz = 1, map }) {
    const pos = { x, y, z, fx, fz, map: map || null, at: nowIso() };
    if (map) {
      const cal = safeJson(this.context.getState(`calib:eft:${map}`), null);
      const af = cal?.affine;
      if (Array.isArray(af) && af.length === 6) {
        const n = (px, pz) => [af[0] * px + af[1] * pz + af[2], af[3] * px + af[4] * pz + af[5]];
        const [nx, ny] = n(x, z); const [ax, ay] = n(x + fx * 10, z + fz * 10);
        const m = this.db.get('SELECT width, height FROM game_maps WHERE game=? AND name=?', 'eft', map) || {};
        pos.nx = nx; pos.ny = ny; pos.angle = Math.atan2((ay - ny) * (m.height || 1), (ax - nx) * (m.width || 1)) * 180 / Math.PI;
        pos.onMap = nx >= -0.05 && nx <= 1.05 && ny >= -0.05 && ny <= 1.05;
      }
      this.setLastMap('eft', map);
    }
    this.context.setState('eft:position', pos);
    this.bus.emit('game:position', { game: 'eft', ...pos });
    return pos;
  }
  /**
   * Daten für die Eck-Karte im Overlay: aktuelle Raid-Karte, Exits (für PMC oder Scav, Art erkannt),
   * Transits, eigene Marker und Position – alles in Bildkoordinaten 0..1 (nur tarkov.dev-Karten).
   */
  async eftOverlayMap() {
    const lm = this.lastMap('eft');
    const map = lm.map;
    if (!map || !lm.hasImage) return { map, hasImage: false };
    const af = safeJson(this.context.getState(`calib:eft:${map}`), null)?.affine;
    const faction = this.settings.get('gaming')?.eftFaction || 'pmc';
    const dim = this.db.get('SELECT width, height FROM game_maps WHERE game=? AND name=?', 'eft', map) || {};
    const out = { map, hasImage: true, faction, width: dim.width || 1000, height: dim.height || 1000, markers: lm.markers, position: lm.position, exits: [], transits: [], calibrated: Array.isArray(af) };
    if (!Array.isArray(af)) return out;
    const n = (p) => ({ x: af[0] * p.x + af[1] * p.z + af[2], y: af[3] * p.x + af[4] * p.z + af[5] });
    try {
      const baseMap = safeJson(this.context.getState(`mapsrc:eft:${map}`), null)?.baseMap || map;
      const m = (await this.tarkov.map(baseMap, this.tracker?.tdMode?.()))?.value;
      out.name = m?.name || map;
      out.exits = (m?.extracts || []).filter((e) => e.position && (faction === 'all' || e.faction === faction || e.faction === 'shared' || !e.faction))
        .map((e) => ({ ...n(e.position), name: e.name, faction: e.faction || 'shared', kind: exitKind(e.name) }));
      out.transits = (m?.transits || []).filter((t) => t.position).map((t) => ({ ...n(t.position), name: t.description || 'Transit' }));
    } catch (e) { out.error = e.message; }
    return out;
  }

  /** Letzte bekannte Position (nur die letzten 20 Minuten). */
  eftPosition() {
    const p = safeJson(this.context.getState('eft:position'), null);
    return p && Date.now() - Date.parse(p.at) < 20 * 60000 ? p : null;
  }

  /** Gebaute Hideout-Stufen: aus TarkovTracker, mit eigenen Korrekturen in JARVIS. */
  eftHideoutBuilt() {
    const fromTracker = safeJson(this.context.getState('eft:hideout:tracker'), []) || [];
    const manual = safeJson(this.context.getState('eft:hideout:manual'), {}) || {};
    const s = new Set(fromTracker);
    for (const [id, on] of Object.entries(manual)) { if (on) s.add(id); else s.delete(id); }
    return s;
  }
  /** Händler-Resets, profitabelste Crafts (nur mit gebauten Stationen, wenn bekannt) und lohnende Tauschgeschäfte. */
  async eftEconomy() {
    const gm = this.tracker?.tdMode?.() || 'regular';
    const [tr, cr, ba, hs] = await Promise.all([this.tarkov.traders(gm).catch(() => null), this.tarkov.crafts(gm).catch(() => null), this.tarkov.barters(gm).catch(() => null), this.tarkov.hideoutStations(gm).catch(() => null)]);
    const built = this.eftHideoutBuilt();
    const levelId = new Map(); for (const st of hs?.value || []) for (const l of st.levels || []) levelId.set(`${st.normalizedName}:${l.level}`, l.id);
    const known = built.size > 0;
    const crafts = (cr?.value || []).filter((c) => c.perHour != null && c.perHour > 0 && (!known || built.has(levelId.get(`${c.stationId}:${c.level}`)))).sort((a, b) => b.perHour - a.perHour).slice(0, 12);
    const barters = (ba?.value || []).filter((b) => b.profit != null && b.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, 12);
    return { traders: tr?.value || [], crafts, barters, onlyBuilt: known, gameMode: gm, source: tr?.source || cr?.source || 'tarkov.dev', fetchedAt: cr?.fetchedAt || tr?.fetchedAt || null, note: 'Gewinn ohne Flohmarkt-Gebühr; Preise Ø 24 h.' };
  }
  setEftHideout(levelId, built) {
    if (!/^[\w-]{3,40}$/.test(String(levelId))) throw new Error('Ungültige Hideout-Stufe');
    const manual = safeJson(this.context.getState('eft:hideout:manual'), {}) || {};
    manual[levelId] = !!built;
    this.context.setState('eft:hideout:manual', manual);
    this.bus.emit('game:data', { game: 'eft' });
    return true;
  }
  /** Hideout-Übersicht: je Station gebaute Stufe, nächste Stufe mit Anforderungen. */
  async eftHideout() {
    const built = this.eftHideoutBuilt();
    const r = await this.tarkov.hideoutStations(this.tracker?.tdMode?.());
    const stations = (r.value || []).map((st) => {
      const levels = [...(st.levels || [])].sort((a, b) => a.level - b.level);
      const cur = levels.filter((l) => built.has(l.id)).reduce((m, l) => Math.max(m, l.level), 0);
      const next = levels.find((l) => l.level === cur + 1) || null;
      const reqOk = next ? (next.stationLevelRequirements || []).every((q) => (r.value.find((x) => x.id === q.station?.id)?.levels || []).some((l) => l.level === q.level && built.has(l.id))) : true;
      return { id: st.id, name: st.name, level: cur, max: levels.length ? levels[levels.length - 1].level : 0, levels: levels.map((l) => ({ id: l.id, level: l.level, built: built.has(l.id) })),
        next: next ? { id: next.id, level: next.level, items: (next.itemRequirements || []).map((q) => ({ name: q.item?.name, short: q.item?.shortName, count: q.count })), stations: (next.stationLevelRequirements || []).map((q) => `${q.station?.name} ${q.level}`), ready: reqOk, time: next.constructionTime || 0 } : null };
    }).sort((a, b) => (b.next?.ready ? 1 : 0) - (a.next?.ready ? 1 : 0) || a.name.localeCompare(b.name));
    return { stations, fromTracker: (safeJson(this.context.getState('eft:hideout:tracker'), []) || []).length > 0, source: r.source, fetchedAt: r.fetchedAt, offline: r.offline };
  }

  /** Goon-Sichtung melden: aktuelle Raid-Karte + Account-ID aus dem Tarkov-Log (wie TarkovMonitor). */
  async eftReportGoons() {
    const mapNameId = this.eftRaid?.st?.mapId || this.eftLogs?.location?.id;
    return this.tarkov.reportGoons({ mapNameId, accountId: this.eftRaid?.accountId, gameMode: this.tracker?.tdMode?.() === 'pve' ? 'pve' : 'regular' });
  }

  /**
   * Item-Scanner (wie RatScanner): Ausschnitt um den Mauszeiger → Gemini erkennt das Item (Name aus dem
   * Inspect-Fenster bzw. Symbol) → Preise von tarkov.dev, Wert pro Slot, ob du es für Quests/Hideout brauchst.
   * Nur auf Tastendruck; das Bild bleibt lokal bis auf die eine Erkennungsanfrage.
   */
  async eftScan() {
    const cap = this.platformCapture?.();
    if (!cap) throw new Error('Bildschirmaufnahme ist hier nicht verfügbar');
    this.bus.emit('eft:scan', { state: 'running' });
    try {
      const shot = await cap;
      const g = this.gemini;
      if (!g?.hasKey()) throw new Error('Kein Gemini-Schlüssel');
      const r = await g.generate({ feature: 'vision', effort: 'low', json: true, temperature: 0,
        schema: { type: 'object', properties: { name: { type: 'string' }, english: { type: 'string' }, confidence: { type: 'number' } }, required: ['name'] },
        system: 'Du erkennst Items aus Escape from Tarkov auf einem Bildschirmausschnitt. Das gesuchte Item liegt genau in der Bildmitte (dort ist der Mauszeiger). Gib den exakten Itemnamen zurück, wie er im Spiel heißt (bei offenem Inspect-Fenster den Titel), zusätzlich den englischen Namen. confidence 0–1. Wenn kein Item erkennbar ist: name leer. Erfinde nichts.',
        model: g.requireModel('vision'),
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: shot.data.toString('base64') } }, { text: 'Welches Item ist in der Bildmitte?' }] }] });
      const names = [r?.name, r?.english].map((x) => String(x || '').trim()).filter((x) => x.length >= 2);
      if (!names.length) throw new Error('Kein Item erkannt – Mauszeiger direkt aufs Item halten (oder Inspect-Fenster öffnen).');
      const gm = this.tracker?.tdMode?.();
      let price = null;
      for (const n of names) { price = await this.tarkov.itemPrices(n, gm).catch(() => null); if (price) break; }
      if (!price) throw new Error(`„${names[0]}“ nicht in der tarkov.dev-Datenbank gefunden.`);
      const c = this.eftProgress();
      const need = await this.tarkov.neededItems({ done: c.done, built: this.eftHideoutBuilt(), gameMode: gm }).then((x) => x.items.find((i) => i.name === price.name)).catch(() => null);
      const out = { state: 'done', ...price, recognized: names[0], confidence: r?.confidence ?? null, need: need ? { quest: need.quest, questFir: need.questFir, hideout: need.hideout, tasks: need.tasks.slice(0, 4), stations: need.stations.slice(0, 4) } : null, at: nowIso() };
      this.context.setState('eft:lastscan', out);
      this.bus.emit('eft:scan', out);
      return out;
    } catch (e) {
      this.bus.emit('eft:scan', { state: 'error', error: e.message });
      throw e;
    }
  }

  // ----- maps & markers -----
  maps(gid) {
    return this.db.all('SELECT * FROM game_maps WHERE game=? ORDER BY name', gid).map((m) => ({ id: m.id, game: m.game, name: m.name, hasImage: !!m.image_file, width: m.width, height: m.height,
      calibration: safeJson(this.context.getState(`calib:${gid}:${m.name}`), null), source: safeJson(this.context.getState(`mapsrc:${gid}:${m.name}`), null) }));
  }
  /** Import a user-provided map image (copied into the data dir). */
  importMapImage(gid, name, srcFile, { width, height } = {}) {
    const ext = path.extname(srcFile).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Nur PNG/JPG/WebP');
    const st = fs.statSync(srcFile);
    if (st.size > 40 * 1024 * 1024) throw new Error('Bild zu groß (max. 40 MB)');
    const r = this.saveMapFile(gid, name, fs.readFileSync(srcFile), ext, { width, height });
    // eigenes Bild statt tarkov.dev-Karte → deren automatische Kalibrierung passt nicht mehr
    if (this.context.getState(`mapsrc:${gid}:${name}`) || this.context.getState(`calib:${gid}:${name}`)) {
      this.db.run('DELETE FROM game_state WHERE key IN (?, ?)', `mapsrc:${gid}:${name}`, `calib:${gid}:${name}`);
      return this.maps(gid).find((m) => m.name === name);
    }
    return r;
  }
  /** Kartendatei ablegen (ältere Datei derselben Karte mit anderer Endung wird entfernt). */
  saveMapFile(gid, name, buf, ext, { width, height } = {}) {
    const dir = path.join(this.dataDir, 'maps', gid);
    fs.mkdirSync(dir, { recursive: true });
    const base = String(name).replace(/[^\w\-]+/g, '_').slice(0, 40);
    const file = `${base}${ext}`;
    const old = this.db.get('SELECT image_file FROM game_maps WHERE game=? AND name=?', gid, name)?.image_file;
    fs.writeFileSync(path.join(dir, file), buf);
    if (old && old !== file && !/[\\/]/.test(old)) fs.rmSync(path.join(dir, old), { force: true });
    // Stockwerk-Varianten gehören zur alten Karte → weg (werden beim tarkov.dev-Import neu angelegt)
    try { for (const f of fs.readdirSync(dir)) if (f.startsWith(base + '@')) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* ignore */ }
    this.db.run(`INSERT INTO game_maps(id,game,name,image_file,width,height,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(game,name) DO UPDATE SET image_file=excluded.image_file, width=excluded.width, height=excluded.height`, id('map'), gid, name, file, width || null, height || null, nowIso());
    this.bus.emit('game:markers', { game: gid, map: name });
    return this.maps(gid).find((m) => m.name === name);
  }
  /** Stockwerk-Variante einer Karte ablegen (Datei „<karte>@<ebene>.svg“ neben der Karte). */
  saveLayerFile(gid, name, layer, buf) {
    if (!/^[\w-]{1,40}$/.test(layer)) throw new Error('Ungültige Ebene');
    const dir = path.join(this.dataDir, 'maps', gid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${String(name).replace(/[^\w\-]+/g, '_').slice(0, 40)}@${layer}.svg`), buf);
  }
  mapImagePath(gid, name, layer = null) {
    const m = this.db.get('SELECT image_file FROM game_maps WHERE game=? AND name=?', gid, name);
    if (!m?.image_file) return null;
    if (layer && /^[\w-]{1,40}$/.test(layer)) {
      const lp = path.join(this.dataDir, 'maps', gid, m.image_file.replace(/(\.[a-z]+)$/i, `@${layer}$1`));
      if (lp.startsWith(path.join(this.dataDir, 'maps')) && fs.existsSync(lp)) return lp;
    }
    const p = path.join(this.dataDir, 'maps', gid, m.image_file);
    return p.startsWith(path.join(this.dataDir, 'maps')) && fs.existsSync(p) ? p : null;
  }
  ensureMap(gid, name) {
    this.db.run('INSERT OR IGNORE INTO game_maps(id,game,name,created_at) VALUES(?,?,?,?)', id('map'), gid, name, nowIso());
  }
  /** Two reference points (image x/y in 0..1 ↔ game x/z) → similarity transform. */
  setCalibration(gid, map, points) {
    if (Array.isArray(points) && points.length === 3) {
      const affine = require('./calibration').affineFromPoints(points);
      const image = this.mapImagePath(gid, map);
      if (!image) throw new Error('Zuerst ein Kartenbild hinterlegen');
      const imageHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(image)).digest('hex');
      const result = { points, affine, imageHash, source: 'reference-points' };
      this.context.setState(`calib:${gid}:${map}`, result);
      this.bus.emit('game:markers', { game: gid, map });
      return result;
    }
    if (!Array.isArray(points) || points.length !== 2) throw new Error('Genau zwei Referenzpunkte nötig');
    for (const p of points) for (const k of ['ix', 'iy', 'gx', 'gz']) if (!Number.isFinite(p[k])) throw new Error('Ungültiger Referenzpunkt');
    this.context.setState(`calib:${gid}:${map}`, { points });
    this.bus.emit('game:markers', { game: gid, map });
    return { points };
  }
  /** Last map the user looked at (for the overlay mini map). */
  lastMap(gid) {
    const st = safeJson(this.context.getState('lastmap:' + gid), null);
    const name = st?.map || this.db.get('SELECT map FROM game_markers WHERE game=? ORDER BY updated_at DESC LIMIT 1', gid)?.map || null;
    if (!name) return { map: null, hasImage: false, markers: [] };
    const pos = gid === 'eft' ? this.eftPosition() : null;
    const baseMap = safeJson(this.context.getState(`mapsrc:${gid}:${name}`), null)?.baseMap || name;
    const affine = safeJson(this.context.getState(`calib:${gid}:${name}`), null)?.affine;
    let position = pos && pos.map === name && pos.nx != null ? pos : null;
    if (pos && pos.map === baseMap && Array.isArray(affine)) {
      const size = this.db.get('SELECT width, height FROM game_maps WHERE game=? AND name=?', gid, name) || {};
      const dx = (affine[0] * (pos.fx || 0) + affine[1] * (pos.fz || 0)) * (size.width || 1000);
      const dy = (affine[3] * (pos.fx || 0) + affine[4] * (pos.fz || 0)) * (size.height || 1000);
      position = { ...pos, nx: affine[0] * pos.x + affine[1] * pos.z + affine[2], ny: affine[3] * pos.x + affine[4] * pos.z + affine[5], angle: Math.atan2(dy, dx) * 180 / Math.PI };
    }
    return { map: name, hasImage: !!this.mapImagePath(gid, name), markers: this.markers(gid, name), position };
  }
  setLastMap(gid, map) { if (gid && map) { this.context.setState('lastmap:' + gid, { map: String(map).slice(0, 80) }); this.bus.emit('game:markers', { game: gid, map }); } return true; }
  markers(gid, map) {
    return this.db.all('SELECT * FROM game_markers WHERE game=? AND map=? ORDER BY created_at', gid, map).map((m) => ({ id: m.id, x: m.x, y: m.y, category: m.category, label: m.label, note: m.note, createdAt: m.created_at, updatedAt: m.updated_at }));
  }
  addMarker(gid, map, { x, y, category = 'custom', label = '', note = '' }) {
    if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Ungültige Position');
    const cats = ['exit', 'loot', 'danger', 'quest', 'key', 'custom'];
    if (!cats.includes(category)) category = 'custom';
    this.ensureMap(gid, map);
    const mid = id('mk'); const now = nowIso();
    this.db.run('INSERT INTO game_markers(id,game,map,x,y,category,label,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', mid, gid, map, x, y, category, String(label).slice(0, 80), String(note).slice(0, 500), now, now);
    this.bus.emit('game:markers', { game: gid, map });
    return mid;
  }
  updateMarker(mid, patch) {
    const m = this.db.get('SELECT * FROM game_markers WHERE id=?', mid);
    if (!m) throw new Error('Marker nicht gefunden');
    const x = patch.x ?? m.x, y = patch.y ?? m.y;
    if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Ungültige Position');
    this.db.run('UPDATE game_markers SET x=?, y=?, category=?, label=?, note=?, updated_at=? WHERE id=?', x, y, patch.category ?? m.category, String(patch.label ?? m.label).slice(0, 80), String(patch.note ?? m.note).slice(0, 500), nowIso(), mid);
    this.bus.emit('game:markers', { game: m.game, map: m.map });
  }
  removeMarker(mid) {
    const m = this.db.get('SELECT game, map FROM game_markers WHERE id=?', mid);
    this.db.run('DELETE FROM game_markers WHERE id=?', mid);
    if (m) this.bus.emit('game:markers', m);
  }
  clearMarkers(gid, map) { this.db.run('DELETE FROM game_markers WHERE game=? AND map=?', gid, map); this.bus.emit('game:markers', { game: gid, map }); }
  routeGoal(map) { return safeJson(this.context.getState('eft:route-goal:' + map), null); }
  setRouteGoal(map, goal) {
    if (typeof map !== 'string' || !map.trim() || map.length > 80) throw new Error('Karte erforderlich');
    if (goal !== null) {
      if (!goal || !String(goal.label || '').trim()) throw new Error('Zielname erforderlich');
      const placed = goal.x != null || goal.y != null;
      if (placed && (![goal.x, goal.y].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1))) throw new Error('Ziel muss innerhalb der Karte liegen');
      goal = { label: String(goal.label).trim().slice(0,120), x: placed ? goal.x : null, y: placed ? goal.y : null, floor: goal.floor ? String(goal.floor).slice(0,80) : null };
    }
    this.context.setState('eft:route-goal:' + map, goal);
    this.bus.emit('game:markers', { game: 'eft', map }); return goal;
  }
  routes(gid, map) { return this.db.all('SELECT * FROM game_routes WHERE game=? AND map=? ORDER BY created_at DESC', gid, map).map((r) => ({ id: r.id, name: r.name, points: safeJson(r.points, []) })); }
  saveRoute(gid, map, name, points) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 50) throw new Error('Route braucht 2–50 Punkte');
    const clean = points.map((p) => ({ x: Number(p.x), y: Number(p.y), label: String(p.label || '').slice(0, 40) })).filter((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
    if (clean.length !== points.length) throw new Error('Alle Routenpunkte müssen innerhalb der Karte liegen');
    const rid = id('rt');
    this.db.run('INSERT INTO game_routes(id,game,map,name,points,created_at) VALUES(?,?,?,?,?,?)', rid, gid, map, String(name).slice(0, 60), JSON.stringify(clean), nowIso());
    this.bus.emit('game:markers', { game: gid, map });
    return rid;
  }
  removeRoute(rid) { this.db.run('DELETE FROM game_routes WHERE id=?', rid); this.bus.emit('game:markers', {}); }

  // ----- checklists (per game, user-defined) -----
  checklist(gid, name = 'Checkliste') {
    const d = safeJson(this.context.getState(`checklist:${gid}:${name}`), null);
    if (d) return d;
    if (gid === 'eft' && name === 'Raid-Checkliste') {
      return { name, items: ['Ausrüstung geprüft', 'Heilung dabei', 'Munition & Magazine', 'Quest-Items', 'Schlüssel', 'Rucksack frei', 'Exit-Route geplant'].map((t) => ({ id: id('ci'), text: t, done: false })) };
    }
    const preset = (this.context.profile(gid)?.checklists || []).find((c) => c.name === name);
    if (preset) return { name, preset: true, items: preset.items.map((t, i) => ({ id: 'p' + i, text: t, done: false })) };
    return { name, items: [] };
  }
  saveChecklist(gid, name, items) {
    if (!Array.isArray(items) || items.length > 60) throw new Error('Ungültige Checkliste');
    const clean = items.map((i) => ({ id: String(i.id || id('ci')).slice(0, 40), text: String(i.text || '').slice(0, 120), done: !!i.done })).filter((i) => i.text);
    this.context.setState(`checklist:${gid}:${name}`, { name, items: clean });
    this.bus.emit('game:data', { game: gid });
    return { name, items: clean };
  }

  // ----- game knowledge -----
  notes(gid) { return this.brain.list({ domain: 'gaming', game: gid, limit: 50 }); }
  addNote(gid, text, title) {
    return this.brain.add({ kind: 'note', domain: 'gaming', game: gid, title: title || truncate(text, 60), content: text, sourceType: 'user' });
  }
  sources(gid) {
    return this.db.all("SELECT * FROM knowledge WHERE game=? AND source_type='web' AND archived=0 ORDER BY updated_at DESC LIMIT 20", gid).map((r) => this.brain.toPublic(r));
  }

  /** Research for a game, cached 3 days, stored in history with sources. */
  async research(gid, query) {
    const p = this.context.profile(gid);
    const q = `${p?.name || gid}: ${query}`;
    const key = 'research:' + q.toLowerCase();
    const r = await this.cache.wrap(key, 'Google-Suche (Gemini)', 3 * 86400000, async () => {
      const res = await this.web.research(q + ' — beachte die aktuelle Spielversion und nenne die Version/das Datum der Quelle.', { game: gid });
      return { answer: res.answer, sources: res.sources, researchId: res.id };
    });
    return { ...r.value, fetchedAt: r.fetchedAt, cached: !!r.fetchedAt && Date.now() - Date.parse(r.fetchedAt) > 5000, query };
  }

  otherGameNotifications(activeId) {
    return this.notifications.list({ category: 'gaming', limit: 12, excludeGame: activeId || undefined })
      .concat(this.timers().filter((t) => t.game !== activeId && !t.fired).slice(0, 6).map((t) => ({ id: t.id, title: `${t.gameName}: ${t.label}`, body: 'Läuft bis ' + new Date(t.endsAt).toLocaleString('de-DE'), origin: 'timer', originLabel: 'Eigener Timer (Zeitabschätzung)', game: t.game, createdAt: t.createdAt, pending: true, endsAt: t.endsAt })));
  }

  /** Erkennt Spiele, die in einem Text erwähnt werden (für den Kontext). */
  mentionedGames(text, max = 3) {
    const t = ' ' + require('../../core/util').normText(text) + ' ';
    const out = [];
    for (const p of this.context.profiles()) {
      const names = [p.name, p.short, ...(p.aliases || [])].filter(Boolean).map((a) => require('../../core/util').normText(a)).filter((a) => a.length >= 3);
      if (names.some((a) => t.includes(' ' + a + ' '))) out.push(p);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Spielstand-Kontext für den Systemprompt: aktives, besprochenes und erwähnte Spiele. */
  progressContext(text = '', { maxGames = 3 } = {}) {
    const st = this.context.state();
    const games = [];
    const add = (p) => { if (p && !games.some((g) => g.id === p.id)) games.push(p); };
    add(st.active?.profile); add(st.discussed?.profile);
    for (const p of this.mentionedGames(text)) add(p);
    return games.slice(0, maxGames).map((p) => this.progress.summary(p.id, p.name)).filter(Boolean).join('\n\n');
  }

  // ----- RoK planner (user-maintained plan, no invented game data) -----
  plan(gid) { return safeJson(this.context.getState('plan:' + gid), { goals: [] }); }
  savePlan(gid, plan) {
    const goals = (plan.goals || []).slice(0, 40).map((g) => ({ id: String(g.id || id('pg')), text: String(g.text || '').slice(0, 160), category: String(g.category || 'Allgemein').slice(0, 30), done: !!g.done, due: g.due || null })).filter((g) => g.text);
    this.context.setState('plan:' + gid, { goals });
    this.bus.emit('game:data', { game: gid });
    return { goals };
  }
}

module.exports = { Gaming, WIDGETS, LAYOUTS, WIDGET_TYPES: Object.keys(WIDGETS), extrasFor };

