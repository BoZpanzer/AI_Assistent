'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { id, nowIso, sha256, dayKey, normText } = require('../core/util');
const { extract, chunkPages, SUPPORTED } = require('./extract');
const log = require('../core/logger').scope('study');

/**
 * Goodnotes → OneDrive → watched Windows folder → incremental index.
 * - mtime/size gate, then content hash (no re-processing of unchanged files)
 * - per-page checksums: only changed pages are re-chunked
 * - handwriting pages (no text layer) are flagged; multimodal transcription
 *   happens on demand (or automatically within a daily budget) and is cached
 *   by page checksum.
 */
class Study {
  constructor(ctx) {
    this.ctx = ctx; this.db = ctx.db; this.bus = ctx.bus; this.settings = ctx.settings; this.gemini = ctx.gemini; this.vectors = ctx.vectors;
    this.watcher = null; this.queue = new Set(); this.running = false; this.debounce = null;
    this.progress = { state: 'idle', done: 0, total: 0, current: '' };
  }

  /** Lokaler Ordner – oder der lokale Spiegel des Google-Drive-Ordners. */
  root() { const s = this.settings.get('study'); return s.source === 'drive' && this.ctx.drive ? this.ctx.drive.root() : s.folder; }
  enabled() { const s = this.settings.get('study'); return s.source === 'drive' ? !!(s.enabled && this.ctx.drive?.granted()) : !!(s.enabled && s.folder); }

  checkFolder(folder) {
    if (!folder) return { ok: false, error: 'Kein Ordner gewählt' };
    try {
      const st = fs.statSync(folder);
      if (!st.isDirectory()) return { ok: false, error: 'Kein Ordner' };
      fs.accessSync(folder, fs.constants.R_OK);
      let files = 0;
      for (const f of this.walk(folder, 5000)) { files++; }
      return { ok: true, files };
    } catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'Ordner existiert nicht' : 'Kein Lesezugriff' }; }
  }

  *walk(dir, limit = 100000) {
    const fmts = new Set(this.settings.get('study').formats || SUPPORTED);
    const stack = [dir]; let n = 0;
    while (stack.length) {
      const d = stack.pop();
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile() && fmts.has(path.extname(e.name).slice(1).toLowerCase())) { yield p; if (++n >= limit) return; }
      }
    }
  }

  subjectFor(rel) {
    const parts = rel.split(/[\\/]/);
    return parts.length > 1 ? parts[0] : 'Allgemein';
  }

  start() {
    this.stop();
    if (!this.enabled()) return;
    const root = this.root();
    try { fs.mkdirSync(root, { recursive: true }); } catch { /* ignore */ }
    try {
      this.watcher = fs.watch(root, { recursive: true }, (_ev, file) => {
        if (!file) return;
        const full = path.join(root, file.toString());
        if (!SUPPORTED.includes(path.extname(full).slice(1).toLowerCase())) return;
        this.queue.add(full);
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.processQueue(), 4000); // OneDrive writes in bursts
      });
      this.watcher.on('error', (e) => log.warn('Ordnerüberwachung', e));
    } catch (e) { log.warn('Ordnerüberwachung nicht möglich', e); }
  }
  stop() { try { this.watcher?.close(); } catch { /* ignore */ } this.watcher = null; }

  /** Full scan: queue changed/new files, remove vanished ones. */
  async scan() {
    if (!this.enabled()) return { skipped: true };
    const root = this.root();
    const seen = new Set();
    for (const f of this.walk(root)) {
      seen.add(f);
      const st = fs.statSync(f);
      const row = this.db.get('SELECT size, mtime_ms, status FROM documents WHERE path=?', f);
      if (!row || row.size !== st.size || row.mtime_ms !== Math.floor(st.mtimeMs) || row.status === 'error' || row.status === 'pending') this.queue.add(f);
    }
    for (const r of this.db.all("SELECT id, path FROM documents WHERE source='folder'")) {
      if (!seen.has(r.path)) { this.db.run('DELETE FROM documents WHERE id=?', r.id); }
    }
    await this.processQueue();
    return { queued: this.queue.size, total: seen.size };
  }

  async processQueue() {
    if (this.running) return;
    this.running = true;
    const files = [...this.queue]; this.queue.clear();
    this.progress = { state: 'running', done: 0, total: files.length, current: '' };
    this.bus.emit('study:progress', this.progress);
    for (const f of files) {
      this.progress.current = path.basename(f);
      try { await this.indexFile(f); } catch (e) { log.warn('Indexierung fehlgeschlagen: ' + path.basename(f), e); }
      this.progress.done++;
      this.bus.emit('study:progress', this.progress);
      await new Promise((r) => setImmediate(r));
    }
    this.running = false;
    this.progress = { state: 'idle', done: files.length, total: files.length, current: '' };
    this.bus.emit('study:progress', this.progress);
    this.bus.emit('study:changed', {});
    if (this.queue.size) setTimeout(() => this.processQueue(), 1000);
  }

  /** Index one file incrementally. */
  async indexFile(file, { source = 'folder', root = this.root(), subject } = {}) {
    if (!fs.existsSync(file)) {
      this.db.run('DELETE FROM documents WHERE path=?', file);
      return { removed: true };
    }
    const st = fs.statSync(file);
    const buf = fs.readFileSync(file);
    const hash = sha256(buf);
    const ext = path.extname(file).slice(1).toLowerCase();
    const rel = root && file.startsWith(root) ? path.relative(root, file) : path.basename(file);
    let doc = this.db.get('SELECT * FROM documents WHERE path=?', file);
    // Same content already indexed under another path (e.g. OneDrive + Drive copy) → no duplicate.
    const twin = this.db.get('SELECT id, rel_path FROM documents WHERE content_hash=? AND path<>? AND status=\'indexed\'', hash, file);
    const now = nowIso();
    if (!doc) {
      const did = id('d');
      this.db.run(`INSERT INTO documents(id,source,path,rel_path,title,subject,ext,size,mtime_ms,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`,
        did, source, file, rel, path.basename(file, path.extname(file)), subject || this.subjectFor(rel), ext, st.size, Math.floor(st.mtimeMs), now);
      doc = this.db.get('SELECT * FROM documents WHERE id=?', did);
    }
    if (twin) {
      this.db.run("UPDATE documents SET status='duplicate', error=?, content_hash=?, size=?, mtime_ms=? WHERE id=?", 'Identisch mit ' + twin.rel_path, hash, st.size, Math.floor(st.mtimeMs), doc.id);
      return { duplicateOf: twin.id };
    }
    if (doc.content_hash === hash && doc.status === 'indexed') {
      this.db.run('UPDATE documents SET size=?, mtime_ms=? WHERE id=?', st.size, Math.floor(st.mtimeMs), doc.id);
      return { unchanged: true };
    }
    let parsed;
    try { parsed = await extract(file); } catch (e) {
      this.db.run("UPDATE documents SET status='error', error=? WHERE id=?", String(e.message).slice(0, 300), doc.id);
      throw e;
    }
    let changedPages = 0;
    this.db.tx(() => {
      const oldPages = new Map(this.db.all('SELECT page, checksum FROM doc_pages WHERE doc_id=?', doc.id).map((r) => [r.page, r.checksum]));
      const newPages = new Set();
      for (const p of parsed.pages) {
        newPages.add(p.page);
        const checksum = sha256(p.text + '|' + p.page);
        if (oldPages.get(p.page) === checksum) continue;
        changedPages++;
        const removed = this.db.all('SELECT id FROM chunks WHERE doc_id=? AND page=?', doc.id, p.page);
        for (const c of removed) this.db.run("DELETE FROM embeddings WHERE owner='c' AND owner_id=?", String(c.id));
        this.db.run('DELETE FROM chunks WHERE doc_id=? AND page=?', doc.id, p.page);
        const needsVision = ext === 'pdf' && p.text.replace(/\s/g, '').length < 40 ? 1 : 0;
        this.db.run('INSERT INTO doc_pages(doc_id,page,checksum,text_len,needs_vision) VALUES(?,?,?,?,?) ON CONFLICT(doc_id,page) DO UPDATE SET checksum=excluded.checksum, text_len=excluded.text_len, needs_vision=excluded.needs_vision',
          doc.id, p.page, checksum, p.text.length, needsVision);
        chunkPages([p]).forEach((c, i) => this.db.run('INSERT INTO chunks(doc_id,page,ord,text,hash,origin) VALUES(?,?,?,?,?,?)', doc.id, p.page, i, c.text, sha256(c.text), 'text'));
      }
      for (const pg of oldPages.keys()) if (!newPages.has(pg)) { this.db.run('DELETE FROM chunks WHERE doc_id=? AND page=?', doc.id, pg); this.db.run('DELETE FROM doc_pages WHERE doc_id=? AND page=?', doc.id, pg); }
      this.db.run("UPDATE documents SET status='indexed', error=NULL, content_hash=?, size=?, mtime_ms=?, page_count=?, indexed_at=?, version=version+? WHERE id=?",
        hash, st.size, Math.floor(st.mtimeMs), parsed.pages.length, now, doc.content_hash ? 1 : 0, doc.id);
    });
    this.vectors?.invalidate('c');
    // Pages already transcribed earlier (same visual content checksum) are restored from cache.
    await this.restoreCachedVision(doc.id);
    this.bus.emit('study:changed', { id: doc.id });
    return { id: doc.id, pages: parsed.pages.length, changedPages };
  }

  async restoreCachedVision(docId) {
    if (!this.db.get('SELECT 1 x FROM page_analysis LIMIT 1')) return;
    const pages = this.db.all('SELECT page FROM doc_pages WHERE doc_id=? AND needs_vision=1', docId).map((r) => r.page);
    if (!pages.length) return;
    const src = await this.loadPdf(docId).catch(() => null);
    if (!src) return;
    for (const page of pages) {
      const key = this.visualHash(await this.extractPage(src, page));
      const hit = this.db.get('SELECT text FROM page_analysis WHERE checksum=?', key);
      if (hit) this.storeVision(docId, page, hit.text);
    }
  }

  async loadPdf(docId) {
    const d = this.db.get('SELECT path FROM documents WHERE id=?', docId);
    if (!d?.path) throw new Error('Dokument nicht gefunden');
    const { PDFDocument } = require('pdf-lib');
    return PDFDocument.load(fs.readFileSync(d.path), { ignoreEncryption: true, updateMetadata: false });
  }
  /** Single-page PDF bytes (for multimodal analysis). */
  async extractPage(src, page) {
    const { PDFDocument } = require('pdf-lib');
    const out = await PDFDocument.create({ updateMetadata: false });
    const [pg] = await out.copyPages(src, [page - 1]);
    out.addPage(pg);
    return Buffer.from(await out.save({ useObjectStreams: false }));
  }
  /** Checksum of the page's visual content (volatile metadata stripped). */
  visualHash(bytes) {
    return sha256(bytes.toString('latin1').replace(/\/(CreationDate|ModDate|ID|Producer|Creator)\s*[^\n]*/g, ''));
  }

  storeVision(docId, page, text) {
    this.db.tx(() => {
      for (const c of this.db.all("SELECT id FROM chunks WHERE doc_id=? AND page=? AND origin='vision'", docId, page)) this.db.run("DELETE FROM embeddings WHERE owner='c' AND owner_id=?", String(c.id));
      this.db.run("DELETE FROM chunks WHERE doc_id=? AND page=? AND origin='vision'", docId, page);
      chunkPages([{ page, text }]).forEach((c, i) => this.db.run('INSERT INTO chunks(doc_id,page,ord,text,hash,origin) VALUES(?,?,?,?,?,?)', docId, page, 100 + i, c.text, sha256(c.text), 'vision'));
      this.db.run('UPDATE doc_pages SET needs_vision=2 WHERE doc_id=? AND page=?', docId, page);
    });
    this.vectors?.invalidate('c');
  }

  /** Multimodal transcription of a page (handwriting/formulas), cached by checksum. */
  async analyzePage(docId, page) {
    const bytes = await this.extractPage(await this.loadPdf(docId), page);
    const key = this.visualHash(bytes);
    let hit = this.db.get('SELECT text FROM page_analysis WHERE checksum=?', key);
    if (!hit) {
      const r = await this.gemini.transcribePdf(bytes);
      this.db.run('INSERT OR REPLACE INTO page_analysis(checksum,text,model,at) VALUES(?,?,?,?)', key, r.text, r.model, nowIso());
      this.bumpVisionBudget();
      hit = { text: r.text };
    }
    this.storeVision(docId, page, hit.text);
    this.bus.emit('study:changed', { id: docId });
    return { docId, page, text: hit.text };
  }

  visionBudgetLeft() {
    const limit = this.settings.get('study').visionDailyLimit;
    const used = Number(this.db.get("SELECT value FROM meta WHERE key=?", 'vision:' + dayKey())?.value || 0);
    return Math.max(0, limit - used);
  }
  bumpVisionBudget() {
    const k = 'vision:' + dayKey();
    this.db.run("INSERT INTO meta(key,value) VALUES(?, '1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1", k);
  }

  /** Background: auto-transcribe handwritten pages within the daily budget. */
  async autoVision(max = 5) {
    if (this.settings.get('study').visionForHandwriting !== 'auto' || !this.gemini.hasKey()) return 0;
    let n = 0;
    const pages = this.db.all('SELECT doc_id, page FROM doc_pages WHERE needs_vision=1 ORDER BY doc_id, page LIMIT ?', max);
    for (const p of pages) {
      if (this.visionBudgetLeft() <= 0) break;
      try { await this.analyzePage(p.doc_id, p.page); n++; } catch (e) { log.warn('Seitenanalyse', e); break; }
    }
    return n;
  }

  documents({ subject, q, limit = 200 } = {}) {
    let sql = 'SELECT d.*, (SELECT COUNT(*) FROM doc_pages p WHERE p.doc_id=d.id AND p.needs_vision=1) handwriting FROM documents d WHERE source<>\'web\'';
    const p = [];
    if (subject) { sql += ' AND subject=?'; p.push(subject); }
    if (q) { sql += ' AND (title LIKE ? OR rel_path LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY COALESCE(indexed_at, created_at) DESC LIMIT ?'; p.push(limit);
    return this.db.all(sql, ...p).map((d) => ({
      id: d.id, title: d.title, path: d.rel_path, subject: d.subject, ext: d.ext, pages: d.page_count, status: d.status, error: d.error,
      indexedAt: d.indexed_at, size: d.size, handwritingPages: d.handwriting, source: d.source,
    }));
  }
  subjects() { return this.db.all("SELECT subject, COUNT(*) c FROM documents WHERE source<>'web' GROUP BY subject ORDER BY subject").map((r) => ({ subject: r.subject, count: r.c })); }
  document(docId) {
    const d = this.db.get('SELECT * FROM documents WHERE id=?', docId);
    if (!d) return null;
    const pages = this.db.all('SELECT page, text_len, needs_vision FROM doc_pages WHERE doc_id=? ORDER BY page', docId);
    return { id: d.id, title: d.title, path: d.rel_path, fullPath: d.path, subject: d.subject, ext: d.ext, pages, status: d.status, indexedAt: d.indexed_at, url: d.url };
  }
  /** Concatenated text of a document (bounded) for summaries/quizzes. */
  documentText(docId, { fromPage = 1, toPage = 9999, maxChars = 60000 } = {}) {
    const rows = this.db.all('SELECT page, text FROM chunks WHERE doc_id=? AND page BETWEEN ? AND ? ORDER BY page, ord', docId, fromPage, toPage);
    let out = ''; let last = null;
    for (const r of rows) {
      if (r.page !== last) { out += `\n\n[Seite ${r.page}]\n`; last = r.page; }
      out += r.text + '\n';
      if (out.length > maxChars) break;
    }
    return out.slice(0, maxChars);
  }
  /**
   * Notes/scripts that probably belong to a lecture title: subject-folder
   * match first, then full-text hits. Purely local, no AI.
   */
  relatedNotes(title, { limit = 3 } = {}) {
    const { courseName } = require('./ics');
    const course = courseName(title);
    const STOP = new Set(['und', 'der', 'die', 'das', 'in', 'im', 'fur', 'mit', 'von', 'zu', 'ii', 'iii', 'iv', 'i', 'grundlagen', 'einfuhrung', 'teil', 'vorlesung', 'ubung', 'seminar']);
    const words = normText(course).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    if (!words.length) return [];
    const out = new Map();
    const subjects = this.subjects().map((x) => x.subject);
    const abbr = course.split(/\s+/).filter((w) => /^[A-ZÄÖÜ]/.test(w)).map((w) => w[0]).join('').toLowerCase();
    const subj = subjects.find((sub) => { const n = normText(sub); return words.some((w) => n.includes(w)) || (abbr.length >= 2 && n.replace(/\s+/g, '') === abbr); });
    if (subj) for (const d of this.documents({ subject: subj, limit })) out.set(d.id, { id: d.id, title: d.title, subject: d.subject, reason: 'Fach „' + subj + '“' });
    if (out.size < limit) {
      try {
        const q = words.slice(0, 4).map((w) => '"' + w.replace(/"/g, '') + '"').join(' OR ');
        const rows = this.db.all(`SELECT c.doc_id, d.title, d.subject, MIN(bm25(chunks_fts)) score FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.doc_id
          WHERE chunks_fts MATCH ? AND d.source<>'web' GROUP BY c.doc_id ORDER BY score LIMIT ?`, q, limit * 2);
        for (const r of rows) if (!out.has(r.doc_id) && out.size < limit) out.set(r.doc_id, { id: r.doc_id, title: r.title, subject: r.subject, reason: 'Inhalt passt' });
      } catch { /* FTS syntax edge cases */ }
    }
    return [...out.values()].slice(0, limit);
  }

  status() {
    const s = this.settings.get('study');
    return {
      enabled: this.enabled(), folder: s.source === 'drive' ? null : s.folder, source: s.source || 'folder', driveFolder: s.driveFolder || 'Goodnotes', driveGranted: !!this.ctx.drive?.granted(), watching: !!this.watcher, progress: this.progress,
      documents: this.db.get("SELECT COUNT(*) c FROM documents WHERE source<>'web'").c,
      indexed: this.db.get("SELECT COUNT(*) c FROM documents WHERE status='indexed' AND source<>'web'").c,
      errors: this.db.get("SELECT COUNT(*) c FROM documents WHERE status='error'").c,
      handwritingPending: this.db.get('SELECT COUNT(*) c FROM doc_pages WHERE needs_vision=1').c,
      visionBudgetLeft: this.visionBudgetLeft(),
    };
  }
}

module.exports = { Study };
