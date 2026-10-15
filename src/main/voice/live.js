'use strict';
const { toGeminiSchema } = require('../core/validate');
const { friendlyError } = require('../providers/gemini');
const log = require('../core/logger').scope('voice');

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
    if (this.session || this.state === 'connecting') return { state: this.state };
    const { gemini, settings, conversations } = this.s;
    const conversation = conversationId ? conversations.get(conversationId) : conversations.current();
    if (!conversation || !['study', 'gaming'].includes(conversation.privacy)) {
      throw new Error('Datenschutz: Gemini Live ist nur für freigegebene Uni-/Gaming-Gespräche erlaubt.');
    }
    if (cloudAudioApproved !== true) {
      throw new Error('Datenschutz: Audioübertragung an Gemini benötigt vor jeder Sitzung deine ausdrückliche Zustimmung.');
    }
    if (!gemini.hasKey()) throw new Error('Kein Gemini-API-Schlüssel hinterlegt');
    const vs = settings.get('voice');
    this.extended = !!vs.extendedThinking && !!gemini.model('liveThinking');
    this.model = this.extended ? gemini.model('liveThinking') : gemini.requireModel('live');
    this.conversationId = conversation.id;
    this.closing = false;
    this.setState('connecting');
    await this.connect();
    this.assertCloudConversation();
    return { state: this.state, model: this.model };
  }

  config() {
    const vs = this.s.settings.get('voice');
    const decl = this.s.orchestrator.declarations({ nonBlocking: this.extended });
    decl[0].functionDeclarations.push({
      name: 'confirm_pending_action',
      description: 'Bestätigt oder verwirft die zuletzt vorgeschlagene Aktion, NACHDEM der Nutzer mündlich eindeutig zugestimmt oder abgelehnt hat.',
      parameters: toGeminiSchema({ type: 'object', required: ['approve'], properties: { approve: { type: 'boolean' } } }),
      ...(this.extended ? { behavior: 'NON_BLOCKING' } : {}),
    });
    const cfg = {
      responseModalities: ['AUDIO'],
      systemInstruction: this.s.orchestrator.system('voice'),
      tools: decl,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: vs.voiceName || 'Charon' } }, languageCode: 'de-DE' },
      inputAudioTranscription: {}, outputAudioTranscription: {},
      // Im Sprachmodus berechnet Google bei JEDER Antwort den ganzen Sitzungsverlauf neu → Verlauf deckeln
      // (ab ~24k Token auf ~12k kürzen ≈ die letzten Minuten Gespräch; älteres bleibt im Chatverlauf erhalten)
      contextWindowCompression: { triggerTokens: '24000', slidingWindow: { targetTokens: '12000' } },
      sessionResumption: this.handle ? { handle: this.handle } : {},
    };
    if (this.extended) cfg.thinkingConfig = { thinkingLevel: 'low' };
    return cfg;
  }

  async connect() {
    this.assertCloudConversation();
    const client = this.s.gemini.client();
    const fresh = !this.handle;
    try {
      this.session = await client.live.connect({
        model: this.model,
        config: this.config(),
        callbacks: {
          onopen: () => log.info('Live verbunden: ' + this.model),
          onmessage: (m) => this.onMessage(m).catch((e) => log.warn('onMessage', e)),
          onerror: (e) => { log.warn('Live-Fehler', e?.message || e); },
          onclose: (e) => this.onClose(e),
        },
      });
    } catch (e) {
      this.session = null;
      this.setState('error', { error: friendlyError(e) });
      throw new Error(friendlyError(e));
    }
    this.assertCloudConversation();
    this.reconnects = 0;
    if (fresh) {
      // Shared memory with the text chat: prime with recent turns of the same conversation.
      const hist = this.s.conversations.history(this.conversationId, 8, 8000);
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
    const secs = this.s.settings.get('voice').idleDisconnectSeconds || 90;
    this.idleTimer = setTimeout(() => {
      if (this.state === 'listening' && !this.pendingTools) { log.info('Leerlauf – Live-Sitzung pausiert'); this.stop({ standby: true }); }
      else this.touch();
    }, secs * 1000);
  }

  /** PCM16 mono 16 kHz from renderer. */
  sendAudio(buf) {
    if (!this.session) return;
    if (!this.cloudConversationAllowed()) { this.stop(); return; }
    try { this.session.sendRealtimeInput({ audio: { data: Buffer.from(buf).toString('base64'), mimeType: 'audio/pcm;rate=16000' } }); } catch (e) { log.debug('sendAudio', e); }
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
    if (m.usageMetadata) this.s.gemini.record?.('voice', this.model, m.usageMetadata);
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
    this.setState('thinking');
    this.pendingTools++;
    const responses = [];
    try {
      for (const fc of calls) {
        let response;
        if (fc.name === 'confirm_pending_action') response = await this.voiceConfirm(!!fc.args?.approve);
        else {
          const out = await this.s.orchestrator.execute(fc.name, fc.args, { conversationId: this.conversationId, channel: 'voice' });
          if (out.card) this.s.conversations.add(this.conversationId, { role: 'tool', content: '', channel: 'voice', meta: { cards: [out.card] } });
          response = out.response;
        }
        responses.push({ id: fc.id, name: fc.name, response: this.extended ? { ...response, scheduling: 'WHEN_IDLE' } : response });
      }
      this.session?.sendToolResponse({ functionResponses: responses });
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
    if (!this.cloudConversationAllowed()) { this.stop(); return; }
    const old = this.session; this.session = null;
    try { old?.close(); } catch { /* ignore */ }
    if (this.closing) return;
    if (this.reconnects++ >= 3) { this.setState('error', { error: 'Verbindung verloren' }); return; }
    this.setState('connecting', { reconnect: true });
    await new Promise((r) => setTimeout(r, 400 * this.reconnects));
    try { await this.connect(); } catch (e) { log.warn('Reconnect fehlgeschlagen', e); if (this.reconnects < 3) this.reconnect(); }
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
    this.standbyPending = true;
    log.info('Standby angefordert (' + reason + ')');
    clearTimeout(this.standbyTimer);
    // Falls das Modell nicht mehr antwortet: spätestens nach ein paar Sekunden pausieren
    this.standbyTimer = setTimeout(() => this.enterStandby(), quick ? 6000 : 4000);
    this.s.bus.emit('voice:standby', { pending: true, wakeEnabled });
    return { ok: true, note: 'Standby: Bestätige in zwei, drei Wörtern. Danach hört JARVIS nur noch auf „Hey Jarvis“.' + (wakeEnabled ? ' Das Wake-Word wurde dafür eingeschaltet.' : '') };
  }

  enterStandby() {
    clearTimeout(this.standbyTimer);
    if (!this.standbyPending) return;
    this.standbyPending = false;
    if (this.state === 'speaking') { this.standbyTimer = setTimeout(() => { this.standbyPending = true; this.enterStandby(); }, 1500); return; }
    this.stop({ standby: true });
    this.s.bus.emit('voice:standby', { pending: false });
  }

  stop({ standby = false } = {}) {
    clearTimeout(this.standbyTimer);
    if (!standby) this.standbyPending = false;
    this.closing = true;
    clearTimeout(this.idleTimer);
    this.flushTurn(false);
    try { this.session?.close(); } catch { /* ignore */ }
    this.session = null;
    if (!standby) this.handle = null;
    this.setState(standby ? 'standby' : 'off');
  }
}

module.exports = { LiveVoice, YES, NO, STANDBY_RE };

