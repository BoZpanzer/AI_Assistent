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

module.exports = { Tarkov, TARKOV_SOURCE: SOURCE };
