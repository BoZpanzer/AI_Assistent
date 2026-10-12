// Feeds a WAV file through the real wake-word worker module (onnxruntime-web/WASM in Node).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function scoreWav(file, { worker = path.resolve('src/renderer/audio/wakeword-worker.js') } = {}) {
  const buf = fs.readFileSync(file);
  const rate = buf.readUInt32LE(24); const dataOff = buf.indexOf('data') + 8;
  const src = new Int16Array(buf.buffer.slice(buf.byteOffset + dataOff, buf.byteOffset + buf.length - ((buf.length - dataOff) % 2)));
  const n = Math.floor(src.length * 16000 / rate); const pcm = new Int16Array(n + 32000);
  for (let i = 0; i < n; i++) { const x = i * rate / 16000; const a = Math.floor(x); pcm[16000 + i] = src[a] + ((src[a + 1] ?? src[a]) - src[a]) * (x - a); }
  const msgs = []; let wakeAt = -1; let max = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { const s = String(u?.url || u); if (s.startsWith('file:')) { const b = fs.readFileSync(new URL(s)); return new Response(b, { headers: { 'Content-Type': s.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }); } return realFetch(u, o); };
  globalThis.self = globalThis; globalThis.postMessage = (m) => msgs.push(m);
  const mod = await import(pathToFileURL(worker).href + '?t=' + Date.now());
  void mod;
  globalThis.onmessage({ data: { type: 'init', threshold: 0.5 } });
  for (let i = 0; i < 400 && !msgs.some((m) => m.type === 'ready' || m.type === 'error'); i++) await new Promise((r) => setTimeout(r, 25));
  const err = msgs.find((m) => m.type === 'error'); if (err) throw new Error(err.error);
  for (let i = 0; i + 1280 <= pcm.length; i += 1280) {
    msgs.length = 0;
    globalThis.onmessage({ data: { type: 'audio', pcm: pcm.slice(i, i + 1280) } });
    for (let k = 0; k < 200 && !msgs.length; k++) await new Promise((r) => setTimeout(r, 2));
    for (const m of msgs) { if (m.type === 'score') max = Math.max(max, m.score); if (m.type === 'wake' && wakeAt < 0) wakeAt = i / 16000; if (m.type === 'error') throw new Error(m.error); }
  }
  return { max: +max.toFixed(3), wakeAt };
}
if (process.argv[2]) console.log(JSON.stringify(await scoreWav(process.argv[2])));
