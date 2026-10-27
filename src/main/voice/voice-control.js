'use strict';
/**
 * Sprachsteuerung im Hauptprozess (ab 5.1 komplett lokal): Aufnahme und Erkennung laufen im Renderer bzw. über
 * whisper.cpp (voice.transcribeLocal), Antworten über die lokale Sprachausgabe. Hier nur noch der Zustand und
 * „Standby“ (Sprachbefehl/Werkzeug): Mikrofon aus, nur das Wake-Word „Hey Jarvis“ hört weiter.
 */
class VoiceControl {
  constructor(s) { this.s = s; this.state = 'off'; this.conversationId = null; }
  isOpen() { return false; }
  stop() { /* keine Cloud-Sitzung mehr */ }
  requestStandby({ reason = 'Befehl' } = {}) {
    const wakeEnabled = !!this.s.settings.get('voice')?.wakeWord;
    this.s.bus.emit('voice:standby', { pending: false, wakeEnabled, reason });
    return { ok: true, note: wakeEnabled ? 'Pausiert – „Hey Jarvis“ weckt mich wieder.' : 'Pausiert – zum Weitersprechen das Mikrofon drücken.' };
  }
}

module.exports = { VoiceControl };
