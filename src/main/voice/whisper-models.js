'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const log = require('../core/logger').scope('whisper');

/**
 * Genauere Spracherkennung zum Nachladen – nur auf ausdrücklichen Klick in den Einstellungen.
 * Mitgeliefert ist „base“ (klein, schnell, verhört sich bei leiser/undeutlicher Sprache öfter).
 */
const MODELS = Object.freeze([
  { id: 'small', label: 'Genauer (small)', file: 'ggml-small-q5_1.bin', sizeMB: 190, note: 'deutlich weniger Verhörer, kaum langsamer' },
  { id: 'turbo', label: 'Am genauesten (large-v3-turbo)', file: 'ggml-large-v3-turbo-q5_0.bin', sizeMB: 574, note: 'versteht auch Nuscheln/leise Sprache am besten, braucht 1–3 s länger' },
]);
const urlOf = (file) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;

class WhisperModels {
  constructor({ dir, settings, bus }) { this.dir = dir; this.settings = settings; this.bus = bus; this.busy = null; }
  file(m) { return path.join(this.dir, m.file); }
  status() {
    const cur = this.settings.get('voice')?.whisperModel || '';
    return { busy: this.busy, models: MODELS.map((m) => { let have = false; try { have = fs.statSync(this.file(m)).size > m.sizeMB * 1e6 * 0.9; } catch { /* fehlt */ } return { ...m, installed: have, active: have && cur === this.file(m) }; }), usingBundled: !cur };
  }
  use(id) {
    if (id === 'base') { this.settings.update({ voice: { whisperModel: '' } }); return this.status(); }
    const m = MODELS.find((x) => x.id === id); if (!m) throw new Error('Unbekanntes Modell');
    if (!this.status().models.find((x) => x.id === id).installed) throw new Error('Modell ist noch nicht heruntergeladen.');
    this.settings.update({ voice: { whisperModel: this.file(m) } });
    return this.status();
  }
  async download(id) {
    const m = MODELS.find((x) => x.id === id); if (!m) throw new Error('Unbekanntes Modell');
    if (this.busy) throw new Error('Es läuft schon ein Download.');
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file(m) + '.part';
    this.busy = id;
    try {
      await new Promise((resolve, reject) => {
        const get = (url, hops = 0) => https.get(url, { headers: { 'User-Agent': 'JARVIS' } }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) { res.resume(); return get(new URL(res.headers.location, url).toString(), hops + 1); }
          if (res.statusCode !== 200) { res.resume(); return reject(new Error('Download fehlgeschlagen (HTTP ' + res.statusCode + ').')); }
          const total = Number(res.headers['content-length']) || m.sizeMB * 1e6; let got = 0; let t = 0;
          const out = fs.createWriteStream(tmp);
          res.on('data', (c) => { got += c.length; const n = Date.now(); if (n - t > 400) { t = n; this.bus.emit('whisper:download', { id, pct: Math.min(99, Math.floor((got / total) * 100)) }); } });
          res.pipe(out);
          out.on('finish', resolve); out.on('error', reject); res.on('error', reject);
        }).on('error', (e) => reject(new Error('Download fehlgeschlagen: ' + e.message)));
        get(urlOf(m.file));
      });
      // Echte GGML-Datei? (Magie „ggml“ am Anfang, Größe plausibel)
      const fd = fs.openSync(tmp, 'r'); const head = Buffer.alloc(4); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
      if (head.readUInt32LE(0) !== 0x67676d6c || fs.statSync(tmp).size < m.sizeMB * 1e6 * 0.9) throw new Error('Die heruntergeladene Datei ist kein gültiges Whisper-Modell.');
      fs.renameSync(tmp, this.file(m));
      log.info('Whisper-Modell geladen: ' + m.file);
      this.settings.update({ voice: { whisperModel: this.file(m) } });
      this.bus.emit('whisper:download', { id, pct: 100, done: true });
      return this.status();
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } this.bus.emit('whisper:download', { id, error: e.message }); throw e; } finally { this.busy = null; }
  }
}
module.exports = { WhisperModels, WHISPER_MODELS: MODELS };
