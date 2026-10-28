'use strict';
const log = require('../core/logger').scope('cloud-tts');

/**
 * Stimme beim Zocken: Google Cloud Text-to-Speech (Chirp 3 HD) – rechnet auf Googles Servern, der PC bleibt frei fürs Spiel.
 * - Kostenlos bis 1 Mio. Zeichen pro Monat (Chirp 3 HD), danach 30 $ pro 1 Mio. Zeichen (Stand Okt. 2026,
 *   cloud.google.com/text-to-speech/pricing). JARVIS zählt selbst mit: bis `monthlyChars` (Standard 950 000, etwas Puffer)
 *   gratis; darüber – nur mit `payBeyondFree` – zählt jeder Satz mit seinem Preis ins gemeinsame Cloud-Budget (CostGuard,
 *   zusammen mit Gemini). Ist das Budget erreicht, bleibt JARVIS stumm (Antwort im Overlay/Chat).
 *   Bereits gesprochene Sätze kommen aus dem Cache (kostet nichts).
 * - Nie für private Antworten: die kommen beim Zocken nur als Text ins Overlay (siehe Orchestrator).
 * - Schlüssel: eigener Google-Cloud-Schlüssel (google.tts_api_key), sonst der Gemini-Schlüssel, falls dort die
 *   Text-to-Speech-API freigeschaltet ist.
 */
const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const FREE_CHARS = 1_000_000;
const DEFAULT_LIMIT = 950_000;
const USD_PER_CHAR = 30 / 1_000_000; // Chirp 3 HD über dem Gratis-Kontingent
const VOICES = Object.freeze({ standard: 'de-DE-Chirp3-HD-Achird', jarvis: 'de-DE-Chirp3-HD-Charon', alya: 'de-DE-Chirp3-HD-Leda' });

class CloudTts {
  constructor(s) { this.s = s; this.pausedUntil = 0; this.lastError = ''; }
  cfg() { return { whileGaming: 'cloud', monthlyChars: DEFAULT_LIMIT, payBeyondFree: true, voices: {}, ...(this.s.settings.get('voice')?.tts?.cloud || {}) }; }
  /** Was beim Zocken spricht: 'cloud' (Google) oder 'omnivoice' (lokal, braucht die Grafikkarte). */
  gamingMode() { return this.cfg().whileGaming === 'omnivoice' ? 'omnivoice' : 'cloud'; }
  key() { return this.s.secrets.get('google.tts_api_key') || this.s.secrets.get('gemini.api_key') || ''; }
  ownKey() { return !!this.s.secrets.get('google.tts_api_key'); }
  limit() { return Math.min(FREE_CHARS, Math.max(0, Number(this.cfg().monthlyChars) || DEFAULT_LIMIT)); }
  month() { return require('../services/costguard').localDay().slice(0, 7); }
  used() { return Number(this.s.db.get('SELECT value FROM meta WHERE key=?', 'cloudtts:chars:' + this.month())?.value || 0); }
  add(n) { this.s.db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'cloudtts:chars:' + this.month(), String(this.used() + n)); }
  voiceFor(preset) { const v = (this.cfg().voices || {})[preset]; return /^[a-z]{2}-[A-Z]{2}-[\w-]+$/.test(v || '') ? v : VOICES[preset] || VOICES.standard; }

  available(chars = 0) {
    if (!this.key() || this.pausedUntil > Date.now()) return false;
    if ((this.s.settings.get('cloud') || {}).mode === 'local') return false;
    if (require('../core/privacy').isPrivate()) return false;
    if (this.used() + chars <= this.limit()) return true;
    // Über dem Gratis-Kontingent: nur mit Freigabe und solange das gemeinsame Cloud-Budget (Gemini + Google-Stimme) reicht
    return this.cfg().payBeyondFree !== false && !!this.s.costGuard && !this.s.costGuard.exceeded();
  }
  /** Kosten (USD) für die Zeichen über dem Gratis-Kontingent. */
  billableUsd(chars) {
    const over = Math.max(0, this.used() + chars - this.limit()) - Math.max(0, this.used() - this.limit());
    return over * USD_PER_CHAR;
  }

  /** Satz → WAV (24 kHz, 16 bit). */
  async synthesize(text, { preset = 'standard', speed = 1 } = {}) {
    const t = String(text || '').trim();
    if (!t) throw new Error('Kein Text');
    if (!this.available(t.length)) {
      const why = !this.key() ? 'Kein Google-Schlüssel für die Google-Stimme hinterlegt (Einstellungen → Stimme → „Google-Cloud-Schlüssel“).'
        : this.used() + t.length > this.limit() ? (this.cfg().payBeyondFree === false ? 'Gratis-Kontingent der Google-Stimme für diesen Monat aufgebraucht – ab dem 1. geht es weiter.' : 'Cloud-Budget erreicht (Gemini + Google-Stimme) – die Google-Stimme ist bis zum Budget-Neustart aus. Grenze: Einstellungen → Gemini / KI.')
          : (this.s.settings.get('cloud') || {}).mode === 'local' ? 'Strikt lokaler Modus ist an – die Google-Stimme ist dann aus (Einstellungen → Gemini / KI → Modus).'
            : this.pausedUntil > Date.now() ? (this.lastError || 'Google-Stimme kurz pausiert nach einem Fehler – gleich nochmal versuchen.') : 'Google-Stimme ist für private Inhalte gesperrt.';
      throw new Error(why);
    }
    const name = this.voiceFor(preset);
    // Über dem Gratis-Kontingent: Kosten vorher im gemeinsamen Budget reservieren (wirft bei erreichter Grenze)
    const usd = this.billableUsd(t.length);
    const ledger = usd > 0 ? this.s.costGuard.reserve({ feature: 'tts', model: 'chirp3-hd', estUsd: usd }) : null;
    try { const r = await this.call(name, t, speed); if (ledger) this.s.costGuard.settle(ledger); return r; }
    catch (e) { if (ledger) this.s.costGuard.settle(ledger, { status: 'failed' }); throw e; }
  }

  async call(name, t, speed) {
    const res = await this.s.fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.key() },
      body: JSON.stringify({ input: { text: t }, voice: { languageCode: name.slice(0, 5), name }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: Math.max(0.75, Math.min(1.5, Number(speed) || 1)) } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const disabled = /SERVICE_DISABLED|has not been used|is disabled|API_KEY_SERVICE_BLOCKED|blocked/i.test(body);
      this.lastError = res.status === 403 && disabled ? 'Text-to-Speech-API ist für diesen Schlüssel nicht freigeschaltet (Google Cloud Console → „Cloud Text-to-Speech API“ aktivieren bzw. Schlüssel dafür freigeben).'
        : res.status === 403 || res.status === 401 ? 'Google hat den Schlüssel für die Cloud-Stimme abgelehnt.'
          : `Google-Stimme: HTTP ${res.status} ${body.slice(0, 160)}`;
      log.info(this.lastError);
      if ([401, 403].includes(res.status)) this.pausedUntil = Date.now() + 10 * 60_000; // nicht bei jedem Satz neu probieren
      if (res.status === 429) this.pausedUntil = Date.now() + 60_000;
      throw Object.assign(new Error(this.lastError), { status: res.status });
    }
    const j = await res.json();
    if (!j.audioContent) throw new Error('Google-Stimme: leere Antwort');
    this.add(t.length); this.lastError = '';
    const buf = Buffer.from(j.audioContent, 'base64');
    return buf.subarray(0, 4).toString() === 'RIFF' ? buf : wav(buf, 24000);
  }

  async test() {
    this.pausedUntil = 0;
    const r = await this.synthesize('Test.', { preset: this.s.settings.get('voice')?.tts?.preset || 'standard' });
    return { ok: true, bytes: r.length, ...this.status() };
  }

  status() {
    return { hasKey: !!this.key(), ownKey: this.ownKey(), whileGaming: this.gamingMode(), used: this.used(), limit: this.limit(), free: FREE_CHARS, payBeyondFree: this.cfg().payBeyondFree !== false, month: this.month(), lastError: this.lastError, voices: { ...VOICES, ...(this.cfg().voices || {}) } };
  }
}

/** Rohes PCM (16 bit mono) → WAV. */
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

module.exports = { CloudTts, VOICES, DEFAULT_LIMIT, FREE_CHARS };
