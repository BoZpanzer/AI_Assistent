'use strict';
const { CATEGORIES, STATUS } = require('./progress');

/**
 * No screenshot or model output is trusted as game state.
 * Candidates are ephemeral, game-scoped, and require explicit confirmation.
 * Never persists raw screenshots or exposes them to a remote device.
 */
class GameReview {
  constructor(gaming) {
    this.gaming = gaming;
    this.pending = new Map();
  }
  validate(game, entries) {
    if (!this.gaming.context.profile(game)) throw new Error('Unbekanntes Spiel');
    if (!Array.isArray(entries) || !entries.length || entries.length > 20) throw new Error('1 bis 20 Vorschläge erforderlich');
    return entries.map(e => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('Ungültiger Vorschlag');
      const { category, name, value = '', note = '', status = null } = e;
      if (!Object.hasOwn(CATEGORIES, category) || typeof name !== 'string' || !name.trim() || name.length > 120 ||
          typeof value !== 'string' || value.length > 300 || typeof note !== 'string' || note.length > 500 ||
          (status !== null && !Object.hasOwn(STATUS, status))) throw new Error('Ungültige Vorschlagsdaten');
      return { category, name: name.trim(), value, note, status };
    });
  }
  preview(game, entries) {
    const items = this.validate(game, entries);
    const changes = items.map(item => {
      const old = this.gaming.progress.find(game, item.category, item.name);
      return { item, previous: old ? this.gaming.progress.toPublic(old) : null,
        change: !old ? 'new' : old.value === item.value && (item.status === null || old.status === item.status) ? 'same' : 'changed' };
    });
    return { game, changes, requiresConfirmation: true };
  }
  stage(game, entries) {
    const preview = this.preview(game, entries);
    const token = require('node:crypto').randomUUID();
    this.purge();
    this.pending.set(token, { preview, expires: Date.now() + 10 * 60_000 });
    return { token, ...preview };
  }
  purge() { for (const [key, entry] of this.pending) if (entry.expires <= Date.now()) this.pending.delete(key); }
  confirm(token, acceptedIndices) {
    this.purge();
    const entry = this.pending.get(token);
    if (!entry) throw new Error('Vorschlag abgelaufen oder unbekannt');
    if (!Array.isArray(acceptedIndices) || !acceptedIndices.every(n => Number.isInteger(n) && n >= 0 && n < entry.preview.changes.length) ||
        new Set(acceptedIndices).size !== acceptedIndices.length) throw new Error('Ungültige Auswahl');
    this.pending.delete(token); // single use, even on error
    return acceptedIndices.map(n => {
      const { item } = entry.preview.changes[n];
      return this.gaming.progress.upsert(entry.preview.game, { ...item, status: item.status ?? undefined, source: 'manual' });
    });
  }
  reject(token) { return this.pending.delete(token); }
  memory(game) {
    if (!this.gaming.context.profile(game)) throw new Error('Unbekanntes Spiel');
    const items = this.gaming.progress.list(game);
    return { game, updatedAt: items.reduce((latest, x) => x.updatedAt > latest ? x.updatedAt : latest, ''),
      open: items.filter(x => x.status !== 'done').slice(0, 15),
      recentlyCompleted: items.filter(x => x.status === 'done').slice(0, 5),
      total: items.length, source: 'saved-progress', mayBeOutdated: true };
  }
}
module.exports = { GameReview };
