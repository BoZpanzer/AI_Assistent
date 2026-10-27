'use strict';
/**
 * Sprachausgabe: wählt je Satz die Stimme.
 * - „auto“ (Standard): Cloud-Stimme (Gemini-TTS, spricht englische Spielbegriffe und Namen richtig) für
 *   nicht private Texte, solange erlaubt und unter der Tagesgrenze – sonst lokal (Piper).
 * - „gemini“: wie auto, aber ohne Rückfall-Hinweis; „piper“: immer lokal; „windows“ übernimmt die Oberfläche.
 * - Private Inhalte gehen NIE an die Cloud.
 * - Fertige Audios werden lokal zwischengespeichert (gleiche Sätze, z. B. Ansagen, kosten nichts erneut).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const log = require('../core/logger').scope('speech');
const { resolve } = require('./voice-presets');

const CACHE_MAX = 60 * 1024 * 1024;

/** Aussprachehilfen für die lokale (deutsche) Stimme – englische Gaming-Begriffe lautschriftlich. */
const LEXICON = [
  [/\bToplane\b/gi, 'Topp-Lehn'], [/\bMidlane\b/gi, 'Mitt-Lehn'], [/\bBotlane\b/gi, 'Bott-Lehn'], [/\bLanes?\b/gi, (m) => (m.endsWith('s') ? 'Lehns' : 'Lehn')],
  [/\bLaning\b/gi, 'Lehning'], [/\bJungler\b/gi, 'Dschungler'], [/\bJungle\b/gi, 'Dschungel'], [/\bGanks?\b/gi, (m) => (m.endsWith('s') ? 'Gänks' : 'Gänk')],
  [/\bSupport\b/gi, 'Sapport'], [/\bADC\b/g, 'A D C'], [/\bTop\b/g, 'Topp'], [/\bMid\b/g, 'Mitt'], [/\bBot\b/g, 'Bott'],
  [/\bWards?\b/gi, (m) => (m.endsWith('s') ? 'Wohrds' : 'Wohrd')], [/\bControl\b/gi, 'Kontrol'], [/\bRecall\b/gi, 'Rikohl'], [/\bRoam(en|t)?\b/gi, (m) => 'Rohm' + m.slice(4)],
  [/\bTeamfights?\b/gi, (m) => (m.endsWith('s') ? 'Tiemfeits' : 'Tiemfeit')], [/\bItems?\b/gi, (m) => (m.endsWith('s') ? 'Eitems' : 'Eitem')], [/\bFarm(en)?\b/gi, (m) => 'Fahm' + m.slice(4)],
  [/\bPush(en)?\b/gi, (m) => 'Pusch' + m.slice(4)], [/\bSkillshots?\b/gi, 'Skillschott'], [/\bCooldowns?\b/gi, 'Kuhldaun'], [/\bSplitpush\b/gi, 'Splittpusch'],
  [/\bRaids?\b/gi, (m) => (m.endsWith('s') ? 'Reids' : 'Reid')], [/\bScavs?\b/gi, (m) => (m.endsWith('s') ? 'Skäffs' : 'Skäff')], [/\bQuests?\b/gi, (m) => (m.endsWith('s') ? 'Kwests' : 'Kwest')],
  [/\bLoot\b/gi, 'Luht'], [/\bExtract\b/gi, 'Ixtrakt'], [/\bRun-?Through\b/gi, 'Ran-Sruh'], [/\bFlea\b/gi, 'Flie'], [/\bHideout\b/gi, 'Heid-aut'],
  [/\bUltimates?\b/gi, (m) => (m.endsWith('s') ? 'Altimets' : 'Altimet')], [/\bRecap\b/gi, 'Riekäp'],
  [/\bChampions?\b/gi, (m) => (m.endsWith('s') ? 'Tschämpiens' : 'Tschämpien')],
  [/\bMatchups?\b/gi, (m) => (m.endsWith('s') ? 'Mätschapps' : 'Mätschapp')], [/\bSummoner\b/gi, 'Sammoner'],
];
function localPronunciation(text) {
  let t = String(text || '');
  for (const [re, rep] of LEXICON) t = t.replace(re, rep);
  return t;
}

class Speech {
  constructor(s) { this.s = s; this.dir = path.join(s.paths.data, 'tts-cache'); }
  cfg() { return this.s.settings.get('voice')?.tts || {}; }

  cacheFile(key) { return path.join(this.dir, key + '.wav'); }
  fromCache(key) { try { const f = this.cacheFile(key); const b = fs.readFileSync(f); const t = new Date(); fs.utimesSync(f, t, t); return b; } catch { return null; } }
  toCache(key, wav) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.cacheFile(key), wav);
      const files = fs.readdirSync(this.dir).map((f) => { const p = path.join(this.dir, f); const st = fs.statSync(p); return { p, size: st.size, t: st.mtimeMs }; }).sort((a, b) => b.t - a.t);
      let sum = 0; for (const f of files) { sum += f.size; if (sum > CACHE_MAX) fs.rmSync(f.p, { force: true }); }
    } catch (e) { log.debug('cache', e); }
  }

  /** Cloud-Stimme erlaubt für diesen Text? */
  cloudOk(priv, engine = this.cfg().engine || 'auto') {
    if (priv || !['auto', 'gemini'].includes(engine)) return false;
    return this.s.gemini.cloudAllowed('tts', { freeOk: true });
  }

  /** ElevenLabs nur mit eigenem Schlüssel + Voice-ID, nicht privat, Cloud nicht aus, unter der Zeichengrenze. */
  elevenOk(priv, engine, c) {
    if (priv || !['auto', 'gemini'].includes(engine) || !c.elevenVoiceId || !this.s.secrets.get('elevenlabs.api_key')) return false;
    const cc = this.s.settings.get('cloud') || {};
    if (cc.mode === 'local' || cc.features?.tts === false) return false;
    return this.elevenUsed() < (Number(c.elevenDailyChars) || 10000);
  }
  elevenDay() { const d = new Date(); return `tts:eleven:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
  elevenUsed() { return Number(this.s.db.get('SELECT value FROM meta WHERE key=?', this.elevenDay())?.value || 0); }

  /** ElevenLabs Text→Sprache (PCM 24 kHz → WAV). Schlüssel bleibt im Hauptprozess. */
  async eleven(text, c) {
    require('../core/privacy').assertExternal();
    const r = await this.s.fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(c.elevenVoiceId)}?output_format=pcm_24000`, {
      method: 'POST', headers: { 'xi-api-key': this.s.secrets.get('elevenlabs.api_key'), 'Content-Type': 'application/json', Accept: 'audio/pcm' },
      body: JSON.stringify({ text: String(text).slice(0, 1500), model_id: c.elevenModel || 'eleven_flash_v2_5' }), signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error('ElevenLabs antwortet mit HTTP ' + r.status);
    const pcm = Buffer.from(await r.arrayBuffer());
    if (pcm.length < 200) throw new Error('ElevenLabs hat kein Audio geliefert');
    this.s.db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', this.elevenDay(), String(this.elevenUsed() + String(text).length));
    return require('../providers/gemini').pcmToWav(pcm, 24000);
  }

  cached(parts, make) {
    const key = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
    const hit = this.fromCache(key);
    if (hit) return Promise.resolve({ wav: hit, cached: true });
    return make().then((wav) => { this.toCache(key, wav); return { wav }; });
  }

  /**
   * Satz → WAV mit dem gewählten Stimmprofil (Standard / J.A.R.V.I.S. / Alya). Reihenfolge: eigene lizenzierte
   * ElevenLabs-Stimme (falls Voice-ID + Schlüssel) → Cloud-Stimme (Gemini-TTS) → lokal (Piper). Keine LLM-Anfrage –
   * gesprochen wird die fertige Antwort. Fertige Cloud-Audios und Hörproben werden gespeichert.
   * override: Hörprobe mit anderem Profil/Engine (ändert nichts dauerhaft).
   */
  async synthesize(text, { override = {}, private: priv = false, preview = false } = {}) {
    const c = resolve({ ...this.cfg(), ...override }, { isInstalled: (v) => !!this.s.tts.voiceFile?.(v) });
    const engine = c.engine || 'auto';
    const clamp = (x) => Math.max(0.8, Math.min(1.25, Number(x) || 1));
    const cloudPitch = c.preset === 'standard' ? clamp(c.pitch) : 1; // Cloud-Stimmen der Profile klingen ohne Verstellung am natürlichsten
    if (this.elevenOk(priv, engine, c)) {
      try {
        const r = await this.cached(['e', c.elevenVoiceId, c.elevenModel || '', String(text)], () => this.eleven(text, c));
        return { ...r, pitch: cloudPitch, engine: 'elevenlabs', preset: c.preset };
      } catch (e) { log.info('ElevenLabs nicht genutzt: ' + e.message); }
    }
    if (['auto', 'omnivoice'].includes(engine) && this.s.omnivoice?.allowed()) {
      try {
        const said = localPronunciation(text);
        const r = await this.cached(['o', c.preset, c.omniInstruct, c.omniSeed, c.speed ?? 1, said], () => this.s.omnivoice.synthesize(said, { instruct: c.omniInstruct, ref: `${c.preset}-${c.omniSeed}-${crypto.createHash('sha1').update(c.omniInstruct).digest('hex').slice(0, 8)}`, seed: c.omniSeed, speed: c.speed && c.speed !== 1 ? c.speed : undefined }));
        return { ...r, pitch: 1, engine: 'omnivoice', preset: c.preset };
      } catch (e) { log.info('Lokale KI-Stimme nicht genutzt: ' + e.message); }
    }
    if (engine !== 'omnivoice' && this.cloudOk(priv, engine)) {
      const voiceName = c.cloudVoice || 'Kore';
      try {
        const r = await this.cached(['g', voiceName, c.cloudStyle || '', String(text)], () => this.s.gemini.speak(text, { voiceName, style: c.cloudStyle || '' }));
        return { ...r, pitch: cloudPitch, engine: 'gemini', preset: c.preset };
      } catch (e) { log.info('Cloud-Stimme nicht genutzt: ' + e.message); }
    }
    const local = { ...override, voice: c.voice, pitch: c.pitch, speed: c.speed, style: c.style, speaker: c.speaker };
    const run = () => this.s.tts.synthesize(localPronunciation(text), local);
    if (preview) {
      // Hörproben lokal zwischenspeichern (gleicher Text, gleiche Stimme → sofort)
      const r = await this.cached(['p', c.voice || '', c.pitch, c.speed, c.style || '', c.speaker ?? '', String(text)], async () => (await run()).wav);
      return { ...r, pitch: clamp(c.pitch), engine: 'piper', preset: c.preset, fallback: !!c.presetFallback };
    }
    const r = await run();
    return { ...r, engine: 'piper', preset: c.preset, fallback: !!c.presetFallback };
  }
}

module.exports = { Speech, localPronunciation, LEXICON };
