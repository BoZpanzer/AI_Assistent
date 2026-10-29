'use strict';
const { BrowserWindow, Menu, screen } = require('electron');
const log = require('./core/logger').scope('pet');

/**
 * Desktop-Figur: durchsichtiger, klick-durchlässiger Streifen am unteren Bildschirmrand (über der Taskleiste),
 * in dem die JARVIS-Figur herumläuft und in Sprechblasen antwortet. Nur über Figur/Blase nimmt das Fenster
 * die Maus an (pet.mouse). Während ein Spiel läuft, verschwindet sie – dann wohnt sie im Overlay.
 */
const HEIGHT = 640;

class Pet {
  constructor({ core, preload, isDev, showWindow, startVoice, uiShown = () => false, display = () => screen.getPrimaryDisplay() }) {
    this.core = core; this.preload = preload; this.isDev = isDev; this.showWindow = showWindow; this.startVoice = startVoice; this.uiShown = uiShown; this.display = display;
    this.win = null; this.visible = false;
    this.poll = null; this.lastCur = ''; this.tick = 0; this.mouse = false;
    core.bus.on('game:running', () => this.refresh());
    // Das Overlay liegt auf „screen-saver“-Höhe über allem – die Figur muss darüber bleiben, sonst kommt kein Klick bei ihr an
    core.bus.on('overlay:visible', () => this.raise());
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
      skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, title: 'JARVIS Figur', type: process.platform === 'win32' ? 'toolbar' : undefined, // toolbar: nie in Alt+Tab/Taskleiste, auch wenn sie kurz fokussierbar ist
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, devTools: this.isDev },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.on('unresponsive', () => { log.warn('Figurfenster reagiert nicht – wird neu aufgebaut'); this.recover(); });
    this.win.webContents.on('render-process-gone', (_e, d) => { log.warn('Figur-Renderer beendet: ' + d.reason); this.recover(); });
    this.win.setIgnoreMouseEvents(true);
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
    this.bounds = { x: wa.x, y: wa.y + wa.height - HEIGHT, width: wa.width, height: HEIGHT };
    this.win.setBounds(this.bounds);
  }

  refresh() {
    const show = this.shouldShow();
    if (show === this.visible) return;
    log.info(show ? 'Figur wird gezeigt' : 'Figur wird versteckt (Fenster offen, Spiel oder Vollbild)');
    this.visible = show;
    if (show) { this.ensure(); this.applyBounds(); this.mouse = false; this.win.setIgnoreMouseEvents(true); this.win.setFocusable(false); this.win.showInactive(); this.raise(); this.win.webContents.send('evt', { type: 'pet:shown', data: {} }); this.startPoll(); }
    else { this.stopPoll(); if (this.win && !this.win.isDestroyed()) { this.setMouse(false); this.win.hide(); } }
  }

  /**
   * Mauszeiger selbst abfragen statt sich auf weitergeleitete Mausereignisse zu verlassen: Unter Windows bleiben die bei
   * durchklickbaren Fenstern manchmal ganz aus (z. B. nach Verstecken/Zeigen oder Fokuswechsel) – dann war die Figur nicht mehr greifbar.
   * Alle 60 ms die Zeigerposition an die Figur melden (nur bei Änderung). Keine regelmäßigen Fenster-Umstellungen mehr: jedes
   * setIgnoreMouseEvents/moveTop zwingt Windows, das große durchsichtige Fenster neu zusammenzusetzen (Ruckler).
   * Ohne „forward“: kein systemweiter Maus-Hook – die Zeigerposition kommt ja aus dieser Abfrage.
   */
  startPoll() {
    if (this.poll) return;
    this.poll = setInterval(() => {
      if (!this.visible || !this.win || this.win.isDestroyed()) return;
      try {
        const p = screen.getCursorScreenPoint(); const b = this.bounds || this.win.getBounds();
        const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
        const key = inside ? p.x + ',' + p.y : 'out';
        if (key !== this.lastCur) { this.lastCur = key; this.win.webContents.send('evt', { type: 'pet:cursor', data: inside ? { x: p.x - b.x, y: p.y - b.y } : { x: -1, y: -1 } }); }
      } catch { /* ignore */ }
    }, 60);
  }
  /** Ganz nach oben, auch über das Overlay (gleiche Ebene, aber zuletzt nach vorn geholt). */
  raise() { if (this.visible && this.win && !this.win.isDestroyed()) { try { this.win.setAlwaysOnTop(true, 'screen-saver'); this.win.moveTop(); } catch { /* ignore */ } } }
  /** Figurfenster komplett neu aufbauen (Tray-Menü „Figur zurückholen“ oder wenn es abstürzt/hängt). */
  recover() {
    log.info('Figurfenster wird neu aufgebaut');
    this.stopPoll(); try { this.win?.destroy(); } catch { /* ignore */ }
    this.win = null; this.visible = false; this.mouse = false;
    this.refresh();
  }
  stopPoll() { clearInterval(this.poll); this.poll = null; this.lastCur = ''; }

  /** Maus über Figur/Blase → Fenster nimmt Klicks an; sonst geht alles an die Fenster darunter. */
  setMouse(over) {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.mouse === !!over) return; // nur bei echter Änderung umstellen (jede Umstellung kostet Windows einen Neuaufbau)
    this.mouse = !!over;
    this.win.setIgnoreMouseEvents(!over);
    // Windows liefert Linksklicks an nicht-fokussierbare Fenster nicht zuverlässig aus (Rechtsklick schon) – darum ist die Figur
    // fokussierbar, solange die Maus über ihr ist (wie das Overlay im Bedienmodus). Sonst stiehlt sie keinem Programm den Fokus.
    try { this.win.setFocusable(this.mouse); } catch { /* ignore */ }
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
