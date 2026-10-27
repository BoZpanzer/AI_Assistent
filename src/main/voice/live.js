'use strict';
const { toGeminiSchema } = require('../core/validate');
const { friendlyError } = require('../providers/gemini');
const log = require('../core/logger').scope('voice');
const privacy = require('../core/privacy');

const YES = /\b(ja|jo|jep|klar|okay|ok|passt|bestätig\w*|mach (das|es|mal)|leg (es|ihn|sie) an|trag (es|ihn) ein|genau|gerne|einverstanden)\b/i;
const NO = /\b(nein|nö|nee|abbrechen|stopp|lass es|doch nicht|nicht machen|verwerfen)\b/i;

/**
 * Gemini Live voice session manager (main process).
 * - Audio capture/playback happen in the renderer (Chromium AEC/NS/AGC),
 *   PCM is streamed over IPC; the API key never leaves the main process.
 * - Same orchestrator tools, same conversation history as text chat.
 * - Barge-in: renderer stops playback locally on speech; server
 *   `interrupted` events flush the queue as well.
 * - Session resumption + GoAway handling + context window compression.
 */
/** „Geh in den Standby“, „Jarvis, Pause“, „schlaf jetzt“ … – lokal erkannt, damit es auch ohne Modell klappt. */
const STANDBY_RE = /\b(?:geh|gehe|wechsel|wechsle|schalt|schalte|ab)\b[^.!?]{0,20}\b(?:stand-?by|ruhemodus|schlafmodus)\b|\bstand-?by[- ]?modus\b|^\W*(?:(?:hey\s+)?jarvis\W*)?(?:stand-?by|pause|schlaf(?:\s+jetzt|\s+gut)?|sei\s+(?:mal\s+)?still)\W*$/i;

class LiveVoice {
  constructor(s) {
    this.s = s;
    this.session = null; this.state = 'off'; this.handle = null; this.conversationId = null;
    this.inText = ''; this.outText = ''; this.reconnects = 0; this.closing = false;
    this.lastActivity = Date.now(); this.idleTimer = null; this.pendingTools = 0;
    this.lastUserUtterance = { text: '', at: 0 };
    this.model = null; this.extended = false;
    this.connectionGeneration = 0;
    this.standbyPending = false; this.standbyDeadline = 0; this.standbyTimer = null;
    // Kostenkontrolle je Sprachsitzung: Ledger-Einträge, gestreamte Audiosekunden, harte Zeitgrenze
    this.ledgers = []; this.audioSeconds = 0; this.sessionUsd = 0; this.maxTimer = null; this.startedAt = 0;
    // A conversation can be marked private while a cloud session is active.
    // Tear down immediately instead of waiting for the next microphone frame.
    this.s.bus.on('conversations:changed', () => {
      if (this.conversationId && this.session && !this.cloudConversationAllowed()) this.stop();
    });
  }

  setState(state, extra = {}) {
    this.state = state;
    this.s.bus.emit('voice:state', { state, model: this.model, ...extra });
    const orb = { off: 'idle', standby: 'idle', connecting: 'thinking', listening: 'listening', thinking: 'thinking', speaking: 'speaking', error: 'idle' }[state] || 'idle';
    this.s.bus.emit('orb:state', { state: orb });
  }

  isOpen() { return !!this.session; }

  cloudConversationAllowed() {
    const c = this.conversationId && this.s.conversations.get(this.conversationId);
    return !!c && ['study', 'gaming'].includes(c.privacy);
  }

  assertCloudConversation() {
    if (!this.cloudConversationAllowed()) {
      this.stop();
      throw new Error('Datenschutz: Für private Chats ist Cloud-Audio gesperrt. Bitte lokale Spracheingabe verwenden.');
    }
  }

  async start({ conversationId, cloudAudioApproved = false } = {}) {
    const { gemini, settings, conversations } = this.s;
    const conversation = conversationId ? conversations.get(conversationId) : conversations.current();
    if (!conversation || !['study', 'gaming'].includes(conversation.privacy)) {
      throw new Error('Datenschutz: Gemini Live ist nur für freigegebene Uni-/Gaming-Gespräche erlaubt.');
    }
    if (cloudAudioApproved !== true) {
      throw new Error('Datenschutz: Audioübertragung an Gemini benötigt vor jeder Sitzung deine ausdrückliche Zustimmung.');
    }
    if (this.session || this.state === 'connecting') {
      if (this.conversationId !== conversation.id) throw new Error('Eine andere Sprachsitzung ist aktiv. Bitte diese zuerst beenden.');
      return { state: this.state };
    }
    gemini.policy('voice'); // Modus, Schalter „Gemini Live“, Schlüssel – zentral im Gemini-Provider
    const blocked = this.s.costGuard?.exceeded();
    if (blocked) throw new Error('Cloud-KI-Budget erreicht – Gemini Live ist gesperrt. Lokale Spracheingabe funktioniert weiter.');
    const vs = settings.get('voice');
    this.extended = !!vs.extendedThinking && !!gemini.model('liveThinking');
    this.model = this.extended ? gemini.model('liveThinking') : gemini.requireModel('live');
    if (this.conversationId !== conversation.id) this.handle = null;
    this.conversationId = conversation.id;
    this.reconnects = 0;
    this.closing = false;
    this.ledgers = []; this.ledgerUsd = {}; this.audioSeconds = 0; this.sessionUsd = 0; this.startedAt = Date.now();
    clearTimeout(this.maxTimer);
    const maxMin = Math.max(1, Math.min(60, Number(vs.cloudMaxMinutes) || 10));
    this.maxTimer = setTimeout(() => this.limitReached(`Zeitgrenze von ${maxMin} Minuten erreicht`), maxMin * 60000);
    this.setState('connecting');
    await this.connect();
    this.assertCloudConversation();
    return { state: this.state, model: this.model };
  }

  config() {
    const vs = this.s.settings.get('voice');
    const decl = this.s.orchestrator.declarations({ nonBlocking: this.extended });
    const allowed = privacy.cloudTools(this.s.conversations.get(this.conversationId)?.privacy);
    decl[0].functionDeclarations = decl[0].functionDeclarations.filter(t => allowed.has(t.name));
    decl[0].functionDeclarations.push({
      name: 'confirm_pending_action',
      description: 'Bestätigt oder verwirft die zuletzt vorgeschlagene Aktion, NACHDEM der Nutzer mündlich eindeutig zugestimmt oder abgelehnt hat.',
      parameters: toGeminiSchema({ type: 'object', required: ['approve'], properties: { approve: { type: 'boolean' } } }),
      ...(this.extended ? { behavior: 'NON_BLOCKING' } : {}),
    });
    const cfg = {
      responseModalities: ['AUDIO'],
      systemInstruction: privacy.CLOUD_SYSTEM + ' Antworte auf Deutsch, kurz und gut verständlich. Nutze die freigegebenen Werkzeuge für aktuelle Spielinformationen; erfinde keine Ergebnisse.',
      tools: decl,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: require('./voice-presets').PRESETS[vs.tts?.preset]?.live || vs.voiceName || 'Charon' } }, languageCode: 'de-DE' },
      inputAudioTranscription: {}, outputAudioTranscription: {},
      // Im Sprachmodus berechnet Google bei JEDER Antwort den ganzen Sitzungsverlauf neu → Verlauf eng deckeln
      // (ab ~10k Token auf ~5k kürzen; älteres bleibt im Chatverlauf erhalten)
      contextWindowCompression: { triggerTokens: '10000', slidingWindow: { targetTokens: '5000' } },
      sessionResumption: this.handle ? { handle: this.handle } : {},
    };
    if (this.extended) cfg.thinkingConfig = { thinkingLevel: 'low' };
    return cfg;
  }

  async connect() {
    if (this.closing) return;
    this.assertCloudConversation();
    const generation = ++this.connectionGeneration;
    let closed = false;
    const fresh = !this.handle;
    try {
      const { session, ledger } = await this.s.gemini.liveConnect({
        model: this.model,
        config: this.config(),
        callbacks: {
          onopen: () => log.info('Live verbunden: ' + this.model),
          onmessage: (m) => { if (generation === this.connectionGeneration && !this.closing) this.onMessage(m).catch((e) => log.warn('onMessage', e)); },
          onerror: (e) => { log.warn('Live-Fehler', e?.message || e); },
          onclose: (e) => { closed = true; if (generation === this.connectionGeneration) this.onClose(e); },
        },
      });
      if (ledger) this.ledgers.push(ledger);
      if (generation !== this.connectionGeneration || this.closing) { session.close(); return; }
      if (closed) throw new Error('Sprachverbindung während des Aufbaus geschlossen');
      this.session = session;
    } catch (e) {
      if (generation !== this.connectionGeneration || this.closing) return;
      this.session = null;
      if (!this.reconnects) this.setState('error', { error: friendlyError(e) });
      throw new Error(friendlyError(e));
    }
    this.assertCloudConversation();
    this.reconnects = 0;
    if (fresh) {
      // Shared memory with the text chat: prime with recent turns of the same conversation.
      const hist = this.s.conversations.history(this.conversationId, 6, 4000);
      if (hist.length) {
        try { this.session.sendClientContent({ turns: hist, turnComplete: false }); } catch (e) { log.debug('History-Prime', e); }
      }
    }
    this.assertCloudConversation();
    this.setState('listening');
    this.touch();
  }

  touch() {
    this.lastActivity = Date.now();
    clearTimeout(this.idleTimer);
    const secs = this.s.settings.get('voice').idleDisconnectSeconds || 45;
    this.idleTimer = setTimeout(() => {
      if (this.state === 'listening' && !this.pendingTools) { log.info('Leerlauf – Live-Sitzung pausiert'); this.stop({ standby: true }); }
      else this.touch();
    }, secs * 1000);
  }

  /** PCM16 mono 16 kHz from renderer. */
  sendAudio(buf) {
    if (!this.session) return;
    if (!this.cloudConversationAllowed()) { this.stop(); return; }
    try {
      this.session.sendRealtimeInput({ audio: { data: Buffer.from(buf).toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
      this.audioSeconds += Buffer.byteLength(Buffer.from(buf)) / 32000; // PCM16 mono 16 kHz
    } catch (e) { log.debug('sendAudio', e); }
  }
  /** Lokale Sprachpause erkannt: Audio-Stream bis zum nächsten Sprechen beenden (spart Audio-Token). */
  sendAudioEnd() {
    if (!this.session) return;
    try { this.session.sendRealtimeInput({ audioStreamEnd: true }); } catch (e) { log.debug('audioEnd', e); }
  }
  /** Budget- oder Zeitgrenze: Sitzung beenden und sichtbar melden (kein stilles Weiterlaufen). */
  limitReached(reason) {
    if (!this.session && this.state === 'off') return;
    log.info('Live-Sitzung beendet: ' + reason);
    this.stop();
    this.setState('error', { error: `Gemini Live beendet: ${reason}. Lokale Spracheingabe bleibt verfügbar.` });
  }
  activity() { this.touch(); }

  /** Typed text into an open voice session (e.g. from the chat bar while talking). */
  sendText(text) {
    if (!this.session) return false;
    if (!this.cloudConversationAllowed()) { this.stop(); return false; }
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
    this.s.conversations.add(this.conversationId, { role: 'user', content: text, channel: 'voice' });
    return true;
  }

  async onMessage(m) {
    if (!this.cloudConversationAllowed()) { this.stop(); return; }
    const sc = m.serverContent;
    if (m.usageMetadata) {
      this.s.gemini.record?.('voice', this.model, m.usageMetadata);
      const id = this.ledgers.at(-1);
      const r = this.s.gemini.liveUsage?.(id, m.usageMetadata, this.model) || {};
      if (id && Number.isFinite(r.usd)) { (this.ledgerUsd ||= {})[id] = r.usd; this.sessionUsd = Object.values(this.ledgerUsd).reduce((a, b) => a + b, 0); }
      const maxEur = Number(this.s.settings.get('voice').cloudMaxEur) || 0.1;
      const eur = this.sessionUsd * (this.s.costGuard?.cfg().usdToEur || 0.86);
      if (r.exceeded) { this.limitReached({ day: 'Tagesbudget', session: 'Sitzungsbudget', month: 'Monatsbudget' }[r.exceeded] + ' erreicht'); return; }
      if (eur >= maxEur) { this.limitReached(`Budget je Sprachsitzung (${maxEur.toFixed(2).replace('.', ',')} €) erreicht`); return; }
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) { log.info('GoAway – baue Verbindung mit Resumption neu auf'); this.reconnect(); return; }
    if (sc) {
      if (sc.interrupted) {
        this.s.bus.emit('voice:interrupted', {});
        this.flushTurn(true);
        this.setState('listening');
      }
      if (sc.inputTranscription?.text) {
        this.inText += sc.inputTranscription.text;
        this.lastUserUtterance = { text: this.inText, at: Date.now() };
        if (!this.standbyPending && STANDBY_RE.test(this.inText.trim())) this.requestStandby({ reason: 'Sprachbefehl', quick: true });
        this.s.bus.emit('voice:transcript', { role: 'user', text: this.inText, final: false });
        this.touch();
      }
      for (const p of sc.modelTurn?.parts || []) {
        if (p.inlineData?.data && /audio/.test(p.inlineData.mimeType || 'audio/pcm')) {
          if (this.state !== 'speaking') this.setState('speaking');
          this.s.bus.emit('voice:audio', { data: p.inlineData.data, mime: p.inlineData.mimeType });
        }
      }
      if (sc.outputTranscription?.text) {
        this.outText += sc.outputTranscription.text;
        this.s.bus.emit('voice:transcript', { role: 'assistant', text: this.outText, final: false });
      }
      if (sc.turnComplete) {
        this.flushTurn(false);
        if (this.standbyPending) { this.enterStandby(); return; }
        const idle = !this.extended || (m.interactionStatus || sc.interactionStatus) === 'IDLE' || !(m.interactionStatus || sc.interactionStatus);
        if (idle && !this.pendingTools) this.setState('listening');
      }
    }
    const st = m.interactionStatus || sc?.interactionStatus;
    if (this.extended && st === 'IN_PROGRESS' && this.state === 'listening') this.setState('thinking');
    if (m.toolCall?.functionCalls?.length) await this.onToolCall(m.toolCall.functionCalls);
  }

  flushTurn(interrupted) {
    const cid = this.conversationId;
    if (this.inText.trim()) this.s.conversations.add(cid, { role: 'user', content: this.inText.trim(), channel: 'voice', meta: { transcript: true } });
    if (this.outText.trim()) this.s.conversations.add(cid, { role: 'assistant', content: this.outText.trim() + (interrupted ? ' …' : ''), channel: 'voice', meta: { transcript: true, interrupted } });
    if (this.inText || this.outText) this.s.bus.emit('voice:transcript', { role: 'done' });
    this.inText = ''; this.outText = '';
  }

  async onToolCall(calls) {
    if (!this.cloudConversationAllowed()) { this.stop(); return; }
    const session = this.session;
    const conversationId = this.conversationId;
    const generation = this.connectionGeneration;
    this.setState('thinking');
    this.pendingTools++;
    const responses = [];
    try {
      for (const fc of calls) {
        if (generation !== this.connectionGeneration || this.closing) break;
        let response;
        try {
          if (fc.name === 'confirm_pending_action') response = await this.voiceConfirm(!!fc.args?.approve);
          else {
            const out = await this.s.orchestrator.execute(fc.name, fc.args, { conversationId, channel: 'voice' });
            if (out.card) this.s.conversations.add(conversationId, { role: 'tool', content: '', channel: 'voice', meta: { cards: [out.card] } });
            response = out.response;
          }
        } catch (e) { response = { error: friendlyError(e) }; }
        if (!response || typeof response !== 'object' || Array.isArray(response)) response = { result: response ?? null };
        responses.push({ id: fc.id, name: fc.name, response: this.extended ? { ...response, scheduling: 'WHEN_IDLE' } : response });
      }
      if (generation === this.connectionGeneration && !this.closing && this.cloudConversationAllowed()) session?.sendToolResponse({ functionResponses: responses });
    } catch (e) { log.warn('Tool-Antwort', e); } finally { this.pendingTools--; }
  }

  /**
   * Voice confirmation guard: only accepted if the user's latest utterance
   * (after the card was created) clearly says yes/no. The model alone can
   * never approve.
   */
  async voiceConfirm(approve) {
    const pending = this.s.confirmations.list().filter((c) => c.conversationId === this.conversationId).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
    if (!pending) return { error: 'Keine offene Bestätigung' };
    const created = Date.parse(pending.expiresAt) - this.s.confirmations.ttl;
    const said = this.lastUserUtterance.at >= created ? this.lastUserUtterance.text : '';
    const ok = approve ? YES.test(said) && !NO.test(said) : NO.test(said) || !YES.test(said);
    if (!ok) return { error: 'Keine eindeutige mündliche Zustimmung erkannt – Nutzer soll „Ja“ sagen oder die Karte anklicken.' };
    try {
      const r = await this.s.orchestrator.resolveConfirmation(pending.token, approve);
      return { done: approve, summary: pending.summary, result: r.result };
    } catch (e) { return { error: friendlyError(e) }; }
  }

  async reconnect() {
    if (this.closing) return;
    if (!this.cloudConversationAllowed()) { this.stop(); return; }
    const generation = ++this.connectionGeneration;
    const old = this.session; this.session = null;
    try { old?.close(); } catch { /* ignore */ }
    if (this.closing) return;
    if (this.reconnects++ >= 3) { this.setState('error', { error: 'Verbindung verloren' }); return; }
    this.setState('connecting', { reconnect: true });
    await new Promise((r) => setTimeout(r, 400 * this.reconnects));
    if (this.closing || generation !== this.connectionGeneration) return;
    try { await this.connect(); } catch (e) {
      log.warn('Reconnect fehlgeschlagen', e);
      if (!this.closing && this.reconnects < 3) return this.reconnect();
      if (!this.closing) this.setState('error', { error: friendlyError(e) });
    }
  }

  onClose(e) {
    const wasOpen = !!this.session;
    this.session = null;
    if (this.closing || !wasOpen) return;
    log.info('Live-Verbindung geschlossen: ' + (e?.reason || e?.code || ''));
    if (/API key|permission|denied|invalid/i.test(String(e?.reason || ''))) { this.setState('error', { error: friendlyError(e.reason) }); return; }
    this.reconnect();
  }

  /**
   * Standby auf Wunsch: JARVIS bestätigt kurz, dann wird die Live-Sitzung pausiert und nur noch
   * das Wake-Word „Hey Jarvis“ gehört (wird bei Bedarf eingeschaltet).
   */
  requestStandby({ reason = 'Befehl', quick = false } = {}) {
    if (!this.isOpen() && this.state !== 'speaking') return { ok: false, note: 'Der Sprachmodus ist gerade nicht aktiv.' };
    const vs = this.s.settings.get('voice') || {};
    let wakeEnabled = false;
    if (!vs.wakeWord) { this.s.settings.update({ voice: { wakeWord: true } }); wakeEnabled = true; }
    if (this.standbyPending) return { ok: true, note: 'Standby ist bereits angefordert.' };
    this.standbyPending = true;
    log.info('Standby angefordert (' + reason + ')');
    clearTimeout(this.standbyTimer);
    // Absolute deadline: an endlessly speaking model must never keep the mic open.
    this.standbyDeadline = Date.now() + (quick ? 6000 : 4000);
    const generation = this.connectionGeneration;
    this.standbyTimer = setTimeout(() => {
      if (generation === this.connectionGeneration) this.enterStandby();
    }, quick ? 6000 : 4000);
    this.s.bus.emit('voice:standby', { pending: true, wakeEnabled });
    return { ok: true, note: 'Standby: Bestätige in zwei, drei Wörtern. Danach hört JARVIS nur noch auf „Hey Jarvis“.' + (wakeEnabled ? ' Das Wake-Word wurde dafür eingeschaltet.' : '') };
  }

  enterStandby() {
    clearTimeout(this.standbyTimer);
    this.standbyTimer = null;
    if (!this.standbyPending) return;
    const remaining = this.standbyDeadline - Date.now();
    if (this.state === 'speaking' && remaining > 0) {
      // Give the current sentence a brief chance to finish, but never extend
      // the original deadline (even if no turnComplete arrives).
      const generation = this.connectionGeneration;
      this.standbyTimer = setTimeout(() => {
        if (generation === this.connectionGeneration) this.enterStandby();
      }, Math.min(500, remaining));
      return;
    }
    this.stop({ standby: true });
  }

  stop({ standby = false } = {}) {
    this.connectionGeneration++;
    clearTimeout(this.standbyTimer);
    this.standbyTimer = null;
    const wasStandbyPending = this.standbyPending;
    this.standbyPending = false;
    this.standbyDeadline = 0;
    this.closing = true;
    if (wasStandbyPending) this.s.bus.emit('voice:standby', { pending: false });
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer); this.maxTimer = null;
    this.flushTurn(false);
    try { this.session?.close(); } catch { /* ignore */ }
    this.session = null;
    // Verbrauch abschließen; ohne Verbrauchsmeldung mindestens die gestreamten Audiominuten (0,005 $/min) zählen
    const floor = (this.audioSeconds / 60) * 0.005;
    this.ledgers.forEach((id, i) => this.s.gemini.liveEnd?.(id, i === 0 ? floor : 0));
    this.ledgers = []; this.audioSeconds = 0;
    if (!standby) this.handle = null;
    this.setState(standby ? 'standby' : 'off');
  }
}

module.exports = { LiveVoice, YES, NO, STANDBY_RE };

