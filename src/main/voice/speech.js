'use strict';
/**
 * Sprachausgabe – komplett lokal (Gemini liefert nur noch Text):
 * - „auto“ (Standard): lokale KI-Stimme OmniVoice (falls installiert), sonst Piper.
 * - „piper“: immer Piper; „windows“ übernimmt die Oberfläche.
 * - Fertige Audios werden lokal zwischengespeichert (gleiche Sätze, z. B. Ansagen, sofort).
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

  cached(parts, make) {
    const key = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
    const hit = this.fromCache(key);
    if (hit) return Promise.resolve({ wav: hit, cached: true });
    return make().then((wav) => { this.toCache(key, wav); return { wav }; });
  }

  /**
   * Satz → WAV mit dem gewählten Stimmprofil (Standard / J.A.R.V.I.S. / Alya): OmniVoice → Piper.
   * Keine KI-Anfrage – gesprochen wird die fertige Antwort. override: Hörprobe mit anderem Profil/Engine.
   */
  async synthesize(text, { override = {}, preview = false } = {}) {
    const c = resolve({ ...this.cfg(), ...override }, { isInstalled: (v) => !!this.s.tts.voiceFile?.(v) });
    const engine = ['piper', 'windows'].includes(c.engine) ? c.engine : 'auto';
    const clamp = (x) => Math.max(0.8, Math.min(1.25, Number(x) || 1));
    if (engine === 'auto' && this.s.omnivoice?.allowed()) {
      try {
        const said = localPronunciation(text);
        const custom = (c.omni?.voices || {})[c.preset];
        const ref = `${c.preset}-${c.omniSeed}-${crypto.createHash('sha1').update(c.omniInstruct).digest('hex').slice(0, 8)}`;
        const r = await this.cached(['o', ref, c.speed ?? 1, c.omni?.quality || 'fast', said], () => this.s.omnivoice.synthesize(said, { instruct: c.omniInstruct, ref, seed: c.omniSeed, refAudio: this.s.omnivoice.bundledRef(c.preset, c.omniSeed, custom), refText: require('./omnivoice').REF_TEXT, speed: c.speed && c.speed !== 1 ? c.speed : undefined }));
        return { ...r, pitch: 1, engine: 'omnivoice', preset: c.preset };
      } catch (e) { log.info('Lokale KI-Stimme nicht genutzt: ' + e.message); }
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
