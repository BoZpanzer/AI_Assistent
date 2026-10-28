'use strict';
/**
 * Vorlesen beginnt, während die Antwort noch entsteht: Der gestreamte Text wird in Sätze zerlegt und
 * satzweise an die Sprachausgabe gegeben (Ereignis „tts:stream“). Der erste Satz geht sofort raus,
 * danach werden kurze Sätze zu Blöcken gebündelt. „Kurz vorlesen“: nach ~420 Zeichen Schluss mit Hinweis.
 */
const END = /[.!?…](?=["“”')\]]*\s)|:\s*\n|\n\s*\n/g;

class SentenceStream {
  constructor({ emit, id, short = true, maxChars = 420, firstMin = 8, blockChars = 160 }) {
    Object.assign(this, { emit, id, short, maxChars, firstMin, blockChars });
    this.buf = ''; this.sent = 0; this.count = 0; this.stopped = false; this.code = false;
  }
  push(delta) {
    if (this.stopped || !delta) return;
    this.buf += delta;
    for (;;) {
      if ((this.buf.match(/```/g) || []).length % 2 === 1) return; // Codeblock noch offen → warten
      END.lastIndex = 0;
      const min = this.count === 0 ? this.firstMin : this.blockChars;
      let cut = -1; let m;
      while ((m = END.exec(this.buf))) {
        const at = m.index + m[0].length;
        if (this.buf.slice(0, at).trim().length >= min) { cut = at; break; }
      }
      if (cut < 0) return;
      this.out(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
      if (this.stopped) return;
    }
  }
  out(text) {
    const t = text.replace(/```[\s\S]*?```/g, ' ').trim();
    if (!t) return;
    if (this.short && this.sent + t.length > this.maxChars && this.count > 0) {
      this.stopped = true; this.truncated = true;
      this.emit({ id: this.id, text: 'Den Rest findest du im Chat.', done: false });
      return;
    }
    this.sent += t.length; this.count++;
    this.emit({ id: this.id, text: t, done: false });
  }
  end() {
    if (!this.stopped && this.buf.trim()) this.out(this.buf);
    this.buf = '';
    this.emit({ id: this.id, text: '', done: true });
  }
}

module.exports = { SentenceStream };
