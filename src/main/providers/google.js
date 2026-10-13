'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const log = require('../core/logger').scope('google');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL = 'https://www.googleapis.com/calendar/v3';
const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  driveWrite: 'https://www.googleapis.com/auth/drive',
  identity: 'openid email',
};

/**
 * Google OAuth 2.0 for installed apps (loopback redirect + PKCE + state)
 * and a small Calendar REST client. Tokens live only in the secret store.
 */
class GoogleClient {
  constructor(ctx) {
    this.secrets = ctx.secrets; this.settings = ctx.settings; this.fetch = ctx.fetch;
    this.openExternal = ctx.platform?.openExternal;
    this.access = null; // { token, exp }
  }

  isConnected() { return !!this.secrets.get('google.refresh_token'); }
  clientCreds() {
    const clientId = this.settings.get('google').clientId;
    const secret = this.secrets.get('google.client_secret');
    if (!clientId) throw new Error('Google OAuth-Client-ID fehlt (Einstellungen → Kalender & Google).');
    return { clientId, secret };
  }

  /** Interactive login. Resolves with granted scopes + account email. */
  async connect({ drive = false, timeoutMs = 5 * 60 * 1000 } = {}) {
    const { clientId, secret } = this.clientCreds();
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    // drive: true = nur lesen (Studium), 'write' = auch Dateien anlegen (Drive-Backup)
    const scope = [SCOPES.identity, SCOPES.calendar, drive ? SCOPES.drive : null, drive === 'write' ? SCOPES.driveWrite : null].filter(Boolean).join(' ');

    // Der Browser bekommt erst DANN „verbunden“ angezeigt, wenn der Token-Austausch wirklich geklappt hat.
    const page = (ok, title, text) => `<!doctype html><meta charset="utf-8"><title>JARVIS</title><body style="background:#06101c;color:#bfefff;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:560px;padding:24px;text-align:center"><div style="font-size:44px">${ok ? '✅' : '⚠️'}</div><h2 style="color:${ok ? '#34d399' : '#fbbf24'}">${title}</h2><p style="line-height:1.5">${text}</p><p style="color:#7fa3b5;font-size:13px">Du kannst dieses Fenster schließen und zu JARVIS zurückkehren.</p></div>`;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const tok = await new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/oauth2callback') { res.writeHead(404); res.end(); return; }
        const send = (ok, title, text) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); res.end(page(ok, title, text)); clearTimeout(timer); server.close(); };
        try {
          if (url.searchParams.get('error')) {
            const err = url.searchParams.get('error');
            const msg = err === 'access_denied' ? 'Zugriff wurde abgelehnt – oder dein Konto ist in der Google Console nicht als Testnutzer eingetragen.' : 'Google meldet: ' + err;
            send(false, 'Anmeldung abgebrochen', esc(msg)); return reject(new Error(msg));
          }
          if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) { send(false, 'Anmeldung fehlgeschlagen', 'Ungültige Antwort (state).'); return reject(new Error('Ungültige OAuth-Antwort (state)')); }
          const t = await this.exchange({ code: url.searchParams.get('code'), clientId, secret, verifier, redirectUri: `http://127.0.0.1:${server.address().port}/oauth2callback` });
          send(true, 'JARVIS ist mit Google verbunden', 'Deine Termine werden jetzt synchronisiert.');
          resolve(t);
        } catch (e) { send(false, 'Verbindung fehlgeschlagen', esc(e.message)); reject(e); }
      });
      const timer = setTimeout(() => { server.close(); reject(new Error('Zeitüberschreitung bei der Google-Anmeldung')); }, timeoutMs);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const u = new URL(AUTH_URL);
        u.search = new URLSearchParams({
          client_id: clientId, redirect_uri: `http://127.0.0.1:${port}/oauth2callback`, response_type: 'code', scope,
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
        }).toString();
        if (!this.openExternal) { reject(new Error('Kein Browser verfügbar')); return; }
        this.openExternal(u.toString());
      });
    });

    this.secrets.set('google.refresh_token', tok.refresh_token);
    this.access = { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 };
    let email = '';
    try {
      const payload = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1], 'base64url').toString());
      email = payload.email || '';
    } catch { /* ignore */ }
    const scopes = String(tok.scope || '').split(' ').filter(Boolean);
    this.settings.update({ google: { account: email, scopes } });
    log.info('Google verbunden: ' + scopes.join(', '));
    return { scopes, account: email };
  }

  /** Authorization code → tokens (with clear German errors). */
  async exchange({ code, clientId, secret, verifier, redirectUri }) {
    const body = new URLSearchParams({ code, client_id: clientId, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier });
    if (secret) body.set('client_secret', secret);
    const r = await this.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.refresh_token) {
      const why = String(tok.error_description || tok.error || (r.ok ? 'kein Refresh-Token erhalten' : 'HTTP ' + r.status));
      log.warn('Google-Token-Austausch fehlgeschlagen: ' + why);
      if (/client_secret is missing/i.test(why)) throw new Error('Google verlangt das Client-Secret. Erzeuge in der Google Console unter Clients → dein Client → „Secret hinzufügen“ ein neues und füge es in JARVIS ins Feld „Client-Secret“ ein.');
      if (/invalid_client|unauthorized|secret/i.test(why)) throw new Error('Google lehnt Client-ID oder Client-Secret ab (' + why + '). Beides muss zum selben Client vom Typ „Desktop-App“ gehören – Secret am besten neu erzeugen und einfügen.');
      if (/redirect_uri/i.test(why)) throw new Error('Falscher Client-Typ (' + why + '). Bitte einen Client vom Typ „Desktop-App“ verwenden.');
      throw new Error('Token-Austausch fehlgeschlagen: ' + why);
    }
    return tok;
  }

  disconnect() {
    const rt = this.secrets.get('google.refresh_token');
    this.secrets.delete('google.refresh_token');
    this.access = null;
    this.settings.update({ google: { account: '', scopes: [] } });
    if (rt) this.fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST' }).catch(() => {});
  }

  async token() {
    if (this.access && this.access.exp > Date.now()) return this.access.token;
    const rt = this.secrets.get('google.refresh_token');
    if (!rt) throw new Error('Google ist nicht verbunden');
    const { clientId, secret } = this.clientCreds();
    const body = new URLSearchParams({ client_id: clientId, refresh_token: rt, grant_type: 'refresh_token' });
    if (secret) body.set('client_secret', secret);
    const r = await this.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const tok = await r.json();
    if (!r.ok) {
      if (tok.error === 'invalid_grant') { this.secrets.delete('google.refresh_token'); throw new Error('Google-Anmeldung abgelaufen – bitte neu verbinden'); }
      throw new Error('Token-Aktualisierung fehlgeschlagen: ' + (tok.error || r.status));
    }
    this.access = { token: tok.access_token, exp: Date.now() + (tok.expires_in - 60) * 1000 };
    return this.access.token;
  }

  async api(method, path, { query, body } = {}, base = CAL) {
    const url = new URL(base + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this.fetch(url.toString(), {
        method, headers: { Authorization: 'Bearer ' + await this.token(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401 && attempt === 0) { this.access = null; continue; }
      if ((r.status === 429 || r.status >= 500) && attempt < 2) { await new Promise((s) => setTimeout(s, 800 * (attempt + 1) ** 2)); continue; }
      if (r.status === 204) return null;
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = new Error(`Google API ${r.status}: ${data.error?.message || 'Fehler'}`);
        e.status = r.status;
        throw e;
      }
      return data;
    }
    throw new Error('Google API nicht erreichbar');
  }

  listCalendars() { return this.api('GET', '/users/me/calendarList', { query: { minAccessRole: 'reader', maxResults: 250 } }); }

  async listEvents(calendarId, { timeMin, timeMax }) {
    const items = [];
    let pageToken;
    do {
      const d = await this.api('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, {
        query: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 2500, showDeleted: false, pageToken },
      });
      items.push(...(d.items || []));
      pageToken = d.nextPageToken;
    } while (pageToken && items.length < 10000);
    return items;
  }
  getEvent(calendarId, eventId) { return this.api('GET', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`); }
  insertEvent(calendarId, ev) { return this.api('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, { body: ev }); }
  patchEvent(calendarId, eventId, ev) { return this.api('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { body: ev }); }
  deleteEvent(calendarId, eventId) { return this.api('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`); }
}

module.exports = { GoogleClient, SCOPES };
