import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore, bootstrap, getState, setState } from './lib/store.js';
import { on } from './lib/api.js';
import { audio, playStartSound } from './lib/audio.js';
import { Sidebar, Header, RightColumn, NotificationsModal, QuickEventModal } from './components/Shell.jsx';
import { Toasts, AskHost } from './components/ui.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Chat } from './pages/Chat.jsx';
import { Tasks } from './pages/Tasks.jsx';
import { Calendar } from './pages/Calendar.jsx';
import { Study } from './pages/Study.jsx';
import { Gaming } from './pages/Gaming.jsx';
import { Brain } from './pages/Brain.jsx';
import { Settings } from './pages/Settings.jsx';
import { Setup } from './pages/Setup.jsx';

const PAGES = { dashboard: Dashboard, chat: Chat, tasks: Tasks, calendar: Calendar, study: Study, gaming: Gaming, brain: Brain, settings: Settings };

function App() {
  const ready = useStore((s) => s.ready);
  const page = useStore((s) => s.page);
  const settings = useStore((s) => s.settings);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!settings) return;
    document.documentElement.style.setProperty('--hud-alpha', String(settings.hudTransparency ?? 0.85));
  }, [settings?.hudTransparency]);
  if (!ready) return <div class="frame" style={{ display: 'grid', placeItems: 'center' }}><div class="hud-title">JARVIS startet …</div></div>;
  const Page = PAGES[page] || Dashboard;
  const noRight = page === 'brain';
  return (
    <div class={`frame ${settings?.animations !== 'full' ? 'reduced-anim' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={(e) => { if (!e.relatedTarget) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onDrop(e); }}>
      <Sidebar />
      <div class="main">
        <Header />
        <div class={`workarea ${noRight ? 'no-right' : ''}`}>
          <Page />
          {!noRight && <RightColumn />}
        </div>
      </div>
      <Toasts />
      <AskHost />
      <NotificationsModal />
      <QuickEventModal />
      <Setup />
      {drag && <div class="drop-hint">Dateien hier ablegen – JARVIS liest und indexiert sie</div>}
    </div>
  );
}

async function onDrop(e) {
  const paths = [...(e.dataTransfer?.files || [])].map((f) => window.jarvis.pathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  const { rpc } = await import('./lib/api.js');
  setState({ miniChatOpen: !['dashboard', 'chat'].includes(getState().page) });
  rpc('chat.send', { conversationId: getState().conversationId, text: 'Ich habe dir Dateien gegeben. Fasse kurz zusammen, worum es geht.', attachments: paths.map((p) => ({ path: p })) });
}

bootstrap().then(() => {
  const s = getState().settings;
  playStartSound(s.startSound);
  if (s.voice?.wakeWord) audio.setWakeWord(true);
  on('settings:changed', async ({ keys }) => { if (keys.includes('voice')) { const { rpc } = await import('./lib/api.js'); const st = await rpc('settings.get'); audio.setWakeWord(!!st.voice.wakeWord); } });
  on('voice:toggle', () => audio.toggleVoice());
});

render(<App />, document.getElementById('app'));
