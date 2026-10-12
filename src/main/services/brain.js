'use strict';
const { id, nowIso, sha256, normText, safeJson, truncate } = require('../core/util');
const { validate } = require('../core/validate');

/** Brain domains shown as nodes around the JARVIS core. */
const DOMAINS = {
  projects: 'Projekte', study: 'Studium', knowledge: 'Wissen', memories: 'Erinnerungen',
  ideas: 'Ideen', sources: 'Quellen', personal: 'Persönliches', technology: 'Technologie', gaming: 'Gaming',
};
const KINDS = ['memory', 'preference', 'fact', 'idea', 'experience', 'project', 'note', 'source', 'game'];
const SOURCE_WEIGHT = { user: 1.0, chat: 0.95, document: 1.0, import: 0.9, web: 0.85, game: 0.9, system: 0.8 };

const ENTRY_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', enum: KINDS }, domain: { type: 'string', enum: Object.keys(DOMAINS) },
    title: { type: 'string', maxLength: 200 }, content: { type: 'string', minLength: 1, maxLength: 20000 },
    tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 12 },
    sourceType: { type: 'string', enum: Object.keys(SOURCE_WEIGHT) }, sourceRef: { type: 'string', maxLength: 500 },
    sourceUrl: { type: 'string', maxLength: 1000 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    subjectKey: { type: 'string', maxLength: 120 }, game: { type: 'string', maxLength: 80 }, gameVersion: { type: 'string', maxLength: 40 },
    validUntil: { type: 'string', nullable: true }, pinned: { type: 'boolean' }, sensitive: { type: 'boolean' },
  },
};

// Categories that must not be auto-stored without an explicit user request.
const SENSITIVE_RE = /\b(diagnos|krank|depress|therapie|medikament|religi|glaube|sexuell|orientierung|partei|wahl(?:e|t)?\b|gewerkschaft|schulden|gehalt|einkommen|passwort|pin\b|iban|kreditkarte|ausweis|vorstrafe|polizei)/i;

class Brain {
  constructor(ctx) {
    this.db = ctx.db; this.bus = ctx.bus; this.vectors = ctx.vectors; this.gemini = ctx.gemini;
  }

  toPublic(r) {
    if (!r) return null;
    return {
      id: r.id, kind: r.kind, domain: r.domain, domainLabel: DOMAINS[r.domain] || r.domain, title: r.title, content: r.content,
      tags: safeJson(r.tags, []), sourceType: r.source_type, sourceRef: r.source_ref, sourceUrl: r.source_url,
      confidence: r.confidence, sensitive: !!r.sensitive, subjectKey: r.subject_key, game: r.game, gameVersion: r.game_version,
      validUntil: r.valid_until, stale: !!(r.valid_until && r.valid_until < nowIso()), archived: !!r.archived, pinned: !!r.pinned,
      conflictWith: r.conflict_with, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  isSensitive(text) { return SENSITIVE_RE.test(text); }

  /**
   * Store an entry with duplicate detection, contradiction handling and
   * revision history. Returns { entry, action: created|duplicate|updated|superseded|conflict|rejected }.
   */
  add(input, { auto = false } = {}) {
    const v = validate(ENTRY_SCHEMA, input);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    const content = d.content.trim();
    const sensitive = d.sensitive ?? this.isSensitive(content + ' ' + (d.title || ''));
    if (auto && sensitive) return { entry: null, action: 'rejected', reason: 'sensibel – nur auf ausdrücklichen Wunsch speichern' };
    const hash = sha256(normText(content));
    const now = nowIso();
    const dup = this.db.get('SELECT * FROM knowledge WHERE content_hash=? AND archived=0', hash);
    if (dup) {
      this.db.run('UPDATE knowledge SET updated_at=?, confidence=MIN(1, confidence+0.05) WHERE id=?', now, dup.id);
      return { entry: this.get(dup.id), action: 'duplicate' };
    }
    const subjectKey = d.subjectKey ? normText(d.subjectKey).slice(0, 120) : null;
    let action = 'created';
    let conflictWith = null;
    let prevId = null;
    const nid = id('k');
    if (subjectKey) {
      const prev = this.db.get('SELECT * FROM knowledge WHERE subject_key=? AND archived=0 AND (game IS ? OR game=?) ORDER BY updated_at DESC', subjectKey, d.game || null, d.game || null);
      if (prev) {
        prevId = prev.id;
        const personal = ['user', 'chat'].includes(d.sourceType || 'user') && ['user', 'chat'].includes(prev.source_type);
        if (personal) {
          // User restated a personal fact → newer statement supersedes, old one archived with history.
          this.db.run('INSERT INTO knowledge_revisions(knowledge_id,title,content,reason,at) VALUES(?,?,?,?,?)', prev.id, prev.title, prev.content, 'ersetzt durch ' + nid, now);
          this.db.run('UPDATE knowledge SET archived=1, merged_into=?, updated_at=? WHERE id=?', nid, now, prev.id);
          action = 'superseded';
        } else {
          conflictWith = prev.id;
          this.db.run('UPDATE knowledge SET conflict_with=? WHERE id=?', nid, prev.id);
          action = 'conflict';
        }
      }
    }
    this.db.run(`INSERT INTO knowledge(id,kind,domain,title,content,tags,source_type,source_ref,source_url,confidence,sensitive,subject_key,game,game_version,valid_until,pinned,conflict_with,content_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, nid, d.kind || 'fact', d.domain || 'knowledge', (d.title || truncate(content, 80)).trim(), content,
    JSON.stringify(d.tags || []), d.sourceType || 'user', d.sourceRef || null, d.sourceUrl || null, d.confidence ?? (auto ? 0.7 : 0.9),
    sensitive ? 1 : 0, subjectKey, d.game || null, d.gameVersion || null, d.validUntil || null, d.pinned ? 1 : 0, conflictWith, hash, now, now);
    if (prevId) this.db.run('INSERT OR IGNORE INTO knowledge_links(a,b,kind) VALUES(?,?,?)', nid, prevId, action === 'superseded' ? 'supersedes' : 'contradicts');
    this.bus.emit('brain:changed', { id: nid, action });
    return { entry: this.get(nid), action };
  }

  update(kid, patch, reason = 'manuelle Korrektur') {
    const cur = this.db.get('SELECT * FROM knowledge WHERE id=?', kid);
    if (!cur) throw new Error('Eintrag nicht gefunden');
    const v = validate(ENTRY_SCHEMA, patch);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    const now = nowIso();
    this.db.run('INSERT INTO knowledge_revisions(knowledge_id,title,content,reason,at) VALUES(?,?,?,?,?)', kid, cur.title, cur.content, reason, now);
    const content = d.content ?? cur.content;
    this.db.run(`UPDATE knowledge SET title=?, content=?, domain=?, kind=?, tags=?, confidence=?, valid_until=?, pinned=?, content_hash=?, conflict_with=NULL, updated_at=? WHERE id=?`,
      d.title ?? cur.title, content, d.domain ?? cur.domain, d.kind ?? cur.kind, d.tags ? JSON.stringify(d.tags) : cur.tags,
      d.confidence ?? Math.max(cur.confidence, 0.95), d.validUntil !== undefined ? d.validUntil : cur.valid_until,
      d.pinned !== undefined ? (d.pinned ? 1 : 0) : cur.pinned, sha256(normText(content)), now, kid);
    if (content !== cur.content) this.vectors?.remove('k', kid);
    this.bus.emit('brain:changed', { id: kid, action: 'updated' });
    return this.get(kid);
  }

  archive(kid, archived = true) {
    this.db.run('UPDATE knowledge SET archived=?, updated_at=? WHERE id=?', archived ? 1 : 0, nowIso(), kid);
    this.bus.emit('brain:changed', { id: kid, action: archived ? 'archived' : 'restored' });
    return this.get(kid);
  }

  remove(kid) {
    const cur = this.db.get('SELECT id,title FROM knowledge WHERE id=?', kid);
    if (!cur) throw new Error('Eintrag nicht gefunden');
    this.db.tx(() => {
      this.db.run('DELETE FROM knowledge WHERE id=?', kid);
      this.db.run('DELETE FROM knowledge_links WHERE a=? OR b=?', kid, kid);
      this.db.run('DELETE FROM knowledge_revisions WHERE knowledge_id=?', kid);
    });
    this.vectors?.remove('k', kid);
    this.bus.emit('brain:changed', { id: kid, action: 'deleted' });
    return { id: kid, title: cur.title };
  }

  get(kid) {
    const r = this.toPublic(this.db.get('SELECT * FROM knowledge WHERE id=?', kid));
    if (!r) return null;
    r.links = this.db.all(`SELECT k.id, k.title, k.domain, l.kind FROM knowledge_links l JOIN knowledge k ON k.id = CASE WHEN l.a=? THEN l.b ELSE l.a END
      WHERE (l.a=? OR l.b=?) AND k.id<>? LIMIT 20`, kid, kid, kid, kid).map((x) => ({ ...x, domainLabel: DOMAINS[x.domain] }));
    r.revisions = this.db.all('SELECT title, content, reason, at FROM knowledge_revisions WHERE knowledge_id=? ORDER BY id DESC LIMIT 10', kid);
    return r;
  }

  link(a, b, kind = 'related') {
    if (a === b) return;
    this.db.run('INSERT OR IGNORE INTO knowledge_links(a,b,kind) VALUES(?,?,?)', a, b, kind);
    this.bus.emit('brain:changed', { id: a, action: 'linked' });
  }

  list({ domain, kind, game, q, archived = false, limit = 100, offset = 0 } = {}) {
    let sql = 'SELECT * FROM knowledge WHERE archived=?';
    const p = [archived ? 1 : 0];
    if (domain) { sql += ' AND domain=?'; p.push(domain); }
    if (kind) { sql += ' AND kind=?'; p.push(kind); }
    if (game) { sql += ' AND game=?'; p.push(game); }
    if (q) { sql += ' AND (title LIKE ? OR content LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?'; p.push(Math.min(500, limit), offset);
    return this.db.all(sql, ...p).map((r) => this.toPublic(r));
  }

  ftsQuery(q) {
    const toks = normText(q).split(' ').filter((t) => t.length >= 2).slice(0, 12);
    if (!toks.length) return null;
    return toks.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
  }

  /**
   * Hybrid search: FTS5 (bm25) + semantic (if embeddings exist) fused with
   * reciprocal-rank fusion, weighted by source reliability and confidence.
   * scope: 'all' | 'knowledge' | 'documents'
   */
  async search(query, { scope = 'all', domains, game, subject, limit = 8, semantic = true } = {}) {
    const fts = this.ftsQuery(query);
    const cands = new Map();
    const add = (key, rank, base, kind) => {
      const c = cands.get(key) || { key, kind, rrf: 0, base };
      c.rrf += 1 / (60 + rank);
      cands.set(key, c);
    };
    if (fts && scope !== 'documents') {
      let sql = `SELECT k.id, bm25(knowledge_fts, 4.0, 1.0, 2.0) s FROM knowledge_fts f JOIN knowledge k ON k.rowid=f.rowid WHERE knowledge_fts MATCH ? AND k.archived=0`;
      const p = [fts];
      if (domains?.length) { sql += ` AND k.domain IN (${domains.map(() => '?').join(',')})`; p.push(...domains); }
      if (game) { sql += ' AND (k.game=? OR k.game IS NULL)'; p.push(game); }
      sql += ' ORDER BY s LIMIT 40';
      this.db.all(sql, ...p).forEach((r, i) => add('k:' + r.id, i, null, 'knowledge'));
    }
    if (fts && scope !== 'knowledge') {
      let sql = `SELECT c.id, bm25(chunks_fts) s FROM chunks_fts f JOIN chunks c ON c.id=f.rowid JOIN documents d ON d.id=c.doc_id WHERE chunks_fts MATCH ?`;
      const p = [fts];
      if (subject) { sql += ' AND d.subject=?'; p.push(subject); }
      sql += ' ORDER BY s LIMIT 40';
      this.db.all(sql, ...p).forEach((r, i) => add('c:' + r.id, i, null, 'chunk'));
    }
    let semanticUsed = false;
    if (semantic && this.vectors && this.gemini?.hasKey() && this.gemini.model('embedding')) {
      try {
        const hasK = scope !== 'documents' && this.vectors.count('k') > 0;
        const hasC = scope !== 'knowledge' && this.vectors.count('c') > 0;
        if (hasK || hasC) {
          const qv = await this.vectors.queryVector(query);
          semanticUsed = true;
          if (hasK) this.vectors.search('k', qv, 30).filter((h) => h.score > 0.35).forEach((h, i) => add('k:' + h.id, i, null, 'knowledge'));
          if (hasC) this.vectors.search('c', qv, 30).filter((h) => h.score > 0.35).forEach((h, i) => add('c:' + h.id, i, null, 'chunk'));
        }
      } catch { /* offline → FTS only */ }
    }
    const results = [];
    for (const c of cands.values()) {
      const [type, rid] = [c.key.slice(0, 1), c.key.slice(2)];
      if (type === 'k') {
        const r = this.db.get('SELECT * FROM knowledge WHERE id=? AND archived=0', rid);
        if (!r) continue;
        if (domains?.length && !domains.includes(r.domain)) continue;
        const stale = r.valid_until && r.valid_until < nowIso();
        const score = c.rrf * (SOURCE_WEIGHT[r.source_type] || 0.8) * (0.5 + r.confidence / 2) * (stale ? 0.6 : 1) * (r.pinned ? 1.2 : 1);
        results.push({ type: 'knowledge', id: r.id, title: r.title, snippet: truncate(r.content, 400), domain: r.domain, domainLabel: DOMAINS[r.domain],
          sourceType: r.source_type, sourceUrl: r.source_url, game: r.game, stale: !!stale, updatedAt: r.updated_at, score });
      } else {
        const r = this.db.get(`SELECT c.id, c.page, c.text, d.id doc_id, d.title, d.rel_path, d.subject, d.source, d.url, d.path FROM chunks c JOIN documents d ON d.id=c.doc_id WHERE c.id=?`, Number(rid));
        if (!r) continue;
        if (subject && r.subject !== subject) continue;
        const score = c.rrf * (r.source === 'web' ? SOURCE_WEIGHT.web : SOURCE_WEIGHT.document);
        results.push({ type: 'document', id: r.id, docId: r.doc_id, title: r.title, path: r.rel_path, page: r.page, subject: r.subject, source: r.source,
          sourceUrl: r.url, snippet: truncate(r.text, 600), citation: `${r.rel_path}${r.page ? ' – S. ' + r.page : ''}`, score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return { results: results.slice(0, limit), semantic: semanticUsed };
  }

  overview() {
    const g = (sql, ...p) => this.db.get(sql, ...p).c;
    const byDomain = Object.fromEntries(this.db.all('SELECT domain, COUNT(*) c FROM knowledge WHERE archived=0 GROUP BY domain').map((r) => [r.domain, r.c]));
    return {
      memories: g('SELECT COUNT(*) c FROM knowledge WHERE archived=0'),
      sources: g('SELECT COUNT(*) c FROM documents') + (byDomain.sources || 0),
      links: g('SELECT COUNT(*) c FROM knowledge_links'),
      projects: byDomain.projects || 0,
      conflicts: g('SELECT COUNT(*) c FROM knowledge WHERE conflict_with IS NOT NULL AND archived=0'),
      stale: g('SELECT COUNT(*) c FROM knowledge WHERE valid_until IS NOT NULL AND valid_until<? AND archived=0', nowIso()),
      byDomain: Object.fromEntries(Object.keys(DOMAINS).map((d) => [d, byDomain[d] || 0])),
      embedded: g("SELECT COUNT(*) c FROM embeddings WHERE owner='k'"),
      documentsByStatus: Object.fromEntries(this.db.all('SELECT status, COUNT(*) c FROM documents GROUP BY status').map((r) => [r.status, r.c])),
    };
  }

  /** Graph of real data: domain hubs + most relevant entries per domain + links. */
  graph({ perDomain = 6 } = {}) {
    const ov = this.overview();
    const nodes = [{ id: 'core', label: 'JARVIS', type: 'core' }];
    const edges = [];
    for (const [d, label] of Object.entries(DOMAINS)) {
      if (d === 'gaming' && !ov.byDomain.gaming) continue;
      const count = d === 'sources' ? ov.sources : ov.byDomain[d];
      nodes.push({ id: 'd:' + d, label, type: 'domain', domain: d, count });
      edges.push({ a: 'core', b: 'd:' + d });
      const items = this.db.all('SELECT id, title, kind FROM knowledge WHERE domain=? AND archived=0 ORDER BY pinned DESC, updated_at DESC LIMIT ?', d, perDomain);
      for (const it of items) { nodes.push({ id: it.id, label: truncate(it.title, 26), type: 'entry', domain: d, kind: it.kind }); edges.push({ a: 'd:' + d, b: it.id }); }
      if (d === 'sources') {
        const docs = this.db.all('SELECT id, title FROM documents ORDER BY created_at DESC LIMIT ?', Math.max(0, perDomain - items.length));
        for (const it of docs) { nodes.push({ id: 'doc:' + it.id, label: truncate(it.title, 26), type: 'document', domain: d }); edges.push({ a: 'd:' + d, b: 'doc:' + it.id }); }
      }
    }
    const ids = new Set(nodes.map((n) => n.id));
    for (const l of this.db.all('SELECT a, b, kind FROM knowledge_links LIMIT 400')) if (ids.has(l.a) && ids.has(l.b)) edges.push({ a: l.a, b: l.b, kind: l.kind, cross: true });
    return { nodes, edges, overview: ov };
  }

  /** Clusters: tags + domains with counts. */
  clusters() {
    const tags = new Map();
    for (const r of this.db.all('SELECT tags, domain FROM knowledge WHERE archived=0')) {
      for (const t of safeJson(r.tags, [])) {
        const k = String(t).toLowerCase();
        tags.set(k, (tags.get(k) || 0) + 1);
      }
    }
    return {
      domains: Object.entries(this.overview().byDomain).map(([d, c]) => ({ domain: d, label: DOMAINS[d], count: c })),
      tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([tag, count]) => ({ tag, count })),
    };
  }

  /**
   * Maintenance: merge semantic near-duplicates (cos ≥ 0.95, same domain),
   * archive expired entries that are older than 90 days past validity.
   */
  maintain() {
    let merged = 0, archived = 0;
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    archived = this.db.run('UPDATE knowledge SET archived=1 WHERE archived=0 AND pinned=0 AND valid_until IS NOT NULL AND valid_until<?', cutoff).changes;
    if (this.vectors && this.vectors.count('k') > 1) {
      const idx = this.vectors.load('k');
      const seen = new Set();
      for (let i = 0; i < idx.ids.length && i < 3000; i++) {
        if (seen.has(idx.ids[i])) continue;
        const q = idx.mat.subarray(i * idx.dim, (i + 1) * idx.dim);
        const hits = this.vectors.search('k', q, 4).filter((h) => h.id !== idx.ids[i] && h.score >= 0.95);
        for (const h of hits) {
          const a = this.db.get('SELECT * FROM knowledge WHERE id=? AND archived=0', idx.ids[i]);
          const b = this.db.get('SELECT * FROM knowledge WHERE id=? AND archived=0', h.id);
          if (!a || !b || a.domain !== b.domain || a.pinned || b.pinned) continue;
          const [keep, drop] = a.updated_at >= b.updated_at ? [a, b] : [b, a];
          this.db.run('INSERT INTO knowledge_revisions(knowledge_id,title,content,reason,at) VALUES(?,?,?,?,?)', drop.id, drop.title, drop.content, 'zusammengeführt in ' + keep.id, nowIso());
          this.db.run('UPDATE knowledge SET archived=1, merged_into=? WHERE id=?', keep.id, drop.id);
          this.db.run('UPDATE knowledge SET confidence=MIN(1, confidence+0.05) WHERE id=?', keep.id);
          seen.add(drop.id); merged++;
        }
      }
    }
    if (merged || archived) this.bus.emit('brain:changed', { action: 'maintenance' });
    return { merged, archived };
  }

  conflicts() {
    return this.db.all('SELECT * FROM knowledge WHERE conflict_with IS NOT NULL AND archived=0 ORDER BY updated_at DESC LIMIT 50').map((r) => ({ ...this.toPublic(r), other: this.toPublic(this.db.get('SELECT * FROM knowledge WHERE id=?', r.conflict_with)) }));
  }

  /** Personal context to prime the model — small & cheap (no search). */
  personalPrimer(limit = 12) {
    return this.db.all("SELECT title, content FROM knowledge WHERE archived=0 AND sensitive=0 AND (kind IN ('preference') OR pinned=1 OR domain='personal') ORDER BY pinned DESC, confidence DESC, updated_at DESC LIMIT ?", limit)
      .map((r) => '- ' + truncate(r.content, 200));
  }
}

module.exports = { Brain, DOMAINS, KINDS, ENTRY_SCHEMA };
