'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { id, nowIso } = require('../core/util');
const log = require('../core/logger').scope('screen');

/**
 * „Was ist das?“ – Bildschirmanalyse NUR auf ausdrückliche Anfrage
 * (Hotkey, Chat-/Sprachbefehl). Screenshots bleiben lokal (die letzten 20),
 * an Gemini geht nur das eine Bild der jeweiligen Frage.
 */
class ScreenVision {
  constructor(s) { this.s = s; this.dir = path.join(s.paths.data, 'screens'); }

  enabled() { return this.s.settings.get('screen')?.enabled !== false && !!this.s.platform.captureScreen; }

  /** Capture the display under the mouse cursor → JPEG. */
  async capture() {
    if (!this.s.platform.captureScreen) throw new Error('Bildschirmaufnahme ist hier nicht verfügbar');
    if (this.s.settings.get('screen')?.enabled === false) throw new Error('Bildschirmanalyse ist in den Einstellungen deaktiviert');
    const shot = await this.s.platform.captureScreen(); // { data: Buffer(jpeg), width, height }
    fs.mkdirSync(this.dir, { recursive: true });
    const sid = id('scr');
    const file = path.join(this.dir, sid + '.jpg');
    fs.writeFileSync(file, shot.data);
    this.prune();
    return { id: sid, file, data: shot.data, width: shot.width, height: shot.height };
  }

  prune(keep = 20) {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.jpg')).map((f) => ({ f, t: fs.statSync(path.join(this.dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const x of files.slice(keep)) { fs.rmSync(path.join(this.dir, x.f), { force: true }); this.s.db.run('DELETE FROM screenshots WHERE id=?', x.f.replace('.jpg', '')); }
    } catch (e) { log.debug('prune', e); }
  }

  /** Direct one-shot analysis (used by the look_at_screen tool, also in voice). */
  async ask(question) {
    const shot = await this.capture();
    const game = this.s.gaming.context.state();
    const gname = game.active?.profile?.name;
    let progress = '';
    try { progress = gname ? this.s.gaming.progress.summary(game.active.id, gname, { maxChars: 900 }) : ''; } catch { /* ignore */ }
    const system = [
      'Du bist JARVIS und siehst einen Screenshot vom Bildschirm deines Nutzers. Antworte auf Deutsch, kurz und konkret (max. 6 Sätze).',
      gname ? `Er spielt gerade ${gname}. Erkenne Items, Gegner, Kreaturen, Menüs, Timer usw. im Spielkontext.` : 'Beschreibe, was relevant ist, und hilf bei der Frage.',
      'Lies Zahlen, Namen und Restzeiten (z. B. Bau-/Forschungstimer) exakt ab und nenne sie. Wenn etwas nicht eindeutig erkennbar ist, sag das ehrlich statt zu raten.',
      progress,
    ].filter(Boolean).join('\n');
    const answer = await this.s.gemini.generate({
      model: this.s.gemini.requireModel('vision'), system, temperature: 0.2,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: shot.data.toString('base64') } }, { text: question || 'Was sehe ich hier?' }] }],
    });
    this.s.db.run('INSERT INTO screenshots(id,file,question,answer,game,created_at) VALUES(?,?,?,?,?,?)', shot.id, shot.file, question || '', answer, game.active?.id || null, nowIso());
    return { screenshotId: shot.id, answer, game: gname || null };
  }

  /** Hotkey flow: screenshot goes into the normal chat (all tools available). */
  async hotkeyQuestion(question) {
    const shot = await this.capture();
    const q = question || this.s.settings.get('screen')?.defaultQuestion || 'Was sehe ich hier? Hilf mir kurz und konkret.';
    this.s.bus.emit('overlay:thinking', { question: q });
    const msg = await this.s.orchestrator.chat({ text: q, images: [{ mimeType: 'image/jpeg', data: shot.data.toString('base64'), name: 'Bildschirm' }], channel: 'overlay' });
    this.s.db.run('INSERT INTO screenshots(id,file,question,answer,game,created_at) VALUES(?,?,?,?,?,?)', shot.id, shot.file, q, msg?.content || '', this.s.gaming.context.state().active?.id || null, nowIso());
    this.s.bus.emit('overlay:answer', { question: q, answer: msg?.content || '', cards: msg?.meta?.cards || [] });
    if (this.s.settings.get('overlay')?.speakAnswers) this.s.bus.emit('tts:speak', { text: String(msg?.content || '').replace(/[*#`|>_]/g, '').slice(0, 600) });
    return msg;
  }
}

module.exports = { ScreenVision };
