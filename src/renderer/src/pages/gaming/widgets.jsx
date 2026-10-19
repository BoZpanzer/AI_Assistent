import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { Map as MapIcon, Maximize2, Minimize2, Plus, Minus, Crosshair, Footprints, Package, TriangleAlert, Target, KeyRound, MapPin, Trash2, Undo2, Layers, Route, ImagePlus, Search, ExternalLink, Timer, NotebookPen, Globe, Bell, ListChecks, Trophy, RefreshCw, Swords, Eye, TrendingUp, TrendingDown, GraduationCap, Shield, BarChart3, Radio, Sparkles, X, Check, Ruler, Skull, Castle, FlaskConical, Hammer, Link as LinkIcon, MessageCircleQuestion, CalendarClock, SendHorizontal } from 'lucide-preact';
import { rpc, useRpc, useEvent, cleanErr } from '../../lib/api.js';
import { guard, toast, setState, getState, useStore } from '../../lib/store.js';
import { Panel, Checkbox, Empty, SourceTag, Spinner, useNow, ask, Select } from '../../components/ui.jsx';
import { countdown, ago, fmtDateTime } from '../../lib/format.js';
import { renderMarkdown, onMarkdownClick } from '../../lib/markdown.js';
import { createMapAutoRetry } from '../../lib/map-auto-retry.mjs';

export const SPAN = {
  map: 'w-7', 'tarkov-raidplan': 'w-5', 'tarkov-companion': 'w-5', 'tarkov-needed': 'w-7', 'tarkov-hideout': 'w-6', 'tarkov-raid': 'w-5', 'tarkov-quests': 'w-4', 'tarkov-item': 'w-4', checklist: 'w-6', 'other-games': 'w-6',
  'lol-overview': 'w-12', 'lol-champions': 'w-6', 'lol-matches': 'w-6', 'lol-coaching': 'w-6', 'lol-live': 'w-6', 'lol-goals': 'w-6', 'lol-champion': 'w-12', 'lol-champselect': 'w-6', 'lol-review': 'w-6', 'lol-mistakes': 'w-6', 'lol-game': 'w-12', 'lol-coach': 'w-6', playtime: 'w-6', news: 'w-6', servers: 'w-6', deals: 'w-6', 'rok-speedups': 'w-6', 'ark-breeding': 'w-6', 'cs2-matches': 'w-6', 'racing-laps': 'w-6', 'pubg-matches': 'w-6', 'stardew-farm': 'w-6', 'wiki-lists': 'w-6', 'factorio-calc': 'w-12', 'tarkov-economy': 'w-6', 'lol-progress': 'w-6', 'tarkov-ammo': 'w-6',
  ask: 'w-12', links: 'w-6', 'game-stats': 'w-6', timers: 'w-6', 'rok-planner': 'w-6', progress: 'w-6', 'game-research': 'w-12', wiki: 'w-6', notes: 'w-6', sources: 'w-6',
};

// ---------------------------------------------------------------- Map
const CATS = [
  { id: 'exit', label: 'Exits', icon: Footprints, cls: 'mk-exit' },
  { id: 'loot', label: 'Loot', icon: Package, cls: 'mk-loot' },
  { id: 'danger', label: 'Gefahr', icon: TriangleAlert, cls: 'mk-danger' },
  { id: 'quest', label: 'Quest', icon: Target, cls: 'mk-quest' },
  { id: 'key', label: 'Schlüssel', icon: KeyRound, cls: 'mk-key' },
  { id: 'custom', label: 'Eigene', icon: MapPin, cls: 'mk-custom' },
];

function MapWidget({ game, params }) {
  const isEft = game.id === 'eft';
  const [eftMaps] = useRpc('tarkov.maps', {}, { enabled: isEft, initial: null });
  const [userMaps, reloadMaps] = useRpc('game.maps', { game: game.id }, { events: ['game:markers'], initial: [] });
  const options = useMemo(() => {
    const names = new Map();
    for (const m of eftMaps?.maps || []) names.set(m.id, m.name);
    for (const m of userMaps || []) if (!names.has(m.name)) names.set(m.name, m.source?.label || m.name);
    if (!names.size) names.set('Hauptkarte', 'Hauptkarte');
    return [...names.entries()].map(([value, label]) => ({ value, label }));
  }, [eftMaps, userMaps]);
  const [map, setMap] = useState(params.map || (isEft ? 'customs' : 'Hauptkarte'));
  useEffect(() => { if (params.map) setMap(params.map); }, [params.map]);
  useEffect(() => { rpc('game.setLastMap', { game: game.id, map }).catch(() => {}); }, [game.id, map]);
  const [markers, reloadMarkers] = useRpc('game.markers', { game: game.id, map }, { events: ['game:markers'], initial: [], deps: [map] });
  const [routes] = useRpc('game.routes', { game: game.id, map }, { events: ['game:markers'], initial: [], deps: [map] });
  const baseMap = (userMaps || []).find((m) => m.name === map)?.source?.baseMap || map;
  const [apiMap, , apiState] = useRpc('tarkov.map', { map: baseMap }, { enabled: isEft, deps: [baseMap] });
  const meta = (userMaps || []).find((m) => m.name === map);
  const [pos, setPos] = useState(null);
  const [follow, setFollow] = useState(true);
  const nowT = useNow(5000);
  useEffect(() => { if (isEft) rpc('tarkov.position').then(setPos).catch(() => {}); }, [isEft]);
  useEvent('game:position', (p) => { if (!isEft || p.game !== 'eft') return; setPos(p); if (follow && p.map && p.map !== baseMap) setMap(p.map); });
  const [autoAligning, setAutoAligning] = useState(false);
  const autoAttempts = useRef(createMapAutoRetry());
  const [autoRetryTick, setAutoRetryTick] = useState(0);
  const autoKey = `${map}:${meta?.hasImage && meta?.source?.source === 'wiki-bundle' ? 'wiki:' + (meta?.source?.at || '') : 'svg'}`;
  const retryStatus = autoAttempts.current.status(autoKey);
  const calibratedAlternative = (userMaps || []).find((m) => m.name === baseMap && m.hasImage && m.calibration?.affine);
  const retryMap = () => { autoAttempts.current.reset(autoKey); setAutoRetryTick((v) => v + 1); };
  const alignWiki = async ({ quiet = false } = {}) => {
    if (!meta?.hasImage || meta?.source?.source !== 'wiki-bundle') return false;
    setAutoAligning(true);
    try {
      let reference = await rpc('tarkov.wikiAlignmentSource', { map });
      if (!reference) {
        await rpc('tarkov.importMaps', { map: baseMap });
        reference = await rpc('tarkov.wikiAlignmentSource', { map });
        reloadMaps();
      }
      if (!reference) { if (!quiet) toast('Für diese Karte ist momentan keine SVG-Referenz verfügbar.', 'error'); return false; }
      const image = async (name) => {
        const url = `app://jarvis/map-image/eft/${encodeURIComponent(name)}`;
        const el = new Image();
        el.src = url;
        await el.decode();
        const scale = Math.min(1, 520 / Math.max(el.naturalWidth, el.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(el.naturalWidth * scale);
        canvas.height = Math.round(el.naturalHeight * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { width: data.width, height: data.height, data: Array.from(data.data) };
      };
      const [source, target] = await Promise.all([image(reference), image(map)]);
      const alignment = await rpc('tarkov.alignWikiImages', { source, target });
      if (!alignment) { if (!quiet) toast('Keine sichere Bildzuordnung gefunden. Die SVG-Karte ist bereits automatisch kalibriert.', 'error'); return false; }
      await rpc('tarkov.saveWikiAlignment', { map, alignment });
      reloadMaps();
      if (!quiet) toast(`Wiki-Karte kalibriert (${alignment.quality.inliers} übereinstimmende Bildpunkte)`);
      return true;
    } catch (e) { if (!quiet) toast('Automatische Kalibrierung fehlgeschlagen: ' + cleanErr(e), 'error'); return false; }
    finally { setAutoAligning(false); }
  };
  const [loadingMaps, setLoadingMaps] = useState(false);
  useEffect(() => {
    if (!isEft || autoAligning || loadingMaps || meta?.calibration?.affine) return;
    const wiki = meta?.hasImage && meta?.source?.source === 'wiki-bundle';
    const missingSvg = !meta?.hasImage && !map.endsWith('-wiki');
    // Never auto-register a user-imported image. Only verified wiki images and
    // absent SVG references are eligible.
    if (!wiki && !missingSvg) return;
    const key = `${map}:${wiki ? 'wiki:' + (meta?.source?.at || '') : 'svg'}`;
    const retry = autoAttempts.current;
    const waitMs = retry.due(key);
    if (waitMs === null) return; // succeeded, running, or retry limit reached
    if (waitMs > 0) {
      const timer = setTimeout(() => setAutoRetryTick((v) => v + 1), waitMs);
      return () => clearTimeout(timer);
    }
    if (!retry.start(key)) return;
    (async () => {
      let success = false;
      try {
        if (wiki) {
          success = await alignWiki({ quiet: true });
        } else {
          setLoadingMaps(true);
          const result = await rpc('tarkov.importMaps', { map });
          success = !result?.failed?.length && !!(result?.done?.includes(map) || result?.skipped?.includes(map));
          reloadMaps();
        }
      } catch (e) {
        // Transient network or image-decoding failure: retry with backoff.
      } finally {
        retry.finish(key, success);
        if (!wiki) setLoadingMaps(false);
        // A re-render schedules the next attempt only after its backoff.
        setAutoRetryTick((v) => v + 1);
      }
    })();
  }, [isEft, map, baseMap, meta?.hasImage, meta?.source?.source, meta?.source?.at,
    meta?.calibration?.affine, autoAligning, loadingMaps, autoRetryTick]);
  useEffect(() => { if (isEft) rpc('tarkov.importWikiMaps').then(reloadMaps).catch(() => toast('Wiki-Karten konnten nicht bereitgestellt werden', 'error')); }, [isEft]);
  const loadEftMaps = async ({ force = false, quiet = false } = {}) => {
    setLoadingMaps(true);
    const r = quiet ? await rpc('tarkov.importMaps', { force }).catch(() => null) : await guard(() => rpc('tarkov.importMaps', { force }));
    setLoadingMaps(false); reloadMaps();
    if (r && !quiet) toast(r.done.length ? `${r.done.length} Karten von tarkov.dev geladen` : r.failed.length ? 'Karten konnten nicht geladen werden: ' + r.failed[0].error : 'Alle Karten sind schon da', r.failed.length && !r.done.length ? 'error' : undefined, 6000);
    return r;
  };
  const [tool, setTool] = useState('custom');
  const [visible, setVisible] = useState(Object.fromEntries(CATS.map((c) => [c.id, true])));
  const [showApi, setShowApi] = useState(true);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const [history, setHistory] = useState([]);
  const [routeDraft, setRouteDraft] = useState(null);
  const [goal] = useRpc('tarkov.routeGoal', { map }, { enabled: isEft, deps: [map], events: ['game:markers'] });
  const [placingGoal, setPlacingGoal] = useState(false);
  useEffect(() => { setRouteDraft(null); setPlacingGoal(false); setCalib(null); setLandmark('manual'); }, [map]);
  const [landmark, setLandmark] = useState('manual');
  const references = (apiMap?.map?.extracts || []).filter(e => Number.isFinite(e.position?.x) && Number.isFinite(e.position?.z));
  const [calib, setCalib] = useState(null); // {step, points:[]}
  const [imgSize, setImgSize] = useState({ w: 1600, h: 1000 });
  // Clicks are converted to 0..1 image coordinates – only valid once the real image size is known.
  const [imgReady, setImgReady] = useState(false);
  const box = useRef(); const drag = useRef(null);
  const floors = Array.isArray(meta?.source?.floors) ? meta.source.floors : [];
  const [floor, setFloor] = useState(null);
  const [showQuests, setShowQuests] = useState(true);
  const imgUrl = meta?.hasImage ? `app://jarvis/map-image/${encodeURIComponent(game.id)}/${encodeURIComponent(map)}${floor ? '?layer=' + encodeURIComponent(floor) + '&v=' + encodeURIComponent(meta.source?.at || '') : ''}` : null;
  useEffect(() => { setView({ z: 1, x: 0, y: 0 }); setFloor(null); setImgReady(false); }, [map]);
  const fit = () => { const el = box.current; if (!el) return; const z = Math.min(el.clientWidth / imgSize.w, el.clientHeight / imgSize.h); setView({ z, x: (el.clientWidth - imgSize.w * z) / 2, y: (el.clientHeight - imgSize.h * z) / 2 }); };
  useEffect(() => { const t = setTimeout(fit, 50); return () => clearTimeout(t); }, [imgSize.w, imgSize.h, full, map]);
  const toNorm = (e) => { const r = box.current.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / (imgSize.w * view.z), y: (e.clientY - r.top - view.y) / (imgSize.h * view.z) }; };
  // Game (x,z) → normalized image coordinates via 2-point similarity transform
  const transform = useMemo(() => {
    // tarkov.dev-Karte: feste affine Umrechnung (x, z) → 0..1
    const af = meta?.calibration?.affine;
    if (Array.isArray(af) && af.length === 6) return (x, z) => ({ x: af[0] * x + af[1] * z + af[2], y: af[3] * x + af[4] * z + af[5] });
    const c = meta?.calibration?.points;
    if (!c || c.length !== 2) return null;
    const [a, b] = c;
    const gx = b.gx - a.gx, gz = b.gz - a.gz, ix = b.ix - a.ix, iy = b.iy - a.iy;
    const gl = Math.hypot(gx, gz), il = Math.hypot(ix * imgSize.w, iy * imgSize.h);
    if (!gl || !il) return null;
    const s = il / gl; const rot = Math.atan2(iy * imgSize.h, ix * imgSize.w) - Math.atan2(gz, gx);
    return (x, z) => { const dx = x - a.gx, dz = z - a.gz; const px = (dx * Math.cos(rot) - dz * Math.sin(rot)) * s, py = (dx * Math.sin(rot) + dz * Math.cos(rot)) * s; return { x: a.ix + px / imgSize.w, y: a.iy + py / imgSize.h }; };
  }, [meta?.calibration, imgSize]);
  const [questMarks] = useRpc('tarkov.questMarkers', { map: baseMap }, { enabled: isEft && showQuests && !!transform, deps: [baseMap, showQuests, !!transform], events: ['game:progress'] });
  const questPins = isEft && showQuests && transform ? (questMarks?.markers || []).map((q) => ({ ...transform(q.x, q.z), category: 'quest', label: q.task.length > 22 ? q.task.slice(0, 21) + '…' : q.task, objective: q.objective, task: q.task, api: true })) : [];
  const faction = useStore((x) => x.settings?.gaming?.eftFaction) || 'pmc';
  const apiPins = isEft && showApi && transform && apiMap?.map ? [
    ...apiMap.map.extracts.filter((e) => e.position && (faction === 'all' || !e.faction || e.faction === faction || e.faction === 'shared')).map((e) => { const kind = exitKind(e.name); return { ...transform(e.position.x, e.position.z), category: 'exit', label: e.name + (faction === 'all' && e.faction && e.faction !== 'shared' ? ` (${e.faction === 'pmc' ? 'PMC' : 'Scav'})` : ''), api: true, color: EXIT_COLOR[kind], kind }; }),
    ...(apiMap.map.transits || []).filter((t) => t.position).map((t) => ({ ...transform(t.position.x, t.position.z), category: 'exit', label: 'Transit: ' + (t.description || ''), api: true, color: EXIT_COLOR.transit, kind: 'transit' })),
    ...(apiMap.map.locks || []).filter((l) => l.position && l.key).slice(0, 80).map((l) => ({ ...transform(l.position.x, l.position.z), category: 'key', label: l.key.shortName || l.key.name, api: true })),
  ] : [];
  const click = async (e) => {
    if (drag.current?.moved) return;
    const p = toNorm(e);
    if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return;
    if (calib) {
      if (imgUrl && !imgReady) return toast('Kartenbild lädt noch – bitte gleich erneut klicken.', 'error');
      const known = landmark === 'manual' ? null : references[Number(landmark)];
      const ref = known ? `${known.position.x}, ${known.position.z}` : await ask(`Referenzpunkt ${calib.points.length + 1}/3: Spielkoordinaten „x, z“ (drei weit auseinanderliegende Punkte auf der Hauptkarte, keine Stockwerk-Inserts)`, '');
      if (!ref) return;
      const values = ref.trim().split(/[,;\s]+/).map(Number);
      if (values.length !== 2 || !values.every(Number.isFinite)) return toast('Bitte zwei Zahlen eingeben', 'error');
      const [gx, gz] = values;
      const pts = [...calib.points, { ix: p.x, iy: p.y, gx, gz }];
      if (pts.length === 3) {
        const saved = await guard(() => rpc('game.calibrate', { game: game.id, map, points: pts }), 'Kalibrierung berechnet – Positionen bitte an weiteren Landmarken prüfen');
        if (saved) { setCalib(null); reloadMaps(); }
      } else setCalib({ points: pts });
      return;
    }
    if (placingGoal) {
      const label = goal?.label || await ask('Dein Routenziel', '');
      if (label && await guard(() => rpc('tarkov.setRouteGoal', { map, goal: { ...p, label, floor } }))) setPlacingGoal(false);
      return;
    }
    if (routeDraft) { setRouteDraft([...routeDraft, p]); return; }
    const label = await ask(`${CATS.find((c) => c.id === tool).label}-Marker – Beschriftung`, '');
    if (label === null) return;
    const id = await guard(() => rpc('game.addMarker', { game: game.id, map, marker: { ...p, category: tool, label } }));
    if (id) setHistory([...history, id]);
  };
  const wheel = (e) => { e.preventDefault(); const r = box.current.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const z2 = Math.max(0.1, Math.min(8, view.z * (e.deltaY < 0 ? 1.15 : 0.87))); setView({ z: z2, x: mx - (mx - view.x) * (z2 / view.z), y: my - (my - view.y) * (z2 / view.z) }); };
  const zoom = (f) => { const el = box.current; const mx = el.clientWidth / 2, my = el.clientHeight / 2; const z2 = Math.max(0.1, Math.min(8, view.z * f)); setView({ z: z2, x: mx - (mx - view.x) * (z2 / view.z), y: my - (my - view.y) * (z2 / view.z) }); };
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; };
  const onMove = (e) => { const d = drag.current; if (!d || !(e.buttons & 1)) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true; if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy })); };
  const onUp = () => { setTimeout(() => { drag.current = null; }, 0); };
  const editMarker = async (m) => {
    if (placingGoal) { await guard(() => rpc('tarkov.setRouteGoal', { map, goal: { x: m.x, y: m.y, label: m.task || m.label || 'Ziel', floor } })); setPlacingGoal(false); return; }
    if (m.api) return toast(m.objective ? `${m.task}: ${m.objective} (Quelle: tarkov.dev)` : `${m.label} (Quelle: tarkov.dev)`, undefined, m.objective ? 8000 : undefined);
    const label = await ask('Marker bearbeiten – Beschriftung (leer = löschen)', m.label || '');
    if (label === null) return;
    if (!label.trim()) { await rpc('game.removeMarker', { id: m.id }); return; }
    await rpc('game.updateMarker', { id: m.id, patch: { label } });
  };
  // eigene Position (aus dem letzten Tarkov-Screenshot) als Pfeil in Blickrichtung
  const me = isEft && pos && pos.map === baseMap && transform ? (() => { const a = transform(pos.x, pos.z); const b = transform(pos.x + pos.fx * 10, pos.z + pos.fz * 10); return { ...a, angle: Math.atan2((b.y - a.y) * imgSize.h, (b.x - a.x) * imgSize.w) * 180 / Math.PI, at: pos.at }; })() : null;
  const all = [...markers.filter((m) => visible[m.category]), ...apiPins.filter((m) => visible[m.category]), ...questPins.filter((m) => visible.quest && m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1)];
  const content = (
    <div class={full ? 'overlay' : ''} style={full ? { placeItems: 'stretch', padding: 30 } : undefined}>
      <Panel icon={MapIcon} title={game.name} sub={isEft ? 'Interaktive Karte · eigene Marker' : 'Interaktive Karte'} glow={full} style={full ? { height: '100%' } : undefined}
        right={<div class="row gap-s">
          <Select style={{ width: 170 }} value={map} onChange={setMap} options={options.map((o) => ({ value: o.value, label: 'Karte: ' + o.label }))} />
          <button class="btn sm" onClick={() => setFull(!full)}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{full ? 'Schließen' : 'Vollbild'}</button>
        </div>}>
        {isEft && <div class="notice small mb" role="status">
          {transform ? 'Karte bereit · Spielkoordinaten sind zugeordnet.' : autoAligning || loadingMaps || retryStatus === 'running' ? 'Karte wird automatisch vorbereitet …' : retryStatus === 'waiting' ? 'Vorbereitung noch nicht möglich – JARVIS versucht es automatisch erneut.' : retryStatus === 'failed' ? 'Keine sichere Kartenzuordnung verfügbar. Eigene Marker und Routen bleiben nutzbar; Spielposition und Questpunkte bleiben ausgeblendet.' : 'Spielkoordinaten noch nicht zugeordnet.'}
          {!transform && retryStatus === 'failed' && <button class="btn xs" onClick={retryMap}>Erneut versuchen</button>}
          {apiState?.error && <div class="tiny mt" role="alert">{apiState.error}</div>}
          {!apiState?.error && apiMap?.offline && <div class="tiny muted mt">tarkov.dev gerade nicht erreichbar – gespeicherter Stand vom {fmtDateTime(apiMap.fetchedAt)}.</div>}
          {!transform && calibratedAlternative && map !== baseMap && <button class="btn xs" onClick={() => setMap(baseMap)}>Kalibrierte Karte öffnen</button>}
          <div class="tiny muted">Positionen stammen aus deinem letzten Tarkov-Screenshot, nicht aus einer Live-Ortung.</div>
        </div>}
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, height: full ? 'calc(100% - 10px)' : 380 }}>
          <div class="map-tools">
            <div class="hud-label" style={{ fontSize: 11 }}>Marker setzen</div>
            {isEft && <><button class={`btn xs ${placingGoal ? 'active' : ''}`} onClick={() => { setPlacingGoal(!placingGoal); setRouteDraft(null); setCalib(null); }}><Target size={14} />{placingGoal ? 'Ziel anklicken…' : 'Mein Ziel setzen'}</button>
            {goal && <><span class="tiny">Ziel: {goal.label}{goal.x == null ? ' · noch platzieren' : ''}</span><button class="btn xs" onClick={() => guard(() => rpc('tarkov.setRouteGoal', { map, goal: null }))}>Ziel entfernen</button>
            {goal.x != null && routeDraft && <button class="btn xs" onClick={() => { setRouteDraft([...routeDraft, { x: goal.x, y: goal.y, label: goal.label }]); }}>Ziel an Route anhängen</button>}</>}</>}

            {CATS.map((c) => <div class={`tool ${tool === c.id && !routeDraft && !calib ? 'active' : ''}`} onClick={() => { setTool(c.id); setPlacingGoal(false); setRouteDraft(null); setCalib(null); }} onContextMenu={(e) => { e.preventDefault(); setVisible({ ...visible, [c.id]: !visible[c.id] }); }} title="Rechtsklick: ein-/ausblenden" style={!visible[c.id] ? { opacity: 0.4 } : undefined}><span class={`pin ${c.cls}`} style={{ width: 18, height: 18, borderRadius: 4, display: 'grid', placeItems: 'center' }}><c.icon size={12} color="white" /></span>{c.label}</div>)}
            <div class="tool" onClick={async () => { const last = history.at(-1); if (!last) return toast('Nichts zum Rückgängigmachen'); await rpc('game.removeMarker', { id: last }); setHistory(history.slice(0, -1)); }}><Undo2 size={15} />Rückgängig</div>
            <div class="tool" onClick={async () => { if (await ask(`Alle eigenen Marker auf ${map} löschen?`, '', { confirmOnly: true, danger: true, okLabel: 'Löschen' })) rpc('game.clearMarkers', { game: game.id, map }); }}><Trash2 size={15} />Marker löschen</div>
            <div class={`tool ${routeDraft ? 'active' : ''}`} onClick={async () => { if (!routeDraft) { setPlacingGoal(false); setRouteDraft([]); toast('Route: Punkte auf der Karte anklicken, dann erneut auf „Route“'); return; } if (routeDraft.length >= 2) { const n = await ask('Name der Route', 'Route ' + (routes.length + 1)); if (n) await guard(() => rpc('game.saveRoute', { game: game.id, map, name: n, points: routeDraft }), 'Route gespeichert'); } setRouteDraft(null); }}><Route size={15} />Route</div>
            {isEft && <div class={`tool ${loadingMaps ? 'active' : ''}`} title="Vektorkarten von tarkov.dev laden (bereits geladene werden aktualisiert)" onClick={() => !loadingMaps && loadEftMaps({ force: true })}>{loadingMaps ? <Spinner /> : <MapIcon size={15} />}Karten aktualisieren</div>}
            <div class="tool" onClick={() => guard(() => rpc('game.importMap', { game: game.id, name: map }), 'Kartenbild importiert')}><ImagePlus size={15} />Kartenbild</div>
            {isEft && meta?.source?.source === 'wiki-bundle' && <div class={`tool ${autoAligning ? 'active' : ''}`} onClick={() => !autoAligning && alignWiki()} title="Wiki-Karte anhand der lokalen SVG-Referenz automatisch ausrichten">{autoAligning ? <Spinner /> : <Crosshair size={15} />}Auto-Kalibrieren</div>}
            {isEft && (!meta?.calibration?.affine || meta?.source?.source === 'wiki-bundle') && <div class={`tool ${calib ? 'active' : ''}`} title="Drei weit auseinanderliegende Punkte auf der Hauptkarte zuordnen" onClick={() => setCalib(calib ? null : { points: [] })}><Ruler size={15} />Kalibrieren</div>}
            {calib && <><Select value={landmark} onChange={setLandmark} options={[{ value: 'manual', label: 'Koordinaten eingeben' }, ...references.map((e, i) => ({ value: String(i), label: e.name }))]} /><span class="tiny">Exit auswählen, auf Hauptkarte anklicken. Drei verschiedene Punkte; keine Insets.</span></>}
            {isEft && transform && <div class={`tool ${showApi ? 'active' : ''}`} onClick={() => setShowApi(!showApi)}><Layers size={15} />Exits & Schlüssel</div>}
            {isEft && transform && showApi && <div class="row" style={{ gap: 3, flexWrap: 'wrap' }} title="Welche Exits angezeigt werden">{[['pmc', 'PMC'], ['scav', 'Scav'], ['all', 'Alle']].map(([v, l]) => <span class={`chip ${faction === v ? 'active' : ''}`} style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => guard(() => rpc('settings.update', { gaming: { eftFaction: v } }))}>{l}</span>)}</div>}
            {isEft && transform && showApi && <div class="tiny muted" style={{ lineHeight: 1.5 }}>{Object.entries({ normal: 'Exit', flare: 'Flare', coop: 'Co-op', car: 'Auto', transit: 'Transit' }).map(([k, l]) => <span style={{ whiteSpace: 'nowrap', marginRight: 6 }}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: EXIT_COLOR[k], marginRight: 3 }} />{l}</span>)}</div>}
            {isEft && <div class={`tool ${follow ? 'active' : ''}`} title="Karte wechselt automatisch zur Raid-Karte, sobald du im Spiel einen Screenshot machst (Position + Blickrichtung)" onClick={() => setFollow(!follow)}><Crosshair size={15} />Position{pos ? ' ✓' : ''}</div>}
            {isEft && transform && <div class={`tool ${showQuests ? 'active' : ''}`} title="Ziele deiner offenen Quests (ohne erledigte, bis zu deinem Level) – Quelle tarkov.dev" onClick={() => setShowQuests(!showQuests)}><Target size={15} />Questziele{showQuests && questMarks?.markers ? ` (${questMarks.markers.length})` : ''}</div>}
          </div>
          <div class={`map-box ${imgUrl ? '' : 'grid-fallback'}`} ref={box} onWheel={wheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onClick={click}>
            <div class="map-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, width: imgSize.w, height: imgSize.h }}>
              {imgUrl ? <img src={imgUrl} onLoad={(e) => { const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight; if (w > 0 && h > 0) { setImgSize({ w, h }); setImgReady(true); } }} onError={() => setImgReady(false)} /> : <div style={{ width: imgSize.w, height: imgSize.h }} />}
              <svg width={imgSize.w} height={imgSize.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {[...routes, ...(routeDraft ? [{ id: 'draft', points: routeDraft }] : [])].map((r) => <polyline points={r.points.map((p) => `${p.x * imgSize.w},${p.y * imgSize.h}`).join(' ')} fill="none" stroke={r.id === 'draft' ? '#facc15' : '#22d3ee'} stroke-width={4 / view.z} stroke-dasharray={`${12 / view.z} ${8 / view.z}`} />)}
                {routes.map((r) => { const end = r.points.at(-1); return end && <g><circle cx={end.x * imgSize.w} cy={end.y * imgSize.h} r={7 / view.z} fill="#22d3ee" /><text x={end.x * imgSize.w} y={end.y * imgSize.h - 12 / view.z} fill="#22d3ee" font-size={13 / view.z}>{end.label || r.name}</text></g>; })}
              </svg>
              {isEft && goal?.x != null && (goal.floor || null) === floor && <div class="marker" style={{ left: goal.x * imgSize.w, top: goal.y * imgSize.h, transform: `translate(-50%, -100%) scale(${1 / view.z})`, transformOrigin: '50% 100%', zIndex: 6 }} onClick={(e) => e.stopPropagation()}><div class="pin mk-quest" style={{ background: '#e879f9' }}><Target size={18} /></div><div class="lbl">ZIEL · {goal.label}</div></div>}
              {me && (nowT - Date.parse(me.at)) < 900000 && <div class="marker" title={`Du – Stand ${new Date(me.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} (letzter Screenshot)`} style={{ left: me.x * imgSize.w, top: me.y * imgSize.h, transform: `translate(-50%, -50%) scale(${1 / view.z})`, zIndex: 5 }} onClick={(e) => e.stopPropagation()}>
                <svg width="30" height="30" viewBox="-15 -15 30 30" style={{ opacity: nowT - Date.parse(me.at) < 120000 ? 1 : nowT - Date.parse(me.at) < 300000 ? 0.6 : 0.35, transform: `rotate(${me.angle + 90}deg)`, filter: 'drop-shadow(0 0 6px rgba(250,204,21,.9))' }}><circle r="13" fill="rgba(250,204,21,.18)" /><path d="M0 -11 L8 8 L0 4 L-8 8 Z" fill="#facc15" stroke="#000" stroke-width="1.5" /></svg>
                <div class="lbl" style={{ color: '#facc15' }}>{(() => { const s = (nowT - Date.parse(me.at)) / 1000; return s < 60 ? 'Screenshot · gerade' : `Screenshot · vor ${Math.round(s / 60)} min`; })()}</div>
              </div>}
              {all.map((m) => { const c = CATS.find((x) => x.id === m.category) || CATS[5]; return (
                <div class="marker" style={{ left: m.x * imgSize.w, top: m.y * imgSize.h, transform: `translate(-50%, -100%) scale(${1 / view.z})`, transformOrigin: '50% 100%', opacity: m.api ? 0.85 : 1 }} onClick={(e) => { e.stopPropagation(); editMarker(m); }}>
                  <div class={`pin ${c.cls}`} style={m.api ? { borderStyle: 'dashed', ...(m.color ? { background: m.color } : {}) } : undefined}>{m.kind === 'transit' ? <Route size={13} /> : <c.icon size={13} />}</div>
                  {m.label && <div class="lbl">{m.label}</div>}
                </div>); })}
            </div>
            <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button class="btn icon xs" onClick={(e) => { e.stopPropagation(); zoom(1.25); }}><Plus size={14} /></button>
              <button class="btn icon xs" onClick={(e) => { e.stopPropagation(); zoom(0.8); }}><Minus size={14} /></button>
              <button class="btn icon xs" onClick={(e) => { e.stopPropagation(); fit(); }}><Crosshair size={14} /></button>
            </div>
            {!imgUrl && <div style={{ position: 'absolute', left: 12, bottom: 10, right: 12 }} class="notice">Kein Kartenbild hinterlegt. Importiere ein Kartenbild, das du verwenden darfst (z. B. eigener Screenshot) – Marker funktionieren auch auf dem Raster. {isEft ? 'Kalibrierte Vektorkarten kannst du über „Karten aktualisieren“ ergänzen. Die zwölf mitgelieferten Wiki-Karten findest du in der Kartenauswahl unter „Wiki“; sie sind offline verfügbar.' : ''}</div>}
            {imgUrl && meta?.source?.source === 'wiki-bundle' && !transform && !calib && <div class="notice" style={{ position: 'absolute', left: 8, top: 8, maxWidth: '75%', pointerEvents: 'none' }}>Wiki-Karte: Ziele und Routen per Klick nutzbar. Spielkoordinaten noch nicht kalibriert; Spielposition, Exits und Questpunkte bleiben ausgeblendet.</div>}
            {calib && <div style={{ position: 'absolute', left: 12, top: 10 }} class="chip active">Kalibrierung: Punkt {calib.points.length + 1}/3 anklicken</div>}
            {imgUrl && (meta?.calibration?.attribution || meta?.source?.attribution) && <div class="tiny" style={{ position: 'absolute', left: 8, bottom: 6, opacity: 0.7, background: 'rgba(0,0,0,.45)', padding: '1px 6px', borderRadius: 4, pointerEvents: 'none' }}>{meta.calibration?.attribution || meta.source?.attribution}</div>}
            {imgUrl && floors.length > 0 && <div class="row gap-s" style={{ position: 'absolute', right: 10, bottom: 8, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '70%' }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              {[{ id: null, label: 'Erdgeschoss' }, ...floors].map((f) => <button class={`chip ${floor === f.id ? 'active' : ''}`} onClick={() => setFloor(f.id)}>{f.label}</button>)}
            </div>}
            {!imgUrl && isEft && loadingMaps && <div style={{ position: 'absolute', left: 12, top: 10 }} class="chip active"><Spinner /> Lade Karte von tarkov.dev …</div>}
          </div>
        </div>
      </Panel>
    </div>
  );
  return content;
}

// ---------------------------------------------------------------- Tarkov
/** Exit-Art aus dem Namen (wie im Hauptprozess): Leuchtpatrone, Co-op, Fahrzeug, sonst normal. */
const exitKind = (n) => (/flare|leucht/i.test(n) ? 'flare' : /co-?op|koop/i.test(n) ? 'coop' : /\bv-?ex\b|vehicle|fahrzeug|\bcar\b|\bauto\b/i.test(n) ? 'car' : 'normal');
const EXIT_COLOR = { normal: '#22c55e', flare: '#f97316', coop: '#a855f7', car: '#3b82f6', transit: '#22d3ee' };
const mmss = (s) => (s == null ? '–' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const PHASE = { idle: 'Im Menü', searching: 'Suche Match …', found: 'Match gefunden', starting: 'Countdown', inraid: 'Im Raid', ended: 'Raid beendet' };
const MAPNAME = { customs: 'Zollgebiet', factory: 'Fabrik', interchange: 'Interchange', 'the-lab': 'Labor', lighthouse: 'Leuchtturm', reserve: 'Reserve', shoreline: 'Küste', 'streets-of-tarkov': 'Streets', woods: 'Wald', 'ground-zero': 'Ground Zero', 'the-labyrinth': 'Labyrinth', terminal: 'Terminal' };

/** Raid-Begleiter (wie TarkovMonitor): Raid-Status, Timer, Scav-Abklingzeit, Statistik, Goons, letzter Item-Scan. */
function TarkovCompanion() {
  const [st, setSt] = useState(null);
  const now = useNow(1000);
  const [goons, reloadGoons, gst] = useRpc('tarkov.goons', {}, {});
  const [scan, setScan] = useState(null);
  useEffect(() => { rpc('tarkov.raidState').then(setSt).catch(() => {}); }, []);
  useEvent('eft:raid', setSt);
  useEvent('eft:scan', (d) => setScan(d));
  const cfg = useStore((x) => x.settings?.gaming) || {};
  const elapsed = st?.phase === 'inraid' && st.startedAt ? (now - Date.parse(st.startedAt)) / 1000 : null;
  const rtLeft = elapsed != null ? Math.max(0, (cfg.eftRunthroughSec ?? 430) - elapsed) : null;
  const scavLeft = st?.scavReadyAt ? Math.max(0, (Date.parse(st.scavReadyAt) - now) / 1000) : null;
  const plays = Object.entries(st?.stats?.plays || {}).sort((a, b) => b[1] - a[1]);
  const flea = st?.stats?.flea || {};
  const report = async () => { if (!(await ask('Goons auf deiner aktuellen Raid-Karte an tarkov.dev melden? (Dabei wird deine Tarkov-Account-ID mitgeschickt, wie bei TarkovMonitor.)', '', { confirmOnly: true, okLabel: 'Melden' }))) return; const r = await guard(() => rpc('tarkov.reportGoons'), 'Goon-Sichtung gemeldet – danke!'); if (r) reloadGoons(); };
  return (
    <Panel icon={Timer} title="Raid-Begleiter" sub="Aus den Tarkov-Logs · wie TarkovMonitor">
      <div class="row"><b class="grow">{PHASE[st?.phase] || 'Warte auf Tarkov'}{st?.map && st.phase !== 'idle' ? ` · ${MAPNAME[st.map] || st.map}` : ''}</b>{st?.type && st.phase === 'inraid' ? <span class="chip static">{st.type === 'pmc' ? 'PMC' : 'Scav'}</span> : null}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }} class="mt">
        <div class="sub-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}><span class="tiny muted">Raid-Zeit</span><b style={{ fontSize: 18 }}>{mmss(elapsed)}</b></div>
        <div class="sub-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}><span class="tiny muted">Runthrough</span><b style={{ fontSize: 18, color: rtLeft === 0 ? 'var(--green)' : undefined }}>{rtLeft == null ? '–' : rtLeft === 0 ? 'vorbei' : mmss(rtLeft)}</b></div>
        <div class="sub-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }} title="Schätzung: Basiszeit (Einstellungen) minus gebaute Hideout-Boni"><span class="tiny muted">Scav bereit</span><b style={{ fontSize: 18, color: scavLeft === 0 ? 'var(--green)' : undefined }}>{scavLeft == null ? '–' : scavLeft === 0 ? 'jetzt' : mmss(scavLeft)}</b></div>
      </div>
      {plays.length > 0 && <div class="small muted mt">Raids: {plays.map(([m, n]) => `${MAPNAME[m] || m} ${n}`).join(' · ')}</div>}
      {flea.count > 0 && <div class="small muted">Flohmarkt: {flea.count} Verkäufe · {(flea.rub || 0).toLocaleString('de-DE')} ₽{flea.usd ? ` · ${flea.usd.toLocaleString('de-DE')} $` : ''}{flea.eur ? ` · ${flea.eur.toLocaleString('de-DE')} €` : ''}</div>}
      <div class="hr" />
      <div class="row"><b class="grow small">Goons – letzte Sichtungen</b><button class="btn xs" onClick={report}>Goons gesehen</button></div>
      {gst.error ? <div class="tiny muted">{gst.error}</div> : (goons || []).slice(0, 5).map((g) => <div class="row small"><span class="grow">{MAPNAME[g.map] || g.mapName}</span><span class="muted">{ago(g.at)}</span></div>)}
      <div class="hr" />
      <div class="row"><b class="grow small">Item-Scanner</b><span class="tiny muted">Taste im Spiel: {cfg.eftScanHotkey || 'Alt+Shift+S'} (Maus aufs Item)</span></div>
      {scan?.state === 'running' && <div class="small"><Spinner /> Erkenne Item …</div>}
      {scan?.state === 'error' && <div class="small" style={{ color: 'var(--red)' }}>{scan.error}</div>}
      {scan?.state === 'done' && <ScanResult s={scan} />}
    </Panel>
  );
}

export function ScanResult({ s }) {
  const rub = (v) => (v == null ? '–' : v.toLocaleString('de-DE') + ' ₽');
  return (
    <div class="col" style={{ gap: 2 }}>
      <div class="row"><b class="grow">{s.name}</b><span class="tiny muted">{s.slots} Slot{s.slots > 1 ? 's' : ''}</span></div>
      <div class="small">Flohmarkt Ø24h: <b>{rub(s.flea)}</b> · Händler: <b>{s.trader ? `${rub(s.trader.price)} (${s.trader.name})` : '–'}</b></div>
      <div class="small">Wert pro Slot: <b>{rub(s.perSlot)}</b></div>
      {s.need ? <div class="small" style={{ color: '#facc15' }}>Gebraucht: {[s.need.quest ? `${s.need.quest}× Quests${s.need.questFir ? ` (${s.need.questFir} FIR)` : ''}` : null, s.need.hideout ? `${s.need.hideout}× Hideout` : null].filter(Boolean).join(' · ')}<div class="tiny muted">{[...s.need.tasks, ...s.need.stations].join(', ')}</div></div> : <div class="tiny muted">Nicht für offene Quests oder dein Hideout gebraucht.</div>}
      {s.alternatives?.length > 0 && <div class="tiny muted">Erkannt als „{s.recognized}“ – falls falsch: {s.alternatives.join(', ')}</div>}
    </div>
  );
}

/** Benötigte Items (wie TarkovTracker): offene Quests (FIR) + noch nicht gebaute Hideout-Stufen; Kappa/Lightkeeper. */
function TarkovNeeded({ params }) {
  const [kappaOnly, setKappaOnly] = useState(!!params.kappaOnly);
  const [q, setQ] = useState('');
  const [d, , st] = useRpc('tarkov.needed', { kappaOnly }, { deps: [kappaOnly], events: ['game:progress', 'game:data'] });
  const list = (d?.items || []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.short.toLowerCase().includes(q.toLowerCase()));
  const bar = (p) => <div style={{ height: 5, background: 'var(--line)', borderRadius: 3 }}><div style={{ width: (p.total ? (100 * p.done) / p.total : 0) + '%', height: '100%', background: 'var(--cyan)', borderRadius: 3 }} /></div>;
  return (
    <Panel icon={ListChecks} title="Benötigte Items" sub="Offene Quests + Hideout · tarkov.dev" right={<label class="row gap-s small"><Checkbox checked={kappaOnly} onChange={setKappaOnly} />nur Kappa</label>}>
      {st.error && <div class="notice warn small">{st.error}</div>}
      {d && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div><div class="row tiny"><span class="grow">Kappa-Quests</span><b>{d.kappa.done}/{d.kappa.total}</b></div>{bar(d.kappa)}</div>
        <div><div class="row tiny"><span class="grow">Lightkeeper-Quests</span><b>{d.lightkeeper.done}/{d.lightkeeper.total}</b></div>{bar(d.lightkeeper)}</div>
      </div>}
      <input class="inp mt" placeholder="Item suchen …" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <div class="col mt scroll" style={{ gap: 2, maxHeight: 300 }}>
        {!d && !st.error && <Spinner />}
        {list.slice(0, 150).map((x) => (
          <div class="row small sub-row" title={[...x.tasks.map((t) => 'Quest: ' + t), ...x.stations.map((s) => 'Hideout: ' + s)].join('\n')}>
            <span class="grow ellipsis">{x.name}</span>
            {x.quest > 0 && <span class="chip static" style={{ fontSize: 10 }}>Quests {x.quest}{x.questFir ? ` · FIR ${x.questFir}` : ''}</span>}
            {x.hideout > 0 && <span class="chip static" style={{ fontSize: 10 }}>Hideout {x.hideout}</span>}
            <b style={{ width: 34, textAlign: 'right' }}>{x.total}</b>
          </div>
        ))}
        {d && !list.length && <Empty>Nichts gefunden.</Empty>}
      </div>
      {d && !d.detailed && <div class="tiny muted mt">Quest-Abgaben gerade nicht verfügbar (tarkov.dev-Schema geändert) – Hideout-Items stimmen.</div>}
      {d && <SourceTag source={d.source} fetchedAt={d.fetchedAt} offline={d.offline} />}
    </Panel>
  );
}

/** Hideout: Stufen je Station (aus TarkovTracker, korrigierbar), nächste Stufe mit Anforderungen. */
function TarkovHideout() {
  const [d, reload, st] = useRpc('tarkov.hideout', {}, { events: ['game:data', 'tarkovtracker:status'] });
  const set = async (id, built) => { await guard(() => rpc('tarkov.setHideout', { id, built })); reload(); };
  return (
    <Panel icon={Castle} title="Hideout" sub={d?.fromTracker ? 'Stand aus TarkovTracker · hier korrigierbar' : 'Stufen hier abhaken (oder TarkovTracker verbinden)'}>
      {st.error && <div class="notice warn small">{st.error}</div>}
      {!d && !st.error && <Spinner />}
      <div class="col scroll" style={{ gap: 6, maxHeight: 340 }}>
        {(d?.stations || []).map((s) => (
          <div class="sub-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
            <div class="row"><b class="grow">{s.name}</b><span class="tiny muted">Stufe {s.level}/{s.max}</span>
              {s.level > 0 && <button class="btn icon xs ghost" title="Stufe zurücknehmen" onClick={() => set(s.levels.find((l) => l.level === s.level).id, false)}><Undo2 size={12} /></button>}
              {s.next && <button class="btn xs" title={`Stufe ${s.next.level} als gebaut markieren`} onClick={() => set(s.next.id, true)}><Check size={12} />{s.next.level}</button>}
            </div>
            {s.next && <div class="tiny" style={{ color: s.next.ready ? 'var(--text-2)' : 'var(--text-3)' }}>
              {s.next.ready ? 'Bereit zum Bauen: ' : 'Noch gesperrt: '}{s.next.items.map((i) => `${i.count}× ${i.short || i.name}`).join(', ') || 'keine Items'}{s.next.stations.length ? ` · braucht ${s.next.stations.join(', ')}` : ''}
            </div>}
          </div>
        ))}
      </div>
      {d && <SourceTag source={d.source} fetchedAt={d.fetchedAt} offline={d.offline} />}
    </Panel>
  );
}

/** Raid-Planer: offene, verfügbare Quests → beste Karte, Ziele, was mitnehmen. */
function TarkovRaidPlan({ params }) {
  const [map, setMap] = useState(params.map || '');
  useEffect(() => { if (params.map) setMap(params.map); }, [params.map]);
  const [plan, reload, st] = useRpc('tarkov.raidPlan', { map: map || undefined }, { deps: [map], events: ['game:progress'] });
  const [all] = useRpc('tarkov.raidPlan', {}, { events: ['game:progress'] });
  const ranking = all?.maps || plan?.maps || [];
  const [images] = useRpc('game.maps', { game: 'eft' }, { initial: [], events: ['game:markers'] });
  useEffect(() => { guard(() => rpc('tarkov.importWikiMaps')); }, []);
  const imageFor = id => images.some(m => m.name === id && m.hasImage) ? id : images.find(m => m.hasImage && m.source?.baseMap === id)?.name || id;
  const targetMap = imageFor(map);
  const [goal] = useRpc('tarkov.routeGoal', { map: targetMap }, { enabled: !!map, deps: [targetMap], events: ['game:markers'] });
  const [goalText, setGoalText] = useState('');
  useEffect(() => { setGoalText(goal?.label || ''); }, [goal?.label, targetMap]);
  const showOnMap = (id) => guard(async () => { const selected = imageFor(id); await rpc('game.setLastMap', { game: 'eft', map: selected }); return rpc('game.pushWidget', { game: 'eft', type: 'map', params: { map: selected } }); });
  return (
    <Panel icon={Route} title="Raid-Planer" sub={`Aus deinen offenen Quests${all?.level ? ` · Level ${all.level}` : ''} · tarkov.dev`} right={<Select style={{ width: 170 }} value={map} onChange={setMap} options={[{ value: '', label: 'Beste Karte finden' }, ...ranking.map((m) => ({ value: m.id, label: `${m.name} (${m.tasks})` }))]} />}>
      {st.error && <div class="notice warn small">{st.error}</div>}
      {!plan && !st.error && <Spinner />}
      {plan && !map && <>
        <div class="small muted">{plan.available} Quests verfügbar (erledigte und noch gesperrte ausgeblendet). Karten nach offenen Quests:</div>
        <div class="col mt" style={{ gap: 4 }}>{plan.maps.slice(0, 8).map((m, i) => (
          <div class="row small sub-row" style={{ cursor: 'pointer' }} onClick={() => setMap(m.id)}><b style={{ width: 18 }}>{i + 1}.</b><span class="grow">{m.name}</span><span class="muted">{m.tasks} Quests · {m.objectives} Ziele{m.kappa ? ` · ${m.kappa} Kappa` : ''}</span></div>
        ))}</div>
        {plan.anywhere?.length > 0 && <details class="mt"><summary class="small">Geht auf jeder Karte ({plan.anywhere.length})</summary>{plan.anywhere.map((t) => <div class="small"><b>{t.task}</b> <span class="muted">– {t.objectives.join('; ')}</span></div>)}</details>}
      </>}
      {map && <div class="row wrap gap-s mb"><input class="inp grow" placeholder="Mein Ziel: z. B. Med-Loot, Quest, Exit" value={goalText} onInput={(e) => setGoalText(e.currentTarget.value)} /><button class="btn xs" disabled={!images.some(m => m.name === targetMap && m.hasImage)} onClick={async () => { if (await guard(() => rpc('tarkov.setRouteGoal', { map: targetMap, goal: { ...(goal || {}), label: goalText } }))) await showOnMap(map); }}>Ziel speichern & Karte</button><span class="tiny muted">Auf der Karte „Mein Ziel setzen“ wählen und Position oder Marker anklicken. Route manuell zeichnen.</span></div>}
      {plan && map && <>
        <div class="row small"><span class="grow muted">{plan.tasks?.length || 0} Quests mit Zielen auf dieser Karte</span><button class="btn xs" onClick={() => showOnMap(map)}><MapIcon size={12} />Auf Karte zeigen</button></div>
        {(plan.bring?.items?.length > 0 || plan.bring?.keys?.length > 0) && <div class="notice small mt"><b>Mitnehmen:</b> {[...plan.bring.items.map((x) => `${x.count > 1 ? x.count + '× ' : ''}${x.short}`), ...plan.bring.keys.map((k) => '🔑 ' + k.short)].join(' · ')}</div>}
        {!plan.detailed && <div class="tiny muted mt">Mitnehm-Liste gerade nicht verfügbar (tarkov.dev-Schema geändert) – Ziele unten stimmen trotzdem.</div>}
        <div class="col mt scroll" style={{ gap: 6, maxHeight: 320 }}>{(plan.tasks || []).map((t) => (
          <div class="sub-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
            <div class="row"><b class="grow">{t.task}</b><span class="tiny muted">{t.trader}{t.kappa ? ' · Kappa' : ''}</span></div>
            {t.objectives.map((o) => <div class="small" style={{ color: o.optional ? 'var(--text-3)' : 'var(--text-2)' }}>• {o.text}{o.optional ? ' (optional)' : ''}</div>)}
          </div>
        ))}{!plan.tasks?.length && <Empty>Keine offenen Quest-Ziele auf dieser Karte.</Empty>}</div>
      </>}
      {plan && <SourceTag source={plan.source} fetchedAt={plan.fetchedAt} offline={plan.offline} />}
    </Panel>
  );
}

function TarkovRaid({ game, params }) {
  const [tab, setTab] = useState(params.tab || 'overview');
  const [map, setMap] = useState(params.map || 'customs');
  useEffect(() => { if (params.map) setMap(params.map); if (params.tab) setTab(params.tab); }, [params.map, params.tab]);
  const [maps] = useRpc('tarkov.maps', {}, { initial: null });
  const [data, , st] = useRpc('tarkov.map', { map }, { deps: [map] });
  const m = data?.map;
  return (
    <Panel title="Raid-Status & Intelligente Hilfe" sub="Kartenwissen (keine Live-Raid-Daten verfügbar)" right={<Select style={{ width: 150 }} value={map} onChange={setMap} options={(maps?.maps || [{ id: map, name: map }]).map((x) => ({ value: x.id, label: x.name }))} />}>
      <div class="tabs sm">{[['overview', 'Übersicht'], ['exits', 'Exits'], ['keys', 'Schlüssel'], ['bosses', 'Bosse']].map(([k, l]) => <button class={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {st.error && <div class="notice warn mt">{st.error}</div>}
      {!m && !st.error && <div class="mt"><Spinner /></div>}
      {m && <div class="col mt" style={{ gap: 6, maxHeight: 260, overflow: 'auto' }}>
        {tab === 'overview' && <>
          <div class="small">Spieler: <b>{m.players || '–'}</b> · Raidzeit: <b>{m.raidDuration ? m.raidDuration + ' Min' : '–'}</b></div>
          <div class="small">PMC-Exits: {m.extracts.filter((e) => e.faction === 'pmc' || e.faction === 'shared').length} · Scav-Exits: {m.extracts.filter((e) => e.faction === 'scav' || e.faction === 'shared').length}</div>
          <div class="small">Bosse: {m.bosses.map((b) => `${b.boss?.name} (${Math.round(b.spawnChance * 100)}%)`).join(', ') || 'keine'}</div>
          {m.wiki && <a class="small" onClick={() => rpc('shell.openExternal', { url: m.wiki })}>Wiki-Seite öffnen</a>}
        </>}
        {tab === 'exits' && m.extracts.map((e) => <div class="row small"><Footprints size={14} style={{ color: 'var(--green)' }} /><span class="grow">{e.name}</span><span class="chip static">{{ pmc: 'PMC', scav: 'Scav', shared: 'Beide' }[e.faction] || e.faction}</span></div>)}
        {tab === 'keys' && [...new Map((m.locks || []).filter((l) => l.key).map((l) => [l.key.id, l])).values()].map((l) => <div class="row small"><KeyRound size={14} style={{ color: 'var(--orange)' }} /><span class="grow">{l.key.name}</span>{l.needsPower && <span class="chip static">Strom nötig</span>}{l.key.wikiLink && <ExternalLink size={13} style={{ cursor: 'pointer' }} onClick={() => rpc('shell.openExternal', { url: l.key.wikiLink })} />}</div>)}
        {tab === 'bosses' && m.bosses.map((b) => <div class="small"><Skull size={13} /> <b>{b.boss?.name}</b> – {Math.round(b.spawnChance * 100)}% · {b.spawnLocations.map((s) => s.name).join(', ')}</div>)}
      </div>}
      <div class="mt"><SourceTag source={data?.source} fetchedAt={data?.fetchedAt} offline={data?.offline} /></div>
    </Panel>
  );
}

/** Statistiken: deterministisch im Hauptprozess berechnet (ohne KI). Tarkov-Ergebnisse werden manuell erfasst. */
const PERIODS = [['session', 'Sitzung'], ['today', 'Heute'], ['total', 'Gesamt']];
const OUTCOME_LABEL = { survived: 'Überlebt', runthrough: 'Run-Through', died: 'Gestorben', mia: 'MIA', left: 'Verlassen' };
function GameStats({ game, params }) {
  const isEft = game.id === 'eft';
  const [period, setPeriod] = useState(params.period || 'session');
  const [st, reload] = useRpc('stats.get', { game: isEft ? 'eft' : 'league', period }, { deps: [period], events: ['game:stats', 'game:data'] });
  const [pmc, setPmc] = useState(''); const [ai, setAi] = useState('');
  const [vs, setVs] = useState('');
  const [ctr] = useRpc('stats.counters', { vs: vs || undefined }, { enabled: !isEft, deps: [vs], events: ['game:data'], debounce: 400 });
  const pctTxt = (v) => (v == null ? '–' : String(v).replace('.', ',') + ' %');
  const record = async (outcome) => {
    const r = await guard(() => rpc('stats.recordRaid', { outcome, pmcKills: pmc === '' ? null : Number(pmc), aiKills: ai === '' ? null : Number(ai) }), `Raid eingetragen: ${OUTCOME_LABEL[outcome]}`);
    if (r) { setPmc(''); setAi(''); reload(); }
  };
  const tile = (label, value, title) => <div class="stat-tile" title={title} style={{ minWidth: 90 }}><div class="tiny muted">{label}</div><b style={{ fontSize: 18 }}>{value}</b></div>;
  return (
    <Panel icon={BarChart3} title="Statistiken" sub={isEft ? 'Raids, Überlebensrate, Kills – ohne KI berechnet' : 'Siege, Winrate, Konter – aus deinen Spielen'}
      right={<div class="tabs sm">{PERIODS.map(([k, l]) => <button class={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>}>
      {!st && <Spinner />}
      {st && isEft && <>
        <div class="row wrap gap-s">
          {tile('Raids', st.raids, `${st.byType.pmc} PMC · ${st.byType.scav} Scav`)}
          {tile('Überlebensrate', pctTxt(st.survivalRate), '(überlebt + Run-Through) / Raids mit eingetragenem Ergebnis – keine Winrate')}
          {tile('Tode (KIA)', st.withOutcome ? st.deaths : '–')}
          {tile('PMC-Kills', st.pmcKills ?? '–', `in ${st.pmcKillsRaids} Raids erfasst`)}
          {tile('KI-Kills', st.aiKills ?? '–', `in ${st.aiKillsRaids} Raids erfasst`)}
          {tile('K/D (PMC)', st.kd == null ? '–' : String(st.kd).replace('.', ','), st.kdNote || 'PMC-Kills / Tode in Raids mit erfassten Kills')}
        </div>
        {st.unknownOutcome > 0 && <div class="tiny muted mt">{st.unknownOutcome} Raid(s) ohne Ergebnis – zählen nicht zur Überlebensrate.</div>}
        <div class="hr" />
        <div class="small">Letzten Raid eintragen <span class="tiny muted">(das Spiel-Log enthält kein Ergebnis – manuell, auch per Sprache: „Raid überlebt, 2 Kills“)</span></div>
        <div class="row wrap gap-s mt">
          <input class="inp" style={{ width: 90 }} inputMode="numeric" placeholder="PMC-Kills" value={pmc} onInput={(e) => setPmc(e.currentTarget.value.replace(/\D/g, ''))} />
          <input class="inp" style={{ width: 90 }} inputMode="numeric" placeholder="KI-Kills" value={ai} onInput={(e) => setAi(e.currentTarget.value.replace(/\D/g, ''))} />
          {Object.entries(OUTCOME_LABEL).map(([k, l]) => <button class="btn xs" onClick={() => record(k)}>{l}</button>)}
        </div>
        {st.recent.length > 0 && <details class="mt"><summary class="small">Letzte Raids ({st.recent.length})</summary>
          <div class="col" style={{ gap: 3, maxHeight: 200, overflow: 'auto' }}>{st.recent.map((r) => (
            <div class="row small sub-row"><span class="grow">{fmtDateTime(r.at)} · {r.map || 'Karte ?'}{r.type ? ' · ' + r.type.toUpperCase() : ''}</span>
              <span class="muted">{r.outcome ? OUTCOME_LABEL[r.outcome] : 'kein Ergebnis'}{Number.isInteger(r.pmcKills) ? ` · ${r.pmcKills} PMC` : ''}{Number.isInteger(r.aiKills) ? ` · ${r.aiKills} KI` : ''}{r.source === 'manual' ? ' · manuell' : r.manualResult ? ' · Log + manuell' : ' · Log'}</span>
              <button class="btn icon xs ghost" title="Entfernen" onClick={async () => { if (await ask('Diesen Raid aus der Statistik entfernen?', '', { confirmOnly: true, okLabel: 'Entfernen' })) { await guard(() => rpc('stats.remove', { id: r.id })); reload(); } }}><Trash2 size={12} /></button>
            </div>))}</div></details>}
        <div class="tiny muted mt">Quelle: {st.source}. Tageswechsel 00:00 (Zeitzone des PCs).</div>
      </>}
      {st && !isEft && <>
        <div class="row wrap gap-s">
          {tile('Spiele', st.games)}{tile('Siege', st.games ? st.wins : '–')}{tile('Niederlagen', st.games ? st.losses : '–')}
          {tile('Winrate', pctTxt(st.winrate))}{tile('KDA', st.kda == null ? '–' : String(st.kda).replace('.', ','))}
        </div>
        <div class="hr" />
        <div class="row gap-s"><span class="small grow">Konter aus deinen Spielen</span><input class="inp" style={{ width: 160 }} placeholder="Gegner-Champion…" value={vs} onInput={(e) => setVs(e.currentTarget.value)} /></div>
        {ctr && !ctr.analyzedGames && <div class="tiny muted mt">Noch keine analysierten Spiele mit Lane-Gegner (Spielanalyse auf dieser Seite).</div>}
        {ctr?.analyzedGames > 0 && !vs && <div class="col mt" style={{ gap: 2 }}>{(ctr.hardest || []).map((x) => <div class="row small"><span class="grow">{x.champion}</span><span class="muted">{pctTxt(x.winrate)} · {x.games} Spiele{x.reliable ? '' : ' · wenig Daten'}</span></div>)}{!ctr.hardest?.length && <div class="tiny muted">Noch kein Gegner mit mind. 2 Lane-Duellen.</div>}</div>}
        {ctr?.analyzedGames > 0 && vs && <div class="col mt" style={{ gap: 2 }}>{ctr.overall ? <><div class="small">Gegen {ctr.vs}: {ctr.overall.wins}/{ctr.overall.games} ({pctTxt(ctr.overall.winrate)})</div>{ctr.bestPicks.map((x) => <div class="row small"><span class="grow">{x.champion}</span><span class="muted">{pctTxt(x.winrate)} · {x.games} Spiele{x.reliable ? '' : ' · wenig Daten'}</span></div>)}</> : <div class="tiny muted">Keine Lane-Duelle gegen {vs} gefunden.</div>}</div>}
        <div class="tiny muted mt">Quelle: {st.source}{ctr?.source ? '; Konter: ' + ctr.source : ''}. Allgemeine Konter-Tipps in der Matchup-Karte sind KI-Einschätzung, nicht statistisch belegt.</div>
      </>}
    </Panel>
  );
}

function TarkovQuests({ params }) {
  const [q, setQ] = useState(params.query || '');
  useEffect(() => { if (params.query) setQ(params.query); }, [params.query]);
  const [all, setAll] = useState(false);
  const [r, , st] = useRpc('tarkov.quests', { map: params.map, q, all }, { deps: [q, params.map, all], debounce: 300, events: ['game:progress'] });
  const [doneList] = useRpc('game.doneQuests', {}, { events: ['game:progress'], initial: [] });
  const done = new Set(doneList || []);
  const norm = (x) => String(x).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const [hideDone, setHideDone] = useState(true);
  const [open, setOpen] = useState(null);
  return (
    <Panel title="Quest-Hinweise" sub={(all ? 'Alle Quests' : 'Nur aktuell machbare') + ' · ' + (params.map ? `Karte: ${params.map}` : 'alle Karten')}>
      <div class="row gap-s mb"><span class={`chip ${!all ? 'active' : ''}`} title="Nicht erledigt, Level reicht, Vorgänger erledigt" onClick={() => setAll(false)}>Machbar{r?.available != null && !all ? ` (${r.available})` : ''}</span><span class={`chip ${all ? 'active' : ''}`} onClick={() => setAll(true)}>Alle</span>
        <span class="tiny muted grow" style={{ textAlign: 'right' }}>{r?.level ? `PMC-Level ${r.level}` : 'Level unbekannt – „Mein Level ist 15“ sagen oder TarkovTracker verbinden'}</span></div>
      <div class="row"><input class="inp grow" placeholder="Quest, Händler oder Ziel suchen…" value={q} onInput={(e) => setQ(e.currentTarget.value)} /><span class={`chip ${hideDone ? 'active' : ''}`} title="Erledigte Quests ausblenden" onClick={() => setHideDone(!hideDone)}>{done.size} erledigt {hideDone ? 'ausgeblendet' : 'sichtbar'}</span></div>
      {st.error && <div class="notice warn mt">{st.error}</div>}
      <div class="col mt" style={{ gap: 6, maxHeight: 250, overflow: 'auto' }}>
        {(r?.items || []).filter((t) => !hideDone || !done.has(norm(t.name))).map((t) => (
          <div class="result-row" style={{ flexDirection: 'column', alignItems: 'stretch', opacity: done.has(norm(t.name)) ? 0.55 : 1 }} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <div class="row"><Checkbox checked={done.has(norm(t.name))} title="Als erledigt markieren" onChange={(v) => rpc('game.questDone', { name: t.name, done: v })} /><b class="grow ellipsis small" style={done.has(norm(t.name)) ? { textDecoration: 'line-through' } : undefined}>{t.name}</b><span class="tiny muted">{t.trader?.name}{t.minPlayerLevel ? ` · Lvl ${t.minPlayerLevel}` : ''}{t.kappaRequired ? ' · Kappa' : ''}</span></div>
            {open === t.id && <>{t.objectives.map((o) => <div class="tiny" style={{ color: 'var(--text-2)', paddingLeft: 22 }}>• {o.description}{o.optional ? ' (optional)' : ''}</div>)}{t.wikiLink && <a class="tiny" style={{ paddingLeft: 22 }} onClick={(e) => { e.stopPropagation(); rpc('shell.openExternal', { url: t.wikiLink }); }}>Wiki</a>}</>}
          </div>
        ))}
        {r && !r.items.length && <Empty>{all ? 'Keine Quests gefunden.' : 'Keine machbaren Quests gefunden – erledigte Quests aus dem Tarkov-Log/TarkovTracker schalten neue frei.'}</Empty>}
      </div>
      <div class="mt"><SourceTag source={r?.source} fetchedAt={r?.fetchedAt} offline={r?.offline} /></div>
    </Panel>
  );
}

function TarkovItem({ params }) {
  const [q, setQ] = useState(params.query || '');
  useEffect(() => { if (params.query) setQ(params.query); }, [params.query]);
  const [r, , st] = useRpc('tarkov.items', { q, keysOnly: !!params.keysOnly }, { deps: [q], debounce: 350, enabled: q.length >= 2 || !!params.keysOnly });
  return (
    <Panel title={params.keysOnly ? 'Wichtige Keys' : 'Item-Details'} sub="Preise & Infos (tarkov.dev)">
      <input class="inp" placeholder={params.keysOnly ? 'Schlüssel suchen (z. B. Dorms 314)…' : 'Item suchen…'} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      {st.error && <div class="notice warn mt">{st.error}</div>}
      <div class="col mt" style={{ gap: 6, maxHeight: 250, overflow: 'auto' }}>
        {(r?.items || []).map((i) => (
          <div class="result-row" style={{ alignItems: 'flex-start' }}>
            <KeyRound size={16} />
            <div class="grow"><div class="small" style={{ fontWeight: 600 }}>{i.name}</div><div class="tiny muted">{i.avg24hPrice ? `Ø 24h ${i.avg24hPrice.toLocaleString('de-DE')} ₽` : 'kein Flohmarktpreis'} · Basis {i.basePrice?.toLocaleString('de-DE')} ₽</div></div>
            {i.wikiLink && <ExternalLink size={14} style={{ cursor: 'pointer' }} onClick={() => rpc('shell.openExternal', { url: i.wikiLink })} />}
          </div>
        ))}
      </div>
      <div class="mt"><SourceTag source={r?.source} fetchedAt={r?.fetchedAt} offline={r?.offline} /></div>
    </Panel>
  );
}

function Checklist({ game, params }) {
  const name = params.name || 'Checkliste';
  const [cl, reload] = useRpc('game.checklist', { game: game.id, name }, { events: ['game:data'] });
  const [txt, setTxt] = useState('');
  const save = (items) => rpc('game.saveChecklist', { game: game.id, name, items }).then(reload);
  const [meta] = useRpc('wikilist.meta', { game: game.id, name }, {});
  return (
    <Panel icon={ListChecks} title={name} sub={cl?.items?.length ? `${cl.items.filter((i) => i.done).length}/${cl.items.length} erledigt${cl.preset ? ' · Vorlage, änderbar' : ''}` : undefined} right={<button class="btn xs ghost" onClick={() => save((cl?.items || []).map((i) => ({ ...i, done: false })))}>Zurücksetzen</button>}>
      <div class="col" style={{ gap: 0, maxHeight: 260, overflow: 'auto' }}>{(cl?.items || []).map((i) => <div class={`sub-row ${i.done ? 'done' : ''}`}><Checkbox checked={i.done} onChange={(v) => save(cl.items.map((x) => (x.id === i.id ? { ...x, done: v } : x)))} /><span class="grow">{i.text}</span><X size={13} style={{ cursor: 'pointer', color: 'var(--text-3)' }} onClick={() => save(cl.items.filter((x) => x.id !== i.id))} /></div>)}</div>
      {meta && <div class="tiny muted mt">Quelle: {meta.label}{meta.sources?.[0]?.url ? <> · <a href={meta.sources[0].url} target="_blank" rel="noreferrer">{meta.sources[0].title || 'Artikel'}</a></> : null} · Stand {fmtDateTime(meta.at)} · <a href="#" onClick={(e) => { e.preventDefault(); guard(() => rpc('wikilist.remove', { game: game.id, name })); }}>Liste ausblenden</a></div>}
      <div class="add-row mt"><Plus size={14} /><input placeholder="Punkt hinzufügen" value={txt} onInput={(e) => setTxt(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && txt.trim()) { save([...(cl?.items || []), { text: txt.trim(), done: false }]); setTxt(''); } }} /></div>
    </Panel>
  );
}

// ---------------------------------------------------------------- Kit: Fragen & Links
const ASK_FALLBACK = ['Was sollte ich als Nächstes machen?', 'Wo finde ich …?', 'Wie funktioniert …?', 'Was ist im letzten Update neu?'];

/** Fragen, die zu diesem Spiel passen – Klick stellt sie JARVIS (mit Spielkontext). „…“ = erst ergänzen. */
function AskWidget({ game }) {
  const [txt, setTxt] = useState('');
  const ref = useRef();
  const qs = game.questions?.length ? game.questions : ASK_FALLBACK;
  const send = (q) => {
    const t = q.trim(); if (!t) return;
    setTxt('');
    setState({ miniChatOpen: true });
    guard(() => rpc('chat.send', { conversationId: getState().conversationId, text: `Zu ${game.name}: ${t}` }));
  };
  const pick = (q) => { if (q.includes('…')) { setTxt(q.replace(/\s*…\s*/, '  ').replace(/ {2}\?/, ' ?')); setTimeout(() => { const el = ref.current; if (el) { el.focus(); const pos = q.indexOf('…'); el.setSelectionRange(pos, pos); } }, 0); } else send(q); };
  return (
    <Panel icon={MessageCircleQuestion} title={`Frag JARVIS zu ${game.short || game.name}`} sub="Antwort mit Quellen, dein Spielstand fließt mit ein">
      <div class="row wrap gap-s">{qs.map((q) => <span class="chip ask-chip" title={q.includes('…') ? 'Ins Eingabefeld übernehmen und ergänzen' : 'Direkt fragen'} onClick={() => pick(q)}>{q}</span>)}</div>
      <div class="row mt gap-s"><input ref={ref} class="inp grow" placeholder={`Eigene Frage zu ${game.name} …`} value={txt} onInput={(e) => setTxt(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && send(txt)} /><button class="btn sm" onClick={() => send(txt)} disabled={!txt.trim()}><SendHorizontal size={14} /></button></div>
    </Panel>
  );
}

/** Nächster Termin nach einer festen Regel (z. B. Rust-Force-Wipe: erster Donnerstag im Monat). */
function nextScheduled(s, now = new Date()) {
  if (s?.rule !== 'first-thursday') return null;
  const [h, m] = String(s.utc || '19:00').split(':').map(Number);
  for (let k = 0; k < 3; k++) {
    const y = now.getUTCFullYear(), mo = now.getUTCMonth() + k;
    const first = new Date(Date.UTC(y, mo, 1));
    const day = 1 + ((4 - first.getUTCDay() + 7) % 7);
    const t = new Date(Date.UTC(y, mo, day, h, m));
    if (t > now) return t;
  }
  return null;
}

function LinksWidget({ game }) {
  useNow(60000);
  const next = game.schedule ? nextScheduled(game.schedule) : null;
  const links = [...(game.links || [])];
  if (game.steamAppId && !links.some((l) => l.url.includes('/news/app/'))) links.push({ label: 'Patchnotes & News (Steam)', url: `https://store.steampowered.com/news/app/${game.steamAppId}` });
  return (
    <Panel icon={LinkIcon} title="Tools & Links" sub="Geprüfte Seiten – öffnen im Browser">
      {next && (
        <div class="result-row" style={{ cursor: 'default', marginBottom: 6 }}>
          <CalendarClock size={18} style={{ color: 'var(--cyan)' }} />
          <div class="grow"><div class="small" style={{ fontWeight: 600 }}>{game.schedule.label}: {next.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}, ca. {next.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</div><div class="tiny muted">noch {countdown(next.toISOString())} · {game.schedule.note}</div></div>
        </div>
      )}
      <div class="col" style={{ gap: 6 }}>
        {links.map((l) => <div class="result-row" onClick={() => rpc('shell.openExternal', { url: l.url })}><Globe size={15} /><div class="grow"><div class="small ellipsis">{l.label}</div><div class="tiny muted ellipsis">{l.url.replace(/^https:\/\//, '').replace(/\/$/, '')}</div></div><ExternalLink size={13} /></div>)}
        {!links.length && <Empty>Keine Links hinterlegt.</Empty>}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- generic
function OtherGames({ activeId }) {
  const [list] = useRpc('game.others', { active: activeId }, { events: ['notification', 'game:timers'], initial: [] });
  const now = useNow(1000);
  return (
    <Panel icon={Bell} title="Andere Spiele – Benachrichtigungen" sub="Herkunft ist bei jeder Meldung angegeben">
      <div class="col" style={{ gap: 6, maxHeight: 260, overflow: 'auto' }}>
        {!list.length && <Empty>Keine Meldungen aus anderen Spielen.</Empty>}
        {list.map((n) => (
          <div class="result-row" style={{ alignItems: 'flex-start' }}>
            {n.origin === 'timer' ? <Timer size={16} /> : <Bell size={16} />}
            <div class="grow"><div class="small" style={{ fontWeight: 600 }}>{n.title}</div><div class="tiny" style={{ color: 'var(--text-2)' }}>{n.pending ? `Noch ${countdown(n.endsAt)}` : n.body}</div><div class="tiny muted">{n.originLabel}</div></div>
            <span class="tiny muted">{n.pending ? '' : ago(n.createdAt)}</span>
          </div>
        ))}
      </div>
      <span style={{ display: 'none' }}>{now}</span>
    </Panel>
  );
}

const TIMER_KINDS = { build: ['Bau', Hammer], research: ['Forschung', FlaskConical], training: ['Training', Swords], taming: ['Zähmung', Timer], breeding: ['Zucht', Timer], crafting: ['Herstellung', Hammer], event: ['Event', Bell], custom: ['Eigener', Timer] };

function Timers({ game, params }) {
  const [list] = useRpc('game.timers', { game: game.id, includeFired: false }, { events: ['game:timers'], initial: [] });
  const kinds = params.kinds?.length ? params.kinds : ['custom', 'build', 'research', 'crafting'];
  const [f, setF] = useState({ label: '', kind: kinds[0], h: 1, m: 0, rep: '' });
  useNow(1000);
  const add = async () => {
    if (!f.label.trim()) return;
    const minutes = Number(f.h) * 60 + Number(f.m);
    if (await guard(() => rpc('game.addTimer', { game: game.name, label: f.label.trim(), kind: f.kind, minutes, ...(f.rep ? { repeatMinutes: Number(f.rep) } : {}) }), 'Timer gestartet')) setF({ ...f, label: '' });
  };
  return (
    <Panel icon={Timer} title={game.id === 'rok' ? 'Bau- & Forschungs-Timer' : 'Timer'} sub="Eigene Zeitabschätzungen – kein verifizierter Spielstatus">
      <div class="col" style={{ gap: 6, maxHeight: 220, overflow: 'auto' }}>
        {!list.length && <Empty>Kein Timer aktiv. Sag z. B. „Jarvis, mein Rathaus braucht noch fünf Stunden.“</Empty>}
        {list.map((t) => { const [l, I] = TIMER_KINDS[t.kind] || TIMER_KINDS.custom; const done = new Date(t.endsAt) <= new Date(); return (
          <div class={`timer-row ${done ? 'fired' : ''}`}>
            <I size={18} style={{ color: 'var(--cyan)' }} />
            <div class="grow"><div class="small" style={{ fontWeight: 600 }}>{t.label}</div><div class="tiny muted">{l} · endet {fmtDateTime(t.endsAt)}{t.repeatMin ? ` · ↻ alle ${t.repeatMin >= 1440 && t.repeatMin % 1440 === 0 ? t.repeatMin / 1440 + ' T' : Math.round(t.repeatMin / 6) / 10 + ' h'}` : ''}</div></div>
            <div class="left">{done ? 'fertig*' : countdown(t.endsAt)}</div>
            <button class="btn icon xs ghost" onClick={() => rpc('game.removeTimer', { id: t.id })}><X size={13} /></button>
          </div>); })}
      </div>
      <div class="row mt gap-s">
        <input class="inp grow" placeholder={game.id === 'rok' ? 'z. B. Rathaus Stufe 22' : 'Wofür läuft der Timer?'} value={f.label} onInput={(e) => setF({ ...f, label: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Select style={{ width: 120 }} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={kinds.map((k) => ({ value: k, label: TIMER_KINDS[k]?.[0] || k }))} />
        <input class="inp" type="number" min="0" style={{ width: 60 }} value={f.h} onInput={(e) => setF({ ...f, h: e.currentTarget.value })} title="Stunden" /><span class="tiny muted">h</span>
        <input class="inp" type="number" min="0" max="59" style={{ width: 60 }} value={f.m} onInput={(e) => setF({ ...f, m: e.currentTarget.value })} title="Minuten" /><span class="tiny muted">m</span>
        <Select style={{ width: 110 }} value={f.rep} onChange={(v) => setF({ ...f, rep: v })} options={[{ value: '', label: 'einmalig' }, { value: '1440', label: 'täglich' }, { value: '10080', label: 'wöchentlich' }]} />
        <button class="btn sm" onClick={add}><Plus size={14} /></button>
      </div>
      <div class="tiny muted mt">* „fertig“ bedeutet: deine geschätzte Zeit ist abgelaufen.</div>
    </Panel>
  );
}

function Notes({ game }) {
  const [list] = useRpc('game.notes', { game: game.id }, { events: ['brain:changed'], initial: [] });
  const [txt, setTxt] = useState('');
  return (
    <Panel icon={NotebookPen} title="Eigene Notizen" sub="Im Gaming-Brain gespeichert">
      <div class="col" style={{ gap: 6, maxHeight: 220, overflow: 'auto' }}>
        {!list.length && <Empty>Noch keine Notizen.</Empty>}
        {list.map((n) => <div class="result-row" style={{ alignItems: 'flex-start' }} onClick={() => setState({ page: 'brain', focusKnowledge: n.id })}><NotebookPen size={14} /><div class="grow small" style={{ whiteSpace: 'pre-wrap' }}>{n.content}</div><span class="tiny muted">{ago(n.updatedAt)}</span></div>)}
      </div>
      <div class="add-row mt"><Plus size={14} /><input placeholder="Notiz hinzufügen (Enter)" value={txt} onInput={(e) => setTxt(e.currentTarget.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && txt.trim()) { await guard(() => rpc('game.addNote', { game: game.id, text: txt.trim() })); setTxt(''); } }} /></div>
    </Panel>
  );
}

function Sources({ game }) {
  const [list] = useRpc('game.sources', { game: game.id }, { events: ['brain:changed'], initial: [] });
  return (
    <Panel icon={LinkIcon} title="Gespeicherte Quellen" sub="Mit Datum – ältere Inhalte können veraltet sein">
      <div class="col" style={{ gap: 6, maxHeight: 220, overflow: 'auto' }}>
        {!list.length && <Empty>Noch keine Quellen. Recherche-Ergebnisse kannst du mit „Speichern“ übernehmen.</Empty>}
        {list.map((s) => <div class="result-row"><Globe size={14} /><div class="grow"><div class="small ellipsis">{s.title}</div><div class="tiny muted">{ago(s.updatedAt)}{s.stale ? ' · möglicherweise veraltet' : ''}</div></div>{s.sourceUrl && <ExternalLink size={13} style={{ cursor: 'pointer' }} onClick={() => rpc('shell.openExternal', { url: s.sourceUrl })} />}</div>)}
      </div>
    </Panel>
  );
}

function GameResearch({ game, params }) {
  const [q, setQ] = useState(params.query || '');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (text = q) => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { setRes(await rpc('game.research', { game: game.id, query: text })); } catch (e) { setErr(cleanErr(e)); }
    setBusy(false);
  };
  useEffect(() => { if (params.query) { setQ(params.query); run(params.query); } }, [params.query]);
  const suggestions = { rok: ['Beste Kommandantenpaare für Infanterie', 'Aktuelle Events und Prioritäten', 'Rathaus 22 Voraussetzungen'], ark: ['Betäubungspfeile für Rex Level 150', 'Beste Fundorte für Metall auf The Island', 'Zähmfutter Argentavis'], eldenring: ['Boss-Guide Malenia', 'Starke Build für Stärke', 'Fundort Schmiedesteine'] }[game.id] || ['Tipps für Einsteiger', 'Aktueller Patch – wichtigste Änderungen', 'Beste Strategie für '];
  return (
    <Panel icon={Search} title="Spielwissen & Recherche" sub="Aktuelle Informationen mit Quellen (Google-Suche über Gemini)">
      <div class="row">
        <input class="inp grow" placeholder={`Frage zu ${game.name}…`} value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
        <button class="btn sm" onClick={() => run()}>{busy ? <Spinner /> : <Search size={14} />}Recherchieren</button>
      </div>
      {!res && !busy && <div class="row wrap gap-s mt">{suggestions.map((s) => <span class="chip" onClick={() => { setQ(s); if (!s.endsWith(' ')) run(s); }}>{s}</span>)}</div>}
      {err && <div class="notice warn mt">{err}</div>}
      {res && (
        <div class="mt">
          <div class="msg-body selectable" style={{ maxHeight: 280, overflow: 'auto' }} onClick={(e) => onMarkdownClick(e, rpc)} dangerouslySetInnerHTML={{ __html: renderMarkdown(res.answer) }} />
          <div class="sources row wrap gap-s mt">{res.sources.map((s) => <span class="chip" onClick={() => rpc('shell.openExternal', { url: s.url })}><Globe size={12} />{s.title}</span>)}</div>
          <div class="row mt"><span class="tiny muted grow">Stand: {fmtDateTime(res.fetchedAt)}{res.cached ? ' (zwischengespeichert)' : ''}</span>
            {res.researchId && <button class="btn xs" onClick={() => guard(() => rpc('web.saveToBrain', { id: res.researchId }), 'Im Brain gespeichert')}>Im Brain speichern</button>}</div>
        </div>
      )}
    </Panel>
  );
}

function Wiki({ game, params }) {
  const [q, setQ] = useState(params.query || '');
  const [hits, setHits] = useState(null);
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = async (t = q) => { if (!t.trim()) return; setBusy(true); setPage(null); const r = await guard(() => rpc('game.wikiSearch', { game: game.id, q: t })); setHits(r); setBusy(false); };
  const open = async (title, api) => { setBusy(true); setPage(await guard(() => rpc('game.wikiPage', { game: game.id, title, api }))); setBusy(false); };
  useEffect(() => { if (params.page) open(params.page); else if (params.query) search(params.query); }, [params.query, params.page]);
  return (
    <Panel icon={Globe} title="Wiki" sub={game.wiki?.label || 'Wiki'}>
      <div class="row"><input class="inp grow" placeholder="Im Wiki suchen…" value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /><button class="btn sm" onClick={() => search()}>{busy ? <Spinner /> : <Search size={14} />}</button></div>
      {page ? (
        <div class="mt">
          <div class="row"><b class="grow">{page.title}</b><button class="btn xs ghost" onClick={() => setPage(null)}>Zurück</button><ExternalLink size={14} style={{ cursor: 'pointer' }} onClick={() => rpc('shell.openExternal', { url: page.url })} /></div>
          <div class="small selectable" style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto', color: 'var(--text-2)', marginTop: 6 }}>{page.text}</div>
          <SourceTag source={page.source} fetchedAt={page.fetchedAt} offline={page.offline} />
        </div>
      ) : (
        <div class="col mt" style={{ gap: 6, maxHeight: 260, overflow: 'auto' }}>
          {(hits?.results || []).map((h) => <div class="result-row" onClick={() => open(h.title, h.api)}><Globe size={14} /><div class="grow"><div class="small">{h.title}</div><div class="tiny muted ellipsis">{h.snippet}</div></div></div>)}
          {hits && !hits.results?.length && <Empty>Keine Treffer im Wiki. Tipp: Begriff auf Englisch versuchen oder oben „Recherchieren“ nutzen.</Empty>}
          {hits?.results?.length > 0 && hits.source && hits.source !== game.wiki?.label && <div class="tiny muted">Treffer aus: {hits.source}</div>}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- League
async function openLolAnalysis(chatDraft) {
  await guard(async () => {
    if (getState().settings?.gaming?.lolCloudShare !== true) {
      if (!(await ask('Für die ausführliche LoL-Analyse dürfen deine Matchdaten und Auswertungen an Google Gemini gesendet werden. Diese Freigabe gilt auch für spätere Gaming-Fragen, bis du sie hier oder unter Einstellungen → Gaming ausschaltest. Die Auswertung auf dieser Seite bleibt ohne Freigabe lokal verfügbar.', '', { confirmOnly: true, okLabel: 'Freigeben und Analyse öffnen' }))) return;
      await rpc('settings.update', { gaming: { lolCloudShare: true } });
    }
    const c = await rpc('conv.create', { privacy: 'gaming', title: 'LoL-Analyse' });
    setState({ conversationId: c.id, page: 'chat', chatDraft });
  });
}
function useLol() {
  const [src, reloadSource] = useRpc('lol.source', {}, { events: ['settings:changed', 'game:data', 'game:running'] });
  const hasKey = !!(src?.client || src?.key);
  const [stats, reload, st] = useRpc('lol.stats', {}, { events: ['game:data'] });
  const [v] = useRpc('lol.version', {}, {});
  return { hasKey, stats, reload, reloadSource, st, v, src };
}
const icon = (v, c) => (v ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${String(c).replace(/[^A-Za-z]/g, '')}.png` : '');
function Delta({ d }) { if (d == null) return <span class="d muted">–</span>; return <span class={`d ${d >= 0 ? 'up' : 'down'}`}>{d >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {d >= 0 ? '+' : ''}{d}% vs. vorher</span>; }

function LolOverview() {
  const cloudShare = useStore((x) => x.settings?.gaming?.lolCloudShare === true);
  const { hasKey, stats, st, src, reloadSource } = useLol();
  const [busy, setBusy] = useState(false);
  const sync = async () => { setBusy(true); const r = await guard(() => rpc('lol.sync')); setBusy(false); await reloadSource(); if (r) toast(`${r.added} neue Matches geladen`); };
  const c = stats?.current;
  return (
    <section class="panel glow" style={{ padding: 14 }}>
      <div class="row">
        <Trophy size={34} style={{ color: '#c8aa6e' }} />
        <div class="grow"><div style={{ fontSize: 20, fontWeight: 700 }}>League of Legends</div><div class="small muted">Performance analysieren. Besser werden. Mit JARVIS.</div></div>
        {src?.me && <span class="small muted">{src.me.name}</span>}
        <span class="pill"><span class={`status-dot ${src?.client ? 'dot-ok' : 'dot-off'}`} />{src?.client ? 'League-Client verbunden' : 'League-Client nicht erreichbar'}</span>
        <button class="btn xs" onClick={reloadSource} title="Lokale League-Client-Verbindung erneut prüfen">Verbindung prüfen</button>
        <button class="btn sm" disabled={!hasKey || busy} title={hasKey ? '' : 'League-Client starten'} onClick={sync}>{busy ? <Spinner /> : <RefreshCw size={14} />}Matches laden</button>
      </div>
      {st.error && <div class="notice warn mt">{st.error}</div>}
      {!src?.client && src?.clientReason && <div class="notice warn mt">{src.clientReason}{src.savedMatches ? ` · ${src.savedMatches} gespeicherte Matches bleiben sichtbar.` : ''}</div>}
      {!c ? <div class="notice mt">Noch keine Ranglisten-Matches gespeichert. {src?.client ? 'JARVIS lädt die Spiele automatisch nach. Mit „Matches laden“ kannst du sofort aktualisieren.' : 'Starte einfach den League-Client – JARVIS liest deine letzten Ranglistenspiele und deinen Rang direkt daraus (kein API-Schlüssel nötig) und aktualisiert alle 10 Minuten, solange der Client offen ist.'}</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 12 }}>
          <div class="panel stat row"><div class="ring" style={{ '--p': c.winrate }}><span>{c.winrate}%</span></div><div><div class="hud-label">Winrate</div><div class="small muted">{c.wins}S – {c.games - c.wins}N</div></div></div>
          <div class="panel stat"><div class="hud-label">KDA (Ø)</div><div class="v">{c.kda}</div><div class="small muted">{c.avgK} / {c.avgD} / {c.avgA}</div><Delta d={stats.deltas.kda} /></div>
          <div class="panel stat"><div class="hud-label">CS / Min (Ø)</div><div class="v">{c.csPerMin}</div><Delta d={stats.deltas.csPerMin} /></div>
          <div class="panel stat"><div class="hud-label">Vision Score (Ø)</div><div class="v">{c.vision ?? '–'}</div><Delta d={stats.deltas.vision} /></div>
          <div class="panel stat"><div class="hud-label">Rang (Solo/Duo)</div>{stats.rank ? <><div class="v" style={{ fontSize: 24 }}>{cap(stats.rank.tier)} {stats.rank.rank}</div><div class="small">{stats.rank.lp} LP{stats.rank.prev && stats.rank.prev.tier === stats.rank.tier && stats.rank.prev.rank === stats.rank.rank ? <span class={stats.rank.lp - stats.rank.prev.lp >= 0 ? 'ok' : 'err'}> {stats.rank.lp - stats.rank.prev.lp >= 0 ? '▲ +' : '▼ '}{stats.rank.lp - stats.rank.prev.lp} LP</span> : ''}</div></> : <div class="small muted">nicht verfügbar</div>}</div>
        </div>
      )}
      <div class="tiny muted mt">Letzte {c?.games || 0} Ranglistenspiele (Solo/Duo) · Quelle: {src?.lastSync?.source === 'api' ? 'Riot-API (eigener Schlüssel)' : 'lokaler League-Client'}{src?.lastSync ? ' · Stand ' + fmtDateTime(src.lastSync.at) : ''} · nur lesend, keine Spielautomatisierung</div>
    </section>
  );
}
const cap = (s) => String(s || '').charAt(0) + String(s || '').slice(1).toLowerCase();

function LolChampions() {
  const { stats, v } = useLol();
  const ROLE = { BOTTOM: 'ADC', MIDDLE: 'Mid', TOP: 'Top', JUNGLE: 'Jungle', UTILITY: 'Support' };
  return (
    <Panel title="Champions & Rollen" sub="Rangliste (Solo/Duo)">
      {!stats?.champions?.length ? <Empty>Keine Daten.</Empty> : <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {stats.champions.slice(0, 5).map((c) => <div class="champ" style={{ cursor: 'pointer' }} onClick={() => rpc('game.pushWidget', { game: 'league', type: 'lol-champion', params: { champion: c.champion } })}><img src={icon(v, c.champion)} /><b class="small">{c.champion}</b><span class="small" style={{ color: 'var(--cyan-2)' }}>{c.winrate}% WR</span><span class="tiny muted">{c.games} Spiele</span></div>)}
        </div>
        <div class="col mt" style={{ gap: 6 }}>{stats.roles.map((r) => <div class="row small"><span style={{ width: 70 }}>{ROLE[r.role] || r.role}</span><span style={{ width: 40 }}>{r.share}%</span><div class="bar grow"><i style={{ width: r.share + '%' }} /></div></div>)}</div>
      </>}
    </Panel>
  );
}

function LolMatches() {
  const { stats, v } = useLol();
  return (
    <Panel title="Letzte Spiele">
      <div class="col" style={{ gap: 6 }}>
        {!stats?.recent?.length && <Empty>Keine Matches.</Empty>}
        {(stats?.recent || []).slice(0, 6).map((m) => (
          <div class="match-row">
            <img src={icon(v, m.champion)} />
            <div><div class={m.win ? 'win' : 'loss'}>{m.win ? 'Sieg' : 'Niederlage'}</div><div class="tiny muted">{m.role}</div></div>
            <div><b>{m.kills} / {m.deaths} / {m.assists}</b><div class="tiny muted">{m.csPerMin} CS/min</div></div>
            <div class="tiny muted">Vision {m.vision} · KP {m.killParticipation}% · {m.damagePerMin} DMG/min</div>
            <div class="tiny muted">{Math.floor(m.duration / 60)}:{String(m.duration % 60).padStart(2, '0')}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LolCoaching() {
  const { stats } = useLol();
  const ICON = { farm: BarChart3, positioning: Target, vision: Eye, macro: GraduationCap, strength: Trophy, trend: TrendingUp };
  return (
    <Panel title="Coaching & Insights" sub="Aus deinen echten Matchdaten berechnet">
      <div class="col" style={{ gap: 8 }}>
        {!stats?.insights?.length && <Empty>Insights erscheinen, sobald Matches geladen sind.</Empty>}
        {(stats?.insights || []).map((i) => { const I = ICON[i.kind] || Sparkles; return <div class="result-row" style={{ alignItems: 'flex-start' }}><I size={20} /><div class="grow"><b class="small">{i.title}</b><div class="small" style={{ color: 'var(--text-2)' }}>{i.text}</div></div></div>; })}
        <button class="btn sm" onClick={() => openLolAnalysis('Analysiere meine LoL-Statistik und die Fehleranalyse meiner Ranked-Spiele und erstelle mir einen Trainingsplan mit 3 messbaren Zielen.')}><Sparkles size={14} />Ausführliche Analyse mit JARVIS</button>
      </div>
    </Panel>
  );
}

/** Fehlermuster aus den Timelines der letzten Ranked-Spiele. */
function LolMistakes() {
  const [p, reload] = useRpc('lol.patterns', { games: 20 }, { events: ['game:data'] });
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); const r = await guard(() => rpc('lol.deepSync')); setBusy(false); reload(); if (r) toast(`${r.analyzed} Timelines geladen${r.missing ? ` · ${r.missing} noch nicht verfügbar${r.reason ? ' (' + r.reason + ')' : ''}` : ' · Details aktuell'}`); };
  const A = p?.averages || {};
  return (
    <Panel icon={Skull} title="Fehleranalyse" sub={p?.games ? `${p.games} Ranked-Spiele · ${p.timelineGames ?? 0} mit Timeline · ${p.wins} Siege` : 'Aus den Timelines deiner Ranked-Spiele'}
      right={<button class="btn xs ghost" title="Fehlende Spiele analysieren (Client muss laufen)" disabled={busy} onClick={refresh}>{busy ? <Spinner size={12} /> : <RefreshCw size={13} />}</button>}>
      {(!p || p.games < 3) && <Empty>Noch zu wenig Daten. Läuft der League-Client, lädt JARVIS die Details (Tode, Lane-Phase, Objectives) deiner letzten Ranked-Spiele automatisch nach.</Empty>}
      {p && (p.timelineGames ?? 0) < p.games && <div class="notice small mb">Für {p.games - (p.timelineGames ?? 0)} Spiele fehlen Timeline-Details. Tode, Laufwege und Lane-Vergleiche sind nur für die übrigen Spiele auswertbar.</div>}
      {p?.games >= 3 && <>
        <div class="row wrap gap-s mb">
          <span class="chip static" title="Tode vor Minute 14">Frühe Tode Ø {A.earlyDeaths ?? '–'}</span>
          <span class="chip static" title="CS-Differenz zum Lane-Gegner bei 10 Min.">CS-Diff@10 {A.csDiff10 > 0 ? '+' : ''}{A.csDiff10 ?? '–'}</span>
          <span class="chip static" title="Gold-Differenz zum Lane-Gegner bei 15 Min.">Gold@15 {A.goldDiff15 > 0 ? '+' : ''}{A.goldDiff15 ?? '–'}</span>
          <span class="chip static" title="Bei Drachen/Baron deines Teams in der Nähe (geschätzt)">Objectives ~{A.objectivePresence ?? '–'} %</span>
          {A.gankDeathPct != null && <span class="chip static" title="Anteil deiner Tode vor Min. 14, an denen der gegnerische Jungler beteiligt war">Jungler an frühen Toden {A.gankDeathPct} %</span>}
          {A.jungleCsAt10 != null && <span class="chip static" title="Eigene Jungle-Monster (CS) bis Min. 10, Ø in deinen Jungle-Spielen">Jungle-CS@10 Ø {A.jungleCsAt10}</span>}
        </div>
        {p.deathPoints?.length > 0 && <details class="mb"><summary class="small" style={{ cursor: 'pointer' }}>Todes-Karte ({p.deathPoints.length} Tode)</summary>
          <div class="mt"><RiftMap size={300}><g filter="url(#rift-heat)">{p.deathPoints.map((x) => <circle cx={RX(x.x)} cy={RY(x.y)} r="3.6" fill={x.min < 14 ? '#ff4d4d' : '#ffb020'} opacity="0.45" />)}</g>{p.deathPoints.map((x) => <circle cx={RX(x.x)} cy={RY(x.y)} r="0.7" fill={x.min < 14 ? '#ff9a9a' : '#ffd27a'} />)}</RiftMap>
          <div class="tiny muted">Rot = vor Min. 14, gelb = später. Dichte Flecken = dort stirbst du oft.</div></div></details>}
        <div class="col" style={{ gap: 8 }}>
          {!p.findings.length && <div class="small muted">In den verfügbaren Daten wurden keine eindeutigen Fehlermuster erkannt.</div>}
          {p.findings.slice(0, 5).map((f) => <div class="result-row" style={{ alignItems: 'flex-start', cursor: 'default' }}><TriangleAlert size={18} style={{ color: 'var(--orange)' }} /><div class="grow"><b class="small">{f.title}</b><div class="small" style={{ color: 'var(--text-2)' }}>{f.text}</div></div></div>)}
          {p.strengths.map((f) => <div class="result-row" style={{ alignItems: 'flex-start', cursor: 'default' }}><Trophy size={18} style={{ color: 'var(--cyan)' }} /><div class="grow"><b class="small">{f.title}</b><div class="small" style={{ color: 'var(--text-2)' }}>{f.text}</div></div></div>)}
        </div>
      </>}
      <button class="btn sm mt" onClick={() => openLolAnalysis('Was mache ich in meinen Ranked-Spielen falsch? Nutze die Fehleranalyse (league_deep_review) und gib mir einen Trainingsplan mit 3 messbaren Zielen.')}><Sparkles size={14} />Mit JARVIS durchgehen</button>
      <div class="tiny muted mt">Orte und Anwesenheit bei Objectives sind aus Minuten-Positionen geschätzt.</div>
    </Panel>
  );
}

// ---------- Summoner's Rift (Data-Dragon-Minimap), Koordinaten 0–14870 / 0–14980 ----------
const RX = (x) => (x / 14870) * 100; const RY = (y) => 100 - (y / 14980) * 100;
function useMapUrl() { const [u] = useRpc('lol.mapUrl', {}, { initial: null }); return u; }
/** Summoner's Rift als Vektorkarte (Lanes, Fluss, Basen, Drache/Baron) – optional mit der echten Minimap darunter. */
function RiftMap({ children, size = 300, real = false }) {
  const url = useMapUrl();
  const lane = 'M9,86 L8,14 Q8,8 14,8 L86,8 M14,92 L86,92 Q92,92 92,86 L92,14 M13,87 L87,13';
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', maxWidth: size, aspectRatio: '1', display: 'block' }}>
      <defs>
        <radialGradient id="rift-bg" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#11241f" /><stop offset="1" stop-color="#070f0d" /></radialGradient>
        <filter id="rift-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.9" /></filter>
        <filter id="rift-heat" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx="6" fill="url(#rift-bg)" />
      {real && url ? <image href={url} x="0" y="0" width="100" height="100" opacity="0.55" preserveAspectRatio="none" /> : <g>
        <path d="M0,6 L6,0 L100,0 L100,94 Z" fill="#ff5a5a" opacity="0.035" />
        <path d="M0,6 L0,100 L94,100 Z" fill="#38bdf8" opacity="0.045" />
        <path d="M10,10 C30,26 40,40 50,50 S72,76 90,90" fill="none" stroke="#1d5a74" stroke-width="5" stroke-linecap="round" opacity="0.55" />
        <path d={lane} fill="none" stroke="#2c4a44" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
        <path d={lane} fill="none" stroke="#4d7a70" stroke-width="0.35" stroke-dasharray="1.2 1.4" opacity="0.7" />
        <circle cx="66.3" cy="70.5" r="3.2" fill="none" stroke="#c8aa6e" stroke-width="0.5" opacity="0.7" /><text x="66.3" y="76.6" font-size="2.4" text-anchor="middle" fill="#c8aa6e" opacity="0.8">Drache</text>
        <circle cx="33.7" cy="30.1" r="3.2" fill="none" stroke="#b18cff" stroke-width="0.5" opacity="0.7" /><text x="33.7" y="26.2" font-size="2.4" text-anchor="middle" fill="#b18cff" opacity="0.8">Baron</text>
        <text x="4" y="50" font-size="2.6" fill="#6f938a" transform="rotate(-90 4 50)" text-anchor="middle">TOP</text>
        <text x="96.5" y="50" font-size="2.6" fill="#6f938a" transform="rotate(90 96.5 50)" text-anchor="middle">BOT</text>
        <text x="53" y="47" font-size="2.6" fill="#6f938a" transform="rotate(-45 53 47)">MID</text>
      </g>}
      <circle cx="9" cy="91" r="6.5" fill="#38bdf8" opacity="0.16" /><circle cx="9" cy="91" r="6.5" fill="none" stroke="#38bdf8" stroke-width="0.6" opacity="0.8" />
      <circle cx="91" cy="9" r="6.5" fill="#ff5a5a" opacity="0.14" /><circle cx="91" cy="9" r="6.5" fill="none" stroke="#ff5a5a" stroke-width="0.6" opacity="0.8" />
      {children}
    </svg>
  );
}

/** Weicher Pfad durch die Minutenpunkte (Catmull-Rom → Bezier). */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]; const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}
function RiftPath({ points, color, label }) {
  const pts = points.map(([m, x, y]) => [RX(x), RY(y), m]);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  return (
    <g>
      <path d={smoothPath(pts)} fill="none" stroke={color} stroke-width="2.2" opacity="0.25" filter="url(#rift-glow)" />
      <path d={smoothPath(pts)} fill="none" stroke={color} stroke-width="0.7" stroke-linecap="round" opacity="0.95" />
      {pts.map(([x, y, m]) => <circle cx={x} cy={y} r={m % 3 === 0 ? 1.1 : 0.6} fill={color}><title>{`${label}: Minute ${m}`}</title></circle>)}
      {pts.filter(([, , m]) => m % 3 === 0).map(([x, y, m]) => <g><rect x={x + 1.4} y={y - 2.2} width={m >= 10 ? 5.4 : 4} height="3.3" rx="1.3" fill="#000" opacity="0.7" /><text x={x + 1.9} y={y + 0.3} font-size="2.6" fill={color}>{m}'</text></g>)}
      <circle cx={pts[0][0]} cy={pts[0][1]} r="1.8" fill="none" stroke={color} stroke-width="0.5" />
      <circle cx={last[0]} cy={last[1]} r="1.6" fill={color} stroke="#000" stroke-width="0.3" />
    </g>
  );
}
const PATH_COL = { me: '#2fd5ff', enemyJungler: '#ff7a59', ownJungler: '#7cf29a' };
const PATH_DE = { me: 'Du', enemyJungler: 'Gegn. Jungler', ownJungler: 'Dein Jungler' };

function LolGame({ params = {} }) {
  const [games] = useRpc('lol.games', { limit: 20 }, { events: ['game:data'], initial: [] });
  const [sel, setSel] = useState(params.matchId || null);
  const mid = sel || games[0]?.matchId || null;
  const [detail, reload, detailState] = useRpc('lol.deep', { matchId: mid }, { events: ['game:data'], enabled: !!mid });
  const d = detail?.matchId === mid ? detail : null;
  const [rs, reloadRs] = useRpc('lol.replayStatus', {}, {});
  const [replay, setReplay] = useState(null);
  const [show, setShow] = useState({ me: true, enemyJungler: true, ownJungler: false });
  const [real, setReal] = useState(false);
  const [ans, setAns] = useState({});
  useEffect(() => { setAns({}); setReplay(null); }, [mid]);
  useEvent('lol:replay', (x) => setReplay(x));
  const jump = async (sec) => {
    setReplay({ phase: 'starting' });
    const r = await guard(() => rpc('lol.replayJump', { matchId: mid, sec }));
    if (r?.needsEnable) { setReplay(null); reloadRs(); }
    else if (!r) setReplay(null);
  };
  const enable = async () => {
    if (!(await ask('Replay-API in League einschalten? JARVIS trägt „EnableReplayApi=1“ in die game.cfg ein (Sicherung: game.cfg.jarvis-bak). Damit kann JARVIS in Replays zu deinen Toden springen – deine Spiele selbst betrifft das nicht.', '', { confirmOnly: true, okLabel: 'Einschalten' }))) return;
    await guard(() => rpc('lol.enableReplayApi'), 'Replay-API eingeschaltet – ab dem nächsten Replay aktiv'); reloadRs();
  };
  const save = async (i) => { if (!ans[i]?.trim()) return; await guard(() => rpc('lol.answerDebrief', { matchId: mid, index: i, text: ans[i] }), 'Antwort gespeichert'); setAns({ ...ans, [i]: '' }); reload(); };
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const L = d?.levels; const curve = d?.csCurve;
  return (
    <Panel icon={Route} title="Spielanalyse" sub="Jungle-Pfade, Tode, Lane-Phase – aus der Riot-Timeline, nach dem Spiel">
      {!games.length ? <Empty>Noch keine Spiele mit Timeline. Läuft der League-Client, lädt JARVIS die Details deiner letzten Ranked-Spiele automatisch.</Empty> : <>
        <Select value={mid} onChange={setSel} options={games.map((g) => ({ value: g.matchId, label: `${g.win ? 'Sieg' : 'Niederlage'} · ${g.champion || '?'}${g.vs ? ' vs ' + g.vs : ''} · ${g.kda} · ${ago(g.playedAt)}` }))} />
        {!d && <div class="notice small mt">{detailState.error || 'Spieldetails werden geladen …'}</div>}
        {d && <>
          <div class="row wrap gap-s mt" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 300px', maxWidth: 380 }}>
              <RiftMap real={real} size={380}>
                {Object.entries(d.paths || {}).filter(([k, v]) => Array.isArray(v) && v.length && show[k]).map(([k, v]) => <RiftPath points={v} color={PATH_COL[k]} label={PATH_DE[k]} />)}
                {(d.deathsDetail || []).filter((x) => x.pos).map((x) => { const cx = RX(x.pos[0]); const cy = RY(x.pos[1]); return <g style={{ cursor: 'pointer' }} onClick={() => jump(x.sec || Math.round(x.min * 60))}>
                  <title>{`${x.min}. Min · ${x.zone}${x.by?.length ? ' · ' + x.by.join(' + ') : ''} – klicken: Replay`}</title>
                  <circle cx={cx} cy={cy} r="3.4" fill="#ff3b3b" opacity="0.25" filter="url(#rift-glow)" />
                  <circle cx={cx} cy={cy} r="2.2" fill="#1a0606" stroke="#ff4d4d" stroke-width="0.55" />
                  <path d={`M${cx - 1},${cy - 1} L${cx + 1},${cy + 1} M${cx + 1},${cy - 1} L${cx - 1},${cy + 1}`} stroke="#ffd2d2" stroke-width="0.55" stroke-linecap="round" />
                  <text x={cx} y={cy - 3.2} font-size="2.2" text-anchor="middle" fill="#ff9a9a">{Math.floor(x.min)}'</text>
                </g>; })}
              </RiftMap>
              <div class="row wrap gap-s mt" style={{ alignItems: 'center' }}>{Object.keys(PATH_COL).filter((k) => d.paths?.[k]?.length).map((k) => <button class={'chip' + (show[k] ? ' active' : '')} onClick={() => setShow({ ...show, [k]: !show[k] })}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: PATH_COL[k], marginRight: 5 }} />{PATH_DE[k]}</button>)}<button class={'chip' + (real ? ' active' : '')} title="Echte Minimap (Data Dragon) darunterlegen" onClick={() => setReal(!real)}>Echte Karte</button></div>
              <div class="tiny muted">Linie = Weg in Min. 1–14 (Ring = Start, Punkt = Min. 14) · rotes ✕ = dein Tod, Klick öffnet das Replay</div>
            </div>
            <div class="col grow" style={{ gap: 6, minWidth: 220 }}>
              <b class="small">Tode – Klick öffnet das Replay 15 s vorher</b>
              {!(d.deathsDetail || []).length && <div class="small muted">Keine Tode – sauber.</div>}
              {(d.deathsDetail || []).map((x) => <div class="row small"><button class="btn xs" title="Replay ab 15 s vorher" onClick={() => jump(x.sec || Math.round(x.min * 60))}>▶ {fmt(x.sec || Math.round(x.min * 60))}</button><span class="grow">{x.zone}{x.by?.length ? ' · ' + x.by.join(' + ') : ''}{x.jungler ? ' · Jungler' : ''}{x.gold >= 1300 ? ` · ${x.gold} Gold` : ''}</span></div>)}
              {rs && !rs.enabled && <div class="notice small">Für Replay-Sprünge muss in League die Replay-API an sein. <button class="btn xs" onClick={enable}>Einschalten</button></div>}
              {replay && <div class="tiny muted">{({ downloading: `Replay wird geladen${replay.progress != null ? ' … ' + Math.round(replay.progress) + ' %' : ' …'}`, starting: 'Replay startet …', playing: `Replay läuft – bei ${fmt(replay.time || 0)}` })[replay.phase] || ''}</div>}
              {d.enemyJungle && <div class="small mt"><b>Gegn. Jungler {d.enemyJungle.champion}</b>: Start {d.enemyJungle.earlySide === 'top' ? 'oben' : d.enemyJungle.earlySide === 'bot' ? 'unten' : d.enemyJungle.earlySide || '–'}{d.enemyJungle.firstGank ? ` · 1. Gank ${d.enemyJungle.firstGank.min}. Min ${d.enemyJungle.firstGank.zone}` : ''} · {d.enemyJungle.ganksOnMe} an dir</div>}
            </div>
          </div>
          {L?.me && <div class="small mt"><b>Level 2 / 3 / 6:</b> du {L.me[2] ?? '–'} / {L.me[3] ?? '–'} / {L.me[6] ?? '–'} Min.{L.opp ? ` · ${d.opponent?.champion || 'Gegner'} ${L.opp[2] ?? '–'} / ${L.opp[3] ?? '–'} / ${L.opp[6] ?? '–'} Min.` : ''}{L.me.estimated ? <span class="tiny muted"> (aus XP geschätzt)</span> : null}</div>}
          {curve?.me?.length > 2 && <CsCurve me={curve.me} opp={curve.opp} oppName={d.opponent?.champion} />}
          {d.items?.length > 0 && <div class="small"><b>Items:</b> {d.items.map((it) => `${it.name || it.id} (${it.min}. Min)`).join(' → ')}{d.firstItemAvg != null ? <span class="muted"> · Ø erstes Item auf {d.champion}: {d.firstItemAvg}. Min ({d.firstItemGames} Spiele)</span> : null}</div>}
          {d.notes?.length > 0 && <div class="small mt"><b>Deine Notizen im Spiel:</b>{d.notes.map((n) => <div class="muted">• {n.gameSec != null ? fmt(n.gameSec) + ' ' : ''}{n.text}</div>)}</div>}
          {d.debrief?.questions?.length > 0 && <div class="col mt" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <b class="small">Kurz nachgedacht</b>
            {d.debrief.questions.map((q, i) => <div class="col" style={{ gap: 3 }}><div class="small">{q}</div>{d.debrief.answers?.[i] ? <div class="small muted">↳ {d.debrief.answers[i]}</div> : <div class="row gap-s"><input class="inp grow" placeholder="Ein Satz reicht" value={ans[i] || ''} onInput={(e) => setAns({ ...ans, [i]: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && save(i)} /><button class="btn xs" onClick={() => save(i)}><Check size={12} /></button></div>}</div>)}
          </div>}
        </>}
      </>}
    </Panel>
  );
}

function CsCurve({ me, opp, oppName }) {
  const n = me.length; const all = [...me, ...(opp || [])].filter((v) => v != null); const max = Math.max(10, ...all);
  const pts = (arr) => arr.map((v, i) => (v == null ? null : `${(i / (n - 1)) * 100},${40 - (v / max) * 36}`)).filter(Boolean).join(' ');
  return (
    <div class="mt">
      <div class="row tiny muted"><span class="grow">Gesammelte CS bis Minute 1–{n}</span><span style={{ color: '#2fd5ff' }}>du {me[n - 1]}</span>{opp && <span style={{ color: '#ff8a5a', marginLeft: 8 }}>{oppName || 'Gegner'} {opp[n - 1]}</span>}</div>
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" style={{ width: '100%', height: 70 }}>
        {[0.25, 0.5, 0.75].map((f) => <line x1="0" x2="100" y1={40 - f * 36} y2={40 - f * 36} stroke="var(--line)" stroke-width="0.3" />)}
        {n >= 10 && <line x1={(9 / (n - 1)) * 100} x2={(9 / (n - 1)) * 100} y1="2" y2="40" stroke="var(--line)" stroke-dasharray="1 1" stroke-width="0.3" />}
        {opp && <polyline points={pts(opp)} fill="none" stroke="#ff8a5a" stroke-width="0.9" vector-effect="non-scaling-stroke" />}
        <polyline points={pts(me)} fill="none" stroke="#2fd5ff" stroke-width="1.2" vector-effect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function LolCoach() {
  const [w, reload] = useRpc('lol.weekly', {}, { events: ['game:data'] });
  const [st] = useRpc('lol.session', {}, { events: ['game:data'] });
  const adopt = async (g) => { await guard(() => rpc('lol.addGoal', { text: g.text, metric: g.metric, target: g.target }), 'Ziel übernommen'); reload(); };
  const row = (label, o) => o && <div class="small"><b>{label}:</b> {o.games} Spiele · {o.winrate} % · {o.csPerMin} CS/min · Ø {o.deaths} Tode{o.earlyDeaths != null ? ` (früh ${o.earlyDeaths})` : ''}{o.vision != null ? ` · Vision ${o.vision}` : ''}</div>;
  const bucket = (title, obj) => <div class="col" style={{ gap: 2 }}><span class="tiny muted">{title}</span><div class="row wrap gap-s">{Object.entries(obj || {}).map(([k, v]) => <span class="chip static" title={`${v.games} Spiele`}>{k}: {v.winrate != null ? v.winrate + ' %' : '–'}</span>)}</div></div>;
  return (
    <Panel icon={CalendarClock} title="Wochenbericht & Session" sub="Aus deinen gespeicherten Ranked-Spielen">
      {!w?.week && !w?.previous ? <Empty>In den letzten zwei Wochen keine Ranked-Spiele gespeichert.</Empty> : <>
        {row('Diese Woche', w.week)}{row('Letzte Woche', w.previous)}
      </>}
      {w?.goals?.length > 0 && <div class="col mt" style={{ gap: 2 }}><b class="small">Ziele diese Woche</b>{w.goals.map((g) => <div class="small">{g.text}: {g.measured ? `${g.met}/${g.measured} Spiele` : <span class="muted">noch nicht gemessen</span>}</div>)}</div>}
      {w?.suggestions?.length > 0 && <div class="col mt" style={{ gap: 4 }}><b class="small">Vorschläge aus deinen Fehlermustern</b>{w.suggestions.map((g) => <div class="row small"><span class="grow">{g.text} <span class="muted">– {g.why}</span></span><button class="btn xs" onClick={() => adopt(g)}><Plus size={12} />Übernehmen</button></div>)}</div>}
      {st && <div class="col mt" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <b class="small">Session & Tilt ({st.games} Spiele, {st.winrate ?? '–'} % insgesamt)</b>
        {st.currentSession && <div class="small">Heute: {st.currentSession.wins}/{st.currentSession.games} Siege{st.currentSession.lossStreak >= 2 ? ` · ${st.currentSession.lossStreak} Niederlagen in Folge` : ''}</div>}
        {bucket('Winrate nach … Niederlagen in Folge', { '0': st.afterLosses?.[0], '1': st.afterLosses?.[1], '2+': st.afterLosses?.[2] })}
        {bucket('Spiel Nr. in der Session', st.gameInSession)}
        {bucket('Tageszeit', st.timeOfDay)}
        {st.findings?.map((f) => <div class="result-row" style={{ alignItems: 'flex-start', cursor: 'default' }}><TriangleAlert size={16} style={{ color: 'var(--orange)' }} /><div class="grow"><b class="small">{f.title}</b><div class="small" style={{ color: 'var(--text-2)' }}>{f.text}</div></div></div>)}
        {st.games < 20 && <div class="tiny muted">Ab 20 Spielen zeigt JARVIS Muster; einzelne Werte erst ab 5 Spielen pro Gruppe.</div>}
      </div>}
    </Panel>
  );
}

function LolLive() {
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const poll = async () => { setBusy(true); setLive(await rpc('lol.live').catch(() => null)); setBusy(false); };
  useEffect(() => { poll(); const t = setInterval(poll, 8000); return () => clearInterval(t); }, []);
  useEvent('lol:live', (d) => setLive(d));
  return (
    <Panel icon={Radio} title="Live-Match" sub="Live Client Data API (lokal, nur während eines Matches)" right={busy ? <Spinner /> : null}>
      {!live?.connected ? <LastMatch live={live} /> : <>
        <div class="row"><b style={{ fontSize: 17 }}>{live.champion}</b><span class="chip static">Lvl {live.level}</span><span class="chip static">{Math.floor(live.seconds / 60)}:{String(live.seconds % 60).padStart(2, '0')}</span><span class="grow" /><b>{live.kills}/{live.deaths}/{live.assists}</b></div>
        <div class="small mt">CS {live.cs} ({live.csPerMin ?? '–'}/min) · Gold {live.gold} · Vision {Math.round(live.ward || 0)}</div>
        {live.opponent && <div class="small muted">Lane-Gegner: {live.opponent.champion} · Lvl {live.opponent.level} · CS {live.opponent.cs}</div>}
        <div class="col mt" style={{ gap: 4 }}>{(live.tips || []).map((t) => <div class="small"><Sparkles size={12} style={{ color: 'var(--cyan)' }} /> {t}</div>)}{!live.tips?.length && <div class="small muted">Live-Einordnung ist aus (Einstellungen → Gaming).</div>}{live.score && <div class="tiny muted">Kills {live.score.us}:{live.score.them}{live.myDeaths?.length ? ` · deine Tode: ${live.myDeaths.map((d) => `${Math.floor(d.min)}. Min ${d.by.join(' + ')}`).join(', ')}` : ''}</div>}</div>
        {live.objectives?.length > 0 && <div class="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          <div class="tiny muted">Objectives (≈ = Standard-Startzeit, je nach Patch anders)</div>
          {live.objectives.slice(0, 5).map((o) => <div class="row small" title={o.note || ''}><span class="grow">{o.label}{o.estimated ? ' ≈' : ''}{o.note ? <span class="tiny muted"> · {o.note}</span> : null}</span><b style={{ color: o.state === 'soon' ? '#c8aa6e' : o.state === 'up' ? 'var(--green)' : undefined }}>{o.remaining <= 0 ? 'steht' : `${Math.floor(o.remaining / 60)}:${String(o.remaining % 60).padStart(2, '0')}`}</b></div>)}
        </div>}
      </>}
    </Panel>
  );
}

function LastMatch({ live }) {
  const l = live?.last; const m = live?.lastMatch;
  if (!l && !m) return <div class="notice">{live?.reason || 'Gerade läuft kein Match.'} Sobald du spielst, erscheinen hier deine Live-Werte – und bleiben danach als „letztes Match“ stehen.</div>;
  return (
    <div class="col" style={{ gap: 6 }}>
      <div class="tiny muted">Gerade läuft kein Match – zuletzt gespeichert:</div>
      {l && <div class="row"><b style={{ fontSize: 16 }}>{l.champion}</b><span class="chip static">Lvl {l.level}</span><span class="chip static">{Math.floor(l.seconds / 60)}:{String(l.seconds % 60).padStart(2, '0')}</span><span class="grow" /><b>{l.kills}/{l.deaths}/{l.assists}</b></div>}
      {l && <div class="small muted">CS {l.cs} ({l.csPerMin ?? '–'}/min) · Gold {l.gold} · Live-Stand {ago(l.at)}</div>}
      {m && <div class="small" style={{ borderTop: l ? '1px solid var(--line)' : 'none', paddingTop: l ? 6 : 0 }}><b class={m.win ? 'win' : 'loss'}>{m.win ? 'Sieg' : 'Niederlage'}</b> mit {m.champion} · {m.kills}/{m.deaths}/{m.assists} · {m.csPerMin} CS/min{m.vision != null ? ` · Vision ${m.vision}` : ''} <span class="tiny muted">(letztes gespeichertes Ranked-Spiel)</span></div>}
    </div>
  );
}

function LolGoals() {
  const [goals, reload] = useRpc('lol.goals', {}, { events: ['game:data'], initial: [] });
  const [t, setT] = useState('');
  return (
    <Panel icon={Target} title="Trainingsziele" sub="Langfristige Entwicklung">
      {goals.map((g) => <div class="sub-row"><Target size={14} style={{ color: 'var(--cyan)' }} /><span class="grow">{g.text}</span><X size={13} style={{ cursor: 'pointer' }} onClick={() => rpc('lol.removeGoal', { id: g.id })} /></div>)}
      {!goals.length && <Empty>Noch keine Ziele.</Empty>}
      <div class="add-row mt"><Plus size={14} /><input placeholder="z. B. 7 CS/min in 20 Spielen" value={t} onInput={(e) => setT(e.currentTarget.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && t.trim()) { await rpc('lol.addGoal', { text: t.trim() }); setT(''); reload(); } }} /></div>
    </Panel>
  );
}

function LolChampion({ params }) {
  const [c, , st] = useRpc('lol.champion', { name: params.champion }, { deps: [params.champion], enabled: !!params.champion });
  if (st.error) return <div class="notice warn" style={{ margin: 14 }}>{st.error}</div>;
  if (!c) return <div style={{ padding: 14 }}><Spinner /></div>;
  return (
    <div style={{ padding: 14 }}>
      <div class="row"><img src={c.icon} style={{ width: 56, height: 56, borderRadius: 8 }} /><div><b style={{ fontSize: 18 }}>{c.name}</b><div class="small muted">{c.title} · {c.tags?.join(', ')} · Patch {c.patch}</div></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} class="mt">
        <div class="small"><b>Passiv: {c.passive.name}</b><div class="muted">{c.passive.description}</div>{c.spells.map((s, i) => <div class="mt"><b>{'QWER'[i]}: {s.name}</b><div class="muted">{s.description}</div></div>)}</div>
        <div class="small"><b>Tipps (mit)</b>{(c.allytips || []).map((t) => <div class="muted">• {t}</div>)}<div class="mt"><b>Tipps (gegen)</b></div>{(c.enemytips || []).map((t) => <div class="muted">• {t}</div>)}</div>
      </div>
      <SourceTag source={c.source} />
    </div>
  );
}

const EDGE = { du: ['Du', 'var(--green)'], gegner: ['Gegner', 'var(--red, #e5484d)'], ausgeglichen: ['Ausgeglichen', 'var(--text-2)'] };
const sgn = (v) => (v == null ? '–' : (v > 0 ? '+' : '') + v);

/** Matchup-Karte: KI-Phasenwissen (pro Patch gespeichert) + eigene Bilanz + eigene Notizen. */
export function MatchupCard({ mine, vs, role, compact = false, preset = null }) {
  const [m, setM] = useState(preset);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = async (ai = true) => { setBusy(true); setM(await rpc('lol.matchup', { mine, vs, role, ai }).catch(() => null)); setBusy(false); };
  useEffect(() => { if (vs && !(preset && preset.vs === vs && preset.mine === mine)) load(); else setM(preset); }, [mine, vs, role]);
  useEvent('game:data', () => { if (vs) rpc('lol.matchup', { mine, vs, role, ai: !!m?.card }).then((x) => x && setM(x)).catch(() => {}); });
  const add = async () => { if (!note.trim()) return; await guard(() => rpc('lol.addMatchupNote', { vs, text: note, mine: null }), 'Matchup-Notiz gespeichert'); setNote(''); };
  if (!vs) return null;
  const c = m?.card; const a = m?.stats?.all; const w = m?.stats?.withChampion;
  return (
    <div class="col" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
      <div class="row"><b class="grow">{mine ? `${mine} gegen ${vs}` : `Gegen ${vs}`}</b>{busy && <Spinner size={12} />}</div>
      {c ? <>
        <div class="small">{c.summary}</div>
        <div class="col" style={{ gap: 3 }}>{(c.phases || []).map((ph) => <div class="row small" style={{ alignItems: 'flex-start', gap: 8 }}><span class="chip static" style={{ minWidth: 86, color: EDGE[ph.edge]?.[1] }}>{ph.phase}: {EDGE[ph.edge]?.[0] || ph.edge}</span><span class="grow" style={{ color: 'var(--text-2)' }}>{ph.tip}</span></div>)}</div>
        {c.winCondition && <div class="small"><b>Win-Condition:</b> {c.winCondition}</div>}
        {!compact && c.avoid?.length > 0 && <div class="small"><b>Vermeiden:</b> {c.avoid.join(' · ')}</div>}
        {!compact && c.dangers?.length > 0 && <div class="small"><b>Gefährlich:</b> {c.dangers.join(' · ')}</div>}
        {!compact && c.build && <div class="small"><b>Build:</b> {c.build}</div>}
        <div class="tiny muted">{m.cardSource}{m.patch ? ` · Patch ${m.patch}` : ''}{c.confidence ? ` · Sicherheit: ${c.confidence}` : ''}</div>
      </> : mine && !busy && m && <div class="tiny muted">{m.cardError ? 'Keine KI-Einschätzung: ' + m.cardError : 'Keine KI-Einschätzung (Gemini-Schlüssel fehlt).'}</div>}
      <div class="small" style={{ borderTop: '1px dashed var(--line)', paddingTop: 6 }}><b>Deine Bilanz gegen {vs}:</b>{' '}
        {a ? <>{a.wins}/{a.games} Siege · CS@10 {sgn(a.csDiff10)} · Gold@15 {sgn(a.goldDiff15)} · frühe Tode Ø {a.earlyDeaths ?? '–'}{a.level6Diff != null ? ` · Level 6 ${sgn(a.level6Diff)} Min.` : ''}{a.junglerInEarlyDeathsPct != null ? ` · Jungler bei ${a.junglerInEarlyDeathsPct} % deiner frühen Tode` : ''}{w && mine ? <span class="muted"> · mit {mine}: {w.wins}/{w.games}</span> : null}</> : <span class="muted">noch kein analysiertes Spiel</span>}
      </div>
      {m?.notes?.length > 0 && <div class="col" style={{ gap: 2 }}><b class="small">Deine Notizen</b>{m.notes.slice(0, compact ? 3 : 8).map((n) => <div class="row small"><span class="grow">• {n.text}{n.mineName ? <span class="tiny muted"> (mit {n.mineName})</span> : null}</span>{!compact && <button class="btn xs ghost" title="Löschen" onClick={() => guard(() => rpc('lol.removeMatchupNote', { id: n.id }))}><X size={11} /></button>}</div>)}</div>}
      {!compact && <div class="row gap-s"><input class="inp grow" placeholder={`Notiz für ${vs}, z. B. „Level 1 nicht traden“`} value={note} onInput={(e) => setNote(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><button class="btn xs" onClick={add}><Plus size={12} /></button></div>}
    </div>
  );
}

function MatchupLookup() {
  const [champs] = useRpc('lol.champions', {}, { initial: [] });
  const [mine, setMine] = useState(''); const [vs, setVs] = useState(''); const [go, setGo] = useState(null);
  return (
    <div class="mt">
      <div class="row gap-s"><input class="inp grow" list="lol-champs" placeholder="Dein Champion" value={mine} onInput={(e) => setMine(e.currentTarget.value)} /><input class="inp grow" list="lol-champs" placeholder="Gegner" value={vs} onInput={(e) => setVs(e.currentTarget.value)} /><button class="btn xs" disabled={!vs.trim()} onClick={() => setGo({ mine: mine.trim() || null, vs: vs.trim() })}><Search size={12} />Matchup</button></div>
      <datalist id="lol-champs">{champs.map((c) => <option value={c} />)}</datalist>
      {go && <MatchupCard mine={go.mine} vs={go.vs} />}
    </div>
  );
}

function LolChampSelect() {
  const [cs, setCs] = useState(null);
  const [pick, setPick] = useState(null);
  useEffect(() => { rpc('lol.champselect').then((x) => setCs(x?.active ? x : x?.last ? { ...x.last, last: x.last } : x)).catch(() => {}); }, []);
  useEvent('lol:champselect', (x) => setCs((prev) => (x?.active ? x : prev?.myChampion ? { ...prev, active: false, last: { ...prev, at: new Date().toISOString() } } : x)));
  return (
    <Panel icon={Swords} title="Championauswahl" sub="Nur Champions, keine Spielerdaten (Riot-Richtlinie) · lokaler Client">
      {!cs?.active && !cs?.last ? <div class="notice small">Sobald du im League-Client in der Championauswahl bist, erscheinen hier (und im Overlay) Matchup-Hinweise zu den gegnerischen Champions.</div> : <>
        {!cs.active && <div class="tiny muted mb">Letzte Championauswahl · {ago(cs.last.at)}</div>}
        <div class="row wrap gap-s"><b style={{ fontSize: 16 }}>{cs.myChampion || 'Noch kein Pick'}</b>{cs.role && <span class="chip static">{cs.role}</span>}{cs.myChampion && !cs.locked && <span class="chip static">Vorauswahl</span>}</div>
        <div class="small muted mt">Gegner: {cs.enemies?.length ? cs.enemies.join(', ') : 'noch verdeckt'}</div>
        {cs.advice ? <div class="md small mt" dangerouslySetInnerHTML={{ __html: renderMarkdown(cs.advice) }} /> : cs.active && cs.myChampion && cs.enemies?.length ? <div class="row small mt"><Spinner /> JARVIS denkt über das Matchup nach …</div> : null}
        {cs.tips?.length > 0 && <div class="col mt" style={{ gap: 3 }}><b class="small">Tipps gegen die Gegner (Data Dragon)</b>{cs.tips.map((t) => <div class="small muted">• {t}</div>)}</div>}
        {cs.enemies?.length > 0 && <div class="row wrap gap-s mt"><span class="tiny muted">Matchup-Karte:</span>{cs.enemies.map((e) => <button class={'chip' + ((pick || cs.laneGuess) === e ? ' active' : '')} onClick={() => setPick(e)}>{e}{cs.laneGuess === e ? ' · Lane?' : ''}</button>)}</div>}
        {(pick || cs.laneGuess) && <MatchupCard mine={cs.myChampion} vs={pick || cs.laneGuess} role={cs.role} preset={!pick && cs.matchup?.vs === cs.laneGuess ? cs.matchup : null} />}
      </>}
      <MatchupLookup />
    </Panel>
  );
}

function LolReview() {
  const [list, reload] = useRpc('lol.reviews', { limit: 5 }, { events: ['game:data'], initial: [] });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(0);
  const now = async () => { setBusy(true); await guard(() => rpc('lol.reviewNow')); setBusy(false); reload(); };
  return (
    <Panel icon={GraduationCap} title="Nachbesprechung" sub="Nach jedem Spiel automatisch (League-Client)" right={<button class="btn xs" disabled={busy} onClick={now}>{busy ? <Spinner /> : <RefreshCw size={12} />}Letztes Spiel</button>}>
      {!list.length && <Empty>Nach deinem nächsten Spiel erscheint hier eine Nachbesprechung – mit deinen Werten im Vergleich zu deinem Schnitt und deinen Trainingszielen.</Empty>}
      {list.map((r, i) => (
        <div class="mb">
          <div class="row small" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? -1 : i)}><b class="grow">{r.title}</b><span class="tiny muted">{ago(r.createdAt)}</span></div>
          {open === i && <div class="md small" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.summary) }} />}
        </div>
      ))}
    </Panel>
  );
}

function TrackerStrip() {
  const [st, reload] = useRpc('tracker.status', {}, { events: ['tarkovtracker:status'] });
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  if (!st.configured) return <div class="tiny muted mb">Tipp: Mit einem <a href="#" onClick={(e) => { e.preventDefault(); setState({ page: 'settings' }); }}>TarkovTracker-Token</a> werden erledigte Quests automatisch übernommen.</div>;
  const sync = async () => { setBusy(true); await guard(() => rpc('tracker.sync'), 'Mit TarkovTracker abgeglichen'); setBusy(false); reload(); };
  return (
    <div class="row small mb gap-s" style={{ color: st.error ? 'var(--red)' : 'var(--text-2)' }}>
      <LinkIcon size={13} /><span class="grow ellipsis">TarkovTracker{st.displayName ? ' · ' + st.displayName : ''}{st.level ? ' · Level ' + st.level : ''} · {st.error ? st.error : st.lastSync ? 'abgeglichen ' + ago(st.lastSync) : 'noch nicht abgeglichen'}{st.canWrite ? ' · Abhaken wird übertragen' : ''}</span>
      <button class="btn xs ghost" disabled={busy} onClick={sync}>{busy ? <Spinner /> : <RefreshCw size={12} />}</button>
    </div>
  );
}

// ---------------------------------------------------------------- Spielstand
const PROGRESS_HINT = {
  eft: '„Jarvis, ich hab Debut abgeschlossen“ · „bin jetzt PMC-Level 34“',
  rok: '„Jarvis, Sun Tzu ist jetzt Level 40 mit 5-5-5-5“ · „Rathaus ist auf 22“',
  league: '„Jarvis, ich bin jetzt Gold 2“ · „Kai\'Sa ist mein neuer Main“',
  ark: '„Jarvis, hab einen Rex Level 220 gezähmt“',
};
// Welche Kategorien in welchem Spiel Sinn ergeben (erste = Standard beim Eintragen)
const PROGRESS_CATS = {
  rok: [['commander', 'Kommandanten', 'Sun Tzu', 'Level 40 · 5-5-5-5'], ['building', 'Gebäude', 'Rathaus', 'Stufe 22'], ['research', 'Forschung', 'Ausrüstung', 'fertig'], ['resource', 'Ressourcen', 'Speedups', '3 Tage']],
  eft: [['quest', 'Quests', 'Debut', ''], ['base', 'Versteck', 'Wasseraufbereitung', 'Stufe 2'], ['character', 'PMC', 'PMC-Level', '34'], ['item', 'Items & Schlüssel', 'Marked Key', 'vorhanden']],
  league: [['hero', 'Champions', 'Kai\'Sa', 'Main'], ['achievement', 'Erfolge', 'Gold erreicht', '']],
};
const DEFAULT_CATS = [['quest', 'Quests & Aufgaben', 'Hauptquest Akt 2', ''], ['achievement', 'Erfolge & Bosse', '', 'geschafft'], ['item', 'Items & Ausrüstung', '', ''], ['skill', 'Fähigkeiten & Level', '', ''], ['other', 'Sonstiges', '', '']];

function Progress({ game, params }) {
  const [data, reload] = useRpc('game.progress', { game: game.id }, { events: ['game:progress'] });
  const [cat, setCat] = useState(params.category || '');
  const gameCats = PROGRESS_CATS[game.id] || game.progressCats || DEFAULT_CATS;
  const [f, setF] = useState({ category: gameCats[0][0], name: '', value: '', status: '' });
  const curCat = gameCats.find((c) => c[0] === f.category) || gameCats[0];
  const items = (data?.items || []).filter((x) => !cat || x.category === cat);
  const cats = data?.categories || {};
  const used = [...new Set((data?.items || []).map((x) => x.category))];
  const grouped = {};
  for (const x of items) (grouped[x.category] = grouped[x.category] || []).push(x);
  const add = async () => {
    if (!f.name.trim()) return;
    await guard(() => rpc('game.progressUpsert', { game: game.id, item: { category: f.category, name: f.name.trim(), value: f.value.trim() || undefined, status: f.status || null } }), 'Gespeichert');
    setF({ ...f, name: '', value: '' });
  };
  const edit = async (x) => {
    const v = await ask(`${x.name} – neuer Stand (leer = löschen)`, x.value || (x.status === 'done' ? 'erledigt' : ''));
    if (v === null) return;
    if (!v.trim()) return rpc('game.progressRemove', { id: x.id });
    const isDone = /^erledigt$|^done$|^fertig$/i.test(v.trim());
    rpc('game.progressUpsert', { game: game.id, item: { category: x.category, name: x.name, value: isDone ? '' : v.trim(), status: isDone ? 'done' : x.status } });
  };
  return (
    <Panel icon={Trophy} title="Mein Spielstand" sub="JARVIS kennt diesen Stand bei jeder Frage zum Spiel"
      right={(data?.items || []).length > 0 && <button class="btn xs ghost" title="Z. B. nach einem Wipe" onClick={async () => { if (await ask(`Spielstand ${game.name} zurücksetzen? Der alte Stand wird archiviert.`, '', { confirmOnly: true, danger: true, okLabel: 'Zurücksetzen' })) guard(() => rpc('game.progressWipe', { game: game.id }), 'Spielstand archiviert – neuer Stand beginnt'); }}>Wipe / Neustart</button>}>
      {game.id === 'eft' && <TrackerStrip />}
      {used.length > 1 && <div class="row wrap gap-s mb"><span class={`chip ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>Alle</span>{used.map((c) => <span class={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{gameCats.find((g) => g[0] === c)?.[1] || cats[c] || c}</span>)}</div>}
      <div class="col" style={{ gap: 4, maxHeight: 250, overflow: 'auto' }}>
        {!items.length && <div class="notice small">Noch nichts gespeichert. Erzähl JARVIS einfach von deinem Fortschritt, z. B. {PROGRESS_HINT[game.id] || '„Jarvis, ich bin jetzt Level 30“'} – oder trag es unten ein.</div>}
        {Object.entries(grouped).map(([c, list]) => (
          <div>
            <div class="hud-label" style={{ fontSize: 11, margin: '6px 0 2px' }}>{gameCats.find((g) => g[0] === c)?.[1] || cats[c] || c} · {list.length}</div>
            {list.map((x) => (
              <div class="row small" style={{ padding: '3px 2px', cursor: 'pointer' }} onClick={() => edit(x)} title={`Zuletzt geändert ${fmtDateTime(x.updatedAt)} · Quelle: ${{ chat: 'Gespräch', voice: 'Sprache', manual: 'manuell', api: 'Schnittstelle' }[x.source] || x.source}`}>
                {x.status === 'done' ? <Check size={14} style={{ color: 'var(--green)' }} /> : <span style={{ width: 14 }} />}
                <span class="grow ellipsis">{x.name}</span>
                {x.value && <b style={{ color: 'var(--cyan-2)' }}>{x.value}</b>}
                {x.status && x.status !== 'done' && <span class="chip static">{x.statusLabel}</span>}
                <span class="tiny muted">{ago(x.updatedAt)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div class="row wrap gap-s mt">
        <Select style={{ width: 150 }} value={f.category} onChange={(v) => setF({ ...f, category: v })} options={[...gameCats.map(([k, l]) => ({ value: k, label: l })), ...used.filter((u) => !gameCats.some((c) => c[0] === u)).map((u) => ({ value: u, label: cats[u] || u }))]} />
        <input class="inp grow" style={{ minWidth: 140 }} placeholder={curCat[2] ? `Name (z. B. ${curCat[2]})` : 'Name'} value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input class="inp" style={{ width: 130 }} placeholder={curCat[3] ? `Stand (${curCat[3]})` : 'Stand (optional)'} value={f.value} onInput={(e) => setF({ ...f, value: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Select style={{ width: 105 }} value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[{ value: '', label: '–' }, { value: 'done', label: 'erledigt' }, { value: 'in_progress', label: 'in Arbeit' }, { value: 'todo', label: 'offen' }]} />
        <button class="btn sm" onClick={add}><Plus size={14} /></button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- RoK
function RokPlanner({ game }) {
  const [plan, reload] = useRpc('game.plan', { game: game.id }, { events: ['game:data'] });
  const [t, setT] = useState(''); const [cat, setCat] = useState('Gebäude');
  const CATS2 = ['Gebäude', 'Forschung', 'Kommandanten', 'Truppen', 'Events', 'Allianz'];
  const save = (goals) => rpc('game.savePlan', { game: game.id, plan: { goals } }).then(reload);
  const goals = plan?.goals || [];
  return (
    <Panel icon={Castle} title="Entwicklungsplanung" sub="Deine Ziele – keine erfundenen Spieldaten">
      {CATS2.filter((c) => goals.some((g) => g.category === c)).map((c) => (
        <div class="mb"><div class="hud-label" style={{ fontSize: 11 }}>{c}</div>
          {goals.filter((g) => g.category === c).map((g) => <div class={`sub-row ${g.done ? 'done' : ''}`}><Checkbox checked={g.done} onChange={(v) => save(goals.map((x) => (x.id === g.id ? { ...x, done: v } : x)))} /><span class="grow">{g.text}</span><X size={13} style={{ cursor: 'pointer' }} onClick={() => save(goals.filter((x) => x.id !== g.id))} /></div>)}
        </div>
      ))}
      {!goals.length && <Empty>Lege Ziele an, z. B. „Rathaus 25“, „Forschung: Ausrüstung“ oder „Kommandant Sun Tzu auf 5-1-1-1“.</Empty>}
      <div class="row gap-s mt">
        <Select style={{ width: 140 }} value={cat} onChange={setCat} options={CATS2} />
        <input class="inp grow" placeholder="Ziel hinzufügen (Enter)" value={t} onInput={(e) => setT(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { save([...goals, { text: t.trim(), category: cat, done: false }]); setT(''); } }} />
      </div>
      <button class="btn xs mt" onClick={() => setState({ page: 'chat', chatDraft: 'Hilf mir, meine Rise-of-Kingdoms-Entwicklung zu priorisieren. Recherchiere aktuelle Empfehlungen (mit Quellen) für: ' })}><Sparkles size={12} />Kommandanten/Strategie recherchieren</button>
    </Panel>
  );
}

// ---------- Basis-Paket für jedes Spiel ----------
const fmtM = (m) => (m == null ? '–' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim() : `${m} min`);

function Playtime({ game }) {
  const [st] = useRpc('game.playtime', {}, { events: ['game:data', 'game:running'] });
  const [log, reloadLog] = useRpc('game.log', { game: game.id, limit: 12 }, { events: ['game:data'], initial: [] });
  const [recap] = useRpc('game.recap', { game: game.id }, { events: ['game:data'] });
  const [t, setT] = useState('');
  const g = st?.games?.find((x) => x.game === game.id);
  const max = Math.max(30, ...(g?.daily || [0]));
  const add = async () => { if (!t.trim()) return; await guard(() => rpc('game.addLog', { game: game.id, text: t })); setT(''); reloadLog(); };
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return (
    <Panel icon={Timer} title="Spielzeit & Session-Log" sub="Aus der Spielerkennung – auch ohne Steam, nur lokal">
      {!g ? <div class="small muted">Noch keine Session erfasst. Sobald {game.name} läuft, zählt JARVIS mit.</div> : <>
        <div class="row wrap gap-s"><span class="chip static">Heute {fmtM(g.today)}</span><span class="chip static">Woche {fmtM(g.week)}</span><span class="chip static" title="letzte Woche">Vorwoche {fmtM(g.lastWeek)}</span><span class="chip static" title="30 Tage">{g.sessions} Sessions · Ø {fmtM(g.avgSession)}</span>{g.running && <span class="chip static" style={{ color: 'var(--green)' }}>läuft</span>}</div>
        <div class="row mt" style={{ alignItems: 'flex-end', gap: 3, height: 54 }}>
          {g.daily.map((m, i) => { const d = new Date(Date.now() - (13 - i) * 86400000); return <div class="col" style={{ flex: 1, alignItems: 'center', gap: 2 }} title={`${d.toLocaleDateString('de-DE')}: ${fmtM(m)}`}><div style={{ width: '100%', height: Math.max(2, (m / max) * 40), background: m ? 'var(--cyan)' : 'var(--line)', borderRadius: 2, opacity: i === 13 ? 1 : 0.7 }} /><span class="tiny muted" style={{ fontSize: 9 }}>{days[d.getDay()]}</span></div>; })}
        </div>
        <div class="tiny muted">Längste Session (30 Tage): {fmtM(g.longest)} · alle Spiele diese Woche: {fmtM(st.total.week)}</div>
      </>}
      {recap && (recap.days == null || recap.days >= 3) && (recap.notes?.length || recap.progress?.length) ? <div class="notice small mt"><b>Wo war ich?</b>{recap.days != null ? ` (zuletzt vor ${recap.days} Tagen)` : ''}{recap.notes?.length ? <div>Notizen: {recap.notes.join(' · ')}</div> : null}{recap.progress?.length ? <div>Stand: {recap.progress.join(' · ')}</div> : null}{recap.timers?.length ? <div>Timer: {recap.timers.join(', ')}</div> : null}</div> : null}
      <div class="col mt" style={{ gap: 3 }}>
        <b class="small">Session-Log</b>
        {!log.length && <div class="tiny muted">„Jarvis, merk dir das: …“ – landet hier mit Uhrzeit und Session-Minute.</div>}
        {log.map((n) => <div class="small"><span class="tiny muted">{fmtDateTime(n.at)}{n.minute != null ? ` · Min. ${n.minute}` : ''}</span> {n.text}</div>)}
        <div class="row gap-s"><input class="inp grow" placeholder="Notiz für das Session-Log" value={t} onInput={(e) => setT(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><button class="btn xs" onClick={add}><Plus size={12} /></button></div>
      </div>
    </Panel>
  );
}

function News({ game }) {
  const [list, reload] = useRpc('news.list', { game: game.id, limit: 8 }, { events: ['game:data'], initial: [] });
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(0);
  const sum = async (id) => { setBusy(id); await guard(() => rpc('news.summarize', { id })); setBusy(null); reload(); };
  const check = async () => { setBusy('check'); await guard(() => rpc('news.check')); setBusy(null); reload(); };
  return (
    <Panel icon={Bell} title="Patch-Notes" sub="Offizielle News – Kurzfassung per KI, nur auf Wunsch oder für Spiele, die du gerade spielst" right={<button class="btn xs ghost" title="Jetzt prüfen" onClick={check}>{busy === 'check' ? <Spinner size={12} /> : <RefreshCw size={13} />}</button>}>
      {!list.length && <Empty>Noch keine News. JARVIS schaut alle 6 Stunden nach (für Spiele der letzten 30 Tage und Favoriten).</Empty>}
      {list.map((n, i) => (
        <div class="mb">
          <div class="row small" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? -1 : i)}>{n.patch && <span class="chip static" style={{ fontSize: 10 }}>Patch</span>}<b class="grow">{n.title}</b><span class="tiny muted">{ago(n.publishedAt)}</span></div>
          {open === i && <div class="col" style={{ gap: 4, marginTop: 4 }}>
            {n.summary ? <div class="md small" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.summary) }} /> : n.patch && <button class="btn xs" disabled={busy === n.id} onClick={() => sum(n.id)}>{busy === n.id ? <Spinner size={12} /> : <Sparkles size={12} />}Kurzfassung</button>}
            <div class="tiny muted">{n.source}{n.url ? <> · <a href={n.url} target="_blank" rel="noreferrer">Original</a></> : null}</div>
          </div>}
        </div>
      ))}
    </Panel>
  );
}

function Servers({ game }) {
  const [list, reload] = useRpc('game.servers', { game: game.id }, { initial: [] });
  const [addr, setAddr] = useState(''); const [name, setName] = useState('');
  useEffect(() => { const t = setInterval(reload, 120000); return () => clearInterval(t); }, []);
  const add = async () => { if (!addr.trim()) return; await guard(() => rpc('game.addServer', { address: addr.trim(), name: name.trim() || undefined, game: game.id, kind: game.id === 'minecraft' ? 'minecraft' : 'steam' }), 'Server gespeichert'); setAddr(''); setName(''); reload(); };
  return (
    <Panel icon={Radio} title="Server-Status" sub={game.id === 'minecraft' ? 'Minecraft-Statusabfrage' : 'Steam-Serverabfrage (Query-Port, oft Spielport + 1)'} right={<button class="btn xs ghost" onClick={reload}><RefreshCw size={13} /></button>}>
      {!list.length && <Empty>Noch keine Server. Adresse als host:port eintragen.</Empty>}
      {list.map((x) => <div class="row small mb"><span style={{ width: 8, height: 8, borderRadius: 4, background: x.online ? 'var(--green)' : 'var(--red, #e5484d)' }} /><span class="grow"><b>{x.name || x.address}</b>{x.online ? <span class="muted"> · {x.players}/{x.maxPlayers} Spieler{x.map ? ' · ' + x.map : ''}{x.version ? ' · ' + x.version : ''} · {x.ping} ms</span> : <span class="muted"> · offline ({x.error})</span>}</span><button class="btn xs ghost" title="Entfernen" onClick={() => guard(() => rpc('game.removeServer', { address: x.address })).then(reload)}><X size={11} /></button></div>)}
      <div class="row gap-s mt"><input class="inp grow" placeholder="host:port" value={addr} onInput={(e) => setAddr(e.currentTarget.value)} /><input class="inp" style={{ width: 130 }} placeholder="Name (optional)" value={name} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><button class="btn xs" onClick={add}><Plus size={12} /></button></div>
    </Panel>
  );
}

function Deals() {
  const [st, reload] = useRpc('deals.state', {}, { events: ['game:data'] });
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); await guard(() => rpc('deals.check')); setBusy(false); reload(); };
  const sale = (st?.items || []).filter((x) => x.discount > 0);
  return (
    <Panel icon={TrendingDown} title="Wunschliste im Angebot" sub={st?.at ? `Steam · Stand ${ago(st.at)}` : 'Steam-Wunschliste (muss öffentlich sein)'} right={<button class="btn xs ghost" onClick={check}>{busy ? <Spinner size={12} /> : <RefreshCw size={13} />}</button>}>
      {!st && <Empty>Noch nicht geprüft. JARVIS schaut zweimal am Tag nach und meldet Rabatte ab der eingestellten Höhe.</Empty>}
      {st && !sale.length && <div class="small muted">Gerade nichts von deinen {st.items.length} Wunschlisten-Spielen im Angebot.</div>}
      {sale.slice(0, 8).map((d) => <div class="row small mb"><b class="grow"><a href={d.url} target="_blank" rel="noreferrer">{d.name}</a></b><span class="chip static" style={{ color: 'var(--green)' }}>−{d.discount} %</span><span>{d.final.toFixed(2).replace('.', ',')} €</span></div>)}
    </Panel>
  );
}

function Cs2Matches() {
  const [st, reloadSt] = useRpc('cs2.status', {}, { events: ['game:data'] });
  const [list] = useRpc('cs2.matches', {}, { events: ['game:data'], initial: [] });
  const [open, setOpen] = useState(0);
  const install = async () => {
    if (!(await ask('CS2-Spielzustand für JARVIS freigeben? JARVIS legt in deinem CS2-Ordner die offizielle Valve-Datei „gamestate_integration_jarvis.cfg“ an. CS2 schickt dann nur deine eigenen Werte an deinen PC (127.0.0.1). Danach CS2 neu starten.', '', { confirmOnly: true, okLabel: 'Einrichten' }))) return;
    await guard(() => rpc('cs2.install'), 'Eingerichtet – CS2 neu starten'); reloadSt();
  };
  const col = (r) => (r.won ? 'var(--green)' : 'var(--red, #e5484d)');
  return (
    <Panel icon={Crosshair} title="Match-Nachbesprechung" sub="Valve Game State Integration – nur deine Werte, ausgewertet nach dem Match">
      {st && !st.installed && <div class="notice small mb">{st.found ? <>Noch nicht eingerichtet. <button class="btn xs" onClick={install}>Einrichten</button></> : 'CS2 wurde in deiner Steam-Bibliothek nicht gefunden.'}</div>}
      {!list.length && <Empty>Nach deinem nächsten Match (ab 5 Runden) erscheint hier die Auswertung: Runden, Kaufarten, Seiten, Auffälligkeiten.</Empty>}
      {list.slice(0, 6).map((m, i) => <div class="mb">
        <div class="row small" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? -1 : i)}><b class="grow">{m.map} · {m.result || '–'} {m.us != null ? `${m.us}:${m.them}` : ''}</b><span class="muted">{m.stats ? `${m.stats.kills}/${m.stats.assists}/${m.stats.deaths}` : ''}</span><span class="tiny muted" style={{ marginLeft: 8 }}>{ago(m.endedAt)}</span></div>
        {open === i && <div class="col" style={{ gap: 4, marginTop: 4 }}>
          <div class="row wrap" style={{ gap: 2 }}>{m.rounds.map((r) => <span title={`Runde ${r.n} · ${r.side} · ${r.buy || '?'} · ${r.kills} Kills${r.died ? ' · tot' : ''}`} style={{ width: 16, height: 22, borderRadius: 3, background: col(r), opacity: r.buy === 'eco' ? 0.45 : 0.9, fontSize: 9, color: '#000', display: 'grid', placeItems: 'center' }}>{r.kills || ''}</span>)}</div>
          <div class="tiny muted">Grün = gewonnen, blass = Eco · Zahl = deine Kills</div>
          <div class="small">{Object.entries(m.summary?.byBuy || {}).map(([k, v]) => `${k}: ${v.won}/${v.rounds}`).join(' · ')}{m.summary?.hsPct != null ? ` · ${m.summary.hsPct} % Headshots` : ''}</div>
          {m.summary?.ct && m.summary?.t && <div class="small">CT: {m.summary.ct.won}/{m.summary.ct.rounds} Runden, {m.summary.ct.kills} K / {m.summary.ct.deaths} D · T: {m.summary.t.won}/{m.summary.t.rounds}, {m.summary.t.kills} K / {m.summary.t.deaths} D</div>}
          {(m.summary?.findings || []).map((f) => <div class="small"><TriangleAlert size={12} style={{ color: 'var(--orange)' }} /> {f}</div>)}
        </div>}
      </div>)}
    </Panel>
  );
}

function RacingLaps() {
  const [list] = useRpc('ac.sessions', {}, { events: ['game:data'], initial: [] });
  const [open, setOpen] = useState(0);
  const lap = (ms) => (ms == null ? '–' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`);
  return (
    <Panel icon={Timer} title="Rundenanalyse" sub="Offizielle Assetto-Corsa-Telemetrie – nur lesend, nur während AC läuft">
      {!list.length && <Empty>Fahr ein paar Runden – danach zeigt JARVIS Bestzeit, Konstanz und wo du gegenüber deiner besten Runde Zeit verlierst.</Empty>}
      {list.slice(0, 6).map((x, i) => { const a = x.analysis || {}; const maxLoss = Math.max(100, ...(a.sections || []).map((s) => s.avgLossMs || 0)); return <div class="mb">
        <div class="row small" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? -1 : i)}><b class="grow">{x.track} · {x.car}</b><span>{lap(a.best)}</span><span class="tiny muted" style={{ marginLeft: 8 }}>{ago(x.endedAt)}</span></div>
        {open === i && <div class="col" style={{ gap: 4, marginTop: 4 }}>
          <div class="small">{a.valid}/{a.laps} gültige Runden · Schnitt {lap(a.avg)} · Konstanz ±{a.sd != null ? (a.sd / 1000).toFixed(2) : '–'} s{a.sectors?.length ? ' · Sektoren best/Ø: ' + a.sectors.map((s) => s ? `${lap(s.best)}/${lap(s.avg)}` : '–').join(' · ') : ''}</div>
          {a.sections?.some((s) => s.avgLossMs != null) && <div><div class="tiny muted">Zeitverlust gegenüber deiner Bestzeit pro Abschnitt der Runde</div><div class="row" style={{ alignItems: 'flex-end', gap: 2, height: 46 }}>{a.sections.map((s) => <div title={`${s.from}–${s.to} %: ${s.avgLossMs != null ? (s.avgLossMs / 1000).toFixed(2) + ' s' : '–'}${s.minSpd != null ? ` · Kurve ${s.minSpd} km/h (best ${s.bestMinSpd})` : ''}`} style={{ flex: 1, height: Math.max(2, ((s.avgLossMs || 0) / maxLoss) * 42), background: (s.avgLossMs || 0) > 150 ? 'var(--orange)' : 'var(--cyan)', borderRadius: 2 }} />)}</div><div class="row tiny muted"><span class="grow">Start/Ziel</span><span>Runde →</span></div></div>}
          {(a.findings || []).map((f) => <div class="small"><TriangleAlert size={12} style={{ color: 'var(--orange)' }} /> {f}</div>)}
        </div>}
      </div>; })}
    </Panel>
  );
}

function PubgMatches() {
  const [d, reload] = useRpc('pubg.matches', {}, { events: ['game:data'] });
  const [busy, setBusy] = useState(false); const [sel, setSel] = useState(0);
  const sync = async () => { setBusy(true); await guard(() => rpc('pubg.sync')); setBusy(false); reload(); };
  const list = d?.matches || []; const m = list[sel];
  const size = m?.mapSize || Math.max(1, ...(m?.route || []).flatMap(([x, y]) => [x, y]));
  const P = (x, y) => [(x / size) * 100, (y / size) * 100];
  return (
    <Panel icon={Crosshair} title="Match-Nachbesprechung" sub="Offizielle PUBG-API – nach dem Match" right={<button class="btn xs ghost" onClick={sync}>{busy ? <Spinner size={12} /> : <RefreshCw size={13} />}</button>}>
      {d && !d.configured && <div class="notice small mb">PUBG-API-Schlüssel (kostenlos auf developer.pubg.com) und Spielername in Einstellungen → Gaming eintragen.</div>}
      {d?.stats && <div class="row wrap gap-s mb"><span class="chip static">Ø Platz {d.stats.avgPlace}</span><span class="chip static">Ø {d.stats.avgKills} Kills</span><span class="chip static">Ø {d.stats.avgDamage} Schaden</span><span class="chip static">Top 10: {d.stats.top10}/{d.stats.matches}</span></div>}
      {(d?.stats?.findings || []).map((f) => <div class="small mb"><TriangleAlert size={12} style={{ color: 'var(--orange)' }} /> {f}</div>)}
      {!list.length && d?.configured && <Empty>Noch keine Matches geladen – nach dem nächsten Spiel holt JARVIS sie automatisch.</Empty>}
      {list.length > 0 && <>
        <Select value={String(sel)} onChange={(v) => setSel(Number(v))} options={list.map((x, i) => ({ value: String(i), label: `${x.map} · Platz ${x.place ?? '–'} · ${x.kills} Kills · ${ago(x.at)}` }))} />
        {m && <div class="row wrap gap-s mt" style={{ alignItems: 'flex-start' }}>
          <svg viewBox="0 0 100 100" style={{ width: 220, aspectRatio: '1', background: '#14211b', borderRadius: 8 }}>
            {[25, 50, 75].map((v) => <g><line x1={v} x2={v} y1="0" y2="100" stroke="#ffffff14" stroke-width="0.3" /><line y1={v} y2={v} x1="0" x2="100" stroke="#ffffff14" stroke-width="0.3" /></g>)}
            {m.route?.length > 1 && <polyline points={m.route.map(([x, y]) => P(x, y).join(',')).join(' ')} fill="none" stroke="#2fd5ff" stroke-width="0.7" />}
            {m.landing && <circle cx={P(m.landing.x, m.landing.y)[0]} cy={P(m.landing.x, m.landing.y)[1]} r="1.8" fill="#7cf29a"><title>Landung</title></circle>}
            {(m.kills || []).map((k) => <circle cx={P(k.x, k.y)[0]} cy={P(k.x, k.y)[1]} r="1.2" fill="#ffcc33"><title>Kill</title></circle>)}
            {m.death && <text x={P(m.death.x, m.death.y)[0]} y={P(m.death.x, m.death.y)[1] + 1.2} font-size="4" text-anchor="middle" fill="#ff5a5a">✕</text>}
          </svg>
          <div class="col small grow" style={{ gap: 3, minWidth: 180 }}>
            <div>Platz {m.place ?? '–'} · {m.kills} Kills ({m.headshots} HS) · {m.damage} Schaden</div>
            <div>Überlebt {Math.floor(m.survived / 60)}:{String(m.survived % 60).padStart(2, '0')} · gelaufen {(m.walk / 1000).toFixed(1)} km{m.ride ? ` · gefahren ${(m.ride / 1000).toFixed(1)} km` : ''}</div>
            {m.death && <div>Tod{m.death.by ? ` durch ${m.death.by}` : ''}{m.death.weapon ? ` · ${m.death.weapon}` : ''}{m.death.distanceM != null ? ` · ${m.death.distanceM} m` : ''}</div>}
            <div class="tiny muted">Grün = Landung · Linie = deine Route · Gelb = Kills · ✕ = Tod</div>
          </div>
        </div>}
      </>}
    </Panel>
  );
}

function StardewFarm() {
  const [d, reload] = useRpc('stardew.read', {}, { events: ['game:data', 'game:running'] });
  if (!d) return null;
  return (
    <Panel icon={Castle} title="Mein Hof" sub={d.found ? `Spielstand von ${fmtDateTime(d.savedAt)} – nur gelesen` : 'Stardew-Spielstand'} right={<button class="btn xs ghost" onClick={reload}><RefreshCw size={13} /></button>}>
      {!d.found ? <Empty>Kein Spielstand gefunden. Stardew speichert beim Schlafengehen – danach steht er hier.</Empty> : <>
        <div class="row wrap gap-s"><span class="chip static">{d.farm || 'Hof'} · {d.farmer}</span><span class="chip static">{d.day}. {d.seasonDe}, Jahr {d.year}</span><span class="chip static">{d.money.toLocaleString('de-DE')} g</span><span class="chip static">Bündel {d.bundlesDone}/{d.bundlesTotal}</span></div>
        <div class="col mt" style={{ gap: 2 }}><b class="small">Geburtstage (nächste 7 Tage)</b>{!d.upcoming.length && <div class="small muted">Keine.</div>}{d.upcoming.map((b) => <div class="small">{b.inDays === 0 ? 'Heute' : b.inDays === 1 ? 'Morgen' : `in ${b.inDays} Tagen`}: <b>{b.name}</b> ({b.day}. {b.seasonDe}){b.hearts != null ? ` · ${b.hearts} ♥` : ''}</div>)}</div>
        <div class="col mt" style={{ gap: 2 }}><b class="small">Freundschaften</b><div class="row wrap gap-s">{d.friends.slice(0, 12).map((f) => <span class="chip static" title={`${f.points} Punkte`}>{f.name} {f.hearts}♥</span>)}</div></div>
        {d.bundlesOpen.length > 0 && <div class="col mt" style={{ gap: 2 }}><b class="small">Offene Bündel</b>{d.bundlesOpen.slice(0, 10).map((b) => <div class="small">{b.roomDe}: {b.name} – {b.done}/{b.need}</div>)}</div>}
      </>}
    </Panel>
  );
}

const WIKI_IDEAS = { eldenring: ['Questlinie Ranni', 'Questlinie Millicent', 'Hauptbosse'], baldursgate3: ['Verpassbare Quests Akt 1', 'Begleiter rekrutieren'], terraria: ['Bosse in Reihenfolge', 'Hardmode-Bosse'], cyberpunk: ['Ikonische Waffen', 'Nebenjobs Watson'], subnautica: ['Story-Fortschritt', 'Baupläne Cyclops'], monsterhunter: ['Hauptquests'], minecraft: ['Erfolge Nether'], palworld: ['Turm-Bosse'], stardew: ['Gemeinschaftszentrum Bündel'] };
function WikiListsWidget({ game }) {
  const [topic, setTopic] = useState(''); const [busy, setBusy] = useState(false); const [res, setRes] = useState(null);
  const make = async (t) => { const q = (t || topic).trim(); if (!q) return; setBusy(true); setRes(await guard(() => rpc('wikilist.create', { game: game.id, topic: q }))); setBusy(false); setTopic(''); };
  return (
    <Panel icon={ListChecks} title="Checklisten aus dem Wiki" sub={`${game.wiki ? 'Aus dem Spiel-Wiki' : 'Aus einer Websuche'} – jeder Punkt mit Zitat belegt, Unbelegtes fliegt raus`}>
      <div class="row gap-s"><input class="inp grow" placeholder="z. B. Questlinie, Bosse in Reihenfolge, verpassbare Quests …" value={topic} onInput={(e) => setTopic(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && make()} /><button class="btn xs" disabled={busy} onClick={() => make()}>{busy ? <Spinner size={12} /> : <Plus size={12} />}Anlegen</button></div>
      {(WIKI_IDEAS[game.id] || []).length > 0 && <div class="row wrap gap-s mt">{WIKI_IDEAS[game.id].map((t) => <button class="chip" disabled={busy} onClick={() => make(t)}>{t}</button>)}</div>}
      {res && <div class="small mt">„{res.name}“: {res.items} Punkte angelegt{res.dropped > 0 ? ` (${res.dropped} ohne Beleg verworfen)` : ''}.</div>}
    </Panel>
  );
}

function FactorioCalc() {
  const [st, reloadSt] = useRpc('factorio.status', {}, {});
  const [items] = useRpc('factorio.items', {}, { initial: [], enabled: !!st?.dump });
  const [machines] = useRpc('factorio.machines', {}, { initial: [], enabled: !!st?.dump });
  const [f, setF] = useState({ item: 'electronic-circuit', rate: 1, crafting: '' }); const [res, setRes] = useState(null); const [busy, setBusy] = useState(false);
  const dump = async () => { if (!(await ask('Factorio-Spieldaten einlesen? JARVIS startet dafür einmal „factorio.exe --dump-data“ (ohne Fenster, Factorio muss geschlossen sein). Das schreibt die Rezepte deiner Installation in deinen Factorio-Ordner.', '', { confirmOnly: true, okLabel: 'Einlesen' }))) return; setBusy(true); await guard(() => rpc('factorio.dump'), 'Spieldaten eingelesen'); setBusy(false); reloadSt(); };
  const calc = async () => setRes(await guard(() => rpc('factorio.calc', { item: f.item.trim(), rate: Number(f.rate), machineFor: f.crafting ? { crafting: f.crafting, 'advanced-crafting': f.crafting } : {} })));
  const crafting = machines.filter((m) => m.categories.includes('crafting'));
  return (
    <Panel icon={Hammer} title="Verhältnis-Rechner" sub={st?.dump ? `Spieldaten deiner Installation · ${fmtDateTime(st.dumpAt)}` : 'Rezepte aus deiner Factorio-Installation'}>
      {!st?.dump ? <div class="notice small">Noch keine Spieldaten. <button class="btn xs" disabled={busy} onClick={dump}>{busy ? <Spinner size={12} /> : null}Spieldaten einlesen</button></div> : <>
        <div class="row gap-s"><input class="inp grow" list="fac-items" value={f.item} onInput={(e) => setF({ ...f, item: e.currentTarget.value })} /><input class="inp" type="number" min="0.01" step="0.25" style={{ width: 80 }} value={f.rate} onInput={(e) => setF({ ...f, rate: e.currentTarget.value })} /><span class="tiny muted">/s</span>
          {crafting.length > 0 && <Select style={{ width: 170 }} value={f.crafting} onChange={(v) => setF({ ...f, crafting: v })} options={[{ value: '', label: 'Maschine: Standard' }, ...crafting.map((m) => ({ value: m.name, label: `${m.name} (${m.speed}×)` }))]} />}
          <button class="btn xs" onClick={calc}>Rechnen</button></div>
        <datalist id="fac-items">{items.map((x) => <option value={x} />)}</datalist>
        {res && <div class="mt"><table class="small" style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr class="tiny muted"><th style={{ textAlign: 'left' }}>Rezept</th><th>pro s</th><th>Maschine</th><th>Anzahl</th></tr></thead>
          <tbody>{res.steps.map((x) => <tr><td>{x.recipe}</td><td style={{ textAlign: 'center' }}>{x.perSec}</td><td class="tiny muted" style={{ textAlign: 'center' }}>{x.machine || '–'}</td><td style={{ textAlign: 'center' }}><b>{x.machinesRounded ?? '–'}</b> <span class="tiny muted">({x.machines})</span></td></tr>)}</tbody></table>
          <div class="small mt"><b>Rohstoffe:</b> {Object.entries(res.raw).map(([k, v]) => `${k} ${v}/s`).join(' · ')}</div></div>}
      </>}
    </Panel>
  );
}

function LolProgress() {
  const [d] = useRpc('lol.progress', {}, { events: ['game:data'] });
  const h = d?.rank || [];
  const TIER_DE = { IRON: 'Eisen', BRONZE: 'Bronze', SILVER: 'Silber', GOLD: 'Gold', PLATINUM: 'Platin', EMERALD: 'Smaragd', DIAMOND: 'Diamant', MASTER: 'Meister', GRANDMASTER: 'Großmeister', CHALLENGER: 'Herausforderer' };
  const lo = Math.min(...h.map((x) => x.abs)); const hi = Math.max(...h.map((x) => x.abs)); const span = Math.max(100, hi - lo);
  const pts = h.map((x, i) => `${h.length > 1 ? (i / (h.length - 1)) * 100 : 50},${38 - ((x.abs - lo) / span) * 34}`).join(' ');
  const last = h[h.length - 1];
  return (
    <Panel icon={TrendingUp} title="Rang-Verlauf & Champion-Pool" sub="Aus deinen gespeicherten Ranked-Spielen und Rang-Ständen">
      {h.length >= 2 ? <div><div class="row small"><b class="grow">{TIER_DE[last.tier] || last.tier} {last.rank} · {last.lp} LP</b><span class="tiny muted">{h.length} Stände seit {fmtDateTime(h[0].at)}</span></div>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: 70 }}><polyline points={pts} fill="none" stroke="var(--cyan)" stroke-width="1.4" vector-effect="non-scaling-stroke" />{Array.from({ length: Math.floor(hi / 100) - Math.ceil(lo / 100) + 1 }, (_, i) => (Math.ceil(lo / 100) + i) * 100).map((v) => <line x1="0" x2="100" y1={38 - ((v - lo) / span) * 34} y2={38 - ((v - lo) / span) * 34} stroke="var(--line)" stroke-width="0.3" stroke-dasharray={v % 400 === 0 ? '' : '1 1'} />)}</svg>
        <div class="tiny muted">Linien = Divisionen (durchgezogen = neuer Rang)</div></div> : <div class="small muted">Der Verlauf füllt sich mit jedem Abgleich (Client offen).</div>}
      {d?.pool?.roles?.length > 0 && <div class="col mt" style={{ gap: 4 }}><b class="small">Dein Champion-Pool</b>{d.pool.roles.slice(0, 3).map((r) => <div class="small"><span class="muted">{r.role}:</span> {r.pool.map((c) => `${c.champion} (${c.wins}/${c.games}, ${c.kda} KDA)`).join(' · ')}{r.drop.length ? <span class="tiny muted"> · schwach: {r.drop.join(', ')}</span> : null}</div>)}</div>}
      {d?.modes?.length > 0 && <div class="col mt" style={{ gap: 3 }}><b class="small">Andere Modi</b>{d.modes.map((m) => <div class="small">{m.mode}: {m.games} Spiele · {m.avgPlace != null ? `Ø Platz ${m.avgPlace}, Top 4: ${m.top4}` : `${m.winrate} % Siege`} · KDA {m.kda} · {m.champions.slice(0, 3).map((c) => c.champion).join(', ')}</div>)}</div>}
    </Panel>
  );
}

const rub = (v) => (v == null ? '–' : Math.round(v).toLocaleString('de-DE') + ' ₽');
function TarkovEconomy() {
  const [d, reload] = useRpc('eft.economy', {}, {});
  const [tab, setTab] = useState('crafts');
  useNow(1000);
  useEffect(() => { const t = setInterval(reload, 10 * 60000); return () => clearInterval(t); }, []);
  if (!d) return <Panel icon={Package} title="Händler, Crafts & Tausch"><Spinner /></Panel>;
  return (
    <Panel icon={Package} title="Händler, Crafts & Tausch" sub={`${d.source} · ${d.note}`}>
      <div class="row wrap gap-s mb">{d.traders.map((t) => <span class="chip static" title={`Restock ${fmtDateTime(t.resetTime)}`}>{t.name}: {new Date(t.resetTime) > new Date() ? countdown(t.resetTime) : 'jetzt'}</span>)}</div>
      <div class="row gap-s mb"><button class={'chip' + (tab === 'crafts' ? ' active' : '')} onClick={() => setTab('crafts')}>Crafts</button><button class={'chip' + (tab === 'barters' ? ' active' : '')} onClick={() => setTab('barters')}>Tausch</button></div>
      {tab === 'crafts' && <>{!d.onlyBuilt && <div class="tiny muted mb">Alle Stationen – mit deinem Hideout (TarkovTracker oder Hideout-Widget) nur, was du craften kannst.</div>}
        {d.crafts.map((c) => <div class="row small mb" title={`Kosten ${rub(c.cost)} · Erlös ${rub(c.rewardValue)}`}><span class="grow"><b>{c.reward}</b><span class="tiny muted"> · {c.station} {c.level} · {Math.round(c.duration / 60)} min</span></span><span style={{ color: 'var(--green)' }}>{rub(c.perHour)}/h</span></div>)}</>}
      {tab === 'barters' && d.barters.map((b) => <div class="row small mb" title={b.inputs.map((x) => `${x.count}× ${x.name}`).join(', ')}><span class="grow"><b>{b.reward}</b><span class="tiny muted"> · {b.trader} LL{b.level}</span></span><span style={{ color: 'var(--green)' }}>+{rub(b.profit)}</span></div>)}
    </Panel>
  );
}

function TarkovAmmo({ params = {} }) {
  const [d] = useRpc('eft.ammo', {}, {});
  const cals = useMemo(() => [...new Set((d?.items || []).map((a) => a.caliber))].sort(), [d]);
  const [cal, setCal] = useState(params.caliber || '');
  const list = (d?.items || []).filter((a) => a.caliber === (cal || cals[0])).sort((a, b) => b.pen - a.pen);
  return (
    <Panel icon={Crosshair} title="Munition" sub={d ? `${d.source} · Stand ${ago(d.fetchedAt)}` : 'tarkov.dev'}>
      {cals.length > 0 && <Select value={cal || cals[0]} onChange={setCal} options={cals} />}
      <table class="small mt" style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr class="tiny muted"><th style={{ textAlign: 'left' }}>Patrone</th><th>Schaden</th><th>Durchschlag</th><th>Panzer</th><th>Splitter</th><th>Preis</th></tr></thead>
        <tbody>{list.map((a) => <tr><td>{a.name}</td><td style={{ textAlign: 'center' }}>{a.damage}</td><td style={{ textAlign: 'center', color: a.pen >= 40 ? 'var(--green)' : a.pen < 20 ? 'var(--text-3)' : undefined }}><b>{a.pen}</b></td><td style={{ textAlign: 'center' }}>{a.armor}</td><td style={{ textAlign: 'center' }}>{a.frag} %</td><td style={{ textAlign: 'right' }}>{rub(a.price)}</td></tr>)}</tbody></table>
    </Panel>
  );
}

function ArkBreeding({ game }) {
  const [list, reload] = useRpc('ark.babies', { game: game.id }, { events: ['game:data', 'game:timers'], initial: [] });
  const [f, setF] = useState({ name: '', species: '', matureIn: '', cuddleIn: '' });
  useNow(1000);
  const add = async () => { if (!f.name.trim()) return; if (await guard(() => rpc('ark.add', { game: game.id, ...f }), 'Baby angelegt – Erinnerungen laufen')) { setF({ name: '', species: '', matureIn: '', cuddleIn: '' }); reload(); } };
  return (
    <Panel icon={Timer} title="Zucht & Prägung" sub="Erinnert aufs Handy zur Prägung und wenn das Baby ausgewachsen ist – Zeiten aus dem Spiel ablesen (oder Screenshot-Hotkey)">
      {!list.length && <Empty>Noch kein Baby. Trag Name, Reife-Restzeit und Zeit bis zum nächsten Kuscheln ein – oder drück den Screenshot-Hotkey auf dem Baby.</Empty>}
      {list.map((b) => <div class="row small mb" style={{ alignItems: 'center' }}>
        <div class="grow"><b>{b.name}</b>{b.species ? <span class="muted"> · {b.species}</span> : null}<div class="tiny muted">{b.grown ? 'ausgewachsen' : b.matureAt ? `ausgewachsen in ${countdown(b.matureAt)}` : 'Reifezeit unbekannt'} · {b.imprints}× geprägt{b.nextCuddle ? ` · nächste Prägung in ${countdown(b.nextCuddle)}` : ''}</div></div>
        {!b.grown && <button class="btn xs" title="Jetzt geprägt – nächste Erinnerung ab jetzt" onClick={() => guard(() => rpc('ark.imprinted', { game: game.id, id: b.id }), 'Nächste Prägung geplant').then(reload)}><Check size={12} />Geprägt</button>}
        <button class="btn xs ghost" onClick={() => guard(() => rpc('ark.remove', { game: game.id, id: b.id })).then(reload)}><X size={11} /></button>
      </div>)}
      <div class="row wrap gap-s mt">
        <input class="inp" style={{ width: 110 }} placeholder="Name" value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <input class="inp" style={{ width: 110 }} placeholder="Art (optional)" value={f.species} onInput={(e) => setF({ ...f, species: e.currentTarget.value })} />
        <input class="inp" style={{ width: 120 }} placeholder="Reife in, z. B. 1d 4h" value={f.matureIn} onInput={(e) => setF({ ...f, matureIn: e.currentTarget.value })} />
        <input class="inp" style={{ width: 120 }} placeholder="Prägen in, z. B. 7h 50m" value={f.cuddleIn} onInput={(e) => setF({ ...f, cuddleIn: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button class="btn xs" onClick={add}><Plus size={12} /></button>
      </div>
      <div class="tiny muted mt">Prägungs-Intervall: Einstellungen → Gaming (ARK-Standard 8 h, auf Servern mit anderen Raten anpassen).</div>
    </Panel>
  );
}

const SPEED_TYPES = [['building', 'Bau'], ['research', 'Forschung'], ['training', 'Training'], ['healing', 'Heilung']];
function RokSpeedups() {
  const [st, reload] = useRpc('rok.speedups', {}, { events: ['game:data'] });
  const [type, setType] = useState('building'); const [need, setNeed] = useState(''); const [res, setRes] = useState(null);
  const [edit, setEdit] = useState(false); const [inv, setInv] = useState(null);
  const calc = async () => { if (!need.trim()) return; setRes(await guard(() => rpc('rok.calc', { type, need }))); };
  const fmt = (m) => (m >= 1440 ? `${Math.round(m / 144) / 10} T` : m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} min`);
  const save = async () => { const entries = []; for (const [t, row] of Object.entries(inv)) for (const [d, n] of Object.entries(row)) entries.push({ type: t, duration: d + 'm', count: Number(n) || 0 }); await guard(() => rpc('rok.setSpeedups', { entries }), 'Inventar gespeichert'); setEdit(false); reload(); };
  if (!st) return null;
  return (
    <Panel icon={Timer} title="Speedup-Rechner" sub="Inventar per Screenshot-Hotkey („lies meine Speedups“) oder hier pflegen">
      <div class="row wrap gap-s">{Object.entries(st.types).map(([k, l]) => <span class="chip static">{l}: {st.totalsText[k]}</span>)}</div>
      <div class="row gap-s mt"><Select style={{ width: 130 }} value={type} onChange={setType} options={SPEED_TYPES.map(([v, label]) => ({ value: v, label }))} /><input class="inp grow" placeholder="Benötigt, z. B. 12d 4h 30m" value={need} onInput={(e) => setNeed(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && calc()} /><button class="btn xs" onClick={calc}>Reicht es?</button></div>
      {res && <div class="small mt"><b style={{ color: res.enough ? 'var(--green)' : 'var(--orange)' }}>{res.enough ? 'Reicht' : `Es fehlen ${res.missingText}`}</b> · benötigt {res.needText}, vorhanden ({res.typeLabel} + Universal) {res.haveText}{res.plan.length ? <div class="muted">Plan: {res.plan.map((x) => x.label).join(' · ')}{res.overshoot ? ` (Überschuss ${fmt(res.overshoot)})` : ''}</div> : null}</div>}
      <button class="btn xs ghost mt" onClick={() => { setInv(JSON.parse(JSON.stringify(st.inventory))); setEdit(!edit); }}>{edit ? 'Schließen' : 'Inventar bearbeiten'}</button>
      {edit && inv && <div class="mt" style={{ overflowX: 'auto' }}>
        <table class="small" style={{ borderCollapse: 'collapse' }}><thead><tr><th />{st.durations.map((d) => <th class="tiny muted" style={{ padding: '0 3px' }}>{fmt(d)}</th>)}</tr></thead>
          <tbody>{Object.entries(st.types).map(([t, l]) => <tr><td class="tiny" style={{ paddingRight: 6 }}>{l}</td>{st.durations.map((d) => <td><input class="inp" style={{ width: 44, padding: '2px 4px' }} type="number" min="0" value={inv[t][d]} onInput={(e) => setInv({ ...inv, [t]: { ...inv[t], [d]: e.currentTarget.value } })} /></td>)}</tr>)}</tbody></table>
        <button class="btn xs mt" onClick={save}><Check size={12} />Speichern</button>
      </div>}
    </Panel>
  );
}

export const WIDGETS = {
  map: MapWidget, 'tarkov-raidplan': TarkovRaidPlan, 'tarkov-companion': TarkovCompanion, 'tarkov-needed': TarkovNeeded, 'tarkov-hideout': TarkovHideout, 'tarkov-raid': TarkovRaid, 'tarkov-quests': TarkovQuests, 'tarkov-item': TarkovItem, checklist: Checklist, 'other-games': OtherGames,
  timers: Timers, notes: Notes, sources: Sources, 'game-research': GameResearch, wiki: Wiki, 'game-stats': GameStats,
  'lol-overview': LolOverview, 'lol-champions': LolChampions, 'lol-matches': LolMatches, 'lol-coaching': LolCoaching, 'lol-live': LolLive, 'lol-goals': LolGoals, 'lol-champion': LolChampion,
  'lol-champselect': LolChampSelect, 'lol-review': LolReview, 'lol-mistakes': LolMistakes, 'lol-game': LolGame, 'lol-coach': LolCoach,
  'rok-planner': RokPlanner, progress: Progress, ask: AskWidget, links: LinksWidget,
  playtime: Playtime, news: News, servers: Servers, deals: Deals, 'rok-speedups': RokSpeedups, 'ark-breeding': ArkBreeding, 'cs2-matches': Cs2Matches, 'racing-laps': RacingLaps, 'pubg-matches': PubgMatches, 'stardew-farm': StardewFarm, 'wiki-lists': WikiListsWidget, 'factorio-calc': FactorioCalc, 'tarkov-economy': TarkovEconomy, 'lol-progress': LolProgress, 'tarkov-ammo': TarkovAmmo,
};
export { nextScheduled };
