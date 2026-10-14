'use strict';
const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

/**
 * In-Game-Overlay: rahmenloses, transparentes Fenster, immer im Vordergrund,
 * standardmäßig klick-durchlässig (Maus geht ans Spiel). Per Hotkey
 * einblendbar und kurzzeitig bedienbar. Funktioniert über Spielen im
 * Modus „Randloses Fenster“ (nicht über exklusivem Vollbild – Windows-Grenze).
 */
class Overlay {
  constructor({ core, preload, isDev }) {
    this.core = core; this.preload = preload; this.isDev = isDev;
    this.win = null; this.visible = false; this.interactive = false; this.manual = null; // null = auto
    core.bus.on('game:context', () => this.refresh());
    core.bus.on('game:running', () => { this.applyBounds(); this.refresh(); });
    core.bus.on('settings:changed', ({ keys }) => { if (keys.includes('overlay')) { this.applyBounds(); this.refresh(); } });
    // Antworten auf Overlay-Fragen und Champion-Auswahl kurz sichtbar machen, auch im Auto-Modus
    core.bus.on('overlay:thinking', () => this.flash());
    core.bus.on('overlay:answer', () => this.flash(25000));
    core.bus.on('lol:champselect', (d) => { if (d?.active) this.flash(60000); });
    core.bus.on('lol:review', () => this.flash(30000));
  }

  cfg() { return this.core.settings.get('overlay') || {}; }

  shouldShow() {
    const c = this.cfg();
    if (this.manual !== null) return this.manual;
    if (c.mode === 'off') return false;
    if (c.mode === 'always') return true;
    const st = this.core.gaming.context.state();
    return !!(st.gaming || (this.flashUntil && Date.now() < this.flashUntil));
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: 380, height: 600, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, title: 'JARVIS Overlay',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: true, devTools: this.isDev },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadURL('app://jarvis/overlay.html');
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.applyBounds();
    return this.win;
  }

  applyBounds() {
    if (!this.win || this.win.isDestroyed()) return;
    const c = this.cfg();
    const d = screen.getPrimaryDisplay().workArea;
    const scale = c.scale || 1;
    const w = Math.round(380 * scale); const h = Math.min(d.height - 40, Math.round(760 * scale));
    const x = c.position === 'left' ? d.x + 16 : d.x + d.width - w - 16;
    // Links unter die Tarkov-Eck-Karte rutschen, damit sich beide nicht überdecken
    const below = c.position === 'left' && c.mapCorner !== false && this.core.gaming.context.running.includes('eft') ? Math.round(Math.max(200, Math.min(600, c.mapSize || 320))) + 40 : 60;
    this.win.setBounds({ x, y: d.y + below, width: w, height: Math.min(h, d.height - below - 10) });
    this.win.setOpacity(Math.max(0.4, Math.min(1, c.opacity ?? 0.95)));
  }

  refresh() {
    const show = this.shouldShow();
    if (show === this.visible) return;
    this.visible = show;
    if (show) { this.ensure(); this.win.showInactive(); } else if (this.win && !this.win.isDestroyed()) { this.setInteractive(false); this.win.hide(); }
    this.send('overlay:visible', { visible: show });
    this.core.bus.emit('overlay:visible', { visible: show });
  }

  flash(ms = 15000) {
    if (this.cfg().mode === 'off' && this.manual !== true) return;
    this.flashUntil = Date.now() + ms;
    this.refresh();
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.refresh(), ms + 100);
  }

  toggle() {
    this.manual = this.visible ? false : true;
    this.refresh();
    this.core.bus.emit('overlay:toggled', { manual: this.manual });
    // Nach manuellem Ausblenden kehrt der Auto-Modus beim nächsten Spielwechsel zurück
    if (!this.manual) setTimeout(() => { this.manual = null; }, 1000);
  }

  setInteractive(on) {
    if (!this.win || this.win.isDestroyed()) return;
    this.interactive = !!on;
    this.win.setIgnoreMouseEvents(!on, { forward: true });
    this.win.setFocusable(!!on);
    if (on) { this.win.focus(); clearTimeout(this.interactTimer); this.interactTimer = setTimeout(() => this.setInteractive(false), 20000); }
    this.send('overlay:interactive', { interactive: this.interactive });
  }

  toggleInteractive() { if (!this.visible) { this.manual = true; this.refresh(); } this.setInteractive(!this.interactive); }

  send(type, data) { if (this.win && !this.win.isDestroyed()) this.win.webContents.send('evt', { type, data }); }

  destroy() { try { this.win?.destroy(); } catch { /* ignore */ } }
}

/**
 * Eck-Karte für Tarkov: kleines, klick-durchlässiges Fenster oben links mit der aktuellen Raid-Karte,
 * Exits (PMC/Scav), Transits, eigenen Markern und deiner Position (aus Screenshots). Nur Anzeige.
 * Sichtbar, solange Tarkov läuft (und das Overlay nicht ausgeschaltet ist).
 */
class MapCorner {
  constructor({ core, preload, isDev, overlay }) {
    this.core = core; this.preload = preload; this.isDev = isDev; this.overlay = overlay;
    this.win = null; this.visible = false;
    this.hiddenByUser = false;
    core.bus.on('game:running', ({ stopped = [] } = {}) => { if (stopped.includes('eft')) this.hiddenByUser = false; this.refresh(); });
    core.bus.on('game:context', () => this.refresh());
    core.bus.on('overlay:toggled', ({ manual }) => { this.hiddenByUser = manual === false; this.refresh(); });
    core.bus.on('settings:changed', ({ keys }) => { if (keys.includes('overlay')) { this.applyBounds(); this.refresh(); } });
  }
  cfg() { return this.core.settings.get('overlay') || {}; }
  shouldShow() {
    const c = this.cfg();
    if (c.mode === 'off' || c.mapCorner === false) return false;
    if (this.hiddenByUser) return false; // Overlay per Hotkey ausgeblendet → Karte auch
    return this.core.gaming.context.running.includes('eft') || (c.mode === 'always' && this.core.gaming.context.state().active?.id === 'eft');
  }
  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: 320, height: 320, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, title: 'JARVIS Karte',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: true, devTools: this.isDev },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setIgnoreMouseEvents(true, { forward: false });
    this.win.loadURL('app://jarvis/overlay.html?view=map');
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.applyBounds();
    return this.win;
  }
  applyBounds() {
    if (!this.win || this.win.isDestroyed()) return;
    const c = this.cfg();
    const d = screen.getPrimaryDisplay().bounds; // ganz oben links, auch über der Taskleiste/Spiel
    const size = Math.round(Math.max(200, Math.min(600, c.mapSize || 320)));
    this.win.setBounds({ x: d.x + 12, y: d.y + 12, width: size, height: size + 22 });
    this.win.setOpacity(Math.max(0.4, Math.min(1, c.opacity ?? 0.95)));
  }
  refresh() {
    const show = this.shouldShow();
    if (show === this.visible) return;
    this.visible = show;
    if (show) { this.ensure(); this.win.showInactive(); } else if (this.win && !this.win.isDestroyed()) this.win.hide();
  }
  send(type, data) { if (this.visible && this.win && !this.win.isDestroyed()) this.win.webContents.send('evt', { type, data }); }
  destroy() { try { this.win?.destroy(); } catch { /* ignore */ } }
}

module.exports = { Overlay, MapCorner };
