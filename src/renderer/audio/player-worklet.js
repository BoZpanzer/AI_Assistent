/* PCM16 player at 24 kHz with an instantly flushable queue (barge-in). */
class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.playing = false;
    this.frames = 0;
    this.sum = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'push') { this.queue.push(m.pcm); }
      else if (m.type === 'clear') { this.queue = []; this.offset = 0; }
    };
  }
  process(_in, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length) {
      const cur = this.queue[0];
      const take = Math.min(out.length - i, cur.length - this.offset);
      for (let k = 0; k < take; k++) { const v = cur[this.offset + k] / 32768; out[i + k] = v; this.sum += v * v; }
      i += take; this.offset += take;
      if (this.offset >= cur.length) { this.queue.shift(); this.offset = 0; }
    }
    for (; i < out.length; i++) out[i] = 0;
    const has = this.queue.length > 0;
    this.frames += out.length;
    if (this.frames >= 1200) { // ~50 ms
      this.port.postMessage({ type: 'level', rms: Math.sqrt(this.sum / this.frames), playing: has });
      this.frames = 0; this.sum = 0;
    }
    if (this.playing && !has) this.port.postMessage({ type: 'drained' });
    this.playing = has;
    return true;
  }
}
registerProcessor('jarvis-player', PlayerProcessor);
