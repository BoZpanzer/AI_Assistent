import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { Orbit, Search, X, FileText, Link as LinkIcon, FolderOpen, BookOpen, Star, Pin, Archive, Trash2, Pencil, CalendarDays, Tag, Network, Globe, CalendarPlus, Upload, Maximize2, TriangleAlert, Clock, ChevronRight, Lightbulb, User, Cpu, Gamepad2, Brain as BrainIcon, Sparkles } from 'lucide-preact';
import { rpc, useRpc } from '../lib/api.js';
import { useStore, setState, guard, toast } from '../lib/store.js';
import { ChatBar } from '../components/Shell.jsx';
import { Modal, Field, Select, Empty, ask, Spinner } from '../components/ui.jsx';
import { ago, fmtDateTime } from '../lib/format.js';

const DOMAIN_ICON = { projects: FolderOpen, study: BookOpen, knowledge: BookOpen, memories: FileText, ideas: Lightbulb, sources: Globe, personal: User, technology: Cpu, gaming: Gamepad2 };
const DOMAIN_OPTS = [['personal', 'Persönliches'], ['projects', 'Projekte'], ['study', 'Studium'], ['knowledge', 'Wissen'], ['memories', 'Erinnerungen'], ['ideas', 'Ideen'], ['sources', 'Quellen'], ['technology', 'Technologie'], ['gaming', 'Gaming']];
const KIND_OPTS = [['memory', 'Erinnerung'], ['preference', 'Vorliebe'], ['fact', 'Fakt'], ['idea', 'Idee'], ['experience', 'Erfahrung'], ['project', 'Projekt'], ['note', 'Notiz'], ['source', 'Quelle']];

export function Brain() {
  const [tab, setTab] = useState('graph');
  const [graph] = useRpc('brain.graph', {}, { events: ['brain:changed', 'study:changed'] });
  const focus = useStore((s) => s.focusKnowledge);
  const [sel, setSel] = useState(null);
  const [domain, setDomain] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [results, setResults] = useState(null);
  const [editor, setEditor] = useState(null);
  const [full, setFull] = useState(false);
  useEffect(() => { if (focus) { setSel(focus); setState({ focusKnowledge: null }); } }, [focus]);
  const runSearch = async (text = q) => {
    if (!text.trim()) { setResults(null); return; }
    const r = await guard(() => rpc('brain.search', { q: text, scope: 'all' }));
    setResults(r?.results || []);
  };
  useEffect(() => { const t = setTimeout(() => runSearch(), 300); return () => clearTimeout(t); }, [q]);
  const [list] = useRpc('brain.list', { domain: domain || undefined, limit: 120 }, { events: ['brain:changed'], initial: [], deps: [domain] });
  const filtered = (results || list.map((k) => ({ type: 'knowledge', id: k.id, title: k.title, snippet: k.content, domain: k.domain, domainLabel: k.domainLabel, sourceType: k.sourceType, updatedAt: k.updatedAt, kind: k.kind })))
    .filter((r) => filter === 'all' || (filter === 'memories' && r.type === 'knowledge' && ['memory', 'experience', 'preference'].includes(r.kind || 'memory')) || (filter === 'sources' && (r.type === 'document' || r.sourceType === 'web' || r.domain === 'sources')) || (filter === 'projects' && r.domain === 'projects') || (filter === 'knowledge' && ['knowledge', 'study', 'technology'].includes(r.domain)));
  const ov = graph?.overview;
  const counts = { all: filtered.length };
  return (
    <div class="page">
      <div class="page-body content">
        <div class="page-body">
          <section class="panel glow" style={{ flex: full ? 1 : '1.25 1 0', minHeight: 260, display: 'flex', flexDirection: 'column' }}>
            <div class="row" style={{ padding: '12px 16px 6px' }}>
              <Orbit size={30} style={{ color: 'var(--cyan)' }} />
              <div class="grow"><div class="hud-title">Wissensgraph</div><div class="small muted">Deine Erkenntnisse, verknüpft und im Kontext.</div></div>
              <div class="tabs sm">{[['graph', 'Graph'], ['list', 'Liste'], ['cluster', 'Cluster']].map(([k, l]) => <button class={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
              <button class="btn icon sm ghost" title="Vergrößern" onClick={() => setFull(!full)}><Maximize2 size={16} /></button>
            </div>
            {tab === 'graph' && <Graph data={graph} onDomain={(d) => { setDomain(d === domain ? null : d); setResults(null); setQ(''); }} onEntry={setSel} activeDomain={domain} />}
            {tab === 'list' && <ListView domain={domain} setDomain={setDomain} onSel={setSel} sel={sel} />}
            {tab === 'cluster' && <Clusters onDomain={(d) => { setDomain(d); setTab('list'); }} onTag={(t) => setQ(t)} />}
          </section>
          {!full && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: '1 1 0', minHeight: 0 }}>
              <section class="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div class="row" style={{ padding: '12px 14px 6px' }}><Search size={18} style={{ color: 'var(--cyan)' }} /><span class="hud-title" style={{ fontSize: 14 }}>Suche im Wissen</span>{domain && <span class="chip active" onClick={() => setDomain(null)}>{DOMAIN_OPTS.find((d) => d[0] === domain)?.[1]} <X size={11} /></span>}</div>
                <div style={{ padding: '0 14px' }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-3)' }} />
                    <input class="inp" style={{ paddingLeft: 32, height: 34 }} placeholder="z. B. KI Automatisierung" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
                    {q && <X size={15} style={{ position: 'absolute', right: 10, top: 9, cursor: 'pointer' }} onClick={() => setQ('')} />}
                  </div>
                  <div class="row wrap gap-s mt">
                    {[['all', 'Alle'], ['memories', 'Erinnerungen'], ['sources', 'Quellen'], ['projects', 'Projekte'], ['knowledge', 'Wissen']].map(([k, l]) => <span class={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}{k === 'all' ? ` (${counts.all})` : ''}</span>)}
                  </div>
                </div>
                <div class="col scroll" style={{ padding: 10, gap: 6, flex: 1 }}>
                  {!filtered.length && <Empty>{q ? 'Nichts gefunden.' : 'Noch keine Einträge – sag JARVIS „Merk dir …“ oder lege eine Erinnerung an.'}</Empty>}
                  {filtered.slice(0, 60).map((r) => {
                    const Icon = r.type === 'document' ? FileText : DOMAIN_ICON[r.domain] || FileText;
                    return (
                      <div class={`result-row ${sel === r.id ? 'sel' : ''}`} onClick={() => (r.type === 'document' ? setState({ page: 'study', focusDoc: r.docId }) : setSel(r.id))}>
                        <Icon size={18} />
                        <div class="grow"><div class="ellipsis" style={{ fontSize: 13.5 }}>{r.title}</div><div class="tiny muted ellipsis">{r.type === 'document' ? `Dokument · ${r.citation}` : `${r.domainLabel || ''} · ${ago(r.updatedAt)}`}{r.stale ? ' · möglicherweise veraltet' : ''}</div></div>
                        <ChevronRight size={16} />
                      </div>
                    );
                  })}
                </div>
              </section>
              <Detail id={sel} onEdit={(k) => setEditor(k)} onDeleted={() => setSel(null)} />
            </div>
          )}
        </div>
        <BrainRight ov={ov} onDomain={(d) => { setDomain(d); setTab('list'); }} onSel={setSel} />
      </div>
      <ChatBar actions={[
        { icon: Globe, label: 'Recherche', onClick: () => setState({ page: 'chat', chatDraft: 'Recherchiere und speichere die wichtigsten Erkenntnisse im Brain: ' }) },
        { icon: CalendarPlus, label: 'Neue Erinnerung', onClick: () => setEditor({}) },
        { icon: Upload, label: 'Quelle hinzufügen', onClick: async () => { const url = await ask('Webseite dauerhaft speichern (https://…)', ''); if (url) guard(() => rpc('brain.addSource', { url }), 'Quelle gespeichert (versioniert, wöchentlich aktualisiert)'); } },
      ]} />
      {editor && <EntryEditor initial={editor} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); setSel(id); }} />}
    </div>
  );
}

/** Kürzt eine Beschriftung auf die verfügbare Breite (≈ 6,6 px pro Zeichen bei 12 px). */
const fitLabel = (s, px) => { const n = Math.floor(px / 6.6); if (n < 4) return ''; return s.length > n ? s.slice(0, Math.max(3, n - 1)) + '…' : s; };

/** Radial graph: JARVIS core → domain hubs → recent entries. Real data only. */
function Graph({ data, onDomain, onEntry, activeDomain }) {
  const wrap = useRef(); const [size, setSize] = useState({ w: 900, h: 420 });
  useEffect(() => { const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(wrap.current); return () => ro.disconnect(); }, []);
  const layout = useMemo(() => {
    if (!data) return null;
    const { w, h } = size; const cx = w / 2, cy = h / 2;
    const domains = data.nodes.filter((n) => n.type === 'domain');
    const pos = { core: { x: cx, y: cy } };
    // Knoten (r) + Beschriftung darunter müssen komplett in die Fläche passen
    const nr = Math.max(22, Math.min(30, h / 13));
    const coreR = Math.max(34, Math.min(64, h * 0.15));
    const rx = Math.max(coreR + nr + 40, Math.min(w / 2 - nr - 150, 380)); // seitlich Platz für Einträge + Beschriftung
    const ry = Math.max(coreR + nr + 6, Math.min(h / 2 - nr - 26, 190));
    domains.forEach((d, i) => { const a = -Math.PI / 2 + (i / domains.length) * Math.PI * 2; pos[d.id] = { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, a }; });
    const leaves = data.nodes.filter((n) => n.type === 'entry' || n.type === 'document');
    const byHub = {};
    for (const e of data.edges) if (pos[e.a] && e.a.startsWith('d:')) (byHub[e.a] = byHub[e.a] || []).push(e.b);
    for (const [hub, ids] of Object.entries(byHub)) {
      const p = pos[hub]; const n = ids.length;
      if (Math.abs(Math.sin(p.a)) > 0.8) {
        // Knoten oben/unten: Einträge links und rechts daneben, damit nichts über die Beschriftung läuft
        ids.forEach((id, i) => { const side = i % 2 ? 1 : -1; const row = Math.floor(i / 2); pos[id] = { side, x: p.x + side * (nr + 34 + row * 10), y: Math.max(10, Math.min(h - 10, p.y + (Math.sin(p.a) > 0 ? -1 : 1) * (row * 17 - nr * 0.4))) }; });
        continue;
      }
      ids.forEach((id, i) => {
        const spread = 1.1; const a = p.a + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
        const dist = 78 + (i % 2) * 22;
        const x = p.x + Math.cos(a) * dist * 1.25, y = p.y + Math.sin(a) * dist * 0.75;
        pos[id] = { side: Math.cos(a) >= 0 ? 1 : -1, x: Math.max(12, Math.min(w - 12, x)), y: Math.max(10, Math.min(h - 10, y)) };
      });
    }
    // Platz für jede Beschriftung: bis zum nächsten Knoten/Punkt in Leserichtung, höchstens 170 px
    const obstacles = [{ x: cx, y: cy, r: coreR * 1.2 }, ...domains.map((d) => ({ ...pos[d.id], r: nr + 4 })), ...leaves.filter((n) => pos[n.id]).map((n) => ({ ...pos[n.id], r: 6, id: n.id }))];
    for (const n of leaves) {
      const p = pos[n.id]; if (!p) continue;
      let room = Math.min(170, p.side > 0 ? w - p.x - 6 : p.x - 6);
      for (const o of obstacles) {
        if (o.id === n.id || Math.abs(o.y - p.y) > o.r + 8) continue;
        const dx = (o.x - p.x) * p.side;
        if (dx > 0) room = Math.min(room, dx - o.r - 6);
      }
      p.room = room;
    }
    return { pos, domains, leaves, cx, cy, nr, coreR };
  }, [data, size]);
  return (
    <div class="graph-wrap" ref={wrap}>
      {layout && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`}>
          <defs>
            <radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#e0fbff" /><stop offset="35%" stop-color="#22d3ee" stop-opacity="0.9" /><stop offset="70%" stop-color="#0e7490" stop-opacity="0.35" /><stop offset="100%" stop-color="#22d3ee" stop-opacity="0" /></radialGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {data.edges.map((e) => { const a = layout.pos[e.a], b = layout.pos[e.b]; if (!a || !b) return null; return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.cross ? 'rgba(167,139,250,0.55)' : 'rgba(56,189,248,0.35)'} stroke-width={e.cross ? 1.4 : 1} stroke-dasharray={e.cross ? '4 3' : undefined} />; })}
          <g class="gnode" onClick={() => onDomain(null)}>
            <circle cx={layout.cx} cy={layout.cy} r={layout.coreR * 1.2} fill="url(#core)" filter="url(#glow)" />
            <circle cx={layout.cx} cy={layout.cy} r={layout.coreR} fill="none" stroke="rgba(56,225,255,0.6)" stroke-width="1.5" />
            <circle cx={layout.cx} cy={layout.cy} r={layout.coreR * 1.4} fill="none" stroke="rgba(56,225,255,0.25)" stroke-dasharray="2 6" />
            <text x={layout.cx} y={layout.cy + 6} text-anchor="middle" style={{ fill: 'white', fontFamily: 'var(--font-hud)', fontWeight: 700, fontSize: Math.round(layout.coreR / 3.6), letterSpacing: 2 }}>JARVIS</text>
          </g>
          {layout.leaves.map((n) => { const p = layout.pos[n.id]; if (!p) return null; return (
            <g class="gnode" onClick={() => (n.type === 'document' ? setState({ page: 'study', focusDoc: n.id.slice(4) }) : onEntry(n.id))}>
              <title>{n.label}</title>
              <circle cx={p.x} cy={p.y} r={5} fill="#22d3ee" filter="url(#glow)" />
              <text x={p.x + p.side * 9} y={p.y + 4} text-anchor={p.side > 0 ? 'start' : 'end'}>{fitLabel(n.label, p.room - 10)}</text>
            </g>); })}
          {layout.domains.map((d) => { const p = layout.pos[d.id]; const Icon = DOMAIN_ICON[d.domain]; const active = activeDomain === d.domain; const r = layout.nr; const ic = Math.round(r * 0.8); const bx = p.x + r * 0.72, by = p.y - r * 0.72; return (
            <g class={`gnode domain ${d.count ? '' : 'empty'}`} onClick={() => onDomain(d.domain)}>
              <title>{`${d.label}: ${d.count} Einträge`}</title>
              <circle cx={p.x} cy={p.y} r={r} fill="rgba(6,24,42,0.95)" stroke={active ? '#fff' : d.count ? 'rgba(56,225,255,0.85)' : 'rgba(56,225,255,0.4)'} stroke-width={active ? 2.5 : 1.6} filter="url(#glow)" />
              <foreignObject x={p.x - ic / 2} y={p.y - ic / 2} width={ic} height={ic}><div style={{ color: d.count ? '#7dd3fc' : '#4b6b85', lineHeight: 0 }}><Icon size={ic} /></div></foreignObject>
              <text class="glabel" x={p.x} y={p.y + r + 16} text-anchor="middle">{d.label}</text>
              {d.count > 0 && <><circle cx={bx} cy={by} r={9} fill="#0891b2" stroke="rgba(6,24,42,0.95)" stroke-width="2" /><text class="gcount" x={bx} y={by + 3.5} text-anchor="middle">{d.count > 99 ? '99+' : d.count}</text></>}
            </g>); })}
        </svg>
      )}
      {data && data.overview.memories === 0 && data.overview.sources === 0 && <div class="graph-hint">Der Graph füllt sich mit echten Einträgen – Erinnerungen, Quellen und Dokumenten.</div>}
    </div>
  );
}

function ListView({ domain, setDomain, onSel, sel }) {
  const [archived, setArchived] = useState(false);
  const [list] = useRpc('brain.list', { domain: domain || undefined, archived, limit: 300 }, { events: ['brain:changed'], initial: [], deps: [domain, archived] });
  return (
    <div class="col" style={{ flex: 1, minHeight: 0, padding: '6px 14px 12px' }}>
      <div class="row wrap gap-s">
        <span class={`chip ${!domain ? 'active' : ''}`} onClick={() => setDomain(null)}>Alle</span>
        {DOMAIN_OPTS.map(([k, l]) => <span class={`chip ${domain === k ? 'active' : ''}`} onClick={() => setDomain(k)}>{l}</span>)}
        <span class="grow" /><span class={`chip ${archived ? 'active' : ''}`} onClick={() => setArchived(!archived)}><Archive size={12} />Archiv</span>
      </div>
      <div class="col scroll" style={{ gap: 6, flex: 1 }}>
        {!list.length && <Empty>Keine Einträge.</Empty>}
        {list.map((k) => (
          <div class={`result-row ${sel === k.id ? 'sel' : ''}`} onClick={() => onSel(k.id)}>
            {k.pinned ? <Pin size={16} /> : <FileText size={16} />}
            <div class="grow"><div class="ellipsis">{k.title}</div><div class="tiny muted ellipsis">{k.domainLabel} · {SRC[k.sourceType] || k.sourceType} · Konfidenz {Math.round(k.confidence * 100)}% · {ago(k.updatedAt)}{k.stale ? ' · veraltet' : ''}{k.conflictWith ? ' · Widerspruch' : ''}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
const SRC = { user: 'manuell', chat: 'aus Gespräch', web: 'Web', document: 'Dokument', import: 'Import', game: 'Spiel' };

function Clusters({ onDomain, onTag }) {
  const [c] = useRpc('brain.clusters', {}, { events: ['brain:changed'] });
  const max = Math.max(1, ...((c?.domains || []).map((d) => d.count)));
  return (
    <div class="col scroll" style={{ padding: '6px 16px 14px', flex: 1 }}>
      {(c?.domains || []).map((d) => (
        <div class="row" style={{ cursor: 'pointer' }} onClick={() => onDomain(d.domain)}>
          <span style={{ width: 110 }} class="small">{d.label}</span>
          <div class="bar grow"><i style={{ width: `${(d.count / max) * 100}%` }} /></div>
          <span class="small muted" style={{ width: 40, textAlign: 'right' }}>{d.count}</span>
        </div>
      ))}
      <div class="hud-label mt">Themen-Cluster (Tags)</div>
      <div class="row wrap gap-s">{(c?.tags || []).map((t) => <span class="chip" style={{ fontSize: 11 + Math.min(6, t.count) }} onClick={() => onTag(t.tag)}>{t.tag} · {t.count}</span>)}{!c?.tags?.length && <span class="small muted">Noch keine Tags.</span>}</div>
    </div>
  );
}

function Detail({ id, onEdit, onDeleted }) {
  const [k] = useRpc('brain.get', { id }, { events: ['brain:changed'], enabled: !!id, deps: [id] });
  if (!id || !k) return <section class="panel center"><Empty>Eintrag auswählen.</Empty></section>;
  return (
    <section class="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div class="row" style={{ padding: '12px 14px 6px' }}>
        <FileText size={20} style={{ color: 'var(--cyan)' }} />
        <div class="grow"><div class="hud-title" style={{ fontSize: 14 }}>{KIND_OPTS.find((x) => x[0] === k.kind)?.[1] || 'Eintrag'}</div><div class="tiny muted">Detailansicht</div></div>
        <button class="btn icon xs ghost" title="Anheften" onClick={() => rpc('brain.update', { id: k.id, patch: { pinned: !k.pinned } })}><Pin size={14} style={{ color: k.pinned ? 'var(--cyan)' : undefined }} /></button>
        <button class="btn icon xs ghost" title="Bearbeiten" onClick={() => onEdit(k)}><Pencil size={14} /></button>
        <button class="btn icon xs ghost" title={k.archived ? 'Wiederherstellen' : 'Archivieren'} onClick={() => guard(() => rpc('brain.archive', { id: k.id, archived: !k.archived }), k.archived ? 'Wiederhergestellt' : 'Archiviert')}><Archive size={14} /></button>
        <button class="btn icon xs danger" title="Löschen" onClick={async () => { if (await ask('Eintrag endgültig löschen?', '', { confirmOnly: true, danger: true, okLabel: 'Löschen' })) { await guard(() => rpc('brain.remove', { id: k.id }), 'Gelöscht'); onDeleted(); } }}><Trash2 size={14} /></button>
      </div>
      <div class="col scroll" style={{ padding: '4px 14px 14px', gap: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{k.title}</div>
        <div class="row wrap small muted"><CalendarDays size={14} />{fmtDateTime(k.updatedAt)} Uhr <Tag size={14} />{[k.domainLabel, ...k.tags].join(', ')}</div>
        {k.stale && <div class="notice warn"><Clock size={13} /> Gültig bis {new Date(k.validUntil).toLocaleDateString('de-DE')} – möglicherweise veraltet.</div>}
        {k.conflictWith && <div class="notice warn"><TriangleAlert size={13} /> Widerspricht einem anderen Eintrag. Bitte prüfen und korrigieren.</div>}
        <div class="selectable" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, color: 'var(--text)' }}>{k.content}</div>
        <div class="tiny muted">Quelle: {SRC[k.sourceType] || k.sourceType}{k.sourceUrl ? <> · <a onClick={() => rpc('shell.openExternal', { url: k.sourceUrl })}>{k.sourceUrl.slice(0, 60)}</a></> : ''} · Konfidenz {Math.round(k.confidence * 100)}%{k.game ? ' · Spiel: ' + k.game : ''}</div>
        <div class="row"><Star size={14} style={{ color: 'var(--cyan)' }} /><span class="hud-label">Verknüpfungen</span><span class="grow" />
          <button class="btn xs ghost" onClick={async () => { const t = await ask('Mit welchem Eintrag verknüpfen? (Suchbegriff)', ''); if (!t) return; const r = await rpc('brain.search', { q: t, scope: 'knowledge' }); const hit = r.results.find((x) => x.id !== k.id); if (!hit) return toast('Kein passender Eintrag'); await rpc('brain.link', { a: k.id, b: hit.id }); toast('Verknüpft mit „' + hit.title + '“'); }}>+ Verknüpfen</button></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {k.links.map((l) => <div class="chip" style={{ height: 32 }}><LinkIcon size={12} /><span class="ellipsis">{l.title}</span></div>)}
          {!k.links.length && <span class="small muted">Keine</span>}
        </div>
        {k.revisions?.length > 0 && <details class="small muted"><summary style={{ cursor: 'pointer' }}>Änderungsverlauf ({k.revisions.length})</summary>{k.revisions.map((r) => <div class="mt">{new Date(r.at).toLocaleString('de-DE')} · {r.reason}<div style={{ whiteSpace: 'pre-wrap' }}>{r.content.slice(0, 300)}</div></div>)}</details>}
      </div>
    </section>
  );
}

function BrainRight({ ov, onDomain, onSel }) {
  const [projects] = useRpc('brain.list', { domain: 'projects', limit: 5 }, { events: ['brain:changed'], initial: [] });
  const [conflicts] = useRpc('brain.conflicts', {}, { events: ['brain:changed'], initial: [] });
  const [embedding, setEmbedding] = useState(false);
  const Box = ({ icon: Icon, title, sub, children }) => (
    <div class="panel rcard" style={{ cursor: 'default' }}>
      <div class="rcard-head"><div class="ico"><Icon size={22} /></div><div><div class="t">{title}</div><div class="s">{sub}</div></div></div>
      {children}
    </div>
  );
  return (
    <aside class="rightcol panel">
      <Box icon={FileText} title="ÜBERSICHT" sub="Dein Wissensstand">
        <div class="kv">
          {[[ov?.memories, 'Erinnerungen'], [ov?.sources, 'Quellen'], [ov?.links, 'Verknüpfungen'], [ov?.projects, 'Projekte']].map(([n, l]) => <><span class="hud-title" style={{ fontSize: 16, color: 'white' }}>{n ?? '–'}</span><span class="n">{l}</span><span /></>)}
        </div>
        <div class="tiny muted mt">{ov?.embedded || 0} Einträge semantisch indexiert</div>
        <button class="btn xs mt" onClick={async () => { setEmbedding(true); await guard(() => rpc('brain.embed'), 'Semantischer Index aktualisiert'); setEmbedding(false); }}>{embedding ? <Spinner size={12} /> : <Sparkles size={12} />}Index aktualisieren</button>
      </Box>
      <Box icon={CalendarDays} title="KATEGORIEN" sub="Wissen strukturieren">
        <ul class="bullets">{DOMAIN_OPTS.map(([k, l]) => <li style={{ cursor: 'pointer' }} onClick={() => onDomain(k)}><span class="grow">{l}</span><span class="v">{ov?.byDomain?.[k] ?? 0}</span></li>)}</ul>
      </Box>
      <Box icon={Network} title="AKTUELLE PROJEKTE" sub="Wissenssammlungen">
        <ul class="bullets">{projects.length ? projects.map((p) => <li style={{ cursor: 'pointer' }} onClick={() => onSel(p.id)}><span class="grow ellipsis">{p.title}</span></li>) : <li class="empty">Noch keine Projekte</li>}</ul>
      </Box>
      <Box icon={Network} title="PFLEGE" sub="Qualität des Wissens">
        <ul class="bullets">
          <li class={conflicts.length ? 'warn' : ''}><span class="grow">Widersprüche</span><span class="v">{conflicts.length}</span></li>
          <li class={ov?.stale ? 'warn' : ''}><span class="grow">Veraltete Einträge</span><span class="v">{ov?.stale ?? 0}</span></li>
        </ul>
        {conflicts.slice(0, 3).map((c) => <div class="tiny muted mt" style={{ cursor: 'pointer' }} onClick={() => onSel(c.id)}>⚠ {c.title}</div>)}
        <button class="btn xs mt" onClick={() => guard(async () => { const r = await rpc('brain.maintain'); toast(`${r.merged} zusammengeführt, ${r.archived} archiviert`); })}>Jetzt aufräumen</button>
      </Box>
    </aside>
  );
}

function EntryEditor({ initial, onClose, onSaved }) {
  const [f, setF] = useState({ title: initial.title || '', content: initial.content || '', domain: initial.domain || 'personal', kind: initial.kind || 'memory', tags: (initial.tags || []).join(', '), validUntil: initial.validUntil ? initial.validUntil.slice(0, 10) : '' });
  const save = async () => {
    const body = { title: f.title || undefined, content: f.content, domain: f.domain, kind: f.kind, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), validUntil: f.validUntil ? new Date(f.validUntil + 'T23:59:59').toISOString() : null };
    const r = await guard(() => (initial.id ? rpc('brain.update', { id: initial.id, patch: body }) : rpc('brain.add', { ...body, sourceType: 'user' })));
    if (r) { toast(initial.id ? 'Gespeichert' : r.action === 'duplicate' ? 'Bereits vorhanden' : 'Gemerkt'); onSaved(initial.id || r.entry?.id); }
  };
  return (
    <Modal title={initial.id ? 'Eintrag korrigieren' : 'Neue Erinnerung'} onClose={onClose} actions={<><button class="btn sm ghost" onClick={onClose}>Abbrechen</button><button class="btn sm primary" disabled={!f.content.trim()} onClick={save}>Speichern</button></>}>
      <Field label="Titel" wide><input class="inp" value={f.title} onInput={(e) => setF({ ...f, title: e.currentTarget.value })} /></Field>
      <Field label="Bereich" wide><Select value={f.domain} onChange={(v) => setF({ ...f, domain: v })} options={DOMAIN_OPTS.map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Art" wide><Select value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={KIND_OPTS.map(([value, label]) => ({ value, label }))} /></Field>
      <label class="small"><input type="checkbox" checked={f.tags.split(',').some((t) => t.trim().toLowerCase() === 'private')} onChange={(e) => setF({ ...f, tags: [...f.tags.split(',').map((t) => t.trim()).filter((t) => t && t.toLowerCase() !== 'private'), ...(e.currentTarget.checked ? ['Private'] : [])].join(', ') })} /> Private · nur auf diesem PC verarbeiten</label>
      <Field label="Tags (kommagetrennt)" wide><input class="inp" value={f.tags} onInput={(e) => setF({ ...f, tags: e.currentTarget.value })} /></Field>
      <Field label="Gültig bis (optional)" wide><input class="inp" type="date" value={f.validUntil} onInput={(e) => setF({ ...f, validUntil: e.currentTarget.value })} /></Field>
      <textarea class="ta mt" rows={7} placeholder="Inhalt…" value={f.content} onInput={(e) => setF({ ...f, content: e.currentTarget.value })} autofocus />
    </Modal>
  );
}

