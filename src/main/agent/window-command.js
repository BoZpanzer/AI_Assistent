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
/** „mach (mal) die Sprechblase weg“, „Blase zu“, „Sprechblase ausblenden“ → true */
function parseBubbleCommand(text) {
  const t = String(text || '').toLowerCase().replace(/^(?:hey\s+)?jarvis[,!.\s]+/, '').trim();
  if (!t || t.length > 70 || /\?\s*$/.test(t) || !/\b(?:sprech)?blase\b|\bbubble\b/.test(t)) return false;
  return /\b(?:weg|zu|aus|schließ\w*|schliess\w*|ausblend\w*|ausmach\w*|verschwind\w*|entfern\w*|lösch\w*|minimier\w*)\b/.test(t);
}
/** „geh in den Standby“, „Standby“, „schlaf jetzt“, „mach Pause“, „gute Nacht Jarvis“ → true */
function parseStandbyCommand(text) {
  const t = String(text || '').toLowerCase().replace(/^(?:hey\s+)?jarvis[,!.\s]+/, '').replace(/[,!.]+\s*(?:jarvis)?\s*$/, '').trim();
  if (!t || t.length > 60 || /\?\s*$/.test(t)) return false;
  return /^(?:(?:geh|wechsel|schalt)\w*\s+(?:mal\s+)?(?:in\s+den\s+|auf\s+)?stand-?by(?:[\s-]*modus)?|stand-?by(?:[\s-]*modus)?(?:\s+bitte)?|(?:geh\s+)?schlaf(?:en)?(?:\s+(?:jetzt|gehen|mal))?|leg\s+dich\s+schlafen|(?:mach|mache)\s+(?:mal\s+)?(?:eine\s+)?pause|pause(?:\s+bitte)?|gute\s+nacht(?:\s+jarvis)?|ruhe(?:modus)?)$/.test(t);
}
/**
 * „Stell den Chat auf öffentlich“, „beantworte das nochmal privat“, „frag das online“ → 'public' | 'private' | null.
 * Verhörer der Spracherkennung inklusive („Schät“, „Tschat“, „Publikum“, „publik“).
 */
function parseRouteCommand(text) {
  const t = String(text || '').toLowerCase().replace(/^(?:hey\s+)?jarvis[,!.\s]+/, '').trim();
  if (!t || t.length > 120) return null;
  if (/^(?:wie|was|warum|wieso|weshalb|wo|wann|welche\w*|kann man|gibt es)\b/.test(t)) return null; // echte Fragen
  // \b kennt keine Umlaute → eigene Wortgrenzen
  const W = (alts) => new RegExp('(?<![a-zäöüß])(?:' + alts + ')(?![a-zäöüß])');
  const verb = W('stell\\w*|schalt\\w*|setz\\w*|mach\\w*|wechsel\\w*|frag\\w*|beantworte?\\w*|antworte?\\w*|nimm|nutz\\w*|benutz\\w*|schick\\w*|lass').test(t);
  const what = W('chat|tschat|tschät|schät|schat|tchat|gespräch|frage|antwort|das|es|ihn|nochmal|noch mal').test(t);
  if (!verb || !what) return null;
  if (W('öffentlich\\w*|oeffentlich\\w*|public|publik|publikum|online|cloud|internet|groq|gemini').test(t)) return 'public';
  if (W('privat\\w*|lokal\\w*|offline').test(t)) return 'private';
  return null;
}
module.exports = { parseWindowCommand, parseBubbleCommand, parseStandbyCommand, parseRouteCommand };
