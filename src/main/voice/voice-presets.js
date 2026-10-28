'use strict';
/**
 * Stimmprofile für die Sprachausgabe (Einstellungen → Stimme).
 * Es werden KEINE echten Sprecher nachgebildet: „J.A.R.V.I.S.“ und „Alya“ sind eigenständige, von OmniVoice
 * aus Beschreibungen erzeugte Stimmen; beim Zocken spricht die passende Google-Stimme.
 * Profile werden nur lokal gespeichert.
 */
const PRESETS = Object.freeze({
  standard: {
    label: 'Standard', description: 'Neutrale, klare Stimme.',
    omni: { instruct: 'male, young adult, moderate pitch' },
  },
  jarvis: {
    label: 'J.A.R.V.I.S.', description: 'Tief, ruhig, elegant, britisch anmutend – eine eigenständige KI-Butler-Stimme.',
    omni: { instruct: 'male, middle-aged, low pitch' },
  },
  alya: {
    label: 'Alya (Anime)', description: 'Natürlich, freundlich und weich – eine eigenständige, anime-inspirierte Stimme.',
    omni: { instruct: 'female, young adult, high pitch' },
  },
});
const PRESET_IDS = Object.keys(PRESETS);

/** Profil-ID prüfen; unbekannt → standard. */
const presetId = (id) => (PRESET_IDS.includes(id) ? id : 'standard');

/**
 * Einstellungen der Sprachausgabe + Profil → wirksame Werte für OmniVoice.
 */
function resolve(cfg = {}) {
  const id = presetId(cfg.preset);
  const p = PRESETS[id];
  const om = cfg.omni || {};
  const out = { ...cfg, preset: id, label: p.label,
    omniInstruct: String((om.voices || {})[id] || p.omni?.instruct || PRESETS.standard.omni.instruct), omniSeed: Number((om.seeds || {})[id]) || 1 };
  return out;
}

/** Für die Oberfläche (keine Schlüssel): Profile mit Beschreibung. */
function publicPresets() {
  return PRESET_IDS.map((id) => ({ id, label: PRESETS[id].label, description: PRESETS[id].description, omni: PRESETS[id].omni?.instruct || '' }));
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
