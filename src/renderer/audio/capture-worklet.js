/* Runs in an AudioContext created with sampleRate 16000 (Chromium resamples the
 * microphone). Emits 80 ms frames (1280 samples) of PCM16 plus an RMS level. */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(1280);
    this.n = 0;
    this.sum = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      this.sum += v * v;
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.buf.length) {
        const rms = Math.sqrt(this.sum / this.n);
        const out = this.buf;
        this.port.postMessage({ pcm: out, rms }, [out.buffer]);
        this.buf = new Int16Array(1280);
        this.n = 0; this.sum = 0;
      }
    }
    return true;
  }
}
registerProcessor('jarvis-capture', CaptureProcessor);
