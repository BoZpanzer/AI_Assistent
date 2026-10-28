'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { id, nowIso } = require('../core/util');
const log = require('../core/logger').scope('screen');

/**
 * „Was ist das?“ – Bildschirmanalyse NUR auf ausdrückliche Anfrage (Hotkey, Chat-/Sprachbefehl) und nur,
 * während ein Spiel aktiv ist. Aufgenommen wird bevorzugt nur das Spielfenster (nicht der ganze Desktop mit
 * Chats/Benachrichtigungen). Screenshots werden standardmäßig NICHT gespeichert (Einstellung
 * „Screenshots behalten“); an Gemini geht nur das Bild der jeweiligen Frage.
 */
class ScreenVision {
  constructor(s) { this.s = s; this.dir = path.join(s.paths.data, 'screens'); }

  enabled() { return this.s.settings.get('screen')?.enabled !== false && !!this.s.platform.captureScreen; }

  keep() { return this.s.settings.get('screen')?.keepScreenshots === true; }
  /** Fenstertitel-Kandidaten des aktiven Spiels (Prozessname ohne .exe, Name, Kurzname). */
  windowHints() {
    const p = this.s.gaming.context.state().active?.profile;
    if (!p) return [];
    return [...(p.processes || []).map((x) => String(x).replace(/(_BE)?\.exe$/i, '')), p.name, p.short].filter(Boolean);
  }
  /** Capture the active game's window (fallback: display under the cursor) → JPEG. Kept only if enabled. */
  async capture() {
    if (!this.s.platform.captureScreen) throw new Error('Bildschirmaufnahme ist hier nicht verfügbar');
    const cfg = this.s.settings.get('screen') || {};
    if (cfg.enabled === false) throw new Error('Bildschirmanalyse ist in den Einstellungen deaktiviert');
    const shot = await this.s.platform.captureScreen({ windowHints: cfg.preferGameWindow === false ? [] : this.windowHints() }); // { data, width, height, scope }
    this.s.bus.emit('privacy:capture', { scope: shot.scope || 'screen', at: nowIso() });
    const sid = id('scr');
    let file = null;
    if (this.keep()) {
      fs.mkdirSync(this.dir, { recursive: true });
      file = path.join(this.dir, sid + '.jpg');
      fs.writeFileSync(file, shot.data);
      this.prune();
    }
    return { id: sid, file, data: shot.data, width: shot.width, height: shot.height, scope: shot.scope || 'screen' };
  }
  remember(shot, question, answer, game) {
    if (!this.keep() || !shot.file) return;
    this.s.db.run('INSERT INTO screenshots(id,file,question,answer,game,created_at) VALUES(?,?,?,?,?,?)', shot.id, shot.file, question || '', answer || '', game || null, nowIso());
  }

  prune(keep = 20) {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.jpg')).map((f) => ({ f, t: fs.statSync(path.join(this.dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const x of files.slice(keep)) { fs.rmSync(path.join(this.dir, x.f), { force: true }); this.s.db.run('DELETE FROM screenshots WHERE id=?', x.f.replace('.jpg', '')); }
    } catch (e) { log.debug('prune', e); }
  }

  /** Direct one-shot analysis (used by the look_at_screen tool, also in voice). */
  async ask(question) {
    const game = this.s.gaming.context.state();
    if (!game.active?.id) throw new Error('Bildschirmanalyse ist nur freigegeben, während ein Spiel aktiv ist (Datenschutz: der restliche Desktop bleibt privat).');
    const shot = await this.capture();
    const gname = game.active?.profile?.name;
    let progress = '';
    try { progress = gname ? this.s.gaming.progress.summary(game.active.id, gname, { maxChars: 900 }) : ''; } catch { /* ignore */ }
    const system = [
      'Du bist JARVIS und siehst einen Screenshot vom Bildschirm deines Nutzers. Antworte auf Deutsch, kurz und konkret (max. 6 Sätze).',
      gname ? `Er spielt gerade ${gname}. Erkenne Items, Gegner, Kreaturen, Menüs, Timer usw. im Spielkontext.` : 'Beschreibe, was relevant ist, und hilf bei der Frage.',
      'Lies Zahlen, Namen und Restzeiten (z. B. Bau-/Forschungstimer) exakt ab und nenne sie. Wenn etwas nicht eindeutig erkennbar ist, sag das ehrlich statt zu raten.',
      progress,
    ].filter(Boolean).join('\n');
    const answer = await this.s.gemini.generate({ feature: 'vision',
      model: this.s.gemini.requireModel('vision'), system, temperature: 0.2,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: shot.data.toString('base64') } }, { text: question || 'Was sehe ich hier?' }] }],
    });
    this.remember(shot, question, answer, game.active?.id);
    return { screenshotId: shot.id, answer, game: gname || null, scope: shot.scope };
  }

  /** Gaming-Chat für das aktive Spiel (wird einmal angelegt und wiederverwendet). */
  gamingConversation(game) {
    const title = 'Gaming · ' + (game.profile?.name || game.id);
    const hit = this.s.db.get("SELECT id FROM conversations WHERE privacy='gaming' AND title=? AND archived=0 ORDER BY updated_at DESC LIMIT 1", title);
    return hit?.id || this.s.conversations.create(title, 'gaming').id;
  }

  /** Hotkey flow: screenshot goes into the game's gaming chat (reviewed gaming tools only). */
  async hotkeyQuestion(question) {
    const ctx = this.s.gaming.context;
    const active = ctx.state().active;
    if (!active?.id) throw new Error('Bildschirmanalyse ist nur freigegeben, während ein Spiel aktiv ist (Datenschutz: der restliche Desktop bleibt privat).');
    // Tarkov: Ausschnitt um den Mauszeiger – zeigt der auf ein Item, kommen gleich Wert und „behalten?“ mit.
    // Dann wird NUR der Ausschnitt gesendet (weniger Daten, weniger Token).
    const tarkov = ctx.running.includes('eft') || active.id === 'eft';
    const crop = tarkov && this.s.platform.captureAroundCursor ? await this.s.platform.captureAroundCursor().catch(() => null) : null;
    const shot = crop ? { id: id('scr'), file: null, data: null, scope: 'crop' } : await this.capture();
    const q = question || this.s.settings.get('screen')?.defaultQuestion || 'Was sehe ich hier? Hilf mir kurz und konkret.';
    const shown = q;
    const profile = active.profile || null;
    const gameHint = !crop && profile ? require('./gaming/kits').screenHint(profile) : '';
    const hint = !crop ? (gameHint ? `(Spiel: ${profile.name}. ${gameHint})` : '') : '(Das Bild ist ein Ausschnitt um meinen Mauszeiger – das Ding in der Mitte meine ich. Ist dort ein Escape-from-Tarkov-Item, rufe tarkov_item_value mit dem Itemnamen auf und nenne kurz Flohmarkt, besten Händler, Wert pro Slot und ob ich es für Quests/Hideout behalten sollte. Sonst beantworte die Frage normal.)';
    this.s.bus.emit('overlay:thinking', { question: shown, think: require('../agent/mood').thinkPose(shown) });
    const images = crop ? [{ mimeType: 'image/jpeg', data: crop.data.toString('base64'), name: 'Mauszeiger' }] : [{ mimeType: 'image/jpeg', data: shot.data.toString('base64'), name: shot.scope === 'window' ? 'Spielfenster' : 'Bildschirm' }];
    const msg = await this.s.orchestrator.chat({ conversationId: this.gamingConversation(active), text: q, images, channel: 'overlay', hint, screen: true });
    this.remember(shot, shown, msg?.content || '', active.id);
    this.s.bus.emit('overlay:answer', { question: shown, answer: msg?.content || '', cards: msg?.meta?.cards || [], mood: require('../agent/mood').moodFor({ userText: shown, answer: msg?.content || '' }) });
    if (this.s.settings.get('overlay')?.speakAnswers) this.s.bus.emit('tts:speak', { text: String(msg?.content || '').replace(/[*#`|>_]/g, '').slice(0, 600) });
    return msg;
  }
}

module.exports = { ScreenVision };
