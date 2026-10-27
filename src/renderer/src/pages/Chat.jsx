import { useState } from 'preact/hooks';
import { MessageCircle, Plus, Search, Trash2, Download, Pencil } from 'lucide-preact';
import { Orb } from '../components/Orb.jsx';
import { MessageList } from '../components/ChatView.jsx';
import { ChatBar } from '../components/Shell.jsx';
import { ask } from '../components/ui.jsx';
import { useStore, setState, guard } from '../lib/store.js';
import { rpc, useRpc } from '../lib/api.js';
import { audio } from '../lib/audio.js';
import { fmtDateLong, ago } from '../lib/format.js';

export function Chat() {
  const cid = useStore((s) => s.conversationId);
  const [q, setQ] = useState('');
  const [list, reload] = useRpc('conv.list', { q: q.trim().length > 1 ? q : undefined }, { events: ['conversations:changed', 'message'], initial: [], debounce: 400 });
  const current = (list || []).find((c) => c.id === cid);
  return (
    <div class="page">
      <div class="page-body">
        <section class="panel glow" style={{ height: 180, flex: 'none', display: 'grid', gridTemplateColumns: '280px 1fr 280px' }}>
          <div style={{ padding: '44px 28px' }}>
            <div class="hud-title" style={{ fontSize: 22 }}>JARVIS</div>
            <div class="muted" style={{ marginTop: 6, lineHeight: 1.5 }}>Immer für dich da.<br />Fragen. Planen. Erledigen.</div>
          </div>
          <Orb compact onClick={() => audio.toggleVoice()} />
          <div />
        </section>
        <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 10, flex: 1, minHeight: 0 }}>
          <section class="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div class="row" style={{ padding: 10 }}>
              <div class="grow" style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-3)' }} />
                <input class="inp" style={{ paddingLeft: 28 }} placeholder="Gespräche durchsuchen" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
              </div>
              <button class="btn icon sm" title="Neues Gespräch" onClick={async () => { const c = await rpc('conv.create', {}); setState({ conversationId: c.id }); reload(); }}><Plus size={16} /></button>
            </div>
            <div class="col scroll" style={{ padding: '0 10px 10px', gap: 6 }}>
              {(list || []).map((c) => (
                <div class={`result-row ${c.id === cid ? 'sel' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }} onClick={() => setState({ conversationId: c.id })}>
                  <div class="ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>{c.privacy === 'private' ? '🔒 ' : ''}{c.title}</div>
                  <div class="tiny muted ellipsis">{c.snippet || c.preview || '—'}</div>
                  <div class="tiny muted">{ago(c.updatedAt)}</div>
                </div>
              ))}
              {!list?.length && <div class="empty">Keine Gespräche</div>}
            </div>
          </section>
          <section class="panel chat" style={{ minHeight: 0 }}>
            <div class="chat-head">
              <MessageCircle size={22} style={{ color: 'var(--cyan)' }} />
              <span class="hud-title">Chat</span><span class="sep">// {current?.title?.toUpperCase() || 'KONVERSATION MIT JARVIS'}</span>
              <span class="grow" />
              <span class="small" style={{ color: 'var(--cyan-2)' }}>{fmtDateLong()}</span>
              <button class="btn icon xs ghost" title="Umbenennen" onClick={async () => { const t = await ask('Gespräch umbenennen', current?.title || ''); if (t) { await rpc('conv.rename', { id: cid, title: t }); reload(); } }}><Pencil size={14} /></button>
              <button class="btn icon xs ghost" title="Als Markdown exportieren" onClick={() => guard(() => rpc('conv.export', { id: cid }))}><Download size={14} /></button>
              <button class="btn icon xs ghost" title="Gespräch löschen" onClick={async () => { if (await ask('Dieses Gespräch endgültig löschen?', '', { confirmOnly: true, danger: true, okLabel: 'Löschen' })) { await rpc('conv.remove', { id: cid }); const c = await rpc('conv.current'); setState({ conversationId: c.id }); reload(); } }}><Trash2 size={14} /></button>
            </div>
            <MessageList cid={cid} />
          </section>
        </div>
      </div>
      <ChatBar showMini={false} />
    </div>
  );
}

