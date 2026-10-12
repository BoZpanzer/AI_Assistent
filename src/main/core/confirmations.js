'use strict';
const crypto = require('node:crypto');

/**
 * Pending confirmations for side-effecting actions.
 * - Created only by the main process (never by the model).
 * - Single use: a token is consumed atomically before execution.
 * - Expire after `ttlMs` (default 3 minutes).
 */
class Confirmations {
  constructor(bus, ttlMs = 3 * 60 * 1000) {
    this.bus = bus; this.ttl = ttlMs;
    this.pending = new Map();
  }
  create({ tool, args, summary, details, conversationId, run }) {
    this.gc();
    const token = crypto.randomBytes(16).toString('hex');
    const item = { token, tool, args, summary, details: details || [], conversationId, createdAt: Date.now(), expiresAt: Date.now() + this.ttl, run };
    this.pending.set(token, item);
    const pub = this.public(item);
    this.bus?.emit('confirm:new', pub);
    return pub;
  }
  public(i) {
    return { token: i.token, tool: i.tool, summary: i.summary, details: i.details, conversationId: i.conversationId, expiresAt: new Date(i.expiresAt).toISOString() };
  }
  list() { this.gc(); return [...this.pending.values()].map((i) => this.public(i)); }
  gc() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expiresAt < now) { this.pending.delete(k); this.bus?.emit('confirm:expired', { token: k }); }
  }
  /** Consume and run. Throws on unknown/expired/used tokens. */
  async resolve(token, approve) {
    this.gc();
    const item = this.pending.get(token);
    if (!item) throw new Error('Diese Bestätigung ist abgelaufen oder wurde bereits verwendet.');
    this.pending.delete(token); // consume before running → no double execution
    if (!approve) {
      this.bus?.emit('confirm:resolved', { token, approved: false });
      return { approved: false, result: null };
    }
    try {
      const result = await item.run(item.args);
      this.bus?.emit('confirm:resolved', { token, approved: true, result });
      return { approved: true, result, item: this.public(item) };
    } catch (e) {
      this.bus?.emit('confirm:resolved', { token, approved: true, error: e.message });
      throw e;
    }
  }
}

module.exports = { Confirmations };
