'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
const privateText = (text) => /(?:#private|\[private\]|\b(?:privat|private|familie|familien|mutter|vater|eltern|partner|geburtstag|termin|kalender|einnahmen?|ausgaben?|gehalt|einkommen|konto|iban|schulden|miete|gesundheit|arzt)\b)/i.test(String(text));
const isPrivate = () => scope.getStore() === 'private';
const isCloud = () => scope.getStore() === 'cloud';
const local = (fn) => scope.run('private', fn);
const cloud = (fn) => scope.run('cloud', fn);
/** Persönliche Daten/Assistenz-Aktionen („meine Klausur“, „erinner mich“, „trag ein“) → lokal. */
const personalText = (text) => /\b(?:mein(?:e|en|em|er|es)?|unser(?:e|en|em|er)?)\s+(?:\w+\s+)?(?:termine?n?|klausur(?:en)?|prüfung(?:en)?|noten?|abgaben?|fristen?|aufgaben?|todos?|to-dos?|einkauf\w*|vorr[aä]t\w*|rezepte?|trainings?|workouts?|notizen?|budget|abos?|buckets?|geld|konto|nachrichten|mails?|e-mails?|freund\w*|bruder|schwester|oma|opa|chef\w*|wohnung|adresse|handynummer|passwort|daten)\b|\b(?:erinner(?:e|n)?\s+mich|merk(?:e)?\s+dir|vergiss|trag\w*\s+(?:\w+\s+){0,3}ein|leg\w*\s+(?:\w+\s+){0,3}an|erstell\w*\s+(?:\w+\s+){0,2}(?:termin|aufgabe|erinnerung|todo)|was\s+steht\s+(?:heute|morgen|an)|wie\s+viel\s+(?:geld|hab\s+ich))/i.test(String(text));
const GAME_WORDS = /\b(?:lol|league|champ\w*|tarkov|eft|raid|quests?|boss(?:e)?|builds?|patch\w*|matchups?|jungle\w*|lanes?|botlane|toplane|midlane|supp(?:ort)?|adc|ganks?|skins?|elo|ranked|loot|items?|waffen?|munition|ammo|ark|aion|pubg|cs2|counter-?strike|valorant|minecraft|fortnite|steam|zocken|spiel(?:e|en|st)?|game\w*|gaming|overlay|raid\w*)\b/i;
const STUDY_WORDS = /\b(?:uni|universität|hochschule|vorlesung\w*|modul\w*|seminar\w*|übungsblatt|übung\w*|skript\w*|lern(?:e|en|zettel)\w*|erklär\w*|definition|formel\w*|beweis\w*|mathe\w*|physik|informatik|bwl|vwl|statistik|programmier\w*|algorithm\w*|hausarbeit|referat|thesis|zusammenfass\w*)\b/i;
/** Öffentliches Thema einer Nachricht: 'gaming' | 'study' | null. */
function publicTopic(text, { gameActive = false } = {}) {
  const t = String(text || '');
  if (GAME_WORDS.test(t)) return 'gaming';
  if (STUDY_WORDS.test(t)) return 'study';
  return gameActive ? 'gaming' : null;
}
function assertExternal() { if (isPrivate()) throw new Error('Private: externe Zugriffe sind für diese Aktion gesperrt.'); }
// Nicht-private Nachrichten (Gemini) haben keinen persönlichen Kontext und nur diese geprüften Werkzeuge.
const CLOUD_TOOLS = new Set(['tarkov_lookup', 'tarkov_raid_plan', 'tarkov_item_value', 'tarkov_needed_items', 'update_game_progress', 'voice_standby', 'set_voice', 'game_stats', 'record_raid']);
// Spieldaten nur bei Gaming-Nachrichten (eigene LoL-Matches zusätzlich nur mit Zustimmung).
const GAMING_TOOLS = new Set([...CLOUD_TOOLS, 'league_recent_matches', 'league_stats', 'league_deep_review', 'league_live', 'league_progress', 'league_coaching', 'league_champion', 'lol_matchup', 'lol_note', 'league_goal', 'lol_debrief', 'lol_counters']);
const cloudTools = (privacy) => privacy === 'gaming' ? GAMING_TOOLS : CLOUD_TOOLS;
const CLOUD_SYSTEM = 'Du bist JARVIS, ein persönlicher KI-Assistent. Du bekommst nur nicht-private Nachrichten (Wissen, Uni, Gaming, allgemeine Fragen); persönliche Daten wie Termine, Finanzen, Gesundheit oder Familie beantwortet ein lokales Modell auf dem PC – frag nicht danach und erfinde nichts darüber. Antworte auf Deutsch, klar und kompakt.';
const LOCAL_TOOLS = new Set('set_voice voice_standby league_recent_matches league_stats get_today_overview list_tasks create_task update_task complete_task delete_task list_events find_free_slots create_event schedule_events update_event delete_event list_exams create_exam plan_exam log_study search_brain remember forget search_study list_documents read_document deadlines add_deadline deadline_done add_expense finance_overview recurring_money add_income subscription shopping_list pantry recipe_ideas log_workout training_progress rest_timer birthday_gifts expense_buckets game_stats record_raid lol_counters'.split(' '));
module.exports = { LOCAL_TOOLS, local, cloud, isPrivate, isCloud, assertExternal, privateText, personalText, publicTopic, CLOUD_TOOLS, GAMING_TOOLS, cloudTools, CLOUD_SYSTEM };
