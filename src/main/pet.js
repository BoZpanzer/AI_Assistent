'use strict';
const { BrowserWindow, Menu, screen } = require('electron');

/**
 * Desktop-Figur: durchsichtiger, klick-durchlässiger Streifen am unteren Bildschirmrand (über der Taskleiste),
 * in dem die JARVIS-Figur herumläuft und in Sprechblasen antwortet. Nur über Figur/Blase nimmt das Fenster
 * die Maus an (pet.mouse). Während ein Spiel läuft, verschwindet sie – dann wohnt sie im Overlay.
 */
const HEIGHT = 470;

class Pet {
  constructor({ core, preload, isDev, showWindow, startVoice }) {
    this.core = core; this.preload = preload; this.isDev = isDev; this.showWindow = showWindow; this.startVoice = startVoice;
    this.win = null; this.visible = false;
    core.bus.on('game:running', () => this.refresh());
    core.bus.on('settings:changed', ({ keys }) => { if (keys.includes('pet') || keys.includes('setupComplete')) this.refresh(); });
    screen.on('display-metrics-changed', () => this.applyBounds());
    screen.on('display-added', () => this.applyBounds());
    screen.on('display-removed', () => this.applyBounds());
  }

  cfg() { return this.core.settings.get('pet') || {}; }
  shouldShow() {
    if (this.cfg().enabled === false || !this.core.settings.get('setupComplete')) return false;
    return !this.core.gaming.context.state().gaming;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: 800, height: HEIGHT, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, title: 'JARVIS Figur',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, devTools: this.isDev },
    });
    this.win.setAlwaysOnTop(true, 'floating');
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadURL('app://jarvis/pet.html');
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.applyBounds();
    return this.win;
  }

  applyBounds() {
    if (!this.win || this.win.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    this.win.setBounds({ x: wa.x, y: wa.y + wa.height - HEIGHT, width: wa.width, height: HEIGHT });
  }

  refresh() {
    const show = this.shouldShow();
    if (show === this.visible) return;
    this.visible = show;
    if (show) { this.ensure(); this.applyBounds(); this.win.showInactive(); } else if (this.win && !this.win.isDestroyed()) { this.setMouse(false); this.win.hide(); }
  }

  /** Maus über Figur/Blase → Fenster nimmt Klicks an; sonst geht alles an die Fenster darunter. */
  setMouse(over) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setIgnoreMouseEvents(!over, { forward: true });
  }

  menu() {
    if (!this.win || this.win.isDestroyed()) return;
    const cfg = this.cfg();
    Menu.buildFromTemplate([
      { label: 'JARVIS öffnen', click: () => this.showWindow() },
      { label: 'Sprechen', click: () => this.startVoice?.() },
      { type: 'separator' },
      { label: 'Herumlaufen', type: 'checkbox', checked: cfg.walk !== false, click: (i) => this.core.settings.update({ pet: { walk: i.checked } }) },
      { label: 'Figur ausblenden', click: () => this.core.settings.update({ pet: { enabled: false } }) },
    ]).popup({ window: this.win });
  }

  send(type, data) { if (this.visible && this.win && !this.win.isDestroyed()) this.win.webContents.send('evt', { type, data }); }
  destroy() { try { this.win?.destroy(); } catch { /* ignore */ } }
}

module.exports = { Pet };
