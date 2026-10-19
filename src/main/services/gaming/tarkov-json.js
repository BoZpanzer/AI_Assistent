'use strict';
/**
 * Tarkov-Daten aus den öffentlichen JSON-Dateien von tarkov.dev (https://json.tarkov.dev),
 * wie sie auch das offizielle TarkovMonitor nutzt. Die GraphQL-Schnittstelle (api.tarkov.dev)
 * antwortet seit Herbst 2026 häufig mit „GraphQL server unavailable“ (HTTP 422).
 *
 * Aufbau einer Datei: { data, translations } – Namen/Beschreibungen sind Schlüssel, die über
 * „<datei>_de“ (Fallback „<datei>_en“) übersetzt werden. Diese Klasse liefert die Daten in derselben
 * Form wie die bisherigen GraphQL-Abfragen, damit der Rest von JARVIS unverändert bleibt.
 * Nur Lesen, keine Schlüssel, keine Kontodaten.
 */
const BASE = 'https://json.tarkov.dev';
const log = require('../../core/logger').scope('tarkov-json');
const TTL = 30 * 60000;
const MAX_BYTES = 80 * 1024 * 1024;
const TEXT_FIELDS = new Set(['name', 'shortName', 'description']);

const mode = (gm) => (gm === 'pve' ? 'pve' : 'regular');

/** Übersetzt Text-Felder (name, shortName, description) und Gegner-Listen; Schlüssel ohne Übersetzung bleiben. */
function translate(value, dict, field = null) {
  if (typeof value === 'string') return (field && TEXT_FIELDS.has(field)) || field === '*' ? (dict(value) ?? value) : value;
  if (Array.isArray(value)) return value.map((v) => translate(v, dict, field === 'enemies' ? '*' : null));
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = translate(v, dict, k);
    return o;
  }
  return value;
}

/** Ein Übersetzungsschlüssel ohne Übersetzung („<id> Name“) soll nicht als Name erscheinen. */
const clean = (s) => (typeof s === 'string' && /^[0-9a-f]{24} (Name|ShortName|Description|Nickname|name)$/i.test(s) ? null : s);

class TarkovJson {
  constructor({ fetch }) { this.fetch = fetch; this.memo = new Map(); }

  async getJson(path) {
    const r = await this.fetch(`${BASE}/${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) {
      const e = new Error(`json.tarkov.dev antwortet mit HTTP ${r.status} (${path})`);
      e.status = r.status; throw e;
    }
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error('json.tarkov.dev: Datei zu groß (' + path + ')');
    return JSON.parse(text);
  }

  /** Datei + deutsche Übersetzung (englisch als Rückfall), 30 min im Speicher, gleichzeitige Abrufe gebündelt. */
  async file(gm, name) {
    const key = mode(gm) + '/' + name;
    const hit = this.memo.get(key);
    if (hit && (hit.pending || hit.at > Date.now() - TTL)) return hit.pending || hit.value;
    const pending = (async () => {
      const [main, de, en] = await Promise.all([
        this.getJson(key),
        this.getJson(key + '_de').catch(() => null),
        this.getJson(key + '_en').catch(() => null),
      ]);
      if (!main || typeof main !== 'object' || !main.data) throw new Error('json.tarkov.dev: unerwartetes Format (' + key + ')');
      const d1 = de?.data || {}; const d2 = en?.data || {};
      const dict = (k) => (Object.prototype.hasOwnProperty.call(d1, k) ? d1[k] : Object.prototype.hasOwnProperty.call(d2, k) ? d2[k] : undefined);
      return translate(main.data, dict);
    })();
    this.memo.set(key, { pending });
    try {
      const value = await pending;
      this.memo.set(key, { value, at: Date.now() });
      return value;
    } catch (e) {
      this.memo.delete(key);
      log.warn('Abruf fehlgeschlagen: ' + key + ' – ' + e.message);
      throw e;
    }
  }

  // ---- Grunddaten -----------------------------------------------------------

  async itemIndex(gm) {
    const d = await this.file(gm, 'items');
    const traders = await this.traderNames(gm).catch(() => new Map());
    const idx = new Map();
    for (const it of Object.values(d.items || {})) {
      idx.set(it.id, {
        id: it.id, name: clean(it.name) || it.normalizedName || it.id, shortName: clean(it.shortName) || clean(it.name) || it.id,
        normalizedName: it.normalizedName, description: clean(it.description) || '', types: it.types || [], basePrice: it.basePrice ?? null,
        avg24hPrice: it.avg24hPrice ?? null, lastLowPrice: it.lastLowPrice ?? null, low24hPrice: it.low24hPrice ?? null, updated: it.updated || null,
        width: it.width || 1, height: it.height || 1, wikiLink: it.wikiLink || null, iconLink: it.iconLink || null,
        sellFor: (it.sellToTrader || it.sellFor || []).map((x) => ({ vendor: { name: traders.get(x.trader) || x.trader || 'Händler' }, priceRUB: x.priceRUB ?? x.price ?? 0 })),
        buyFor: (it.buyFromTrader || it.buyFor || []).map((x) => ({ vendor: { name: traders.get(x.trader) || x.trader || 'Händler' }, priceRUB: x.priceRUB ?? x.price ?? 0 })),
        properties: it.properties || null,
      });
    }
    return idx;
  }

  async traderNames(gm) {
    const d = await this.file(gm, 'traders');
    return new Map(Object.values(d).filter((t) => t && t.id).map((t) => [t.id, clean(t.name) || t.normalizedName]));
  }

  async mapIndex(gm) {
    const d = await this.file(gm, 'maps');
    return new Map(Object.values(d.maps || {}).map((m) => [m.id, { id: m.id, name: clean(m.name) || m.normalizedName, normalizedName: m.normalizedName, nameId: m.nameId }]));
  }

  // ---- Abfragen in GraphQL-Form --------------------------------------------

  async maps(gm) {
    const [d, items] = await Promise.all([this.file(gm, 'maps'), this.itemIndex(gm).catch(() => new Map())]);
    const mobs = d.mobs || {};
    const item = (id) => { const i = items.get(id); return i ? { id: i.id, name: i.name, shortName: i.shortName, wikiLink: i.wikiLink } : id ? { id, name: id, shortName: id, wikiLink: null } : null; };
    const pos = (p) => (p ? { x: p.x, y: p.y, z: p.z } : null);
    return Object.values(d.maps || {}).map((m) => ({
      id: m.id, name: clean(m.name) || m.normalizedName, normalizedName: m.normalizedName, nameId: m.nameId, raidDuration: m.raidDuration ?? null, players: m.players ?? null, wiki: m.wiki || null,
      extracts: (m.extracts || []).map((x) => ({ id: x.id, name: clean(x.name) || x.name, faction: x.faction, position: pos(x.position) })),
      transits: (m.transits || []).map((x) => ({ id: x.id, description: clean(x.description) || x.description, position: pos(x.position) })),
      locks: (m.locks || []).map((l) => ({ lockType: l.lockType, needsPower: !!l.needsPower, position: pos(l.position), key: item(l.key) })),
      bosses: (m.bosses || []).map((b) => ({ boss: { name: clean(mobs[b.mob]?.name) || b.mob }, spawnChance: b.spawnChance, spawnLocations: (b.spawnLocations || []).map((s) => ({ name: s.name, chance: s.chance })) })),
    }));
  }

  /** Alle Quests mit den Feldern, die Questliste, Raid-Planer, Questpunkte und benötigte Items brauchen. */
  async tasks(gm) {
    const [d, maps, items, traders] = await Promise.all([this.file(gm, 'tasks'), this.mapIndex(gm), this.itemIndex(gm).catch(() => new Map()), this.traderNames(gm).catch(() => new Map())]);
    const questItems = d.questItems || {};
    const mapRef = (id) => { const m = maps.get(id); return m ? { name: m.name, normalizedName: m.normalizedName } : null; };
    const itemRef = (id) => { const i = items.get(id) || questItems[id]; return i ? { id, name: clean(i.name) || i.normalizedName || id, shortName: clean(i.shortName) || clean(i.name) || id } : null; };
    return Object.values(d.tasks || {}).map((t) => ({
      id: t.id, name: clean(t.name) || t.normalizedName, normalizedName: t.normalizedName, minPlayerLevel: t.minPlayerLevel || 0,
      kappaRequired: !!t.kappaRequired, lightkeeperRequired: !!t.lightkeeperRequired, wikiLink: t.wikiLink || null, experience: t.experience ?? null,
      trader: t.trader ? { name: traders.get(t.trader) || t.trader } : null, map: mapRef(t.map),
      taskRequirements: (t.taskRequirements || []).map((q) => ({ task: { id: q.task }, status: q.status || [] })),
      objectives: (t.objectives || []).map((o) => ({
        id: o.id, type: o.type, description: clean(o.description) || '', optional: !!o.optional,
        maps: (o.maps || []).map(mapRef).filter(Boolean),
        count: o.count ?? null, foundInRaid: !!o.foundInRaid,
        items: (o.items || []).map(itemRef).filter(Boolean),
        markerItem: o.markerItem ? itemRef(o.markerItem) : null,
        questItem: o.questItem ? itemRef(o.questItem) : null,
        requiredKeys: (o.requiredKeys || []).map((alt) => (Array.isArray(alt) ? alt : [alt]).map(itemRef).filter(Boolean)),
        zones: (o.zones || []).map((z) => ({ map: mapRef(z.map), position: z.position })),
        possibleLocations: (o.possibleLocations || []).map((l) => ({ map: mapRef(l.map), positions: l.positions || [] })),
      })),
    }));
  }

  async hideoutStations(gm) {
    const [d, items] = await Promise.all([this.file(gm, 'hideout'), this.itemIndex(gm).catch(() => new Map())]);
    const stations = Object.values(d).filter((s) => s && s.id);
    const names = new Map(stations.map((s) => [s.id, clean(s.name) || s.normalizedName]));
    return stations.map((s) => ({
      id: s.id, name: names.get(s.id), normalizedName: s.normalizedName,
      levels: (s.levels || []).map((l) => ({
        id: l.id, level: l.level, constructionTime: l.constructionTime ?? null,
        itemRequirements: (l.itemRequirements || []).map((r) => { const i = items.get(r.item); return { item: { id: r.item, name: i?.name || r.item, shortName: i?.shortName || r.item }, count: r.count || 1 }; }),
        stationLevelRequirements: (l.stationLevelRequirements || []).map((r) => ({ station: { id: r.station, name: names.get(r.station) || r.station }, level: r.level })),
        bonuses: (l.bonuses || []).map((b) => ({ type: b.type, value: b.value })),
      })),
    }));
  }

  async traders(gm) {
    const d = await this.file(gm, 'traders');
    return Object.values(d).filter((t) => t && t.id).map((t) => ({ id: t.id, name: clean(t.name) || t.normalizedName, normalizedName: t.normalizedName, resetTime: t.resetTime || null }));
  }

  /** Itemsuche wie GraphQL items(name, type): alle Suchwörter müssen in Name oder Kurzname vorkommen. */
  async searchItems(gm, { name, type, ids, limit = 30 } = {}) {
    const idx = await this.itemIndex(gm);
    if (ids) return ids.map((id) => idx.get(id)).filter(Boolean).map(({ properties, ...rest }) => rest);
    const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const words = norm(name).split(' ').filter(Boolean);
    const out = [];
    for (const it of idx.values()) {
      if (type && !it.types.includes(type)) continue;
      if (words.length) { const hay = norm(it.name) + ' ' + norm(it.shortName); if (!words.every((w) => hay.includes(w))) continue; }
      out.push(it);
    }
    const q = norm(name);
    const rank = (it) => (norm(it.name) === q || norm(it.shortName) === q ? 0 : norm(it.shortName).startsWith(q) || norm(it.name).startsWith(q) ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length).slice(0, limit).map(({ properties, ...rest }) => rest);
  }

  async ammo(gm) {
    const idx = await this.itemIndex(gm);
    return [...idx.values()].filter((i) => i.properties?.propertiesType === 'ItemPropertiesAmmo').map((i) => ({
      item: { id: i.id, name: i.name, shortName: i.shortName, avg24hPrice: i.avg24hPrice },
      caliber: i.properties.caliber, damage: i.properties.damage, penetrationPower: i.properties.penetrationPower, armorDamage: i.properties.armorDamage,
      projectileCount: i.properties.projectileCount || 1, fragmentationChance: i.properties.fragmentationChance || 0,
    }));
  }

  async goonReports(gm) {
    const d = await this.file(gm, 'maps');
    const maps = await this.mapIndex(gm);
    return (d.goonReports || []).map((g) => { const m = maps.get(g.map?.id || g.map) || null; return { map: m ? { name: m.name, normalizedName: m.normalizedName, nameId: m.nameId } : null, timestamp: g.timestamp }; });
  }

  /** Crafts/Tauschgeschäfte: Items mit Preisen wie in der GraphQL-Antwort. */
  async recipes(gm, kind) {
    const [d, items, traders, hideout] = await Promise.all([this.file(gm, kind), this.itemIndex(gm), this.traderNames(gm).catch(() => new Map()), kind === 'crafts' ? this.file(gm, 'hideout').catch(() => ({})) : null]);
    const list = Array.isArray(d) ? d : Array.isArray(d[kind]) ? d[kind] : Object.values(d[kind] || d);
    const stations = new Map(Object.values(hideout || {}).filter((s) => s && s.id).map((s) => [s.id, { name: clean(s.name) || s.normalizedName, normalizedName: s.normalizedName }]));
    const ref = (x) => { const id = x.item?.id || x.item; const i = items.get(id); return { item: i ? { id: i.id, name: i.name, shortName: i.shortName, avg24hPrice: i.avg24hPrice, sellFor: i.sellFor, buyFor: i.buyFor } : { id, name: id }, count: x.count || 1 }; };
    return list.filter((x) => x && x.id).map((x) => ({
      id: x.id, level: x.level ?? x.minTraderLevel ?? null, duration: x.duration ?? null,
      station: x.station ? (stations.get(x.station?.id || x.station) || { name: x.station, normalizedName: x.station }) : null,
      trader: x.trader ? { name: traders.get(x.trader?.id || x.trader) || x.trader } : null,
      rewardItems: (x.rewardItems || [x.offeredItem || x.productItem].filter(Boolean)).map(ref),
      requiredItems: (x.requiredItems || []).filter((r) => !r.attributes?.tool).map(ref),
    }));
  }
}

module.exports = { TarkovJson, translate, BASE };
