import { useState, useEffect } from 'preact/hooks';
import { Gamepad2, CircleCheck, X, Search, Plus, Globe, BarChart3, Upload, Timer, ChevronDown, Info, Power, Sparkles } from 'lucide-preact';
import { rpc, useRpc, useEvent } from '../lib/api.js';
import { useStore, setState, guard, toast } from '../lib/store.js';
import { ChatBar } from '../components/Shell.jsx';
import { Empty, ask, Spinner } from '../components/ui.jsx';
import { WIDGETS, SPAN } from './gaming/widgets.jsx';

const GENRE_LABEL = { survival: 'Survival', shooter: 'Shooter', racing: 'Racing', sports: 'Sport', builder: 'Aufbau & Simulation', rpg: 'Rollenspiel', training: 'Aim-Training', casual: 'Casual & Party' };
const fmtHours = (min) => (min >= 60 ? `${(min / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h gespielt` : `${min} Min. gespielt`);
const SOURCE_LABEL = { explicit: 'Aus deiner Aussage erkannt', manual: 'Manuell ausgewählt', process: 'Automatisch erkannt (laufender Prozess)', last: 'Zuletzt bestätigt' };

export function Gaming() {
  const game = useStore((s) => s.game);
  const active = game.active;
  const [viewId, setViewId] = useState(active?.id || null);
  useEffect(() => { if (active?.id) setViewId(active.id); }, [active?.id]);
  const [layout, reloadLayout] = useRpc('game.layout', { id: viewId }, { events: ['game:focus', 'game:profiles'], enabled: !!viewId, deps: [viewId] });
  const [picker, setPicker] = useState(false);
  const discussed = game.discussed;
  const p = layout?.game;
  return (
    <div class="page">
      <div class="page-body scroll-y">
        {!viewId ? <NoGame onPick={(id) => { setViewId(id); }} /> : !p ? <Empty>Lade …</Empty> : (
          <>
            <section class="panel glow game-hero">
              {p.header ? <img class="gheader" src={p.header} alt="" /> : <div class="gicon" style={p.accent ? { boxShadow: `0 0 18px ${p.accent}55` } : undefined}>{initials(p)}</div>}
              <div class="col" style={{ gap: 2, maxWidth: 300, flex: 'none' }}>
                <div class="hud-label">{active?.id === p.id ? 'Aktuelles Spiel' : 'Ansicht'}</div>
                {active?.id === p.id ? <div class="detected"><CircleCheck size={15} />{SOURCE_LABEL[active.source] || 'Aktiv'}</div> : <div class="small muted">Nicht als aktives Spiel gesetzt</div>}
                {p.integration === 'generic' && (p.kit ? <div class="tiny muted" title={p.design?.summary || ''}>{p.designed ? 'Von JARVIS gestaltet · ' : ''}{GENRE_LABEL[p.genre] || 'Spiel'}-Oberfläche{p.wiki ? ` · Wiki: ${p.wiki.label}` : ''}</div> : <div class="tiny muted">Universelle Oberfläche: Recherche, {p.wiki ? 'Wiki, ' : ''}Notizen, Timer, Quellen</div>)}
                {p.playtimeMin > 0 && <div class="tiny" style={{ color: 'var(--text-2)' }}>Steam: {fmtHours(p.playtimeMin)}{p.lastPlayed ? ` · zuletzt ${new Date(p.lastPlayed).toLocaleDateString('de-DE')}` : ''}</div>}
              </div>
              <h2 class="ellipsis" style={{ marginLeft: 18, minWidth: 0, flex: '0 1 auto' }} title={p.name}>{p.name}</h2>
              <span class="grow" />
              {p.integration === 'generic' && <DesignButton p={p} onDone={reloadLayout} />}
              {discussed && discussed.id !== p.id && <span class="chip" title="Wird gerade besprochen – ersetzt nicht das aktive Spiel" onClick={() => setViewId(discussed.id)}>Besprochen: {discussed.profile.name}</span>}
              {active?.id !== p.id && <button class="btn sm" onClick={() => guard(() => rpc('game.setActive', { id: p.id }), `${p.name} ist jetzt aktiv`)}><CircleCheck size={14} />Als aktiv setzen</button>}
              {active?.id === p.id && <button class="btn sm ghost" onClick={() => guard(() => rpc('game.clear'))}><Power size={14} />Nicht mehr aktiv</button>}
              <button class="btn sm" onClick={() => setPicker(true)}><Gamepad2 size={14} />Spiel wechseln<ChevronDown size={14} /></button>
            </section>
            {layout.focus && WIDGETS[layout.focus.type] && (
              <section class="panel glow" style={{ borderColor: 'var(--cyan)' }}>
                <div class="row" style={{ padding: '10px 14px 0' }}><Info size={16} style={{ color: 'var(--cyan)' }} /><span class="hud-label">Kontext aus dem Gespräch · {layout.widgetTitles[layout.focus.type]}</span><span class="grow" /><button class="btn icon xs ghost" onClick={async () => { await rpc('game.clearFocus'); reloadLayout(); }}><X size={14} /></button></div>
                <Widget game={p} w={layout.focus} title={layout.widgetTitles[layout.focus.type]} activeId={active?.id} bare />
              </section>
            )}
            <div class="widgets">
              {layout.widgets.map((w, i) => (
                <div key={`${p.id}:${w.type}:${w.params?.name || i}`} class={SPAN[w.type] || 'w-6'}><Widget game={p} w={w} title={layout.widgetTitles[w.type]} activeId={active?.id} /></div>
              ))}
            </div>
          </>
        )}
      </div>
      <ChatBar placeholder={p ? `Nachricht an JARVIS … (Kontext: ${p.name})` : 'Nachricht an JARVIS … z. B. „Ich spiele gerade ARK“'} actions={[
        { icon: Globe, label: 'Recherche', onClick: () => setState({ page: 'chat', chatDraft: p ? `Recherchiere zu ${p.name}: ` : 'Recherchiere zum Spiel ' }) },
        { icon: BarChart3, label: 'Analyse', onClick: () => setState({ page: 'chat', chatDraft: p?.id === 'league' ? 'Analysiere meine letzten Ranglistenspiele und gib mir 3 Trainingsziele.' : p ? `Analysiere meine Notizen und Timer zu ${p.name} und schlage nächste Schritte vor.` : 'Welche Spiele laufen gerade?' }) },
        { icon: Upload, label: 'Import', onClick: async () => { if (!p) return; const name = await ask('Kartenbild importieren – Name der Karte', 'Hauptkarte'); if (name) guard(() => rpc('game.importMap', { game: p.id, name }), 'Karte importiert'); } },
      ]} />
      {picker && <Picker onClose={() => setPicker(false)} onPick={(id) => { setViewId(id); setPicker(false); }} />}
    </div>
  );
}

function Widget({ game, w, title, activeId, bare }) {
  const C = WIDGETS[w.type];
  if (!C) return null;
  return <C game={game} params={w.params || {}} title={title} activeId={activeId} bare={bare} />;
}

function NoGame({ onPick }) {
  const game = useStore((s) => s.game);
  const [installed] = useRpc('game.installed', {}, { initial: [] });
  const [timers] = useRpc('game.timers', {}, { events: ['game:timers'], initial: [] });
  const [profiles] = useRpc('game.profiles', {}, { initial: [] });
  const fav = useStore((s) => s.settings?.gaming?.favorites || []);
  const quick = [...new Map([...game.running, ...installed, ...profiles.filter((p) => fav.includes(p.id) || ['eft', 'league', 'rok', 'ark', 'eldenring'].includes(p.id))].map((p) => [p.id, p])).values()];
  return (
    <section class="panel glow" style={{ padding: 24 }}>
      <div class="row"><Gamepad2 size={36} style={{ color: 'var(--cyan)' }} /><div><div class="hud-title" style={{ fontSize: 22, color: 'white' }}>Gaming</div><div class="muted">Kein aktives Spiel. Starte ein Spiel, sag „Jarvis, ich spiele gerade …“ oder wähle eins aus.</div></div></div>
      <div class="hud-label mt">Schnellwahl</div>
      <div class="row wrap gap-s mt">{quick.map((p) => <button class="btn sm" onClick={async () => { await rpc('game.setActive', { id: p.id }); onPick(p.id); }}>{p.name}{game.running.some((r) => r.id === p.id) ? ' · läuft' : ''}</button>)}
        <button class="btn sm ghost" onClick={async () => { const n = await ask('Welches Spiel?', ''); if (!n) return; const pr = await rpc('game.resolve', { name: n }); await rpc('game.setActive', { id: pr.id }); onPick(pr.id); }}><Plus size={14} />Anderes Spiel</button></div>
      <SteamLibrary onPick={onPick} />
      {timers.filter((t) => !t.fired).length > 0 && <>
        <div class="hud-label mt">Laufende Timer</div>
        <ul class="bullets mt">{timers.filter((t) => !t.fired).map((t) => <li><span class="grow">{t.gameName}: {t.label}</span><span class="v">{new Date(t.endsAt).toLocaleString('de-DE')}</span></li>)}</ul>
      </>}
    </section>
  );
}

/** Steam-Bibliothek: gespielte/installierte Spiele, Spielzeit, Updates – alles lokal gelesen. */
function SteamLibrary({ onPick }) {
  const [lib, reload, st] = useRpc('steam.library', {}, { events: ['game:profiles'] });
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  if (st.loading && !lib) return <div class="hud-label mt">Steam-Bibliothek wird gelesen …</div>;
  if (!lib?.available) return <div class="tiny muted mt">{lib?.reason || 'Steam nicht gefunden.'}</div>;
  const played = lib.games.filter((g) => g.minutes > 0);
  const shown = all ? lib.games : played;
  const ups = lib.games.filter((g) => g.updateRequired && !g.updating);
  const doImport = async () => { setBusy(true); const r = await guard(() => rpc('steam.import', {})); setBusy(false); if (r) { toast(`${r.created} neue Game-Seiten angelegt${r.updated ? `, ${r.updated} aktualisiert` : ''}`); reload(); } };
  const open = async (g) => { const pr = await rpc('game.resolve', { name: g.name }); if (pr) { await rpc('game.setActive', { id: pr.id }); onPick(pr.id); } };
  return (
    <>
      <div class="row mt"><span class="hud-label grow">Steam-Bibliothek · {played.length} gespielt{lib.games.length > played.length ? ` · ${lib.games.length - played.length} nie gestartet` : ''}</span>
        <button class="btn xs ghost" onClick={() => setAll(!all)}>{all ? 'Nur gespielte' : 'Alle zeigen'}</button>
        <button class="btn xs" disabled={busy} onClick={doImport}>{busy ? 'Lege an …' : 'Game-Seiten anlegen'}</button>
        <button class="btn xs ghost" onClick={() => rpc('steam.open', { action: 'downloads' })}>Steam-Downloads</button>
      </div>
      {ups.length > 0 && <div class="notice warn small mt">Updates verfügbar: {ups.map((g) => g.name).join(', ')} <button class="btn xs" style={{ marginLeft: 8 }} onClick={() => rpc('steam.open', { action: 'downloads' })}>In Steam aktualisieren</button></div>}
      <div class="steam-grid mt">
        {shown.map((g) => (
          <div class="steam-card" title={`${g.name} · ${g.hours} h${g.lastPlayed ? ' · zuletzt ' + new Date(g.lastPlayed).toLocaleDateString('de-DE') : ''}`} onClick={() => open(g)}>
            <img src={g.header} loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            <div class="row" style={{ gap: 6 }}><span class="small grow ellipsis">{g.name}</span>{g.updateRequired && <span class="chip static warn" title="Update verfügbar">Update</span>}</div>
            <div class="tiny muted">{g.minutes ? (g.hours >= 1 ? `${g.hours} h` : `${g.minutes} min`) : 'nie gespielt'}{g.installed ? ' · installiert' : ''}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function Picker({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [profiles] = useRpc('game.profiles', {}, { initial: [], events: ['game:profiles'] });
  const list = [...profiles].sort((a, b) => (b.playtimeMin || 0) - (a.playtimeMin || 0)).filter((p) => !q || (p.name + ' ' + (p.aliases || []).join(' ')).toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="panel glow modal">
        <div class="row"><h2 class="grow">Spiel wählen</h2><button class="btn icon xs ghost" onClick={onClose}><X size={16} /></button></div>
        <div style={{ position: 'relative' }} class="mt"><Search size={15} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-3)' }} /><input class="inp" style={{ paddingLeft: 32 }} placeholder="Suchen oder neuen Namen eingeben" value={q} onInput={(e) => setQ(e.currentTarget.value)} autofocus /></div>
        <div class="col mt scroll" style={{ maxHeight: '50vh', gap: 6 }}>
          {list.map((p) => <div class="result-row" onClick={() => onPick(p.id)}><Gamepad2 size={16} /><span class="grow">{p.name}</span><span class="tiny muted">{p.playtimeMin ? `${Math.round(p.playtimeMin / 6) / 10} h · ` : ''}{p.integration === 'generic' ? 'universell' : 'Spezialintegration'}</span></div>)}
          {q && !list.length && <div class="result-row" onClick={async () => { const pr = await rpc('game.resolve', { name: q }); onPick(pr.id); }}><Plus size={16} /><span>„{q}“ als neues Spiel (universelle Oberfläche)</span></div>}
        </div>
      </div>
    </div>
  );
}

function initials(p) {
  if (p.short && p.short.length <= 3) return p.short.toUpperCase();
  const w = p.name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((x) => x && !['of', 'the', 'from', 'der', 'die', 'das'].includes(x.toLowerCase()));
  return (w.length > 1 ? w[0][0] + w[1][0] : p.name.slice(0, 2)).toUpperCase();
}

/** „Seite gestalten“: JARVIS recherchiert das Spiel und baut die Seite aus dem Baukasten (läuft auch automatisch beim ersten Spielen). */
function DesignButton({ p, onDone }) {
  const [st, reload] = useRpc('game.designState', { id: p.id }, { deps: [p.id] });
  const [busy, setBusy] = useState(false);
  useEvent('game:design', (d) => { if (d.game !== p.id) return; setBusy(d.state === 'running'); if (d.state === 'done') { toast(`Seite für ${p.name} gestaltet`); onDone?.(); } if (d.state === 'error') toast(d.error, 'error', 7000); reload(); });
  const running = busy || st?.running;
  const go = async () => { setBusy(true); await guard(() => rpc('game.design', { id: p.id })); setBusy(false); reload(); onDone?.(); };
  return (
    <div class="row gap-s">
      <button class="btn sm" disabled={running} title="JARVIS recherchiert das Spiel (Google-Suche) und stellt die Seite aus geprüften Bausteinen zusammen" onClick={go}>{running ? <Spinner size={14} /> : <Sparkles size={14} />}{running ? 'Gestalte Seite …' : p.designed ? 'Neu gestalten' : 'Seite gestalten'}</button>
      {p.design?.sources?.length > 0 && <span class="tiny muted" title={p.design.sources.map((x) => x.title).join('\n')}>{p.design.sources.length} Quellen</span>}
    </div>
  );
}
