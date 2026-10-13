import { useState, useRef, useEffect } from 'preact/hooks';
import { MicOff, LayoutGrid, MessageCircle, SquareCheckBig, CalendarDays, BookOpen, Gamepad2, Orbit, Settings, Search, Paperclip, SendHorizontal, Mic, Minus, Square, X, ChevronRight, Bell, FileText, Brain, Upload, Globe, Calendar as CalIcon, CircleStop, Download, Rocket, RefreshCw } from 'lucide-preact';
import { useStore, navigate, setState, toast, guard, getState } from '../lib/store.js';
import { rpc, useRpc, useEvent } from '../lib/api.js';
import { audio } from '../lib/audio.js';
import { fmtTime, relDay, ago } from '../lib/format.js';
import { Modal, Field } from './ui.jsx';
import { MiniChat } from './ChatView.jsx';

export const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'chat', label: 'Assistent / Chat', icon: MessageCircle },
  { id: 'tasks', label: 'Aufgaben', icon: SquareCheckBig },
  { id: 'calendar', label: 'Kalender', icon: CalendarDays },
  { id: 'study', label: 'Studium', icon: BookOpen },
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
  const voice = useStore((s) => s.voice);
  const google = useStore((s) => s.google);
  const secrets = useStore((s) => s.secrets);
  const online = !!secrets['gemini.api_key'];
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
      <div class="sys-status panel">
        <div class="hud-label" style={{ fontSize: 11.5 }}>System Status</div>
        <div class={`mini-orb ${online ? '' : 'off'}`} />
        <div class={`state ${online ? '' : 'warn'}`}>{online ? (voice !== 'off' && voice !== 'standby' ? 'SPRACHMODUS' : 'ONLINE') : 'SETUP'}</div>
        <div class="small muted">{online ? (google.connected ? 'Lokal · Google verbunden' : 'Lokales Kontrollzentrum') : 'Gemini-Schlüssel fehlt'}</div>
      </div>
    </aside>
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
  const [tasks] = useRpc('tasks.list', { filter: 'all', limit: 30 }, { events: ['tasks:changed'], initial: [] });
  const [notes] = useRpc('notify.list', { limit: 4 }, { events: ['notification', 'notifications:changed'], initial: [] });
  const counts = useStore((s) => s.counts);
  const game = useStore((s) => s.game);
  const todays = (events || []).filter((e) => new Date(e.start).toDateString() === now.toDateString() || (new Date(e.start) < now && new Date(e.end) > now));
  const upcoming = (events || []).filter((e) => new Date(e.start) > now).slice(0, 3);
  const open = (tasks || []).slice(0, 3);
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
        items={open.map((t) => ({ text: t.title, warn: t.overdue, v: t.dueAt ? relDay(t.dueAt) : '' }))} onClick={() => navigate('tasks')} />
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
  const muted = useStore((s) => s.micMuted);
  const ref = useRef();
  useEvent('ui:focus-input', () => ref.current?.focus());
  useEffect(() => { if (draft != null) { setText(draft); setState({ chatDraft: null }); setTimeout(() => ref.current?.focus(), 0); } }, [draft]);
  const voiceOn = ['listening', 'speaking', 'thinking', 'connecting'].includes(voice);
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
          <textarea ref={ref} rows={1} placeholder={voiceOn ? 'Sprachmodus aktiv – sprich einfach oder tippe …' : placeholder} value={text}
            onInput={(e) => { setText(e.currentTarget.value); e.currentTarget.style.height = '52px'; e.currentTarget.style.height = Math.min(140, e.currentTarget.scrollHeight) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          {voiceOn && <button class="mic" style={muted ? { color: 'var(--red)' } : undefined} onClick={() => audio.setMuted(!muted)} title={muted ? 'Stummschaltung aufheben' : 'Mikrofon stummschalten'}>{muted ? <MicOff size={20} /> : <Mic size={20} />}</button>}
          <button class={`mic ${voiceOn ? 'on' : voice === 'standby' ? 'standby' : ''}`} onClick={() => audio.toggleVoice()} title={voiceOn ? 'Sprachmodus beenden' : 'Sprechen (Gemini Live)'}>
            {voiceOn ? <CircleStop size={22} /> : <Mic size={22} />}
          </button>
          <button class="send" onClick={send} title="Senden (Enter)"><SendHorizontal size={24} /></button>
        </div>
        {acts.map((a) => <button class="btn" onClick={a.onClick} disabled={a.disabled}><a.icon size={20} />{a.label}</button>)}
      </div>
    </div>
  );
}

export function QuickEventModal() {
  const q = useStore((s) => s.quickEvent);
  const [f, setF] = useState(null);
  useEffect(() => {
    if (q) {
      let s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1);
      if (q.start) s = new Date(q.start);
      setF({ title: q.title || '', start: toLocal(s), end: toLocal(new Date(s.getTime() + 3600000)), location: '', allDay: false, ...(q.event ? fromEvent(q.event) : {}) });
    }
  }, [q]);
  if (!q || !f) return null;
  const editing = q.event?.id;
  const close = () => setState({ quickEvent: null });
  const save = async () => {
    const body = { title: f.title, start: new Date(f.start).toISOString(), end: new Date(f.end).toISOString(), location: f.location, allDay: f.allDay, description: f.description || '' };
    const r = await guard(() => (editing ? rpc('calendar.update', { id: q.event.id, patch: body }) : rpc('calendar.create', body)), editing ? 'Termin aktualisiert' : 'Termin eingetragen');
    if (r) close();
  };
  return (
    <Modal title={editing ? 'Termin bearbeiten' : 'Neuer Kalendereintrag'} sub={getState().google.connected ? 'Wird mit Google Kalender synchronisiert' : 'Nur lokal – Google in den Einstellungen verbinden'} onClose={close}
      actions={<>{editing && <button class="btn sm danger" onClick={async () => { if (await guard(() => rpc('calendar.remove', { id: q.event.id }), 'Termin gelöscht')) close(); }}>Löschen</button>}<button class="btn sm ghost" onClick={close}>Abbrechen</button><button class="btn sm primary" onClick={save} disabled={!f.title}>Speichern</button></>}>
      <Field label="Titel" wide><input class="inp" value={f.title} onInput={(e) => setF({ ...f, title: e.currentTarget.value })} autofocus /></Field>
      <Field label="Beginn" wide><input class="inp" type="datetime-local" value={f.start} onInput={(e) => setF({ ...f, start: e.currentTarget.value })} /></Field>
      <Field label="Ende" wide><input class="inp" type="datetime-local" value={f.end} onInput={(e) => setF({ ...f, end: e.currentTarget.value })} /></Field>
      <Field label="Ort" wide><input class="inp" value={f.location} onInput={(e) => setF({ ...f, location: e.currentTarget.value })} /></Field>
      <Field label="Notiz" wide><textarea class="ta" value={f.description || ''} onInput={(e) => setF({ ...f, description: e.currentTarget.value })} /></Field>
    </Modal>
  );
}
function toLocal(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function fromEvent(e) { return { title: e.title, start: toLocal(new Date(e.start)), end: toLocal(new Date(e.end)), location: e.location || '', description: e.description || '', allDay: e.allDay }; }
