import { useState, useRef, useEffect } from 'preact/hooks';
import { Wallet, LayoutGrid, MessageCircle, SquareCheckBig, CalendarDays, BookOpen, Gamepad2, Orbit, Settings, Search, Paperclip, SendHorizontal, Mic, Minus, Square, X, ChevronRight, Bell, FileText, Brain, Upload, Globe, Calendar as CalIcon, CircleStop, Download, Rocket, RefreshCw } from 'lucide-preact';
import { useStore, navigate, setState, toast, guard, getState } from '../lib/store.js';
import { rpc, useRpc, useEvent } from '../lib/api.js';
import { audio } from '../lib/audio.js';
import { fmtTime, relDay, ago } from '../lib/format.js';
import { Modal, Field, Toggle } from './ui.jsx';
import { MiniChat } from './ChatView.jsx';
import { PetFigure, genderFor } from './Pet.jsx';
import { usePetMood } from '../lib/pet-mood.js';

export const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'chat', label: 'Assistent / Chat', icon: MessageCircle },
  { id: 'tasks', label: 'Aufgaben', icon: SquareCheckBig },
  { id: 'calendar', label: 'Kalender', icon: CalendarDays },
  { id: 'study', label: 'Studium', icon: BookOpen },
  { id: 'life', label: 'Alltag', icon: Wallet },
  { id: 'gaming', label: 'Gaming', icon: Gamepad2 },
  { id: 'brain', label: 'Brain', icon: Orbit },
  { id: 'settings', label: 'Einstellungen', icon: Settings },
];

export function BrandMark() {
  return (
    <div class="brand-mark">
      <svg viewBox="0 0 48 48" fill="none" stroke="#38e1ff" stroke-width="1.6">
        <path d="M24 3 L45 24 L24 45 L3 24 Z" />
        <path d="M24 13 L26.2 21.8 L35 24 L26.2 26.2 L24 35 L21.8 26.2 L13 24 L21.8 21.8 Z" fill="rgba(56,225,255,0.15)" />
      </svg>
    </div>
  );
}

export function Sidebar() {
  const page = useStore((s) => s.page);
  const counts = useStore((s) => s.counts);
  return (
    <aside class="sidebar panel">
      <div class="brand">
        <BrandMark />
        <div>
          <div class="brand-name">JARVIS<b>.</b></div>
          <div class="brand-tag">HOME INTELLIGENCE</div>
        </div>
      </div>
      <nav class="nav">
        {PAGES.map((p) => (
          <button key={p.id} class={page === p.id ? 'active' : ''} onClick={() => navigate(p.id)}>
            <p.icon size={24} strokeWidth={1.6} />
            <span>{p.label}</span>
            {p.id === 'tasks' && counts.overdue > 0 && <span class="badge count" style={{ background: 'var(--orange)' }}>{counts.overdue}</span>}
          </button>
        ))}
      </nav>
      <div class="sys-status">
        <SidebarPet />
      </div>
    </aside>
  );
}

/** Die JARVIS-Figur im Systemstatus: hört zu, denkt, spricht wie auf dem Desktop; winkt ab und zu (oder bei Klick). */
function SidebarPet() {
  const settings = useStore((s) => s.settings);
  const mood = usePetMood();
  const [act, setAct] = useState(null);
  const [spotifyPlaying, setSpotifyPlaying] = useState(false);
  useEffect(() => {
    let active = true, timer;
    const poll = async () => {
      try { const r = await rpc('spotify.playback'); if (active) setSpotifyPlaying(!!r?.playing); }
      catch { if (active) setSpotifyPlaying(false); }
      if (active) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  const play = (a, ms) => { setAct(a); setTimeout(() => setAct((x) => (x === a ? null : x)), ms); };
  useEffect(() => {
    let t;
    const tick = () => { t = setTimeout(tick, 15000 + Math.random() * 20000); if (!spotifyPlaying && Math.random() < 0.5) play(Math.random() < 0.6 ? 'wave' : 'lean', 2600); };
    t = setTimeout(tick, 8000);
    return () => clearTimeout(t);
  }, [spotifyPlaying]);
  const gender = genderFor(settings);
  const busy = !!(mood.speaking || mood.listening || mood.standby || mood.bubble?.kind === 'think');
  const dance = gender === 'female' && spotifyPlaying && !busy && !act;
  const state = dance ? 'dance' : mood.state !== 'idle' ? mood.state : act || 'idle';
  // Figur füllt den Platz unten links (Größe folgt dem Fenster)
  const box = useRef(null);
  const [size, setSize] = useState(120);
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => { const { width, height } = e.contentRect; setSize(Math.max(70, Math.floor(Math.min(width - 8, (height - 6) / 1.5)))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} class="sys-pet" title="Doppelklick: Fenster schließen – JARVIS wartet als Figur auf dem Desktop" onClick={() => play('wave', 1800)} onDblClick={() => rpc('pet.hideUi').catch(() => {})}>
      <PetFigure gender={genderFor(settings)} state={state} size={size} />
    </div>
  );
}

/**
 * Sichtbar, was gerade aktiv ist: Cloud-KI (Modus, laufende Aufrufe, heutige Schätzung), Mikrofon (lokal/Cloud)
 * und die letzte Bildschirmaufnahme. Klick auf Cloud pausiert sie (strikt lokal) bzw. setzt sie fort.
 */
function PrivacyStatus() {
  const settings = useStore((s) => s.settings);
  const voice = useStore((s) => s.voice);
  const [st, reload] = useRpc('cloud.status', {}, { events: ['cloud:state', 'cloud:usage', 'settings:changed'] });
  const [shot, setShot] = useState(null);
  useEvent('privacy:capture', (d) => { setShot(d); setTimeout(() => setShot(null), 8000); });
  const local = (settings?.cloud?.mode || 'hybrid') === 'local';
  const eur = (v) => (v || 0).toFixed(2).replace('.', ',') + ' €';
  const mic = voice === 'recording-local' || voice === 'transcribing-local' ? 'Mikro lokal' : null;
  const toggle = () => guard(() => rpc('cloud.setMode', { mode: local ? 'hybrid' : 'local' }), local ? 'Cloud-KI wieder an (sparsam hybrid)' : 'Cloud-KI pausiert – alles lokal').then(reload);
  return (
    <div class="row gap-s tiny" style={{ marginLeft: 12, alignItems: 'center' }}>
      <span class={`chip ${local ? '' : 'active'}`} style={{ cursor: 'pointer' }} title="Klicken: Cloud-KI pausieren / fortsetzen" onClick={toggle}>
        {local ? 'Cloud aus' : st?.budget?.blocked ? 'Cloud gesperrt (Budget)' : `Cloud${st?.active ? ' · ' + st.active + ' läuft' : ''} · heute ${eur(st?.budget?.today)}`}
      </span>
      {mic && <span class="chip active" title="Mikrofon ist aktiv">{mic}</span>}
      {shot && <span class="chip active" title="Bildschirmaufnahme für eine Frage">{shot.scope === 'window' ? 'Spielfenster aufgenommen' : 'Bildschirm aufgenommen'}</span>}
    </div>
  );
}

export function Header() {
  const secrets = useStore((s) => s.secrets);
  const settings = useStore((s) => s.settings);
  const online = !!secrets['gemini.api_key'];
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(0);
  const timer = useRef();
  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setRes(null); return; }
    timer.current = setTimeout(async () => {
      const [brain, tasks, convs] = await Promise.all([
        rpc('brain.search', { q, scope: 'all' }).catch(() => ({ results: [] })), rpc('tasks.list', { q, filter: 'all', limit: 5 }).catch(() => []), rpc('conv.list', { q }).catch(() => []),
      ]);
      const items = [
        ...tasks.slice(0, 5).map((t) => ({ kind: 'Aufgabe', icon: SquareCheckBig, title: t.title, sub: t.dueAt ? relDay(t.dueAt) + ' ' + fmtTime(t.dueAt) : t.category, go: () => { setState({ page: 'tasks', focusTask: t.id }); } })),
        ...brain.results.slice(0, 8).map((r) => ({ kind: r.type === 'document' ? 'Dokument' : 'Brain', icon: r.type === 'document' ? FileText : Brain, title: r.title, sub: r.citation || r.domainLabel, go: () => { setState({ page: r.type === 'document' ? 'study' : 'brain', focusKnowledge: r.type === 'document' ? null : r.id, focusDoc: r.docId }); } })),
        ...convs.slice(0, 4).map((c) => ({ kind: 'Gespräch', icon: MessageCircle, title: c.title, sub: c.snippet || '', go: () => { setState({ page: 'chat', conversationId: c.id }); } })),
      ];
      setRes(items); setSel(0);
    }, 220);
  }, [q]);
  const pick = (it) => { it.go(); setQ(''); setRes(null); };
  return (
    <header class="header panel">
      <div class="logo-word">JARVIS</div>
      <div class="conn">
        <span class={`dot ${online ? '' : 'off'}`} />
        <div><div class="t1">{online ? 'ONLINE' : 'EINRICHTUNG'}</div><div class="t2">{online ? 'System aktiv' : 'Gemini nicht verbunden'}</div></div>
      </div>
      <PrivacyStatus />
      <div class="search">
        <Search size={18} />
        <input placeholder="Suche…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (!res?.length) return;
            if (e.key === 'ArrowDown') { setSel((sel + 1) % res.length); e.preventDefault(); }
            if (e.key === 'ArrowUp') { setSel((sel - 1 + res.length) % res.length); e.preventDefault(); }
            if (e.key === 'Enter') pick(res[sel]);
            if (e.key === 'Escape') { setQ(''); setRes(null); }
          }} />
        {res && (
          <div class="search-results panel glow">
            {!res.length && <div class="empty">Keine Treffer</div>}
            {res.map((it, i) => (
              <div class={`hit row ${i === sel ? 'sel' : ''}`} onMouseDown={() => pick(it)}>
                <it.icon size={16} style={{ color: 'var(--cyan)' }} />
                <div class="grow"><div class="ellipsis">{it.title}</div><div class="tiny muted ellipsis">{it.kind}{it.sub ? ' · ' + it.sub : ''}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>
      <UpdateButton />
      <div class="profile" onClick={() => navigate('settings')} title="Profil & Einstellungen">
        <div class="avatar">{(settings?.userName || settings?.nickname || 'C').slice(0, 1).toUpperCase()}</div>
        <span class="tiny muted">Profil</span>
      </div>
      <div class="winctl">
        <button onClick={() => rpc('window.minimize')} title="Minimieren"><Minus size={18} /></button>
        <button onClick={() => rpc('window.maximize')} title="Maximieren"><Square size={15} /></button>
        <button class="close" onClick={() => rpc('window.close')} title="Schließen (läuft im Tray weiter)"><X size={18} /></button>
      </div>
    </header>
  );
}

/** Leuchtender „Aktualisieren“-Button, sobald ein signiertes Update bereitsteht. */
function UpdateButton() {
  const u = useStore((s) => s.update);
  const [open, setOpen] = useState(false);
  if (!u || !['available', 'downloading', 'ready', 'installing'].includes(u.state) || (u.state === 'available' && !u.signed)) return open ? <UpdateModal onClose={() => setOpen(false)} /> : null;
  const label = u.state === 'downloading' ? `Lädt ${u.progress != null ? Math.round(u.progress * 100) + ' %' : '…'}` : u.state === 'installing' ? 'Installiert …' : `Aktualisieren auf ${u.version}`;
  return (
    <>
      <button class="update-btn" onClick={() => setOpen(true)} title="Neue JARVIS-Version verfügbar">
        {u.state === 'downloading' || u.state === 'installing' ? <RefreshCw size={15} class="spin" /> : <Download size={15} />}{label}
        {u.state === 'downloading' && u.progress != null && <i style={{ width: `${Math.round(u.progress * 100)}%` }} />}
      </button>
      {open && <UpdateModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function UpdateModal({ onClose }) {
  const u = useStore((s) => s.update) || {};
  const game = useStore((s) => s.game);
  const busy = ['checking', 'downloading', 'installing'].includes(u.state);
  const install = async () => { await guard(() => rpc('update.install')); };
  const mb = (n) => (n ? (n / 1048576).toFixed(0) + ' MB' : '');
  return (
    <Modal title={u.state === 'available' || u.state === 'ready' || u.state === 'downloading' ? `JARVIS ${u.version} ist da` : 'JARVIS aktualisieren'} onClose={busy ? undefined : onClose} width={580}>
      <div class="small muted">Installiert: {u.current}{u.version && u.version !== u.current ? ` → neu: ${u.version}` : ''}{u.size ? ` · ${mb(u.size)}` : ''}{u.publishedAt ? ` · veröffentlicht ${new Date(u.publishedAt).toLocaleDateString('de-DE')}` : ''}</div>
      {u.notes && <div class="md small mt update-notes" dangerouslySetInnerHTML={{ __html: renderNotes(u.notes) }} />}
      {u.state === 'available' && !u.signed && <div class="notice warn mt">Dieses Update ist nicht gültig signiert und wird deshalb nicht automatisch installiert.</div>}
      {game?.gaming && <div class="notice mt">Du bist gerade im Spiel – JARVIS startet beim Aktualisieren kurz neu. Lieber nach der Runde.</div>}
      {u.error && <div class="notice warn mt">{u.error}</div>}
      {u.state === 'downloading' && <div class="meter mt" style={{ width: '100%' }}><i style={{ width: `${Math.round((u.progress || 0) * 100)}%` }} /></div>}
      {u.state === 'downloading' && u.received > 0 && <div class="tiny muted mt">{(u.received / 1048576).toFixed(0)}{u.total ? ` von ${(u.total / 1048576).toFixed(0)}` : ''} MB · {u.speed ? (u.speed / 1048576).toFixed(1) + ' MB/s' : '…'}{u.eta != null ? ` · noch ca. ${u.eta >= 60 ? Math.round(u.eta / 60) + ' Min.' : u.eta + ' s'}` : ''}{u.releaseUrl && u.speed && u.speed < 512 * 1024 ? <> · langsam? <a href="#" onClick={(e) => { e.preventDefault(); rpc('shell.openExternal', { url: u.releaseUrl }); }}>im Browser herunterladen</a></> : null}</div>}
      <div class="tiny muted mt">Ablauf: Download → Prüfsumme & Signatur prüfen → automatische Datensicherung → stille Installation → JARVIS startet neu. Deine Daten in %APPDATA%\JARVIS bleiben erhalten.</div>
      <div class="row gap-s mt" style={{ justifyContent: 'flex-end' }}>
        {!busy && <button class="btn sm ghost" onClick={onClose}>Später</button>}
        {(u.state === 'available' || u.state === 'ready') && u.signed && <button class="btn sm primary" onClick={install}><Rocket size={14} />Jetzt aktualisieren</button>}
        {busy && <span class="row small"><RefreshCw size={14} class="spin" />{u.state === 'installing' ? 'Installiere – JARVIS startet gleich neu …' : u.state === 'checking' ? 'Suche …' : 'Lade herunter …'}</span>}
      </div>
    </Modal>
  );
}
function renderNotes(t) { return String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/^### (.*)$/gm, '<b>$1</b>').replace(/^## (.*)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-*] (.*)$/gm, '• $1').replace(/\n/g, '<br>'); }

function RCard({ icon: Icon, title, sub, items, onClick, empty }) {
  return (
    <div class="panel rcard" onClick={onClick}>
      <div class="rcard-head">
        <div class="ico"><Icon size={22} /></div>
        <div><div class="t">{title}</div><div class="s">{sub}</div></div>
        <ChevronRight class="chev" size={20} />
      </div>
      <ul class="bullets">
        {items.length ? items.map((it) => <li class={it.warn ? 'warn' : ''}><span class="grow ellipsis">{it.text}</span>{it.v && <span class="v">{it.v}</span>}</li>) : <li class="empty">{empty}</li>}
      </ul>
    </div>
  );
}

/** Right information column: Heute · Kalender · Aufgaben · Benachrichtigungen (+ optional extra). */
export function RightColumn({ extra }) {
  const now = new Date();
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 7 * 86400000);
  const [events] = useRpc('calendar.list', { from: from.toISOString(), to: to.toISOString() }, { events: ['calendar:changed'], initial: [] });
  const [tasks] = useRpc('tasks.focus', { limit: 5 }, { events: ['tasks:changed'], initial: [] });
  const [notes] = useRpc('notify.list', { limit: 4 }, { events: ['notification', 'notifications:changed'], initial: [] });
  const counts = useStore((s) => s.counts);
  const game = useStore((s) => s.game);
  const todays = (events || []).filter((e) => new Date(e.start).toDateString() === now.toDateString() || (new Date(e.start) < now && new Date(e.end) > now));
  const upcoming = (events || []).filter((e) => new Date(e.start) > now).slice(0, 3);
  const open = (tasks || []).slice(0, 5);
  const PRIO = { high: '🔴', medium: '🟡', low: '⚪' };
  const heute = [
    { text: todays.length ? `${todays.length} Termin${todays.length > 1 ? 'e' : ''} heute${todays[0] && !todays[0].allDay ? ' · ab ' + fmtTime(todays[0].start) : ''}` : 'Keine Termine heute' },
    { text: `${counts.today} Aufgabe${counts.today === 1 ? '' : 'n'} fällig`, warn: counts.overdue > 0, v: counts.overdue ? `${counts.overdue} überfällig` : '' },
    game.active ? { text: `Spiel: ${game.active.profile.name}` } : { text: 'Schneller Tagesstatus: alles im Griff' },
  ];
  return (
    <aside class="rightcol panel">
      {extra}
      <RCard icon={CalIcon} title="HEUTE" sub="Dein Tagesüberblick" items={heute} onClick={() => navigate('dashboard')} />
      <RCard icon={CalendarDays} title="KALENDER" sub="Termine und Ereignisse" empty="Keine anstehenden Termine"
        items={upcoming.map((e) => ({ text: e.title, v: `${relDay(e.start)}${e.allDay ? '' : ' ' + fmtTime(e.start)}` }))} onClick={() => navigate('calendar')} />
      <RCard icon={SquareCheckBig} title="AUFGABEN" sub="Deine To-dos" empty="Alles erledigt 🎉"
        items={open.map((t) => ({ text: `${PRIO[t.priority] || ''} ${t.title}`.trim(), warn: t.overdue, v: t.recurrence ? '↻ ' + (t.allDay || !t.dueAt ? 'heute' : fmtTime(t.dueAt)) : t.dueAt ? relDay(t.dueAt) : '' }))} onClick={() => navigate('tasks')} />
      <RCard icon={Bell} title="BENACHRICHTIGUNGEN" sub="Wichtige Updates" empty="Keine neuen Meldungen"
        items={(notes || []).map((n) => ({ text: n.title, v: ago(n.createdAt), warn: !n.read }))} onClick={() => setState({ showNotifications: true })} />
    </aside>
  );
}

export function NotificationsModal() {
  const show = useStore((s) => s.showNotifications);
  const [list, reload] = useRpc('notify.list', { limit: 80 }, { events: ['notification', 'notifications:changed'], initial: [], enabled: !!show, deps: [show] });
  if (!show) return null;
  return (
    <Modal title="Benachrichtigungen" sub="Herkunft jeder Meldung ist angegeben" onClose={() => setState({ showNotifications: false })} width="640px"
      actions={<><button class="btn sm ghost" onClick={async () => { await rpc('notify.read', { ids: 'all' }); reload(); }}>Alle gelesen</button><button class="btn sm" onClick={() => setState({ showNotifications: false })}>Schließen</button></>}>
      <div class="col" style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {!list?.length && <div class="empty">Keine Benachrichtigungen</div>}
        {(list || []).map((n) => (
          <div class="result-row" style={{ alignItems: 'flex-start', opacity: n.read ? 0.65 : 1 }} onClick={() => rpc('notify.read', { ids: [n.id] })}>
            <Bell size={18} />
            <div class="grow">
              <div style={{ fontWeight: 600 }}>{n.title}</div>
              <div class="small" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div class="tiny muted mt">{n.originLabel} · {ago(n.createdAt)}</div>
            </div>
            <button class="btn icon xs ghost" onClick={(e) => { e.stopPropagation(); rpc('notify.remove', { id: n.id }); }}><X size={14} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Bottom chat bar — available on every page. `actions` adds page-specific buttons.
 * `onSubmit` overrides the default (send to JARVIS).
 */
export function ChatBar({ actions, placeholder = 'Nachricht an JARVIS …', onSubmit, showMini = true }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const voice = useStore((s) => s.voice);
  const page = useStore((s) => s.page);
  const draft = useStore((s) => s.chatDraft);
  const ref = useRef();
  useEvent('ui:focus-input', () => ref.current?.focus());
  useEffect(() => { if (draft != null) { setText(draft); setState({ chatDraft: null }); setTimeout(() => ref.current?.focus(), 0); } }, [draft]);
  const localVoiceOn = voice === 'recording-local';
  const cont = useStore((x) => x.voiceContinuous); // Sprachmodus als Schalter an
  const voiceOn = localVoiceOn || cont;
  const send = async () => {
    const t = text.trim();
    if (!t && !files.length) return;
    if (onSubmit) { await onSubmit(t); setText(''); return; }
    setText(''); const f = files; setFiles([]);
    if (!['dashboard', 'chat'].includes(page)) setState({ miniChatOpen: true });
    await guard(() => rpc('chat.send', { conversationId: getState().conversationId, text: t, attachments: f.map((x) => ({ path: x.path })) }));
  };
  const attach = async () => {
    const paths = await rpc('dialog.pickFiles', { kind: 'docs' });
    if (paths) setFiles([...files, ...paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() }))].slice(0, 5));
  };
  const defaults = [
    { icon: Globe, label: 'Recherche', onClick: () => { if (!text.trim()) { toast('Erst eine Frage eingeben, dann „Recherche“.'); ref.current?.focus(); return; } const t = text; setText(''); if (!['dashboard', 'chat'].includes(page)) setState({ miniChatOpen: true }); rpc('chat.send', { conversationId: getState().conversationId, text: 'Recherchiere aktuell im Internet und nenne Quellen: ' + t }); } },
    { icon: CalendarDays, label: 'Kalender-Eintrag', onClick: () => setState({ quickEvent: { title: text } }) },
    { icon: Upload, label: 'Import', onClick: async () => { const r = await guard(() => rpc('study.import')); if (r?.length) toast(`${r.filter((x) => !x.error).length} Datei(en) importiert und indexiert`); } },
  ];
  const acts = actions || defaults;
  return (
    <div class="panel" style={{ position: 'relative' }}>
      {showMini && <MiniChat />}
      {files.length > 0 && <div class="chips">{files.map((f, i) => <span class="chip"><Paperclip size={12} />{f.name}<X size={12} onClick={() => setFiles(files.filter((_, j) => j !== i))} /></span>)}</div>}
      <div class="chatbar">
        <button class="btn icon attach" onClick={attach} title="Datei anhängen"><Paperclip size={22} /></button>
        <div class="input">
          <textarea ref={ref} rows={1} placeholder={localVoiceOn ? '🔒 Offline-Aufnahme läuft – zum Erkennen erneut auf das Mikrofon klicken …' : voice === 'transcribing-local' ? '🔒 Sprache wird offline erkannt …' : placeholder} value={text}
            onInput={(e) => { setText(e.currentTarget.value); e.currentTarget.style.height = '52px'; e.currentTarget.style.height = Math.min(140, e.currentTarget.scrollHeight) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button class={`mic ${voiceOn ? 'on' : voice === 'standby' ? 'standby' : ''}`} disabled={voice === 'transcribing-local' && !cont} onClick={() => audio.toggleVoice()} title={cont ? 'Sprachmodus beenden' : localVoiceOn ? 'Aufnahme stoppen und senden' : voice === 'transcribing-local' ? 'Offline-Spracherkennung läuft …' : '🔒 Spracheingabe (lokal erkannt, privat bleibt lokal)'}>
            {voiceOn ? <CircleStop size={22} /> : <Mic size={22} />}
          </button>
          <button class="send" onClick={send} title="Senden (Enter)"><SendHorizontal size={24} /></button>
        </div>
        {acts.map((a) => <button class="btn" onClick={a.onClick} disabled={a.disabled}><a.icon size={20} />{a.label}</button>)}
      </div>
    </div>
  );
}

const EV_COLORS = [['auto', 'Automatisch', null], ['1', 'Lavendel', '#7986cb'], ['2', 'Salbei', '#33b679'], ['3', 'Traube', '#8e24aa'], ['4', 'Flamingo', '#e67c73'], ['5', 'Banane', '#f6bf26'], ['6', 'Mandarine', '#f4511e'], ['7', 'Pfau', '#039be5'], ['8', 'Graphit', '#616161'], ['9', 'Heidelbeere', '#3f51b5'], ['10', 'Basilikum', '#0b8043'], ['11', 'Tomate', '#d50000']];
const REPEAT = [['', 'Nie'], ['daily', 'Täglich'], ['weekly', 'Wöchentlich'], ['monthly', 'Monatlich'], ['yearly', 'Jährlich']];
const isBirthday = (t) => /geburtstag|birthday|\bgeb\.?\b/i.test(t || '');

export function QuickEventModal() {
  const q = useStore((s) => s.quickEvent);
  const [f, setF] = useState(null);
  const [touched, setTouched] = useState({});
  useEffect(() => {
    if (q) {
      let s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1);
      if (q.start) s = new Date(q.start);
      const base = { title: q.title || '', start: toLocal(s), end: toLocal(new Date(s.getTime() + 3600000)), day: toDay(s), dayEnd: toDay(s), location: '', allDay: !!q.allDay, repeat: '', color: 'auto' };
      setF({ ...base, ...(q.event ? fromEvent(q.event) : {}) });
      setTouched({});
    }
  }, [q]);
  if (!q || !f) return null;
  const editing = q.event?.id;
  const recurring = editing && q.event?.recurring;
  const close = () => setState({ quickEvent: null });
  const set = (patch) => setF((x) => {
    const n = { ...x, ...patch };
    // Geburtstag erkannt → ganztägig + jährlich vorschlagen (solange nicht selbst geändert)
    if (!editing && patch.title !== undefined && isBirthday(patch.title) && !isBirthday(x.title)) {
      if (!touched.allDay) n.allDay = true;
      if (!touched.repeat) n.repeat = 'yearly';
    }
    return n;
  });
  const save = async () => {
    let start, end;
    if (f.allDay) {
      start = new Date(f.day + 'T00:00:00');
      const last = new Date((f.dayEnd && f.dayEnd >= f.day ? f.dayEnd : f.day) + 'T00:00:00'); last.setDate(last.getDate() + 1);
      end = last;
    } else { start = new Date(f.start); end = new Date(f.end); if (end <= start) end = new Date(start.getTime() + 3600000); }
    const body = { title: f.title, start: start.toISOString(), end: end.toISOString(), location: f.location, allDay: f.allDay, description: f.description || '', color: f.color || 'auto' };
    if (!recurring) body.recurrence = f.repeat ? { freq: f.repeat, interval: 1 } : null;
    if (editing && !touched.repeat) delete body.recurrence;
    const r = await guard(() => (editing ? rpc('calendar.update', { id: q.event.id, patch: body }) : rpc('calendar.create', body)), editing ? 'Termin aktualisiert' : 'Termin eingetragen');
    if (r) close();
  };
  const ro = q.event?.readOnly;
  return (
    <Modal title={editing ? (ro ? 'Termin' : 'Termin bearbeiten') : 'Neuer Kalendereintrag'} sub={ro ? 'Aus einem abonnierten Kalender – schreibgeschützt' : getState().google.connected ? 'Wird mit Google Kalender synchronisiert' : 'Nur lokal – Google in den Einstellungen verbinden'} onClose={close}
      actions={ro ? <button class="btn sm" onClick={close}>Schließen</button> : <>{editing && <button class="btn sm danger" onClick={async () => { if (await guard(() => rpc('calendar.remove', { id: q.event.id }), 'Termin gelöscht')) close(); }}>Löschen</button>}<button class="btn sm ghost" onClick={close}>Abbrechen</button><button class="btn sm primary" onClick={save} disabled={!f.title}>Speichern</button></>}>
      <Field label="Titel" wide><input class="inp" value={f.title} onInput={(e) => set({ title: e.currentTarget.value })} placeholder="z. B. Geburtstag Mama, Klausur Mathe II …" autofocus /></Field>
      <Field label="Ganztägig"><Toggle checked={f.allDay} onChange={(v) => { setTouched({ ...touched, allDay: true }); set({ allDay: v }); }} /></Field>
      {f.allDay ? <>
        <Field label="Datum" wide><input class="inp" type="date" value={f.day} onInput={(e) => set({ day: e.currentTarget.value, dayEnd: f.dayEnd < e.currentTarget.value ? e.currentTarget.value : f.dayEnd })} /></Field>
        <Field label="Bis einschließlich" hint="für mehrtägige Einträge, z. B. Urlaub" wide><input class="inp" type="date" value={f.dayEnd} min={f.day} onInput={(e) => set({ dayEnd: e.currentTarget.value })} /></Field>
      </> : <>
        <Field label="Beginn" wide><input class="inp" type="datetime-local" value={f.start} onInput={(e) => { const v = e.currentTarget.value; const dur = Date.parse(f.end) - Date.parse(f.start); set({ start: v, end: dur > 0 ? toLocal(new Date(Date.parse(v) + dur)) : f.end }); }} /></Field>
        <Field label="Ende" wide><input class="inp" type="datetime-local" value={f.end} onInput={(e) => set({ end: e.currentTarget.value })} /></Field>
      </>}
      {!recurring && <Field label="Wiederholen" wide><div class="seg">{REPEAT.map(([v, l]) => <button type="button" class={f.repeat === v ? 'active' : ''} onClick={() => { setTouched({ ...touched, repeat: true }); set({ repeat: v }); }}>{l}</button>)}</div></Field>}
      {recurring && <div class="tiny muted">Serientermin – Änderungen gelten für die ganze Serie.</div>}
      <Field label="Farbe" hint={f.color === 'auto' ? 'Automatisch: Geburtstage rosa 🎂, Feiertage grün, Prüfungen rot, Lernen lila …' : undefined} wide>
        <div class="swatches">{EV_COLORS.map(([id, name, hex]) => <button type="button" title={name} class={`sw ${f.color === id ? 'on' : ''} ${id === 'auto' ? 'auto' : ''}`} style={hex ? { background: hex } : undefined} onClick={() => set({ color: id })}>{id === 'auto' ? 'A' : ''}</button>)}</div>
      </Field>
      <Field label="Ort" wide><input class="inp" value={f.location} onInput={(e) => set({ location: e.currentTarget.value })} /></Field>
      <Field label="Notiz" wide><textarea class="ta" value={f.description || ''} onInput={(e) => set({ description: e.currentTarget.value })} /></Field>
    </Modal>
  );
}
function toDay(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function toLocal(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function fromEvent(e) {
  const s = new Date(e.start); const en = new Date(e.end); const last = new Date(en.getTime() - 1);
  return { title: e.title, start: toLocal(s), end: toLocal(en), day: toDay(s), dayEnd: toDay(e.allDay ? last : s), location: e.location || '', description: e.description || '', allDay: !!e.allDay, color: e.colorId || 'auto', repeat: e.recurrence?.freq || '' };
}

