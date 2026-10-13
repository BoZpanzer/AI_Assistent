'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tempCore } = require('./helpers');

test('Spielstand: anlegen, aktualisieren mit Verlauf, keine Duplikate, Wipe archiviert', () => {
  const { core, cleanup } = tempCore();
  const p = core.gaming.progress;
  const a = p.upsert('rok', { category: 'commander', name: 'Sun Tzu', value: 'Level 40' });
  assert.equal(a.action, 'created');
  assert.equal(p.upsert('rok', { category: 'commander', name: 'sun tzu', value: 'Level 40' }).action, 'unchanged');
  const b = p.upsert('rok', { category: 'commander', name: 'Sun Tzu', value: 'Level 50, Talente 5-5-5-5' });
  assert.equal(b.action, 'updated');
  assert.equal(b.previous.value, 'Level 40');
  assert.equal(p.list('rok').length, 1);
  assert.equal(p.history(a.item.id)[0].value, 'Level 40');
  p.revert(b.item.id, b.previous);
  assert.equal(p.get(a.item.id).value, 'Level 40', 'Rückgängig stellt alten Stand her');
  p.upsert('eft', { category: 'quest', name: 'Debut', status: 'done' });
  assert.equal(p.wipe('eft').archived, 1);
  assert.equal(p.list('eft').length, 0);
  assert.equal(p.list('rok').length, 1, 'Wipe betrifft nur ein Spiel');
  assert.throws(() => p.upsert('rok', { category: 'unsinn', name: 'x' }));
  cleanup();
});

test('Spielstand im Kontext: aktives, besprochenes und im Text erwähntes Spiel – sonst nicht', () => {
  const { core, cleanup } = tempCore();
  const p = core.gaming.progress;
  p.upsert('eft', { category: 'quest', name: 'Debut', status: 'done' });
  p.upsert('eft', { category: 'character', name: 'PMC-Level', value: '34' });
  p.upsert('rok', { category: 'commander', name: 'Sun Tzu', value: 'Level 40' });
  assert.equal(core.gaming.progressContext('Wie wird das Wetter?'), '', 'keine Spieldaten bei allgemeinen Fragen');
  const ctx = core.gaming.progressContext('Welche Talente für meinen Sun Tzu in Rise of Kingdoms?');
  assert.match(ctx, /Sun Tzu – Level 40/);
  assert.doesNotMatch(ctx, /Debut/);
  core.gaming.context.setActive('eft', 'explicit');
  const both = core.gaming.progressContext('und in rok?');
  assert.match(both, /Quests erledigt \(1\): Debut/);
  assert.match(both, /PMC-Level – 34/);
  assert.match(both, /Sun Tzu/);
  // Prompt enthält den Block
  const sys = core.orchestrator.system('text', 'was soll ich als nächstes machen');
  assert.match(sys, /Bekannter Spielstand Escape from Tarkov/);
  cleanup();
});

test('Kontext bleibt klein: 300 erledigte Quests werden zusammengefasst', () => {
  const { core, cleanup } = tempCore();
  core.db.tx(() => { for (let i = 0; i < 300; i++) core.gaming.progress.upsert('eft', { category: 'quest', name: 'Quest ' + i, status: 'done' }); });
  core.gaming.context.setActive('eft', 'manual');
  const ctx = core.gaming.progressContext('');
  assert.ok(ctx.length <= 1800, 'Länge ' + ctx.length);
  assert.match(ctx, /\+275 weitere/);
  cleanup();
});

test('Orchestrator: „Ich habe Operation Aquarius abgeschlossen“ → gespeichert, Karte mit Rückgängig', async () => {
  const script = [
    { calls: [{ name: 'update_game_progress', args: { game: 'Tarkov', items: [{ category: 'quest', name: 'operation aquarius', status: 'done' }, { category: 'character', name: 'PMC-Level', value: '21' }] } }] },
    { text: 'Glückwunsch, Chef!' },
  ];
  const fetch = async () => new Response(JSON.stringify({ data: { tasks: [{ id: 't1', name: 'Operation Aquarius - Part 1', trader: { name: 'Therapist' }, objectives: [] }] } }), { headers: { 'content-type': 'application/json' } });
  const { core, fake, cleanup } = tempCore({ script, fetch });
  core.secrets.set('gemini.api_key', 'AIza-test-key-123456789');
  await core.gemini.discover();
  const cards = [];
  core.bus.on('chat:card', (c) => cards.push(c.card));
  await core.orchestrator.chat({ text: 'Ich hab grad Operation Aquarius in Tarkov abgeschlossen und bin Level 21' });
  const items = core.gaming.progress.list('eft');
  assert.equal(items.length, 2);
  assert.equal(items.find((x) => x.category === 'quest').name, 'Operation Aquarius - Part 1', 'offizieller Questname von tarkov.dev');
  const card = cards.find((c) => c.title.startsWith('Spielstand'));
  assert.ok(card && card.undo);
  const resp = fake.requests[1].contents.flatMap((c) => c.parts).find((p) => p.functionResponse?.name === 'update_game_progress').functionResponse.response;
  assert.equal(resp._undo, undefined, 'interne Undo-Daten gehen nicht an das Modell');
  await core.orchestrator.runInternal(card.undo.tool, card.undo.args);
  assert.equal(core.gaming.progress.list('eft').length, 0);
  // Wipe braucht Bestätigung
  core.gaming.progress.upsert('eft', { category: 'quest', name: 'Debut', status: 'done' });
  const w = await core.orchestrator.execute('reset_game_progress', { game: 'Tarkov' });
  assert.equal(w.card.kind, 'confirm');
  assert.equal(core.gaming.progress.list('eft').length, 1);
  cleanup();
});

test('Migration einer bestehenden 3.0.0-Datenbank (Schema v1 → v2) – Daten bleiben, Sicherung wird angelegt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mig-'));
  const { Database } = require('../src/main/core/db');
  const MIG = require('../src/main/core/migrations');
  // v1-Datenbank simulieren
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(path.join(dir, 'jarvis.sqlite3'));
  MIG[0](raw); raw.exec('PRAGMA user_version=1');
  raw.exec("INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES('t1','Alte Aufgabe','open','2026-10-12','2026-10-12')");
  raw.close();
  const db = new Database(path.join(dir, 'jarvis.sqlite3'), { backupDir: path.join(dir, 'backups') });
  assert.equal(db.version, 2);
  assert.equal(db.get('SELECT title FROM tasks').title, 'Alte Aufgabe');
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.includes('vor-migration-v1-zu-v2')));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
