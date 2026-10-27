import { rpc, on } from './api.js';
import { getState, setState, toast } from './store.js';

/**
 * Renderer audio engine (ab 5.1 komplett lokal).
 * - Mikrofon mit Echo-/Rauschunterdrückung; 16-kHz-PCM16 → lokale Aufnahme (whisper.cpp im Hauptprozess)
 *   und/oder das lokale Wake-Word („Hey Jarvis“).
 * - Sprachausgabe: lokale Stimme (OmniVoice/Piper) Satz für Satz, sonst Windows-Stimme.
 */
class AudioEngine {
  constructor() {
    this.inCtx = null; this.outCtx = null; this.stream = null; this.capture = null; this.player = null;
    this.mode = { wake: false, local: false };
    this.localChunks = []; this.localSamples = 0; this.localConversationId = null; this.localWorking = false;
    this.wakeWorker = null; this.wakeReady = false;
    this.noiseFloor = 0.004; this.playing = false; this.outRms = 0;
    this.micPending = null; this.starting = false; this.startGeneration = 0;
    this.micGeneration = 0;
    // Lokale Aufnahme: automatisch beenden nach Sprechpause (für Wake-Word/Freihand beim Gaming)
    this.localHeard = 0; this.localSilentMs = 0;
    on('tts:speak', ({ text, private: priv }) => this.speakLocal(text, { private: !!priv }));
    this.tts = { gen: 0, ctx: null, src: null, speaking: false, warned: false };
  }

  async ensureMic() {
    if (this.micPending) return this.micPending;
    if (this.stream?.getAudioTracks().some(t => t.readyState === 'live')) return;
    this.micPending = this.openMic();
    try { await this.micPending; } finally { this.micPending = null; }
  }

  async openMic() {
    const generation = this.micGeneration;
    let stream = null, context = null;
    const s = getState().settings?.voice || {};
    const constraints = {
      audio: { deviceId: s.inputDeviceId && s.inputDeviceId !== 'default' ? { exact: s.inputDeviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    };
    try {
      try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch (e) {
        if (!constraints.audio.deviceId || !['NotFoundError', 'OverconstrainedError'].includes(e.name)) throw e;
        delete constraints.audio.deviceId;
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }
      if (generation !== this.micGeneration) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      context = this.inCtx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      await context.audioWorklet.addModule('audio/capture-worklet.js');
      if (generation !== this.micGeneration) return;
      const src = context.createMediaStreamSource(stream);
      this.capture = new AudioWorkletNode(this.inCtx, 'jarvis-capture');
      this.capture.port.onmessage = (e) => { if (generation === this.micGeneration) this.onFrame(e.data.pcm, e.data.rms); };
      src.connect(this.capture);
      // Keep the graph alive without audible output.
      const mute = this.inCtx.createGain(); mute.gain.value = 0;
      this.capture.connect(mute).connect(this.inCtx.destination);
      if (this.inCtx.state === 'suspended') await this.inCtx.resume();
      for (const track of stream.getAudioTracks()) track.onended = () => this.recoverMic(stream);
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      await context?.close().catch(() => {});
      if (generation === this.micGeneration) { this.stream = null; this.inCtx = null; this.capture = null; }
      throw e;
    }
  }

  async recoverMic(stream) {
    if (this.stream !== stream) return;
    this.disposeMic();
    const generation = this.micGeneration;
    if (!this.mode.wake && !this.mode.local) return;
    try {
      await this.micPending;
      if (generation !== this.micGeneration) return;
      if (!this.mode.wake && !this.mode.local) return;
      await this.ensureMic();
      this.releaseMicIfIdle();
    } catch (e) {
      if (generation !== this.micGeneration) return;
      if (this.mode.local) this.cancelLocalVoice();
      await this.setWakeWord(false);
      toast('Mikrofon getrennt; kein Ersatzgerät verfügbar: ' + e.message, 'error');
    }
  }

  releaseMicIfIdle() {
    if (this.mode.wake || this.mode.local) return;
    this.disposeMic();
  }

  disposeMic() {
    this.micGeneration++;
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { this.inCtx?.close(); } catch { /* ignore */ }
    this.stream = null; this.inCtx = null; this.capture = null;
    setState({ micLevel: 0 });
  }

  onFrame(pcm, rms) {
    // adaptive noise floor
    if (rms < this.noiseFloor * 3) this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
    setState({ micLevel: Math.min(1, rms * 9) });
    if (this.mode.local) {
      // Entire recording stays in the renderer until it ends; then only the local whisper.cpp process sees it.
      // PCM is never sent to Gemini or persisted.
      this.localChunks.push(pcm);
      this.localSamples += pcm.length;
      const speech = rms > Math.max(0.012, this.noiseFloor * 4);
      if (speech) { this.localHeard += 80; this.localSilentMs = 0; } else this.localSilentMs += 80;
      if (this.localSamples >= 16000 * 30) this.stopLocalVoice();
      else if (this.localHeard >= 400 && this.localSilentMs >= 1200) this.stopLocalVoice(); // Satz zu Ende
      else if (!this.localHeard && this.localSamples >= 16000 * 8) this.cancelLocalVoice('Nichts gehört – Aufnahme beendet.');
      return;
    }
    if (this.mode.wake && this.wakeWorker) {
      this.wakeWorker.postMessage({ type: 'audio', pcm }, [pcm.buffer]);
    }
  }

  /** Wiedergabe sofort stoppen (z. B. wenn du anfängst zu sprechen). */
  flush() { this.playing = false; setState({ outLevel: 0 }); this.stopSpeech(); }

  /** Mikrofon an/aus: Aufnahme bis zur Sprechpause, Erkennung lokal (whisper.cpp), danach wie getippter Text. */
  async toggleVoice() {
    if (this.localWorking) { toast('JARVIS erkennt deine Sprache noch lokal.'); return; }
    if (this.mode.local) return this.stopLocalVoice();
    return this.startVoice();
  }
  async startVoice() {
    if (this.starting || this.mode.local || this.localWorking) return;
    this.starting = true;
    const generation = ++this.startGeneration;
    try { await this.startLocalVoice(getState().conversationId, generation); }
    catch (e) { this.releaseMicIfIdle(); toast(String(e?.message || e).replace(/^Error invoking remote method 'rpc': (Error: )?/, ''), 'error', 7000); }
    finally { this.starting = false; }
  }
  /** Laufende Aufnahme verwerfen (z. B. Chatwechsel, Mikrofon weg). */
  async stopVoice() { this.startGeneration++; this.cancelLocalVoice(); this.flush(); this.releaseMicIfIdle(); }
  async startLocalVoice(conversationId, generation = this.startGeneration) {
    const available = await rpc('voice.localStatus');
    if (!available.ready) {
      toast(available.error + ' → Einstellungen → Sprache', 'error', 10000);
      return;
    }
    if (generation !== this.startGeneration || getState().conversationId !== conversationId) return;
    await this.ensureMic();
    if (generation !== this.startGeneration || getState().conversationId !== conversationId) { this.releaseMicIfIdle(); return; }
    if (this.inCtx.state === 'suspended') await this.inCtx.resume();
    this.localChunks = [];
    this.localSamples = 0;
    this.localHeard = 0; this.localSilentMs = 0;
    this.localConversationId = conversationId;
    this.mode.local = true;
    this.stopSpeech(); // eigene Sprachausgabe nicht mit aufnehmen
    setState({ voice: 'recording-local' });
    toast('Ich höre zu (lokal). Nach einer Sprechpause wird automatisch erkannt – oder Mikrofon erneut drücken.');
  }
  cancelLocalVoice(msg) {
    if (!this.mode.local) return;
    this.mode.local = false; this.localChunks = []; this.localSamples = 0; this.localConversationId = null;
    this.releaseMicIfIdle();
    setState({ voice: 'off' });
    if (msg) toast(msg);
  }
  async stopLocalVoice() {
    if (!this.mode.local) return;
    this.mode.local = false;
    this.localWorking = true;
    const chunks = this.localChunks;
    const samples = this.localSamples;
    const conversationId = this.localConversationId;
    this.localChunks = [];
    this.localSamples = 0;
    this.localConversationId = null;
    this.releaseMicIfIdle();
    setState({ voice: 'transcribing-local' });
    try {
      if (samples < 8000) throw new Error('Bitte mindestens eine halbe Sekunde sprechen.');
      if (getState().conversationId !== conversationId) throw new Error('Chat wurde gewechselt; Aufnahme nicht gesendet.');
      const bytes = new Uint8Array(samples * 2);
      let offset = 0;
      for (const pcm of chunks) { bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), offset); offset += pcm.byteLength; }
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const result = await rpc('voice.transcribeLocal', { conversationId, audio: btoa(binary) });
      if (result?.started) toast('Sprache lokal erkannt und gesendet.');
    } catch (e) {
      toast(String(e?.message || e).replace(/^Error invoking remote method 'rpc': (Error: )?/, ''), 'error', 8500);
    } finally {
      this.localWorking = false;
      setState({ voice: 'off' });
    }
  }
  /** Optional local wake word (openWakeWord in a worker). */
  async setWakeWord(enabled) {
    const sens = getState().settings?.voice?.wakeSensitivity ?? 0.5;
    if (!enabled) {
      this.mode.wake = false;
      this.wakeWorker?.terminate(); this.wakeWorker = null; this.wakeReady = false;
      this.releaseMicIfIdle();
      return;
    }
    if (this.wakeWorker) { this.wakeWorker.postMessage({ type: 'threshold', value: sens }); return; }
    try {
      const worker = this.wakeWorker = new Worker('audio/wakeword-worker.js', { type: 'module' });
      this.wakeWorker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') this.wakeReady = true;
        if (m.type === 'error') { toast('Wake-Word: ' + m.error, 'error'); this.setWakeWord(false); }
        // Eigene Sprachausgabe/Wiedergabe darf das Wake-Word nicht auslösen (Rückkopplung)
        if (m.type === 'wake' && !this.mode.local && !this.localWorking && !this.playing && !this.tts.speaking && !speechSynthesis.speaking) { chime(); this.startVoice(); }
        if (m.type === 'score') setState({ wakeScore: m.score });
      };
      this.wakeWorker.postMessage({ type: 'init', threshold: sens });
      await this.ensureMic();
      if (this.wakeWorker !== worker) { this.releaseMicIfIdle(); return; }
      this.mode.wake = true;
    } catch (e) { await this.setWakeWord(false); toast('Mikrofon für Wake-Word nicht verfügbar: ' + e.message, 'error'); }
  }

  /**
   * Lokale Sprachausgabe (offline, keine Kosten). Standard: Piper (natürliche Stimme, Satz für Satz,
   * nächster Satz wird schon berechnet, während der vorige läuft). Rückfall: Windows-Stimme.
   * full: ganzer Text (Knopf „Vorlesen“), sonst Kurzfassung. override: Stimme/Tempo/Tonhöhe für die Hörprobe.
   */
  async speakLocal(text, { full = false, override = null, private: priv = false, preview = false } = {}) {
    if (!text || this.mode.local) return;
    this.stopSpeech();
    const gen = this.tts.gen;
    const st = { ...(getState().settings?.voice?.tts || {}), ...(override || {}) };
    let prep;
    try { prep = await rpc('tts.prepare', { text, full }); } catch { prep = { text: String(text), parts: [String(text)] }; }
    if (gen !== this.tts.gen || !prep.parts.length) return;
    if (st.engine === 'windows') return this.windowsSpeak(prep.text, await this.withPreset(st));
    this.tts.speaking = true;
    try {
      const synth = (t) => rpc('tts.synthesize', { text: t, override, private: priv, preview });
      let next = synth(prep.parts[0]);
      for (let i = 0; i < prep.parts.length; i++) {
        const cur = await next;
        if (gen !== this.tts.gen) return;
        next = i + 1 < prep.parts.length ? synth(prep.parts[i + 1]) : null;
        next?.catch(() => {});
        await this.playWav(cur.audio, cur.pitch, st.volume ?? 1, gen);
        if (gen !== this.tts.gen) return;
      }
    } catch (e) {
      if (gen !== this.tts.gen) return;
      if (!this.tts.warned) { this.tts.warned = true; toast('Natürliche Stimme nicht verfügbar (' + (e.message || e) + ') – Windows-Stimme wird genutzt.', 'error'); }
      this.windowsSpeak(prep.text, await this.withPreset(st));
    } finally { if (gen === this.tts.gen) { this.tts.speaking = false; setState({ outLevel: 0 }); } }
  }

  async playWav(b64, pitch = 1, volume = 1, gen) {
    if (!this.tts.ctx || this.tts.ctx.state === 'closed') {
      this.tts.ctx = new AudioContext({ latencyHint: 'playback' });
      const dev = getState().settings?.voice?.outputDeviceId;
      if (dev && dev !== 'default' && this.tts.ctx.setSinkId) { try { await this.tts.ctx.setSinkId(dev); } catch { /* device gone */ } }
    }
    const ctx = this.tts.ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const bin = atob(b64); const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const audio = await ctx.decodeAudioData(buf.buffer);
    if (gen !== this.tts.gen) return;
    const src = ctx.createBufferSource(); src.buffer = audio; src.playbackRate.value = Math.max(0.8, Math.min(1.25, pitch || 1));
    const gain = ctx.createGain(); gain.gain.value = Math.max(0, Math.min(1.5, volume));
    const an = ctx.createAnalyser(); an.fftSize = 256;
    src.connect(gain); gain.connect(an); an.connect(ctx.destination);
    this.tts.src = src; this.playing = true;
    const data = new Float32Array(an.fftSize);
    const meter = setInterval(() => { an.getFloatTimeDomainData(data); let sum = 0; for (const v of data) sum += v * v; const rms = Math.sqrt(sum / data.length); this.outRms = rms; setState({ outLevel: Math.min(1, rms * 6) }); }, 80);
    try { await new Promise((res) => { src.onended = res; src.start(); }); }
    finally { clearInterval(meter); if (this.tts.src === src) this.tts.src = null; this.playing = false; }
  }

  stopSpeech() {
    this.tts.gen++;
    try { this.tts.src?.stop(); } catch { /* ignore */ }
    this.tts.src = null; this.tts.speaking = false;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }

  /** Stimmprofil (J.A.R.V.I.S./Alya) auf die Windows-Stimme übertragen: passende Stimme, Tonhöhe, Tempo. */
  async withPreset(st) {
    if (!st.preset || st.preset === 'standard') return st;
    if (!this.presets) { try { this.presets = (await rpc('tts.presets')).presets; } catch { this.presets = []; } }
    const w = this.presets.find((p) => p.id === st.preset)?.windows;
    if (!w) return st;
    const v = speechSynthesis.getVoices().find((x) => x.localService && x.lang?.startsWith('de') && new RegExp(w.prefer, 'i').test(x.name));
    return { ...st, windowsVoice: v?.name || st.windowsVoice, pitch: w.pitch, speed: w.speed };
  }

  /** Windows-Stimme: gewählte, sonst beste installierte deutsche Stimme (nie Online-Stimmen). */
  windowsSpeak(text, st = {}) {
    try {
      speechSynthesis.cancel();
      const voices = speechSynthesis.getVoices().filter((x) => x.localService && x.lang?.startsWith('de'));
      const rank = (v) => (/natural|neural/i.test(v.name) ? 0 : /katja/i.test(v.name) ? 1 : /conrad|amala|killian|seraphina|florian/i.test(v.name) ? 2 : /stefan/i.test(v.name) ? 3 : /hedda/i.test(v.name) ? 5 : 4);
      const v = voices.find((x) => x.name === st.windowsVoice) || voices.sort((a, b) => rank(a) - rank(b))[0];
      if (!v) return; // Never fall back to a remote system voice.
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang || 'de-DE';
      u.rate = Math.max(0.6, Math.min(1.6, st.speed || 1)) * 1.05; u.pitch = Math.max(0.5, Math.min(1.5, (st.pitch || 1) ** 2)); u.volume = Math.max(0, Math.min(1, st.volume ?? 1));
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  /** Microphone test for setup: returns a stop function; calls cb(level). */
  async meter(cb, deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true } });
    const ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const data = new Float32Array(an.fftSize);
    let raf;
    const loop = () => { an.getFloatTimeDomainData(data); let s = 0; for (const v of data) s += v * v; cb(Math.min(1, Math.sqrt(s / data.length) * 8)); raf = requestAnimationFrame(loop); };
    loop();
    return () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); };
  }
}

/** Short synthesized HUD chime (no asset needed). */
export function chime(volume = 0.25) {
  try {
    const ctx = new AudioContext();
    const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.connect(g); o.start(ctx.currentTime + i * 0.09); o.stop(ctx.currentTime + 0.35 + i * 0.09);
    });
    g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    setTimeout(() => ctx.close(), 800);
  } catch { /* ignore */ }
}

/** Startup sound: synthesized sweep or the user's own file; never blocks start. */
export async function playStartSound(cfg) {
  if (!cfg || cfg.mode === 'off') return;
  const run = async () => {
    try {
      if (cfg.file) {
        const a = new Audio(cfg.file); a.volume = cfg.volume ?? 0.6; await a.play(); return;
      }
      const ctx = new AudioContext();
      const g = ctx.createGain(); g.connect(ctx.destination);
      const vol = cfg.volume ?? 0.6;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.35 * vol, ctx.currentTime + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.6);
      const notes = [392, 523.25, 659.25, 783.99];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine';
        o.frequency.setValueAtTime(f, ctx.currentTime + i * 0.12);
        o.connect(g); o.start(ctx.currentTime + i * 0.12); o.stop(ctx.currentTime + 1.6);
      });
      setTimeout(() => ctx.close(), 2000);
    } catch { /* ignore */ }
  };
  if (cfg.mode === 'delayed') setTimeout(run, (cfg.delaySeconds || 0) * 1000); else run();
}

export const audio = new AudioEngine();
