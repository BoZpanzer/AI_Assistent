'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const resp = (text) => ({ text, parts: [{ text }], functionCalls: [] });

test('Brain learns by itself: public turns via Gemini (lite), private turns only via the local model, sensitive and trivial things are skipped', async () => {
  const { core: s, fake, cleanup } = tempCore({ learn: true, script: [
    { text: 'Malphite Support: Steinschild früh maxen.' },
    { text: JSON.stringify({ entries: [{ title: 'LoL-Main', content: 'Der Nutzer spielt in LoL meistens Malphite Support.', domain: 'gaming', kind: 'preference', subjectKey: 'lol-main-champion', game: 'League of Legends' }] }) },
  ] });
  try {
    s.secrets.set('gemini.api_key', 'test'); s.settings.update({ models: { fast: 'gemini-3.8-flash', lite: 'gemini-2.5-flash-lite' } });
    const c = s.conversations.create();
    const m = await s.orchestrator.chat({ conversationId: c.id, text: 'Ich spiele meistens Malphite Support, wie skille ich ihn?' });
    await wait();
    const learned = s.conversations.messages(c.id).find((x) => x.id === m.id).meta.learned;
    assert.equal(learned?.length, 1); assert.equal(learned[0].title, 'LoL-Main');
    const e = s.brain.get(learned[0].id);
    assert.equal(e.domain, 'gaming'); assert.ok(e.tags.includes('gemini'));
    assert.equal(fake.requests.length, 2, 'Antwort + ein Lernschritt');

    // Private Nachricht: Lernschritt nur lokal, nie Gemini
    s.settings.update({ localLLM: { model: 'qwen3.5:4b' } });
    const local = [];
    s.localLLM.stepStream = async (o) => { local.push(o); if (o.json) return resp(JSON.stringify({ entries: [{ title: 'Schwester', content: 'Die Schwester des Nutzers heißt Lena.', domain: 'personal', kind: 'fact', subjectKey: 'schwester-name' }] })); o.onText?.('Notiert.'); return resp('Notiert.'); };
    const before = fake.requests.length;
    const p = await s.orchestrator.chat({ conversationId: c.id, text: 'Meine Schwester Lena hat nächste Woche Geburtstag, sie mag Bücher' });
    await wait();
    assert.equal(fake.requests.length, before, 'kein Gemini-Aufruf für private Inhalte');
    assert.equal(local.length, 2, 'Antwort + Lernschritt lokal');
    assert.equal(s.conversations.messages(c.id).find((x) => x.id === p.id).meta.learned?.[0].title, 'Schwester');

    // Sensibles wird abgelehnt, Kleinkram gar nicht erst geprüft
    s.localLLM.stepStream = async (o) => { local.push(o); if (o.json) return resp(JSON.stringify({ entries: [{ title: 'Diagnose', content: 'Der Nutzer hat eine Depression diagnostiziert bekommen.', domain: 'personal', kind: 'fact' }] })); return resp('ok'); };
    const q = await s.orchestrator.chat({ conversationId: c.id, text: 'Mein Arzt sagt, ich habe eine Depression' });
    await wait();
    assert.equal(s.conversations.messages(c.id).find((x) => x.id === q.id).meta.learned, undefined);
    assert.equal(s.learner.worth({ userText: 'danke', scope: 'general' }), false);
    s.settings.update({ brainAutoLearn: false });
    assert.equal(s.learner.worth({ userText: 'Ich spiele jetzt auch Tarkov', scope: 'gaming' }), false);
  } finally { cleanup(); }
});
