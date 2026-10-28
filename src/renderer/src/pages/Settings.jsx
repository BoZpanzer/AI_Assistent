import { useState, useEffect } from 'preact/hooks';
import { Settings as Gear, GraduationCap, Globe, Sparkles, CalendarDays, BookOpen, Gamepad2, Monitor, ShieldCheck, Save, Link2, Upload, KeyRound, CircleCheck, CircleX, Database, RefreshCw, Download, Volume2, Trash2, FolderOpen, Bell, Mic, Play, Wrench, Rocket, TriangleAlert, Info, Wallet } from 'lucide-preact';
import { rpc, useRpc, useEvent } from '../lib/api.js';
import { useStore, setState, guard, toast } from '../lib/store.js';
import { ChatBar, UpdateModal } from '../components/Shell.jsx';
import { Panel, Field, Toggle, Select, StatusDot, Modal, Spinner, ask, FixText, useNow } from '../components/ui.jsx';
import { audio, playStartSound } from '../lib/audio.js';
import { ago } from '../lib/format.js';
import { PetFigure, genderFor } from '../components/Pet.jsx';

export const upd = (patch) => guard(() => rpc('settings.update', patch));

const SAMPLE = 'Hallo, ich bin JARVIS. Du warst Support mit Malphite – achte in der Lane auf Sivirs Spellshield und warde den Jungle vor dem Drachen. Deine Überlebensrate in Tarkov liegt heute bei sechzig Prozent.';

const PRESET_SAMPLES = {
  standard: 'Hallo, ich bin JARVIS. So klinge ich mit deinen bisherigen Einstellungen.',
  jarvis: 'Guten Abend. Alle Systeme laufen einwandfrei. Womit darf ich behilflich sein?',
  alya: 'Hey, schön, dass du da bist! Sollen wir gleich mit deiner nächsten Aufgabe loslegen?',
};

const OMNI_ATTR = 'Eigenschaften (Englisch, durch Komma): male/female · child/teenager/young adult/middle-aged/elderly · very low/low/moderate/high/very high pitch · whisper';

/**
/** Desktop-Figur: läuft über der Taskleiste, antwortet in Sprechblasen; beim Zocken sitzt sie im Overlay. Figur folgt der Stimme. */
function PetSettings({ s }) {
  const p = s.pet || {};
  const set = (patch) => upd({ pet: patch });
  const [demo, setDemo] = useState('wave');
  useEffect(() => { const states = ['wave', 'talk', 'think', 'walk', 'happy', 'idle']; let i = 0; const t = setInterval(() => setDemo(states[++i % states.length]), 2200); return () => clearInterval(t); }, []);
  return (
    <Panel icon={Sparkles} title="Figur" sub="JARVIS als kleine Figur auf dem Desktop – spricht in Sprechblasen, die bis zu deiner nächsten Eingabe stehen bleiben. Männlich bei J.A.R.V.I.S./Standard, weiblich bei Alya.">
      <div class="row gap" style={{ alignItems: 'flex-end' }}>
        <PetFigure gender={genderFor(s)} state={demo} size={96} />
        <div class="col grow" style={{ gap: 2 }}>
          <Field label="Auf dem Desktop" hint="Fenster zu → die Figur wartet über der Taskleiste. Doppelklick auf sie (oder „Jarvis, zeig dich“) öffnet das Fenster, Doppelklick auf die Figur im Fenster (oder „Fenster zu“) schließt es wieder."><Toggle checked={p.enabled !== false} onChange={(v) => set({ enabled: v })} /></Field>
          <Field label="Beim Start Fenster öffnen" hint="aus: JARVIS startet nur als Figur"><Toggle checked={p.uiAtStart === true} onChange={(v) => set({ uiAtStart: v })} /></Field>
          <Field label="Läuft herum"><Toggle checked={p.walk !== false} onChange={(v) => set({ walk: v })} /></Field>
          <Field label="Im Overlay beim Zocken"><Toggle checked={p.overlay !== false} onChange={(v) => set({ overlay: v })} /></Field>
          <Field label={`Größe · ${Math.round((p.size || 1) * 100)} %`}><input class="range" type="range" min="0.6" max="1.6" step="0.1" value={p.size || 1} onChange={(e) => set({ size: Number(e.currentTarget.value) })} /></Field>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Stimme beim Zocken: OmniVoice braucht die Grafikkarte – darum spricht dann standardmäßig die Google-Stimme
 * (Chirp 3 HD, gratis bis 1 Mio. Zeichen/Monat, JARVIS hört vorher auf). Private Antworten kommen dann nur ins Overlay.
 */
function GamingVoice({ t }) {
  const c = t.cloud || {};
  const mode = c.whileGaming || 'cloud';
  const secrets = useStore((x) => x.secrets) || {};
  const [st, reload] = useRpc('cloudtts.status', {}, { events: ['settings:changed'] });
  const [k, setK] = useState('');
  const save = async (v) => { await guard(() => rpc('secrets.set', { key: 'google.tts_api_key', value: v }), v ? 'Schlüssel gespeichert' : 'Schlüssel entfernt'); setState({ secrets: await rpc('secrets.status') }); setK(''); reload(); };
  const test = async () => { await guard(() => rpc('cloudtts.test'), 'Google-Stimme funktioniert'); reload(); };
  const pct = st ? Math.min(100, Math.round((st.used / Math.max(1, st.limit)) * 100)) : 0;
  return <>
    <Field label="Beim Zocken spricht" hint={mode === 'cloud' ? 'Google rechnet die Stimme – dein PC bleibt frei fürs Spiel. Private Antworten kommen dann nur als Text ins Overlay.' : 'KI-Stimme lokal – braucht 2–3 GB Grafikspeicher neben dem Spiel'}>
      <Select value={mode} onChange={(v) => upd({ voice: { tts: { cloud: { whileGaming: v } } } }).then(reload)} options={[{ value: 'cloud', label: 'Google-Stimme (gratis)' }, { value: 'omnivoice', label: 'KI-Stimme (OmniVoice)' }]} />
    </Field>
    {mode === 'cloud' && <div class="col" style={{ gap: 6, marginBottom: 6 }}>
      {st && <div class="tiny muted">Diesen Monat {st.used.toLocaleString('de-DE')} von {st.limit.toLocaleString('de-DE')} Gratis-Zeichen · danach kommen Antworten beim Zocken bis Monatsende nur ins Overlay</div>}
      {st && <div class="bar"><i style={{ width: pct + '%' }} /></div>}
      <Field label={<span><KeyRound size={12} /> Google-Cloud-Schlüssel</span>} hint={secrets['google.tts_api_key'] ? 'eigener Schlüssel gespeichert' : st?.hasKey ? 'nutzt deinen Gemini-Schlüssel – falls „nicht freigeschaltet“ kommt: eigenen Schlüssel eintragen' : 'console.cloud.google.com → „Cloud Text-to-Speech API“ aktivieren → API-Schlüssel'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" type="password" placeholder={secrets['google.tts_api_key'] ? '••••••••••••' : 'AIza… (optional)'} value={k} onInput={(e) => setK(e.currentTarget.value)} />
          <button class="btn xs" disabled={!k} onClick={() => save(k)}>Speichern</button>{secrets['google.tts_api_key'] && <button class="btn xs ghost" onClick={() => save('')}>Entfernen</button>}
          <button class="btn xs ghost" disabled={!st?.hasKey} onClick={test}>Testen</button></div>
      </Field>
      {st?.lastError && <div class="notice tiny">{st.lastError}</div>}
      <div class="tiny muted">Stimmen: J.A.R.V.I.S. = Charon, Alya = Leda, Standard = Achird (Google Chirp 3 HD). Gesprochene Sätze werden gemerkt und kosten beim zweiten Mal nichts.</div>
    </div>}
  </>;
}

/**
 * Einstellungen → Stimme (alles an einem Ort): Profil (Standard / J.A.R.V.I.S. / Alya) mit Hörprobe, KI-Stimme
 * (OmniVoice) installieren/Status, Lautstärke und Tempo. Seltenes (Stimmen anpassen, Rückfall-Stimme) unter „Erweitert“.
 */
function VoiceSettings({ s }) {
  const t = s.voice?.tts || {}; const om = t.omni || {};
  const set = (patch) => upd({ voice: { tts: patch } });
  const setOmni = (patch) => upd({ voice: { tts: { omni: patch } } });
  const [pr] = useRpc('tts.presets', {}, { events: ['settings:changed'] });
  const presets = pr?.presets || [];
  const cur = t.preset || 'standard';
  const [om_, reloadOmni] = useRpc('omnivoice.status', {}, { initial: null, events: ['omnivoice:status'] });
  const [busy, setBusy] = useState('');
  const now = useNow(1000);
  useEffect(() => { if (!om_?.installing && !om_?.starting) return; const id = setInterval(reloadOmni, 2000); return () => clearInterval(id); }, [om_?.installing, om_?.starting]);
  const play = async (id, override = {}) => { if (busy) { audio.stopSpeech(); setBusy(''); return; } setBusy(id + (override.engine === 'cloud' ? ':g' : '')); try { await audio.speakLocal(PRESET_SAMPLES[id] || SAMPLE, { full: true, preview: true, override: { preset: id, ...override } }); } finally { setBusy(''); } };
  const installOmni = async () => {
    if (!(await ask(`KI-Stimme installieren? Lädt ca. ${om_.sizeGB} GB (Python, PyTorch, Stimmmodell) in den JARVIS-Datenordner. Dauert je nach Leitung 10–30 Minuten, du kannst JARVIS dabei normal nutzen.`, '', { confirmOnly: true, okLabel: 'Installieren' }))) return;
    await guard(() => rpc('omnivoice.install')); reloadOmni();
  };
  const ins = om_?.installing;
  const omniOn = om_?.installed && om_?.enabled;
  return (
    <Panel icon={Volume2} title="Stimme" sub="Wie JARVIS klingt: KI-Stimme lokal, beim Zocken die Google-Stimme. Auch per Sprache: „Jarvis, Stimme auf Alya“.">
      {presets.map((p) => (
        <div class="row gap-s" style={{ padding: '5px 0', alignItems: 'center' }}>
          <input type="radio" name="voice-preset" checked={cur === p.id} onChange={() => set({ preset: p.id })} />
          <span class="grow small" style={{ cursor: 'pointer' }} onClick={() => set({ preset: p.id })}><b>{p.label}</b><div class="tiny muted">{p.description}</div></span>
          <button class="btn xs" title={busy === p.id ? 'Stopp' : 'Hörprobe KI-Stimme'} onClick={() => play(p.id, { engine: 'omnivoice' })}>{busy === p.id ? <Spinner size={12} /> : <Play size={12} />}</button>
          <button class="btn xs ghost" title={busy === p.id + ':g' ? 'Stopp' : 'Hörprobe Google-Stimme (beim Zocken)'} onClick={() => play(p.id, { engine: 'cloud' })}>{busy === p.id + ':g' ? <Spinner size={12} /> : <><Play size={12} />G</>}</button>
        </div>
      ))}
      <div class="hr" />
      {/* KI-Stimme (OmniVoice) */}
      {om_ && !om_.supported && <div class="tiny muted">KI-Stimme nur unter Windows – es spricht die Google-Stimme.</div>}
      {om_?.supported && !om_.installed && !ins && <div class="notice tiny">
        <div class="row gap-s" style={{ alignItems: 'center' }}><span class="grow"><b>KI-Stimme fehlt noch</b> – bis dahin spricht die Google-Stimme (nur nicht-private Antworten). Natürlich, auch beim Zocken (ca. 2–3 GB Grafikspeicher), Download ca. {om_.sizeGB} GB.</span>
          <button class="btn sm" onClick={installOmni}><Download size={14} />Installieren</button></div>
      </div>}
      {ins && <div class="col" style={{ gap: 6 }}>
        <div class="small"><Spinner size={12} /> KI-Stimme · Schritt {ins.index + 1} von {ins.total}: <b>{ins.label}</b> · {Math.floor((now - ins.startedAt) / 60000)} min</div>
        <div class="bar"><i style={{ width: `${Math.round(((ins.index + 0.5) / ins.total) * 100)}%` }} /></div>
        {ins.detail && <div class="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ins.detail}</div>}
      </div>}
      {om_?.error && <div class="notice tiny mt"><FixText text={'KI-Stimme: ' + om_.error} /></div>}
      {om_?.installed && !ins && <Field label="KI-Stimme (OmniVoice)" hint={!om_.enabled ? 'aus – es spricht die Google-Stimme' : om_.running ? `bereit (${/cuda/.test(om_.device) ? 'Grafikkarte' : 'Prozessor'})` : om_.starting ? 'wird geladen …' : 'startet beim nächsten Satz'}><Toggle checked={om_.enabled} onChange={(v) => setOmni({ enabled: v })} /></Field>}
      <GamingVoice t={t} />
      <Field label={`Lautstärke · ${Math.round((t.volume ?? 1) * 100)} %`}><input class="range" type="range" min="0.2" max="1.5" step="0.05" value={t.volume ?? 1} onChange={(e) => set({ volume: Number(e.currentTarget.value) })} /></Field>
      <Field label={`Tempo · ${Math.round((t.speed ?? 1) * 100)} %`}><input class="range" type="range" min="0.7" max="1.5" step="0.05" value={t.speed ?? 1} onChange={(e) => set({ speed: Number(e.currentTarget.value) })} /></Field>
      <Field label="Lange Antworten kurz vorlesen" hint="liest die ersten Sätze, Rest steht im Chat"><Toggle checked={t.short !== false} onChange={(x) => set({ short: x })} /></Field>

      <details class="mt">
        <summary class="small">Erweitert</summary>
        {om_?.installed && <>
          <div class="hud-label mt">KI-Stimmen anpassen</div>
          {presets.map((p) => (
            <div class="col" style={{ gap: 4, padding: '4px 0' }}>
              <div class="row gap-s" style={{ alignItems: 'center' }}>
                <b class="small grow">{p.label}</b>
                <button class="btn xs ghost" title="Neue Stimme mit derselben Beschreibung" onClick={async () => { await guard(() => rpc('omnivoice.reroll', { preset: p.id })); play(p.id); }}><RefreshCw size={12} /> neu würfeln</button>
                {p.id !== 'standard' && ((om.seeds || {})[p.id] > 1 || (om.voices || {})[p.id]) && <button class="btn xs ghost" title="Zurück zur mitgelieferten Stimme" onClick={async () => { await guard(() => rpc('omnivoice.resetVoice', { preset: p.id })); play(p.id); }}>Original</button>}
              </div>
              <input class="inp" title={OMNI_ATTR} placeholder={p.omni} value={(om.voices || {})[p.id] || ''} onChange={(e) => setOmni({ voices: { [p.id]: e.currentTarget.value.trim().slice(0, 200) } })} />
            </div>
          ))}
          <div class="tiny muted">{OMNI_ATTR}. Leer = mitgelieferte Stimme.</div>
          <Field label="Tempo / Qualität" hint="Turbo antwortet am schnellsten, Beste klingt am saubersten (ca. doppelt so langsam wie Schnell)">
            <select class="inp" value={om.quality || 'fast'} onChange={(e) => setOmni({ quality: e.currentTarget.value })}>
              <option value="turbo">Turbo</option><option value="fast">Schnell (empfohlen)</option><option value="best">Beste</option>
            </select>
          </Field>
          <Field label="Beim Start vorladen" hint="erster Satz kommt sofort, belegt dafür dauerhaft Grafikspeicher"><Toggle checked={om.preload !== false} onChange={(v) => setOmni({ preload: v })} /></Field>
          <div class="row gap-s"><button class="btn xs ghost" onClick={() => guard(() => rpc('omnivoice.restart'), 'Neu gestartet')}>KI-Stimme neu starten</button><span class="grow" /><button class="btn xs ghost" onClick={async () => { if (await ask('KI-Stimme vollständig entfernen (gibt ca. 6 GB frei)?', '', { confirmOnly: true, danger: true, okLabel: 'Entfernen' })) await guard(() => rpc('omnivoice.remove'), 'Entfernt'); }}><Trash2 size={12} />KI-Stimme entfernen</button></div>
          <div class="hr" />
        </>}
        <div class="tiny muted mt">Ohne KI-Stimme spricht JARVIS mit der Google-Stimme – nur nicht-private Antworten. Private Antworten stehen dann nur im Chat.</div>
      </details>
    </Panel>
  );
}

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
          <VoiceSettings s={s} />
          <PetSettings s={s} />
          <Speech s={s} />
          <LocalAI s={s} />
          <Ai s={s} secrets={secrets} />
          <Google s={s} />
          <StudyCard s={s} />
          <CampusDualCard s={s} />
          <LifeCard s={s} />
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
  const [voiceLocal, refreshVoiceLocal] = useRpc('voice.localStatus', {}, { events: ['settings:changed'] });
  const [devs, setDevs] = useState({ in: [], out: [] });
  const [level, setLevel] = useState(null);
  useEffect(() => { navigator.mediaDevices.enumerateDevices().then((d) => setDevs({ in: d.filter((x) => x.kind === 'audioinput'), out: d.filter((x) => x.kind === 'audiooutput') })).catch(() => {}); }, [level !== null]);
  const test = async () => {
    if (level !== null) return;
    setLevel(0);
    try { const stop = await audio.meter(setLevel, v.inputDeviceId); setTimeout(() => { stop(); setLevel(null); }, 5000); } catch (e) { toast('Mikrofon nicht verfügbar: ' + e.message, 'error'); setLevel(null); }
  };
  return (
    <Panel icon={Mic} title="Spracheingabe" sub="Spracherkennung komplett lokal (Whisper) – Audio verlässt nie den PC">
      <Field label="Oberflächensprache"><Select value="de-DE" onChange={() => {}} options={[{ value: 'de-DE', label: 'Deutsch (DE)' }]} /></Field>
      <Field label="Mikrofon"><Select value={v.inputDeviceId} onChange={(x) => upd({ voice: { inputDeviceId: x } })} options={[{ value: 'default', label: 'Standard' }, ...devs.in.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || 'Mikrofon' }))]} /></Field>
      <Field label="Lautsprecher"><Select value={v.outputDeviceId} onChange={(x) => upd({ voice: { outputDeviceId: x } })} options={[{ value: 'default', label: 'Standard' }, ...devs.out.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || 'Ausgabe' }))]} /></Field>
      <Field label="Mikrofon testen">{level === null ? <button class="btn xs" onClick={test}><Mic size={12} />Pegel testen</button> : <div class="meter" style={{ width: '100%' }}><i style={{ width: `${level * 100}%` }} /></div>}</Field>
      <div class="notice tiny">🔒 <b>Lokale Spracheingabe:</b> Whisper ist in der Windows-Version enthalten. Mikrofon drücken, sprechen – das Audio bleibt auf dem PC; der erkannte Text wird wie getippter Text eingeordnet (privat → lokales Modell).</div>
      <div class="row gap-s mt">
        <span class="small">{voiceLocal?.ready ? (voiceLocal.bundled ? '● Whisper bereits im JARVIS-Installer enthalten – einsatzbereit' : '● Eigenes Whisper installiert – einsatzbereit') : '○ Whisper nicht gefunden: ' + (voiceLocal?.error || 'Verfügbarkeit wird geprüft …')}</span>
        <button class="btn xs" onClick={refreshVoiceLocal}>Spracherkennung prüfen</button>
      </div>
      <div class="tiny muted mt">Expertenoption: Nur wenn du bewusst eine andere Whisper-Version oder ein eigenes Modell verwenden möchtest, kannst du unten Dateien auswählen. Sonst nichts ändern.</div>
      <Field label="Offline-Engine (whisper-cli.exe)" hint={v.whisperExecutable ? v.whisperExecutable : 'Noch nicht eingerichtet'}>
        <button class="btn xs" onClick={async () => {
          const files = await guard(() => rpc('dialog.pickFiles', { kind: 'whisper-cli' }));
          if (files?.[0]) await upd({ voice: { whisperExecutable: files[0] } });
        }}><FolderOpen size={12} />{v.whisperExecutable ? 'Engine ändern' : 'Engine auswählen'}</button>
      </Field>
      <Field label="Offline-Modell (.bin)" hint={v.whisperModel ? v.whisperModel : 'Mehrsprachiges GGML-Whisper-Modell erforderlich'}>
        <button class="btn xs" onClick={async () => {
          const files = await guard(() => rpc('dialog.pickFiles', { kind: 'whisper-model' }));
          if (files?.[0]) await upd({ voice: { whisperModel: files[0] } });
        }}><FolderOpen size={12} />{v.whisperModel ? 'Modell ändern' : 'Modell auswählen'}</button>
      </Field>
      <Field label="„Hey Jarvis“ (lokal, offline)" hint="Mikrofon bleibt lokal – nichts wird übertragen, bis das Wake-Word erkannt wird"><Toggle checked={v.wakeWord} onChange={(x) => upd({ voice: { wakeWord: x } })} /></Field>
      {v.wakeWord && <Field label="Empfindlichkeit"><input class="range" type="range" min="0.2" max="0.9" step="0.05" value={v.wakeSensitivity} onChange={(e) => upd({ voice: { wakeSensitivity: Number(e.currentTarget.value) } })} /></Field>}
      <Field label="Push-to-Talk-Taste (global)"><input class="inp" value={v.pushToTalkKey} onChange={(e) => upd({ voice: { pushToTalkKey: e.currentTarget.value } })} /></Field>
      <Field label="Textantworten vorlesen" hint="Stimme siehe „Stimme“"><Toggle checked={v.speakReplies} onChange={(x) => upd({ voice: { speakReplies: x } })} /></Field>
      <Field label="Antworten auf Spracheingaben vorlesen" hint="Stimme siehe „Stimme“"><Toggle checked={v.speakVoiceReplies !== false} onChange={(x) => upd({ voice: { speakVoiceReplies: x } })} /></Field>
      <Field label="CPU-Threads für Spracherkennung" hint="beim Spielen automatisch höchstens 2, mit niedriger Priorität"><Select value={String(v.whisperThreads || 4)} onChange={(x) => upd({ voice: { whisperThreads: Number(x) } })} options={['2', '4', '6', '8'].map((n) => ({ value: n, label: n }))} /></Field>
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
  const opt = (role) => [{ value: '', label: 'Automatisch' }, ...models.filter((m) => role === 'embedding' ? /embed/.test(m) : !/embed|tts|image|live|veo|lyria|imagen|aqa/.test(m)).map((m) => ({ value: m, label: m }))];
  return (
    <Panel icon={Sparkles} title="Gemini / KI" sub="KI-Modelle und Analyse-Tools">
      <CloudControl s={s} />
      <Field label={<span><KeyRound size={12} /> API-Schlüssel</span>} hint={secrets['gemini.api_key'] ? 'gespeichert (verschlüsselt mit Windows-DPAPI)' : 'aistudio.google.com → API-Schlüssel'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" type="password" placeholder={secrets['gemini.api_key'] ? '••••••••••••' : 'AIza…'} value={key} onInput={(e) => setKey(e.currentTarget.value)} /><button class="btn xs" disabled={busy} onClick={() => test(key)}>{busy ? <Spinner size={12} /> : 'Prüfen'}</button></div>
      </Field>
      {res && !res.ok && <div class="notice warn">{res.error}</div>}
      {[['fast', 'Modell: schnelle Antworten'], ['reasoning', 'Modell: Reasoning'], ['research', 'Modell: Webrecherche'], ['vision', 'Modell: Multimodal/Seiten'], ['embedding', 'Modell: Embeddings']].map(([role, label]) => (
        <Field label={label}><Select value={s.models[role]} onChange={(v) => upd({ models: { [role]: v } })} options={opt(role)} /></Field>
      ))}
      <Field label="Denktiefe bei normalen Fragen" hint={s.aiCostMode === 'max' ? 'immer volle Denktiefe – kostet deutlich mehr' : 'kurzes Nachdenken; Analysen, Lernpläne usw. denken weiter voll'}><Select value={s.aiCostMode || 'spar'} onChange={(v) => upd({ aiCostMode: v })} options={[{ value: 'spar', label: 'Sparsam (empfohlen)' }, { value: 'max', label: 'Immer maximal' }]} /></Field>
      <Field label="Temperatur"><Select value={String(s.temperature)} onChange={(v) => upd({ temperature: Number(v) })} options={[['0.3', 'Präzise (0.3)'], ['0.7', 'Ausgewogen (0.7)'], ['1', 'Kreativ (1.0)']].map(([value, label]) => ({ value, label }))} /></Field>
      <Field label="Websuche für aktuelle Informationen"><Toggle checked={s.webSearch} onChange={(v) => upd({ webSearch: v })} /></Field>
      <Field label="Wichtiges automatisch merken (Brain)" hint="Sensibles nur auf ausdrücklichen Wunsch"><Toggle checked={s.autoMemory} onChange={(v) => upd({ autoMemory: v })} /></Field>
      {s.autoMemory && <Field label="Brain selbstständig erweitern" hint="Nach Antworten prüft JARVIS, ob etwas Dauerhaftes dabei war – private Nachrichten das lokale Modell, sonst Gemini (Sparmodell, höchstens 40×/Tag). Neue Einträge siehst du am Chat und im Brain."><Toggle checked={s.brainAutoLearn !== false} onChange={(v) => upd({ brainAutoLearn: v })} /></Field>}
      <Field label="Geburtstage aus dem Brain in den Kalender" hint="ganztägig, jährlich – nur lokal"><Toggle checked={s.birthdaysToCalendar !== false} onChange={(v) => upd({ birthdaysToCalendar: v })} /></Field>
      <div class="row mt"><button class="btn xs" disabled={busy || !secrets['gemini.api_key']} onClick={() => test('')}><RefreshCw size={12} />Modelle neu prüfen</button><span class="tiny muted grow">Diese Sitzung: {usage?.requests || 0} Anfragen · {Math.round(((usage?.inputTokens || 0) + (usage?.outputTokens || 0)) / 1000)}k Tokens</span></div>
      <BudgetField s={s} />
      <UsageTable />
      <div class="tiny muted mt">Hinweis: Ein Google-AI-Abo (Gemini App) ist nicht automatisch API-Kontingent – Limits gelten pro API-Schlüssel.</div>
    </Panel>
  );
}

function BudgetField({ s }) {
  const [st, reload] = useRpc('ai.budget', {}, { events: ['cloud:usage'] });
  const [cal, setCal] = useState('');
  const b = s.aiBudget || {};
  const eur = (v) => (v == null ? '–' : v.toFixed(2).replace('.', ',') + ' €');
  const color = st?.level === 'blocked' || st?.level === 'brake' ? 'var(--red)' : st?.level === 'warn' ? 'var(--amber, #f59e0b)' : 'var(--text-2)';
  const num = (key, label, hint, step = 0.05) => <Field label={label} hint={hint}><input class="inp" type="number" min="0" step={step} style={{ width: 90 }} value={b[key] ?? ''} onChange={(e) => upd({ aiBudget: { [key]: Math.max(0, Number(e.currentTarget.value) || 0) } }).then(reload)} /></Field>;
  return (
    <>
      <div class="hr" />
      {num('dailyEur', 'Tagesbudget (€)', 'lokaler Kalendertag; danach sperrt JARVIS weitere Gemini-Aufrufe bis Mitternacht (0 = aus)')}
      {num('sessionEur', 'Sitzungsbudget (€)', 'seit dem Start von JARVIS (0 = aus)')}
      {num('monthlyEur', 'Monatsbudget (€)', 'Warnung ab 80 %, ab 95 % Sparstufe, bei 100 % Sperre', 0.5)}
      <Field label="Bei Erreichen sperren" hint="lokale Sperre – keine garantierte Abrechnungsgrenze bei Google"><Toggle checked={b.hardStop !== false} onChange={(v) => upd({ aiBudget: { hardStop: v } }).then(reload)} /></Field>
      {st && <Field label="Verbrauch (Schätzung)"><span class="small" style={{ color, textAlign: 'right' }}>heute {eur(st.today)} / {eur(st.dailyBudget)} · Sitzung {eur(st.session)} / {eur(st.sessionBudget)} · Monat {eur(st.eur)} / {eur(st.budget)}{st.projected != null ? ` · Hochrechnung ${eur(st.projected)}` : ''}{st.blocked ? ' · GESPERRT' : st.braking ? ' · Sparstufe' : ''}{st.inflight ? ` · ${st.inflight} laufend` : ''}</span></Field>}
      {st && <div class="tiny muted">Geschätzt aus gemeldeten Token × offiziellen Listenpreisen (Stand {st.pricesAsOf}, USD) × Kurs {String(st.usdToEur).replace('.', ',')} €/$. Googles Abrechnung kann abweichen (Zeitzone, Rundung, Preisänderungen, Suche).</div>}
      <Field label="Umrechnungskurs (€ pro $)" hint="Annahme – bitte gelegentlich anpassen"><input class="inp" type="number" min="0.5" max="1.5" step="0.01" style={{ width: 90 }} value={b.usdToEur ?? 0.86} onChange={(e) => upd({ aiBudget: { usdToEur: Number(e.currentTarget.value) || 0.86 } }).then(reload)} /></Field>
      <Field label="Echten Stand aus AI Studio eintragen" hint={st?.calibrated ? `geeicht ${ago(st.calibratedAt)} – danach wird geschätzt` : 'macht die Monatsschätzung genauer (AI Studio → Abrechnung)'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" inputMode="decimal" placeholder="z. B. 0,69" value={cal} onInput={(e) => setCal(e.currentTarget.value)} /><button class="btn xs" disabled={!cal.trim()} onClick={async () => { const r = await guard(() => rpc('ai.calibrate', { eur: cal }), 'Stand übernommen'); if (r) { setCal(''); reload(); } }}>Übernehmen</button></div>
      </Field>
      <Field label="Sparstufe bei 95 % automatisch"><Toggle checked={b.brake !== false} onChange={(v) => upd({ aiBudget: { brake: v } }).then(reload)} /></Field>
      <CostReport />
    </>
  );
}

/**
 * Zweiter, kostenloser Schlüssel: Google-Projekt OHNE Abrechnung (Free Tier). JARVIS nutzt ihn zuerst für das Sparmodell
 ; ist das Tageskontingent erschöpft, geht es mit dem normalen Schlüssel (Budget) weiter.
 */
function FreeKey() {
  const secrets = useStore((x) => x.secrets) || {};
  const [k, setK] = useState('');
  const has = !!secrets['gemini.free_api_key'];
  const save = async (v) => { await guard(() => rpc('secrets.set', { key: 'gemini.free_api_key', value: v }), v ? 'Kostenloser Schlüssel gespeichert' : 'Kostenloser Schlüssel entfernt'); setState({ secrets: await rpc('secrets.status') }); setK(''); };
  return <>
    <Field label={<span><KeyRound size={12} /> Kostenloser Zusatz-Schlüssel (optional)</span>} hint={has ? 'gespeichert – wird zuerst für das Sparmodell genutzt' : 'aistudio.google.com → neues Projekt ohne Abrechnung → API-Schlüssel'}>
      <div class="row gap-s" style={{ width: '100%' }}><input class="inp" type="password" placeholder={has ? '••••••••••••' : 'AIza… (Projekt ohne Abrechnung)'} value={k} onInput={(e) => setK(e.currentTarget.value)} />
        <button class="btn xs" disabled={!k} onClick={() => save(k)}>Speichern</button>{has && <button class="btn xs ghost" onClick={() => save('')}>Entfernen</button>}</div>
    </Field>
    <div class="tiny muted">Hinweis: Im kostenlosen Kontingent darf Google Eingaben und Antworten zur Verbesserung seiner Produkte verwenden. JARVIS schickt darüber nur kurze Gaming-Aufgaben (Tipps, Kurzfassungen) – nie private Inhalte.</div>
  </>;
}

/**
 * Groq (kostenlos): öffentliche Fragen zuerst dort – sehr schnell, Free-Plan ca. 1 000 Anfragen/Tag. Ist das Kontingent
 * leer oder Groq gestört, übernimmt Gemini (Budget), danach das lokale Modell. Private Nachrichten nie.
 */
function GroqKey({ s }) {
  const secrets = useStore((x) => x.secrets) || {};
  const [k, setK] = useState('');
  const [st, reload] = useRpc('groq.status', {}, { events: ['settings:changed', 'cloud:usage'] });
  const has = !!secrets['groq.api_key'];
  const save = async (v) => {
    if (v) await guard(() => rpc('groq.test', { key: v }));
    await guard(() => rpc('secrets.set', { key: 'groq.api_key', value: v }), v ? 'Groq-Schlüssel gespeichert' : 'Groq-Schlüssel entfernt');
    setState({ secrets: await rpc('secrets.status') }); setK(''); reload();
  };
  const g = s.cloud?.groq || {};
  return <>
    <Field label={<span><KeyRound size={12} /> Groq – kostenlos & schnell</span>} hint={has ? (g.enabled === false ? 'aus' : `aktiv · heute ${st?.today ?? 0} Anfragen${st?.pausedUntil ? ' · Kontingent gerade leer, Gemini übernimmt' : ''}`) : 'console.groq.com → API Keys (kostenlos, ohne Kreditkarte)'}>
      <div class="row gap-s" style={{ width: '100%' }}><input class="inp" type="password" placeholder={has ? '••••••••••••' : 'gsk_…'} value={k} onInput={(e) => setK(e.currentTarget.value)} />
        <button class="btn xs" disabled={!k} onClick={() => save(k.trim())}>Speichern</button>{has && <button class="btn xs ghost" onClick={() => save('')}>Entfernen</button>}</div>
    </Field>
    {has && <Field label="Öffentliche Fragen zuerst über Groq" hint="Reihenfolge: Groq → Gemini (Budget) → lokales Modell. Private Nachrichten bleiben immer lokal."><Toggle checked={g.enabled !== false} onChange={(v) => upd({ cloud: { groq: { enabled: v } } }).then(reload)} /></Field>}
  </>;
}

/** Modus lokal/hybrid und einzelne Cloud-Funktionen – durchgesetzt im Hauptprozess (Gemini-Provider). */
function CloudControl({ s }) {
  const [st, reload] = useRpc('cloud.status', {}, { events: ['settings:changed', 'cloud:state', 'cloud:usage'] });
  const c = s.cloud || {};
  const labels = st?.labels || {};
  const local = c.mode === 'local';
  return (
    <>
      <Field label="Modus" hint={local ? 'Keine externen KI-Aufrufe. Uni-/Gaming-Chats nutzen das lokale Modell (falls eingerichtet).' : 'Gemini nur in Uni-/Gaming-Chats und für eingeschaltete Funktionen – private Chats bleiben lokal.'}>
        <Select value={c.mode || 'hybrid'} onChange={(mode) => guard(() => rpc('cloud.setMode', { mode })).then(reload)} options={[{ value: 'hybrid', label: 'Sparsam hybrid (Gemini nur wo nötig)' }, { value: 'local', label: 'Strikt lokal (keine Cloud-KI)' }]} />
      </Field>
      {!local && <details class="mt">
        <summary class="small">Cloud-Funktionen einzeln ({Object.keys(labels).filter((k) => !['meta', 'diagnostics'].includes(k) && c.features?.[k] !== false).length} von {Object.keys(labels).length - 2} an)</summary>
        {Object.entries(labels).filter(([k]) => !['meta', 'diagnostics'].includes(k)).map(([k, label]) => (
          <Field label={label}><Toggle checked={c.features?.[k] !== false} onChange={(v) => upd({ cloud: { features: { [k]: v } } }).then(reload)} /></Field>
        ))}
      </details>}
      {!local && <>
        <Field label="Sparmodell für kurze Aufgaben" hint="Tipps, Matchup-Karten, Empfehlungen, Kurzfassungen mit Flash-Lite (deutlich günstiger als Flash)"><Toggle checked={c.economy !== false} onChange={(v) => upd({ cloud: { economy: v } }).then(reload)} /></Field>
        <Field label="Gaming-Chats mit dem Sparmodell" hint="„gründlich/analysiere …“-Fragen und Bilder nutzen weiter Flash"><Toggle checked={c.liteGamingChat !== false} onChange={(v) => upd({ cloud: { liteGamingChat: v } }).then(reload)} /></Field>
        <GroqKey s={s} />
        <FreeKey />
      </>}
      {st && <div class="tiny muted mt">{local ? 'Cloud-KI aus.' : `Cloud-KI an · ${st.active || 0} Aufruf(e) laufen gerade`}</div>}
    </>
  );
}

function CostReport() {
  const [rows] = useRpc('ai.report', { days: 7 }, { events: ['cloud:usage'] });
  if (!rows?.length) return null;
  const eur = (v) => v.toFixed(3).replace('.', ',') + ' €';
  return (
    <details class="mt">
      <summary class="small">Kosten letzte 7 Tage pro Funktion und Modell (Schätzung)</summary>
      <table class="small" style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse' }}>
        <thead><tr class="muted tiny"><th style={{ textAlign: 'left' }}>Funktion</th><th style={{ textAlign: 'left' }}>Modell</th><th style={{ textAlign: 'right' }}>Aufrufe</th><th style={{ textAlign: 'right' }}>€</th></tr></thead>
        <tbody>{rows.map((r) => <tr><td>{FEATURE_LABEL[r.feature] || r.feature}</td><td class="tiny">{r.model}</td><td style={{ textAlign: 'right' }}>{r.requests}{r.failed ? ` (${r.failed} abgelehnt)` : ''}</td><td style={{ textAlign: 'right' }}>{eur(r.eur)}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

const FEATURE_LABEL = { chat: 'Chat', research: 'Webrecherche', vision: 'Bildschirm', study: 'Seiten lesen', lol: 'LoL-Analysen', news: 'Patch-Notes', games: 'Spielseiten', wikilist: 'Checklisten', diagnostics: 'Verbindungstest', embeddings: 'Suche (Embeddings)', other: 'Sonstiges' };
const kTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' Mio' : Math.round(n / 1000) + 'k');
function UsageTable() {
  const [rep] = useRpc('gemini.usageReport', { days: 7 }, {});
  const rows = Object.entries(rep?.features || {}).sort((a, b) => (b[1].in + b[1].out * 8 + b[1].think * 8) - (a[1].in + a[1].out * 8 + a[1].think * 8));
  if (!rows.length) return <div class="tiny muted mt">Verbrauch: noch keine Daten (wird ab jetzt pro Funktion gezählt).</div>;
  return (
    <details class="mt">
      <summary class="small">Verbrauch letzte 7 Tage (pro Funktion)</summary>
      <table class="small" style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse' }}>
        <thead><tr class="muted tiny"><th style={{ textAlign: 'left' }}>Funktion</th><th style={{ textAlign: 'right' }}>Anfragen</th><th style={{ textAlign: 'right' }} title="Eingabe-Token, davon aus Googles Cache (günstiger)">Eingabe (Cache)</th><th style={{ textAlign: 'right' }} title="Antwort- + Denk-Token – kosten pro Token ein Vielfaches der Eingabe">Ausgabe + Denken</th></tr></thead>
        <tbody>{rows.map(([f, x]) => <tr key={f}><td>{FEATURE_LABEL[f] || f}</td><td style={{ textAlign: 'right' }}>{x.req}</td><td style={{ textAlign: 'right' }}>{kTok(x.in)}{x.in ? ` (${Math.round((100 * x.cached) / x.in)} %)` : ''}</td><td style={{ textAlign: 'right' }}>{kTok(x.out)} + {kTok(x.think)}</td></tr>)}</tbody>
      </table>
      <div class="tiny muted" style={{ marginTop: 4 }}>Ausgabe- und Denk-Token kosten pro Token ein Vielfaches der Eingabe, Cache-Token nur einen Bruchteil. Genaue Euro-Beträge zeigt Google AI Studio → Abrechnung.</div>
    </details>
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
    <Panel icon={CalendarDays} title="Kalender & Google" sub="Google nur lesen · neue Termine bleiben lokal">
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
          <Field label="Neue Termine bleiben immer lokal (Private)"><Select disabled value={s.google.defaultCalendarId} onChange={(v) => upd({ google: { defaultCalendarId: v } })} options={[{ value: '', label: 'Hauptkalender' }, ...cals.filter((c) => c.writable && c.id !== 'local').map((c) => ({ value: c.id, label: c.name }))]} /></Field>
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
      <Field label="Prüfungstermine in den Klausurmodus" hint={st?.exams ? `zuletzt ${ago(st.exams.at)}: ${st.exams.found} Prüfungen gefunden${st.exams.created ? `, ${st.exams.created} neu` : ''}` : 'aus Stundenplan (Klausur/Prüfung im Titel) und Prüfungsanmeldung'}>
        <div class="row gap-s"><button class="btn xs" disabled={!!busy} onClick={async () => { setBusy('exams'); const x = await guard(() => rpc('campusdual.syncExams')); if (x) toast(x.created ? `${x.created} Prüfung(en) im Klausurmodus angelegt` : `${x.found} Prüfung(en) gefunden – nichts Neues`); setBusy(''); load(); }}>{busy === 'exams' ? <Spinner /> : null}Jetzt suchen</button><Toggle checked={s.campusDualExams?.enabled !== false} onChange={(v) => upd({ campusDualExams: { enabled: v } })} /></div>
      </Field>
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

function LifeCard({ s }) {
  const l = s.life || {};
  return (
    <Panel icon={Wallet} title="Alltag" sub="Ausgaben, Einkauf, Geburtstage – alles bleibt auf deinem PC">
      <Field label="Monatsbudget (€)" hint="0 = kein Budget; Abos zählen mit"><input class="inp" type="number" min="0" step="10" style={{ width: 100 }} value={l.budgetMonthly ?? 0} onChange={(e) => upd({ life: { budgetMonthly: Math.max(0, Number(e.currentTarget.value) || 0) } })} /></Field>
      <Field label="Gekauftes automatisch in die Vorräte"><Toggle checked={l.boughtToPantry !== false} onChange={(v) => upd({ life: { boughtToPantry: v } })} /></Field>
      <Field label="„Wann muss ich los?“-Meldungen" hint="Für Termine mit Ort – Haltestelle auf der Alltag-Seite einstellen"><Toggle checked={s.transit?.enabled !== false} onChange={(v) => upd({ transit: { enabled: v } })} /></Field>
      <Field label="Ankunft vor Terminbeginn (Minuten)"><input class="inp" type="number" min="0" max="60" style={{ width: 90 }} value={s.transit?.bufferMin ?? 5} onChange={(e) => upd({ transit: { bufferMin: Math.max(0, Math.min(60, Number(e.currentTarget.value) || 0)) } })} /></Field>
      <Field label="Meldung vor Abfahrt (Minuten)"><input class="inp" type="number" min="0" max="60" style={{ width: 90 }} value={s.transit?.notifyBeforeMin ?? 10} onChange={(e) => upd({ transit: { notifyBeforeMin: Math.max(0, Math.min(60, Number(e.currentTarget.value) || 0)) } })} /></Field>
      <Field label="Fahrplan-API" hint="Öffentliche db-rest-Instanz (transport.rest); bei Ausfall eigene Instanz eintragen"><input class="inp" style={{ width: 260 }} value={s.transit?.api || ''} onChange={(e) => upd({ transit: { api: e.currentTarget.value.trim() } })} /></Field>
      <Field label="Abgaben-Erinnerungen"><Toggle checked={s.deadlines?.enabled !== false} onChange={(v) => upd({ deadlines: { enabled: v } })} /></Field>
      <Field label="Abgaben aus Gmail vorschlagen" hint="Nur lesend (Betreff + Vorschau); Verbinden auf der Alltag-/Studium-Seite"><Toggle checked={s.deadlines?.mail === true} onChange={(v) => upd({ deadlines: { mail: v } })} /></Field>
      <Field label="Geburtstage: 1 Woche vorher mit Geschenkideen" hint="Ideen aus dem, was im Brain über die Person steht (kleiner Gemini-Aufruf)"><Toggle checked={l.birthdayGifts !== false} onChange={(v) => upd({ life: { birthdayGifts: v } })} /></Field>
    </Panel>
  );
}

const GAMING_TABS = [['general', 'Allgemein'], ['lol', 'League of Legends'], ['eft', 'Tarkov'], ['other', 'Weitere Spiele']];
function GamingCard({ s, secrets }) {
  const g = s.gaming;
  const [riotKey, setRiotKey] = useState('');
  const [pubgKey, setPubgKey] = useState('');
  const [installed, , st] = useRpc('game.installed', {}, { initial: [] });
  const [tab, setTabRaw] = useState(() => { try { return localStorage.getItem('settings.gamingTab') || 'general'; } catch { return 'general'; } });
  const setTab = (t) => { setTabRaw(t); try { localStorage.setItem('settings.gamingTab', t); } catch { /* egal */ } };
  return (
    <Panel icon={Gamepad2} title="Gaming" sub="Spiele und Integrationen">
      <div class="tabs sm mb" style={{ flexWrap: 'wrap' }}>{GAMING_TABS.map(([k, l]) => <button class={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'general' && <>
      <Field label="Spielerkennung aktivieren (Prozesse)"><Toggle checked={g.detection} onChange={(v) => upd({ gaming: { detection: v } })} /></Field>
      <Field label="Ressourcen beim Spielen reduzieren"><Toggle checked={g.reduceWhileGaming} onChange={(v) => upd({ gaming: { reduceWhileGaming: v } })} /></Field>
      <Field label="Erkannte Spiele"><span class="small muted" style={{ textAlign: 'right' }}>{st.loading ? '…' : installed.map((p) => p.short || p.name).join(', ') || 'keine'}</span></Field>
      <Field label="„Wo war ich?“ beim Spielstart" hint="Kurzer Recap aus Notizen und Spielstand, wenn du ein Spiel ≥ 3 Tage nicht gespielt hast"><Toggle checked={g.gameRecap !== false} onChange={(v) => upd({ gaming: { gameRecap: v } })} /></Field>
      <Field label="Pausen-Erinnerung (Minuten am Stück)" hint="0 = aus"><input class="inp" type="number" min="0" max="600" step="15" style={{ width: 90 }} value={g.breakReminderMin ?? 0} onChange={(e) => upd({ gaming: { breakReminderMin: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)) } })} /></Field>
      <Field label="Patch-Notes-Wächter" hint="Offizielle News deiner Spiele (Steam, LoL) alle 6 Stunden"><Toggle checked={g.patchNotes !== false} onChange={(v) => upd({ gaming: { patchNotes: v } })} /></Field>
      <Field label="Patch-Notes: KI-Kurzfassung" hint="Nur für Spiele der letzten 14 Tage, höchstens 6 pro Tag"><Toggle checked={g.patchSummaries !== false} onChange={(v) => upd({ gaming: { patchSummaries: v } })} /></Field>
      <div class="hr" />
      <Field label="Steam: Game-Seiten automatisch anlegen" hint="Für jedes Steam-Spiel mit Spielzeit – stündlich geprüft, lokal aus Steam gelesen"><Toggle checked={g.steamAutoImport !== false} onChange={(v) => upd({ gaming: { steamAutoImport: v } })} /></Field>
      <Field label="… ab Spielzeit (Minuten)"><input class="inp" type="number" min="0" style={{ width: 90 }} value={g.steamMinMinutes ?? 1} onChange={(e) => upd({ gaming: { steamMinMinutes: Math.max(0, Number(e.currentTarget.value) || 0) } })} /></Field>
      <Field label="Steam-Ordner (nur falls nicht gefunden)"><div class="row gap-s" style={{ width: '100%' }}><input class="inp" readOnly value={g.steamDir || ''} placeholder="automatisch" /><button class="btn icon xs" onClick={async () => { const f = await rpc('dialog.pickFolder'); if (f) upd({ gaming: { steamDir: f } }); }}><FolderOpen size={14} /></button></div></Field>
      <Field label="Steam-Wunschliste: Angebote melden" hint="Wunschliste muss öffentlich sein"><Toggle checked={g.wishlistAlerts !== false} onChange={(v) => upd({ gaming: { wishlistAlerts: v } })} /></Field>
      <Field label="Ab Rabatt (%)"><input class="inp" type="number" min="0" max="100" step="5" style={{ width: 90 }} value={g.wishlistMinDiscount ?? 30} onChange={(e) => upd({ gaming: { wishlistMinDiscount: Math.min(100, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))) } })} /></Field>
      </>}
      {tab === 'lol' && <>
      <div class="notice small">League of Legends: Matchhistorie und Rang werden aus dem laufenden League-Client gelesen – <b>kein API-Schlüssel nötig</b>. Riot-ID/Schlüssel unten nur, wenn du Daten auch ohne geöffneten Client willst.</div>
      <Field label="Eigene LoL-Matches im Gaming-Cloud-Chat verwenden" hint="Standard: aus. Bei Aktivierung können Matchdaten und Statistiken zur Beantwortung deiner League-Fragen an Gemini übertragen werden. Kein Audio, keine Riot-Zugangsdaten.">
        <Toggle checked={g.lolCloudShare === true} onChange={async (v) => {
          if (v && !window.confirm('Eigene League-Matchhistorie und Auswertungen bei Gaming-Cloud-Fragen an Google Gemini übermitteln? Du kannst dies jederzeit ausschalten.')) return;
          await upd({ gaming: { lolCloudShare: v } });
        }} />
      </Field>
      <Field label="League-Ordner (nur falls nicht Standard)"><div class="row gap-s" style={{ width: '100%' }}><input class="inp" readOnly value={g.leagueDir} placeholder="automatisch" /><button class="btn icon xs" onClick={async () => { const f = await rpc('dialog.pickFolder'); if (f) upd({ gaming: { leagueDir: f } }); }}><FolderOpen size={14} /></button></div></Field>
      <Field label="Riot-ID (Name#TAG, optional)"><input class="inp" value={g.riotId} onChange={(e) => upd({ gaming: { riotId: e.currentTarget.value.trim() } })} placeholder="Name#EUW" /></Field>
      <Field label="Region"><Select value={g.riotRegion} onChange={(v) => upd({ gaming: { riotRegion: v } })} options={['euw1', 'eun1', 'na1', 'kr', 'br1', 'la1', 'la2', 'oc1', 'tr1', 'ru', 'jp1']} /></Field>
      <Field label="Riot-API-Schlüssel (optional)" hint={secrets['riot.api_key'] ? 'gespeichert' : 'nicht nötig, wenn der Client läuft'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" type="password" placeholder={secrets['riot.api_key'] ? '••••••••' : 'RGAPI-…'} value={riotKey} onInput={(e) => setRiotKey(e.currentTarget.value)} /><button class="btn xs" onClick={async () => { await guard(() => rpc('secrets.set', { key: 'riot.api_key', value: riotKey }), 'Gespeichert'); setRiotKey(''); setState({ secrets: await rpc('secrets.status') }); }}>OK</button></div>
      </Field>
      <div class="hr" />
      <Field label="LoL Live-Coach (deine Werte im Match)" hint="Nur Einordnung gegen deinen Schnitt und deine Ziele – keine Anweisungen, keine Gegner-Timer (Riot-Regeln). Notizen im Spiel: „Jarvis, notier: …“ – landen in der Nachbesprechung."><Toggle checked={g.lolLiveCoach} onChange={(v) => upd({ gaming: { lolLiveCoach: v } })} /></Field>
      <Field label="LoL Matchup-Karte (Championauswahl)" hint="Phasen, Win-Condition, deine Bilanz und Notizen zum Lane-Gegner – KI-Wissen einmal pro Matchup und Patch"><Toggle checked={g.lolMatchupCard !== false} onChange={(v) => upd({ gaming: { lolMatchupCard: v } })} /></Field>
      <Field label="LoL Tipps gegen die Gegner (auch im Overlay)" hint="Gefährlichste Fähigkeit + konkrete Konter-Tipps je gegnerischem Champion – vor dem Spiel erzeugt (Sparmodell, pro Patch gespeichert), ohne Cloud: Riots eigene Tipps"><Toggle checked={g.lolEnemyTips !== false} onChange={(v) => upd({ gaming: { lolEnemyTips: v } })} /></Field>
      <Field label="LoL Champion-Empfehlung in der Championauswahl" hint="Aus deinem eigenen Pool und deiner Bilanz gegen diese Gegner; optional kurze KI-Begründung (Sparmodell)"><Toggle checked={g.lolPickAdvice !== false} onChange={(v) => upd({ gaming: { lolPickAdvice: v } })} /></Field>
      <Field label="LoL Championauswahl: Matchup-Tipps" hint="Nur Champions, keine Spielerdaten"><Toggle checked={g.lolChampSelect !== false} onChange={(v) => upd({ gaming: { lolChampSelect: v } })} /></Field>
      <Field label="LoL Objective-Timer im Overlay" hint="Drache, Baron, Herold, Grubs, Atakhan – Respawns aus echten Kills"><Toggle checked={g.lolObjectives !== false} onChange={(v) => upd({ gaming: { lolObjectives: v } })} /></Field>
      {g.lolObjectives !== false && <Field label="Erste Spawnzeiten (Min.)" hint="Standardwerte; nach einem Patch hier anpassen">
        <div class="row gap-s" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>{[['dragon', 'Drache', 5], ['grubs', 'Grubs', 8], ['herald', 'Herold', 15], ['atakhan', 'Atakhan', 20], ['baron', 'Baron', 25]].map(([k, l, d]) => (
          <label class="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{l}<input class="inp" type="number" min="0" max="60" step="0.25" style={{ width: 58 }} value={(g.lolObjectiveTimes?.[k] ?? d * 60) / 60} onChange={(e) => upd({ gaming: { lolObjectiveTimes: { ...(g.lolObjectiveTimes || {}), [k]: Math.round(Math.max(0, Number(e.currentTarget.value) || 0) * 60) } } })} /></label>))}</div>
      </Field>}
      <Field label="LoL Nachbesprechung nach jedem Spiel"><Toggle checked={g.lolReview !== false} onChange={(v) => upd({ gaming: { lolReview: v } })} /></Field>
      {g.lolReview !== false && <Field label="… mit KI-Zusammenfassung (Gemini)"><Toggle checked={g.lolReviewAi !== false} onChange={(v) => upd({ gaming: { lolReviewAi: v } })} /></Field>}
      <Field label="LoL Pause-Hinweis nach Niederlagen" hint="Nur wenn deine eigene Statistik nach Niederlagen-Serien deutlich schlechter ist"><Toggle checked={g.lolBreakHint !== false} onChange={(v) => upd({ gaming: { lolBreakHint: v } })} /></Field>
      <Field label="LoL Wochenbericht (montags)"><Toggle checked={g.lolWeekly !== false} onChange={(v) => upd({ gaming: { lolWeekly: v } })} /></Field>
      </>}
      {tab === 'eft' && <TarkovTrackerField />}
      {tab === 'other' && <>
      <Field label="PUBG-API-Schlüssel" hint={secrets['pubg.api_key'] ? 'gespeichert' : 'kostenlos auf developer.pubg.com – für die Match-Nachbesprechung'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" type="password" placeholder={secrets['pubg.api_key'] ? '••••••••' : 'eyJ…'} value={pubgKey} onInput={(e) => setPubgKey(e.currentTarget.value)} /><button class="btn xs" onClick={async () => { await guard(() => rpc('secrets.set', { key: 'pubg.api_key', value: pubgKey }), 'Gespeichert'); setPubgKey(''); setState({ secrets: await rpc('secrets.status') }); }}>OK</button></div>
      </Field>
      <Field label="PUBG-Spielername"><input class="inp" style={{ width: 200 }} value={g.pubgName || ''} onChange={(e) => upd({ gaming: { pubgName: e.currentTarget.value.trim() } })} /></Field>
      <div class="hr" />
      <Field label="CS2: Spielzustand auswerten (Valve GSI)" hint="Einrichten auf der CS2-Seite"><Toggle checked={g.cs2Gsi !== false} onChange={(v) => upd({ gaming: { cs2Gsi: v } })} /></Field>
      <Field label="Assetto Corsa: Telemetrie auswerten"><Toggle checked={g.acTelemetry !== false} onChange={(v) => upd({ gaming: { acTelemetry: v } })} /></Field>
      <Field label="ARK: Prägungs-Intervall (Stunden)" hint="Standard 8 h, auf Servern mit anderen Raten anpassen"><input class="inp" type="number" min="0.1" max="48" step="0.25" style={{ width: 90 }} value={g.arkCuddleHours ?? 8} onChange={(e) => upd({ gaming: { arkCuddleHours: Math.max(0.1, Number(e.currentTarget.value) || 8) } })} /></Field>
      <div class="hr" />
      <Aion2Settings g={g} />
      </>}
    </Panel>
  );
}

function Aion2Settings({ g }) {
  const a = g.aion2 || {};
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  return <>
    <Field label="AION 2: Server-Region" hint="für Event-Zeiten (Kaira, Belagerung) in Serverzeit"><Select value={a.region || 'eu'} onChange={(v) => upd({ gaming: { aion2: { region: v } } })} options={[{ value: 'eu', label: 'Europa' }, { value: 'na-east', label: 'NA Ost' }, { value: 'na-west', label: 'NA West' }]} /></Field>
    <Field label="AION 2: täglicher Reset (Serverzeit)" hint="lässt sich auch auf der AION-2-Seite aus dem Countdown im Spiel übernehmen"><input class="inp" type="time" style={{ width: 110 }} value={a.resetTime || '05:00'} onChange={(e) => /^\d{2}:\d{2}$/.test(e.currentTarget.value) && upd({ gaming: { aion2: { resetTime: e.currentTarget.value } } })} /></Field>
    <Field label="AION 2: wöchentlicher Reset"><Select value={a.weeklyDay ?? 3} onChange={(v) => upd({ gaming: { aion2: { weeklyDay: Number(v) } } })} options={days.map((d, i) => ({ value: i, label: d }))} /></Field>
  </>;
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
      <EftLogField canWrite={!!st?.canWrite} configured={!!st?.configured} />
    </>
  );
}

/** Quest-Meldungen aus dem Tarkov-Log (wie TarkovMonitor) → Spielstand + TarkovTracker. */
function EftLogField({ canWrite, configured }) {
  const g = useStore((x) => x.settings?.gaming) || {};
  const [st, reload] = useRpc('eft.logStatus', {}, { deps: [g.eftDir, g.eftScreenshotsDir] });
  return (
    <>
      <Field label="Quests aus dem Tarkov-Log übernehmen" hint={!configured ? 'trägt angenommene/erledigte Quests in „Mein Spielstand“ ein' : canWrite ? 'erledigte/fehlgeschlagene Quests gehen automatisch an TarkovTracker' : 'Token hat nur Leserecht – für automatisches Übertragen ein Token mit Schreibrecht verbinden'}><Toggle checked={g.eftLogWatch !== false} onChange={(v) => upd({ gaming: { eftLogWatch: v } })} /></Field>
      {g.eftLogWatch !== false && <Field label="Tarkov-Ordner" hint={st?.dir ? (st.watching ? 'wird gerade mitgelesen' : 'gefunden – wird beim Spielstart mitgelesen') : 'nicht gefunden – bitte den Spielordner wählen (enthält „Logs“)'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" readOnly value={g.eftDir || st?.dir || ''} placeholder="automatisch" /><button class="btn icon xs" onClick={async () => { const f = await rpc('dialog.pickFolder'); if (f) { await upd({ gaming: { eftDir: f } }); reload(); } }}><FolderOpen size={14} /></button></div>
      </Field>}
      {g.eftLogWatch !== false && <Field label="Position auf der Karte (Screenshots)" hint={st?.screenshots ? 'Im Raid die Screenshot-Taste drücken (Standard: Druck) – JARVIS zeigt dich mit Blickrichtung auf der Karte und im Overlay' : 'Tarkov-Screenshot-Ordner nicht gefunden (Dokumente\\Escape from Tarkov\\Screenshots) – bitte wählen'}>
        <div class="row gap-s" style={{ width: '100%' }}><input class="inp" readOnly value={g.eftScreenshotsDir || st?.screenshots || ''} placeholder="automatisch" /><button class="btn icon xs" onClick={async () => { const f = await rpc('dialog.pickFolder'); if (f) { await upd({ gaming: { eftScreenshotsDir: f } }); reload(); } }}><FolderOpen size={14} /></button></div>
      </Field>}
      {g.eftLogWatch !== false && <Field label="Raid-Begleiter: Meldungen" hint="aus den Tarkov-Logs, wie TarkovMonitor">
        <div class="row gap-s" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>{[['matchFound', 'Match gefunden'], ['raidStart', 'Raid startet'], ['runthrough', 'Runthrough vorbei'], ['scavReady', 'Scav bereit'], ['fleaSold', 'Flohmarkt verkauft'], ['speak', 'vorlesen']].map(([k, l]) => (
          <label class="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Toggle checked={(g.eftAlerts || {})[k] !== undefined ? g.eftAlerts[k] : k !== 'speak'} onChange={(v) => upd({ gaming: { eftAlerts: { ...(g.eftAlerts || {}), [k]: v } } })} />{l}</label>))}</div>
      </Field>}
      {g.eftLogWatch !== false && <Field label="Scav-Abklingzeit (Basis, Min.)" hint="ohne Hideout-Boni; gebaute Boni werden automatisch abgezogen"><input class="inp" type="number" min="1" max="60" style={{ width: 70 }} value={g.eftScavCooldownMin ?? 25} onChange={(e) => upd({ gaming: { eftScavCooldownMin: Math.max(1, Number(e.currentTarget.value) || 25) } })} /></Field>}
      <Field label="Schnell-Scan-Taste (nur Item-Wert, optional)" hint="„Was ist das?“ erkennt in Tarkov Items am Mauszeiger schon mit. Diese Taste ist der schnellere Weg nur für den Wert – leer lassen zum Abschalten. Nur aktiv, solange Tarkov läuft."><input class="inp" style={{ width: 140 }} value={g.eftScanHotkey || ''} placeholder="Alt+Shift+S" onChange={(e) => upd({ gaming: { eftScanHotkey: e.currentTarget.value.trim() } })} /></Field>
      {g.eftLogWatch !== false && <Field label="Positions-Screenshots in eigenen Ordner" hint="werden nach dem Lesen in „Screenshots\\JARVIS Positionen“ verschoben – dein Screenshot-Ordner bleibt sauber">
        <div class="row gap-s"><span class="tiny muted">löschen nach</span><input class="inp" type="number" min="0" max="365" title="0 = nie löschen" style={{ width: 60 }} value={g.eftShotKeepDays ?? 7} onChange={(e) => upd({ gaming: { eftShotKeepDays: Math.max(0, Number(e.currentTarget.value) || 0) } })} /><span class="tiny muted">Tagen</span><Toggle checked={g.eftMoveShots !== false} onChange={(v) => upd({ gaming: { eftMoveShots: v } })} /></div>
      </Field>}
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
      <Field label="Tarkov: Karte oben links" hint="Raid-Karte mit Exits (PMC/Scav), Transits, Markern und deiner Position – erscheint, solange Tarkov läuft"><Toggle checked={o.mapCorner !== false} onChange={(v) => upd({ overlay: { mapCorner: v } })} /></Field>
      {o.mapCorner !== false && <Field label={`… Größe · ${o.mapSize || 320} px`}><input class="range" type="range" min="200" max="600" step="20" value={o.mapSize || 320} onChange={(e) => upd({ overlay: { mapSize: Number(e.currentTarget.value) } })} /></Field>}
      {o.mapCorner !== false && <Field label="… auf deine Position zoomen" hint="nach einem Screenshot 5 Minuten lang"><Toggle checked={o.mapZoom !== false} onChange={(v) => upd({ overlay: { mapZoom: v } })} /></Field>}
      <Field label="Overlay ein/aus (Hotkey)"><input class="inp" value={o.hotkey} onChange={(e) => upd({ overlay: { hotkey: e.currentTarget.value } })} /></Field>
      <Field label="Overlay bedienen (Hotkey)" hint="Macht es 20 s lang klickbar"><input class="inp" value={o.interactHotkey} onChange={(e) => upd({ overlay: { interactHotkey: e.currentTarget.value } })} /></Field>
      <div class="hr" />
      <Field label="„Was ist das?“ – Bildschirm fragen" hint="Screenshot nur auf Tastendruck/Befehl; bleibt lokal, nur dieses Bild geht an Gemini. In Tarkov: Maus aufs Item halten → auch Wert, Wert pro Slot und ob du es behalten solltest"><Toggle checked={sc.enabled !== false} onChange={(v) => upd({ screen: { enabled: v } })} /></Field>
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

function PrivacyData() {
  const [d, reload] = useRpc('privacy.summary', {}, {});
  const kb = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round((b || 0) / 1024) + ' KB');
  const clear = async (what, label) => { if (await ask(`${label} wirklich löschen?`, '', { confirmOnly: true, okLabel: 'Löschen' })) { await guard(() => rpc('privacy.clear', { what }), label + ' gelöscht'); reload(); } };
  if (!d) return null;
  return (
    <details class="mt">
      <summary class="small">Gespeicherte Daten verwalten</summary>
      <div class="conn-row"><span>Screenshots ({d.screenshots.files} Dateien, {kb(d.screenshots.bytes)})</span><button class="btn xs" onClick={() => clear('screenshots', 'Screenshots')}>Löschen</button></div>
      <div class="conn-row"><span>Diagnose-Protokolle ({kb(d.logs.bytes)}, ohne Schlüssel)</span><button class="btn xs" onClick={() => clear('logs', 'Protokolle')}>Leeren</button></div>
      <div class="conn-row"><span>Spieldaten-Cache ({d.gameCache.entries} Einträge, öffentliche Daten)</span><button class="btn xs" onClick={() => clear('gameCache', 'Spieldaten-Cache')}>Löschen</button></div>
      <div class="conn-row"><span>Cloud-Verbrauchsprotokoll ({d.aiLedger.entries}; {d.aiLedger.note})</span><button class="btn xs" onClick={() => clear('aiLedger', 'Ältere Verbrauchseinträge')}>Ältere löschen</button></div>
      <div class="tiny muted">Gespräche ({d.conversations.count}) löschst du im Chat einzeln. Audio wird nie gespeichert.</div>
    </details>
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
      <Field label="Bildschirmanalyse: nur das Spielfenster aufnehmen" hint="sonst der ganze Bildschirm unter dem Mauszeiger"><Toggle checked={s.screen?.preferGameWindow !== false} onChange={(v) => upd({ screen: { preferGameWindow: v } })} /></Field>
      <Field label="Screenshots nach der Analyse behalten" hint="Standard aus: Bild wird nur für die eine Frage verwendet"><Toggle checked={s.screen?.keepScreenshots === true} onChange={(v) => upd({ screen: { keepScreenshots: v } })} /></Field>
      <PrivacyData />
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
      <Field label="Gleiche Pop-ups frühestens wieder nach (Minuten)"><input class="inp" type="number" min="0" max="1440" value={s.notificationCooldownMinutes ?? 10} onChange={e => upd({ notificationCooldownMinutes: Math.max(0, Math.min(1440, Number(e.currentTarget.value) || 0)) })} /></Field>
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
        <button class="btn xs" onClick={async () => {
          let r = await guard(() => rpc('system.restore', {}));
          if (r?.needsPassword) {
            const pw = await ask(r.encrypted ? 'Die Sicherung ist verschlüsselt (Drive-Backup). Backup-Passwort eingeben:' : `Die Sicherung enthält ${r.keysInBackup} Schlüssel (passwortgeschützt). Backup-Passwort eingeben, um sie zu übernehmen:`, '', { password: true });
            if (!pw) return;
            r = await guard(() => rpc('system.restore', { file: r.file, password: pw }));
          }
          if (r?.staged && await ask('Sicherung geprüft. JARVIS jetzt neu starten und wiederherstellen?' + (r.secretsNote ? ' ' + r.secretsNote : ''), '', { confirmOnly: true, okLabel: 'Neu starten' })) rpc('app.relaunch');
        }}><Upload size={12} />Wiederherstellen…</button>
      </div>
      <KeysBackupField />
      <Field label="Automatische lokale Sicherungen aufbewahren" hint="Anzahl täglicher Backups; bleiben auf diesem PC"><input class="inp" type="number" min="1" max="100" value={s.localBackup?.keep || 7} onChange={e => upd({ localBackup: { keep: Math.max(1, Math.min(100, Number(e.currentTarget.value) || 7)) } })} /></Field>
      <DriveBackupField s={s} />
      <div class="tiny muted mt">Automatische Tagessicherungen ({s.localBackup?.keep || 7} Tage): {backups.filter((b) => b.auto).length} · zuletzt {backups[0] ? ago(backups[0].at) : '—'} · vor jeder Schema-Migration wird zusätzlich gesichert.</div>
      <div class="hr" />
      <UpdateSection s={s} />
    </Panel>
  );
}

/** API-Schlüssel passwortgeschützt mitsichern + Einstellungen exportieren/importieren. */
function KeysBackupField() {
  const [st, reload] = useRpc('keys.status', {}, { events: ['settings:changed'] });
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const save = async () => {
    if (pw !== pw2) return toast('Die Passwörter stimmen nicht überein', 'error');
    const r = await guard(() => rpc('keys.setBackupPassword', { password: pw }), 'Backup-Passwort gespeichert – Schlüssel sind ab jetzt in jeder Sicherung');
    if (r) { setPw(''); setPw2(''); reload(); }
  };
  return (
    <div class="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <Field label="API-Schlüssel in Sicherungen" hint={st?.backupPassword ? `aktiv – ${st.count} Schlüssel werden in jeder Sicherung (lokal + Drive) mit deinem Backup-Passwort verschlüsselt mitgesichert` : 'Schlüssel (Gemini, Riot, Google, TarkovTracker, Campus Dual …) verschlüsselt mitsichern – auf jedem PC mit dem Passwort wiederherstellbar'}>
        {st?.backupPassword ? <button class="btn xs ghost" onClick={async () => { if (await ask('Backup-Passwort entfernen? Neue Sicherungen enthalten dann keine Schlüssel mehr.', '', { confirmOnly: true, okLabel: 'Entfernen' })) { await guard(() => rpc('keys.setBackupPassword', { password: '' })); reload(); } }}>Ausschalten</button> : <span class="tiny muted">aus</span>}
      </Field>
      {!st?.backupPassword && <div class="row gap-s">
        <input class="inp" type="password" autocomplete="new-password" placeholder="Backup-Passwort (mind. 8 Zeichen)" value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
        <input class="inp" type="password" autocomplete="new-password" placeholder="wiederholen" value={pw2} onInput={(e) => setPw2(e.currentTarget.value)} />
        <button class="btn xs primary" disabled={pw.length < 8 || !pw2} onClick={save}><KeyRound size={12} />Aktivieren</button>
      </div>}
      <div class="tiny muted mt">Ohne das Passwort kann niemand die Schlüssel lesen – auch nicht mit Zugriff auf dein Drive. Merk es dir gut: Vergessen = Schlüssel neu eintragen.</div>
      <div class="row gap-s mt" style={{ flexWrap: 'wrap' }}>
        <button class="btn xs" onClick={async () => { const p = st?.backupPassword ? '' : await ask('Passwort für die Schlüsseldatei (mind. 8 Zeichen):', '', { password: true }); if (p === null) return; const r = await guard(() => rpc('keys.export', { password: p })); if (r) toast(`${r.count} Schlüssel exportiert`); }}><Download size={12} />Schlüssel exportieren…</button>
        <button class="btn xs" onClick={async () => { const p = await ask('Passwort der Schlüsseldatei:', '', { password: true }); if (!p) return; const r = await guard(() => rpc('keys.import', { password: p })); if (r) { toast(`${r.count} Schlüssel übernommen`); setState({ secrets: r.secrets }); } }}><Upload size={12} />Schlüssel importieren…</button>
        <button class="btn xs" onClick={async () => { const r = await guard(() => rpc('settings.export')); if (r) toast('Einstellungen exportiert'); }}><Download size={12} />Einstellungen exportieren…</button>
        <button class="btn xs" onClick={async () => { let r = await guard(() => rpc('settings.import')); if (r?.needsPassword) { const pw = await ask('Die Einstellungen sind verschlüsselt (Drive-Backup). Backup-Passwort eingeben:', '', { password: true }); if (!pw) return; r = await guard(() => rpc('settings.import', { file: r.file, password: pw })); } if (r?.count) toast(`${r.count} Einstellungsbereiche übernommen`); }}><Upload size={12} />Einstellungen importieren…</button>
      </div>
    </div>
  );
}

function DriveBackupField({ s }) {
  const [st, reload] = useRpc('backup.driveStatus', {}, { events: ['backup:drive', 'settings:changed'] });
  const [busy, setBusy] = useState(false);
  const b = s.backupDrive || {};
  const connect = async () => { setBusy(true); const r = await guard(() => rpc('backup.driveConnect')); setBusy(false); if (r) { toast('Drive-Backup aktiv – erste Sicherung läuft'); setState({ google: await rpc('calendar.status') }); reload(); } };
  const now = async () => { setBusy(true); const r = await guard(() => rpc('backup.driveRun')); setBusy(false); if (r?.ok) toast(`Verschlüsselt in Drive gesichert: Einstellungen, Schlüssel und komplette Sicherung (${Math.round(r.size / 1024)} KB)`); else if (r?.skipped === 'running') toast('Sicherung läuft bereits.'); reload(); };
  return (
    <div class="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <Field label="Automatisches Backup in Google Drive" hint="Täglich, nicht beim Zocken. Drei getrennte Dateien – Einstellungen, Schlüssel, komplette Sicherung –, alle vor dem Hochladen mit deinem Backup-Passwort verschlüsselt; Google sieht nur unlesbare Daten. JARVIS behält je Art die neuesten."><Toggle checked={!!b.enabled && !!st?.granted} onChange={(v) => (v && !st?.granted ? connect() : upd({ backupDrive: { enabled: v } }))} /></Field>
      <Field label="Drive-Ordner"><input class="inp" style={{ width: 180 }} value={b.folder || 'coding'} onChange={(e) => upd({ backupDrive: { folder: e.currentTarget.value.trim().replace(/^\/+|\/+$/g, '') || 'coding' } })} /></Field>
      <Field label="Anzahl behalten"><input class="inp" type="number" min="1" max="100" style={{ width: 90 }} value={b.keep || 14} onChange={(e) => upd({ backupDrive: { keep: Math.max(1, Math.min(100, Number(e.currentTarget.value) || 14)) } })} /></Field>
      <div class="row gap-s">
        {!st?.granted ? <button class="btn xs primary" disabled={busy} onClick={connect}>{busy ? <Spinner /> : <Link2 size={12} />}Drive-Backup aktivieren</button>
          : <button class="btn xs" disabled={busy || st?.running} onClick={now}>{busy || st?.running ? <Spinner /> : <Upload size={12} />}Jetzt in Drive sichern</button>}
        <span class="tiny muted grow" style={{ color: st?.lastError || (st?.granted && !st?.hasPassword) ? 'var(--red)' : undefined }}>{st?.running ? 'Sichere …' : st?.granted && !st?.hasPassword ? 'Erst ein Backup-Passwort festlegen (Einstellungen → Daten, Sicherung & Updates → Backup-Passwort) – damit wird verschlüsselt.' : st?.lastError ? <FixText text={'Fehler: ' + st.lastError} /> : st?.lastSuccess ? `Zuletzt: ${ago(st.lastSuccess)} · ${st.lastFiles?.length || 1} Dateien (${Math.round((st.lastSize || 0) / 1024)} KB) in „${st.folder}“` : st?.granted ? 'Noch keine Sicherung in Drive' : 'Braucht einmalig Schreibzugriff auf dein Google Drive (Google-Anmeldung)'}</span>
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


export function LocalAI({ s }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try { setStatus(await rpc('local.status')); setError(''); }
    catch (e) { setError(String(e.message || e)); }
  };
  useEffect(() => { refresh(); }, []);
  // Ollama gerade erst gestartet/beendet? Solange es nicht erreichbar ist, alle paar Sekunden neu prüfen
  useEffect(() => { if (status && !status.online) { const t = setInterval(refresh, 5000); return () => clearInterval(t); } return undefined; }, [status?.online]);
  const [pull, setPull] = useState(null);
  useEvent('local:pull', (p) => setPull(p));
  const tiers = status?.tiers || [
    { id: 'ultra', model: 'qwen3.5:0.8b', label: 'Ultra-Leicht' },
    { id: 'light', model: 'qwen3.5:2b', label: 'Leicht' },
    { id: 'balanced', model: 'qwen3.5:4b', label: 'Ausgewogen' },
    { id: 'strong', model: 'qwen3.5:9b', label: 'Stark' },
    { id: 'maximum', model: 'qwen3.5:27b', label: 'Maximum' }
  ];
  const selected = s.localLLM?.model || '';
  const recommended = tiers.find(t => t.id === status?.recommended);
  const install = async model => {
    setLoading(true); setError(''); setPull(null);
    try {
      // Ollama installiert, aber nicht gestartet? Dann erst starten – früher war der Knopf dafür einfach grau
      if (!status?.online) { setPull({ status: 'Ollama wird gestartet …' }); await rpc('local.startOllama'); }
      await rpc('local.installTier', { model });
      await refresh();
      upd({ localLLM: { model } });
      toast('Lokales KI-Modell installiert');
    } catch (e) { setError(String(e.message || e)); }
    finally { setLoading(false); setPull(null); await refresh(); }
  };
  const already = !!(selected && status?.installed?.includes(selected));
  const pct = pull?.total ? Math.min(100, Math.floor((pull.completed / pull.total) * 100)) : null;
  return <Panel icon={ShieldCheck} title="Lokale KI & Private" sub="Gemini für allgemeine Chats · Private Daten ausschließlich lokal">
    <p class="small">Gemini bleibt für normale Gespräche aktiv. Private Gespräche verwenden nur Ollama auf diesem Rechner – ohne Cloud-Fallback. Modelle werden erst nach Klick heruntergeladen.</p>
    <Field label="Ollama-Port (nur 127.0.0.1)"><input class="inp" type="number" min="1" max="65535" value={s.localLLM?.port || 11434} onChange={e => upd({ localLLM: { port: Number(e.currentTarget.value) } })} /></Field>
    <div class="row gap-s mt">
      <span class="tiny">{status?.online ? '● Ollama erreichbar' : '○ Ollama nicht erreichbar – bitte Ollama installieren und starten'}</span>
      <button class="btn xs" onClick={refresh} disabled={loading}>Status prüfen</button>
      {!status?.online && <button class="btn xs" disabled={loading} onClick={async () => { if (!window.confirm('Ollama über Windows winget installieren? Der Download benötigt Internet und kann eine Windows-Bestätigung erfordern.')) return; setLoading(true); try { await rpc('local.installOllama'); await refresh(); } catch (e) { setError(String(e.message || e)); } finally { setLoading(false); } }}>Ollama installieren (Windows)</button>}
    </div>
    {status && <p class="tiny muted">Arbeitsspeicher: {status.ramGB} GB · Hardware-Empfehlung: {recommended?.label || '–'} ({recommended?.model || '–'}). GPU/VRAM werden nicht automatisch gemessen.</p>}
    <Field label="Lokale Leistungsstufe">
      <Select value={selected} onChange={model => upd({ localLLM: { model } })}
        options={[{ value: '', label: 'Bitte Modell auswählen' }, ...tiers.map(t => ({ value: t.model, label: t.label + ' · ' + t.model + (status?.installed?.includes(t.model) ? ' ✓ installiert' : '') }))]} />
    </Field>
    <div class="row gap-s mt">
      <button class="btn sm" disabled={loading || !selected || already} onClick={() => install(selected)}>
        {loading ? 'Modell wird geladen …' : already ? '✓ Modell ist installiert' : 'Ausgewähltes Modell herunterladen'}
      </button>
      {!status?.online && !loading && <button class="btn sm ghost" onClick={async () => { setLoading(true); setError(''); try { setPull({ status: 'Ollama wird gestartet …' }); await rpc('local.startOllama'); await refresh(); toast('Ollama läuft'); } catch (e) { setError(String(e.message || e)); } finally { setLoading(false); setPull(null); } }}>Ollama starten</button>}
      {recommended && <button class="btn sm" disabled={loading} onClick={() => upd({ localLLM: { model: recommended.model } })}>Empfehlung übernehmen</button>}
    </div>
    {!selected && <p class="tiny muted">Wähle oben zuerst eine Leistungsstufe, dann wird der Download-Knopf frei.</p>}
    {selected && !already && !loading && status && !status.online && <p class="tiny muted">Ollama läuft gerade nicht – der Download-Knopf startet es automatisch.</p>}
    {loading && pull && <div class="mt" aria-live="polite"><div class="tiny">{pull.model ? pull.model + ': ' : ''}{pull.status || 'lädt …'}{pct != null ? ' – ' + pct + ' %' : ''}</div>{pct != null && <div style={{ height: 6, borderRadius: 3, background: 'var(--line, #2a3340)', overflow: 'hidden', marginTop: 4 }}><div style={{ width: pct + '%', height: '100%', background: 'var(--accent, #38e1ff)', transition: 'width .3s' }} /></div>}</div>}
    {error && <p class="tiny" role="alert">{error}</p>}
    {status?.exposure && <div class="notice warn small mt" role="alert">{status.exposure}</div>}
    <Field label="Während ein Spiel läuft" hint="Lokale KI konkurriert mit dem Spiel um CPU, RAM und Grafikspeicher">
      <Select value={s.localLLM?.whileGaming || 'cpu'} onChange={(whileGaming) => upd({ localLLM: { whileGaming } })} options={[{ value: 'cpu', label: 'Nur CPU, 2 Threads, sofort entladen (empfohlen)' }, { value: 'pause', label: 'Hintergrundaufgaben pausieren' }, { value: 'normal', label: 'Keine Einschränkung' }]} />
    </Field>
    <Field label="Modell im Speicher halten" hint="danach entlädt Ollama das Modell wieder"><Select value={s.localLLM?.keepAlive || '2m'} onChange={(keepAlive) => upd({ localLLM: { keepAlive } })} options={[['30s', '30 Sekunden'], ['2m', '2 Minuten'], ['10m', '10 Minuten']].map(([value, label]) => ({ value, label }))} /></Field>
    <p class="tiny muted mt">Die 27B-Stufe benötigt viel Arbeitsspeicher und kann langsam sein. Modelle und Kontext benötigen zusätzlich RAM/VRAM. Ollama muss zunächst separat installiert sein; Downloads können mehrere GB groß sein. Private Daten bleiben lokal, sofern du keine separate externe Weitergabe erlaubst.</p>
  </Panel>;
}
