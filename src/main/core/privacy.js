'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
const privateText = (text) => /(?:#private|\[private\]|\b(?:privat|private|familie|familien|mutter|vater|eltern|partner|geburtstag|termin|kalender|einnahmen?|ausgaben?|gehalt|einkommen|konto|iban|schulden|miete|gesundheit|arzt)\b)/i.test(String(text));
const isPrivate = () => scope.getStore() === 'private';
const local = (fn) => scope.run('private', fn);
function assertExternal() { if (isPrivate()) throw new Error('Private: externe Zugriffe sind für diese Aktion gesperrt.'); }
// Explicit cloud chats have no personal context and only this reviewed tool subset.
const CLOUD_TOOLS = new Set(['tarkov_lookup', 'tarkov_raid_plan', 'tarkov_item_value', 'tarkov_needed_items', 'update_game_progress', 'voice_standby', 'game_stats', 'record_raid']);
// Game data is available only in an explicitly selected Gaming conversation.
const GAMING_TOOLS = new Set([...CLOUD_TOOLS, 'league_recent_matches', 'league_stats', 'league_deep_review', 'league_live', 'league_progress', 'league_coaching', 'league_champion', 'lol_matchup', 'lol_note', 'league_goal', 'lol_debrief', 'lol_counters']);
const cloudTools = (privacy) => privacy === 'gaming' ? GAMING_TOOLS : CLOUD_TOOLS;
const CLOUD_SYSTEM = 'Du bist JARVIS. Dieses Gespräch ist ausschließlich für freigegebene Uni-/Gaming-Inhalte. Für persönliche Themen einen neuen privaten Chat verlangen. Kein Zugriff auf private Daten.';
const LOCAL_TOOLS = new Set('league_recent_matches league_stats get_today_overview list_tasks create_task update_task complete_task delete_task list_events find_free_slots create_event schedule_events update_event delete_event list_exams create_exam plan_exam log_study search_brain remember forget search_study list_documents read_document deadlines add_deadline deadline_done add_expense finance_overview recurring_money add_income subscription shopping_list pantry recipe_ideas log_workout training_progress rest_timer birthday_gifts expense_buckets game_stats record_raid lol_counters'.split(' '));
module.exports = { LOCAL_TOOLS, local, isPrivate, assertExternal, privateText, CLOUD_TOOLS, GAMING_TOOLS, cloudTools, CLOUD_SYSTEM };
