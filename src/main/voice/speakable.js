'use strict';
/**
 * Bildschirmtext → gut vorlesbarer Text (ohne KI, deterministisch).
 * Entfernt Formatierung, schreibt Zeichen/Abkürzungen aus und kürzt lange Antworten
 * (Details bleiben im Chat). Teilt in Abschnitte, damit die Ausgabe sofort beginnt.
 */
const ABBR = [
  [/\bz\.\s?B\./gi, 'zum Beispiel'], [/\bu\.\s?a\./g, 'unter anderem'], [/\bd\.\s?h\./gi, 'das heißt'], [/\bca\./gi, 'circa'],
  [/\bbzw\./gi, 'beziehungsweise'], [/\bggf\./gi, 'gegebenenfalls'], [/\binkl\./gi, 'inklusive'], [/\bvgl\./gi, 'vergleiche'],
  [/\bNr\./g, 'Nummer'], [/\bStd\./g, 'Stunden'], [/\bMin\.(?=\s|$)/g, 'Minuten'], [/\bSek\./g, 'Sekunden'], [/\bmax\./gi, 'maximal'], [/\bmin\.(?=\s\d)/g, 'mindestens'],
  [/\bCS\/min\b/gi, 'CS pro Minute'], [/\bK\/D\b/g, 'K D'], [/\bKP\b/g, 'Kill-Beteiligung'], [/\bKDA\b/g, 'K D A'], [/\bHP\b/g, 'H P'], [/\bLvl\.?\b/gi, 'Level'],
  [/\bPMC\b/g, 'P M C'], [/\bFIR\b/g, 'Found in Raid'], [/\bLoL\b/g, 'League'], [/\bEFT\b/g, 'Tarkov'],
];

function clean(text) {
  let t = String(text || '');
  t = t.replace(/```[\s\S]*?```/g, ' ')                     // Codeblöcke
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                     // Bilder
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')                    // Links → Text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*\|?\s*:?-{2,}.*$/gm, ' ')                     // Tabellen-Trennzeilen
    .replace(/\|/g, ', ')
    .replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, '$1.')                  // Überschriften → Satz
    .replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, '')                    // Aufzählungszeichen
    .replace(/^\s*-{3,}\s*$/gm, ' ')                            // Trennlinien
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[^\w*])[*_](\S[^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/[*_#>~]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '');
  // Zahlen und Zeichen
  t = t.replace(/(\d+)\/(\d+)\/(\d+)/g, '$1, $2, $3')            // 3/9/2 (K/D/A)
    .replace(/(^|[\s(])[-–−](\d)/g, '$1minus $2')
    .replace(/(\d)\s?%/g, '$1 Prozent').replace(/(\d)\s?€/g, '$1 Euro').replace(/€\s?(\d)/g, '$1 Euro').replace(/(\d)\s?\$/g, '$1 Dollar')
    .replace(/(\d)\s?(?:Min|min)\b/g, '$1 Minuten').replace(/(\d)\s?h\b/g, '$1 Stunden').replace(/(\d)\s?s\b/g, '$1 Sekunden')
    .replace(/(\d)\s?k\b/gi, '$1 tausend')
    .replace(/\s?&\s?/g, ' und ').replace(/\s?\+\s?(?=\D)/g, ' plus ').replace(/→|->|=>/g, ', ').replace(/\s[–—-]\s/g, ', ')
    .replace(/(\d)\.(\d{3})\b/g, '$1$2')                        // 1.234 → 1234
    .replace(/(\d)\.(\d)/g, '$1,$2');                            // 4.7 → 4,7 („vier Komma sieben“)
  for (const [re, rep] of ABBR) t = t.replace(re, rep);
  return t.replace(/\(([^()]{0,80})\)/g, ', $1,').replace(/[()[\]]/g, ' ') // Klammern als Einschub
    .replace(/([^.!?:;\s])\s*\n/g, (m, c) => (c === ',' ? '.\n' : c + '.\n')).replace(/\s*\n\s*/g, ' ')        // Zeilen = Sätze
    .replace(/\s+([,.!?:;])/g, '$1').replace(/([,.!?:;])(?:\s*[,;])+/g, '$1').replace(/\.{2,}/g, '.').replace(/,\s*\./g, '.')
    .replace(/:\s*,/g, ':').replace(/,\s*:/g, ':').replace(/,\s*([.!?])/g, '$1').replace(/^[,.\s]+/, '').replace(/\s{2,}/g, ' ').trim().replace(/[,;:]$/, '.');
}

/** Sätze trennen (ohne Dezimalzahlen und Abkürzungen zu zerreißen). */
function sentences(t) {
  return String(t).split(/(?<=[.!?])\s+(?=[\p{Lu}\d„"])/u).map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {string} text Bildschirmtext
 * @param {{ full?: boolean, maxChars?: number }} o full = alles vorlesen (Knopf „Vorlesen“), sonst Kurzfassung
 * @returns {{ text: string, parts: string[], truncated: boolean }}
 */
function speakable(text, { full = false, maxChars = 420 } = {}) {
  const all = sentences(clean(text));
  let out = all; let truncated = false;
  if (!full) {
    out = []; let n = 0;
    for (const s of all) { if (out.length && n + s.length > maxChars) { truncated = true; break; } out.push(s); n += s.length; }
    if (truncated) out.push('Den Rest findest du im Chat.');
  }
  // Abschnitte: erster Satz allein (schneller Start), danach Blöcke bis ~350 Zeichen
  const parts = out.length ? [out[0]] : [];
  for (const s of out.slice(1)) {
    const i = parts.length - 1;
    if (i >= 1 && parts[i].length + s.length < 350) parts[i] += ' ' + s;
    else parts.push(s);
  }
  return { text: out.join(' '), parts: parts.map((p) => p.slice(0, 1200)), truncated };
}

module.exports = { speakable, clean, sentences };
