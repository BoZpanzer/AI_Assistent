import { render } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
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

/** „vor 40 s“ / „vor 3 min“ */
const ageText = (s) => (s < 60 ? `vor ${Math.max(1, Math.round(s))} s` : `vor ${Math.round(s / 60)} min`);

/** Tarkov: Raid-Zeit, Runthrough, Scav-Abklingzeit (nur wenn etwas läuft). */
function EftRaidCard({ raid, now }) {
  const el = raid.phase === 'inraid' && raid.startedAt ? (now - Date.parse(raid.startedAt)) / 1000 : null;
  const rt = el != null ? Math.max(0, 430 - el) : null;
  const scav = raid.scavReadyAt ? (Date.parse(raid.scavReadyAt) - now) / 1000 : null;
  const f = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (el == null && !(scav > 0) && !['searching', 'found', 'starting'].includes(raid.phase)) return null;
  return (
    <Card icon={Timer} title="Raid">
      {['searching', 'found', 'starting'].includes(raid.phase) && <div class="ov-row"><span class="grow">{({ searching: 'Suche Match …', found: 'Match gefunden', starting: 'Countdown' })[raid.phase]}</span></div>}
      {el != null && <div class="ov-row"><span class="grow">Im Raid</span><b>{f(el)}</b></div>}
      {rt != null && <div class="ov-row"><span class="grow">Runthrough</span><b class={rt === 0 ? 'ok' : ''}>{rt === 0 ? 'vorbei' : f(rt)}</b></div>}
      {scav > 0 && <div class="ov-row"><span class="grow">Scav bereit in</span><b>{f(scav)}</b></div>}
    </Card>
  );
}
function OvScan({ s }) {
  const rub = (v) => (v == null ? '–' : v.toLocaleString('de-DE') + ' ₽');
  return (<>
    <div class="ov-row"><span class="grow ov-ell"><b>{s.name}</b></span></div>
    <div class="ov-row"><span class="grow">Flohmarkt</span><b>{rub(s.flea)}</b></div>
    <div class="ov-row"><span class="grow">{s.trader ? s.trader.name : 'Händler'}</span><b>{rub(s.trader?.price)}</b></div>
    <div class="ov-row"><span class="grow">pro Slot ({s.slots})</span><b>{rub(s.perSlot)}</b></div>
    {s.need ? <div class="ov-dim" style={{ color: '#facc15' }}>Behalten: {[s.need.quest ? `${s.need.quest}× Quest${s.need.questFir ? ' (FIR)' : ''}` : null, s.need.hideout ? `${s.need.hideout}× Hideout` : null].filter(Boolean).join(' · ')}</div> : <div class="ov-dim">Nicht für Quests/Hideout gebraucht.</div>}
  </>);
}

/** Objective-Timer: Spielzeit zwischen den Abfragen (alle 5 s) lokal weiterzählen. */
function Objectives({ live, now }) {
  const drift = Math.max(0, (now - (live.receivedAt || now)) / 1000);
  const fmt = (s) => (s <= 0 ? 'steht' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
  const list = live.objectives.map((o) => ({ ...o, rem: o.remaining - drift })).filter((o) => o.rem > -90).slice(0, 5);
  if (!list.length) return null;
  return (
    <Card icon={Timer} title="Objectives" accent={list.some((o) => o.rem > 0 && o.rem <= 60) ? '#c8aa6e' : undefined}>
      {list.map((o) => (
        <div class="ov-row" title={o.note || ''}><span class="grow ov-ell">{o.label}{o.estimated ? <span class="ov-dim"> ≈</span> : null}</span><b class={o.rem <= 0 ? 'ok' : o.rem <= 60 ? 'warn' : ''}>{fmt(o.rem)}</b></div>
      ))}
      {list.some((o) => o.estimated) && <div class="ov-dim" style={{ fontSize: 10 }}>≈ Standard-Startzeit, je nach Patch anders</div>}
    </Card>
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
  const [raid, setRaid] = useState(null); const [scan, setScan] = useState(null);
  useEffect(() => { rpc('tarkov.raidState').then(setRaid).catch(() => {}); }, []);
  useEvent('eft:raid', setRaid);
  useEvent('eft:scan', (d) => setScan({ ...d, shownAt: Date.now() }));
  useEvent('overlay:interactive', (d) => setInteractive(d.interactive));
  useEvent('voice:transcript', (t) => { if (t.role === 'done') setTimeout(() => setTranscript(null), 6000); else setTranscript((x) => ({ ...(x || {}), [t.role]: t.text })); });
  useEvent('notification', (n) => { setNotes((x) => [{ ...n, at: Date.now() }, ...x].slice(0, 3)); });
  const active = game?.active?.profile;
  const [timers] = useRpc('game.timers', {}, { events: ['game:timers'], initial: [] });
  const [prog] = useRpc('game.progress', { game: active?.id }, { events: ['game:progress'], enabled: !!active, deps: [active?.id] });
  const [mini] = useRpc('game.lastMap', { game: active?.id }, { events: ['game:markers', 'game:position'], enabled: active?.integration === 'tarkov', deps: [active?.id] });
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
      {live && live.objectives?.length > 0 && <Objectives live={live} now={now} />}
      {scan && now - scan.shownAt < 25000 && <Card icon={Sparkles} title="Item-Scan" accent="#facc15" onClose={() => setScan(null)}>{scan.state === 'running' ? <div class="ov-dim">Erkenne Item …</div> : scan.state === 'error' ? <div class="ov-dim">{scan.error}</div> : <OvScan s={scan} />}</Card>}
      {active?.id === 'eft' && raid && <EftRaidCard raid={raid} now={now} />}

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
      {cfg?.overlay?.showMap !== false && mini?.hasImage && !(active?.id === 'eft' && cfg?.overlay?.mapCorner !== false) && (
        <Card icon={MapPin} title={`Karte · ${mini.map}`}>
          <div class="ov-map">
            <img src={`app://jarvis/map-image/${encodeURIComponent(active.id)}/${encodeURIComponent(mini.map)}`} />
            {mini.markers.map((m) => <i class={`ov-pin mk-${m.category}`} style={{ left: m.x * 100 + '%', top: m.y * 100 + '%' }} title={m.label} />)}
            {mini.position && (() => { const age = (now - Date.parse(mini.position.at)) / 1000; if (age > 900) return null; const op = age < 120 ? 1 : age < 300 ? 0.6 : 0.35; return <>
              <svg class="ov-me" width="18" height="18" viewBox="-9 -9 18 18" style={{ opacity: op, left: mini.position.nx * 100 + '%', top: mini.position.ny * 100 + '%', transform: `translate(-50%, -50%) rotate(${mini.position.angle + 90}deg)` }}><path d="M0 -8 L6 6 L0 3 L-6 6 Z" fill="#facc15" stroke="#000" stroke-width="1.2" /></svg>
              <span class="ov-age" style={{ opacity: op, left: mini.position.nx * 100 + '%', top: `calc(${mini.position.ny * 100}% + 11px)` }}>{ageText(age)}</span>
            </>; })()}
          </div>
        </Card>
      )}
      {recentNotes.map((n) => <Card icon={Bell} title={n.title}><div class="ov-dim">{n.body}</div></Card>)}
      {interactive && <div class="ov-hint">Bedienmodus – endet automatisch nach 20 s</div>}
    </div>
  );
}

/** Farben der Exit-Arten (auch auf der großen Karte gleich). */
const EXIT_COLOR = { normal: '#22c55e', flare: '#f97316', coop: '#a855f7', car: '#3b82f6', transit: '#22d3ee' };

/** Eck-Karte (oben links): Raid-Karte, Exits, Transits, Marker, eigene Position; zoomt auf dich, wenn die Position frisch ist. */
function MapCorner() {
  const [d, reload] = useRpc('tarkov.overlayMap', {}, { events: ['game:position', 'game:markers', 'settings:changed'] });
  const [cfg] = useRpc('settings.get', {}, { events: ['settings:changed'] });
  const now = useNow(1000);
  const box = useRef(); const [bs, setBs] = useState({ w: 300, h: 280 });
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!box.current) return; const ro = new ResizeObserver(([e]) => setBs({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(box.current); return () => ro.disconnect(); }, [d?.hasImage]);
  if (!d?.hasImage) return <div class="mc"><div class="mc-head">JARVIS · Karte</div><div class="mc-empty">{d?.map ? 'Für diese Karte gibt es kein Kartenbild.' : 'Warte auf die Raid-Karte …'}</div></div>;
  const pos = d.position;
  const age = pos ? (now - Date.parse(pos.at)) / 1000 : Infinity;
  const fresh = age < 300;
  const zoom = cfg?.overlay?.mapZoom !== false && fresh ? 2.6 : 1;
  // Zoom um die Position, ohne über den Kartenrand hinaus zu schieben
  const cx = zoom > 1 ? Math.min(1 - 0.5 / zoom, Math.max(0.5 / zoom, pos.nx)) : 0.5;
  const cy = zoom > 1 ? Math.min(1 - 0.5 / zoom, Math.max(0.5 / zoom, pos.ny)) : 0.5;
  const tf = `scale(${zoom}) translate(${(0.5 - cx) * 100}%, ${(0.5 - cy) * 100}%)`;
  const inv = 1 / zoom;
  const fl = { pmc: 'PMC', scav: 'Scav', all: 'alle' }[d.faction] || 'PMC';
  return (
    <div class="mc">
      <div class="mc-head"><b>{d.name || d.map}</b><span class="grow" />Exits: {fl}{pos && age < 900 ? <span class="mc-age"> · du {age < 60 ? 'gerade' : `vor ${Math.round(age / 60)} min`}</span> : null}</div>
      <div class="mc-box" ref={box}>
        <div class="mc-inner" style={(() => { const a = (d.width || 1) / (d.height || 1); const w = Math.min(bs.w, bs.h * a); const h = w / a; return { width: w, height: h, left: (bs.w - w) / 2, top: (bs.h - h) / 2, transform: tf }; })()}>
          <img src={`app://jarvis/map-image/eft/${encodeURIComponent(d.map)}`} />
          {d.exits.map((e) => <i class="mc-dot" title={e.name} style={{ left: e.x * 100 + '%', top: e.y * 100 + '%', background: EXIT_COLOR[e.kind], transform: `translate(-50%, -50%) scale(${inv})`, borderRadius: e.faction === 'scav' ? '2px' : '50%' }} />)}
          {d.transits.map((t) => <i class="mc-dot" title={t.name} style={{ left: t.x * 100 + '%', top: t.y * 100 + '%', background: EXIT_COLOR.transit, transform: `translate(-50%, -50%) rotate(45deg) scale(${inv})`, borderRadius: '1px' }} />)}
          {(d.markers || []).map((m) => <i class={`mc-dot mk-${m.category}`} title={m.label} style={{ left: m.x * 100 + '%', top: m.y * 100 + '%', transform: `translate(-50%, -50%) scale(${inv * 0.8})` }} />)}
          {pos && age < 900 && <svg class="mc-me" width="22" height="22" viewBox="-11 -11 22 22" style={{ left: pos.nx * 100 + '%', top: pos.ny * 100 + '%', opacity: age < 120 ? 1 : age < 300 ? 0.6 : 0.35, transform: `translate(-50%, -50%) scale(${inv}) rotate(${pos.angle + 90}deg)` }}><path d="M0 -9 L7 7 L0 3.5 L-7 7 Z" fill="#facc15" stroke="#000" stroke-width="1.4" /></svg>}
        </div>
      </div>
      <div class="mc-legend"><i style={{ background: EXIT_COLOR.normal }} />Exit<i style={{ background: EXIT_COLOR.flare }} />Flare<i style={{ background: EXIT_COLOR.coop }} />Co-op<i style={{ background: EXIT_COLOR.car }} />Auto<i style={{ background: EXIT_COLOR.transit, borderRadius: 1 }} />Transit</div>
    </div>
  );
}

render(new URLSearchParams(location.search).get('view') === 'map' ? <MapCorner /> : <App />, document.getElementById('app'));
void on; void Check;
