'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

/**
 * Factorio – Verhältnis-Rechner aus den Spieldaten deiner Installation. Factorio erzeugt die Daten selbst
 * („factorio.exe --dump-data“ → script-output/data-raw-dump.json, nur auf Klick). Rezepte und
 * Maschinengeschwindigkeiten kommen daraus – nichts ist eingebaut.
 */
const DUMP = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Factorio', 'script-output', 'data-raw-dump.json');

/** Rezept aus 1.1- oder 2.0-Format vereinheitlichen. */
function normRecipe(r) {
  const v = r.normal || r; // 1.1: normal/expensive
  const list = (x) => (x || []).map((i) => (Array.isArray(i) ? { name: i[0], amount: i[1] } : { name: i.name, amount: i.amount ?? ((i.amount_min + i.amount_max) / 2 || 1) * (i.probability ?? 1) }));
  const results = v.results ? list(v.results) : v.result ? [{ name: v.result, amount: v.result_count || 1 }] : [];
  return { name: r.name, time: v.energy_required ?? 0.5, ingredients: list(v.ingredients), results, category: r.category || 'crafting' };
}

function loadDump(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  const recipes = Object.values(raw.recipe || {}).map(normRecipe).filter((r) => r.results.length);
  const machines = {};
  for (const type of ['assembling-machine', 'furnace']) for (const m of Object.values(raw[type] || {})) machines[m.name] = { name: m.name, speed: Number(m.crafting_speed) || 1, categories: m.crafting_categories || [] };
  return { recipes, machines };
}

/**
 * Bedarf für `rate` Stück/s von `item`: rekursiv über Rezepte, Maschinen je Kategorie (gewählt oder schnellste
 * passende). Rohstoffe (kein Rezept oder ausgeschlossen) werden summiert.
 */
function plan(data, item, rate, { machineFor = {}, raw = ['iron-ore', 'copper-ore', 'stone', 'coal', 'crude-oil', 'water', 'uranium-ore', 'wood'] } = {}) {
  const by = new Map(); for (const r of data.recipes) for (const o of r.results) if (!by.has(o.name) || r.name === o.name) by.set(o.name, r);
  const steps = new Map(); const rawNeed = {};
  const pickMachine = (cat) => {
    if (machineFor[cat] && data.machines[machineFor[cat]]) return data.machines[machineFor[cat]];
    const c = Object.values(data.machines).filter((m) => m.categories.includes(cat));
    return c.sort((a, b) => a.speed - b.speed)[Math.min(1, c.length - 1)] || null; // Standard: zweitlangsamste (z. B. Montagemaschine 2)
  };
  const visit = (name, perSec, depth) => {
    const r = by.get(name);
    if (!r || raw.includes(name) || depth > 30) { rawNeed[name] = (rawNeed[name] || 0) + perSec; return; }
    const out = r.results.find((o) => o.name === name).amount;
    const crafts = perSec / out; const m = pickMachine(r.category);
    const s = steps.get(r.name) || { recipe: r.name, item: name, perSec: 0, machine: m?.name || null, speed: m?.speed || null, machines: 0, time: r.time };
    s.perSec += perSec; s.machines = m ? (s.perSec / out) * r.time / m.speed : null;
    steps.set(r.name, s);
    for (const ing of r.ingredients) visit(ing.name, crafts * ing.amount, depth + 1);
  };
  visit(item, rate, 0);
  return { item, rate, steps: [...steps.values()].map((s) => ({ ...s, perSec: Math.round(s.perSec * 1000) / 1000, machines: s.machines != null ? Math.round(s.machines * 100) / 100 : null, machinesRounded: s.machines != null ? Math.ceil(s.machines - 1e-9) : null })), raw: Object.fromEntries(Object.entries(rawNeed).map(([k, v]) => [k, Math.round(v * 1000) / 1000])) };
}

class Factorio {
  constructor(s) { this.s = s; this.data = null; }
  async exe() {
    const inst = await this.s.gaming.steam?.installed?.().catch(() => null);
    const a = inst?.get(427520);
    const f = a?.installdir ? path.join(a.installdir, 'bin', 'x64', 'factorio.exe') : null;
    return f && fs.existsSync(f) ? f : null;
  }
  status() { const f = DUMP(); let at = null; try { at = new Date(fs.statSync(f).mtimeMs).toISOString(); } catch { /* fehlt */ } return { dump: at ? f : null, dumpAt: at }; }
  /** Spieldaten erzeugen lassen (nur auf ausdrücklichen Klick; Factorio darf dabei nicht laufen). */
  async dump() {
    const exe = await this.exe();
    if (!exe) throw new Error('Factorio wurde in deiner Steam-Bibliothek nicht gefunden.');
    if ((this.s.gaming.context.running || []).includes('factorio')) throw new Error('Bitte Factorio vorher schließen.');
    await new Promise((resolve, reject) => execFile(exe, ['--dump-data'], { windowsHide: true, timeout: 180000 }, (e) => (e && !fs.existsSync(DUMP()) ? reject(new Error('Factorio konnte die Daten nicht ausgeben: ' + e.message)) : resolve())));
    this.data = null;
    return this.status();
  }
  load() {
    if (this.data) return this.data;
    const f = DUMP(); if (!fs.existsSync(f)) throw new Error('Noch keine Spieldaten – einmal „Spieldaten einlesen“ klicken.');
    this.data = loadDump(fs.readFileSync(f, 'utf8'));
    return this.data;
  }
  items() { return [...new Set(this.load().recipes.flatMap((r) => r.results.map((o) => o.name)))].sort(); }
  calc(item, rate, opts) { return plan(this.load(), item, Number(rate) || 1, opts); }
}

module.exports = { Factorio, loadDump, plan, normRecipe };
