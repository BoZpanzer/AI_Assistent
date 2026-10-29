import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { Copy, Volume2, CircleCheck, SquareCheckBig, Brain, Timer, Gamepad2, NotebookPen, Link as LinkIcon, BookOpen, CalendarDays, Undo2, X, Check, TriangleAlert, FileText, Mic, Wrench, ChevronDown, RotateCcw } from 'lucide-preact';
import { rpc, useEvent } from '../lib/api.js';
import { useStore, setState, getState, guard, toast, navigate } from '../lib/store.js';
import { FixText } from './ui.jsx';
import { renderMarkdown, onMarkdownClick } from '../lib/markdown.js';
import { fmtTime } from '../lib/format.js';
import { BrandMark } from './Shell.jsx';
import { audio } from '../lib/audio.js';

const TOOL_LABEL = {
  quota_wait: 'Gemini-Minutenlimit erreicht – JARVIS wartet kurz und versucht es dann automatisch erneut',
  get_today_overview: 'Tagesüberblick', list_tasks: 'Aufgaben', create_task: 'Aufgabe anlegen', update_task: 'Aufgabe ändern', complete_task: 'Aufgabe abhaken', list_events: 'Kalender',
  find_free_slots: 'Freie Zeiten', create_event: 'Termin eintragen', update_event: 'Termin ändern', schedule_events: 'Termine planen', search_brain: 'Brain-Suche', remember: 'Merken', search_study: 'Studium durchsuchen',
  read_document: 'Dokument lesen', web_research: 'Webrecherche', read_webpage: 'Webseite lesen', save_webpage: 'Quelle speichern', set_game_context: 'Spielkontext', show_game_widget: 'Gaming-Widget',
  add_game_timer: 'Timer', tarkov_lookup: 'Tarkov-Daten', league_stats: 'LoL-Statistik', league_live: 'LoL Live', league_champion: 'Championinfo', wiki_lookup: 'Wiki', analyze_study_page: 'Seitenanalyse',
};
const CARD_ICON = { task: SquareCheckBig, check: CircleCheck, calendar: CalendarDays, brain: Brain, timer: Timer, game: Gamepad2, note: NotebookPen, link: LinkIcon, study: BookOpen };

/** Live message list for a conversation (streaming deltas, cards, voice transcripts). */
/** Wer hat geantwortet (lokal / Groq / Gemini) – und falls falsch eingeordnet: mit einem Klick andersherum beantworten. */
function RouteTag({ m, streaming }) {
  // Privat über die Cloud (lokale KI ausgeschaltet): meta.local === false trotz scope 'private'
  const privCloud = m.meta.scope === 'private' && m.meta.local === false;
  const local = !privCloud && (m.meta.scope === 'private' || m.meta.local);
  const who = local ? '🔒 lokal' : (/gpt-oss|groq|llama|qwen\/|kimi/i.test(m.meta.model || '') ? '☁ Groq' : '☁ Gemini') + (privCloud ? ' · privat' : '');
  const title = local ? 'Als privat erkannt – nur das lokale Modell, bleibt auf dem PC' : privCloud ? 'Privat, aber lokale KI ist ausgeschaltet – über Gemini beantwortet' : 'Als nicht privat erkannt – ohne deine privaten Nachrichten beantwortet';
  return (
    <span class="scope-tag" title={title}> · {who}
      {!streaming && m.conversationId && !privCloud && <button class="route-btn" title={local ? 'War nicht privat? Öffentlich (Groq/Gemini) beantworten' : 'War privat? Nur lokal beantworten'}
        onClick={() => rpc('chat.reroute', { conversationId: m.conversationId, messageId: m.id, as: local ? 'public' : 'private' })}>{local ? '↺ öffentlich' : '↺ privat'}</button>}
    </span>
  );
}

export function useConversation(cid) {
  const [msgs, setMsgs] = useState([]);
  const [tools, setTools] = useState({});
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!cid) return;
    let alive = true;
    rpc('conv.messages', { id: cid, limit: 200 }).then((m) => alive && setMsgs(m));
    return () => { alive = false; };
  }, [cid]);
  useEvent('message', (m) => { if (m.conversationId === cid) setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m])); if (m.channel === 'voice' && m.role !== 'tool') setLive(null); }, [cid]);
  useEvent('message:update', (m) => { if (m.conversationId === cid) setMsgs((x) => x.map((y) => (y.id === m.id ? m : y))); }, [cid]);
  useEvent('chat:delta', (d) => { if (d.conversationId === cid) setMsgs((x) => x.map((y) => (y.id === d.messageId ? { ...y, content: y.content + d.delta } : y))); }, [cid]);
  useEvent('chat:card', (d) => { if (d.conversationId === cid) setMsgs((x) => x.map((y) => (y.id === d.messageId ? { ...y, meta: { ...y.meta, cards: [...(y.meta?.cards || []), d.card] } } : y))); }, [cid]);
  useEvent('chat:done', (d) => { if (d.conversationId === cid) setTools((t) => ({ ...t, [d.messageId]: null })); }, [cid]);
  useEvent('chat:delta', (d) => { if (d.conversationId === cid) setTools((t) => (t[d.messageId] === 'quota_wait' ? { ...t, [d.messageId]: null } : t)); }, [cid]);
  useEvent('chat:tool', (d) => { if (d.conversationId === cid) setTools((t) => ({ ...t, [d.messageId]: d.state === 'running' ? d.name : null })); }, [cid]);
  useEvent('voice:transcript', (t) => { if (t.role === 'done') setLive(null); else setLive((l) => ({ ...(l || {}), [t.role]: t.text })); }, [cid]);
  return { msgs, tools, live };
}

export function MessageList({ cid, compact = false, emptyHint }) {
  const { msgs, tools, live } = useConversation(cid);
  const ref = useRef();
  const stick = useRef(true);
  useEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs, live]);
  const visible = compact ? msgs.slice(-12) : msgs;
  return (
    <div class="chat-list" ref={ref} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {!visible.length && !live && <div class="empty" style={{ margin: 'auto' }}>{emptyHint || 'Frag mich etwas – per Text oder Sprache. Zum Beispiel: „Jarvis, was steht heute an?“'}</div>}
      {visible.map((m) => <Message key={m.id} m={m} tool={tools[m.id]} />)}
      {live && (live.user || live.assistant) && (
        <>
          {live.user && <div class="msg user"><div class="who">{initial()}</div><div class="bubble"><div class="msg-body"><Mic size={13} style={{ color: 'var(--cyan)', marginRight: 6 }} />{live.user}<span class="cursor" /></div></div></div>}
          {live.assistant && <div class="msg"><div class="who"><Spark /></div><div class="bubble"><div class="msg-body">{live.assistant}<span class="cursor" /></div></div></div>}
        </>
      )}
    </div>
  );
}

function initial() { const s = getState().settings; return (s?.userName || s?.nickname || 'C').slice(0, 1).toUpperCase(); }
function Spark() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" /></svg>; }

export function Message({ m, tool }) {
  const html = useMemo(() => renderMarkdown(m.content), [m.content]);
  if (m.role === 'tool') return (m.meta?.cards || []).map((c) => <div class="msg"><div class="who" style={{ visibility: 'hidden' }} /><div style={{ flex: 1 }}><Card card={c} /></div></div>);
  if (m.role === 'system') return null;
  const user = m.role === 'user';
  const streaming = m.meta?.streaming;
  const sources = m.meta?.sources || [];
  return (
    <div class={`msg ${user ? 'user' : ''}`}>
      <div class="who">{user ? initial() : <Spark />}</div>
      <div class="bubble" style={user ? undefined : { flex: 1 }}>
        <span class="time">{m.channel === 'voice' && <Mic size={11} style={{ marginRight: 4, verticalAlign: -1 }} />}{fmtTime(m.createdAt)}{!user && m.meta?.scope && <RouteTag m={m} streaming={streaming} />}</span>
        {m.content ? <div class="msg-body selectable" onClick={(e) => onMarkdownClick(e, rpc)} dangerouslySetInnerHTML={{ __html: html }} /> : streaming ? <div class="typing"><i /><i /><i /></div> : null}
        {streaming && m.content && <span class="cursor" />}
        {tool && <div class="tool-trace"><Wrench size={12} /> {TOOL_LABEL[tool] || tool} …</div>}
        {m.meta?.attachments?.length > 0 && <div class="sources">{m.meta.attachments.map((a) => <span class="chip static"><FileText size={12} />{a.name}</span>)}</div>}
        {(m.meta?.cards || []).map((c) => <Card card={c} />)}
        {m.meta?.learned?.length > 0 && <div class="sources">{m.meta.learned.map((k) => <span class="chip static" title="Automatisch im Brain gespeichert – im Brain änder- oder löschbar">🧠 gemerkt: {k.title}</span>)}</div>}
        {!user && m.meta?.error && !streaming && m.conversationId && <button class="btn xs mt retry-btn" onClick={() => rpc('chat.retry', { conversationId: m.conversationId, messageId: m.id })}><RotateCcw size={12} />Nochmal versuchen</button>}
        {sources.length > 0 && (
          <div class="sources">
            {sources.map((s) => (
              <span class="chip" title={s.url || s.title} onClick={() => (s.url ? rpc('shell.openExternal', { url: s.url }) : s.docId ? rpc('shell.showDocument', { docId: s.docId }) : null)}>
                {s.kind === 'document' ? <BookOpen size={12} /> : <LinkIcon size={12} />}<span>{s.title}</span>
              </span>
            ))}
          </div>
        )}
        {!user && !streaming && m.content && (
          <div class="tools">
            <button class="btn icon xs ghost" title="Kopieren" onClick={() => { rpc('clipboard.write', { text: m.content }); toast('Kopiert'); }}><Copy size={13} /></button>
            <button class="btn icon xs ghost" title="Vorlesen" onClick={() => (audio.tts.speaking || speechSynthesis.speaking ? audio.stopSpeech() : audio.speakLocal(m.content, { full: true }))}><Volume2 size={13} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ card }) {
  if (card.kind === 'confirm') return <ConfirmCard card={card} />;
  const Icon = CARD_ICON[card.icon] || CircleCheck;
  const [undone, setUndone] = useState(false);
  return (
    <div class="card-action">
      <div class="ci"><Icon size={22} /></div>
      <div class="grow">
        <div style={{ fontWeight: 600 }}>{card.title}</div>
        {(card.lines || []).map((l) => <div class="small" style={{ color: 'var(--text-2)' }}>{l}</div>)}
        <div class="row mt gap-s">
          {card.undo && !undone && <button class="btn xs ghost" onClick={async () => { if (await guard(() => rpc('action.undo', card.undo), 'Rückgängig gemacht') !== undefined) setUndone(true); }}><Undo2 size={12} />Rückgängig</button>}
          {undone && <span class="tiny muted">rückgängig gemacht</span>}
          {card.navigate && <button class="btn xs ghost" onClick={() => navigate(card.navigate)}>Öffnen</button>}
        </div>
      </div>
      <CircleCheck class="ok-ico" size={24} />
    </div>
  );
}

function ConfirmCard({ card }) {
  const c = useStore((s) => s.confirmations[card.token]) || { status: new Date(card.expiresAt) < new Date() ? 'expired' : 'pending' };
  const [busy, setBusy] = useState(false);
  const status = c.status || 'pending';
  const act = async (approve) => {
    setBusy(true);
    await guard(() => rpc('confirm.resolve', { token: card.token, approve }));
    setBusy(false);
  };
  return (
    <div class={`card-confirm ${status === 'done' ? 'done' : status}`}>
      <div class="row">
        {status === 'done' ? <CircleCheck size={20} style={{ color: 'var(--green)' }} /> : <TriangleAlert size={20} style={{ color: status === 'pending' ? 'var(--yellow)' : 'var(--text-3)' }} />}
        <div style={{ fontWeight: 600 }} class="grow">{card.summary}</div>
        <CalendarDays size={18} style={{ color: 'var(--cyan)' }} />
      </div>
      {(card.details || []).map((d) => <div class="small" style={{ color: 'var(--text-2)', paddingLeft: 30 }}>{d}</div>)}
      <div class="row" style={{ paddingLeft: 30 }}>
        {status === 'pending' && <>
          <button class="btn xs primary" disabled={busy} onClick={() => act(true)}><Check size={13} />Bestätigen</button>
          <button class="btn xs ghost" disabled={busy} onClick={() => act(false)}><X size={13} />Ablehnen</button>
          <span class="tiny muted">gültig bis {fmtTime(card.expiresAt)}</span>
        </>}
        {status === 'done' && <span class="small ok">Ausgeführt</span>}
        {status === 'declined' && <span class="small muted">Abgelehnt</span>}
        {status === 'expired' && <span class="small muted">Abgelaufen – bitte erneut anfragen</span>}
        {status === 'error' && <span class="small err"><FixText text={'Fehler: ' + c.error} /></span>}
      </div>
    </div>
  );
}

/** Popover above the chat bar on pages without their own chat. */
export function MiniChat() {
  const open = useStore((s) => s.miniChatOpen);
  const page = useStore((s) => s.page);
  const cid = useStore((s) => s.conversationId);
  if (!open || ['dashboard', 'chat'].includes(page)) return null;
  return (
    <div class="panel glow" style={{ background: 'var(--panel-solid)', position: 'absolute', left: 80, right: 380, bottom: 'calc(100% + 8px)', height: 340, display: 'flex', flexDirection: 'column', zIndex: 30 }}>
      <div class="chat-head">
        <BrandMark />
        <span class="hud-title">Chat</span><span class="sep">// Konversation mit JARVIS</span>
        <span class="grow" />
        <button class="btn xs ghost" onClick={() => { navigate('chat'); setState({ miniChatOpen: false }); }}>Vollansicht</button>
        <button class="btn icon xs ghost" onClick={() => setState({ miniChatOpen: false })}><ChevronDown size={16} /></button>
      </div>
      <MessageList cid={cid} compact />
    </div>
  );
}
