'use strict';
/**
 * Stimmung der Figur – ohne KI, sofort und kostenlos aus Frage und Antwort abgeleitet.
 * Ergebnis: { pose, ms } – pose ist eine Bildpose der Figur, ms wie lange sie gehalten wird (0 = bis zur nächsten Eingabe).
 *   happy   – gute Nachricht, erledigt, gewonnen, Lob/Dank
 *   oops    – Fehler, leider, verloren, nichts gefunden
 *   gesture – Erklärung, Tipps, Anleitung, Liste
 *   lean    – Rückfrage an dich („Soll ich …?“) – wartet neugierig auf deine Antwort
 *   wave    – Begrüßung/Verabschiedung
 *   idle    – nichts Besonderes
 * Und für die Denkpose während der Antwort: deep (think_high) bei schweren/langen Fragen.
 */
const T = (s) => String(s || '').toLowerCase();

const GOOD = /(?<![a-zäöüß])(?:erledigt|geschafft|gespeichert|eingetragen|angelegt|gebucht|gemerkt|fertig|gewonnen|sieg(?:e|reich)?|win|victory|level ?up|aufgestiegen|bestanden|glückwunsch|gratuliere|stark|super|perfekt|klasse|top|nice|läuft|alles im griff|alles erledigt|frei(?:e zeit)?|keine termine)(?![a-zäöüß])|🎉|✅|💪|👍/;
const BAD = /(?<![a-zäöüß])(?:leider|fehler|fehlgeschlagen|nicht gefunden|nicht erreichbar|geht nicht|klappt nicht|kein(?:e|en)? (?:verbindung|schlüssel|zugriff)|abgelehnt|gesperrt|überfällig|verpasst|verloren|niederlage|defeat|gestorben|tot|überschritten|zu spät|achtung|warnung|vorsicht|sorry|entschuldig)(?![a-zäöüß])|⚠️|❌/;
const GREET = /^(?:hi|hallo|hey|moin|servus|guten (?:morgen|tag|abend)|gute nacht|tschüss|bis (?:später|morgen|dann)|ciao|na\b)/;
const THANKS = /(?<![a-zäöüß])(?:danke|dankeschön|vielen dank|thx|merci|du bist (?:der|die) beste|gut gemacht|stark)(?![a-zäöüß])/;
const RUDE = /(?<![a-zäöüß])(?:dumm|blöd|nervig|scheiße|scheisse|falsch|quatsch|nutzlos)(?![a-zäöüß])/;
const EXPLAIN = /(?<![a-zäöüß])(?:erklär\w*|wie (?:funktioniert|geht|mache|kann)|warum|wieso|weshalb|was ist|unterschied|vergleich\w*|tipps?|anleitung|schritt|strategie|build|guide|lern\w*)(?![a-zäöüß])/;
const DEEP = /(?<![a-zäöüß])(?:warum|wieso|weshalb|erklär\w*|vergleich\w*|unterschied|analys\w*|plan\w*|strategie|bewert\w*|gründlich|ausführlich|recherch\w*|überleg\w*|beweis\w*|optimier\w*)(?![a-zäöüß])/;

/** Denkpose während der Antwort: think_high bei schweren Fragen, sonst think. */
function thinkPose(userText) {
  const t = T(userText);
  return DEEP.test(t) || t.length > 140 ? 'think_high' : 'think';
}

function moodFor({ userText = '', answer = '', error = false } = {}) {
  const q = T(userText).trim(); const a = T(answer).replace(/[*_`#>]/g, '');
  if (error) return { pose: 'oops', ms: 3500 };
  if (GREET.test(q) && a.length < 220) return { pose: 'wave', ms: 2600 };
  if (THANKS.test(q) && a.length < 260) return { pose: 'happy', ms: 3000 };
  if (RUDE.test(q) && a.length < 400) return { pose: 'oops', ms: 3000 };
  const bad = (a.match(new RegExp(BAD.source, 'g')) || []).length;
  const good = (a.match(new RegExp(GOOD.source, 'g')) || []).length;
  if (bad > good) return { pose: 'oops', ms: 3500 };
  // Antwort endet mit einer Rückfrage → neugierig vorbeugen und warten
  const lastLine = a.trim().split(/\n+/).pop() || '';
  if (/\?\s*$/.test(lastLine) && /(?<![a-zäöüß])(?:soll ich|willst du|möchtest du|magst du|wollen wir|sag mir|oder lieber|welche[rsn]?|wann)\b/.test(lastLine)) return { pose: 'lean', ms: 0 };
  if (good > 0 && a.length < 500) return { pose: 'happy', ms: 3000 };
  const listy = (a.match(/^\s*(?:[-*•]|\d+[.)])\s/gm) || []).length >= 2;
  if (listy || EXPLAIN.test(q) || a.length > 420) return { pose: 'gesture', ms: 5000 };
  if (good > 0) return { pose: 'happy', ms: 2600 };
  return { pose: 'idle', ms: 0 };
}

module.exports = { moodFor, thinkPose };
