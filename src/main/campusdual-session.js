'use strict';
const { BrowserWindow, session } = require('electron');

/**
 * Campus Dual (neues Portal fep.campus-dual.de) – Anmeldung in einem eigenen Fenster.
 * Standard: Du meldest dich dort selbst an; JARVIS sieht dein Passwort nicht.
 * Optional (Einstellungen): Benutzername + Passwort verschlüsselt (Windows-DPAPI) hinterlegen – dann meldet
 * JARVIS sich bei abgelaufener Sitzung unsichtbar selbst neu an. Ausgefüllt wird nur auf *.campus-dual.de,
 * höchstens ein Versuch pro Anmeldung (keine Sperre durch Wiederholungen bei falschem Passwort).
 * Die Sitzungs-Cookies liegen in einer eigenen Browser-Partition und werden zusätzlich
 * verschlüsselt (Windows-DPAPI) gesichert, damit ein Neustart von JARVIS die Anmeldung nicht verliert.
 * Läuft die Sitzung bei Campus Dual ab, meldet JARVIS das und du meldest dich neu an.
 */
const PARTITION = 'persist:campusdual';
// Startadressen des Fiori-Launchpads – die erste, die keine Fehlerseite liefert, wird genommen
const STARTS = [
  'https://fep.campus-dual.de/sap/bc/ui2/flp?sap-client=100&sap-language=DE',
  'https://fep.campus-dual.de/sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html?sap-client=100&sap-language=DE',
  'https://fep.campus-dual.de/fiori?sap-client=100',
];
const COOKIE_KEY = 'campusdual.cookies';
const SESSION_COOKIE = /^(MYSAPSSO2|SAP_SESSIONID_|SAPWP_active|sap-usercontext)/i;

function createCampusDual({ secrets, log, parent, settings }) {
  const ses = () => session.fromPartition(PARTITION);

  async function saveCookies() {
    try {
      const list = (await ses().cookies.get({})).filter((c) => /campus-dual\.de$/i.test(c.domain.replace(/^\./, '')));
      secrets.set(COOKIE_KEY, JSON.stringify(list.map(({ name, value, domain, path, secure, httpOnly, expirationDate, hostOnly }) => ({ name, value, domain, path, secure, httpOnly, expirationDate, hostOnly }))));
    } catch (e) { log.warn('Campus-Dual-Cookies nicht gesichert', e); }
  }

  /** Nach einem Neustart: gesicherte Cookies wieder einspielen (Sitzungs-Cookies sonst weg). */
  async function restoreCookies() {
    let list = [];
    try { list = JSON.parse(secrets.get(COOKIE_KEY) || '[]'); } catch { list = []; }
    for (const c of list) {
      const host = c.domain.replace(/^\./, '');
      try {
        await ses().cookies.set({ url: `https://${host}${c.path || '/'}`, name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly, ...(c.hostOnly ? {} : { domain: c.domain }), ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}) });
      } catch { /* abgelaufen/ungültig */ }
    }
  }
  const restored = restoreCookies();

  async function loggedIn() {
    await restored;
    const cookies = await ses().cookies.get({});
    return cookies.some((c) => /campus-dual\.de$/i.test(c.domain.replace(/^\./, '')) && SESSION_COOKIE.test(c.name));
  }

  const creds = () => ({ user: secrets.get('campusdual.user'), pass: secrets.get('campusdual.password') });
  const hasCreds = () => !!(creds().user && creds().pass);

  /**
   * Anmelden. interactive=false: unsichtbar mit gespeicherten Zugangsdaten (Hintergrund), sonst Fenster.
   * Löst mit true auf, sobald die Startseite nach dem Login erreicht ist.
   */
  function login({ interactive = true } = {}) {
    api.lastReason = null;
    if (!interactive && !hasCreds()) { api.lastReason = 'nocreds'; return Promise.resolve(false); }
    return new Promise((resolve) => {
      const w = new BrowserWindow({
        show: interactive && !hasCreds(),
        width: 1050, height: 780, parent: parent?.() || undefined, title: 'Bei Campus Dual anmelden – JARVIS', autoHideMenuBar: true, backgroundColor: '#ffffff',
        webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false },
      });
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', (e, url) => { if (!/^https:\/\//i.test(url)) e.preventDefault(); });
      let done = false;
      const finish = async (ok) => {
        if (done) return; done = true;
        if (ok) await saveCookies();
        if (!w.isDestroyed()) w.close();
        resolve(ok);
      };
      const check = async () => {
        if (done || w.isDestroyed()) return;
        const url = w.webContents.getURL();
        const onLaunchpad = /fep\.campus-dual\.de/i.test(url) && /(flp|FioriLaunchpad|#Shell-home|ui2\/ushell)/i.test(url) && !/login|logon|saml/i.test(url);
        if (onLaunchpad && await loggedIn()) setTimeout(() => finish(true), 1200);
      };
      // Eigene Startadresse (Einstellung) zuerst, dann die üblichen Launchpad-Adressen
      const custom = settings?.get('campusDualUrl');
      const starts = [...(custom && /^https:\/\/[\w.-]*campus-dual\.de\//i.test(custom) ? [custom] : []), ...STARTS];
      let attempt = 0;
      const isErrorPage = async () => {
        const title = w.webContents.getTitle() || '';
        if (/404|not found|nicht erreichbar|nicht gefunden/i.test(title)) return true;
        try { return await w.webContents.executeJavaScript("/404\\s*Not found|Service nicht erreichbar/i.test(document.body ? document.body.innerText.slice(0, 400) : '')", true); } catch { return false; }
      };
      let filled = 0;
      // Gespeicherte Zugangsdaten eintragen – nur auf campus-dual.de und nur einmal
      const autofill = async () => {
        const c = creds();
        if (!c.user || !c.pass || filled >= 1) return false;
        let host = ''; try { host = new URL(w.webContents.getURL()).hostname; } catch { /* ignore */ }
        if (!/(^|\.)campus-dual\.de$/i.test(host)) return false;
        const js = `(() => {
          const vis = (e) => e && e.offsetParent !== null && !e.disabled;
          const pw = [...document.querySelectorAll('input[type=password]')].find(vis);
          if (!pw) return 'nopw';
          const inputs = [...document.querySelectorAll('input')].filter((e) => vis(e) && /^(text|email|)$/i.test(e.type || 'text'));
          const before = inputs.filter((e) => e.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
          const user = before[before.length - 1] || inputs[0];
          if (!user) return 'nouser';
          const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
          set(user, ${JSON.stringify(c.user)}); set(pw, ${JSON.stringify(c.pass)});
          const form = pw.form;
          const btn = (form ? form : document).querySelector('button[type=submit], input[type=submit], #LOGON_BUTTON, [id*=logon i], [id*=login i][role=button], button');
          if (btn) btn.click(); else if (form) form.submit(); else pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          return 'ok';
        })()`;
        try {
          const r = await w.webContents.executeJavaScript(js, true);
          if (r === 'ok') { filled++; log.info('Campus Dual: Zugangsdaten eingetragen'); return true; }
        } catch (e) { log.debug('autofill', e); }
        return false;
      };
      const onLoad = async () => {
        if (done || w.isDestroyed()) return;
        if (await isErrorPage()) {
          if (attempt < starts.length - 1) { attempt++; log.info('Campus Dual: Startadresse ' + attempt + ' nicht gefunden, nächste'); w.loadURL(starts[attempt]).catch(() => {}); return; }
          api.lastReason = 'notfound'; finish(false); return;
        }
        if (hasCreds()) {
          const hasPw = await w.webContents.executeJavaScript("!!document.querySelector('input[type=password]')", true).catch(() => false);
          if (hasPw && filled >= 1) {
            // Nach dem Versuch wieder auf der Anmeldeseite → Daten falsch: nicht wiederholen (Kontosperre)
            api.lastReason = 'badcredentials';
            if (interactive) { if (!w.isVisible()) w.show(); } else { finish(false); return; }
          } else if (hasPw) await autofill();
        }
        check();
      };
      if (hasCreds()) {
        // Unsichtbarer Versuch; klappt er nicht, wird das Fenster gezeigt (oder im Hintergrund abgebrochen)
        setTimeout(() => { if (done || w.isDestroyed()) return; if (interactive) { if (!w.isVisible()) w.show(); } else { api.lastReason = api.lastReason || 'timeout'; finish(false); } }, 45000);
      }
      w.webContents.on('did-navigate', check);
      w.webContents.on('did-navigate-in-page', check);
      w.webContents.on('did-finish-load', onLoad);
      w.on('closed', () => { if (!done) { done = true; loggedIn().then((ok) => { if (ok) saveCookies(); resolve(ok); }); } });
      w.loadURL(starts[0]).catch((e) => { log.warn('Campus Dual nicht erreichbar', e); });
    });
  }

  /** Abruf mit der Campus-Dual-Sitzung (Cookies werden automatisch mitgeschickt). */
  async function fetchWithSession(url, init = {}) {
    await restored;
    if (!/^https:\/\/[\w.-]*campus-dual\.de\//i.test(url)) throw new Error('Nur Campus-Dual-Adressen');
    const r = await ses().fetch(url, { ...init, redirect: 'follow' });
    saveCookies(); // Sitzung ggf. verlängert
    return r;
  }

  async function logout() {
    secrets.delete(COOKIE_KEY);
    await ses().clearStorageData({ storages: ['cookies', 'localstorage', 'cachestorage'] });
  }

  const api = { login, fetch: fetchWithSession, loggedIn, logout, hasCreds, lastReason: null };
  return api;
}

module.exports = { createCampusDual };
