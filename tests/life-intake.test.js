'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Database } = require('../src/main/core/db');
const { Conversations } = require('../src/main/services/conversations');
const { LifeIntake, TOPICS } = require('../src/main/services/life-intake');

function setup(file = ':memory:') {
  const s = { db: new Database(file), bus: new EventEmitter() };
  s.conversations = new Conversations(s); s.intake = new LifeIntake(s);
  const answer = (cid, text) => {
    const m = s.conversations.add(cid, { role: 'user', content: text, meta: { scope: 'private' } });
    return s.intake.handle({ cid, messageId: m.id, text });
  };
  return { s, answer };
}

test('guided intake works offline, never assumes student circumstances and only confirms after review', () => {
  const { s, answer } = setup();
  try {
    assert.equal(s.intake.snapshot().addressed, 0);
    const { conversationId: cid } = s.intake.open();
    assert.equal(s.conversations.get(cid).privacy, 'private');
    assert.equal(s.intake.snapshot().topics[0].answer, '');
    const statements = ['Ich wohne bei meinen Eltern.', 'Ich studiere dual Informatik.', 'Ungefähr 1100 netto monatlich.', 'Weiß ich nicht', 'später', 'trifft nicht zu', 'Erst einmal Verträge sortieren.'];
    statements.forEach(t => answer(cid, t));
    assert.equal(s.intake.session().status, 'review');
    assert.equal(s.intake.snapshot().addressed, 0, 'drafts are not confirmed');
    const topics = s.intake.snapshot().topics;
    assert.equal(topics[2].answer, statements[2], 'estimate retained verbatim');
    assert.equal(topics[3].status, 'unknown');
    assert.equal(topics[4].status, 'skipped');
    assert.equal(topics[5].status, 'not_applicable');
    answer(cid, 'ich bin mir noch unsicher');
    assert.equal(s.intake.session().status, 'review');
    answer(cid, 'übernehmen');
    assert.equal(s.intake.snapshot().addressed, TOPICS.length);
    assert.equal(s.intake.snapshot().open, 2);
    for (const table of ['incomes', 'expenses', 'recurring', 'subscriptions', 'events', 'knowledge']) {
      assert.equal(s.db.get(`SELECT COUNT(*) n FROM ${table}`).n, 0, 'notes never silently book: ' + table);
    }
  } finally { s.db.close(); }
});

test('pause, restart and resume preserve the exact question and draft', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-intake-')); const file = path.join(dir, 'test.sqlite3');
  let { s, answer } = setup(file);
  try {
    const { conversationId: cid } = s.intake.open();
    answer(cid, 'Ich wohne in einer WG.'); answer(cid, 'Pause');
    assert.equal(s.intake.active(cid), false);
    assert.equal(answer(cid, 'Erklär mir Quicksort'), null);
    s.db.close(); ({ s, answer } = setup(file));
    const resumed = s.intake.open();
    assert.equal(resumed.conversationId, cid);
    assert.equal(s.intake.session().cursor, 1);
    assert.match(s.intake.question(), /Studium/);
    assert.equal(s.intake.snapshot().topics[0].answer, 'Ich wohne in einer WG.');
  } finally { s.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('source attribution, deletion and duplicate delivery do not invent or resurrect answers', () => {
  const { s, answer } = setup();
  try {
    const { conversationId: cid } = s.intake.open();
    answer(cid, 'unverändert');
    assert.equal(s.intake.session().cursor, 0);
    const m = s.conversations.add(cid, { role: 'user', content: 'Ich wohne allein.' });
    s.intake.handle({ cid, messageId: m.id, text: m.content });
    s.intake.handle({ cid, messageId: m.id, text: m.content });
    assert.equal(s.intake.session().cursor, 1);
    assert.equal(s.intake.snapshot().topics[0].sourceMessageId, m.id);
    answer(cid, 'zurück'); answer(cid, 'Korrektur: Ich wohne in einer WG.');
    assert.equal(s.intake.snapshot().topics[0].answer, 'Korrektur: Ich wohne in einer WG.');
    assert.equal(s.db.get('SELECT COUNT(*) n FROM life_intake_answers').n, 1);
    s.conversations.remove(cid);
    assert.equal(s.intake.snapshot().topics[0].status, 'missing');
    assert.equal(s.intake.snapshot().addressed, 0);
    assert.ok(s.intake.open().conversationId !== cid);
  } finally { s.db.close(); }
});

test('check-ins preserve original wording and only renew dates after review', () => {
  const { s, answer } = setup();
  try {
    const { conversationId: cid } = s.intake.open();
    TOPICS.forEach((t, i) => answer(cid, `Meine Angabe zum Bereich ${i + 1}.`)); answer(cid, 'übernehmen');
    s.db.run("UPDATE life_intake_answers SET reviewed_at='2020-01-01T00:00:00.000Z'");
    assert.equal(s.intake.snapshot().due, TOPICS.length);
    s.intake.open();
    TOPICS.forEach(() => answer(cid, 'unverändert'));
    assert.equal(s.intake.snapshot().topics[0].draft, true);
    assert.match(s.intake.review(), /Meine Angabe zum Bereich 1/);
    answer(cid, 'übernehmen');
    const t = s.intake.snapshot().topics[0];
    assert.equal(t.answer, 'Meine Angabe zum Bereich 1.');
    assert.equal(t.draft, false); assert.equal(t.stale, false);
    s.db.run('DELETE FROM messages WHERE id=?', t.sourceMessageId);
    assert.equal(s.intake.snapshot().topics[0].status, 'missing');
  } finally { s.db.close(); }
});

test('snoozing the startup offer does not claim that an area is complete', () => {
  const { s } = setup();
  try {
    s.intake.snooze();
    assert.equal(s.intake.snapshot().offer, false);
    assert.equal(s.intake.snapshot().addressed, 0);
    s.db.run("UPDATE life_intake_session SET snoozed_until='2020-01-01T00:00:00.000Z'");
    assert.equal(s.intake.snapshot().offer, true);
    assert.match(s.intake.begin(s.conversations.create().id), /1\/7/);
  } finally { s.db.close(); }
});

test('real orchestrator handles private short answers and voice input without model or cloud TTS calls', async () => {
  const { s } = setup();
  try {
    const { Orchestrator } = require('../src/main/agent/orchestrator');
    const agent = Object.create(Orchestrator.prototype); agent.s = s;
    s.settings = { get: k => k === 'localLLM' ? { enabled: false } : k === 'voice' ? { speakVoiceReplies: true } : undefined };
    s.gemini = { hasKey: () => { throw new Error('Intake must not call provider'); } };
    const speech = []; s.bus.on('tts:speak', x => speech.push(x));
    const cid = s.conversations.create().id;
    let reply = await agent.chat({ conversationId: cid, text: 'Starte mein Startbriefing' });
    assert.equal(reply.meta.deterministic, 'life-intake');
    reply = await agent.chat({ conversationId: cid, text: 'Bei meinen Eltern.', channel: 'voice' });
    assert.equal(reply.meta.scope, 'private');
    assert.equal(speech.length, 0, 'sensitive replies never go through configured cloud speech');
    assert.equal(agent.classify(cid, '1200'), 'private');
    const before = s.intake.session().cursor;
    await agent.chat({ conversationId: cid, text: 'Hier die Datei', attachments: [{ name: 'Vertrag.pdf', docId: 'doc' }] });
    assert.equal(s.intake.session().cursor, before, 'unsupported attachments do not advance intake');
  } finally { s.db.close(); }
});

test('migration from released v12 preserves finances and existing messages', () => {
  const { DatabaseSync } = require('node:sqlite');
  const migrations = require('../src/main/core/migrations');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-intake-migration-')); const file = path.join(dir, 'test.sqlite3');
  let db;
  try {
    const old = new DatabaseSync(file);
    migrations.slice(0, 12).forEach(m => m(old)); old.exec('PRAGMA user_version=12');
    old.prepare('INSERT INTO incomes(id,amount,note,at,created_at) VALUES(?,?,?,?,?)').run('old-income', 10, 'fixture', '2026-01-01', '2026-01-01'); old.close();
    db = new Database(file);
    assert.equal(db.version, 13); assert.equal(db.get('SELECT amount FROM incomes WHERE id=?', 'old-income').amount, 10);
    assert.equal(db.get('SELECT COUNT(*) n FROM life_intake_answers').n, 0);
  } finally { db?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
