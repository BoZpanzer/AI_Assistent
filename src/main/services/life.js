'use strict';
const { id, nowIso, normText } = require('../core/util');
const log = require('../core/logger').scope('life');

/**
 * Alltag: Ausgaben & Abos, Einkaufsliste & Vorräte, Trainings-Log. Alles lokal, nur was du einträgst
 * (keine Bankanbindung). Kategorien/Ladenbereiche per festen Stichwörtern; Rezeptideen optional per KI.
 */
const CATEGORIES = ['Essen & Trinken', 'Lebensmittel', 'Transport', 'Freizeit & Gaming', 'Uni', 'Wohnen', 'Abos', 'Kleidung', 'Gesundheit', 'Sonstiges'];
const CAT_WORDS = [
  ['Essen & Trinken', /döner|pizza|burger|mensa|kaffee|café|cafe|restaurant|imbiss|bubble ?tea|essen gehen|lieferando|bier|cocktail|kneipe|bar\b|bäcker|snack|mittag|abendessen/],
  ['Lebensmittel', /einkauf|rewe|edeka|aldi|lidl|netto|penny|kaufland|supermarkt|lebensmittel|tegut|getränke ?markt/],
  ['Transport', /tram|bahn|zug|ticket|deutschlandticket|lvb|db\b|taxi|uber|bolt|tanken|benzin|bus\b|flixbus|e-?scooter|parken/],
  ['Freizeit & Gaming', /steam|spiel|game|kino|konzert|festival|riot|rp\b|v-?bucks|skin|battle ?pass|netflix|bowling|club|eintritt|fitness|gym/],
  ['Uni', /buch|skript|druck|semester|uni|hochschule|dhsn|kopie|lernmaterial|taschenrechner/],
  ['Wohnen', /miete|strom|internet|wlan|studnet|nebenkosten|möbel|ikea|haushalt|putzmittel/],
  ['Kleidung', /schuh|jacke|hose|shirt|pulli|kleidung|zalando|h&m|primark/],
  ['Gesundheit', /apotheke|arzt|medikament|zahnarzt|brille|kontaktlinse|drogerie|dm\b|rossmann/],
];
const SECTIONS = ['Obst & Gemüse', 'Backwaren', 'Kühlregal', 'Fleisch & Fisch', 'Tiefkühl', 'Trockenwaren & Konserven', 'Gewürze & Backzutaten', 'Snacks & Süßes', 'Getränke', 'Drogerie & Haushalt', 'Sonstiges'];
const SEC_WORDS = [
  ['Obst & Gemüse', /apfel|äpfel|banane|tomate|gurke|salat|zwiebel|knoblauch|kartoffel|möhre|karotte|paprika|zitrone|orange|beeren|avocado|pilz|champignon|brokkoli|zucchini|spinat|lauch|ingwer|kräuter|petersilie|obst|gemüse|trauben|birne/],
  ['Backwaren', /brot|brötchen|toast|baguette|croissant|wrap|tortilla|semmel/],
  ['Kühlregal', /milch|joghurt|quark|käse|butter|sahne|\beier?\b|frischkäse|mozzarella|feta|skyr|tofu|aufschnitt|wurst|schinken|margarine/],
  ['Fleisch & Fisch', /hähnchen|huhn|hack|rind|schwein|steak|lachs|fisch|thunfisch|garnele|pute|fleisch|bacon|speck/],
  ['Tiefkühl', /tk[- ]|tiefkühl|pizza|pommes|eis\b|frosta|gefrier/],
  ['Trockenwaren & Konserven', /nudel|pasta|spaghetti|reis|mehl|haferflocken|müsli|cornflakes|linsen|bohnen|kichererbsen|konserve|dose|passata|tomatenmark|brühe|öl\b|olivenöl|essig|honig|marmelade|nutella|erdnussbutter|zucker/],
  ['Gewürze & Backzutaten', /salz|pfeffer|gewürz|paprikapulver|curry|zimt|backpulver|hefe|vanille|oregano|chili/],
  ['Snacks & Süßes', /chips|schokolade|keks|gummibär|süßigkeit|riegel|nüsse|popcorn|cracker/],
  ['Getränke', /wasser|saft|cola|limo|bier|wein|energy|eistee|kaffee|tee\b|mate/],
  ['Drogerie & Haushalt', /zahnpasta|shampoo|duschgel|deo|klopapier|toilettenpapier|küchenrolle|spülmittel|waschmittel|müllbeutel|schwamm|seife|rasier|taschentücher/],
];
const pickBy = (words, text, fallback) => { const t = String(text || '').toLowerCase(); for (const [k, re] of words) if (re.test(t)) return k; return fallback; };
const r2 = (v) => Math.round(v * 100) / 100;
const day = (d) => new Date(d).toISOString().slice(0, 10);

function addCycle(dateStr, cycle) {
  const d = new Date(dateStr + 'T12:00:00');
  if (cycle === 'year') d.setFullYear(d.getFullYear() + 1);
  else if (cycle === 'week') d.setDate(d.getDate() + 7);
  else { const dd = d.getDate(); d.setMonth(d.getMonth() + 1); if (d.getDate() < dd) d.setDate(0); }
  return day(d);
}
const monthly = (s) => (s.cycle === 'year' ? s.amount / 12 : s.cycle === 'week' ? s.amount * 52 / 12 : s.amount);

/** „Bankdrücken 3×8 mit 70 kg“, „Kniebeugen 5x5 100kg“, „Klimmzüge 3 x 10“ → Einträge. */
function parseWorkout(text) {
  const out = [];
  for (const part of String(text || '').split(/[,;\n]|\bund\b/)) {
    const m = part.match(/^\s*(.+?)\s+(\d{1,2})\s*[x×*]\s*(\d{1,3})(?:\s*(?:mit|@|à|a)?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kilo))?/i);
    if (m) out.push({ exercise: m[1].trim(), sets: Number(m[2]), reps: Number(m[3]), weight: m[4] ? Number(m[4].replace(',', '.')) : 0 });
  }
  return out;
}
/** Geschätztes 1RM (Epley). Körpergewicht-Übungen: Wiederholungen zählen. */
const e1rm = (w, reps) => (w > 0 ? Math.round(w * (1 + reps / 30) * 10) / 10 : null);

class Life {
  constructor(s) { this.s = s; this.restTimer = null; }
  db() { return this.s.db; }
  cfg() { return this.s.settings.get('life') || {}; }
  emit() { this.s.bus.emit('life:data', {}); }

  // ---------- Ausgaben ----------
  addExpense({ amount, note = '', category, at } = {}) {
    const a = Number(String(amount).replace(',', '.'));
    if (!(a > 0 && a < 100000)) throw new Error('Betrag ungültig');
    const cat = CATEGORIES.includes(category) ? category : pickBy(CAT_WORDS, note, 'Sonstiges');
    const when = at ? new Date(at) : new Date();
    if (isNaN(when)) throw new Error('Datum ungültig');
    const eid = id('ex');
    this.db().run('INSERT INTO expenses(id,amount,category,note,at,created_at) VALUES(?,?,?,?,?,?)', eid, r2(a), cat, String(note).slice(0, 120), when.toISOString(), nowIso());
    this.emit();
    return { id: eid, amount: r2(a), category: cat, note, month: this.month() };
  }
  removeExpense(eid) { this.db().run('DELETE FROM expenses WHERE id=?', eid); this.emit(); return true; }
  /** Monatsübersicht (Standard: aktueller Monat): Summe, Budget, Kategorien, Abo-Kosten, Prognose. */
  month(ym = null, now = new Date()) {
    const [y, m] = ym ? ym.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
    const from = new Date(y, m - 1, 1); const to = new Date(y, m, 1);
    const rows = this.db().all('SELECT * FROM expenses WHERE at>=? AND at<? ORDER BY at DESC', from.toISOString(), to.toISOString());
    const total = r2(rows.reduce((a, x) => a + x.amount, 0));
    const subs = r2(this.subscriptions().filter((x) => x.active).reduce((a, x) => a + monthly(x), 0));
    const byCat = {}; for (const x of rows) byCat[x.category] = r2((byCat[x.category] || 0) + x.amount);
    const budget = Number(this.cfg().budgetMonthly || 0) || null;
    const isNow = y === now.getFullYear() && m === now.getMonth() + 1;
    const daysIn = new Date(y, m, 0).getDate(); const dayNo = isNow ? now.getDate() : daysIn;
    const forecast = isNow && dayNo >= 5 ? r2(total / dayNo * daysIn) : null;
    return { month: `${y}-${String(m).padStart(2, '0')}`, total, subscriptions: subs, totalWithSubs: r2(total + subs), budget, left: budget != null ? r2(budget - total - subs) : null, forecast,
      categories: Object.entries(byCat).map(([category, sum]) => ({ category, sum })).sort((a, b) => b.sum - a.sum), recent: rows.slice(0, 12).map((x) => ({ id: x.id, amount: x.amount, category: x.category, note: x.note, at: x.at })) };
  }

  // ---------- Abos ----------
  subscriptions() { return this.db().all('SELECT * FROM subscriptions ORDER BY next_charge').map((x) => ({ id: x.id, name: x.name, amount: x.amount, cycle: x.cycle, nextCharge: x.next_charge, cancelBy: x.cancel_by, remind: !!x.remind, active: !!x.active, monthly: r2(monthly(x)) })); }
  addSubscription({ name, amount, cycle = 'month', nextCharge, cancelBy = null, remind = false } = {}) {
    const a = Number(String(amount).replace(',', '.'));
    if (!name || !(a > 0)) throw new Error('Name und Betrag nötig');
    if (!['month', 'year', 'week'].includes(cycle)) throw new Error('Zyklus: month, year oder week');
    const next = nextCharge ? day(nextCharge) : day(new Date());
    const sid = id('ab');
    this.db().run('INSERT INTO subscriptions(id,name,amount,cycle,next_charge,cancel_by,remind,active,created_at) VALUES(?,?,?,?,?,?,?,1,?)', sid, String(name).slice(0, 60), r2(a), cycle, next, cancelBy ? day(cancelBy) : null, remind ? 1 : 0, nowIso());
    this.emit();
    return this.subscriptions().find((x) => x.id === sid);
  }
  updateSubscription(sid, patch = {}) {
    const cur = this.db().get('SELECT * FROM subscriptions WHERE id=?', sid); if (!cur) throw new Error('Abo nicht gefunden');
    const v = { name: patch.name ?? cur.name, amount: patch.amount != null ? r2(Number(patch.amount)) : cur.amount, cycle: patch.cycle ?? cur.cycle, next: patch.nextCharge ? day(patch.nextCharge) : cur.next_charge, cancelBy: patch.cancelBy === null ? null : patch.cancelBy ? day(patch.cancelBy) : cur.cancel_by, remind: patch.remind != null ? (patch.remind ? 1 : 0) : cur.remind, active: patch.active != null ? (patch.active ? 1 : 0) : cur.active };
    this.db().run('UPDATE subscriptions SET name=?,amount=?,cycle=?,next_charge=?,cancel_by=?,remind=?,active=? WHERE id=?', v.name, v.amount, v.cycle, v.next, v.cancelBy, v.remind, v.active, sid);
    this.emit(); return this.subscriptions().find((x) => x.id === sid);
  }
  removeSubscription(sid) { this.db().run('DELETE FROM subscriptions WHERE id=?', sid); this.emit(); return true; }

  /** Täglich: Abbuchungstermine weiterschieben, Erinnerungen vor Abbuchung (wenn gewünscht) und vor Kündigungsfrist. */
  dailySubs(now = new Date()) {
    const today = day(now); let n = 0;
    for (const x of this.db().all('SELECT * FROM subscriptions WHERE active=1')) {
      let next = x.next_charge; while (next < today) next = addCycle(next, x.cycle);
      if (next !== x.next_charge) this.db().run('UPDATE subscriptions SET next_charge=? WHERE id=?', next, x.id);
      const inDays = Math.round((Date.parse(next) - Date.parse(today)) / 86400000);
      if (x.remind && inDays === 2) { this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: `abo:${x.id}:${next}`, title: `Abo: ${x.name} wird in 2 Tagen abgebucht`, body: `${x.amount.toFixed(2).replace('.', ',')} € am ${next.split('-').reverse().join('.')} – noch nutzen?` }); n++; }
      if (x.cancel_by) {
        const c = Math.round((Date.parse(x.cancel_by) - Date.parse(today)) / 86400000);
        if (c === 3 || c === 0) { this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: `abokuend:${x.id}:${x.cancel_by}:${c}`, title: `Kündigungsfrist ${x.name}: ${c ? 'in 3 Tagen' : 'heute'}`, body: `Bis ${x.cancel_by.split('-').reverse().join('.')} kündigen, sonst verlängert sich das Abo.` }); n++; }
      }
    }
    if (n) this.emit();
    return n;
  }

  // ---------- Einkauf & Vorräte ----------
  shoppingList() {
    const rows = this.db().all('SELECT * FROM shopping ORDER BY done, created_at');
    const open = rows.filter((x) => !x.done);
    const groups = SECTIONS.map((sec) => ({ section: sec, items: open.filter((x) => x.section === sec).map((x) => ({ id: x.id, name: x.name, qty: x.qty })) })).filter((g) => g.items.length);
    return { groups, open: open.length, done: rows.filter((x) => x.done && Date.now() - Date.parse(x.done_at || 0) < 86400000).map((x) => ({ id: x.id, name: x.name, qty: x.qty })) };
  }
  addShopping(items) {
    const added = [];
    for (const it of items || []) {
      const name = String(typeof it === 'string' ? it : it.name || '').trim().slice(0, 60); if (!name) continue;
      const qty = String(typeof it === 'string' ? '' : it.qty || '').trim().slice(0, 30);
      const dup = this.db().get('SELECT id FROM shopping WHERE done=0 AND lower(name)=lower(?)', name);
      if (dup) { if (qty) this.db().run('UPDATE shopping SET qty=? WHERE id=?', qty, dup.id); continue; }
      const sid = id('sh'); this.db().run('INSERT INTO shopping(id,name,qty,section,done,created_at) VALUES(?,?,?,?,0,?)', sid, name, qty, pickBy(SEC_WORDS, name, 'Sonstiges'), nowIso());
      added.push(name);
    }
    this.emit(); return { added, list: this.shoppingList() };
  }
  /** Abhaken → optional direkt in die Vorräte. */
  checkShopping(sid, done = true) {
    const x = this.db().get('SELECT * FROM shopping WHERE id=?', sid); if (!x) throw new Error('Nicht gefunden');
    this.db().run('UPDATE shopping SET done=?, done_at=? WHERE id=?', done ? 1 : 0, done ? nowIso() : null, sid);
    if (done && this.cfg().boughtToPantry !== false) this.addPantry([{ name: x.name, qty: x.qty }]);
    this.emit(); return true;
  }
  clearShopping() { this.db().run('DELETE FROM shopping WHERE done=1'); this.emit(); return true; }
  removeShopping(sid) { this.db().run('DELETE FROM shopping WHERE id=?', sid); this.emit(); return true; }
  pantry() { return this.db().all('SELECT * FROM pantry ORDER BY (expires IS NULL), expires, name').map((x) => ({ id: x.id, name: x.name, qty: x.qty, expires: x.expires, section: pickBy(SEC_WORDS, x.name, 'Sonstiges') })); }
  addPantry(items) {
    for (const it of items || []) {
      const name = String(typeof it === 'string' ? it : it.name || '').trim().slice(0, 60); if (!name) continue;
      const exp = it.expires ? day(it.expires) : null; const qty = String(it.qty || '').slice(0, 30);
      const dup = this.db().get('SELECT id FROM pantry WHERE lower(name)=lower(?)', name);
      if (dup) this.db().run('UPDATE pantry SET qty=COALESCE(NULLIF(?,\'\'),qty), expires=COALESCE(?,expires) WHERE id=?', qty, exp, dup.id);
      else this.db().run('INSERT INTO pantry(id,name,qty,expires,created_at) VALUES(?,?,?,?,?)', id('pa'), name, qty, exp, nowIso());
    }
    this.emit(); return this.pantry();
  }
  /** „Milch ist leer“ → aus den Vorräten, optional gleich auf die Einkaufsliste. */
  usePantry(names, { toShopping = false } = {}) {
    const removed = [];
    for (const n of names || []) { const r = this.db().get('SELECT id,name FROM pantry WHERE lower(name)=lower(?) OR lower(name) LIKE lower(?)', n, `%${n}%`); if (r) { this.db().run('DELETE FROM pantry WHERE id=?', r.id); removed.push(r.name); } }
    if (toShopping) this.addShopping(names);
    this.emit(); return { removed };
  }
  /** Rezeptideen aus den Vorräten (KI, gespeichert pro Vorratsstand). */
  async recipes() {
    const items = this.pantry();
    if (items.length < 3) throw new Error('Zu wenig Vorräte eingetragen (mindestens 3).');
    const key = 'life:recipes:' + normText(items.map((x) => x.name).sort().join('|')).slice(0, 300);
    const cached = this.s.system.meta(key); if (cached) return JSON.parse(cached);
    const soon = items.filter((x) => x.expires && Date.parse(x.expires) - Date.now() < 3 * 86400000).map((x) => x.name);
    const r = await this.s.gemini.generate({ feature: 'life', model: this.s.gemini.requireModel('fast'), temperature: 0.6, json: true,
      schema: { type: 'object', required: ['recipes'], properties: { recipes: { type: 'array', items: { type: 'object', required: ['name', 'uses', 'steps', 'minutes'], properties: { name: { type: 'string' }, uses: { type: 'array', items: { type: 'string' } }, missing: { type: 'array', items: { type: 'string' } }, minutes: { type: 'integer' }, steps: { type: 'array', items: { type: 'string' } } } } } } },
      system: 'Du schlägst 3 einfache Studenten-Rezepte vor (Deutsch), die möglichst nur die vorhandenen Vorräte nutzen. Grundzutaten wie Salz, Pfeffer, Öl, Wasser darf man voraussetzen. Fehlt etwas Wichtiges, unter missing nennen. Max. 6 kurze Schritte, realistische Zeit in Minuten.',
      contents: [{ role: 'user', parts: [{ text: `Vorräte: ${items.map((x) => x.name + (x.qty ? ` (${x.qty})` : '')).join(', ')}${soon.length ? `\nBald ablaufend, bitte bevorzugt verwenden: ${soon.join(', ')}` : ''}` }] }] });
    const out = { at: nowIso(), recipes: (r?.recipes || []).slice(0, 3) };
    this.s.system.setMeta(key, JSON.stringify(out));
    return out;
  }
  dailyPantry(now = new Date()) {
    const soon = this.db().all('SELECT * FROM pantry WHERE expires IS NOT NULL AND expires<=?', day(new Date(now.getTime() + 2 * 86400000)));
    if (!soon.length) return 0;
    this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: 'pantry:' + day(now), title: `${soon.length} Vorrat${soon.length > 1 ? 'e laufen' : ' läuft'} bald ab`, body: soon.map((x) => `${x.name} (${x.expires.split('-').reverse().slice(0, 2).join('.')}.)`).join(', ') + ' – Rezeptideen im Alltag-Bereich.' });
    return soon.length;
  }

  // ---------- Training ----------
  logWorkout(entries, { at } = {}) {
    const when = at ? new Date(at).toISOString() : nowIso(); const out = []; const prs = [];
    for (const e of entries || []) {
      const ex = String(e.exercise || '').trim().slice(0, 50); const sets = Math.round(Number(e.sets)); const reps = Math.round(Number(e.reps)); const w = Number(String(e.weight ?? 0).replace(',', '.')) || 0;
      if (!ex || !(sets >= 1 && sets <= 20) || !(reps >= 1 && reps <= 100) || w < 0 || w > 500) throw new Error(`Eintrag ungültig: ${ex || '?'}`);
      const key = normText(ex);
      const prev = this.best(key);
      this.db().run('INSERT INTO workouts(id,at,exercise,ex_key,sets,reps,weight,note) VALUES(?,?,?,?,?,?,?,?)', id('wo'), when, ex, key, sets, reps, w, String(e.note || '').slice(0, 100));
      const now1 = e1rm(w, reps);
      const isPr = prev && (now1 != null ? now1 > (prev.e1rm || 0) : reps > prev.reps && !prev.weight);
      if (isPr) prs.push({ exercise: ex, e1rm: now1, reps, weight: w, before: prev.e1rm ?? prev.reps });
      out.push({ exercise: ex, sets, reps, weight: w, e1rm: now1 });
    }
    for (const p of prs) this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: `pr:${normText(p.exercise)}:${p.e1rm ?? p.reps}`, title: `Neuer Rekord: ${p.exercise}`, body: p.e1rm != null ? `${p.weight} kg × ${p.reps} → geschätztes 1RM ${p.e1rm} kg (vorher ${p.before} kg)` : `${p.reps} Wiederholungen (vorher ${p.before})` });
    this.emit();
    return { logged: out, records: prs };
  }
  best(key) {
    const rows = this.db().all('SELECT weight, reps FROM workouts WHERE ex_key=?', key);
    if (!rows.length) return null;
    let b = null; for (const r of rows) { const v = e1rm(r.weight, r.reps); if (!b || (v ?? -1) > (b.e1rm ?? -1) || (v == null && r.reps > b.reps)) b = { e1rm: v, reps: r.reps, weight: r.weight }; }
    return b;
  }
  /** Fortschritt pro Übung: je Trainingstag bestes geschätztes 1RM (oder Wiederholungen ohne Gewicht). */
  progress({ days = 120 } = {}) {
    const rows = this.db().all('SELECT * FROM workouts WHERE at>=? ORDER BY at', new Date(Date.now() - days * 86400000).toISOString());
    const by = {};
    for (const r of rows) {
      const x = by[r.ex_key] = by[r.ex_key] || { exercise: r.exercise, points: {}, sessions: 0, volume: 0 };
      const d = r.at.slice(0, 10); const v = e1rm(r.weight, r.reps) ?? r.reps;
      if (!(d in x.points)) x.sessions++;
      x.points[d] = Math.max(x.points[d] || 0, v); x.volume += r.sets * r.reps * r.weight; x.bodyweight = !r.weight;
    }
    return Object.values(by).map((x) => { const pts = Object.entries(x.points).map(([date, v]) => ({ date, v })); return { exercise: x.exercise, sessions: x.sessions, points: pts, first: pts[0]?.v, last: pts[pts.length - 1]?.v, change: pts.length > 1 ? Math.round((pts[pts.length - 1].v - pts[0].v) * 10) / 10 : null, unit: x.bodyweight ? 'Wdh.' : 'kg (1RM geschätzt)', volume: Math.round(x.volume) }; }).sort((a, b) => b.sessions - a.sessions);
  }
  recentWorkouts(limit = 30) { return this.db().all('SELECT * FROM workouts ORDER BY at DESC LIMIT ?', limit).map((r) => ({ id: r.id, at: r.at, exercise: r.exercise, sets: r.sets, reps: r.reps, weight: r.weight })); }
  removeWorkout(wid) { this.db().run('DELETE FROM workouts WHERE id=?', wid); this.emit(); return true; }

  /** Pausen-Timer: nach X Sekunden Meldung + Ansage. */
  rest(seconds = 90) {
    const sec = Math.max(10, Math.min(900, Math.round(Number(seconds) || 90)));
    clearTimeout(this.restTimer);
    const endsAt = new Date(Date.now() + sec * 1000).toISOString();
    this.restTimer = setTimeout(() => { this.restTimer = null; this.s.bus.emit('life:rest', { done: true }); this.s.bus.emit('tts:speak', { text: 'Pause vorbei – nächster Satz.' }); this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: 'rest:' + endsAt, title: 'Pause vorbei', body: 'Nächster Satz.' }); }, sec * 1000);
    this.restTimer.unref?.();
    this.s.bus.emit('life:rest', { endsAt, seconds: sec });
    return { endsAt, seconds: sec };
  }
  stop() { clearTimeout(this.restTimer); }
}

module.exports = { Life, CATEGORIES, SECTIONS, parseWorkout, e1rm, addCycle, pickBy, CAT_WORDS, SEC_WORDS };
