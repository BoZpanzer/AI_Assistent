'use strict';
/**
 * Escape from Tarkov data via the free community API api.tarkov.dev
 * (https://tarkov.dev). Read-only, cached, source + fetch time shown in UI.
 * No live raid state is available from any API — the UI says so.
 */
const API = 'https://api.tarkov.dev/graphql';
const SOURCE = 'tarkov.dev (Community-API)';
const DAY = 86400000;

class Tarkov {
  constructor(ctx) { this.fetch = ctx.fetch; this.cache = ctx.gameCache; }

  async gql(query, variables = {}) {
    const r = await this.fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
    if (!r.ok) throw new Error('tarkov.dev antwortet mit ' + r.status);
    const j = await r.json();
    if (j.errors?.length && !j.data) throw new Error('tarkov.dev: ' + j.errors[0].message);
    return j.data;
  }

  async maps(gameMode = 'regular') {
    return this.cache.wrap('eft:maps:' + gameMode, SOURCE, 3 * DAY, async () => {
      const d = await this.gql(`query($gm: GameMode){ maps(lang: de, gameMode: $gm) { id name normalizedName raidDuration players wiki
        extracts { id name faction position { x y z } }
        transits { id description position { x y z } }
        locks { lockType needsPower position { x y z } key { id name shortName wikiLink } }
        bosses { boss { name } spawnChance spawnLocations { name chance } } } }`, { gm: gameMode });
      return d.maps.filter((m) => m.extracts?.length);
    });
  }

  async map(normalizedName, gameMode) {
    const all = await this.maps(gameMode);
    const m = all.value.find((x) => x.normalizedName === normalizedName || x.name.toLowerCase() === String(normalizedName).toLowerCase());
    return m ? { ...all, value: m } : null;
  }

  async tasks(gameMode = 'regular') {
    return this.cache.wrap('eft:tasks:' + gameMode, SOURCE, 2 * DAY, async () => {
      const d = await this.gql(`query($gm: GameMode){ tasks(lang: de, gameMode: $gm) { id name normalizedName minPlayerLevel kappaRequired lightkeeperRequired wikiLink experience
        trader { name } map { name normalizedName } objectives { type description optional maps { normalizedName } } } }`, { gm: gameMode });
      return d.tasks;
    });
  }

  /**
   * Orte der Questziele (Zonen, mögliche Fundorte von Quest-Items) – eigene Abfrage, damit ein
   * geändertes API-Schema nicht die normale Questliste kaputt macht.
   */
  async taskZones(gameMode = 'regular') {
    return this.cache.wrap('eft:taskzones:' + gameMode, SOURCE, 2 * DAY, async () => {
      const Z = 'zones { map { normalizedName } position { x y z } }';
      const d = await this.gql(`query($gm: GameMode){ tasks(lang: de, gameMode: $gm) { id name minPlayerLevel objectives { id description optional
        ... on TaskObjectiveBasic { ${Z} }
        ... on TaskObjectiveMark { ${Z} }
        ... on TaskObjectiveUseItem { ${Z} }
        ... on TaskObjectiveShoot { ${Z} }
        ... on TaskObjectiveQuestItem { ${Z} possibleLocations { map { normalizedName } positions { x y z } } } } } }`, { gm: gameMode });
      return d.tasks.map((t) => ({ id: t.id, name: t.name, minPlayerLevel: t.minPlayerLevel, objectives: (t.objectives || []).map((o) => ({
        description: o.description, optional: !!o.optional,
        points: [...(o.zones || []).map((z) => ({ map: z.map?.normalizedName, ...z.position })), ...(o.possibleLocations || []).flatMap((l) => (l.positions || []).map((p) => ({ map: l.map?.normalizedName, ...p, item: true })))].filter((p) => p.map && Number.isFinite(p.x) && Number.isFinite(p.z)),
      })).filter((o) => o.points.length) })).filter((t) => t.objectives.length);
    });
  }

  /**
   * Quest-Daten für den Raid-Planer: Voraussetzungen, Karten der Ziele, mitzunehmende Items/Schlüssel.
   * Eigene, isolierte Abfrage; scheitern die Detailfelder (Schemaänderung), gibt es eine schlanke Variante.
   */
  async taskNeeds(gameMode = 'regular') {
    return this.cache.wrap('eft:taskneeds:' + gameMode, SOURCE, 2 * DAY, async () => {
      const base = 'id type description optional maps { normalizedName name }';
      const full = `query($gm: GameMode){ tasks(lang: de, gameMode: $gm) { id name minPlayerLevel kappaRequired trader { name } map { normalizedName name } taskRequirements { task { id } status }
        objectives { ${base}
          ... on TaskObjectiveItem { items { name shortName } count foundInRaid }
          ... on TaskObjectiveMark { markerItem { name shortName } }
          ... on TaskObjectiveQuestItem { questItem { name shortName } count }
          ... on TaskObjectiveBasic { requiredKeys { name shortName } } } } }`;
      const lite = `query($gm: GameMode){ tasks(lang: de, gameMode: $gm) { id name minPlayerLevel kappaRequired trader { name } map { normalizedName name } taskRequirements { task { id } status } objectives { ${base} } } }`;
      let d; let detailed = true;
      try { d = await this.gql(full, { gm: gameMode }); } catch (e) { detailed = false; d = await this.gql(lite, { gm: gameMode }); }
      return { detailed, tasks: d.tasks };
    });
  }

  /**
   * Raid-Planer: offene, verfügbare Quests (nicht erledigt, Level reicht, Vorgänger erledigt) nach Karte.
   * Ohne Kartenwahl: Rangliste der Karten nach offenen Zielen; mit Karte: Ziele, was mitzunehmen ist.
   */
  async raidPlan({ map, done = new Set(), failed = new Set(), level = null, gameMode } = {}) {
    const r = await this.taskNeeds(gameMode);
    const { tasks, detailed } = r.value;
    const doneIds = new Set(tasks.filter((t) => done.has(t.name)).map((t) => t.id));
    const avail = tasks.filter((t) => !done.has(t.name) && !failed.has(t.name)
      && (level == null || (t.minPlayerLevel || 0) <= level)
      && (t.taskRequirements || []).every((q) => !q?.task?.id || !(q.status || []).some((st) => /complete/i.test(st)) || doneIds.has(q.task.id)));
    const objMaps = (t, o) => { const m = (o.maps || []).map((x) => x.normalizedName); return m.length ? m : t.map?.normalizedName ? [t.map.normalizedName] : []; };
    const counts = new Map();
    for (const t of avail) {
      const seen = new Set();
      for (const o of t.objectives || []) for (const m of objMaps(t, o)) {
        const c = counts.get(m) || { id: m, name: (o.maps || []).find((x) => x.normalizedName === m)?.name || t.map?.name || m, tasks: 0, objectives: 0, kappa: 0 };
        c.objectives++; if (!seen.has(m)) { seen.add(m); c.tasks++; if (t.kappaRequired) c.kappa++; }
        counts.set(m, c);
      }
    }
    const maps = [...counts.values()].sort((a, b) => b.tasks - a.tasks || b.objectives - a.objectives);
    const anywhere = avail.filter((t) => (t.objectives || []).some((o) => !objMaps(t, o).length)).map((t) => ({ task: t.name, trader: t.trader?.name, objectives: t.objectives.filter((o) => !objMaps(t, o).length && !o.optional).map((o) => o.description) })).slice(0, 15);
    const out = { maps, anywhere, available: avail.length, level, detailed, source: r.source, fetchedAt: r.fetchedAt, offline: r.offline };
    if (!map) return out;
    const items = new Map(); const keys = new Map();
    const add = (mp, it, n = 1) => { if (!it?.name) return; const k = it.name; const x = mp.get(k) || { name: it.name, short: it.shortName || it.name, count: 0, tasks: [] }; x.count += n; mp.set(k, x); return x; };
    const sel = [];
    for (const t of avail) {
      const objs = (t.objectives || []).filter((o) => objMaps(t, o).includes(map));
      if (!objs.length) continue;
      for (const o of objs) {
        if (/plant/i.test(o.type)) for (const it of o.items || [o.questItem].filter(Boolean)) { const x = add(items, it, o.count || 1); if (x && !x.tasks.includes(t.name)) x.tasks.push(t.name); }
        if (o.markerItem) { const x = add(items, o.markerItem, 1); if (x && !x.tasks.includes(t.name)) x.tasks.push(t.name); }
        for (const alt of o.requiredKeys || []) { const opts = (Array.isArray(alt) ? alt : [alt]).filter(Boolean); if (opts.length) { const x = add(keys, { name: opts.map((k) => k.name).join(' oder '), shortName: opts.map((k) => k.shortName).join(' / ') }, 0); if (x && !x.tasks.includes(t.name)) x.tasks.push(t.name); } }
      }
      sel.push({ task: t.name, trader: t.trader?.name, kappa: !!t.kappaRequired, objectives: objs.map((o) => ({ text: o.description, optional: !!o.optional, type: o.type })) });
    }
    out.map = map; out.tasks = sel; out.bring = { items: [...items.values()], keys: [...keys.values()] };
    return out;
  }

  /** Questziele auf einer Karte – ohne erledigte Quests (Spielstand/TarkovTracker), optional bis zum eigenen Level. */
  async questMarkers(map, { done = new Set(), level = null, gameMode } = {}) {
    const z = await this.taskZones(gameMode);
    const out = [];
    for (const t of z.value) {
      if (done.has(t.name)) continue;
      if (level != null && t.minPlayerLevel > level) continue;
      for (const o of t.objectives) for (const p of o.points) if (p.map === map) out.push({ x: p.x, z: p.z, y: p.y, task: t.name, objective: o.description, item: !!p.item, optional: o.optional });
    }
    return { markers: out.slice(0, 250), total: out.length, source: z.source, fetchedAt: z.fetchedAt, offline: z.offline };
  }

  async searchTasks(q, { map, limit = 8, gameMode } = {}) {
    const t = await this.tasks(gameMode);
    const needle = String(q || '').toLowerCase();
    const list = t.value.filter((x) => (!map || x.map?.normalizedName === map || x.objectives.some((o) => o.maps.some((m) => m.normalizedName === map)))
      && (!needle || x.name.toLowerCase().includes(needle) || x.trader?.name.toLowerCase().includes(needle) || x.objectives.some((o) => o.description.toLowerCase().includes(needle))));
    return { items: list.slice(0, limit), total: list.length, source: t.source, fetchedAt: t.fetchedAt, offline: t.offline };
  }

  async items(q, { keysOnly = false, limit = 10, gameMode = 'regular' } = {}) {
    const name = String(q || '').trim();
    if (name.length < 2 && !keysOnly) return { items: [], source: SOURCE };
    const key = `eft:items:${gameMode}:${keysOnly ? 'keys' : 'all'}:${name.toLowerCase()}`;
    const r = await this.cache.wrap(key, SOURCE, DAY, async () => {
      const d = await this.gql(`query($n: String, $t: ItemType, $gm: GameMode){ items(name: $n, type: $t, lang: de, gameMode: $gm, limit: 30) {
        id name shortName description types basePrice avg24hPrice lastLowPrice wikiLink updated
        sellFor { vendor { name } priceRUB } } }`, { n: name || undefined, t: keysOnly ? 'keys' : undefined, gm: gameMode });
      return d.items;
    });
    return { items: r.value.slice(0, limit), source: r.source, fetchedAt: r.fetchedAt, offline: r.offline };
  }

  /** Keys relevant for a map (from lock positions). */
  async keysForMap(normalizedName, gameMode) {
    const m = await this.map(normalizedName, gameMode);
    if (!m) return { items: [], source: SOURCE };
    const seen = new Map();
    for (const l of m.value.locks || []) if (l.key && !seen.has(l.key.id)) seen.set(l.key.id, { ...l.key, lockType: l.lockType, needsPower: l.needsPower });
    return { items: [...seen.values()], source: m.source, fetchedAt: m.fetchedAt, offline: m.offline };
  }
}

/**
 * Art eines Exits aus seinem Namen (tarkov.dev liefert keine eigene Kennzeichnung):
 * flare = Leuchtpatrone nötig, coop = Co-op (PMC+Scav), car = Fahrzeug (V-Ex, kostet Rubel), normal.
 */
function exitKind(name) {
  const n = String(name || '');
  if (/flare|leucht/i.test(n)) return 'flare';
  if (/co-?op|koop/i.test(n)) return 'coop';
  if (/\bv-?ex\b|vehicle|fahrzeug|\bcar\b|\bauto\b/i.test(n)) return 'car';
  return 'normal';
}

module.exports = { Tarkov, TARKOV_SOURCE: SOURCE, exitKind };
