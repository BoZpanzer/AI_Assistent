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
  { id: 'streets-of-tarkov', svg: 'StreetsOfTarkov.svg', transform: [0.38, 0, 0.38, 0], rotation: 180, bounds: [[323, -295], [-280, 532]], layer: 'Ground_Level' },
  { id: 'ground-zero', svg: 'GroundZero.svg', transform: [0.524, 167.3, 0.524, 65.1], rotation: 180, bounds: [[249, -124], [-99, 364]], layer: 'Ground_Level' },
  { id: 'customs', svg: 'Customs.svg', transform: [0.239, 168.65, 0.239, 136.35], rotation: 180, bounds: [[698, -307], [-372, 237]], layer: 'Ground_Level' },
  { id: 'factory', svg: 'Factory.svg', transform: [1.629, 119.9, 1.629, 139.3], rotation: 90, bounds: [[77, -64.5], [-65.5, 67.4]], layer: 'Ground_Floor' },
  { id: 'interchange', svg: 'Interchange.svg', transform: [0.265, 150.6, 0.265, 134.6], rotation: 180, bounds: [[598, -442], [-433, 426]], layer: 'Ground_Level' },
  { id: 'lighthouse', svg: 'Lighthouse.svg', transform: [0.2, 0, 0.2, 0], rotation: 180, bounds: [[515, -998], [-545, 725]], layer: 'Ground_Level' },
  { id: 'reserve', svg: 'Reserve.svg', transform: [0.395, 122.0, 0.395, 137.65], rotation: 180, bounds: [[289, -293], [-303, 244]], svgBounds: [[289, -274], [-303, 272]], layer: 'Ground_Level' },
  { id: 'shoreline', svg: 'Shoreline.svg', transform: [0.16, 83.2, 0.16, 111.1], rotation: 180, bounds: [[504, -415], [-1056, 618]], layer: 'Ground_Level' },
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

/** SVG für die Anzeige als Bild vorbereiten: nur Erdgeschoss, feste Größe im richtigen Seitenverhältnis, nichts Aktives. */
function prepareSvg(text, def, aspect) {
  let t = String(text);
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(t)) throw new Error('Keine SVG-Datei');
  t = t.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(\s(?:xlink:)?href\s*=\s*)("|')\s*(?:https?:|javascript:|data:text\/html)[^"']*\2/gi, '$1$2#$2');
  const W = aspect >= 1 ? 4096 : Math.round(4096 * aspect); const H = aspect >= 1 ? Math.round(4096 / aspect) : 4096;
  const layer = String(def.layer || 'Ground_Level').replace(/[^\w-]/g, '');
  const css = `<style id="jarvis-layers">:root > g[id]:not(#${layer}):not([data-keep-with-group="${layer}"]) { display: none !important; }</style>`;
  t = t.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    const a = attrs.replace(/\s(width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    return `<svg${a} width="${W}" height="${H}">${css}`;
  });
  return { svg: t, width: W, height: H };
}

class TarkovMaps {
  constructor(gaming, ctx) { this.g = gaming; this.fetch = ctx.fetch; this.busy = null; }

  async defs() {
    try {
      const r = await this.fetch(MAPS_JSON, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const out = [];
      for (const m of j) for (const mp of m.maps || []) {
        if (mp.projection !== 'interactive' || !mp.svgPath || !Array.isArray(mp.transform) || !Array.isArray(mp.bounds)) continue;
        out.push({ id: m.normalizedName, svg: String(mp.svgPath).split('/').pop(), transform: mp.transform, rotation: mp.coordinateRotation || 0, bounds: mp.bounds, svgBounds: mp.svgBounds, layer: mp.svgLayer || 'Ground_Level' });
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
      const ours = !!this.g.context.getState(`mapsrc:eft:${def.id}`);
      if (existing?.image_file && this.g.mapImagePath('eft', def.id) && (!force || !ours)) { skipped.push(def.id); continue; }
      try {
        const { affine, aspect } = affineFor(def);
        const { svg, width, height } = prepareSvg(await this.download(def.svg), def, aspect);
        this.g.saveMapFile('eft', def.id, Buffer.from(svg, 'utf8'), '.svg', { width, height });
        this.g.context.setState(`calib:eft:${def.id}`, { affine, source: 'tarkov.dev', attribution: ATTRIBUTION });
        this.g.context.setState(`mapsrc:eft:${def.id}`, { source: 'tarkov.dev', file: def.svg, at: new Date().toISOString() });
        done.push(def.id);
      } catch (e) { failed.push({ id: def.id, error: e.message }); log.warn(`Karte ${def.id} nicht geladen`, e); }
    }
    if (done.length) this.g.bus.emit('game:markers', { game: 'eft' });
    return { done, skipped, failed, attribution: ATTRIBUTION, notIncluded: ['the-lab', 'the-labyrinth', 'icebreaker'] };
  }
}

module.exports = { TarkovMaps, affineFor, project, prepareSvg, SNAPSHOT, ATTRIBUTION };
