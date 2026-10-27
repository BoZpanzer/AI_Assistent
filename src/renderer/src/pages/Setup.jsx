import { useState, useEffect } from 'preact/hooks';
import { CircleCheck, CircleX, KeyRound, Mic, Link2, FolderOpen, Gamepad2, Monitor, Flag, Play, Database, Volume2 } from 'lucide-preact';
import { rpc, useRpc } from '../lib/api.js';
import { useStore, setState, guard, toast, getState } from '../lib/store.js';
import { Field, Toggle, Select, Spinner, StatusDot } from '../components/ui.jsx';
import { BrandMark } from '../components/Shell.jsx';
import { audio, chime } from '../lib/audio.js';
import { upd, LocalAI } from './Settings.jsx';

const STEPS = ['Willkommen & System', 'Lokale KI / Gemini', 'Sprache', 'Google', 'Studium', 'Gaming', 'Desktop', 'Abschluss'];

export function Setup() {
  const show = useStore((s) => s.showSetup);
  const [step, setStep] = useState(0);
  const [ok, setOk] = useState({});
  if (!show) return null;
  const required = {};
  const canNext = !required[step] || ok[step];
  const finish = async () => { await upd({ setupComplete: true }); setState({ showSetup: false }); toast('Einrichtung abgeschlossen. Willkommen, ' + (getState().settings?.nickname || 'Chef') + '!'); };
  const P = [Welcome, Gemini, Voice, Google, Study, Gaming, Desktop, Finish][step];
  return (
    <div class="overlay">
      <div class="panel glow setup">
        <div class="steps">
          <div class="row" style={{ padding: '0 6px 14px' }}><BrandMark /><div><div class="brand-name" style={{ fontSize: 20 }}>JARVIS<b style={{ color: 'var(--cyan)' }}>.</b></div><div class="tiny muted">Einrichtung</div></div></div>
          {STEPS.map((s, i) => <div class={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} onClick={() => i < step && setStep(i)} style={i < step ? { cursor: 'pointer' } : undefined}><span class="n">{i < step ? '✓' : i + 1}</span>{s}{[1, 2, 3, 4, 5].includes(i) && <span class="tiny muted" style={{ marginLeft: 'auto' }}>optional</span>}</div>)}
          <span class="grow" />
          <button class="btn xs ghost" onClick={() => setState({ showSetup: false })}>Später fortsetzen</button>
        </div>
        <div class="pane">
          <div class="pane-body"><P done={(v = true) => setOk({ ...ok, [step]: v })} ok={ok[step]} /></div>
          <div class="pane-foot">
            {step > 0 && <button class="btn sm ghost" onClick={() => setStep(step - 1)}>Zurück</button>}
            <span class="grow" />
            {[1, 2, 3, 4, 5].includes(step) && <button class="btn sm ghost" onClick={() => setStep(step + 1)}>Überspringen</button>}
            {step < STEPS.length - 1 ? <button class="btn sm primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Weiter</button> : <button class="btn sm primary" onClick={finish}><Flag size={14} />Einrichtung abschließen</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

const H = ({ icon: I, t, s }) => <div class="row" style={{ marginBottom: 6 }}><I size={30} style={{ color: 'var(--cyan)' }} /><div><h2 style={{ margin: 0 }}>{t}</h2><div class="muted small">{s}</div></div></div>;
const Line = ({ ok, children, warn }) => <div class="check-line">{ok ? <CircleCheck size={16} class="ok" /> : warn ? <StatusDot state="warn" /> : <CircleX size={16} class="err" />}<span>{children}</span></div>;

function Welcome({ done }) {
  const [t, setT] = useState(null);
  const [legacy, reload] = useRpc('system.legacy', {}, { initial: [] });
  const [info] = useRpc('app.info', {}, {});
  useEffect(() => { rpc('system.selfTest').then((r) => { setT(r); done(true); }); }, []);
  const g = (n) => t?.find((x) => x.name.startsWith(n));
  return (
    <>
      <H icon={Monitor} t="Willkommen bei JARVIS" s="Dein persönlicher KI-Assistent für Windows – einmal einrichten, dann einfach ansprechen." />
      <div class="hud-label mt">Systemprüfung</div>
      {!t ? <Spinner /> : <>
        <Line ok={g('Datenbank')?.ok}>Datenbank & Schreibrechte ({g('Datenbank')?.detail})</Line>
        <Line ok={g('Sichere')?.ok}>Sichere Schlüsselablage – {g('Sichere')?.detail}</Line>
        <Line ok={g('Dokument')?.ok}>Isolierter Dokument-Parser</Line>
        <Line ok>Datenverzeichnis: <span class="selectable small muted">{info?.dataDir}</span> (bleibt bei Updates/Deinstallation erhalten)</Line>
      </>}
      <div class="hud-label mt">Bestehende Daten übernehmen</div>
      {!legacy.length ? <div class="small muted">Keine frühere JARVIS-Installation gefunden.</div> : legacy.map((l) => (
        <div class="row"><Database size={16} /><span class="grow small">{l.file}</span>{l.imported ? <span class="ok small">importiert</span> : <button class="btn xs" onClick={async () => { await guard(() => rpc('system.importLegacy', { file: l.file })); reload(); }}>Importieren</button>}</div>
      ))}
    </>
  );
}

function Gemini({ done, ok }) {
  const settings = useStore((s) => s.settings);
  const secrets = useStore((s) => s.secrets);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const test = async (k) => {
    setBusy(true);
    try { const x = await rpc('gemini.test', { apiKey: k }); setR(x); if (x.ok) { done(true); setState({ secrets: await rpc('secrets.status') }); } } catch (e) { setR({ ok: false, error: String(e.message) }); }
    setBusy(false);
  };
  useEffect(() => { if (secrets['gemini.api_key'] && !ok) test(''); }, []);
  return (
    <>
      <LocalAI s={settings} />
      <H icon={KeyRound} t="Gemini optional verbinden" s="Für nicht private Nachrichten (Wissen, Uni, Gaming). Private Inhalte erkennt JARVIS selbst und verarbeitet sie mit dem lokalen Modell." />
      <div class="small muted">Schlüssel erstellen: <a onClick={() => rpc('shell.openExternal', { url: 'https://aistudio.google.com/app/apikey' })}>aistudio.google.com → API-Schlüssel</a>. Der Schlüssel wird mit Windows-DPAPI verschlüsselt gespeichert und verlässt JARVIS nur in Richtung Google.</div>
      <div class="row mt"><input class="inp grow" type="password" placeholder={secrets['gemini.api_key'] ? 'gespeichert – neu eingeben zum Ersetzen' : 'AIza…'} value={key} onInput={(e) => setKey(e.currentTarget.value)} /><button class="btn sm primary" disabled={busy || (!key && !secrets['gemini.api_key'])} onClick={() => test(key)}>{busy ? <Spinner /> : 'Verbindung testen'}</button></div>
      {r && !r.ok && <div class="notice warn">{r.error}</div>}
      {r?.ok && <>
        <Line ok>Verbindung erfolgreich – {r.count} Modelle für deinen Schlüssel verfügbar</Line>
        <div class="hud-label mt">Modellprüfung (über die offizielle API)</div>
        {Object.entries(r.chosen).map(([k, v]) => <div class="small"><span class="muted" style={{ display: 'inline-block', width: 160 }}>{({ fast: 'Schnelle Antworten', reasoning: 'Reasoning', research: 'Webrecherche', vision: 'Multimodal', embedding: 'Embeddings' })[k]}</span>{v || <span class="warn">keins gefunden</span>}</div>)}
      </>}
    </>
  );
}

function Voice({ done }) {
  const s = useStore((x) => x.settings);
  const [devs, setDevs] = useState({ in: [], out: [] });
  const [level, setLevel] = useState(null);
  const [heard, setHeard] = useState(false);
  const refresh = () => navigator.mediaDevices.enumerateDevices().then((d) => setDevs({ in: d.filter((x) => x.kind === 'audioinput'), out: d.filter((x) => x.kind === 'audiooutput') }));
  useEffect(() => { refresh(); done(true); }, []);
  const test = async () => {
    try { setLevel(0); let max = 0; const stop = await audio.meter((l) => { setLevel(l); max = Math.max(max, l); }, s.voice.inputDeviceId); setTimeout(() => { stop(); setLevel(null); setHeard(max > 0.15); refresh(); if (max <= 0.15) toast('Kaum Pegel – richtiges Mikrofon gewählt?', 'error'); }, 4000); } catch (e) { setLevel(null); toast('Kein Mikrofonzugriff: ' + e.message, 'error'); }
  };
  return (
    <>
      <H icon={Mic} t="Sprache" s="Lokaler Mikrofontest und Wake-Word. Cloud-Sprachchat ist zum Schutz privater Inhalte gesperrt." />
      <Field label="Mikrofon" wide><Select value={s.voice.inputDeviceId} onChange={(v) => upd({ voice: { inputDeviceId: v } })} options={[{ value: 'default', label: 'Windows-Standard' }, ...devs.in.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || 'Mikrofon' }))]} /></Field>
      <Field label="Lautsprecher" wide><Select value={s.voice.outputDeviceId} onChange={(v) => upd({ voice: { outputDeviceId: v } })} options={[{ value: 'default', label: 'Windows-Standard' }, ...devs.out.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || 'Ausgabe' }))]} /></Field>
      <div class="row"><button class="btn sm" onClick={test} disabled={level !== null}><Mic size={14} />Testaufnahme (4 s sprechen)</button>{level !== null && <div class="meter grow"><i style={{ width: `${level * 100}%` }} /></div>}{heard && <span class="ok small">Mikrofon funktioniert</span>}</div>
      <div class="row"><button class="btn sm" onClick={() => chime(0.4)}><Volume2 size={14} />Tonausgabe prüfen</button><span class="small muted">Du solltest einen kurzen Signalton hören.</span></div>
      <Field label="„Hey Jarvis“ aktivieren (lokale Erkennung, auch im Tray)" wide><Toggle checked={s.voice.wakeWord} onChange={(v) => upd({ voice: { wakeWord: v } })} /></Field>
      <div class="notice small">Lokale Spracheingabe ist noch nicht eingerichtet. Nutze für private Anfragen den Textchat; die Testaufnahme bleibt auf diesem PC.</div>
    </>
  );
}

function Google({ done }) {
  const s = useStore((x) => x.settings);
  const [cid, setCid] = useState(s.google.clientId);
  const [secInfo, setSecInfo] = useState(null);
  const secretSaved = useStore((x) => x.secrets)?.['google.client_secret'];
  const [sec, setSec] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [testDone, setTestDone] = useState(false);
  const connect = async () => {
    setBusy(true);
    try { const r = await rpc('google.connect', { clientId: cid, clientSecret: sec }); setRes(r); done(true); setState({ google: await rpc('calendar.status') }); } catch (e) { setRes({ error: String(e.message).replace(/^Error invoking remote method 'rpc': (Error: )?/, '') }); }
    setBusy(false);
  };
  return (
    <>
      <H icon={Link2} t="Google Kalender" s="Vorhandene Google-Termine lesen (optional). Neue und geänderte Termine bleiben lokal." />
      <ol class="small" style={{ color: 'var(--text-2)', lineHeight: 1.6, margin: 0, paddingLeft: 18 }}>
        <li>console.cloud.google.com → Projekt anlegen → „Google Calendar API“ aktivieren.</li>
        <li>Google Auth Platform → Jetzt starten (Zielgruppe <b>Extern</b>) → unter <b>Zielgruppe</b> dich als Testnutzer eintragen.</li>
        <li>Google Auth Platform → <b>Clients</b> → Client erstellen → Typ <b>Desktop-App</b> → JSON herunterladen.</li>
        <li>Danach unter <b>Zielgruppe → App veröffentlichen</b>, sonst musst du dich alle 7 Tage neu anmelden.</li>
      </ol>
      <div class="row mt"><button class="btn sm" onClick={async () => { const r = await guard(() => rpc('google.importClientJson')); if (r) { setCid(r.clientId); setSecInfo(r); setState({ secrets: await rpc('secrets.status') }); } }}>Client-JSON laden</button><span class="small muted">oder manuell:</span></div>
      <Field label="Client-ID" wide><input class="inp" value={cid} onInput={(e) => setCid(e.currentTarget.value)} /></Field>
      <Field label="Client-Secret" hint={secretSaved ? 'Gespeichert (verschlüsselt). Nur ausfüllen, um es zu ersetzen.' : 'Steht in der JSON-Datei oder in der Google Console unter Clients → „Secret hinzufügen“'} wide><input class="inp" type="password" value={sec} onInput={(e) => setSec(e.currentTarget.value)} placeholder={secretSaved ? '•••••••• gespeichert' : 'GOCSPX-…'} /></Field>
          {secInfo && !secInfo.hasSecret && !secretSaved && <div class="notice warn small">Die JSON-Datei enthält kein Client-Secret – Google zeigt es nur direkt beim Erstellen. Öffne in der Google Console <b>Google Auth Platform → Clients → deinen Client → „Secret hinzufügen“</b>, kopiere das neue Secret und füge es hier ein.</div>}
          {secInfo?.type === 'web' && <div class="notice warn small">Das ist ein Client vom Typ „Webanwendung“. Bitte einen Client vom Typ <b>Desktop-App</b> anlegen, sonst lehnt Google die Anmeldung ab.</div>}
      <button class="btn sm primary" disabled={!cid || busy} onClick={connect}>{busy ? <Spinner /> : <Link2 size={14} />}Im Browser anmelden</button>
      {res?.error && <div class="notice warn">{res.error}</div>}
      {res?.account !== undefined && !res.error && <>
        <Line ok>Verbunden als {res.account || 'Google-Konto'}</Line>
        <Line ok={res.scopes?.some((x) => x.includes('calendar'))}>Berechtigung: Google Kalender</Line>
        <div class="small muted">Kalender: {(res.calendars || []).filter((c) => c.id !== 'local').map((c) => c.name).join(', ')}</div>
        <button class="btn sm" disabled={testDone} onClick={async () => { const st = new Date(Date.now() + 86400000); st.setHours(12, 0, 0, 0); const e = await guard(() => rpc('calendar.create', { title: 'JARVIS Testtermin', start: st.toISOString(), description: 'Kann gelöscht werden.' })); if (e) { setTestDone(true); toast('Testtermin morgen 12:00 angelegt – prüf dein Smartphone.'); } }}>Optional: Testtermin anlegen</button>
      </>}
    </>
  );
}

function Study({ done }) {
  const s = useStore((x) => x.settings);
  const [check, setCheck] = useState(null);
  const [t, setT] = useState(null);
  const pick = async () => {
    const f = await rpc('dialog.pickFolder'); if (!f) return;
    const c = await rpc('study.check', { folder: f }); setCheck({ ...c, folder: f });
    if (c.ok) { await upd({ study: { folder: f, source: 'folder', enabled: true } }); done(true); setT('loading'); setT(await rpc('study.testIndex', { folder: f }).catch((e) => ({ ok: false, error: e.message }))); }
  };
  return (
    <>
      <H icon={FolderOpen} t="Studium" s="Goodnotes → Google Drive → JARVIS: dein Drive-Ordner „Goodnotes“ wird nur lesend abgeglichen." />
      <div class="row"><button class="btn sm primary" onClick={async () => { const r = await guard(() => rpc('drive.connect')); if (r) { done(true); toast('Google Drive verbunden – „' + (r.folder || 'Goodnotes') + '“ wird abgeglichen'); } }}>Google Drive „Goodnotes“ verbinden</button><span class="small muted">(braucht den Google-Client aus dem Kalender-Schritt)</span></div>
      <div class="small muted mt">Oder einen Ordner auf diesem PC wählen:</div>
      <div class="row"><input class="inp grow" readOnly value={check?.folder || s.study.folder} placeholder="z. B. C:\Users\…\OneDrive\Goodnotes" /><button class="btn sm" onClick={pick}><FolderOpen size={14} />Ordner wählen</button></div>
      {check && (check.ok ? <Line ok>Zugriff OK – {check.files} unterstützte Dateien gefunden</Line> : <Line ok={false}>{check.error}</Line>)}
      {t === 'loading' && <Spinner />}
      {t && t !== 'loading' && (t.ok ? <Line ok>Testdokument gelesen: {t.file} ({t.pages} Seiten, {t.chars} Zeichen{t.chars < 50 ? ' – vermutlich Handschrift, wird bei Bedarf multimodal transkribiert' : ''})</Line> : <Line ok={false}>{t.error}</Line>)}
      <div class="small muted">Die vollständige Indexierung läuft danach im Hintergrund – nur geänderte Dateien und Seiten werden neu verarbeitet.</div>
    </>
  );
}

function Gaming({ done }) {
  const s = useStore((x) => x.settings);
  const [installed, , st] = useRpc('game.installed', {}, { initial: [] });
  useEffect(() => done(true), []);
  return (
    <>
      <H icon={Gamepad2} t="Gaming" s="Spiele erkennen und Integrationen einrichten." />
      <div class="hud-label">Gefundene Spiele</div>
      {st.loading ? <Spinner /> : <div class="row wrap gap-s">{installed.length ? installed.map((p) => <span class="chip static">{p.name}{p.integration !== 'generic' ? ' ★' : ''}</span>) : <span class="small muted">Keine erkannt (Steam-Bibliothek/Riot/Battlestate geprüft).</span>}</div>}
      <div class="small muted">★ Spezialintegration: Escape from Tarkov (Karte, Quests, Keys), League of Legends (Statistik, Live, Coaching), Rise of Kingdoms (Timer, Planung). Alle anderen Spiele bekommen die universelle Oberfläche.</div>
      <Field label="Spielerkennung über laufende Prozesse" wide><Toggle checked={s.gaming.detection} onChange={(v) => upd({ gaming: { detection: v } })} /></Field>
      <Field label="Ressourcen beim Spielen reduzieren" wide><Toggle checked={s.gaming.reduceWhileGaming} onChange={(v) => upd({ gaming: { reduceWhileGaming: v } })} /></Field>
      <div class="notice small">League of Legends braucht keinen API-Schlüssel: Statistik und Rang liest JARVIS direkt aus dem laufenden League-Client.</div>
    </>
  );
}

function Desktop({ done }) {
  const s = useStore((x) => x.settings);
  useEffect(() => done(true), []);
  return (
    <>
      <H icon={Monitor} t="Desktop" s="Wie sich JARVIS auf deinem PC verhält." />
      <Field label="Mit Windows starten (im Tray)" wide><Toggle checked={s.autostart} onChange={(v) => upd({ autostart: v })} /></Field>
      <Field label="Beim Schließen im System-Tray weiterlaufen" wide><Toggle checked={s.closeToTray} onChange={(v) => upd({ closeToTray: v })} /></Field>
      <Field label="Benachrichtigungen" wide><Toggle checked={s.notifications} onChange={(v) => upd({ notifications: v })} /></Field>
      <Field label="Startsound" wide><Select value={s.startSound.mode} onChange={(v) => upd({ startSound: { mode: v } })} options={[{ value: 'off', label: 'Deaktiviert' }, { value: 'immediate', label: 'Sofort' }, { value: 'delayed', label: 'Verzögert' }]} /></Field>
      <Field label="Animationen" wide><Select value={s.animations} onChange={(v) => upd({ animations: v })} options={[{ value: 'full', label: 'Standard' }, { value: 'reduced', label: 'Reduziert' }, { value: 'off', label: 'Aus' }]} /></Field>
      <Field label="Täglich nach Updates suchen" wide><Toggle checked={s.updateCheck} onChange={(v) => upd({ updateCheck: v })} /></Field>
    </>
  );
}

function Finish() {
  const [r, setR] = useState(null);
  useEffect(() => { rpc('system.selfTest').then(setR); }, []);
  return (
    <>
      <H icon={Flag} t="Fast geschafft" s="Übersicht aller Verbindungen" />
      {!r ? <Spinner /> : r.map((x) => <Line ok={x.ok} warn={!x.ok && /optional/.test(String(x.detail))}>{x.name}: {String(x.detail)}</Line>)}
      <div class="notice mt">Probier nach dem Abschluss: <b>„Jarvis, was steht heute an?“</b> – per Text unten oder per Mikrofon-Button / „Hey Jarvis“. Alle Einstellungen findest du später unter <b>Einstellungen</b>.</div>
    </>
  );
}

