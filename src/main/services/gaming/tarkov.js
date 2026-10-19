'use strict';
/**
 * Escape from Tarkov data via the free community API api.tarkov.dev
 * (https://tarkov.dev). Read-only, cached, source + fetch time shown in UI.
 * No live raid state is available from any API — the UI says so.
 */
const API = 'https://api.tarkov.dev/graphql';
const SOURCE = 'tarkov.dev (Community-API)';
const log = require('../../core/logger').scope('tarkov');
const DAY = 86400000;

/** Wert eines Items: Flohmarkt-Ø 24 h, sonst bester Händler-Ankauf; Kosten: günstigster Einkauf (Flohmarkt/Händler). */
const sellValue = (i) => Math.max(i?.avg24hPrice || 0, ...((i?.sellFor || []).filter((x) => !/flohmarkt|flea/i.test(x.vendor?.name || '')).map((x) => x.priceRUB || 0)));
const buyCost = (i) => { const c = [...(i?.buyFor || []).map((x) => x.priceRUB).filter((x) => x > 0), ...(i?.avg24hPrice ? [i.avg24hPrice] : [])]; return c.length ? Math.min(...c) : null; };
function profitOf(c, durationSec) {
  const reward = (c.rewardItems || []).reduce((a, x) => a + sellValue(x.item) * x.count, 0);
  const costs = (c.requiredItems || []).map((x) => ({ name: x.item?.name, count: x.count, cost: buyCost(x.item) }));
  const unknown = costs.some((x) => x.cost == null);
  const cost = costs.reduce((a, x) => a + (x.cost || 0) * x.count, 0);
  const profit = unknown ? null : Math.round(reward - cost);
  return { id: c.id, station: c.station?.name || null, stationId: c.station?.normalizedName || null, level: c.level, duration: durationSec, reward: (c.rewardItems || []).map((x) => `${x.count}× ${x.item?.name}`).join(', '), rewardValue: Math.round(reward), cost: Math.round(cost), inputs: costs, profit, perHour: profit != null && durationSec ? Math.round(profit / (durationSec / 3600)) : null };
}

/** Short, secret-free description of a failed tarkov.dev response for the diagnostic log. */
function responseDiag(r, body) {
  const h = (k) => { try { return r.headers?.get?.(k) || null; } catch { return null; } };
  return { status: r.status, type: h('content-type'), ray: h('cf-ray'), server: h('server'), body: String(body || '').replace(/\s+/g, ' ').slice(0, 300) };
}

/** Error for a rejected tarkov.dev request: readable message for the UI, details stay in the log. */
function apiError(status) {
  const e = new Error(status === 429
    ? 'tarkov.dev begrenzt gerade die Anfragen (429). JARVIS versucht es später automatisch erneut.'
    : status >= 500
      ? `tarkov.dev ist gerade nicht erreichbar (HTTP ${status}). Gespeicherte Daten werden weiter genutzt.`
      : `tarkov.dev hat die Anfrage abgelehnt (HTTP ${status}). Kartenbild, Kalibrierung und eigene Marker funktionieren weiter; Exits und Questpunkte fehlen, bis tarkov.dev wieder antwortet. Details: Einstellungen → Diagnose → Protokoll.`);
  e.status = status; e.permanent = status >= 400 && status < 500 && status !== 429;
  return e;
}

class Tarkov {
  constructor(ctx) { this.fetch = ctx.fetch; this.cache = ctx.gameCache; this.rejected = new Map(); this.inflight = new Map(); }

  /**
   * GraphQL request. Identical concurrent queries share one request. A query that tarkov.dev rejected
   * with a 4xx status is not re-sent for 15 minutes (no request loop on permanent errors).
   */
  async gql(query, variables = {}) {
    const key = query + '\n' + JSON.stringify(variables);
    const blocked = this.rejected.get(key);
    if (blocked && blocked.until > Date.now()) throw apiError(blocked.status);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = (async () => {
      const r = await this.fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000) });
      if (!r.ok) {
        const body = typeof r.text === 'function' ? await r.text().catch(() => '') : '';
        log.warn('tarkov.dev-Anfrage fehlgeschlagen', { ...responseDiag(r, body), query: query.replace(/\s+/g, ' ').slice(0, 90) });
        const e = apiError(r.status);
        if (e.permanent || r.status === 429) this.rejected.set(key, { status: r.status, until: Date.now() + (r.status === 429 ? 2 : 15) * 60000 });
        throw e;
      }
      const j = await r.json();
      if (j.errors?.length) log.info('tarkov.dev meldet Teilfehler: ' + String(j.errors[0]?.message || j.errors[0]).slice(0, 200));
      if (j.errors?.length && !j.data) throw new Error('tarkov.dev: ' + String(j.errors[0]?.message || j.errors[0]).slice(0, 200));
      this.rejected.delete(key);
      return j.data;
    })();
    this.inflight.set(key, job);
    try { return await job; } finally { this.inflight.delete(key); }
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
      const full = `query($gm: GameMode){ tasks(lang: de, gameMode: $gm) { id name minPlayerLevel kappaRequired lightkeeperRequired trader { name } map { normalizedName name } taskRequirements { task { id } status }
        objectives { ${base}
          ... on TaskObjectiveItem { items { name shortName } count foundInRaid }
          ... on TaskObjectiveMark { markerItem { name shortName } }
          ... on TaskObjectiveQuestItem { questItem { name shortName } count }
          ... on TaskObjectiveBasic { requiredKeys { name shortName } } } } }`;
      const lite = `query($gm: GameMode){ tasks(lang: de, gameMode: $gm) { id name minPlayerLevel kappaRequired lightkeeperRequired trader { name } map { normalizedName name } taskRequirements { task { id } status } objectives { ${base} } } }`;
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

  /** Hideout-Stationen mit Stufen, Bau-Anforderungen (Items, andere Stationen) und Boni. */
  async hideoutStations(gameMode = 'regular') {
    return this.cache.wrap('eft:hideout:' + gameMode, SOURCE, 3 * DAY, async () => {
      const lv = 'id level constructionTime itemRequirements { item { id name shortName } count } stationLevelRequirements { station { id name } level }';
      try {
        return (await this.gql(`query($gm: GameMode){ hideoutStations(lang: de, gameMode: $gm) { id name normalizedName levels { ${lv} bonuses { type value } } } }`, { gm: gameMode })).hideoutStations;
      } catch {
        return (await this.gql(`query($gm: GameMode){ hideoutStations(lang: de, gameMode: $gm) { id name normalizedName levels { ${lv} } } }`, { gm: gameMode })).hideoutStations;
      }
    });
  }

  /**
   * Benötigte Items: aus allen NICHT erledigten Quests (Abgeben, mit „Found in Raid“) und den noch nicht gebauten
   * Hideout-Stufen. Dazu Kappa- und Lightkeeper-Fortschritt.
   */
  async neededItems({ done = new Set(), built = new Set(), gameMode, kappaOnly = false } = {}) {
    const [tn, hs] = await Promise.all([this.taskNeeds(gameMode), this.hideoutStations(gameMode).catch(() => ({ value: [] }))]);
    const items = new Map();
    const add = (it, n, src, fir) => {
      if (!it?.name || !(n > 0)) return;
      const x = items.get(it.name) || { id: it.id || null, name: it.name, short: it.shortName || it.name, quest: 0, questFir: 0, hideout: 0, tasks: [], stations: [] };
      if (src.task) { x.quest += n; if (fir) x.questFir += n; if (!x.tasks.includes(src.task)) x.tasks.push(src.task); }
      if (src.station) { x.hideout += n; if (!x.stations.includes(src.station)) x.stations.push(src.station); }
      items.set(it.name, x);
    };
    const tasks = tn.value.tasks || [];
    for (const t of tasks) {
      if (done.has(t.name) || (kappaOnly && !t.kappaRequired)) continue;
      for (const o of t.objectives || []) if (/giveItem/i.test(o.type) && Array.isArray(o.items) && o.items[0]) add(o.items[0], o.count || 1, { task: t.name }, !!o.foundInRaid);
    }
    for (const st of hs.value || []) for (const l of st.levels || []) {
      if (built.has(l.id)) continue;
      for (const r of l.itemRequirements || []) add(r.item, r.count || 1, { station: `${st.name} ${l.level}` });
    }
    const list = [...items.values()].map((x) => ({ ...x, total: x.quest + x.hideout })).sort((a, b) => b.total - a.total);
    const prog = (flag) => { const all = tasks.filter((t) => t[flag]); return { done: all.filter((t) => done.has(t.name)).length, total: all.length }; };
    return { items: list, kappa: prog('kappaRequired'), lightkeeper: prog('lightkeeperRequired'), detailed: tn.value.detailed, source: tn.source, fetchedAt: tn.fetchedAt, offline: tn.offline };
  }

  /** Letzte Goon-Sichtungen der Community (tarkov.dev), neueste zuerst. */
  async goonReports(gameMode = 'regular') {
    return this.cache.wrap('eft:goons:' + gameMode, SOURCE, 5 * 60000, async () => {
      const d = await this.gql('query($gm: GameMode){ goonReports(lang: de, gameMode: $gm, limit: 25) { map { name normalizedName nameId } timestamp } }', { gm: gameMode });
      return (d.goonReports || []).map((g) => ({ map: g.map?.normalizedName, mapName: g.map?.name, at: new Date(Number(g.timestamp)).toISOString() })).sort((a, b) => b.at.localeCompare(a.at));
    });
  }

  /** Eigene Goon-Sichtung an tarkov.dev melden (wie TarkovMonitor). */
  async reportGoons({ mapNameId, accountId, gameMode = 'regular' }) {
    if (!/^[A-Za-z0-9_]+$/.test(String(mapNameId || ''))) throw new Error('Unbekannte Karte – erst einen Raid starten');
    if (!/^\d+$/.test(String(accountId || ''))) throw new Error('Account-ID unbekannt (steht erst nach dem Spielstart im Tarkov-Log)');
    const r = await this.fetch('https://manager.tarkov.dev/api/goons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ map: mapNameId, gameMode: gameMode === 'pve' ? 'pve' : 'regular', timestamp: Date.now(), accountId: Number(accountId) }) });
    if (!r.ok) throw new Error('tarkov.dev hat die Meldung abgelehnt (' + r.status + ')');
    this.cache.db?.run?.("DELETE FROM game_cache WHERE key LIKE 'eft:goons:%'");
    return { ok: true };
  }

  /** Itemname zu einer Item-ID (z. B. aus Flohmarkt-Meldungen). */
  async itemNameById(id) {
    if (!/^[0-9a-f]{24}$/i.test(String(id || ''))) return null;
    const r = await this.cache.wrap('eft:itemname:' + id, SOURCE, 30 * DAY, async () => (await this.gql('query($ids: [ID]){ items(ids: $ids, lang: de) { name } }', { ids: [id] })).items?.[0]?.name || null);
    return r.value;
  }

  /** Item-Preise für den Scanner: Flohmarkt, beste Händler, Wert pro Slot. */
  async itemPrices(name, gameMode = 'regular') {
    const q = String(name || '').trim();
    if (q.length < 2) return null;
    const r = await this.cache.wrap(`eft:price:${gameMode}:${q.toLowerCase()}`, SOURCE, 30 * 60000, async () => {
      const d = await this.gql(`query($n: String, $gm: GameMode){ items(name: $n, lang: de, gameMode: $gm, limit: 8) { id name shortName width height basePrice avg24hPrice lastLowPrice low24hPrice wikiLink iconLink sellFor { vendor { name } priceRUB } } }`, { n: q, gm: gameMode });
      return d.items || [];
    });
    const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const nq = norm(q);
    const best = r.value.find((i) => norm(i.name) === nq || norm(i.shortName) === nq) || r.value[0];
    if (!best) return null;
    const slots = Math.max(1, (best.width || 1) * (best.height || 1));
    const traders = (best.sellFor || []).filter((x) => x.vendor?.name && !/flohmarkt|flea/i.test(x.vendor.name)).sort((a, b) => b.priceRUB - a.priceRUB);
    const flea = best.avg24hPrice || best.lastLowPrice || null;
    return { id: best.id, name: best.name, short: best.shortName, slots, flea, fleaLow: best.lastLowPrice || null, trader: traders[0] ? { name: traders[0].vendor.name, price: traders[0].priceRUB } : null,
      perSlot: Math.round(Math.max(flea || 0, traders[0]?.priceRUB || 0) / slots), wiki: best.wikiLink, icon: best.iconLink, alternatives: r.value.filter((i) => i !== best).slice(0, 3).map((i) => i.name), source: r.source, fetchedAt: r.fetchedAt };
  }

  /** Händler mit Zeitpunkt des nächsten Restocks. */
  async traders(gameMode = 'regular') {
    const r = await this.cache.wrap('eft:traders:' + gameMode, SOURCE, 10 * 60000, async () => (await this.gql('query($gm: GameMode){ traders(lang: de, gameMode: $gm) { id name normalizedName resetTime } }', { gm: gameMode })).traders || []);
    return { ...r, value: r.value.filter((t) => t.resetTime).map((t) => ({ name: t.name, id: t.normalizedName, resetTime: t.resetTime })) };
  }

  /** Hideout-Crafts mit Gewinn pro Stunde (Flohmarkt-Ø 24 h bzw. bester Händler; ohne Flohmarkt-Gebühr). */
  async crafts(gameMode = 'regular') {
    const it = 'item { id name shortName avg24hPrice sellFor { vendor { name } priceRUB } buyFor { vendor { name } priceRUB } }';
    const r = await this.cache.wrap('eft:crafts:' + gameMode, SOURCE, 60 * 60000, async () => (await this.gql(`query($gm: GameMode){ crafts(lang: de, gameMode: $gm) { id station { normalizedName name } level duration rewardItems { ${it} count } requiredItems { ${it} count } } }`, { gm: gameMode })).crafts || []);
    return { ...r, value: r.value.map((c) => profitOf(c, c.duration)) };
  }

  /** Tauschgeschäfte: Wert der Belohnung gegen Kosten der benötigten Items. */
  async barters(gameMode = 'regular') {
    const it = 'item { id name shortName avg24hPrice sellFor { vendor { name } priceRUB } buyFor { vendor { name } priceRUB } }';
    const r = await this.cache.wrap('eft:barters:' + gameMode, SOURCE, 60 * 60000, async () => (await this.gql(`query($gm: GameMode){ barters(lang: de, gameMode: $gm) { id trader { name } level rewardItems { ${it} count } requiredItems { ${it} count } } }`, { gm: gameMode })).barters || []);
    return { ...r, value: r.value.map((b) => ({ ...profitOf(b, null), trader: b.trader?.name, level: b.level })) };
  }

  /** Munition: Schaden, Durchschlag, Panzerschaden pro Kaliber. */
  async ammo(gameMode = 'regular') {
    const r = await this.cache.wrap('eft:ammo:' + gameMode, SOURCE, 3 * DAY, async () => (await this.gql('query($gm: GameMode){ ammo(lang: de, gameMode: $gm) { item { id name shortName avg24hPrice } caliber damage penetrationPower armorDamage projectileCount fragmentationChance } }', { gm: gameMode })).ammo || []);
    return { ...r, value: r.value.map((a) => ({ name: a.item?.name, short: a.item?.shortName, caliber: String(a.caliber || '').replace(/^Caliber/, ''), damage: a.damage * (a.projectileCount || 1), pen: a.penetrationPower, armor: a.armorDamage, frag: Math.round((a.fragmentationChance || 0) * 100), price: a.item?.avg24hPrice || null })) };
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

module.exports = { profitOf, Tarkov, TARKOV_SOURCE: SOURCE, exitKind, apiError };
