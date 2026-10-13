import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { Map as MapIcon, Maximize2, Minimize2, Plus, Minus, Crosshair, Footprints, Package, TriangleAlert, Target, KeyRound, MapPin, Trash2, Undo2, Layers, Route, ImagePlus, Search, ExternalLink, Timer, NotebookPen, Globe, Bell, ListChecks, Trophy, RefreshCw, Swords, Eye, TrendingUp, TrendingDown, GraduationCap, Shield, BarChart3, Radio, Sparkles, X, Check, Ruler, Skull, Castle, FlaskConical, Hammer, Link as LinkIcon } from 'lucide-preact';
import { rpc, useRpc, useEvent, cleanErr } from '../../lib/api.js';
import { guard, toast, setState } from '../../lib/store.js';
import { Panel, Checkbox, Empty, SourceTag, Spinner, useNow, ask, Select } from '../../components/ui.jsx';
import { countdown, ago, fmtDateTime } from '../../lib/format.js';
import { renderMarkdown, onMarkdownClick } from '../../lib/markdown.js';

export const SPAN = {
  map: 'w-7', 'tarkov-raid': 'w-5', 'tarkov-quests': 'w-4', 'tarkov-item': 'w-4', checklist: 'w-4', 'other-games': 'w-6',
  'lol-overview': 'w-12', 'lol-champions': 'w-6', 'lol-matches': 'w-6', 'lol-coaching': 'w-6', 'lol-live': 'w-6', 'lol-goals': 'w-6', 'lol-champion': 'w-12', 'lol-champselect': 'w-6', 'lol-review': 'w-6',
  timers: 'w-6', 'rok-planner': 'w-6', progress: 'w-6', 'game-research': 'w-12', wiki: 'w-6', notes: 'w-6', sources: 'w-6',
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
    for (const m of userMaps || []) if (!names.has(m.name)) names.set(m.name, m.name);
    if (!names.size) names.set('Hauptkarte', 'Hauptkarte');
    return [...names.entries()].map(([value, label]) => ({ value, label }));
  }, [eftMaps, userMaps]);
  const [map, setMap] = useState(params.map || (isEft ? 'customs' : 'Hauptkarte'));
  useEffect(() => { if (params.map) setMap(params.map); }, [params.map]);
  useEffect(() => { rpc('game.setLastMap', { game: game.id, map }).catch(() => {}); }, [game.id, map]);
  const [markers, reloadMarkers] = useRpc('game.markers', { game: game.id, map }, { events: ['game:markers'], initial: [], deps: [map] });
  const [routes] = useRpc('game.routes', { game: game.id, map }, { events: ['game:markers'], initial: [], deps: [map] });
  const [apiMap] = useRpc('tarkov.map', { map }, { enabled: isEft, deps: [map] });
  const meta = (userMaps || []).find((m) => m.name === map);
  const [tool, setTool] = useState('custom');
  const [visible, setVisible] = useState(Object.fromEntries(CATS.map((c) => [c.id, true])));
  const [showApi, setShowApi] = useState(true);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const [history, setHistory] = useState([]);
  const [routeDraft, setRouteDraft] = useState(null);
  const [calib, setCalib] = useState(null); // {step, points:[]}
  const [imgSize, setImgSize] = useState({ w: 1600, h: 1000 });
  const box = useRef(); const drag = useRef(null);
  const imgUrl = meta?.hasImage ? `app://jarvis/map-image/${encodeURIComponent(game.id)}/${encodeURIComponent(map)}` : null;
  useEffect(() => { setView({ z: 1, x: 0, y: 0 }); }, [map]);
  const fit = () => { const el = box.current; if (!el) return; const z = Math.min(el.clientWidth / imgSize.w, el.clientHeight / imgSize.h); setView({ z, x: (el.clientWidth - imgSize.w * z) / 2, y: (el.clientHeight - imgSize.h * z) / 2 }); };
  useEffect(() => { const t = setTimeout(fit, 50); return () => clearTimeout(t); }, [imgSize.w, imgSize.h, full, map]);
  const toNorm = (e) => { const r = box.current.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / (imgSize.w * view.z), y: (e.clientY - r.top - view.y) / (imgSize.h * view.z) }; };
  // Game (x,z) → normalized image coordinates via 2-point similarity transform
  const transform = useMemo(() => {
    const c = meta?.calibration?.points;
    if (!c || c.length !== 2) return null;
    const [a, b] = c;
    const gx = b.gx - a.gx, gz = b.gz - a.gz, ix = b.ix - a.ix, iy = b.iy - a.iy;
    const gl = Math.hypot(gx, gz), il = Math.hypot(ix * imgSize.w, iy * imgSize.h);
    if (!gl || !il) return null;
    const s = il / gl; const rot = Math.atan2(iy * imgSize.h, ix * imgSize.w) - Math.atan2(gz, gx);
    return (x, z) => { const dx = x - a.gx, dz = z - a.gz; const px = (dx * Math.cos(rot) - dz * Math.sin(rot)) * s, py = (dx * Math.sin(rot) + dz * Math.cos(rot)) * s; return { x: a.ix + px / imgSize.w, y: a.iy + py / imgSize.h }; };
  }, [meta?.calibration, imgSize]);
  const apiPins = isEft && showApi && transform && apiMap?.map ? [
    ...apiMap.map.extracts.filter((e) => e.position).map((e) => ({ ...transform(e.position.x, e.position.z), category: 'exit', label: e.name, api: true })),
    ...(apiMap.map.locks || []).filter((l) => l.position && l.key).slice(0, 80).map((l) => ({ ...transform(l.position.x, l.position.z), category: 'key', label: l.key.shortName || l.key.name, api: true })),
  ] : [];
  const click = async (e) => {
    if (drag.current?.moved) return;
    const p = toNorm(e);
    if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return;
    if (calib) {
      const ref = await ask(`Referenzpunkt ${calib.points.length + 1}: Spielkoordinaten „x, z“ dieses Punktes (z. B. aus tarkov.dev)`, '');
      if (!ref) return;
      const [gx, gz] = ref.split(/[,;\s]+/).map(Number);
      if (!Number.isFinite(gx) || !Number.isFinite(gz)) return toast('Bitte zwei Zahlen eingeben', 'error');
      const pts = [...calib.points, { ix: p.x, iy: p.y, gx, gz }];
      if (pts.length === 2) { await guard(() => rpc('game.calibrate', { game: game.id, map, points: pts }), 'Karte kalibriert – API-Punkte werden eingeblendet'); setCalib(null); reloadMaps(); } else setCalib({ points: pts });
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
    if (m.api) return toast(`${m.label} (Quelle: tarkov.dev)`);
    const label = await ask('Marker bearbeiten – Beschriftung (leer = löschen)', m.label || '');
    if (label === null) return;
    if (!label.trim()) { await rpc('game.removeMarker', { id: m.id }); return; }
    await rpc('game.updateMarker', { id: m.id, patch: { label } });
  };
  const all = [...markers.filter((m) => visible[m.category]), ...apiPins.filter((m) => visible[m.category])];
  const content = (
    <div class={full ? 'overlay' : ''} style={full ? { placeItems: 'stretch', padding: 30 } : undefined}>
      <Panel icon={MapIcon} title={game.name} sub={isEft ? 'Interaktive Karte · eigene Marker' : 'Interaktive Karte'} glow={full} style={full ? { height: '100%' } : undefined}
        right={<div class="row gap-s">
          <Select style={{ width: 170 }} value={map} onChange={setMap} options={options.map((o) => ({ value: o.value, label: 'Karte: ' + o.label }))} />
          <button class="btn sm" onClick={() => setFull(!full)}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{full ? 'Schließen' : 'Vollbild'}</button>
        </div>}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, height: full ? 'calc(100% - 10px)' : 380 }}>
          <div class="map-tools">
            <div class="hud-label" style={{ fontSize: 11 }}>Marker setzen</div>
            {CATS.map((c) => <div class={`tool ${tool === c.id && !routeDraft && !calib ? 'active' : ''}`} onClick={() => { setTool(c.id); setRouteDraft(null); setCalib(null); }} onContextMenu={(e) => { e.preventDefault(); setVisible({ ...visible, [c.id]: !visible[c.id] }); }} title="Rechtsklick: ein-/ausblenden" style={!visible[c.id] ? { opacity: 0.4 } : undefined}><span class={`pin ${c.cls}`} style={{ width: 18, height: 18, borderRadius: 4, display: 'grid', placeItems: 'center' }}><c.icon size={12} color="white" /></span>{c.label}</div>)}
            <div class="tool" onClick={async () => { const last = history.at(-1); if (!last) return toast('Nichts zum Rückgängigmachen'); await rpc('game.removeMarker', { id: last }); setHistory(history.slice(0, -1)); }}><Undo2 size={15} />Rückgängig</div>
            <div class="tool" onClick={async () => { if (await ask(`Alle eigenen Marker auf ${map} löschen?`, '', { confirmOnly: true, danger: true, okLabel: 'Löschen' })) rpc('game.clearMarkers', { game: game.id, map }); }}><Trash2 size={15} />Marker löschen</div>
            <div class={`tool ${routeDraft ? 'active' : ''}`} onClick={async () => { if (!routeDraft) { setRouteDraft([]); toast('Route: Punkte auf der Karte anklicken, dann erneut auf „Route“'); return; } if (routeDraft.length >= 2) { const n = await ask('Name der Route', 'Route ' + (routes.length + 1)); if (n) await guard(() => rpc('game.saveRoute', { game: game.id, map, name: n, points: routeDraft }), 'Route gespeichert'); } setRouteDraft(null); }}><Route size={15} />Route</div>
            <div class="tool" onClick={() => guard(() => rpc('game.importMap', { game: game.id, name: map }), 'Kartenbild importiert')}><ImagePlus size={15} />Kartenbild</div>
            {isEft && <div class={`tool ${calib ? 'active' : ''}`} title="Zwei Punkte mit bekannten Spielkoordinaten anklicken" onClick={() => setCalib(calib ? null : { points: [] })}><Ruler size={15} />Kalibrieren</div>}
            {isEft && transform && <div class={`tool ${showApi ? 'active' : ''}`} onClick={() => setShowApi(!showApi)}><Layers size={15} />API-Punkte</div>}
          </div>
          <div class={`map-box ${imgUrl ? '' : 'grid-fallback'}`} ref={box} onWheel={wheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onClick={click}>
            <div class="map-inner" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, width: imgSize.w, height: imgSize.h }}>
              {imgUrl ? <img src={imgUrl} onLoad={(e) => setImgSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} /> : <div style={{ width: imgSize.w, height: imgSize.h }} />}
              <svg width={imgSize.w} height={imgSize.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {[...routes, ...(routeDraft ? [{ id: 'draft', points: routeDraft }] : [])].map((r) => <polyline points={r.points.map((p) => `${p.x * imgSize.w},${p.y * imgSize.h}`).join(' ')} fill="none" stroke={r.id === 'draft' ? '#facc15' : '#22d3ee'} stroke-width={4 / view.z} stroke-dasharray={`${12 / view.z} ${8 / view.z}`} />)}
              </svg>
              {all.map((m) => { const c = CATS.find((x) => x.id === m.category) || CATS[5]; return (
                <div class="marker" style={{ left: m.x * imgSize.w, top: m.y * imgSize.h, transform: `translate(-50%, -100%) scale(${1 / view.z})`, transformOrigin: '50% 100%', opacity: m.api ? 0.85 : 1 }} onClick={(e) => { e.stopPropagation(); editMarker(m); }}>
                  <div class={`pin ${c.cls}`} style={m.api ? { borderStyle: 'dashed' } : undefined}><c.icon size={13} /></div>
                  {m.label && <div class="lbl">{m.label}</div>}
                </div>); })}
            </div>
            <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button class="btn icon xs" onClick={(e) => { e.stopPropagation(); zoom(1.25); }}><Plus size={14} /></button>
              <button class="btn icon xs" onClick={(e) => { e.stopPropagation(); zoom(0.8); }}><Minus size={14} /></button>
              <button class="btn icon xs" onClick={(e) => { e.stopPropagation(); fit(); }}><Crosshair size={14} /></button>
            </div>
            {!imgUrl && <div style={{ position: 'absolute', left: 12, bottom: 10, right: 12 }} class="notice">Kein Kartenbild hinterlegt. Importiere ein Kartenbild, das du verwenden darfst (z. B. eigener Screenshot) – Marker funktionieren auch auf dem Raster. {isEft ? 'Nach dem Kalibrieren blendet JARVIS Exits und verschlossene Türen aus tarkov.dev ein.' : ''}</div>}
            {calib && <div style={{ position: 'absolute', left: 12, top: 10 }} class="chip active">Kalibrierung: Punkt {calib.points.length + 1}/2 anklicken</div>}
          </div>
        </div>
      </Panel>
    </div>
  );
  return content;
}

// ---------------------------------------------------------------- Tarkov
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

function TarkovQuests({ params }) {
  const [q, setQ] = useState(params.query || '');
  useEffect(() => { if (params.query) setQ(params.query); }, [params.query]);
  const [r, , st] = useRpc('tarkov.quests', { map: params.map, q }, { deps: [q, params.map], debounce: 300 });
  const [doneList] = useRpc('game.doneQuests', {}, { events: ['game:progress'], initial: [] });
  const done = new Set(doneList || []);
  const norm = (x) => String(x).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const [hideDone, setHideDone] = useState(true);
  const [open, setOpen] = useState(null);
  return (
    <Panel title="Quest-Hinweise" sub={params.map ? `Karte: ${params.map}` : 'Alle Karten'}>
      <div class="row"><input class="inp grow" placeholder="Quest, Händler oder Ziel suchen…" value={q} onInput={(e) => setQ(e.currentTarget.value)} /><span class={`chip ${hideDone ? 'active' : ''}`} title="Erledigte Quests ausblenden" onClick={() => setHideDone(!hideDone)}>{done.size} erledigt {hideDone ? 'ausgeblendet' : 'sichtbar'}</span></div>
      {st.error && <div class="notice warn mt">{st.error}</div>}
      <div class="col mt" style={{ gap: 6, maxHeight: 250, overflow: 'auto' }}>
        {(r?.items || []).filter((t) => !hideDone || !done.has(norm(t.name))).map((t) => (
          <div class="result-row" style={{ flexDirection: 'column', alignItems: 'stretch', opacity: done.has(norm(t.name)) ? 0.55 : 1 }} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <div class="row"><Checkbox checked={done.has(norm(t.name))} title="Als erledigt markieren" onChange={(v) => rpc('game.questDone', { name: t.name, done: v })} /><b class="grow ellipsis small" style={done.has(norm(t.name)) ? { textDecoration: 'line-through' } : undefined}>{t.name}</b><span class="tiny muted">{t.trader?.name}{t.minPlayerLevel ? ` · Lvl ${t.minPlayerLevel}` : ''}{t.kappaRequired ? ' · Kappa' : ''}</span></div>
            {open === t.id && <>{t.objectives.map((o) => <div class="tiny" style={{ color: 'var(--text-2)', paddingLeft: 22 }}>• {o.description}{o.optional ? ' (optional)' : ''}</div>)}{t.wikiLink && <a class="tiny" style={{ paddingLeft: 22 }} onClick={(e) => { e.stopPropagation(); rpc('shell.openExternal', { url: t.wikiLink }); }}>Wiki</a>}</>}
          </div>
        ))}
        {r && !r.items.length && <Empty>Keine Quests gefunden.</Empty>}
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
  return (
    <Panel title={name} right={<button class="btn xs ghost" onClick={() => save((cl?.items || []).map((i) => ({ ...i, done: false })))}>Zurücksetzen</button>}>
      {(cl?.items || []).map((i) => <div class={`sub-row ${i.done ? 'done' : ''}`}><Checkbox checked={i.done} onChange={(v) => save(cl.items.map((x) => (x.id === i.id ? { ...x, done: v } : x)))} /><span class="grow">{i.text}</span><X size={13} style={{ cursor: 'pointer', color: 'var(--text-3)' }} onClick={() => save(cl.items.filter((x) => x.id !== i.id))} /></div>)}
      <div class="add-row mt"><Plus size={14} /><input placeholder="Punkt hinzufügen" value={txt} onInput={(e) => setTxt(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && txt.trim()) { save([...(cl?.items || []), { text: txt.trim(), done: false }]); setTxt(''); } }} /></div>
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
  const [f, setF] = useState({ label: '', kind: kinds[0], h: 1, m: 0 });
  useNow(1000);
  const add = async () => {
    if (!f.label.trim()) return;
    const minutes = Number(f.h) * 60 + Number(f.m);
    if (await guard(() => rpc('game.addTimer', { game: game.name, label: f.label.trim(), kind: f.kind, minutes }), 'Timer gestartet')) setF({ ...f, label: '' });
  };
  return (
    <Panel icon={Timer} title={game.id === 'rok' ? 'Bau- & Forschungs-Timer' : 'Timer'} sub="Eigene Zeitabschätzungen – kein verifizierter Spielstatus">
      <div class="col" style={{ gap: 6, maxHeight: 220, overflow: 'auto' }}>
        {!list.length && <Empty>Kein Timer aktiv. Sag z. B. „Jarvis, mein Rathaus braucht noch fünf Stunden.“</Empty>}
        {list.map((t) => { const [l, I] = TIMER_KINDS[t.kind] || TIMER_KINDS.custom; const done = new Date(t.endsAt) <= new Date(); return (
          <div class={`timer-row ${done ? 'fired' : ''}`}>
            <I size={18} style={{ color: 'var(--cyan)' }} />
            <div class="grow"><div class="small" style={{ fontWeight: 600 }}>{t.label}</div><div class="tiny muted">{l} · endet {fmtDateTime(t.endsAt)}</div></div>
            <div class="left">{done ? 'fertig*' : countdown(t.endsAt)}</div>
            <button class="btn icon xs ghost" onClick={() => rpc('game.removeTimer', { id: t.id })}><X size={13} /></button>
          </div>); })}
      </div>
      <div class="row mt gap-s">
        <input class="inp grow" placeholder="z. B. Rathaus Stufe 22" value={f.label} onInput={(e) => setF({ ...f, label: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Select style={{ width: 120 }} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={kinds.map((k) => ({ value: k, label: TIMER_KINDS[k]?.[0] || k }))} />
        <input class="inp" type="number" min="0" style={{ width: 60 }} value={f.h} onInput={(e) => setF({ ...f, h: e.currentTarget.value })} title="Stunden" /><span class="tiny muted">h</span>
        <input class="inp" type="number" min="0" max="59" style={{ width: 60 }} value={f.m} onInput={(e) => setF({ ...f, m: e.currentTarget.value })} title="Minuten" /><span class="tiny muted">m</span>
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
function useLol() {
  const [src] = useRpc('lol.source', {}, { events: ['settings:changed', 'game:data', 'game:running'] });
  const hasKey = !!(src?.client || src?.key);
  const [stats, reload, st] = useRpc('lol.stats', {}, { events: ['game:data'] });
  const [v] = useRpc('lol.version', {}, {});
  return { hasKey, stats, reload, st, v, src };
}
const icon = (v, c) => (v ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${String(c).replace(/[^A-Za-z]/g, '')}.png` : '');
function Delta({ d }) { if (d == null) return <span class="d muted">–</span>; return <span class={`d ${d >= 0 ? 'up' : 'down'}`}>{d >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {d >= 0 ? '+' : ''}{d}% vs. vorher</span>; }

function LolOverview() {
  const { hasKey, stats, st, src } = useLol();
  const [busy, setBusy] = useState(false);
  const sync = async () => { setBusy(true); const r = await guard(() => rpc('lol.sync')); setBusy(false); if (r) toast(`${r.added} neue Matches geladen`); };
  const c = stats?.current;
  return (
    <section class="panel glow" style={{ padding: 14 }}>
      <div class="row">
        <Trophy size={34} style={{ color: '#c8aa6e' }} />
        <div class="grow"><div style={{ fontSize: 20, fontWeight: 700 }}>League of Legends</div><div class="small muted">Performance analysieren. Besser werden. Mit JARVIS.</div></div>
        {src?.me && <span class="small muted">{src.me.name}</span>}
        <span class="pill"><span class={`status-dot ${src?.client ? 'dot-ok' : 'dot-off'}`} />{src?.client ? 'Client verbunden' : 'Client nicht offen'}</span>
        <button class="btn sm" disabled={!hasKey} title={hasKey ? '' : 'League-Client starten'} onClick={sync}>{busy ? <Spinner /> : <RefreshCw size={14} />}Matches laden</button>
      </div>
      {st.error && <div class="notice warn mt">{st.error}</div>}
      {!c ? <div class="notice mt">Noch keine Ranglisten-Matches gespeichert. {src?.client ? 'Klicke „Matches laden“.' : 'Starte einfach den League-Client – JARVIS liest deine letzten Ranglistenspiele und deinen Rang direkt daraus (kein API-Schlüssel nötig) und aktualisiert alle 10 Minuten, solange der Client offen ist.'}</div> : (
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
        <button class="btn sm" onClick={() => setState({ page: 'chat', chatDraft: 'Analysiere meine LoL-Statistik (league_stats) und erstelle mir einen Trainingsplan mit 3 messbaren Zielen.' })}><Sparkles size={14} />Ausführliche Analyse mit JARVIS</button>
      </div>
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
        <div class="col mt" style={{ gap: 4 }}>{(live.tips || []).map((t) => <div class="small"><Sparkles size={12} style={{ color: 'var(--cyan)' }} /> {t}</div>)}{!live.tips?.length && <div class="small muted">Keine Hinweise – läuft gut.</div>}</div>
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

function LolChampSelect() {
  const [cs, setCs] = useState(null);
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
      </>}
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
  ark: [['creature', 'Zähmungen', 'Rex', 'Level 220'], ['base', 'Basis', 'Hauptbasis', 'Red Obelisk'], ['item', 'Items', 'Tek-Rüstung', ''], ['achievement', 'Bosse', 'Broodmother', 'besiegt']],
  ark_asa: [['creature', 'Zähmungen', 'Rex', 'Level 220'], ['base', 'Basis', 'Hauptbasis', ''], ['item', 'Items', '', ''], ['achievement', 'Bosse', '', 'besiegt']],
  league: [['hero', 'Champions', 'Kai\'Sa', 'Main'], ['achievement', 'Erfolge', 'Gold erreicht', '']],
};
const DEFAULT_CATS = [['quest', 'Quests & Aufgaben', 'Hauptquest Akt 2', ''], ['achievement', 'Erfolge & Bosse', '', 'geschafft'], ['item', 'Items & Ausrüstung', '', ''], ['skill', 'Fähigkeiten & Level', '', ''], ['other', 'Sonstiges', '', '']];

function Progress({ game, params }) {
  const [data, reload] = useRpc('game.progress', { game: game.id }, { events: ['game:progress'] });
  const [cat, setCat] = useState(params.category || '');
  const gameCats = PROGRESS_CATS[game.id] || DEFAULT_CATS;
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

export const WIDGETS = {
  map: MapWidget, 'tarkov-raid': TarkovRaid, 'tarkov-quests': TarkovQuests, 'tarkov-item': TarkovItem, checklist: Checklist, 'other-games': OtherGames,
  timers: Timers, notes: Notes, sources: Sources, 'game-research': GameResearch, wiki: Wiki,
  'lol-overview': LolOverview, 'lol-champions': LolChampions, 'lol-matches': LolMatches, 'lol-coaching': LolCoaching, 'lol-live': LolLive, 'lol-goals': LolGoals, 'lol-champion': LolChampion,
  'lol-champselect': LolChampSelect, 'lol-review': LolReview,
  'rok-planner': RokPlanner, progress: Progress,
};
