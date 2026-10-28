'use strict';
/**
 * Technische Laufzeitfehler (fehlende Angabe, falscher Typ) in verständliche Meldungen übersetzen,
 * statt „Provided value cannot be bound to SQLite parameter 1“ oder „Cannot read properties of undefined“ zu zeigen.
 */
function technical(err) {
  const msg = String(err?.message || err || '');
  const field = (msg.match(/\(reading '([^']+)'\)/) || msg.match(/destructure property '([^']+)'/) || [])[1];
  const named = field && !/^(trim|toLowerCase|toUpperCase|length|map|filter|slice|split|replace|join|forEach|includes|startsWith)$/.test(field) ? field : '';
  if (/cannot be bound to SQLite parameter|NOT NULL constraint failed/i.test(msg)) return new Error('Angabe fehlt oder der Eintrag wurde nicht gefunden (vielleicht schon gelöscht). Bitte die Ansicht neu laden.');
  if (/Cannot read properties of (?:undefined|null)|Cannot destructure property/i.test(msg)) return new Error(`Angabe ${named ? `„${named}“ ` : ''}fehlt oder ist ungültig.`);
  if (/Invalid time value/i.test(msg)) return new Error('Ungültiges Datum oder ungültiger Zeitraum.');
  if (/is not a function|is not iterable|is not defined/i.test(msg)) return new Error('Interner Fehler – Details stehen im Protokoll (Einstellungen → System → Protokoll).');
  return err;
}

module.exports = { technical };
