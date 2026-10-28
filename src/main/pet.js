'use strict';
const { BrowserWindow, Menu, screen } = require('electron');

/**
 * Desktop-Figur: durchsichtiger, klick-durchlässiger Streifen am unteren Bildschirmrand (über der Taskleiste),
 * in dem die JARVIS-Figur herumläuft und in Sprechblasen antwortet. Nur über Figur/Blase nimmt das Fenster
 * die Maus an (pet.mouse). Während ein Spiel läuft, verschwindet sie – dann wohnt sie im Overlay.
 */
const HEIGHT = 520;

class Pet {
  constructor({ core, preload, isDev, showWindow, startVoice, uiShown = () => false, display = () => screen.getPrimaryDisplay() }) {
    this.core = core; this.preload = preload; this.isDev = isDev; this.showWindow = showWindow; this.startVoice = startVoice; this.uiShown = uiShown; this.display = display;
    this.win = null; this.visible = false;
    this.poll = null; this.lastCur = ''; this.tick = 0;
    core.bus.on('game:running', () => this.refresh());
    core.bus.on('settings:changed', ({ keys }) => { if (keys.includes('pet') || keys.includes('setupComplete')) this.refresh(); });
    screen.on('display-metrics-changed', () => this.applyBounds());
    screen.on('display-added', () => this.applyBounds());
    screen.on('display-removed', () => this.applyBounds());
  }

  cfg() { return this.core.settings.get('pet') || {}; }
  shouldShow() {
    if (this.cfg().enabled === false || !this.core.settings.get('setupComplete')) return false;
    // Ist die Oberfläche offen, steht die Figur dort im Systemstatus; auf dem Desktop nur, solange das Fenster zu ist
    const st = this.core.gaming.context.state();
    // Bei Vollbild-Programmen (Video, Präsentation, Spiel) und beim Zocken verschwindet sie
    return !st.gaming && !st.fullscreen && !this.uiShown();
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
    // Auf dem Bildschirm, auf dem zuletzt das JARVIS-Fenster war (sonst Hauptbildschirm)
    let wa; try { wa = (this.display() || screen.getPrimaryDisplay()).workArea; } catch { wa = screen.getPrimaryDisplay().workArea; }
    this.win.setBounds({ x: wa.x, y: wa.y + wa.height - HEIGHT, width: wa.width, height: HEIGHT });
  }

  refresh() {
    const show = this.shouldShow();
    if (show === this.visible) return;
    this.visible = show;
    if (show) { this.ensure(); this.applyBounds(); this.win.setIgnoreMouseEvents(true, { forward: true }); this.win.showInactive(); this.win.webContents.send('evt', { type: 'pet:shown', data: {} }); this.startPoll(); }
    else { this.stopPoll(); if (this.win && !this.win.isDestroyed()) { this.setMouse(false); this.win.hide(); } }
  }

  /**
   * Mauszeiger selbst abfragen statt sich auf weitergeleitete Mausereignisse zu verlassen: Unter Windows bleiben die bei
   * durchklickbaren Fenstern manchmal ganz aus (z. B. nach Verstecken/Zeigen oder Fokuswechsel) – dann war die Figur nicht mehr greifbar.
   * Alle 50 ms die Zeigerposition an die Figur melden (nur bei Änderung) und das Fenster ab und zu wieder nach oben holen.
   */
  startPoll() {
    if (this.poll) return;
    this.poll = setInterval(() => {
      if (!this.visible || !this.win || this.win.isDestroyed()) return;
      try {
        const p = screen.getCursorScreenPoint(); const b = this.win.getBounds();
        const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
        const key = inside ? p.x + ',' + p.y : 'out';
        if (key !== this.lastCur) { this.lastCur = key; this.win.webContents.send('evt', { type: 'pet:cursor', data: inside ? { x: p.x - b.x, y: p.y - b.y } : { x: -1, y: -1 } }); }
        // andere „immer im Vordergrund“-Fenster (Taskleiste, Overlays) können sie sonst überdecken
        if (++this.tick % 100 === 0) { this.win.setAlwaysOnTop(true, 'floating'); this.win.moveTop(); }
      } catch { /* ignore */ }
    }, 50);
  }
  stopPoll() { clearInterval(this.poll); this.poll = null; this.lastCur = ''; }

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
      { label: 'Beim Start Fenster öffnen', type: 'checkbox', checked: cfg.uiAtStart === true, click: (i) => this.core.settings.update({ pet: { uiAtStart: i.checked } }) },
      { label: 'Sprechen', click: () => this.startVoice?.() },
      this.core.voice?.standby ? { label: 'Aufwecken', click: () => this.core.voice.wake('menu') } : { label: 'Standby (schlafen)', click: () => this.core.voice?.requestStandby({ reason: 'Menü' }) },
      { type: 'separator' },
      { label: 'Herumlaufen', type: 'checkbox', checked: cfg.walk !== false, click: (i) => this.core.settings.update({ pet: { walk: i.checked } }) },
      { label: 'Figur ausblenden', click: () => this.core.settings.update({ pet: { enabled: false } }) },
    ]).popup({ window: this.win });
  }

  /** Einstellungen/Standby kommen immer an (sonst zeigt sie nach dem Stimmwechsel die alte Figur); Blasen nur, solange sie sichtbar ist. */
  send(type, data) {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.visible || type === 'settings:changed' || type === 'voice:standby') this.win.webContents.send('evt', { type, data });
  }
  destroy() { this.stopPoll(); try { this.win?.destroy(); } catch { /* ignore */ } }
}

module.exports = { Pet };
