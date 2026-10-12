'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const SUPPORTED = ['pdf', 'docx', 'pptx', 'txt', 'md', 'markdown', 'ipynb'];

/** Parse a document in a sandboxed worker thread with a hard timeout. */
function extract(file, { timeoutMs = 120000 } = {}) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!SUPPORTED.includes(ext)) return Promise.reject(new Error('Nicht unterstütztes Format: .' + ext));
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { file, ext },
      resourceLimits: { maxOldGenerationSizeMb: 768 },
    });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('Zeitüberschreitung beim Lesen der Datei')); }, timeoutMs);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); m.ok ? resolve(m.result) : reject(new Error(m.error)); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
    w.once('exit', (code) => { clearTimeout(timer); if (code !== 0 && code !== 1) reject(new Error('Parser beendet: ' + code)); });
  });
}

/** Split page text into overlapping chunks for retrieval. */
function chunkPages(pages, { size = 1200, overlap = 150 } = {}) {
  const out = [];
  for (const p of pages) {
    const t = (p.text || '').trim();
    if (!t) continue;
    if (t.length <= size) { out.push({ page: p.page, text: t }); continue; }
    let i = 0;
    while (i < t.length) {
      let end = Math.min(t.length, i + size);
      if (end < t.length) {
        const cut = t.lastIndexOf('\n', end);
        const cut2 = t.lastIndexOf('. ', end);
        const best = Math.max(cut, cut2);
        if (best > i + size * 0.5) end = best + 1;
      }
      out.push({ page: p.page, text: t.slice(i, end).trim() });
      if (end >= t.length) break;
      i = Math.max(end - overlap, i + 1);
    }
  }
  return out;
}

module.exports = { extract, chunkPages, SUPPORTED };
