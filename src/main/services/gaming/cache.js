'use strict';
const { nowIso } = require('../../core/util');

/** Versioned TTL cache for external game data (source + fetch time kept). */
class GameCache {
  constructor(db) { this.db = db; }
  get(key, { allowStale = false } = {}) {
    const r = this.db.get('SELECT * FROM game_cache WHERE key=?', key);
    if (!r) return null;
    const stale = r.expires_at < nowIso();
    if (stale && !allowStale) return null;
    return { value: JSON.parse(r.value), source: r.source, fetchedAt: r.fetched_at, stale };
  }
  set(key, value, source, ttlMs) {
    this.db.run('INSERT OR REPLACE INTO game_cache(key,value,source,fetched_at,expires_at) VALUES(?,?,?,?,?)', key, JSON.stringify(value), source, nowIso(), new Date(Date.now() + ttlMs).toISOString());
    return { value, source, fetchedAt: nowIso(), stale: false };
  }
  /** Fetch-through with stale fallback when offline. */
  async wrap(key, source, ttlMs, loader) {
    const hit = this.get(key);
    if (hit) return hit;
    try { return this.set(key, await loader(), source, ttlMs); } catch (e) {
      const old = this.get(key, { allowStale: true });
      if (old) return { ...old, offline: true, error: e.message };
      throw e;
    }
  }
}

module.exports = { GameCache };
