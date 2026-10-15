'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCore } = require('../src/main/app-core');

/**
 * Scripted fake of the @google/genai SDK. `script` is a queue of model steps:
 * { text } or { calls: [{name,args}] }. Records every request for assertions.
 */
function fakeSdk(script = [], { models = ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-embedding-2'] } = {}) {
  const requests = [];
  const embed = (t) => {
    // Deterministic bag-of-words embedding (good enough for ranking tests).
    const v = new Array(64).fill(0);
    for (const w of String(t).toLowerCase().split(/\W+/).filter(Boolean)) { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % 64] += 1; }
    return v;
  };
  class GoogleGenAI {
    constructor({ apiKey }) {
      this.apiKey = apiKey;
      this.models = {
        list: async () => (async function* () { for (const name of models) yield { name: 'models/' + name, supportedActions: ['generateContent'] }; })(),
        generateContentStream: async (req) => {
          requests.push(req);
          const step = script.shift() || { text: 'ok' };
          return (async function* () {
            if (step.calls) yield { candidates: [{ content: { role: 'model', parts: step.calls.map((c, i) => ({ functionCall: { id: 'fc' + i, name: c.name, args: c.args } })) } }] };
            else for (const chunk of String(step.text).match(/.{1,12}/gs) || ['']) yield { candidates: [{ content: { role: 'model', parts: [{ text: chunk }] } }] };
          })();
        },
        generateContent: async (req) => { requests.push(req); const step = script.shift() || { text: '{}' }; return { text: step.text, candidates: [{ groundingMetadata: step.grounding || {} }] }; },
        embedContent: async ({ contents }) => ({ embeddings: contents.map((t) => ({ values: embed(t) })) }),
      };
      this.live = { connect: async () => { throw new Error('live not available in tests'); } };
    }
  }
  return { sdk: { GoogleGenAI }, requests, script };
}

function tempCore(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-'));
  const fake = fakeSdk(opts.script || []);
  const core = createCore({ dataDir: dir, version: '3.0.0', genaiSdk: opts.genaiSdk || fake.sdk, fetch: opts.fetch || (async () => { throw new Error('offline'); }), platform: { toast: opts.toast } });
  if (opts.local) {
    // Scripted local provider; the separate loopback integration test exercises Ollama's wire protocol.
    core.localLLM.stepStream = async (o) => {
      fake.requests.push({ contents: structuredClone(o.contents), config: { systemInstruction: o.system }, local: true });
      const step = fake.script.shift() || { text: 'ok' };
      const functionCalls = (step.calls || []).map((c, i) => ({ ...c, id: 'local' + i }));
      const text = step.text || ''; o.onText?.(text);
      return { text, functionCalls, parts: functionCalls.length ? functionCalls.map(functionCall => ({ functionCall })) : [{ text }] };
    };
  }
  return { core, dir, fake, cleanup: () => { core.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

module.exports = { fakeSdk, tempCore };

