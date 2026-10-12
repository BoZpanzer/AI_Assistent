'use strict';
const { id, nowIso, safeJson, truncate } = require('../core/util');

/** Persistent conversations shared by text chat, dashboard and voice. */
class Conversations {
  constructor(ctx) { this.db = ctx.db; this.bus = ctx.bus; }

  create(title = 'Neues Gespräch') {
    const cid = id('c'); const now = nowIso();
    this.db.run('INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)', cid, title, now, now);
    this.bus.emit('conversations:changed', {});
    return this.get(cid);
  }
  get(cid) {
    const r = this.db.get('SELECT * FROM conversations WHERE id=?', cid);
    return r ? { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, archived: !!r.archived } : null;
  }
  /** The conversation the dashboard / voice use: most recent, or a new one. */
  current() {
    const r = this.db.get('SELECT id FROM conversations WHERE archived=0 ORDER BY updated_at DESC LIMIT 1');
    return r ? this.get(r.id) : this.create();
  }
  list({ q, limit = 100 } = {}) {
    if (q) {
      const fts = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
      return this.db.all(`SELECT DISTINCT c.*, snippet(messages_fts, 0, '‹', '›', '…', 12) snip FROM messages_fts f JOIN messages m ON m.rowid=f.rowid
        JOIN conversations c ON c.id=m.conversation_id WHERE messages_fts MATCH ? GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ?`, fts, limit)
        .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, snippet: r.snip }));
    }
    return this.db.all(`SELECT c.*, (SELECT content FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) last,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) n FROM conversations c WHERE archived=0 ORDER BY updated_at DESC LIMIT ?`, limit)
      .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, preview: truncate(r.last || '', 90), messages: r.n }));
  }
  rename(cid, title) { this.db.run('UPDATE conversations SET title=? WHERE id=?', String(title).slice(0, 120), cid); this.bus.emit('conversations:changed', {}); }
  remove(cid) { this.db.run('DELETE FROM conversations WHERE id=?', cid); this.bus.emit('conversations:changed', {}); }

  add(cid, { role, content, meta = {}, channel = 'text' }) {
    const mid = id('m'); const now = nowIso();
    this.db.run('INSERT INTO messages(id,conversation_id,role,content,meta,channel,created_at) VALUES(?,?,?,?,?,?,?)', mid, cid, role, content || '', JSON.stringify(meta), channel, now);
    this.db.run('UPDATE conversations SET updated_at=? WHERE id=?', now, cid);
    const msg = { id: mid, conversationId: cid, role, content: content || '', meta, channel, createdAt: now };
    this.bus.emit('message', msg);
    return msg;
  }
  update(mid, { content, meta }) {
    const r = this.db.get('SELECT * FROM messages WHERE id=?', mid);
    if (!r) return null;
    const m = meta ? { ...safeJson(r.meta, {}), ...meta } : safeJson(r.meta, {});
    this.db.run('UPDATE messages SET content=?, meta=? WHERE id=?', content ?? r.content, JSON.stringify(m), mid);
    const msg = { id: mid, conversationId: r.conversation_id, role: r.role, content: content ?? r.content, meta: m, channel: r.channel, createdAt: r.created_at };
    this.bus.emit('message:update', msg);
    return msg;
  }
  messages(cid, { limit = 200, before } = {}) {
    const rows = before
      ? this.db.all('SELECT * FROM messages WHERE conversation_id=? AND created_at<? ORDER BY created_at DESC LIMIT ?', cid, before, limit)
      : this.db.all('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?', cid, limit);
    return rows.reverse().map((r) => ({ id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, meta: safeJson(r.meta, {}), channel: r.channel, createdAt: r.created_at }));
  }
  /** Model history: last N user/assistant text turns (tool details omitted). */
  history(cid, maxTurns = 16, maxChars = 24000) {
    const rows = this.messages(cid, { limit: maxTurns * 2 }).filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content);
    const out = []; let size = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const m = rows[i];
      size += m.content.length;
      if (size > maxChars && out.length) break;
      out.unshift({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
  }
  autoTitle(cid, text) {
    const c = this.get(cid);
    if (c && c.title === 'Neues Gespräch') this.rename(cid, truncate(text.replace(/\s+/g, ' ').trim(), 48));
  }
  exportMarkdown(cid) {
    const c = this.get(cid);
    const lines = [`# ${c?.title || 'Gespräch'}`, ''];
    for (const m of this.messages(cid, { limit: 5000 })) {
      if (m.role === 'tool' || m.role === 'system') continue;
      lines.push(`**${m.role === 'user' ? 'Du' : 'JARVIS'}** · ${new Date(m.createdAt).toLocaleString('de-DE')}`, '', m.content, '');
      if (m.meta?.sources?.length) lines.push('Quellen: ' + m.meta.sources.map((s) => `[${s.title}](${s.url || ''})`).join(', '), '');
    }
    return lines.join('\n');
  }
}

module.exports = { Conversations };
