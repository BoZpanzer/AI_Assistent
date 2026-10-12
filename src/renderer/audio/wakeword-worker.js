/* Local "Hey Jarvis" detection with openWakeWord ONNX models (runs fully
 * offline in this worker; no audio leaves the machine). Pipeline:
 * 16 kHz PCM16 → melspectrogram → embedding (76×32 window) → wake model (16×96). */
import * as ort from '../assets/ort/ort.wasm.min.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('../assets/ort/', import.meta.url).href;
ort.env.logLevel = 'error';

const BASE = new URL('../assets/wakeword/', import.meta.url).href;
let mel, emb, wake, ready = false;
let raw = new Int16Array(0);
let melBuf = []; // array of Float32Array(32)
let feats = []; // array of Float32Array(96)
let threshold = 0.5;
let cooldownUntil = 0;
let busy = false;
const queue = [];

for (let i = 0; i < 76; i++) melBuf.push(new Float32Array(32).fill(1));

async function init() {
  const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  [mel, emb, wake] = await Promise.all([
    ort.InferenceSession.create(BASE + 'melspectrogram.onnx', opt),
    ort.InferenceSession.create(BASE + 'embedding_model.onnx', opt),
    ort.InferenceSession.create(BASE + 'hey_jarvis_v0.1.onnx', opt),
  ]);
  ready = true;
  self.postMessage({ type: 'ready' });
}

async function processChunk(chunk) {
  // keep 1280 + 480 samples of context for the streaming melspectrogram
  const merged = new Int16Array(raw.length + chunk.length);
  merged.set(raw); merged.set(chunk, raw.length);
  raw = merged.slice(Math.max(0, merged.length - 1760));
  const input = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) input[i] = raw[i];
  const mOut = await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', input, [1, input.length]) });
  const spec = mOut[mel.outputNames[0]];
  const frames = spec.dims[spec.dims.length - 2];
  for (let f = 0; f < frames; f++) {
    const row = new Float32Array(32);
    for (let k = 0; k < 32; k++) row[k] = spec.data[f * 32 + k] / 10 + 2;
    melBuf.push(row);
  }
  if (melBuf.length > 200) melBuf = melBuf.slice(-200);
  if (melBuf.length < 76) return null;
  const win = new Float32Array(76 * 32);
  const start = melBuf.length - 76;
  for (let f = 0; f < 76; f++) win.set(melBuf[start + f], f * 32);
  const eOut = await emb.run({ [emb.inputNames[0]]: new ort.Tensor('float32', win, [1, 76, 32, 1]) });
  feats.push(Float32Array.from(eOut[emb.outputNames[0]].data.slice(0, 96)));
  if (feats.length > 40) feats = feats.slice(-40);
  if (feats.length < 16) return null;
  const x = new Float32Array(16 * 96);
  for (let i = 0; i < 16; i++) x.set(feats[feats.length - 16 + i], i * 96);
  const wOut = await wake.run({ [wake.inputNames[0]]: new ort.Tensor('float32', x, [1, 16, 96]) });
  return wOut[wake.outputNames[0]].data[0];
}

async function pump() {
  if (busy || !ready) return;
  busy = true;
  try {
    while (queue.length) {
      const chunk = queue.shift();
      const score = await processChunk(chunk);
      if (score != null) {
        if (score > 0.1) self.postMessage({ type: 'score', score });
        if (score >= threshold && Date.now() > cooldownUntil) {
          cooldownUntil = Date.now() + 2500;
          self.postMessage({ type: 'wake', score });
        }
      }
    }
  } catch (e) {
    self.postMessage({ type: 'error', error: String(e?.message || e) });
  } finally { busy = false; }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { threshold = m.threshold ?? 0.5; init().catch((err) => self.postMessage({ type: 'error', error: String(err?.message || err) })); }
  else if (m.type === 'threshold') threshold = m.value;
  else if (m.type === 'audio') { if (queue.length < 10) queue.push(m.pcm); pump(); }
  else if (m.type === 'reset') { feats = []; cooldownUntil = Date.now() + 1500; }
};
