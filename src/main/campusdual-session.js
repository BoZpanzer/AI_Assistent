'use strict';
const { BrowserWindow, session } = require('electron');

/**
 * Campus Dual (neues Portal fep.campus-dual.de) – Anmeldung in einem eigenen Fenster.
 * Du meldest dich dort selbst an; JARVIS sieht und speichert dein Passwort nicht.
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

  /** Anmeldefenster öffnen; löst mit true auf, sobald die Startseite nach dem Login erreicht ist. */
  function login() {
    api.lastReason = null;
    return new Promise((resolve) => {
      const w = new BrowserWindow({
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
      const onLoad = async () => {
        if (done || w.isDestroyed()) return;
        if (await isErrorPage()) {
          if (attempt < starts.length - 1) { attempt++; log.info('Campus Dual: Startadresse ' + attempt + ' nicht gefunden, nächste'); w.loadURL(starts[attempt]).catch(() => {}); return; }
          api.lastReason = 'notfound'; finish(false); return;
        }
        check();
      };
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

  const api = { login, fetch: fetchWithSession, loggedIn, logout, lastReason: null };
  return api;
}

module.exports = { createCampusDual };
