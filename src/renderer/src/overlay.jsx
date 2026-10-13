import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Timer, Trophy, Sparkles, Swords, Bell, Mic, Loader2, MapPin, Check, X } from 'lucide-preact';
import { rpc, on, useRpc, useEvent } from './lib/api.js';
import { renderMarkdown } from './lib/markdown.js';
import { countdown } from './lib/format.js';

/** Kompaktes In-Game-HUD. Nur lesen/anzeigen – keine Eingaben nötig. */
function useNow(ms) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }

function Card({ icon: Icon, title, children, accent, onClose }) {
  return (
    <div class="ov-card" style={accent ? { borderColor: accent } : undefined}>
      <div class="ov-head"><Icon size={14} /><span>{title}</span>{onClose && <X size={13} class="ov-x" onClick={onClose} />}</div>
      {children}
    </div>
  );
}

function App() {
  const [game, setGame] = useState(null);
  const [voice, setVoice] = useState('off');
  const [answer, setAnswer] = useState(null);
  const [thinking, setThinking] = useState(null);
  const [champ, setChamp] = useState(null);
  const [review, setReview] = useState(null);
  const [live, setLive] = useState(null);
  const [interactive, setInteractive] = useState(false);
  const [transcript, setTranscript] = useState(null);
  const [notes, setNotes] = useState([]);
  const now = useNow(1000);
  useEffect(() => { rpc('game.state').then(setGame); rpc('voice.state').then((v) => setVoice(v.state)); }, []);
  useEvent('game:context', setGame);
  useEvent('voice:state', (v) => setVoice(v.state));
  useEvent('overlay:thinking', (d) => { setThinking(d.question); setAnswer(null); });
  useEvent('overlay:answer', (d) => { setThinking(null); setAnswer({ ...d, at: Date.now() }); });
  useEvent('lol:champselect', (d) => setChamp(d?.active ? d : null));
  useEvent('lol:review', (d) => setReview({ ...d, at: Date.now() }));
  useEvent('lol:live', (d) => setLive(d?.connected ? d : null));
  useEvent('overlay:interactive', (d) => setInteractive(d.interactive));
  useEvent('voice:transcript', (t) => { if (t.role === 'done') setTimeout(() => setTranscript(null), 6000); else setTranscript((x) => ({ ...(x || {}), [t.role]: t.text })); });
  useEvent('notification', (n) => { setNotes((x) => [{ ...n, at: Date.now() }, ...x].slice(0, 3)); });
  const active = game?.active?.profile;
  const [timers] = useRpc('game.timers', {}, { events: ['game:timers'], initial: [] });
  const [prog] = useRpc('game.progress', { game: active?.id }, { events: ['game:progress'], enabled: !!active, deps: [active?.id] });
  const [mini] = useRpc('game.lastMap', { game: active?.id }, { events: ['game:markers'], enabled: active?.integration === 'tarkov', deps: [active?.id] });
  const [cfg] = useRpc('settings.get', {}, { events: ['settings:changed'] });
  const open = (timers || []).filter((t) => !t.fired || Date.parse(t.endsAt) > now - 600000).sort((a, b) => (a.game === active?.id ? -1 : 0) - (b.game === active?.id ? -1 : 0)).slice(0, 5);
  const highlights = (prog?.items || []).filter((x) => x.status === 'in_progress' || x.status === 'todo' || (!x.status && x.value)).slice(0, 5);
  const recentNotes = notes.filter((n) => now - n.at < 20000);
  const showAnswer = answer && now - answer.at < 25000;
  return (
    <div class={`ov ${interactive ? 'interactive' : ''}`}>
      <div class="ov-top">
        <svg width="18" height="18" viewBox="0 0 48 48" fill="none" stroke="#38e1ff" stroke-width="3"><path d="M24 3 L45 24 L24 45 L3 24 Z" /></svg>
        <b>JARVIS</b>
        <span class="ov-game">{active ? active.short || active.name : 'kein Spiel'}</span>
        <span class="grow" />
        {voice !== 'off' && voice !== 'standby' && <span class={`ov-voice ${voice}`}><Mic size={12} />{({ listening: 'hört zu', speaking: 'spricht', thinking: 'denkt', connecting: 'verbindet' })[voice] || voice}</span>}
      </div>

      {thinking && <Card icon={Loader2} title="Schaue mir das an …"><div class="ov-dim">{thinking}</div></Card>}
      {showAnswer && <Card icon={Sparkles} title="JARVIS" accent="var(--cyan)" onClose={() => setAnswer(null)}><div class="ov-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.answer) }} /></Card>}
      {transcript?.assistant && <Card icon={Mic} title="JARVIS sagt"><div class="ov-dim">{transcript.assistant}</div></Card>}

      {champ && (
        <Card icon={Swords} title={`Championauswahl${champ.myChampion ? ' · ' + champ.myChampion : ''}`} accent="#c8aa6e">
          {champ.enemies?.length > 0 && <div class="ov-dim">Gegner: {champ.enemies.join(', ')}</div>}
          {champ.advice ? <div class="ov-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(champ.advice) }} /> : champ.tips?.length ? <ul>{champ.tips.slice(0, 4).map((t) => <li>{t}</li>)}</ul> : <div class="ov-dim">Warte auf Picks …</div>}
        </Card>
      )}
      {review && now - review.at < 30000 && (
        <Card icon={Trophy} title={`Nachbesprechung · ${review.title}`} accent={review.win ? 'var(--green)' : 'var(--red)'} onClose={() => setReview(null)}>
          <div class="ov-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(review.summary) }} />
        </Card>
      )}
      {live && live.tips?.length > 0 && <Card icon={Sparkles} title={`Live · ${live.champion}`}><ul>{live.tips.map((t) => <li>{t}</li>)}</ul></Card>}

      {open.length > 0 && (
        <Card icon={Timer} title="Timer">
          {open.map((t) => { const done = Date.parse(t.endsAt) <= now; return (
            <div class="ov-row"><span class="grow ov-ell">{t.game !== active?.id ? <span class="ov-dim">{t.gameName.split(':')[0]} · </span> : null}{t.label}</span><b class={done ? 'ok' : ''}>{done ? 'fertig*' : countdown(t.endsAt)}</b></div>); })}
        </Card>
      )}
      {highlights.length > 0 && (
        <Card icon={Trophy} title="Spielstand">
          {highlights.map((x) => <div class="ov-row"><span class="grow ov-ell">{x.name}</span><b>{x.value || x.statusLabel}</b></div>)}
        </Card>
      )}
      {cfg?.overlay?.showMap !== false && mini?.hasImage && (
        <Card icon={MapPin} title={`Karte · ${mini.map}`}>
          <div class="ov-map">
            <img src={`app://jarvis/map-image/${encodeURIComponent(active.id)}/${encodeURIComponent(mini.map)}`} />
            {mini.markers.map((m) => <i class={`ov-pin mk-${m.category}`} style={{ left: m.x * 100 + '%', top: m.y * 100 + '%' }} title={m.label} />)}
          </div>
        </Card>
      )}
      {recentNotes.map((n) => <Card icon={Bell} title={n.title}><div class="ov-dim">{n.body}</div></Card>)}
      {interactive && <div class="ov-hint">Bedienmodus – endet automatisch nach 20 s</div>}
    </div>
  );
}

render(<App />, document.getElementById('app'));
void on; void Check;
