'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
const privateText = (text) => /(?:#private|\[private\]|\b(?:privat|private|familie|familien|mutter|vater|eltern|partner|geburtstag|termin|kalender|einnahmen?|ausgaben?|gehalt|einkommen|konto|iban|schulden|miete|gesundheit|arzt)\b)/i.test(String(text));
const isPrivate = () => scope.getStore() === 'private';
const isCloud = () => scope.getStore() === 'cloud';
const local = (fn) => scope.run('private', fn);
const cloud = (fn) => scope.run('cloud', fn);
/** Persönliche Daten/Assistenz-Aktionen („meine Klausur“, „erinner mich“, „trag ein“) → lokal. */
const personalText = (text) => /\b(?:mein(?:e|en|em|er|es)?|unser(?:e|en|em|er)?)\s+(?:\w+\s+)?(?:termine?n?|klausur(?:en)?|prüfung(?:en)?|noten?|abgaben?|fristen?|aufgaben?|todos?|to-dos?|einkauf\w*|vorr[aä]t\w*|rezepte?|trainings?|workouts?|notizen?|budget|abos?|buckets?|geld|konto|nachrichten|mails?|e-mails?|freund\w*|bruder|schwester|oma|opa|chef\w*|wohnung|adresse|handynummer|passwort|daten)\b|\b(?:erinner(?:e|n)?\s+mich|merk(?:e)?\s+dir|vergiss|trag\w*\s+(?:[\wäöüß.:]+\s+){0,8}ein|leg\w*\s+(?:[\wäöüß.:]+\s+){0,6}an|erstell\w*\s+(?:\w+\s+){0,2}(?:termin|aufgabe|erinnerung|todo)|was\s+steht\s+(?:heute|morgen|an)|wie\s+viel\s+(?:geld|hab\s+ich))/i.test(String(text));
const GAME_WORDS = /\b(?:lol|league|champ\w*|tarkov|eft|raid|quests?|boss(?:e)?|builds?|patch\w*|matchups?|jungle\w*|lanes?|botlane|toplane|midlane|supp(?:ort)?|adc|ganks?|skins?|elo|ranked|loot|items?|waffen?|munition|ammo|ark|aion|pubg|cs2|counter-?strike|valorant|minecraft|fortnite|steam|zocken|spiel(?:e|en|st)?|game\w*|gaming|overlay|raid\w*)\b/i;
const STUDY_WORDS = /\b(?:uni|universität|hochschule|vorlesung\w*|modul\w*|seminar\w*|übungsblatt|übung\w*|skript\w*|lern(?:e|en|zettel)\w*|erklär\w*|definition|formel\w*|beweis\w*|mathe\w*|physik|informatik|bwl|vwl|statistik|programmier\w*|algorithm\w*|hausarbeit|referat|thesis|zusammenfass\w*)\b/i;
/** Öffentliches Thema einer Nachricht: 'gaming' | 'study' | null. */
function publicTopic(text, { gameActive = false } = {}) {
  const t = String(text || '');
  if (GAME_WORDS.test(t)) return 'gaming';
  if (STUDY_WORDS.test(t)) return 'study';
  return gameActive ? 'gaming' : null;
}
/** Lokale KI ausgeschaltet → private Fragen (und ihre Sprachausgabe) laufen bewusst über Google. */
const privateViaCloud = (settings) => (settings?.get?.('localLLM') || {}).enabled === false;
function assertExternal() { if (isPrivate()) throw new Error('Private: externe Zugriffe sind für diese Aktion gesperrt.'); }
// Nicht-private Nachrichten (Gemini) haben keinen persönlichen Kontext und nur diese geprüften Werkzeuge.
const CLOUD_TOOLS = new Set(['set_game_context', 'tarkov_lookup', 'tarkov_raid_plan', 'tarkov_item_value', 'tarkov_needed_items', 'update_game_progress', 'voice_standby', 'set_voice', 'game_stats', 'record_raid']);
// Spieldaten nur bei Gaming-Nachrichten (eigene LoL-Matches zusätzlich nur mit Zustimmung).
const GAMING_TOOLS = new Set([...CLOUD_TOOLS, 'league_recent_matches', 'league_stats', 'league_deep_review', 'league_live', 'league_progress', 'league_coaching', 'league_champion', 'lol_matchup', 'lol_note', 'league_goal', 'lol_debrief', 'lol_counters']);
const cloudTools = (privacy) => privacy === 'gaming' ? GAMING_TOOLS : CLOUD_TOOLS;
const CLOUD_SYSTEM = 'Du bist JARVIS, ein persönlicher KI-Assistent. Du bekommst nur nicht-private Nachrichten (Wissen, Uni, Gaming, allgemeine Fragen); persönliche Daten wie Termine, Finanzen, Gesundheit oder Familie beantwortet ein lokales Modell auf dem PC – frag nicht danach und erfinde nichts darüber. Antworte auf Deutsch, klar und kompakt.';
const LOCAL_TOOLS = new Set('set_voice set_game_context voice_standby league_recent_matches league_stats get_today_overview list_tasks create_task update_task complete_task delete_task list_events find_free_slots create_event schedule_events update_event delete_event list_exams create_exam plan_exam log_study search_brain remember forget search_study list_documents read_document deadlines add_deadline deadline_done add_expense finance_overview recurring_money add_income subscription shopping_list pantry recipe_ideas log_workout training_progress rest_timer birthday_gifts expense_buckets game_stats record_raid lol_counters'.split(' '));
/**
 * Welche Werkzeuge bekommt das lokale Modell für diese Frage? Alle 46 Beschreibungen sind ≈ 6.400 Tokens – auf dem Gaming-PC
 * mit Spiel/CPU-Betrieb dauert allein das Einlesen Minuten. Darum: ein kleiner Grundstock plus die Themengruppen, die zu
 * den letzten Nachrichten passen (Folgefragen wie „ja, bitte“ behalten so die Werkzeuge des Themas). Ausführen darf das Modell
 * weiterhin nur LOCAL_TOOLS (siehe Orchestrator) – das hier verkleinert nur, was mitgeschickt wird.
 */
const TOOL_GROUPS = [
  [/termin|kalender|zeit|uhr|morgen|heute|woche|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|frei|plan|verschieb|trag/i, 'list_events find_free_slots create_event schedule_events update_event delete_event'],
  [/aufgabe|todo|to-do|erledig|task|liste/i, 'list_tasks create_task update_task complete_task delete_task'],
  [/klausur|prüfung|pruefung|exam|lern|uni|studi|vorlesung|dokument|skript|deadline|frist|abgabe/i, 'list_exams create_exam plan_exam log_study search_study list_documents read_document deadlines add_deadline deadline_done'],
  [/geld|ausgabe|einnahme|euro|€|budget|bucket|abo|konto|gehalt|kosten|bezahl|miete|finanz/i, 'add_expense finance_overview recurring_money add_income subscription expense_buckets'],
  [/einkauf|rezept|vorrat|essen|kochen|zutat|kühlschrank/i, 'shopping_list pantry recipe_ideas'],
  [/training|workout|sport|gym|satz|wiederholung|pause|gewicht/i, 'log_workout training_progress rest_timer'],
  [/geburtstag|geschenk/i, 'birthday_gifts'],
  [/league|lol|champion|tarkov|raid|spiel|game|zock|counter|match|rang/i, 'league_recent_matches league_stats game_stats record_raid lol_counters set_game_context'],
  [/stimme|voice|standby|sprich|sprech|schlaf|pause/i, 'set_voice voice_standby'],
  [/merk|vergiss|weißt du|wusstest|notiz|brain|erinner/i, 'remember forget search_brain'],
];
const TOOL_BASE = 'get_today_overview list_tasks create_task complete_task list_events create_event remember search_brain'.split(' ');
function localToolsFor(texts, allowed = LOCAL_TOOLS) {
  const t = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join(' \n ');
  const out = new Set(TOOL_BASE);
  for (const [re, names] of TOOL_GROUPS) if (re.test(t)) for (const n of names.split(' ')) out.add(n);
  return new Set([...out].filter((n) => allowed.has(n)));
}
module.exports = { privateViaCloud, localToolsFor, LOCAL_TOOLS, local, cloud, isPrivate, isCloud, assertExternal, privateText, personalText, publicTopic, CLOUD_TOOLS, GAMING_TOOLS, cloudTools, CLOUD_SYSTEM };
