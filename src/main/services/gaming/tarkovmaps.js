'use strict';
const fs = require('node:fs');
const path = require('node:path');
const log = require('../../core/logger').scope('tarkovmaps');

/**
 * Tarkov-Karten automatisch einfügen: die Vektorkarten von tarkov.dev (Shebuka, „tarkov-dev-svg-maps“,
 * Lizenz CC BY-NC-SA 4.0 – private, nicht-kommerzielle Nutzung mit Namensnennung; nicht für Cheat-Software).
 * Die Karten werden auf DEINEM PC heruntergeladen (nicht mit JARVIS ausgeliefert) und mit derselben
 * Koordinaten-Umrechnung wie auf tarkov.dev hinterlegt – Exits und Schlösser aus der tarkov.dev-API
 * erscheinen dadurch ohne eigenes Kalibrieren an der richtigen Stelle.
 *
 * Umrechnung (wie tarkov.dev/Leaflet): Spielposition (x, z) → Drehung um coordinateRotation →
 * Pixel = (sx·x' + mx, −sz·z' + mz); das SVG liegt über dem Rechteck aus `bounds` ([x, z]-Paare).
 * Daraus ergibt sich eine affine Abbildung auf 0..1-Bildkoordinaten: nx = a·x + b·z + c, ny = d·x + e·z + f.
 */
const MAPS_JSON = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json';
const SVG_SOURCES = ['https://assets.tarkov.dev/maps/svg/', 'https://raw.githubusercontent.com/the-hideout/tarkov-dev-svg-maps/refs/heads/main/'];
const ATTRIBUTION = 'Karte: Shebuka / tarkov.dev (CC BY-NC-SA 4.0)';
// Stand der tarkov.dev-Daten (Oktober 2026) – falls maps.json gerade nicht erreichbar ist
const SNAPSHOT = [
  { id: 'streets-of-tarkov', svg: 'StreetsOfTarkov.svg', transform: [0.38, 0, 0.38, 0], rotation: 180, bounds: [[323, -295], [-280, 532]], layer: 'Ground_Level', layers: [{name: '2nd Floor', svgLayer: 'Second_Floor'}, {name: '3rd Floor', svgLayer: 'Third_Floor'}, {name: '4th Floor', svgLayer: 'Fourth_Floor'}, {name: '5th Floor', svgLayer: 'Fifth_Floor'}, {name: 'Underground', svgLayer: 'Underground_Level'}] },
  { id: 'ground-zero', svg: 'GroundZero.svg', transform: [0.524, 167.3, 0.524, 65.1], rotation: 180, bounds: [[249, -124], [-99, 364]], layer: 'Ground_Level', layers: [{name: '2nd Floor', svgLayer: 'Second_Floor'}, {name: '3rd Floor', svgLayer: 'Third_Floor'}, {name: 'Garage', svgLayer: 'Underground_Level'}] },
  { id: 'customs', svg: 'Customs.svg', transform: [0.239, 168.65, 0.239, 136.35], rotation: 180, bounds: [[698, -307], [-372, 237]], layer: 'Ground_Level', layers: [{name: '2nd Floor', svgLayer: 'Second_Floor'}, {name: '3rd Floor', svgLayer: 'Third_Floor'}, {name: 'Underground', svgLayer: 'Underground_Level'}] },
  { id: 'factory', svg: 'Factory.svg', transform: [1.629, 119.9, 1.629, 139.3], rotation: 90, bounds: [[77, -64.5], [-65.5, 67.4]], layer: 'Ground_Floor', layers: [{name: '2nd Floor', svgLayer: 'Second_Floor'}, {name: '3rd Floor', svgLayer: 'Third_Floor'}, {name: 'Tunnels', svgLayer: 'Basement'}] },
  { id: 'interchange', svg: 'Interchange.svg', transform: [0.265, 150.6, 0.265, 134.6], rotation: 180, bounds: [[598, -442], [-433, 426]], layer: 'Ground_Level', layers: [{name: '2nd Floor', svgLayer: 'First_Floor'}, {name: '3rd Floor', svgLayer: 'Second_Floor'}] },
  { id: 'lighthouse', svg: 'Lighthouse.svg', transform: [0.2, 0, 0.2, 0], rotation: 180, bounds: [[515, -998], [-545, 725]], layer: 'Ground_Level' },
  { id: 'reserve', svg: 'Reserve.svg', transform: [0.395, 122.0, 0.395, 137.65], rotation: 180, bounds: [[289, -293], [-303, 244]], svgBounds: [[289, -274], [-303, 272]], layer: 'Ground_Level', layers: [{name: 'Bunkers', svgLayer: 'Bunkers'}] },
  { id: 'shoreline', svg: 'Shoreline.svg', transform: [0.16, 83.2, 0.16, 111.1], rotation: 180, bounds: [[504, -415], [-1056, 618]], layer: 'Ground_Level', layers: [{name: '2nd Floor', svgLayer: 'Second_Floor'}, {name: '3rd Floor', svgLayer: 'Third_Floor'}, {name: 'Underground', svgLayer: 'Underground_Level'}] },
  { id: 'terminal', svg: 'Terminal.svg', transform: [0.2, 0, 0.2, 0], rotation: 180, bounds: [[463, -580], [-433, 475]], layer: 'Ground_Level' },
  { id: 'woods', svg: 'Woods.svg', transform: [0.1855, 112.95, 0.1855, 167.85], rotation: 180, bounds: [[646, -914], [-761, 442]], layer: 'Ground_Level' },
];
// Labs, Labyrinth, Icebreaker gibt es bei tarkov.dev nur als Kachelbilder – nicht enthalten.

/** Spiel-(x,z) → Pixel wie tarkov.dev (Leaflet CRS mit Drehung + Transformation). */
function project(def, x, z) {
  const r = ((def.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const xr = x * c - z * s; const zr = x * s + z * c;
  const [sx, mx, sz, mz] = def.transform || [1, 0, 1, 0];
  return { px: sx * xr + mx, py: -sz * zr + mz };
}

/** Affine Abbildung (x, z) → (0..1, 0..1) über dem SVG-Rechteck; dazu das Seitenverhältnis des Rechtecks. */
function affineFor(def) {
  const b = def.svgBounds || def.bounds;
  const p0 = project(def, b[0][0], b[0][1]); const p1 = project(def, b[1][0], b[1][1]);
  const minX = Math.min(p0.px, p1.px), minY = Math.min(p0.py, p1.py);
  const W = Math.abs(p1.px - p0.px), H = Math.abs(p1.py - p0.py);
  if (!W || !H) throw new Error('Ungültige Kartengrenzen');
  const o = project(def, 0, 0); const ex = project(def, 1, 0); const ez = project(def, 0, 1);
  // linear in x und z → Koeffizienten aus drei Punkten
  const a = (ex.px - o.px) / W, b2 = (ez.px - o.px) / W, c = (o.px - minX) / W;
  const d = (ex.py - o.py) / H, e = (ez.py - o.py) / H, f = (o.py - minY) / H;
  return { affine: [a, b2, c, d, e, f], aspect: W / H };
}

/** Oberste Ebenen (Stockwerke) des SVG: [{ id, keepWith }] – nur direkte Kinder des <svg>. */
function topGroups(text) {
  const out = []; let depth = 0;
  for (const m of String(text).matchAll(/<(\/?)(svg|g)\b([^>]*?)(\/?)>/gi)) {
    const [, close, tag, attrs, self] = m;
    if (close) { depth--; continue; }
    if (tag.toLowerCase() === 'g' && depth === 1) {
      const id = attrs.match(/\sid\s*=\s*"([^"]+)"/)?.[1];
      if (id) out.push({ id, keepWith: attrs.match(/data-keep-with-group\s*=\s*"([^"]+)"/)?.[1] || null });
    }
    if (!self) depth++;
  }
  return out;
}
const FLOOR_LABEL = { First_Floor: '1. OG', Second_Floor: '2. OG', Third_Floor: '3. OG', Fourth_Floor: '4. OG', Fifth_Floor: '5. OG', Underground_Level: 'Untergeschoss', Basement: 'Tunnel', Bunkers: 'Bunker', Ground_Floor: 'Erdgeschoss', Ground_Level: 'Erdgeschoss' };
const LAYER_DE = { '2nd floor': '1. OG', '3rd floor': '2. OG', '4th floor': '3. OG', '5th floor': '4. OG', underground: 'Untergeschoss', tunnels: 'Tunnel', garage: 'Tiefgarage', bunkers: 'Bunker' };
/** Wählbare Stockwerke (ohne Basisebene und die mit ihr gezeigten). Namen aus maps.json, sonst aus der Ebenen-ID. */
function floorsOf(text, def) {
  const base = def.layer || 'Ground_Level';
  const named = Object.fromEntries((def.layers || []).filter((l) => l.svgLayer).map((l) => [l.svgLayer, LAYER_DE[String(l.name).toLowerCase()] || l.name]));
  return topGroups(text).filter((g) => g.id !== base && g.keepWith !== base && /^[\w-]+$/.test(g.id)).map((g) => ({ id: g.id, label: named[g.id] || FLOOR_LABEL[g.id] || g.id.replace(/_/g, ' ') }));
}

/**
 * SVG für die Anzeige als Bild vorbereiten: feste Größe im richtigen Seitenverhältnis, nichts Aktives.
 * Ohne `floor` nur die Basisebene (Erdgeschoss); mit `floor` das Stockwerk über der abgedunkelten Basis.
 */
function prepareSvg(text, def, aspect, floor = null) {
  let t = String(text);
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(t)) throw new Error('Keine SVG-Datei');
  t = t.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(\s(?:xlink:)?href\s*=\s*)("|')\s*(?:https?:|javascript:|data:text\/html)[^"']*\2/gi, '$1$2#$2');
  const W = aspect >= 1 ? 4096 : Math.round(4096 * aspect); const H = aspect >= 1 ? Math.round(4096 / aspect) : 4096;
  const layer = String(def.layer || 'Ground_Level').replace(/[^\w-]/g, '');
  const fl = floor ? String(floor).replace(/[^\w-]/g, '') : null;
  const css = fl
    ? `<style id="jarvis-layers">:root > g[id]:not(#${layer}):not([data-keep-with-group="${layer}"]):not(#${fl}):not([data-keep-with-group="${fl}"]) { display: none !important; } :root > g#${layer}, :root > g[data-keep-with-group="${layer}"] { opacity: 0.3; }</style>`
    : `<style id="jarvis-layers">:root > g[id]:not(#${layer}):not([data-keep-with-group="${layer}"]) { display: none !important; }</style>`;
  t = t.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    const a = attrs.replace(/\s(width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    return `<svg${a} width="${W}" height="${H}">${css}`;
  });
  return { svg: t, width: W, height: H };
}

class TarkovMaps {
  constructor(gaming, ctx) { this.g = gaming; this.fetch = ctx.fetch; this.busy = null; }

  /** Bundled Wiki images use separate IDs: pixel routes/calibration must never leak across images. */
  importWiki() {
    const dir = path.join(__dirname, '../../assets/tarkov-wiki');
    const manifest = require('../../assets/tarkov-wiki/manifest.json');
    const done = [], skipped = [], failed = [];
    for (const def of manifest) {
      const id = def.baseMap + '-wiki';
      if (this.g.mapImagePath('eft', id)) { skipped.push(id); continue; }
      try {
        const bytes = fs.readFileSync(path.join(dir, def.file));
        if (require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== def.sha256) throw new Error('Kartenbild-Prüfsumme stimmt nicht');
        this.g.saveMapFile('eft', id, bytes, '.webp', def);
        this.g.context.setState(`mapsrc:eft:${id}`, { source: 'wiki-bundle', baseMap: def.baseMap, label: def.label + ' · Wiki', attribution: 'Escape from Tarkov Wiki · RE3MR / Jindouz / xTycho und Autoren im Kartenbild · CC BY-NC-SA 4.0', floors: [], calibrationStatus: 'unverified' });
        done.push(id);
      } catch (e) { failed.push({ id, error: e.message }); }
    }
    if (done.length) this.g.bus.emit('game:markers', { game: 'eft' });
    return { done, skipped, failed };
  }

  /** Accept only image-hash-bound, independently verified local image registration. */
  saveWikiAlignment(map, alignment) {
    const id = String(map || '');
    const def = require('../../assets/tarkov-wiki/manifest.json').find(d => d.id === id);
    const file = def && this.g.mapImagePath('eft', id);
    if (!file) throw new Error('Keine originale Wiki-Karte');
    const src = JSON.parse(this.g.context.getState('mapsrc:eft:' + id) || 'null');
    if (src?.source !== 'wiki-bundle') throw new Error('Keine Wiki-Bundle-Karte');
    const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (hash !== def.sha256) throw new Error('Wiki-Kartenbild verändert');
    const base = JSON.parse(this.g.context.getState('calib:eft:' + def.baseMap) || 'null');
    if (!Array.isArray(base?.affine) || base.affine.length !== 6) throw new Error('Zuerst SVG-Referenzkarte laden');
    const { affine: a, quality: q } = alignment || {};
    if (!Array.isArray(a) || a.length !== 6 || !a.every(Number.isFinite) || !q || q.inliers < 12 || q.spread < .28 || q.medianError > .007) throw new Error('Bildzuordnung nicht ausreichend sicher');
    // compose game->SVG with SVG->Wiki
    const b = base.affine;
    const composed = [a[0]*b[0]+a[1]*b[3],a[0]*b[1]+a[1]*b[4],a[0]*b[2]+a[1]*b[5]+a[2],a[3]*b[0]+a[4]*b[3],a[3]*b[1]+a[4]*b[4],a[3]*b[2]+a[4]*b[5]+a[5]];
    this.g.context.setState('calib:eft:' + id, { affine: composed, imageHash: hash, source: 'auto-image-registration', quality: q });
    this.g.context.setState('mapsrc:eft:' + id, { ...src, calibrationStatus: 'auto' });
    this.g.bus.emit('game:markers', { game: 'eft', map: id });
    return { affine: composed, quality: q };
  }

  wikiAlignmentSource(map) {
    const def = require('../../assets/tarkov-wiki/manifest.json').find(d => d.id === map);
    if (!def || !this.g.mapImagePath('eft', def.baseMap)) return null;
    const cal = JSON.parse(this.g.context.getState('calib:eft:' + def.baseMap) || 'null');
    const src = JSON.parse(this.g.context.getState('mapsrc:eft:' + def.baseMap) || 'null');
    return Array.isArray(cal?.affine) && src?.source === 'tarkov.dev' ? def.baseMap : null;
  }

  async defs() {
    try {
      const r = await this.fetch(MAPS_JSON, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const out = [];
      for (const m of j) for (const mp of m.maps || []) {
        if (mp.projection !== 'interactive' || !mp.svgPath || !Array.isArray(mp.transform) || !Array.isArray(mp.bounds)) continue;
        out.push({ id: m.normalizedName, svg: String(mp.svgPath).split('/').pop(), transform: mp.transform, rotation: mp.coordinateRotation || 0, bounds: mp.bounds, svgBounds: mp.svgBounds, layer: mp.svgLayer || 'Ground_Level', layers: (mp.layers || []).map((l) => ({ name: l.name, svgLayer: l.svgLayer })) });
      }
      if (out.length >= 5) return out;
    } catch (e) { log.info('maps.json nicht erreichbar, nutze gespeicherten Stand: ' + e.message); }
    return SNAPSHOT;
  }

  async download(file) {
    let last;
    for (const base of SVG_SOURCES) {
      try {
        const r = await this.fetch(base + encodeURIComponent(file), { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const t = await r.text();
        if (t.length > 40 * 1024 * 1024) throw new Error('Datei zu groß');
        return t;
      } catch (e) { last = e; }
    }
    throw last || new Error('nicht erreichbar');
  }

  /** Alle (oder eine) Karte laden. Eigene, selbst importierte Kartenbilder werden nicht überschrieben (außer force). */
  importAll({ only, force = false } = {}) {
    if (!this.busy) this.busy = this._import({ only, force }).finally(() => { this.busy = null; });
    return this.busy;
  }

  async _import({ only, force }) {
    const defs = (await this.defs()).filter((d) => !only || d.id === only);
    const done = [], skipped = [], failed = [];
    for (const def of defs) {
      const existing = this.g.db.get('SELECT image_file FROM game_maps WHERE game=? AND name=?', 'eft', def.id);
      // vorhandene Karten (eigene Bilder oder schon geladene) nur mit force ersetzen; eigene Bilder nie automatisch
      let src = null; try { src = JSON.parse(this.g.context.getState(`mapsrc:eft:${def.id}`) || 'null'); } catch { src = null; }
      const ours = !!src;
      // ältere JARVIS-Karten ohne Stockwerke einmal automatisch erneuern
      const upgrade = ours && !Array.isArray(src.floors);
      if (existing?.image_file && this.g.mapImagePath('eft', def.id) && (!(force || upgrade) || !ours)) { skipped.push(def.id); continue; }
      try {
        const { affine, aspect } = affineFor(def);
        const raw = await this.download(def.svg);
        const { svg, width, height } = prepareSvg(raw, def, aspect);
        this.g.saveMapFile('eft', def.id, Buffer.from(svg, 'utf8'), '.svg', { width, height });
        const floors = floorsOf(raw, def).slice(0, 8);
        for (const f of floors) this.g.saveLayerFile('eft', def.id, f.id, Buffer.from(prepareSvg(raw, def, aspect, f.id).svg, 'utf8'));
        this.g.context.setState(`calib:eft:${def.id}`, { affine, source: 'tarkov.dev', attribution: ATTRIBUTION });
        this.g.context.setState(`mapsrc:eft:${def.id}`, { source: 'tarkov.dev', file: def.svg, at: new Date().toISOString(), floors });
        done.push(def.id);
      } catch (e) { failed.push({ id: def.id, error: e.message }); log.warn(`Karte ${def.id} nicht geladen`, e); }
    }
    if (done.length) this.g.bus.emit('game:markers', { game: 'eft' });
    return { done, skipped, failed, attribution: ATTRIBUTION, notIncluded: ['the-lab', 'the-labyrinth', 'icebreaker'] };
  }
}

module.exports = { TarkovMaps, affineFor, project, prepareSvg, floorsOf, topGroups, SNAPSHOT, ATTRIBUTION };

