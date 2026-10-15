import { rpc, on } from './api.js';
import { getState, setState, toast } from './store.js';
import { ask } from '../components/ui.jsx';

/**
 * Renderer audio engine.
 * - Microphone with Chromium echo cancellation / noise suppression / AGC.
 * - 16 kHz PCM16 frames → Gemini Live (via main) and/or the local wake-word worker.
 * - 24 kHz player with instant flush (barge-in), output level for the orb.
 * - Local barge-in: user speech while JARVIS talks stops playback immediately.
 */
class AudioEngine {
  constructor() {
    this.inCtx = null; this.outCtx = null; this.stream = null; this.capture = null; this.player = null;
    this.mode = { stream: false, wake: false, local: false };
    this.cloudConversationId = null;
    this.localChunks = []; this.localSamples = 0; this.localConversationId = null; this.localWorking = false;
    this.wakeWorker = null; this.wakeReady = false;
    this.noiseFloor = 0.004; this.speechMs = 0; this.playing = false; this.outRms = 0;
    this.lastActivityPing = 0;
    this.muted = false;
    on('voice:audio', (d) => this.play(d.data));
    on('voice:interrupted', () => this.flush());
    on('voice:state', ({ state }) => this.onVoiceState(state));
    on('tts:speak', ({ text }) => this.speakLocal(text));
  }

  async ensureMic() {
    if (this.stream) return;
    const s = getState().settings?.voice || {};
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: s.inputDeviceId && s.inputDeviceId !== 'default' ? { exact: s.inputDeviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.inCtx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    await this.inCtx.audioWorklet.addModule('audio/capture-worklet.js');
    const src = this.inCtx.createMediaStreamSource(this.stream);
    this.capture = new AudioWorkletNode(this.inCtx, 'jarvis-capture');
    this.capture.port.onmessage = (e) => this.onFrame(e.data.pcm, e.data.rms);
    src.connect(this.capture);
    // Keep the graph alive without audible output.
    const mute = this.inCtx.createGain(); mute.gain.value = 0;
    this.capture.connect(mute).connect(this.inCtx.destination);
  }

  async ensurePlayer() {
    if (this.player) return;
    this.outCtx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
    const dev = getState().settings?.voice?.outputDeviceId;
    if (dev && dev !== 'default' && this.outCtx.setSinkId) { try { await this.outCtx.setSinkId(dev); } catch { /* device gone */ } }
    await this.outCtx.audioWorklet.addModule('audio/player-worklet.js');
    this.player = new AudioWorkletNode(this.outCtx, 'jarvis-player', { outputChannelCount: [1] });
    this.player.port.onmessage = (e) => {
      if (e.data.type === 'level') { this.outRms = e.data.rms; this.playing = e.data.playing; setState({ outLevel: Math.min(1, e.data.rms * 6) }); }
      if (e.data.type === 'drained') { this.playing = false; setState({ outLevel: 0 }); }
    };
    this.player.connect(this.outCtx.destination);
  }

  releaseMicIfIdle() {
    if (this.mode.stream || this.mode.wake || this.mode.local) return;
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
      // Entire recording stays in the renderer until the user stops it. PCM is
      // never sent to Gemini or persisted as a transcript in this process.
      this.localChunks.push(pcm);
      this.localSamples += pcm.length;
      if (this.localSamples >= 16000 * 30) this.stopLocalVoice();
      return;
    }
    if (this.mode.stream && getState().conversationId !== this.cloudConversationId) {
      // Switching chats must not keep streaming from the previous conversation.
      this.stopVoice();
      return;
    }
    if (this.mode.stream && this.muted) { setState({ micLevel: 0 }); return; }
    if (this.mode.stream) {
      window.jarvis.sendAudio(pcm.buffer);
      const speechThresh = Math.max(0.012, this.noiseFloor * 4, this.playing ? this.outRms * 0.6 : 0);
      if (rms > speechThresh) {
        this.speechMs += 80;
        if (this.playing && this.speechMs >= 160 && getState().settings?.voice?.bargeIn !== false) this.flush(); // barge-in
        if (Date.now() - this.lastActivityPing > 3000) { this.lastActivityPing = Date.now(); rpc('voice.activity').catch(() => {}); }
      } else this.speechMs = 0;
    } else if (this.mode.wake && this.wakeWorker) {
      this.wakeWorker.postMessage({ type: 'audio', pcm }, [pcm.buffer]);
    }
  }

  async play(b64) {
    await this.ensurePlayer();
    if (this.outCtx.state === 'suspended') await this.outCtx.resume();
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length >> 1);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
    this.player.port.postMessage({ type: 'push', pcm }, [pcm.buffer]);
    this.playing = true;
  }
  flush() {
    this.player?.port.postMessage({ type: 'clear' });
    this.playing = false;
    setState({ outLevel: 0 });
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }

  setMuted(m) { this.muted = !!m; setState({ micMuted: this.muted }); }

  /** Private: push-to-talk via local whisper.cpp. Study/Gaming: Gemini Live with consent each session. */
  async toggleVoice() {
    if (this.localWorking) { toast('JARVIS erkennt deine Sprache noch lokal.'); return; }
    if (this.mode.local) return this.stopLocalVoice();
    if (this.mode.stream || ['listening', 'speaking', 'thinking', 'connecting'].includes(getState().voice)) return this.stopVoice();
    return this.startVoice();
  }
  async startVoice() {
    const conversationId = getState().conversationId;
    try {
      const target = await rpc('voice.target', { conversationId });
      if (getState().conversationId !== conversationId) return;
      if (target.privacy === 'private') return await this.startLocalVoice(conversationId);
      if (!['study', 'gaming'].includes(target.privacy)) throw new Error('Unbekannter Sprachmodus.');
      const approved = await ask(
        'Gemini Live überträgt dein Mikrofon-Audio an Google, verarbeitet das Gespräch in der Cloud und kann die freigegebene Chat-Historie verwenden. Audio jetzt für diesen Uni-/Gaming-Chat übertragen?',
        '', { confirmOnly: true, okLabel: 'Cloud-Audio für diese Sitzung erlauben' },
      );
      if (!approved || getState().conversationId !== conversationId) return;
      await this.ensureMic();
      await this.ensurePlayer();
      if (this.inCtx.state === 'suspended') await this.inCtx.resume();
      this.mode.stream = true;
      this.cloudConversationId = conversationId;
      await rpc('voice.start', { conversationId, cloudAudioApproved: true });
    } catch (e) {
      this.mode.stream = false;
      this.cloudConversationId = null;
      this.releaseMicIfIdle();
      toast(String(e?.message || e).replace(/^Error invoking remote method 'rpc': (Error: )?/, ''), 'error', 7000);
    }
  }
  async startLocalVoice(conversationId) {
    const available = await rpc('voice.localStatus');
    if (!available.ready) {
      toast(available.error + ' → Einstellungen → Sprache', 'error', 10000);
      return;
    }
    if (getState().conversationId !== conversationId) return;
    await this.ensureMic();
    if (this.inCtx.state === 'suspended') await this.inCtx.resume();
    this.localChunks = [];
    this.localSamples = 0;
    this.localConversationId = conversationId;
    this.mode.local = true;
    setState({ voice: 'recording-local' });
    toast('Offline-Aufnahme läuft. Mikrofon erneut drücken zum Erkennen (max. 30 Sekunden).');
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
      if (result?.started) toast('Sprache offline erkannt und im privaten Chat gesendet.');
    } catch (e) {
      toast(String(e?.message || e).replace(/^Error invoking remote method 'rpc': (Error: )?/, ''), 'error', 8500);
    } finally {
      this.localWorking = false;
      setState({ voice: 'off' });
    }
  }
  async stopVoice() {
    this.mode.stream = false;
    this.cloudConversationId = null;
    this.setMuted(false);
    this.flush();
    await rpc('voice.stop').catch(() => {});
    this.releaseMicIfIdle();
  }
  onVoiceState(state) {
    if (['off', 'standby', 'error'].includes(state)) {
      this.mode.stream = false;
      this.cloudConversationId = null;
      if (state === 'standby') this.wakeWorker?.postMessage({ type: 'reset' });
      this.releaseMicIfIdle();
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
      this.wakeWorker = new Worker('audio/wakeword-worker.js', { type: 'module' });
      this.wakeWorker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') this.wakeReady = true;
        if (m.type === 'error') { toast('Wake-Word: ' + m.error, 'error'); }
        if (m.type === 'wake' && !this.mode.stream && !this.mode.local && !this.localWorking) { chime(); this.startVoice(); }
        if (m.type === 'score') setState({ wakeScore: m.score });
      };
      this.wakeWorker.postMessage({ type: 'init', threshold: sens });
      await this.ensureMic();
      this.mode.wake = true;
    } catch (e) { toast('Mikrofon für Wake-Word nicht verfügbar: ' + e.message, 'error'); }
  }

  /** Local Windows TTS (offline, no API cost) for read-aloud & coach tips. */
  speakLocal(text) {
    if (!text || this.mode.stream) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; u.rate = 1.05;
      const v = speechSynthesis.getVoices().find((x) => x.localService && x.lang?.startsWith('de'));
      if (!v) return; // Never fall back to a remote system voice.
      if (v) u.voice = v;
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

