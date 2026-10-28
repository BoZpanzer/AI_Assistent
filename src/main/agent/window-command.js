'use strict';
/**
 * „Jarvis, zeig dich“ / „mach das Fenster zu“ → Oberfläche ein-/ausblenden (ohne KI, sofort).
 * Gibt 'show' | 'hide' | null zurück. Fragen und bloße Erwähnungen zählen nicht.
 */
const SHOW = [
  /(?:^|\s)(?:zeig|öffne|oeffne|hol)\w*\s+(?:dich|mal\s+dich|(?:das|dein|die)\s+(?:fenster|oberfläche|ui|app|menü|dashboard)|jarvis)\b/,
  /\b(?:fenster|oberfläche|ui|app|dashboard)\s+(?:auf|öffnen|zeigen|her|nach vorne)\b/,
  /\bkomm\s+(?:raus|nach vorne|her)\b/,
];
const HIDE = [
  /\b(?:versteck|minimier|schließ|schliess|mach)\w*\s+(?:dich|(?:das|dein|die)\s+(?:fenster|oberfläche|ui|app|dashboard))(?:\s+(?:zu|weg|aus))?\b/,
  /\b(?:fenster|oberfläche|ui|app|dashboard)\s+(?:zu|weg|schließen|ausblenden|minimieren)\b/,
  /\bgeh\s+(?:auf den desktop|weg|runter)\b/,
];
function parseWindowCommand(text) {
  const t = String(text || '').toLowerCase().replace(/^(?:hey\s+)?jarvis[,!.\s]+/, '').trim();
  if (!t || t.length > 80 || /\?\s*$/.test(t) || /^(?:wie|was|warum|wieso|kannst du mir erklären)\b/.test(t)) return null;
  // „mach dich“ allein ist zu unklar – nur mit zu/weg/aus
  if (/\bmach\w*\s+dich\b/.test(t) && !/\bmach\w*\s+dich\s+(?:weg|unsichtbar|klein)\b/.test(t) && !/fenster|oberfläche|ui|app|dashboard/.test(t)) return null;
  if (HIDE.some((re) => re.test(t))) return 'hide';
  if (SHOW.some((re) => re.test(t))) return 'show';
  return null;
}
module.exports = { parseWindowCommand };
