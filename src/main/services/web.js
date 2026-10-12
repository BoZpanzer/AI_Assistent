'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');
const { id, nowIso, sha256, truncate } = require('../core/util');
const { chunkPages } = require('./extract');

const MAX_BYTES = 3 * 1024 * 1024;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
}

/** Only public https URLs; DNS checked against private ranges (SSRF guard). */
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Ungültige URL'); }
  if (u.protocol !== 'https:') throw new Error('Nur https-Adressen sind erlaubt');
  if (u.username || u.password) throw new Error('URLs mit Zugangsdaten sind nicht erlaubt');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Lokale Adressen sind gesperrt');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Private Netzwerkadressen sind gesperrt');
  return u;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', euro: '€' };
function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|ul|ol|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<h([1-6])[^>]*>/gi, (m, n) => '\n' + '#'.repeat(+n) + ' ')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
  body = body.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : ' '; }
    return ENT[e] ?? ' ';
  });
  body = body.replace(/[ \t\f\v]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: body };
}

/**
 * Web research + persistent page storage with versioning.
 * Every fetched page is untrusted data: it is stored and quoted, never
 * executed or treated as instructions.
 */
class Web {
  constructor(ctx) { this.db = ctx.db; this.bus = ctx.bus; this.gemini = ctx.gemini; this.brain = ctx.brain; this.fetch = ctx.fetch; this.vectors = ctx.vectors; }

  async research(query, { game, save = true } = {}) {
    const r = await this.gemini.research(query);
    const rid = id('r');
    if (save) this.db.run('INSERT INTO research(id,query,answer,sources,game,created_at) VALUES(?,?,?,?,?,?)', rid, query, r.text, JSON.stringify(r.sources), game || null, nowIso());
    this.bus.emit('research:new', { id: rid, query });
    return { id: rid, query, answer: r.text, sources: r.sources, searchQueries: r.queries };
  }

  history({ game, limit = 20 } = {}) {
    const rows = game ? this.db.all('SELECT * FROM research WHERE game=? ORDER BY created_at DESC LIMIT ?', game, limit) : this.db.all('SELECT * FROM research ORDER BY created_at DESC LIMIT ?', limit);
    return rows.map((r) => ({ id: r.id, query: r.query, answer: r.answer, sources: JSON.parse(r.sources), game: r.game, createdAt: r.created_at }));
  }

  /** Save research result as Brain knowledge (sources domain). */
  saveResearchToBrain(researchId, { domain = 'sources', game } = {}) {
    const r = this.db.get('SELECT * FROM research WHERE id=?', researchId);
    if (!r) throw new Error('Recherche nicht gefunden');
    const sources = JSON.parse(r.sources);
    return this.brain.add({ kind: 'source', domain, title: truncate(r.query, 120), content: r.answer + (sources.length ? '\n\nQuellen:\n' + sources.map((s) => `- ${s.title}: ${s.url}`).join('\n') : ''),
      sourceType: 'web', sourceUrl: sources[0]?.url, game: game || r.game || undefined, confidence: 0.75,
      validUntil: new Date(Date.now() + 120 * 86400000).toISOString() });
  }

  async fetchUrl(url) {
    let u = await assertPublicUrl(url);
    let res;
    for (let hop = 0; hop < 4; hop++) {
      res = await this.fetch(u.toString(), { redirect: 'manual', headers: { 'User-Agent': 'JARVIS-Desktop/3 (+personal assistant)', Accept: 'text/html,text/plain,application/pdf;q=0.8' } });
      if ([301, 302, 303, 307, 308].includes(res.status)) { u = await assertPublicUrl(new URL(res.headers.get('location'), u).toString()); continue; }
      break;
    }
    if (!res.ok) throw new Error(`Seite antwortet mit ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new Error('Nicht unterstützter Inhaltstyp: ' + type.split(';')[0]);
    const reader = res.body.getReader(); const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { reader.cancel(); throw new Error('Seite zu groß'); }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const { title, text } = /html/.test(type) ? htmlToText(raw) : { title: u.hostname, text: raw };
    return { url: u.toString(), title: title || u.hostname, text: text.slice(0, 400000) };
  }

  /** Persist a web page as a versioned document (searchable in the Brain). */
  async savePage(url, { subject = 'Web', refresh = false } = {}) {
    const page = await this.fetchUrl(url);
    const hash = sha256(page.text);
    const now = nowIso();
    let doc = this.db.get("SELECT * FROM documents WHERE source='web' AND url=?", page.url);
    if (doc && doc.content_hash === hash) {
      this.db.run('UPDATE documents SET indexed_at=? WHERE id=?', now, doc.id);
      return { id: doc.id, title: doc.title, version: doc.version, unchanged: true };
    }
    const did = doc?.id || id('d');
    const version = doc ? doc.version + 1 : 1;
    this.db.tx(() => {
      if (!doc) {
        this.db.run(`INSERT INTO documents(id,source,path,rel_path,url,title,subject,ext,size,content_hash,page_count,version,status,indexed_at,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,1,1,'indexed',?,?)`, did, 'web', 'web:' + page.url, new URL(page.url).hostname + new URL(page.url).pathname, page.url, page.title, subject, 'html', page.text.length, hash, now, now);
      } else {
        this.db.run('UPDATE documents SET title=?, content_hash=?, version=?, indexed_at=?, size=? WHERE id=?', page.title, hash, version, now, page.text.length, did);
        for (const c of this.db.all('SELECT id FROM chunks WHERE doc_id=?', did)) this.db.run("DELETE FROM embeddings WHERE owner='c' AND owner_id=?", String(c.id));
        this.db.run('DELETE FROM chunks WHERE doc_id=?', did);
      }
      this.db.run('INSERT OR REPLACE INTO doc_versions(doc_id,version,content_hash,fetched_at,text) VALUES(?,?,?,?,?)', did, version, hash, now, page.text.slice(0, 200000));
      chunkPages([{ page: null, text: page.text }]).forEach((c, i) => this.db.run('INSERT INTO chunks(doc_id,page,ord,text,hash,origin) VALUES(?,?,?,?,?,?)', did, null, i, c.text, sha256(c.text), 'web'));
      if (refresh) this.db.run("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", 'webrefresh:' + did, '1');
    });
    this.vectors?.invalidate('c');
    this.bus.emit('brain:changed', { action: 'source' });
    return { id: did, title: page.title, version, url: page.url, changed: !!doc };
  }

  versions(docId) { return this.db.all('SELECT version, content_hash, fetched_at, length(text) chars FROM doc_versions WHERE doc_id=? ORDER BY version DESC', docId); }

  /** Re-fetch pages marked for refresh (weekly). Returns list of changed docs. */
  async refreshSaved() {
    const changed = [];
    for (const m of this.db.all("SELECT key FROM meta WHERE key LIKE 'webrefresh:%'")) {
      const did = m.key.slice(11);
      const d = this.db.get('SELECT * FROM documents WHERE id=?', did);
      if (!d) { this.db.run('DELETE FROM meta WHERE key=?', m.key); continue; }
      if (d.indexed_at && Date.now() - Date.parse(d.indexed_at) < 7 * 86400000) continue;
      try { const r = await this.savePage(d.url); if (!r.unchanged) changed.push(r); } catch { /* keep old version */ }
    }
    return changed;
  }
}

module.exports = { Web, htmlToText, assertPublicUrl, isPrivateIp };
