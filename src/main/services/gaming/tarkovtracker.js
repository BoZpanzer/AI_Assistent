'use strict';
const { normText, nowIso } = require('../../core/util');
const log = require('../../core/logger').scope('tarkovtracker');

/**
 * TarkovTracker-Synchronisation (offizielle API, persönlicher Token).
 * - Abruf: erledigte/fehlgeschlagene Quests + PMC-Level → „Mein Spielstand“
 *   (Quelle „api“). Task-IDs sind tarkov.dev-IDs → deutsche Namen.
 * - Rückweg: wenn der Nutzer in JARVIS eine Quest abhakt (Chat, Sprache,
 *   Checkbox) und der Token Schreibrechte hat, wird sie auch dort abgehakt.
 * Nur Lesen von Spielständen – keine Spielsteuerung, keine Spieldateien.
 */
const TOKEN_KEY = 'tarkovtracker.token';

function baseUrl(token) {
  // Neue Tokens (z. B. "PVP_0123…") laufen über die neue API, alte über tarkovtracker.io
  return /^(PVE|PVP|SZN)_[0-9a-f]{18}$/i.test(token || '') ? 'https://api.tarkovtracker.org' : 'https://tarkovtracker.io/api/v2';
}

class TarkovTracker {
  constructor(s) {
    this.s = s; this.status = { connected: false, lastSync: null, error: null, permissions: [], gameMode: null, displayName: null, level: null, counts: null };
    this.suppress = 0; // eigene Upserts beim Sync nicht zurückspiegeln
    s.bus.on('game:progress-item', (e) => { this.onLocalChange(e).catch((err) => log.warn('push', err)); });
    const st = s.gaming?.context?.getState?.('tarkovtracker:status');
    if (st) try { Object.assign(this.status, JSON.parse(st)); } catch { /* ignore */ }
  }

  token() { return this.s.secrets.get(TOKEN_KEY) || ''; }
  configured() { return !!this.token(); }

  async req(method, pathName, body, token = this.token()) {
    if (!token) throw new Error('Kein TarkovTracker-Token hinterlegt');
    const res = await this.s.fetch(baseUrl(token) + pathName, {
      method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) throw new Error('TarkovTracker hat den Token abgelehnt (ungültig oder fehlende Berechtigung)');
    if (res.status === 429) throw new Error('TarkovTracker: zu viele Anfragen – später erneut');
    if (!res.ok) throw new Error('TarkovTracker antwortet mit HTTP ' + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : {};
  }

  /** Validate token (optionally a new one, which is then stored). */
  async test(newToken) {
    const t = String(newToken || '').trim() || this.token();
    const r = await this.req('GET', '/token', null, t);
    const perms = r.permissions || [];
    if (newToken) this.s.secrets.set(TOKEN_KEY, t);
    this.setStatus({ connected: true, permissions: perms, gameMode: r.gameMode || null, error: null });
    return { ok: true, permissions: perms, canWrite: this.canWrite(perms), gameMode: r.gameMode || 'pvp' };
  }

  canWrite(perms = this.status.permissions) { return (perms || []).some((p) => /^W/i.test(p)); }
  tdMode() { return this.status.gameMode === 'pve' ? 'pve' : 'regular'; }

  setStatus(patch) {
    Object.assign(this.status, patch);
    try { this.s.gaming.context.setState('tarkovtracker:status', this.status); } catch { /* ignore */ }
    this.s.bus.emit('tarkovtracker:status', this.status);
  }

  async taskIndex() {
    const all = (await this.s.gaming.tarkov.tasks(this.tdMode())).value || [];
    const byId = new Map(all.map((t) => [t.id, t]));
    const byName = new Map(all.map((t) => [normText(t.name), t]));
    return { byId, byName };
  }

  /** Pull progress from TarkovTracker into JARVIS. */
  async sync() {
    if (!this.configured()) return { skipped: 'no-token' };
    try {
      const r = await this.req('GET', '/progress');
      const d = r.data || r;
      const { byId } = await this.taskIndex();
      const P = this.s.gaming.progress;
      const done = new Set(); const failed = new Set();
      for (const t of d.tasksProgress || []) {
        const q = byId.get(t.id);
        if (!q) continue;
        if (t.failed) failed.add(q.name); else if (t.complete && !t.invalid) done.add(q.name);
      }
      let added = 0; let removed = 0;
      this.suppress++;
      try {
        for (const name of done) { const x = P.upsert('eft', { category: 'quest', name, status: 'done', source: 'api' }); if (x.action !== 'unchanged') added++; }
        for (const name of failed) P.upsert('eft', { category: 'quest', name, status: 'failed', source: 'api' });
        // Von der API stammende Einträge, die dort nicht mehr erledigt sind (z. B. Wipe) → entfernen
        for (const it of P.list('eft', { category: 'quest' })) {
          if (it.source === 'api' && !done.has(it.name) && !failed.has(it.name)) { P.remove(it.id, { source: 'api' }); removed++; }
        }
        if (Number.isFinite(d.playerLevel)) P.upsert('eft', { category: 'character', name: 'PMC-Level', value: String(d.playerLevel), source: 'api' });
        if (d.pmcFaction) P.upsert('eft', { category: 'character', name: 'Fraktion', value: String(d.pmcFaction).toUpperCase(), source: 'api' });
      } finally { this.suppress--; }
      this.setStatus({ connected: true, lastSync: nowIso(), error: null, displayName: d.displayName || null, level: d.playerLevel ?? null, counts: { done: done.size, failed: failed.size } });
      log.info(`Sync: ${done.size} erledigt, ${added} neu, ${removed} entfernt`);
      return { done: done.size, failed: failed.size, added, removed, level: d.playerLevel ?? null };
    } catch (e) {
      this.setStatus({ error: e.message });
      throw e;
    }
  }

  /** Local quest change → push to TarkovTracker (only with write permission). */
  async onLocalChange(e) {
    if (this.suppress || e.source === 'api' || e.game !== 'eft' || e.category !== 'quest') return;
    if (!this.configured() || !this.canWrite() || this.s.settings.get('gaming').tarkovTrackerSync === false) return;
    const { byName } = await this.taskIndex();
    const q = byName.get(normText(e.name));
    if (!q) return;
    const state = e.status === 'done' ? 'completed' : e.status === 'failed' ? 'failed' : (e.action === 'removed' || e.status !== 'done') && e.previousStatus === 'done' ? 'uncompleted' : null;
    if (!state) return;
    await this.req('POST', '/progress/task/' + encodeURIComponent(q.id), { state });
    log.info(`Quest „${q.name}“ → ${state} an TarkovTracker übertragen`);
  }

  disconnect() { this.s.secrets.set(TOKEN_KEY, ''); this.setStatus({ connected: false, permissions: [], error: null, lastSync: null }); return true; }
}

module.exports = { TarkovTracker, baseUrl };
