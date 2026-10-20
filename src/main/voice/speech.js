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

const CACHE_MAX = 60 * 1024 * 1024;

/** Aussprachehilfen für die lokale (deutsche) Stimme – englische Gaming-Begriffe lautschriftlich. */
const LEXICON = [
  [/\bToplane\b/gi, 'Topp-Lehn'], [/\bMidlane\b/gi, 'Mitt-Lehn'], [/\bBotlane\b/gi, 'Bott-Lehn'], [/\bLanes?\b/gi, (m) => (m.endsWith('s') ? 'Lehns' : 'Lehn')],
  [/\bLaning\b/gi, 'Lehning'], [/\bJungler\b/gi, 'Dschangler'], [/\bJungle\b/gi, 'Dschangel'], [/\bGanks?\b/gi, (m) => (m.endsWith('s') ? 'Gänks' : 'Gänk')],
  [/\bSupport\b/gi, 'Sapport'], [/\bADC\b/g, 'A D C'], [/\bTop\b/g, 'Topp'], [/\bMid\b/g, 'Mitt'], [/\bBot\b/g, 'Bott'],
  [/\bWards?\b/gi, (m) => (m.endsWith('s') ? 'Wohrds' : 'Wohrd')], [/\bControl\b/gi, 'Kontrol'], [/\bRecall\b/gi, 'Rikohl'], [/\bRoam(en|t)?\b/gi, (m) => 'Rohm' + m.slice(4)],
  [/\bTeamfights?\b/gi, (m) => (m.endsWith('s') ? 'Tiemfeits' : 'Tiemfeit')], [/\bItems?\b/gi, (m) => (m.endsWith('s') ? 'Eitems' : 'Eitem')], [/\bFarm(en)?\b/gi, (m) => 'Fahm' + m.slice(4)],
  [/\bPush(en)?\b/gi, (m) => 'Pusch' + m.slice(4)], [/\bSkillshots?\b/gi, 'Skillschott'], [/\bCooldowns?\b/gi, 'Kuhldaun'], [/\bSplitpush\b/gi, 'Splittpusch'],
  [/\bRaids?\b/gi, (m) => (m.endsWith('s') ? 'Reids' : 'Reid')], [/\bScavs?\b/gi, (m) => (m.endsWith('s') ? 'Skäffs' : 'Skäff')], [/\bQuests?\b/gi, (m) => (m.endsWith('s') ? 'Kwests' : 'Kwest')],
  [/\bLoot\b/gi, 'Luht'], [/\bExtract\b/gi, 'Ixtrakt'], [/\bRun-?Through\b/gi, 'Ran-Sruh'], [/\bFlea\b/gi, 'Flie'], [/\bHideout\b/gi, 'Heid-aut'],
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
    return this.s.gemini.cloudAllowed('tts');
  }

  /**
   * Satz → WAV. override: Hörprobe mit anderer Stimme/Engine. Rückgabe { wav, pitch, engine }.
   * Scheitert die Cloud-Stimme (Grenze, offline, Limit), wird still lokal gesprochen.
   */
  async synthesize(text, { override = {}, private: priv = false } = {}) {
    const c = { ...this.cfg(), ...override };
    const engine = c.engine || 'auto';
    if (this.cloudOk(priv, engine)) {
      const voiceName = c.cloudVoice || 'Kore';
      const key = crypto.createHash('sha256').update(['g', voiceName, c.style || '', String(text)].join('|')).digest('hex').slice(0, 32);
      const hit = this.fromCache(key);
      if (hit) return { wav: hit, pitch: Math.max(0.8, Math.min(1.25, Number(c.pitch) || 1)), engine: 'gemini', cached: true };
      try {
        const wav = await this.s.gemini.speak(text, { voiceName });
        this.toCache(key, wav);
        return { wav, pitch: Math.max(0.8, Math.min(1.25, Number(c.pitch) || 1)), engine: 'gemini' };
      } catch (e) { log.info('Cloud-Stimme nicht genutzt: ' + e.message); }
    }
    const r = await this.s.tts.synthesize(localPronunciation(text), override);
    return { ...r, engine: 'piper' };
  }
}

module.exports = { Speech, localPronunciation, LEXICON };
