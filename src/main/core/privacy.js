'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const scope = new AsyncLocalStorage();
const privateText = (text) => /(?:#private|\[private\]|\b(?:privat|private|familie|familien|mutter|vater|eltern|partner|geburtstag|termin|kalender|einnahmen?|ausgaben?|gehalt|einkommen|konto|iban|schulden|miete|gesundheit|arzt)\b)/i.test(String(text));
const isPrivate = () => scope.getStore() === 'private';
const local = (fn) => scope.run('private', fn);
function assertExternal() { if (isPrivate()) throw new Error('Private: externe Zugriffe sind für diese Aktion gesperrt.'); }
// Explicit cloud chats have no personal context and only this reviewed tool subset.
const CLOUD_TOOLS = new Set(['tarkov_lookup', 'tarkov_raid_plan', 'tarkov_item_value', 'tarkov_needed_items']);
const LOCAL_TOOLS = new Set('get_today_overview list_tasks create_task update_task complete_task delete_task list_events find_free_slots create_event schedule_events update_event delete_event list_exams create_exam plan_exam log_study search_brain remember forget search_study list_documents read_document deadlines add_deadline deadline_done add_expense finance_overview recurring_money add_income subscription shopping_list pantry recipe_ideas log_workout training_progress rest_timer birthday_gifts expense_buckets'.split(' '));
module.exports = { LOCAL_TOOLS, local, isPrivate, assertExternal, privateText, CLOUD_TOOLS };
