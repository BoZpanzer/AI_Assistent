'use strict';
/**
 * Isolated document parser (worker thread). The main process kills it on
 * timeout, so a malformed/hostile file cannot hang or crash JARVIS.
 * No network, no eval: pdf.js runs with isEvalSupported=false and without
 * font loading/scripting.
 */
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');

const MAX_BYTES = 200 * 1024 * 1024;

function xmlText(xml, tags) {
  // Extract text of given element names in document order, paragraph-aware.
  const out = [];
  const re = new RegExp(`<(?:${tags.join('|')})(?:\\s[^>]*)?>([^<]*)</(?:${tags.join('|')})>|<(?:w:p|a:p)(?:\\s[^>]*)?/?>|<w:tab/>|<w:br/>|<m:oMath\\b|</m:oMath>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out.push(decode(m[1]));
    else if (m[0].startsWith('<m:oMath')) out.push(' $');
    else if (m[0] === '</m:oMath>') out.push('$ ');
    else if (m[0] === '<w:tab/>') out.push('\t');
    else out.push('\n');
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
}

async function pdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    enableXfa: false, stopAtErrors: false, verbosity: 0,
  }).promise;
  const pages = [];
  const n = Math.min(doc.numPages, 2000);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent({ includeMarkedContent: false });
    let text = ''; let lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
      else if (text && !text.endsWith(' ') && it.str && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      if (it.hasEOL) text += '\n';
      lastY = y;
    }
    pages.push({ page: i, text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() });
    page.cleanup();
  }
  try { await (doc.destroy ? doc.destroy() : doc.cleanup?.()); } catch { /* ignore */ }
  return { kind: 'pdf', pages };
}

function docx(buf) {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /^word\/(document|footnotes|endnotes)\.xml$/.test(f.name) });
  const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
  // Linearise OMML math: keep m:t runs inside $…$
  const text = xmlText(xml, ['w:t', 'm:t']);
  return { kind: 'docx', pages: splitPseudoPages(text) };
}

function pptx(buf) {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(f.name) });
  const slides = Object.keys(files).filter((f) => f.startsWith('ppt/slides/')).sort((a, b) => num(a) - num(b));
  const pages = slides.map((f) => {
    let text = xmlText(strFromU8(files[f]), ['a:t']);
    const notes = files[`ppt/notesSlides/notesSlide${num(f)}.xml`];
    if (notes) { const n = xmlText(strFromU8(notes), ['a:t']); if (n) text += '\n\nNotizen: ' + n; }
    return { page: num(f), text };
  });
  return { kind: 'pptx', pages };
}
const num = (f) => parseInt(f.match(/(\d+)\.xml$/)?.[1] || '0', 10);

function ipynb(buf) {
  const nb = JSON.parse(buf.toString('utf8'));
  const cells = (nb.cells || []).map((c, i) => {
    const src = Array.isArray(c.source) ? c.source.join('') : String(c.source || '');
    return { page: i + 1, text: (c.cell_type === 'code' ? '```python\n' + src + '\n```' : src).trim() };
  }).filter((c) => c.text);
  // Group cells into ~3000 char pseudo pages
  const pages = []; let cur = ''; let start = 1;
  for (const c of cells) {
    if (cur.length + c.text.length > 3000 && cur) { pages.push({ page: start, text: cur }); cur = ''; start = c.page; }
    cur += (cur ? '\n\n' : '') + c.text;
  }
  if (cur) pages.push({ page: start, text: cur });
  return { kind: 'ipynb', pages };
}

function splitPseudoPages(text, size = 3500) {
  const paras = text.split(/\n{2,}/);
  const pages = []; let cur = '';
  for (const p of paras) {
    if (cur.length + p.length > size && cur) { pages.push({ page: pages.length + 1, text: cur }); cur = ''; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) pages.push({ page: pages.length + 1, text: cur });
  return pages;
}

async function run() {
  const { file, ext } = workerData;
  const st = fs.statSync(file);
  if (st.size > MAX_BYTES) throw new Error('Datei zu groß (> 200 MB)');
  const buf = fs.readFileSync(file);
  switch (ext) {
    case 'pdf': return pdf(buf);
    case 'docx': return docx(buf);
    case 'pptx': return pptx(buf);
    case 'ipynb': return ipynb(buf);
    case 'md': case 'txt': case 'markdown':
      return { kind: ext, pages: splitPseudoPages(buf.toString('utf8').replace(/^﻿/, '')) };
    default: throw new Error('Nicht unterstütztes Format: ' + path.extname(file));
  }
}

run().then((r) => parentPort.postMessage({ ok: true, result: r }), (e) => parentPort.postMessage({ ok: false, error: String(e?.message || e) }));
