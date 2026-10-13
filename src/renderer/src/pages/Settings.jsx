import { useState, useEffect } from 'preact/hooks';
import { Settings as Gear, GraduationCap, Globe, Sparkles, CalendarDays, BookOpen, Gamepad2, Monitor, ShieldCheck, Save, Link2, Upload, KeyRound, CircleCheck, CircleX, Database, RefreshCw, Download, FolderOpen, Bell, Mic, Play, Wrench, Rocket, TriangleAlert, Info } from 'lucide-preact';
import { rpc, useRpc } from '../lib/api.js';
import { useStore, setState, guard, toast } from '../lib/store.js';
import { ChatBar, UpdateModal } from '../components/Shell.jsx';
import { Panel, Field, Toggle, Select, StatusDot, Modal, Spinner, ask, FixText } from '../components/ui.jsx';
import { audio, playStartSound } from '../lib/audio.js';
import { ago } from '../lib/format.js';

const VOICES = ['Charon', 'Puck', 'Kore', 'Fenrir', 'Aoede', 'Orus', 'Leda', 'Zephyr', 'Enceladus', 'Iapetus', 'Algieba', 'Despina'];
export const upd = (patch) => guard(() => rpc('settings.update', patch));

export function Settings() {
  const s = useStore((x) => x.settings);
  const secrets = useStore((x) => x.secrets);
  const [selftest, setSelftest] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  if (!s) return null;
  return (
    <div class="page">
      <div class="page-body scroll-y">
        <div class="settings-grid">
          <General s={s} />
          <Speech s={s} />
          <Ai s={s} secrets={secrets} />
          <Google s={s} />
          <StudyCard s={s} />
          <CampusDualCard s={s} />
          <GamingCard s={s} secrets={secrets} />
          <OverlayCard s={s} />
          <Desktop s={s} />
          <Security s={s} />
          <Proactive s={s} />
          <Data />
        </div>
      </div>
      <ChatBar actions={[
        { icon: Save, label: 'Speichern', onClick: () => toast('Alle Einstellungen sind gespeichert (Änderungen werden sofort übernommen).') },
        { icon: Link2, label: 'Systemcheck', onClick: async () => { setSelftest('loading'); setSelftest(await rpc('system.diagnostics').catch((e) => [{ name: 'Systemcheck', status: 'error', detail: e.message }])); } },
        { icon: Upload, label: 'Import', onClick: () => setImportOpen(true) },
      ]} />
      {selftest && <SelfTest r={selftest} onClose={() => setSelftest(null)} onRerun={async () => { setSelftest('loading'); setSelftest(await rpc('system.diagnostics').catch((e) => [{ name: 'Systemcheck', status: 'error', detail: e.message }])); }} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function General({ s }) {
  return (
    <Panel icon={Gear} title="Allgemein" sub="Grundlegende Einstellungen für JARVIS">
      <Field label="Design"><Select value="jarvis" onChange={() => {}} options={[{ value: 'jarvis', label: 'JARVIS (Standard)' }]} /></Field>
      <Field label="Startseite"><Select value={s.startPage} onChange={(v) => upd({ startPage: v })} options={[['dashboard', 'Dashboard'], ['chat', 'Assistent / Chat'], ['tasks', 'Aufgaben'], ['calendar', 'Kalender'], ['study', 'Studium'], ['gaming', 'Gaming'], ['brain', 'Brain']].map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Dein Name"><input class="inp" value={s.userName} onChange={(e) => upd({ userName: e.currentTarget.value })} placeholder="optional" /></Field>
      <Field label="Ansprache"><input class="inp" value={s.nickname} onChange={(e) => upd({ nickname: e.currentTarget.value || 'Chef' })} /></Field>
      <Field label="Beim Systemstart automatisch starten"><Toggle checked={s.autostart} onChange={(v) => upd({ autostart: v })} /></Field>
      <Field label="Minimiert in Taskleiste starten"><Toggle checked={s.startMinimized} onChange={(v) => upd({ startMinimized: v })} /></Field>
      <Field label="Benachrichtigungen anzeigen"><Toggle checked={s.notifications} onChange={(v) => upd({ notifications: v })} /></Field>
    </Panel>
  );
}

function Speech({ s }) {
  const v = s.voice;
  const [devs, setDevs] = useState({ in: [], out: [] });
  const [level, setLevel] = useState(null);
  useEffect(() => { navigator.mediaDevices.enumerateDevices().then((d) => setDevs({ in: d.filter((x) => x.kind === 'audioinput'), out: d.filter((x) => x.kind === 'audiooutput') })).catch(() => {}); }, [level !== null]);
  const test = async () => {
    if (level !== null) return;
    setLevel(0);
    try { const stop = await audio.meter(setLevel, v.inputDeviceId); setTimeout(() => { stop(); setLevel(null); }, 5000); } catch (e) { toast('Mikrofon nicht verfügbar: ' + e.message, 'error'); setLevel(null); }
  };
  return (
    <Panel icon={Globe} title="Sprache" sub="Spracheingabe und Sprachausgabe (Gemini Live)">
      <Field label="Oberflächensprache"><Select value="de-DE" onChange={() => {}} options={[{ value: 'de-DE', label: 'Deutsch (DE)' }]} /></Field>
      <Field label="Stimme (Gemini Live)"><Select value={v.voiceName} onChange={(x) => upd({ voice: { voiceName: x } })} options={VOICES} /></Field>
      <Field label="Mikrofon"><Select value={v.inputDeviceId} onChange={(x) => upd({ voice: { inputDeviceId: x } })} options={[{ value: 'default', label: 'Standard' }, ...devs.in.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || 'Mikrofon' }))]} /></Field>
      <Field label="Lautsprecher"><Select value={v.outputDeviceId} onChange={(x) => upd({ voice: { outputDeviceId: x } })} options={[{ value: 'default', label: 'Standard' }, ...devs.out.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || 'Ausgabe' }))]} /></Field>
      <Field label="Mikrofon testen">{level === null ? <button class="btn xs" onClick={test}><Mic size={12} />Pegel testen</button> : <div class="meter" style={{ width: '100%' }}><i style={{ width: `${level * 100}%` }} /></div>}</Field>
      <Field label="„Hey Jarvis“ (lokal, offline)" hint="Mikrofon bleibt lokal – nichts wird übertragen, bis das Wake-Word erkannt wird"><Toggle checked={v.wakeWord} onChange={(x) => upd({ voice: { wakeWord: x } })} /></Field>
      {v.wakeWord && <Field label="Empfindlichkeit"><input class="range" type="range" min="0.2" max="0.9" step="0.05" value={v.wakeSensitivity} onChange={(e) => upd({ voice: { wakeSensitivity: Number(e.currentTarget.value) } })} /></Field>}
      <Field label="Push-to-Talk-Taste (global)"><input class="inp" value={v.pushToTalkKey} onChange={(e) => upd({ voice: { pushToTalkKey: e.currentTarget.value } })} /></Field>
      <Field label="Unterbrechen erlauben (Barge-in)"><Toggle checked={v.bargeIn} onChange={(x) => upd({ voice: { bargeIn: x } })} /></Field>
      <Field label="Textantworten vorlesen (Windows-Stimme)"><Toggle checked={v.speakReplies} onChange={(x) => upd({ voice: { speakReplies: x } })} /></Field>
      <Field label="Extended Thinking (falls verfügbar)" hint="gemini-3.8-live-extended-thinking: länger nachdenken, Werkzeuge asynchron"><Toggle checked={v.extendedThinking} onChange={(x) => upd({ voice: { extendedThinking: x } })} /></Field>
      <Field label="Verbindung trennen nach Stille"><Select value={String(v.idleDisconnectSeconds)} onChange={(x) => upd({ voice: { idleDisconnectSeconds: Number(x) } })} options={[['30', '30 Sekunden'], ['90', '90 Sekunden'], ['180', '3 Minuten'], ['600', '10 Minuten']].map(([value, label]) => ({ value, label }))} /></Field>
    </Panel>
  );
}

function Ai({ s, secrets }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [usage] = useRpc('gemini.usage', {}, {});
  const models = s.availableModels || [];
  const test = async (k) => {
    setBusy(true);
    const r = await guard(() => rpc('gemini.test', { apiKey: k }));
    setBusy(false); setRes(r);
    if (r?.ok) { setState({ secrets: await rpc('secrets.status') }); setKey(''); toast(`Verbunden – ${r.count} Modelle verfügbar`); }
  };
  const opt = (role) => [{ value: '', label: 'Automatisch' }, ...models.filter((m) => role === 'embedding' ? /embed/.test(m) : role === 'live' ? /live|native-audio/.test(m) : !/embed|tts|image|live|veo|lyria|imagen|aqa/.test(m)).map((m) => ({ value: m, label: m }))];
  return (
    <Panel icon={Sparkles} title="Gemini / KI" sub="KI-Modelle und Analyse-Tools">
      <Field label={<span><KeyRound size={12} /> API-Schlüssel</span>} hint={secrets['gemini.api_key'] ? 'gespeichert (verschlüsselt mit Windows-DPAPI)' : 'aistudio.google.com → API-Schlüssel'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" type="password" placeholder={secrets['gemini.api_key'] ? '••••••••••••' : 'AIza…'} value={key} onInput={(e) => setKey(e.currentTarget.value)} /><button class="btn xs" disabled={busy} onClick={() => test(key)}>{busy ? <Spinner size={12} /> : 'Prüfen'}</button></div>
      </Field>
      {res && !res.ok && <div class="notice warn">{res.error}</div>}
      {[['fast', 'Modell: schnelle Antworten'], ['reasoning', 'Modell: Reasoning'], ['research', 'Modell: Webrecherche'], ['vision', 'Modell: Multimodal/Seiten'], ['live', 'Modell: Echtzeit-Sprache'], ['embedding', 'Modell: Embeddings']].map(([role, label]) => (
        <Field label={label}><Select value={s.models[role]} onChange={(v) => upd({ models: { [role]: v } })} options={opt(role)} /></Field>
      ))}
      <Field label="Temperatur"><Select value={String(s.temperature)} onChange={(v) => upd({ temperature: Number(v) })} options={[['0.3', 'Präzise (0.3)'], ['0.7', 'Ausgewogen (0.7)'], ['1', 'Kreativ (1.0)']].map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Websuche für aktuelle Informationen"><Toggle checked={s.webSearch} onChange={(v) => upd({ webSearch: v })} /></Field>
      <Field label="Wichtiges automatisch merken (Brain)" hint="Sensibles nur auf ausdrücklichen Wunsch"><Toggle checked={s.autoMemory} onChange={(v) => upd({ autoMemory: v })} /></Field>
      <Field label="Geburtstage aus dem Brain in den Kalender" hint="ganztägig, jährlich – auch nach Google"><Toggle checked={s.birthdaysToCalendar !== false} onChange={(v) => upd({ birthdaysToCalendar: v })} /></Field>
      <div class="row mt"><button class="btn xs" disabled={busy || !secrets['gemini.api_key']} onClick={() => test('')}><RefreshCw size={12} />Modelle neu prüfen</button><span class="tiny muted grow">Diese Sitzung: {usage?.requests || 0} Anfragen · {Math.round(((usage?.inputTokens || 0) + (usage?.outputTokens || 0)) / 1000)}k Tokens</span></div>
      <div class="tiny muted mt">Hinweis: Ein Google-AI-Abo (Gemini App) ist nicht automatisch API-Kontingent – Limits gelten pro API-Schlüssel.</div>
    </Panel>
  );
}

function Google({ s }) {
  const [status] = useRpc('calendar.status', {}, { events: ['calendar:sync', 'settings:changed'] });
  const [cals] = useRpc('calendar.calendars', {}, { events: ['calendar:changed'], initial: [] });
  const [cid, setCid] = useState(s.google.clientId);
  const [secInfo, setSecInfo] = useState(null);
  const secretSaved = useStore((x) => x.secrets)?.['google.client_secret'];
  const [sec, setSec] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const connect = async () => {
    setBusy(true);
    setErr(null);
    let r = null;
    try { r = await rpc('google.connect', { clientId: cid, clientSecret: sec }); } catch (e) { setErr(String(e.message).replace(/^Error invoking remote method 'rpc': (Error: )?/, '')); }
    setBusy(false);
    if (r) { toast('Google verbunden: ' + (r.account || 'OK')); setSec(''); setState({ google: await rpc('calendar.status'), secrets: await rpc('secrets.status') }); }
  };
  const row = (Icon, name, ok, note) => <div class="conn-row"><span class="gico"><Icon size={18} /></span><span>{name}</span><span class="st"><StatusDot state={ok ? 'ok' : 'off'} /><span class={ok ? 'ok' : 'muted'}>{ok ? 'Verbunden' : note || 'Nicht verbunden'}</span></span></div>;
  return (
    <Panel icon={CalendarDays} title="Kalender & Google" sub="Verbindungen und Synchronisation">
      {row(Globe, `Google-Konto${status?.account ? ' · ' + status.account : ''}`, status?.connected)}
      {row(CalendarDays, 'Google Kalender', status?.connected && cals.some((c) => c.id !== 'local'))}
      {!status?.connected ? (
        <>
          <div class="tiny muted mt">Einmalig: In der Google Cloud Console einen OAuth-Client vom Typ „Desktop-App“ anlegen und die Calendar API aktivieren (Anleitung in der Dokumentation).</div>
          <Field label="OAuth-Client-ID" wide><input class="inp" value={cid} onInput={(e) => setCid(e.currentTarget.value)} placeholder="….apps.googleusercontent.com" /></Field>
          <Field label="Client-Secret" hint={secretSaved ? 'Gespeichert (verschlüsselt). Nur ausfüllen, um es zu ersetzen.' : 'Steht in der JSON-Datei oder in der Google Console unter Clients → „Secret hinzufügen“'} wide><input class="inp" type="password" value={sec} onInput={(e) => setSec(e.currentTarget.value)} placeholder={secretSaved ? '•••••••• gespeichert' : 'GOCSPX-…'} /></Field>
          {secInfo && !secInfo.hasSecret && !secretSaved && <div class="notice warn small">Die JSON-Datei enthält kein Client-Secret – Google zeigt es nur direkt beim Erstellen. Öffne in der Google Console <b>Google Auth Platform → Clients → deinen Client → „Secret hinzufügen“</b>, kopiere das neue Secret und füge es hier ein.</div>}
          {secInfo?.type === 'web' && <div class="notice warn small">Das ist ein Client vom Typ „Webanwendung“. Bitte einen Client vom Typ <b>Desktop-App</b> anlegen, sonst lehnt Google die Anmeldung ab.</div>}
          <div class="row gap-s"><button class="btn xs" onClick={async () => { const r = await guard(() => rpc('google.importClientJson')); if (r) { setCid(r.clientId); setSecInfo(r); setState({ secrets: await rpc('secrets.status') }); toast(r.hasSecret ? 'Client-ID und Secret übernommen' : 'Client-ID übernommen – die Datei enthält KEIN Secret', r.hasSecret ? undefined : 'error', 7000); } }}>JSON-Datei laden</button><span class="grow" /><button class="btn sm primary" disabled={!cid || busy} onClick={connect}>{busy ? <Spinner /> : <Link2 size={14} />}{busy ? 'Warte auf Browser …' : 'Im Browser anmelden'}</button></div>
          {err && <div class="notice warn small mt"><b>Verbindung fehlgeschlagen:</b> {err}</div>}
        </>
      ) : (
        <>
          <Field label="Auto-Synchronisation"><Toggle checked={s.google.calendarSync} onChange={(v) => upd({ google: { calendarSync: v } })} /></Field>
          <Field label="Synchronisationsintervall"><Select value={String(s.google.syncIntervalMinutes)} onChange={(v) => upd({ google: { syncIntervalMinutes: Number(v) } })} options={[['5', 'Alle 5 Minuten'], ['15', 'Alle 15 Minuten'], ['30', 'Alle 30 Minuten'], ['60', 'Stündlich']].map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Neue Termine in"><Select value={s.google.defaultCalendarId} onChange={(v) => upd({ google: { defaultCalendarId: v } })} options={[{ value: '', label: 'Hauptkalender' }, ...cals.filter((c) => c.writable && c.id !== 'local').map((c) => ({ value: c.id, label: c.name }))]} /></Field>
          <div class="row"><span class="tiny muted grow">Letzter Abgleich: {status?.lastSync ? ago(status.lastSync) : '—'}{status?.error ? ' · ' + status.error : ''}</span>
            <button class="btn xs" onClick={() => guard(() => rpc('calendar.sync'), 'Synchronisiert')}><RefreshCw size={12} />Sync</button>
            <button class="btn xs danger" onClick={async () => { if (await ask('Google trennen? Lokale Kopien der Google-Termine bleiben bis zum nächsten Abgleich sichtbar.', '', { confirmOnly: true, okLabel: 'Trennen' })) { await rpc('google.disconnect'); setState({ google: await rpc('calendar.status') }); } }}>Trennen</button></div>
        </>
      )}
    </Panel>
  );
}

function StudyCard({ s }) {
  const st = s.study;
  return (
    <Panel icon={BookOpen} title="Studium / Import" sub="Dateien, Notizen und Lernmaterialien">
      <Field label="Quelle"><Select value={st.source || 'folder'} onChange={(v) => upd({ study: { source: v } })} options={[{ value: 'drive', label: 'Google Drive' }, { value: 'folder', label: 'Ordner auf diesem PC (z. B. OneDrive)' }]} /></Field>
      {st.source === 'drive' ? <DriveSource st={st} /> : (
        <Field label="Importordner" wide>
          <div class="row gap-s" style={{ width: '100%' }}><input class="inp" value={st.folder} readOnly placeholder="nicht gewählt" /><button class="btn icon xs" onClick={async () => { const f = await rpc('dialog.pickFolder'); if (f) { const c = await rpc('study.check', { folder: f }); if (!c.ok) return toast(c.error, 'error'); upd({ study: { folder: f, source: 'folder', enabled: true } }); } }}><FolderOpen size={14} /></button></div>
        </Field>
      )}
      <Field label="Ordner überwachen & automatisch indexieren"><Toggle checked={st.enabled} onChange={(v) => upd({ study: { enabled: v } })} /></Field>
      <Field label="Duplikate erkennen"><span class="small ok">immer aktiv (Inhalts-Prüfsumme)</span></Field>
      <Field label="Unterstützte Formate"><span class="small muted">PDF, DOCX, PPTX, TXT, MD, IPYNB</span></Field>
      <Field label="Handschrift/Formeln transkribieren" hint="multimodal über Gemini, pro Seite zwischengespeichert"><Select value={st.visionForHandwriting} onChange={(v) => upd({ study: { visionForHandwriting: v } })} options={[{ value: 'off', label: 'Aus' }, { value: 'on-demand', label: 'Auf Abruf' }, { value: 'auto', label: 'Automatisch (Tageslimit)' }]} /></Field>
      <Field label="Tageslimit Seitenanalysen"><input class="inp" type="number" min="0" max="500" value={st.visionDailyLimit} onChange={(e) => upd({ study: { visionDailyLimit: Number(e.currentTarget.value) } })} /></Field>
    </Panel>
  );
}

function CampusDualCard({ s }) {
  const [st, setSt] = useState(null);
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState('');
  const load = async () => setSt(await rpc('campusdual.status').catch(() => null));
  useEffect(() => { load(); }, []);
  const r = st?.results;
  const cfg = s.campusDualResults || {};
  const save = async () => {
    setBusy('save');
    const ok = await guard(() => rpc('campusdual.setCredentials', { user, password: pw }), 'Zugangsdaten verschlüsselt gespeichert');
    setPw(''); setUser('');
    if (ok?.hasCreds) {
      setBusy('test');
      const t = await guard(() => rpc('campusdual.testLogin'));
      if (t) toast(t.ok ? 'Anmeldung bei Campus Dual klappt' : t.reason === 'badcredentials' ? 'Campus Dual hat die Zugangsdaten abgelehnt' : t.reason === 'notfound' ? 'Anmeldeseite nicht gefunden – Campus-Dual-Adresse im Kalender eintragen' : 'Anmeldung hat nicht geklappt (' + (t.reason || 'unbekannt') + ')', t.ok ? undefined : 'error', 7000);
    }
    setBusy(''); load();
  };
  const check = async () => {
    setBusy('results');
    const x = await guard(() => rpc('campusdual.checkResults'));
    if (x) toast(x.firstRun ? `Stand gespeichert: ${x.count} Ergebnisse` : x.newResults?.length ? `${x.newResults.length} neue Ergebnisse` : x.tileChanged ? 'Ergebnisse-Kachel hat sich geändert' : 'Keine neuen Ergebnisse');
    setBusy(''); load();
  };
  if (st && !st.available) return null;
  return (
    <Panel icon={GraduationCap} title="Campus Dual" sub="Stundenplan und Prüfungsergebnisse">
      <Field label="Status"><span class="small" style={{ color: st?.loggedIn ? 'var(--ok, #4ade80)' : 'var(--text-2)' }}>{!st ? '…' : st.loggedIn ? 'angemeldet' : 'nicht angemeldet'}{st?.hasCreds ? ' · Zugangsdaten gespeichert' : ''}</span></Field>
      {st?.events && <Field label="Stundenplan"><span class="small muted">{st.events.records} Einträge von Campus Dual · {st.events.events} Termine erkannt</span></Field>}
      <div class="tiny muted">Optional: Mit gespeicherten Zugangsdaten meldet sich JARVIS bei abgelaufener Sitzung unsichtbar selbst neu an. Sie liegen nur verschlüsselt (Windows-DPAPI) auf diesem PC, werden nie angezeigt und nur auf campus-dual.de eingetragen – höchstens ein Versuch, damit dein Konto nicht gesperrt wird.</div>
      <Field label="Benutzername (Matrikelnummer)"><input class="inp" autocomplete="off" value={user} placeholder={st?.hasCreds ? 'gespeichert – zum Ändern neu eingeben' : 'z. B. 5001234'} onInput={(e) => setUser(e.currentTarget.value)} /></Field>
      <Field label="Passwort"><input class="inp" type="password" autocomplete="new-password" value={pw} placeholder={st?.hasCreds ? '••••••••' : ''} onInput={(e) => setPw(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && user.trim() && pw) save(); }} /></Field>
      <div class="row gap-s" style={{ justifyContent: 'flex-end' }}>
        {st?.hasCreds && <button class="btn xs ghost" disabled={!!busy} onClick={async () => { if (await ask('Gespeicherte Campus-Dual-Zugangsdaten löschen?', '', { confirmOnly: true, okLabel: 'Löschen' })) { await guard(() => rpc('campusdual.setCredentials', {}), 'Gelöscht'); load(); } }}>Löschen</button>}
        {st?.hasCreds && <button class="btn xs" disabled={!!busy} onClick={async () => { setBusy('test'); const t = await guard(() => rpc('campusdual.testLogin')); if (t) toast(t.ok ? 'Anmeldung klappt' : 'Anmeldung fehlgeschlagen (' + (t.reason || 'unbekannt') + ')', t.ok ? undefined : 'error'); setBusy(''); load(); }}>{busy === 'test' ? <Spinner /> : null}Anmeldung prüfen</button>}
        <button class="btn xs primary" disabled={!user.trim() || !pw || !!busy} onClick={save}>{busy === 'save' ? <Spinner /> : <KeyRound size={12} />}Speichern</button>
      </div>
      <div class="hr" />
      <Field label="Neue Prüfungsergebnisse melden" hint={`prüft alle ${cfg.intervalHours || 3} h, nur wenn angemeldet oder Zugangsdaten gespeichert`}><Toggle checked={cfg.enabled !== false} onChange={(v) => upd({ campusDualResults: { enabled: v } })} /></Field>
      <Field label="Letzte Prüfung"><span class="small muted">{r?.lastCheck ? ago(r.lastCheck) : 'noch nie'}{r?.tile ? ' · Kachel: ' + r.tile : ''}</span></Field>
      {r?.lastError && <div class="notice warn small"><FixText text={r.lastError} /></div>}
      {r?.results?.length > 0 && (
        <details>
          <summary class="small">{r.results.length} Ergebnisse gelesen</summary>
          <div class="col gap-xs" style={{ marginTop: 6, maxHeight: 220, overflow: 'auto' }}>
            {r.results.slice(0, 80).map((x) => <div class="row small" key={x.key}><span class="grow">{x.title}</span><span class="muted">{[x.grade || x.gradeText, x.credits ? x.credits + ' CP' : null, x.date].filter(Boolean).join(' · ')}</span></div>)}
          </div>
        </details>
      )}
      {r?.lastCheck && !r?.results?.length && r?.sources?.length > 0 && <div class="tiny muted">Gefundene Quellen: {r.sources.map((x) => `${x.set} (${x.error ? 'Fehler' : x.count})`).join(', ')} – noch keine Ergebnisliste erkannt, JARVIS meldet dann Änderungen der Ergebnisse-Kachel.</div>}
      <div class="row" style={{ justifyContent: 'flex-end' }}><button class="btn xs" disabled={!!busy || (!st?.loggedIn && !st?.hasCreds)} onClick={check}>{busy === 'results' ? <Spinner /> : <RefreshCw size={12} />}Jetzt prüfen</button></div>
    </Panel>
  );
}

function DriveSource({ st }) {
  const [ds, reload] = useRpc('drive.status', {}, { events: ['drive:status', 'settings:changed'] });
  const [name, setName] = useState(st.driveFolder || 'Goodnotes');
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState(null);
  const connect = async () => { setBusy(true); const r = await guard(() => rpc('drive.connect')); setBusy(false); if (r) { toast('Google Drive verbunden – Ordner wird synchronisiert'); setState({ google: await rpc('calendar.status') }); reload(); } };
  const sync = async () => { setBusy(true); const r = await guard(() => rpc('drive.sync', {})); setBusy(false); if (r) toast(`Drive abgeglichen: ${r.files} Dateien, ${r.changed} geändert`); reload(); };
  const saveName = async () => { const n = name.trim() || 'Goodnotes'; if (n === st.driveFolder) return; await upd({ study: { driveFolder: n, driveFolderId: '' } }); const f = await guard(() => rpc('drive.folders', { name: n })); setFolders(f); };
  return (
    <>
      <Field label="Drive-Ordner" hint="Unterordner werden zu Fächern" wide>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" value={name} onInput={(e) => setName(e.currentTarget.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && saveName()} placeholder="Goodnotes" /></div>
      </Field>
      {folders && folders.length > 1 && <div class="notice small">Es gibt {folders.length} Ordner „{name}“. Welcher? {folders.map((f) => <button class="btn xs mt" style={{ marginRight: 6 }} onClick={async () => { await guard(() => rpc('drive.useFolder', { id: f.id, name })); setFolders(null); reload(); }}>geändert {new Date(f.modifiedTime).toLocaleDateString('de-DE')}</button>)}</div>}
      {folders && folders.length === 0 && <div class="notice warn small">Kein Ordner „{name}“ in deinem Google Drive gefunden.</div>}
      {!ds?.granted ? (
        <div class="row gap-s"><span class="small muted grow">JARVIS braucht einmalig Lesezugriff auf dein Google Drive.</span><button class="btn sm primary" disabled={busy} onClick={connect}>{busy ? <Spinner /> : <Link2 size={14} />}Google Drive verbinden</button></div>
      ) : (
        <div class="row gap-s"><span class="small grow" style={{ color: ds.error ? 'var(--red)' : 'var(--text-2)' }}>{ds.syncing ? 'Synchronisiere …' : ds.error ? ds.error : ds.lastSync ? `${ds.files} Dateien · abgeglichen ${ago(ds.lastSync)}` : 'Noch nicht abgeglichen'}</span><button class="btn xs" disabled={busy || ds.syncing} onClick={sync}>{busy || ds.syncing ? <Spinner /> : <RefreshCw size={12} />}Jetzt abgleichen</button></div>
      )}
      <div class="tiny muted">Nur lesend: JARVIS ändert und löscht nichts in deinem Drive. Neue Goodnotes-Exporte werden alle 20 Minuten übernommen.</div>
    </>
  );
}

function GamingCard({ s, secrets }) {
  const g = s.gaming;
  const [riotKey, setRiotKey] = useState('');
  const [installed, , st] = useRpc('game.installed', {}, { initial: [] });
  return (
    <Panel icon={Gamepad2} title="Gaming" sub="Spiele und Integrationen">
      <Field label="Spielerkennung aktivieren (Prozesse)"><Toggle checked={g.detection} onChange={(v) => upd({ gaming: { detection: v } })} /></Field>
      <Field label="Ressourcen beim Spielen reduzieren"><Toggle checked={g.reduceWhileGaming} onChange={(v) => upd({ gaming: { reduceWhileGaming: v } })} /></Field>
      <Field label="Erkannte Spiele"><span class="small muted" style={{ textAlign: 'right' }}>{st.loading ? '…' : installed.map((p) => p.short || p.name).join(', ') || 'keine'}</span></Field>
      <div class="notice small">League of Legends: Matchhistorie und Rang werden aus dem laufenden League-Client gelesen – <b>kein API-Schlüssel nötig</b>. Riot-ID/Schlüssel unten nur, wenn du Daten auch ohne geöffneten Client willst.</div>
      <Field label="League-Ordner (nur falls nicht Standard)"><div class="row gap-s" style={{ width: '100%' }}><input class="inp" readOnly value={g.leagueDir} placeholder="automatisch" /><button class="btn icon xs" onClick={async () => { const f = await rpc('dialog.pickFolder'); if (f) upd({ gaming: { leagueDir: f } }); }}><FolderOpen size={14} /></button></div></Field>
      <Field label="Riot-ID (Name#TAG, optional)"><input class="inp" value={g.riotId} onChange={(e) => upd({ gaming: { riotId: e.currentTarget.value.trim() } })} placeholder="Name#EUW" /></Field>
      <Field label="Region"><Select value={g.riotRegion} onChange={(v) => upd({ gaming: { riotRegion: v } })} options={['euw1', 'eun1', 'na1', 'kr', 'br1', 'la1', 'la2', 'oc1', 'tr1', 'ru', 'jp1']} /></Field>
      <Field label="Riot-API-Schlüssel (optional)" hint={secrets['riot.api_key'] ? 'gespeichert' : 'nicht nötig, wenn der Client läuft'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" type="password" placeholder={secrets['riot.api_key'] ? '••••••••' : 'RGAPI-…'} value={riotKey} onInput={(e) => setRiotKey(e.currentTarget.value)} /><button class="btn xs" onClick={async () => { await guard(() => rpc('secrets.set', { key: 'riot.api_key', value: riotKey }), 'Gespeichert'); setRiotKey(''); setState({ secrets: await rpc('secrets.status') }); }}>OK</button></div>
      </Field>
      <Field label="LoL Live-Coach (Hinweise im Match)"><Toggle checked={g.lolLiveCoach} onChange={(v) => upd({ gaming: { lolLiveCoach: v } })} /></Field>
      <Field label="LoL Championauswahl: Matchup-Tipps" hint="Nur Champions, keine Spielerdaten"><Toggle checked={g.lolChampSelect !== false} onChange={(v) => upd({ gaming: { lolChampSelect: v } })} /></Field>
      <Field label="LoL Nachbesprechung nach jedem Spiel"><Toggle checked={g.lolReview !== false} onChange={(v) => upd({ gaming: { lolReview: v } })} /></Field>
      {g.lolReview !== false && <Field label="… mit KI-Zusammenfassung (Gemini)"><Toggle checked={g.lolReviewAi !== false} onChange={(v) => upd({ gaming: { lolReviewAi: v } })} /></Field>}
      <div class="hr" />
      <Field label="Steam: Game-Seiten automatisch anlegen" hint="Für jedes Steam-Spiel mit Spielzeit – stündlich geprüft, lokal aus Steam gelesen"><Toggle checked={g.steamAutoImport !== false} onChange={(v) => upd({ gaming: { steamAutoImport: v } })} /></Field>
      <Field label="… ab Spielzeit (Minuten)"><input class="inp" type="number" min="0" style={{ width: 90 }} value={g.steamMinMinutes ?? 1} onChange={(e) => upd({ gaming: { steamMinMinutes: Math.max(0, Number(e.currentTarget.value) || 0) } })} /></Field>
      <Field label="Steam-Ordner (nur falls nicht gefunden)"><div class="row gap-s" style={{ width: '100%' }}><input class="inp" readOnly value={g.steamDir || ''} placeholder="automatisch" /><button class="btn icon xs" onClick={async () => { const f = await rpc('dialog.pickFolder'); if (f) upd({ gaming: { steamDir: f } }); }}><FolderOpen size={14} /></button></div></Field>
      <div class="hr" />
      <TarkovTrackerField />
    </Panel>
  );
}

function TarkovTrackerField() {
  const [st, reload] = useRpc('tracker.status', {}, { events: ['tarkovtracker:status'] });
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => { setBusy(true); const r = await guard(() => rpc('tracker.connect', { token: tok.trim() })); setBusy(false); if (r) { toast(`TarkovTracker verbunden${r.canWrite ? ' (mit Schreibrecht)' : ' (nur lesen)'}`); setTok(''); reload(); } };
  return (
    <>
      <Field label="TarkovTracker-Token (optional)" hint="tarkovtracker.org → Einstellungen → API-Token. Erledigte Quests landen automatisch in „Mein Spielstand“; mit Schreibrecht wird dein Abhaken zurückübertragen." wide>
        <div class="row gap-s" style={{ width: '100%' }}>
          <input class="inp" type="password" value={tok} placeholder={st?.configured ? '•••••••• (verbunden)' : 'PVP_… oder Token'} onInput={(e) => setTok(e.currentTarget.value)} />
          <button class="btn xs" disabled={!tok.trim() || busy} onClick={connect}>{busy ? <Spinner /> : 'Verbinden'}</button>
          {st?.configured && <button class="btn xs ghost" onClick={async () => { await rpc('tracker.disconnect'); reload(); }}>Trennen</button>}
        </div>
      </Field>
      {st?.configured && <div class="tiny muted">{st.error ? <FixText text={'Fehler: ' + st.error} /> : st.lastSync ? `Zuletzt abgeglichen ${ago(st.lastSync)}${st.counts ? ` · ${st.counts.done} Quests erledigt` : ''}` : 'Noch nicht abgeglichen'}{st.gameMode ? ` · Modus ${st.gameMode.toUpperCase()}` : ''}</div>}
    </>
  );
}

function OverlayCard({ s }) {
  const o = s.overlay || {}; const sc = s.screen || {};
  return (
    <Panel icon={Monitor} title="In-Game-Overlay & Bildschirm" sub="HUD über dem Spiel und „Was ist das?“-Hotkey">
      <Field label="Overlay"><Select value={o.mode} onChange={(v) => upd({ overlay: { mode: v } })} options={[{ value: 'auto', label: 'Automatisch beim Spielen' }, { value: 'always', label: 'Immer' }, { value: 'off', label: 'Aus' }]} /></Field>
      <Field label="Position"><Select value={o.position} onChange={(v) => upd({ overlay: { position: v } })} options={[{ value: 'right', label: 'Rechts' }, { value: 'left', label: 'Links' }]} /></Field>
      <Field label={`Deckkraft · ${Math.round((o.opacity ?? 0.92) * 100)}%`}><input class="range" type="range" min="0.4" max="1" step="0.05" value={o.opacity ?? 0.92} onChange={(e) => upd({ overlay: { opacity: Number(e.currentTarget.value) } })} /></Field>
      <Field label={`Größe · ${Math.round((o.scale ?? 1) * 100)}%`}><input class="range" type="range" min="0.7" max="1.5" step="0.05" value={o.scale ?? 1} onChange={(e) => upd({ overlay: { scale: Number(e.currentTarget.value) } })} /></Field>
      <Field label="Mini-Karte anzeigen"><Toggle checked={o.showMap !== false} onChange={(v) => upd({ overlay: { showMap: v } })} /></Field>
      <Field label="Overlay ein/aus (Hotkey)"><input class="inp" value={o.hotkey} onChange={(e) => upd({ overlay: { hotkey: e.currentTarget.value } })} /></Field>
      <Field label="Overlay bedienen (Hotkey)" hint="Macht es 20 s lang klickbar"><input class="inp" value={o.interactHotkey} onChange={(e) => upd({ overlay: { interactHotkey: e.currentTarget.value } })} /></Field>
      <div class="hr" />
      <Field label="„Was ist das?“ – Bildschirm fragen" hint="Screenshot nur auf Tastendruck/Befehl; bleibt lokal, nur dieses Bild geht an Gemini"><Toggle checked={sc.enabled !== false} onChange={(v) => upd({ screen: { enabled: v } })} /></Field>
      <Field label="Hotkey"><input class="inp" value={sc.hotkey} onChange={(e) => upd({ screen: { hotkey: e.currentTarget.value } })} /></Field>
      <Field label="Standardfrage" wide><input class="inp" value={sc.defaultQuestion} onChange={(e) => upd({ screen: { defaultQuestion: e.currentTarget.value } })} /></Field>
      <Field label="Antworten vorlesen"><Toggle checked={!!o.speakAnswers} onChange={(v) => upd({ overlay: { speakAnswers: v } })} /></Field>
      <div class="tiny muted">Tipp: Spiele im Modus „Randloses Fenster“ – über exklusivem Vollbild kann Windows kein Overlay anzeigen.</div>
    </Panel>
  );
}

function Desktop({ s }) {
  const ss = s.startSound;
  return (
    <Panel icon={Monitor} title="Desktop" sub="Oberfläche und Systemverhalten">
      <Field label={`Transparenz (HUD-Stil) · ${Math.round(s.hudTransparency * 100)}%`}><input class="range" type="range" min="0.5" max="1" step="0.05" value={s.hudTransparency} onChange={(e) => upd({ hudTransparency: Number(e.currentTarget.value) })} /></Field>
      <Field label="Animationen"><Select value={s.animations} onChange={(v) => upd({ animations: v })} options={[{ value: 'full', label: 'Standard' }, { value: 'reduced', label: 'Reduziert' }, { value: 'off', label: 'Aus' }]} /></Field>
      <Field label="Immer im Vordergrund"><Toggle checked={s.alwaysOnTop} onChange={(v) => upd({ alwaysOnTop: v })} /></Field>
      <Field label="Beim Schließen im Tray weiterlaufen"><Toggle checked={s.closeToTray} onChange={(v) => upd({ closeToTray: v })} /></Field>
      <Field label="Schnellzugriff (globaler Hotkey)"><input class="inp" value={s.globalHotkey} onChange={(e) => upd({ globalHotkey: e.currentTarget.value })} /></Field>
      <Field label="Startsound"><Select value={ss.mode} onChange={(v) => upd({ startSound: { mode: v } })} options={[{ value: 'off', label: 'Deaktiviert' }, { value: 'immediate', label: 'Sofort' }, { value: 'delayed', label: 'Verzögert' }]} /></Field>
      {ss.mode !== 'off' && <>
        {ss.mode === 'delayed' && <Field label="Verzögerung (Sekunden)"><input class="inp" type="number" min="0" max="120" value={ss.delaySeconds} onChange={(e) => upd({ startSound: { delaySeconds: Number(e.currentTarget.value) } })} /></Field>}
        <Field label="Lautstärke"><input class="range" type="range" min="0" max="1" step="0.05" value={ss.volume} onChange={(e) => upd({ startSound: { volume: Number(e.currentTarget.value) } })} /></Field>
        <Field label="Eigene Audiodatei"><div class="row gap-s"><button class="btn xs" onClick={() => guard(() => rpc('sound.pick'), 'Audiodatei übernommen')}>Wählen…</button>{ss.file && <button class="btn xs ghost" onClick={() => upd({ startSound: { file: '' } })}>Standard</button>}<button class="btn icon xs" onClick={() => playStartSound({ ...ss, mode: 'immediate' })}><Play size={12} /></button></div></Field>
      </>}
    </Panel>
  );
}

function Security({ s }) {
  const [status] = useRpc('system.status', {}, {});
  return (
    <Panel icon={ShieldCheck} title="Sicherheit" sub="Datenschutz und Zugriff">
      <div class="conn-row"><span>Geheimnisse verschlüsselt (Windows DPAPI)</span><span class="st"><StatusDot state={status?.secretsProtected ? 'ok' : 'warn'} />{status?.secretsProtected ? 'aktiv' : 'nicht verfügbar'}</span></div>
      <div class="conn-row"><span>Kein lokaler Webserver / kein offener Port</span><span class="st"><StatusDot state="ok" />aktiv</span></div>
      <div class="conn-row"><span>Aktionen mit Bestätigung (Einmal-Token, 3 Min)</span><span class="st"><StatusDot state="ok" />aktiv</span></div>
      <div class="conn-row"><span>Webinhalte als nicht vertrauenswürdig behandelt</span><span class="st"><StatusDot state="ok" />aktiv</span></div>
      <div class="conn-row"><span>Protokolle ohne Schlüssel/Tokens</span><span class="st"><StatusDot state="ok" />aktiv</span></div>
      <div class="conn-row"><span>Dateizugriff nur auf von dir gewählte Dateien/Ordner</span><span class="st"><StatusDot state="ok" />immer</span></div>
      <Field label="Ruhezeiten (keine Pop-ups)"><Toggle checked={s.quietHours.enabled} onChange={(v) => upd({ quietHours: { enabled: v } })} /></Field>
      {s.quietHours.enabled && <Field label="Von – bis"><div class="row gap-s"><input class="inp" type="time" value={s.quietHours.from} onChange={(e) => upd({ quietHours: { from: e.currentTarget.value } })} /><input class="inp" type="time" value={s.quietHours.to} onChange={(e) => upd({ quietHours: { to: e.currentTarget.value } })} /></div></Field>}
      <div class="row mt gap-s"><button class="btn xs" onClick={() => rpc('shell.openPath', { which: 'logs' })}>Protokolle öffnen</button></div>
    </Panel>
  );
}

function Proactive({ s }) {
  const p = s.proactive;
  const cats = s.notifyCategories;
  return (
    <Panel icon={Bell} title="Proaktiver Assistent" sub="Briefings und Benachrichtigungen">
      <Field label="Tagesbriefing"><Toggle checked={p.dailyBriefing} onChange={(v) => upd({ proactive: { dailyBriefing: v } })} /></Field>
      {p.dailyBriefing && <Field label="Uhrzeit"><input class="inp" type="time" value={p.briefingTime} onChange={(e) => upd({ proactive: { briefingTime: e.currentTarget.value } })} /></Field>}
      <Field label="Hinweis auf überfällige Aufgaben (1× täglich)"><Toggle checked={p.overdueReminders} onChange={(v) => upd({ proactive: { overdueReminders: v } })} /></Field>
      {[['tasks', 'Aufgaben & Erinnerungen'], ['calendar', 'Kalender'], ['gaming', 'Spiel-Timer'], ['study', 'Studium'], ['system', 'System & Updates']].map(([k, l]) => <Field label={'Pop-ups: ' + l}><Toggle checked={cats[k] !== false} onChange={(v) => upd({ notifyCategories: { [k]: v } })} /></Field>)}
    </Panel>
  );
}

function Data() {
  const [info] = useRpc('app.info', {}, {});
  const [backups, reload] = useRpc('system.backups', {}, { initial: [] });
  const s = useStore((x) => x.settings);
  return (
    <Panel icon={Database} title="Daten, Sicherung & Updates" sub={`JARVIS ${info?.version || ''} · Electron ${info?.electron || ''}`}>
      <Field label="Datenordner" wide><div class="row gap-s" style={{ width: '100%' }}><input class="inp" readOnly value={info?.dataDir || ''} /><button class="btn icon xs" onClick={() => rpc('shell.openPath', { which: 'data' })}><FolderOpen size={14} /></button></div></Field>
      <div class="row gap-s">
        <button class="btn xs" onClick={async () => { const r = await guard(() => rpc('system.backup')); if (r) { toast('Sicherung erstellt'); reload(); } }}><Download size={12} />Sicherung erstellen</button>
        <button class="btn xs" onClick={async () => { const r = await guard(() => rpc('system.restore', {})); if (r?.staged && await ask('Sicherung geprüft. JARVIS jetzt neu starten und wiederherstellen?', '', { confirmOnly: true, okLabel: 'Neu starten' })) rpc('app.relaunch'); }}><Upload size={12} />Wiederherstellen…</button>
      </div>
      <DriveBackupField s={s} />
      <div class="tiny muted mt">Automatische Tagessicherungen (7 Tage): {backups.filter((b) => b.auto).length} · zuletzt {backups[0] ? ago(backups[0].at) : '—'} · vor jeder Schema-Migration wird zusätzlich gesichert.</div>
      <div class="hr" />
      <UpdateSection s={s} />
    </Panel>
  );
}

function DriveBackupField({ s }) {
  const [st, reload] = useRpc('backup.driveStatus', {}, { events: ['backup:drive', 'settings:changed'] });
  const [busy, setBusy] = useState(false);
  const b = s.backupDrive || {};
  const connect = async () => { setBusy(true); const r = await guard(() => rpc('backup.driveConnect')); setBusy(false); if (r) { toast('Drive-Backup aktiv – erste Sicherung läuft'); setState({ google: await rpc('calendar.status') }); reload(); } };
  const now = async () => { setBusy(true); const r = await guard(() => rpc('backup.driveRun')); setBusy(false); if (r?.ok) toast(`Gesichert: ${r.file}`); reload(); };
  return (
    <div class="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <Field label="Automatisches Backup in Google Drive" hint="Täglich, nicht beim Zocken. JARVIS legt nur eigene Sicherungsdateien an und behält die neuesten."><Toggle checked={!!b.enabled && !!st?.granted} onChange={(v) => (v && !st?.granted ? connect() : upd({ backupDrive: { enabled: v } }))} /></Field>
      <Field label="Drive-Ordner"><input class="inp" style={{ width: 180 }} value={b.folder || 'coding'} onChange={(e) => upd({ backupDrive: { folder: e.currentTarget.value.trim().replace(/^\/+|\/+$/g, '') || 'coding' } })} /></Field>
      <Field label="Anzahl behalten"><input class="inp" type="number" min="1" max="100" style={{ width: 90 }} value={b.keep || 14} onChange={(e) => upd({ backupDrive: { keep: Math.max(1, Math.min(100, Number(e.currentTarget.value) || 14)) } })} /></Field>
      <div class="row gap-s">
        {!st?.granted ? <button class="btn xs primary" disabled={busy} onClick={connect}>{busy ? <Spinner /> : <Link2 size={12} />}Drive-Backup aktivieren</button>
          : <button class="btn xs" disabled={busy || st?.running} onClick={now}>{busy || st?.running ? <Spinner /> : <Upload size={12} />}Jetzt in Drive sichern</button>}
        <span class="tiny muted grow" style={{ color: st?.lastError ? 'var(--red)' : undefined }}>{st?.running ? 'Sichere …' : st?.lastError ? <FixText text={'Fehler: ' + st.lastError} /> : st?.lastSuccess ? `Zuletzt: ${ago(st.lastSuccess)} · ${st.lastFile} (${Math.round((st.lastSize || 0) / 1024)} KB) in „${st.folder}“` : st?.granted ? 'Noch keine Sicherung in Drive' : 'Braucht einmalig Schreibzugriff auf dein Google Drive (Google-Anmeldung)'}</span>
      </div>
    </div>
  );
}

function UpdateSection({ s }) {
  const u = useStore((x) => x.update) || {};
  const secrets = useStore((x) => x.secrets);
  const [open, setOpen] = useState(false);
  const [tok, setTok] = useState('');
  const check = async () => { const r = await guard(() => rpc('update.check')); if (r?.state === 'available') setOpen(true); else if (r?.state === 'current') toast(`JARVIS ist aktuell (${r.version}).`); };
  const label = { 'not-configured': 'Keine Update-Quelle eingerichtet.', checking: 'Suche …', 'no-release': `Verbunden mit ${u.repo} – dort gibt es noch kein veröffentlichtes Release.`, current: `Aktuell – neueste Version ist ${u.version}.`, available: `Version ${u.version} verfügbar${u.signed ? ' (Signatur gültig)' : ' – NICHT gültig signiert'}.`, downloading: 'Lädt herunter …', ready: 'Bereit zur Installation.', installing: 'Installiert …', error: 'Fehler: ' + u.error }[u.state] || '';
  return (
    <>
      <Field label="Update-Quelle (GitHub-Repo)" hint={u.repo && !s.updateRepo ? 'Im Release eingebaut' : 'z. B. boz/jarvis'} wide><input class="inp" value={s.updateRepo || u.repo || ''} onChange={(e) => upd({ updateRepo: e.currentTarget.value.trim() })} placeholder="benutzername/jarvis" /></Field>
      <Field label="GitHub-Token (nur für privates Repo)" hint="Fein-granular, nur dieses Repo, „Contents: Read-only“ – wird mit DPAPI verschlüsselt" wide>
        <div class="row gap-s" style={{ width: '100%' }}>
          <input class="inp" type="password" value={tok} placeholder={secrets['github.token'] ? '•••••••• (hinterlegt)' : 'github_pat_…'} onInput={(e) => setTok(e.currentTarget.value)} />
          <button class="btn xs" disabled={!tok.trim()} onClick={async () => { const r = await guard(() => rpc('secrets.set', { key: 'github.token', value: tok.trim() }), 'Token gespeichert'); if (r) { setState({ secrets: r }); setTok(''); } }}>Speichern</button>
          {secrets['github.token'] && <button class="btn xs ghost" onClick={async () => setState({ secrets: await rpc('secrets.set', { key: 'github.token', value: '' }) })}>Entfernen</button>}
        </div>
      </Field>
      <Field label="Automatisch nach Updates suchen" hint="Alle 6 h, nie während eines Spiels; installiert wird nur auf Klick"><Toggle checked={s.updateCheck} onChange={(v) => upd({ updateCheck: v })} /></Field>
      <div class="row gap-s">
        <button class="btn xs" disabled={u.state === 'checking'} onClick={check}><RefreshCw size={12} />Jetzt nach Updates suchen</button>
        {['available', 'ready'].includes(u.state) && <button class="btn xs primary" disabled={!u.signed} onClick={() => setOpen(true)}><Rocket size={12} />Auf {u.version} aktualisieren</button>}
        {u.releaseUrl && <button class="btn xs ghost" onClick={() => rpc('shell.openExternal', { url: u.releaseUrl })}>Release ansehen</button>}
      </div>
      <div class="tiny muted mt">{label}{u.checkedAt ? ` · geprüft ${ago(u.checkedAt)}` : ''}{!u.keyInstalled ? ' · Hinweis: Diese Version enthält keinen Update-Schlüssel – Updates werden angezeigt, aber nicht automatisch installiert.' : ''}</div>
      {open && <UpdateModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function SelfTest({ r, onClose, onRerun }) {
  const ICON = { ok: <CircleCheck size={16} class="ok" />, warn: <TriangleAlert size={16} style={{ color: 'var(--orange)' }} />, error: <CircleX size={16} class="err" />, info: <Info size={16} style={{ color: 'var(--text-3)' }} /> };
  const go = (fix) => { if (fix.url) rpc('shell.openExternal', { url: fix.url }); else if (fix.rpc) guard(() => rpc(fix.rpc)); else { setState({ page: fix.action || 'settings' }); onClose(); } };
  const list = r === 'loading' ? [] : r;
  const bad = list.filter((x) => x.status === 'error').length; const warn = list.filter((x) => x.status === 'warn').length;
  return (
    <Modal title="Systemcheck" sub={r === 'loading' ? 'Prüft alle Verbindungen mit echten Testanfragen …' : bad ? `${bad} Problem${bad > 1 ? 'e' : ''}${warn ? `, ${warn} Hinweis${warn > 1 ? 'e' : ''}` : ''} – mit Lösung` : warn ? `Alles läuft, ${warn} Hinweis${warn > 1 ? 'e' : ''}` : 'Alles in Ordnung'} onClose={onClose}
      actions={<>{onRerun && r !== 'loading' && <button class="btn sm ghost" onClick={onRerun}>Erneut prüfen</button>}<button class="btn sm" onClick={onClose}>Schließen</button></>}>
      {r === 'loading' ? <div class="center" style={{ padding: 20 }}><Spinner /></div> : [...list].sort((a, b) => ['error', 'warn', 'ok', 'info'].indexOf(a.status) - ['error', 'warn', 'ok', 'info'].indexOf(b.status)).map((x) => (
        <div class="check-line" style={{ alignItems: 'flex-start' }}>
          {ICON[x.status] || (x.ok ? ICON.ok : ICON.error)}
          <div class="grow"><div class="small" style={{ fontWeight: 600 }}>{x.name}</div><div class="tiny" style={{ color: x.status === 'error' ? 'var(--red)' : 'var(--text-2)' }}>{String(x.detail)}</div></div>
          {x.fix && <button class="btn xs" onClick={() => go(x.fix)}>{x.fix.label}</button>}
        </div>))}
    </Modal>
  );
}

function ImportModal({ onClose }) {
  const [legacy, reload] = useRpc('system.legacy', {}, { initial: [] });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Import" sub="Daten aus früheren JARVIS-Versionen oder Dokumente übernehmen" onClose={onClose} actions={<button class="btn sm" onClick={onClose}>Schließen</button>}>
      <div class="hud-label">Alte JARVIS-Datenbank (1.x / Native 2.0)</div>
      {!legacy.length && <div class="small muted">Keine alte Datenbank gefunden (%LOCALAPPDATA%\JARVIS\local\jarvis.sqlite3).</div>}
      {legacy.map((l) => <div class="row mt"><Database size={16} /><span class="grow small selectable">{l.file}</span>{l.imported ? <span class="small ok">bereits importiert</span> : <button class="btn xs" disabled={busy} onClick={async () => { setBusy(true); await guard(() => rpc('system.importLegacy', { file: l.file })); setBusy(false); reload(); }}>{busy ? <Spinner size={12} /> : 'Importieren'}</button>}</div>)}
      <div class="tiny muted mt">Übernommen werden Aufgaben, Erinnerungen, Gesprächsverlauf, lokale Termine und Recherchen. Vorher wird automatisch gesichert. API-Schlüssel bitte neu eingeben.</div>
      <div class="hud-label mt">Dokumente</div>
      <button class="btn sm mt" onClick={() => guard(() => rpc('study.import'), 'Dokumente indexiert')}><Upload size={14} />Dateien importieren (PDF, DOCX, PPTX, MD, TXT, IPYNB)</button>
    </Modal>
  );
}
