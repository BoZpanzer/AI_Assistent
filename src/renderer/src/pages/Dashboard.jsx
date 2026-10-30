import { MessageCircle, Plus } from 'lucide-preact';
import { Orb } from '../components/Orb.jsx';
import { MessageList } from '../components/ChatView.jsx';
import { ChatBar } from '../components/Shell.jsx';
import { useStore, setState } from '../lib/store.js';
import { rpc } from '../lib/api.js';
import { audio } from '../lib/audio.js';
import { fmtDateLong } from '../lib/format.js';
import { LifeIntake } from '../components/LifeIntake.jsx';

export function Dashboard() {
  const cid = useStore((s) => s.conversationId);
  return (
    <div class="page">
      <div class="page-body" style={{ overflowY: 'auto' }}>
        <LifeIntake compact />
        <section class="panel glow" style={{ flex: '1.1 1 0', minHeight: 220 }}>
          <Orb onClick={() => audio.toggleVoice()} />
        </section>
        <section class="panel chat" style={{ flex: '1 1 0', minHeight: 240 }}>
          <div class="chat-head">
            <MessageCircle size={22} style={{ color: 'var(--cyan)' }} />
            <span class="hud-title">Chat</span><span class="sep">// KONVERSATION MIT JARVIS</span>
            <span class="grow" />
            <span class="small" style={{ color: 'var(--cyan-2)' }}>Heute, {fmtDateLong().replace(/^\w+\.,?\s/, '')}</span>
            <button class="btn xs ghost" title="Neues Gespräch" onClick={async () => { const c = await rpc('conv.create', {}); setState({ conversationId: c.id }); }}><Plus size={14} />Neu</button>
          </div>
          <MessageList cid={cid} />
        </section>
      </div>
      <ChatBar showMini={false} />
    </div>
  );
}
