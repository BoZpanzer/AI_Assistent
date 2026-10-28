'use strict';
/**
 * Sprachsteuerung im Hauptprozess (ab 5.1 komplett lokal): Aufnahme und Erkennung laufen im Renderer bzw. über
 * whisper.cpp (voice.transcribeLocal), Antworten über die lokale Sprachausgabe.
 *
 * Standby („geh in den Standby“, „schlaf“, Rechtsklick auf die Figur): Die Figur schläft, der Sprachmodus ist komplett aus
 * (keine Aufnahme, nichts wird vorgelesen). Nur „Hey Jarvis“ (startet einen neuen Chat) oder eine getippte Nachricht weckt JARVIS.
 */
class VoiceControl {
  constructor(s) { this.s = s; this.state = 'off'; this.conversationId = null; this.standby = false; }
  isOpen() { return false; }
  stop() { /* keine Cloud-Sitzung mehr */ }
  wakeEnabled() { return !!this.s.settings.get('voice')?.wakeWord; }
  requestStandby({ reason = 'Befehl' } = {}) {
    this.standby = true; this.state = 'standby';
    const wakeEnabled = this.wakeEnabled();
    this.s.bus.emit('voice:standby', { on: true, pending: false, wakeEnabled, reason });
    return { ok: true, note: wakeEnabled ? 'Standby – „Hey Jarvis“ weckt mich (mit neuem Chat), Tippen auch.' : 'Standby – das Wake-Word ist aus: Mikrofon-Knopf oder eine getippte Nachricht weckt mich.' };
  }
  /** Aus dem Standby holen (Wake-Word, getippte Nachricht, Mikrofon-Knopf, Menü). */
  wake(source = 'chat') {
    if (!this.standby) return false;
    this.standby = false; this.state = 'off';
    this.s.bus.emit('voice:standby', { on: false, source });
    return true;
  }
}

module.exports = { VoiceControl };
