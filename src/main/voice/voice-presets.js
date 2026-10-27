'use strict';
/**
 * Stimmprofile für die Sprachausgabe (Einstellungen → Stimme).
 * Es werden KEINE echten Schauspieler- oder Synchronstimmen nachgebildet: „J.A.R.V.I.S.“ und „Alya“ sind
 * eigenständige Stimmen mit ähnlicher Wirkung (Tonlage, Tempo, Sprechstil). Wer rechtmäßig lizenzierte
 * Stimmen besitzt (z. B. in ElevenLabs), trägt deren Voice-ID im Profil ein – dann wird diese genutzt.
 *
 * Je Profil Werte für jede Engine; fehlt etwas (Stimme nicht installiert, kein Schlüssel), gilt „Standard“.
 * Profile werden nur lokal gespeichert und nie an ein Sprachmodell geschickt.
 */
const PRESETS = Object.freeze({
  standard: {
    label: 'Standard', description: 'Bisherige Stimme mit deinen Einstellungen aus „Sprachausgabe“.',
  },
  jarvis: {
    label: 'J.A.R.V.I.S.', description: 'Tief, ruhig, elegant, britisch anmutend – eine eigenständige KI-Butler-Stimme.',
    gemini: { voice: 'Charon', style: 'Sprich als ruhige, tiefe und elegante KI-Stimme mit dezent britisch anmutendem Tonfall – souverän, höflich, etwas trocken, nicht zu schnell, auf Deutsch' },
    piper: { voice: 'de_DE-thorsten-medium', pitch: 0.9, speed: 0.93 },
    windows: { prefer: 'conrad|killian|stefan|florian|george|ryan|thomas', pitch: 0.85, speed: 0.95 },
  },
  alya: {
    label: 'Alya (Anime)', description: 'Natürlich, freundlich und weich – eine eigenständige, anime-inspirierte Stimme.',
    gemini: { voice: 'Leda', style: 'Sprich natürlich, freundlich und weich wie eine junge, lebhafte Anime-Begleiterin – warm, leicht verspielt, klar verständlich, auf Deutsch' },
    piper: { voice: 'de_DE-kerstin-low', pitch: 1.08, speed: 1.02 },
    windows: { prefer: 'katja|amala|seraphina|hedda|louisa', pitch: 1.2, speed: 1.02 },
  },
});
const PRESET_IDS = Object.keys(PRESETS);

/** Profil-ID prüfen; unbekannt → standard. */
const presetId = (id) => (PRESET_IDS.includes(id) ? id : 'standard');

/**
 * Einstellungen der Sprachausgabe + Profil → wirksame Werte je Engine.
 * isInstalled(voiceId) prüft lokale Piper-Stimmen; fehlt die Profilstimme, bleibt die Standardstimme.
 */
function resolve(cfg = {}, { isInstalled = () => true } = {}) {
  const id = presetId(cfg.preset);
  const p = PRESETS[id];
  const out = { ...cfg, preset: id, label: p.label, elevenVoiceId: (cfg.elevenVoices || {})[id] || '' };
  if (id === 'standard') return out;
  if (p.gemini) { out.cloudVoice = p.gemini.voice; out.cloudStyle = p.gemini.style; }
  if (p.piper) {
    // Profilstimme lokal installiert → mit Tonhöhe/Tempo des Profils; sonst unverändert die Standardstimme
    if (isInstalled(p.piper.voice)) { out.voice = p.piper.voice; out.pitch = p.piper.pitch; out.speed = p.piper.speed; out.style = undefined; out.speaker = undefined; }
    else out.presetFallback = true;
  }
  return out;
}

/** Für die Oberfläche (keine Schlüssel): Profile mit Beschreibung und Windows-Vorlieben. */
function publicPresets() {
  return PRESET_IDS.map((id) => ({ id, label: PRESETS[id].label, description: PRESETS[id].description, windows: PRESETS[id].windows || null }));
}

/**
 * Sprachbefehl „Stimme auf Alya“, „nimm die Jarvis-Stimme“, „sprich wieder normal“ → Profil-ID, sonst null.
 * Ohne KI, damit der Wechsel sofort und kostenlos klappt. Die Anrede „(Hey) Jarvis,“ am Anfang zählt nicht.
 */
const WORDS = [['alya', /\b(?:alya|alja|alia|aliya|alyah|anime)\b/g], ['jarvis', /\b(?:j\.?a\.?r\.?v\.?i\.?s\.?|jarvis|dschawis|butler)\b/g], ['standard', /\b(?:standard|normal(?:e|en)?|default|alte|ursprüngliche|bisherige)\b/g]];
function parseVoiceCommand(text) {
  const t = String(text || '').toLowerCase().trim().replace(/^(?:hey|hi|hallo|ok(?:ay)?)?\s*j\.?a\.?r\.?v\.?i\.?s\.?[\s,!:.-]*/, '');
  if (!t || t.length > 90 || !/\b(?:stimme|stimmen|stimmprofil|voice|sprich|sprech\w*|rede|klingen|klingst)\b/.test(t)) return null;
  if (/\?$|\b(?:welche|was für|wie klingt|wie heißt)\b/.test(t)) return null; // Fragen, keine Befehle
  let best = null;
  for (const [id, re] of WORDS) for (const m of t.matchAll(re)) if (!best || m.index > best.at) best = { id, at: m.index };
  return best?.id || null;
}

module.exports = { PRESETS, PRESET_IDS, presetId, resolve, publicPresets, parseVoiceCommand };
