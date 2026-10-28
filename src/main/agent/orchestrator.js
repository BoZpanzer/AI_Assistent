'use strict';
const { validate, toGeminiSchema } = require('../core/validate');
const { truncate } = require('../core/util');
const { buildTools, internalTools } = require('./tools');
const { systemPrompt, systemParts, needsReasoning } = require('./prompts');
const { friendlyError } = require('../providers/gemini');
const log = require('../core/logger').scope('agent');

const MAX_STEPS = 7;
const privacy = require('../core/privacy');
const { moodFor, thinkPose } = require('./mood');

/**
 * Central orchestrator: ONE agent, one history, one tool registry for chat,
 * dashboard, voice and background jobs.
 */
class Orchestrator {
  constructor(s) {
    this.s = s;
    this.tools = buildTools(s);
    this.byName = Object.fromEntries(this.tools.map((t) => [t.name, t]));
    this.internal = internalTools(s);
    this.active = new Map(); // conversationId -> AbortController
  }

  declarations({ nonBlocking = false } = {}) {
    return [{ functionDeclarations: this.tools.map((t) => ({
      name: t.name, description: t.description, parameters: toGeminiSchema(t.schema),
      ...(nonBlocking ? { behavior: 'NON_BLOCKING' } : {}),
    })) }];
  }

  promptOpts(channel, userText = '') {
    const settings = this.s.settings.all();
    let progress = '';
    try { progress = this.s.gaming.progressContext(userText); } catch { /* never block a reply */ }
    const extra = [];
    for (const fn of this.s.contextProviders || []) { try { const t = fn(userText, channel); if (t) extra.push(t); } catch { /* ignore */ } }
    return { settings, primer: this.s.brain.personalPrimer(), game: this.s.gaming.context.state(), progress: [progress, ...extra].filter(Boolean).join('\n\n'), channel };
  }
  /** Vollständige Systemanweisung (Sprachmodus: einmal pro Sitzung). */
  system(channel, userText = '') { return systemPrompt(this.promptOpts(channel, userText)); }
  /** Für den Text-Chat: fester Teil (cachebar) + Kontext für die aktuelle Nachricht. */
  systemSplit(channel, userText = '') { return systemParts(this.promptOpts(channel, userText)); }

  /**
   * Execute a tool call coming from any channel. Returns the function response
   * object and an optional UI card.
   */
  async execute(name, rawArgs, { conversationId, channel = 'text', scope = null } = {}) {
    const convPrivacy = conversationId ? this.s.conversations.get(conversationId)?.privacy : null;
    const turn = scope || (convPrivacy === 'private' ? 'private' : ['study', 'gaming'].includes(convPrivacy) ? convPrivacy : null);
    if (turn === 'private' && !privacy.isPrivate()) return privacy.local(() => this.execute(name, rawArgs, { conversationId, channel, scope }));
    if (privacy.isPrivate() && !privacy.LOCAL_TOOLS.has(name)) return { response: { error: 'Private: Dieses Werkzeug ist nicht für lokale Verarbeitung freigegeben.' } };
    const cloud = privacy.isCloud() || ['study', 'gaming', 'general'].includes(turn);
    if (cloud && !privacy.cloudTools(turn).has(name)) return { response: { error: 'Dieses Werkzeug ist nur für private (lokal beantwortete) oder Gaming-Nachrichten freigegeben.' } };
    const tool = this.byName[name];
    if (!tool) return { response: { error: 'Unbekanntes Werkzeug ' + name } };
    const v = validate(tool.schema, rawArgs || {});
    if (!v.ok) return { response: { error: 'Ungültige Argumente: ' + v.errors.join('; ') } };
    const args = v.value;
    try {
      if (tool.mode === 'confirm') {
        const sum = await tool.summarize(args);
        const c = this.s.confirmations.create({ tool: name, args, summary: sum.summary, details: sum.details, conversationId, run: (a) => privacy.local(() => tool.run(a)) });
        return { response: { status: 'awaiting_user_confirmation', summary: sum.summary, note: 'Noch NICHT ausgeführt. Der Nutzer muss die Karte bestätigen.' }, card: { kind: 'confirm', ...c } };
      }
      const result = await tool.run(args, { conversationId, channel });
      const card = tool.card ? tool.card(args, result) : null;
      let response = result ?? { ok: true };
      if (response && typeof response === 'object' && '_undo' in response) { const { _undo, ...rest } = response; response = rest; }
      return { response, card: card ? { kind: 'action', ...card } : null };
    } catch (e) {
      log.warn(`Werkzeug ${name} fehlgeschlagen`, e);
      return { response: { error: friendlyError(e) } };
    }
  }

  async runInternal(name, args) {
    const fn = this.internal[name] || null;
    if (!fn) throw new Error('Unbekannte Aktion');
    return fn(args || {});
  }

  cancel(conversationId) { this.active.get(conversationId)?.abort(); }

  /**
   * Text turn. Streams via bus events: chat:delta / chat:card / chat:done.
   * @returns final assistant message
   */
  async chat({ conversationId, text, attachments = [], images = [], channel = 'text', hint = '', screen = false }) {
    const { conversations, gemini, bus } = this.s;
    const conv = conversationId ? conversations.get(conversationId) : conversations.current();
    if (!conv) throw new Error('Gespräch nicht gefunden');
    const cid = conv.id;
    // Eine neue Nachricht von dir weckt JARVIS aus dem Standby
    if (['text', 'voice'].includes(channel)) this.s.voice?.wake?.('chat');
    // Pro Nachricht entscheiden: privat → lokales Modell, sonst Gemini (nur mit nicht-privatem Verlauf).
    const scope = this.classify(cid, text, { attachments, images, screen });
    let userText = String(text || '').slice(0, 30000);
    const attachInfo = [];
    for (const a of attachments.slice(0, 5)) {
      attachInfo.push({ name: a.name, docId: a.docId });
      userText += `\n\n[Anhang: ${a.name}${a.docId ? ` (docId ${a.docId}, mit read_document lesbar)` : ''}]`;
    }
    for (const im of images.slice(0, 3)) attachInfo.push({ name: im.name || 'Bild', image: true });
    conversations.add(cid, { role: 'user', content: userText, meta: { scope, ...(attachInfo.length ? { attachments: attachInfo } : {}) }, channel });
    conversations.autoTitle(cid, text || attachInfo[0]?.name || 'Gespräch');
    const msg = conversations.add(cid, { role: 'assistant', content: '', meta: { streaming: true, scope }, channel });
    // Desktop-Figur/Overlay: neue Eingabe → Sprechblase „denkt …“
    if (['text', 'voice'].includes(channel)) bus.emit('pet:input', { conversationId: cid, messageId: msg.id, channel, think: thinkPose(text) });

    // Feste Fragen (Statistiken, Erfassungen) ohne Sprachmodell beantworten – kostenlos und lokal.
    const det = !images.length && !attachments.length ? this.deterministic(text) : null;
    if (det) {
      conversations.update(msg.id, { content: det.text, meta: { streaming: false, deterministic: det.deterministic, model: 'lokal (ohne KI)' } });
      bus.emit('pet:answer', { messageId: msg.id, text: det.text, mood: moodFor({ userText: text, answer: det.text }) });
      if (det.clearBubble) bus.emit('pet:clear', {});
      bus.emit('chat:delta', { conversationId: cid, messageId: msg.id, delta: det.text });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id });
      if (channel === 'voice' && this.s.settings.get('voice').speakVoiceReplies !== false) {
        if (scope === 'private' ? this.quietPrivate() : this.quietPublic()) bus.emit('overlay:answer', { question: text, answer: det.text, cards: [], private: true, mood: moodFor({ userText: text, answer: det.text }) });
        else bus.emit('tts:speak', { text: det.text, private: scope === 'private' });
      }
      return conversations.messages(cid, { limit: 1 })[0];
    }
    if (scope !== 'private' && !gemini.hasKey() && !this.s.groq?.hasKey() && !this.s.localLLM?.cfg().model) {
      const content = 'Ich brauche zuerst einen Gemini-API-Schlüssel, Chef. Öffne **Einstellungen → Gemini / KI** oder den Einrichtungsassistenten.';
      conversations.update(msg.id, { content, meta: { streaming: false, error: true } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id });
      bus.emit('pet:answer', { messageId: msg.id, text: content, error: true, mood: moodFor({ error: true }) });
      return conversations.messages(cid, { limit: 1 })[0];
    }
    return this.run({ cid, msg, text, channel, images, hint, scope });
  }

  /** Antwort auf eine fehlgeschlagene Nachricht neu erzeugen (gleiche Frage, gleiche Blase). */
  async retry({ conversationId, messageId }) {
    const { conversations, bus } = this.s;
    const all = conversations.messages(conversationId, { limit: 400 });
    const i = all.findIndex((m) => m.id === messageId);
    const msg = all[i];
    if (!msg || msg.role !== 'assistant' || !msg.meta?.error) throw new Error('Diese Antwort kann nicht wiederholt werden');
    const user = [...all.slice(0, i)].reverse().find((m) => m.role === 'user');
    if (!user) throw new Error('Keine Frage zum Wiederholen gefunden');
    const scope = user.meta?.scope || this.legacyScope(conversationId);
    if (scope !== 'private' && !this.s.gemini.hasKey() && !this.s.groq?.hasKey() && !this.s.localLLM?.cfg().model) throw new Error('Kein Gemini-API-Schlüssel hinterlegt');
    const fresh = conversations.update(msg.id, { content: '', meta: { streaming: true, error: false, cards: [], sources: [] } });
    bus.emit('chat:retry', { conversationId, messageId });
    bus.emit('pet:input', { conversationId, messageId, channel: 'text', think: thinkPose(user.content) });
    return this.run({ cid: conversationId, msg: fresh, text: user.content, channel: msg.channel || 'text', images: [], upTo: user.id, scope });
  }

  /** Läuft ein Spiel und spricht dabei die Google-Stimme? Dann private Antworten nur als Text ins Overlay. */
  quietPrivate() { try { return !!this.s.localLLM?.isGaming?.() && this.s.cloudTts?.gamingMode() === 'cloud'; } catch { return false; } }
  /** Beim Zocken ohne verfügbare Google-Stimme (kein Schlüssel / Kontingent leer): auch öffentliche Antworten nur ins Overlay. */
  quietPublic() { try { return this.quietPrivate() && !this.s.cloudTts.available(60); } catch { return false; } }

  /**
   * Falsch eingeordnet? Dieselbe Frage nochmal – diesmal ausdrücklich privat (lokal) bzw. öffentlich (Groq/Gemini).
   * Die Einordnung der Frage wird dabei mitgeändert, damit Folgefragen richtig laufen.
   */
  async reroute({ conversationId, messageId, as }) {
    const { conversations, bus } = this.s;
    const all = conversations.messages(conversationId, { limit: 400 });
    const i = all.findIndex((m) => m.id === messageId);
    const msg = all[i];
    if (!msg || msg.role !== 'assistant') throw new Error('Diese Antwort gibt es nicht mehr.');
    const user = [...all.slice(0, i)].reverse().find((m) => m.role === 'user');
    if (!user) throw new Error('Keine Frage zum erneuten Beantworten gefunden.');
    const scope = as === 'private' ? 'private' : privacy.publicTopic(user.content) || 'general';
    conversations.update(user.id, { meta: { scope } });
    const fresh = conversations.update(msg.id, { content: '', meta: { streaming: true, error: false, cards: [], sources: [], scope } });
    bus.emit('chat:retry', { conversationId, messageId });
    bus.emit('pet:input', { conversationId, messageId, channel: 'text', think: thinkPose(user.content) });
    return this.run({ cid: conversationId, msg: fresh, text: user.content, channel: msg.channel || 'text', images: [], upTo: user.id, scope });
  }

  /** Deterministic answers (no model): game statistics and their spoken/typed entry. */
  deterministic(text) {
    try { const v = this.voiceCommand(text); if (v) return v; } catch (e) { log.debug('voice command', e); }
    try {
      if (require('./window-command').parseStandbyCommand(text)) {
        const r = this.s.voice?.requestStandby({ reason: 'Sprachbefehl' });
        return { text: r?.note?.startsWith('Standby – „Hey') ? 'Okay, ich mach Pause. Sag „Hey Jarvis“, wenn du mich brauchst.' : 'Okay, ich mach Pause. Tipp mir oder drück aufs Mikrofon, wenn du mich brauchst.', deterministic: 'standby' };
      }
    } catch (e) { log.debug('standby command', e); }
    try { if (require('./window-command').parseBubbleCommand(text)) return { text: 'Okay.', deterministic: 'bubble', clearBubble: true }; } catch (e) { log.debug('bubble command', e); }
    try {
      const w = require('./window-command').parseWindowCommand(text);
      if (w) { this.s.bus.emit('ui:window', { show: w === 'show' }); return { text: w === 'show' ? 'Hier bin ich.' : 'Alles klar, ich warte auf dem Desktop.', deterministic: 'window' }; }
    } catch (e) { log.debug('window command', e); }
    try { return this.s.gaming?.stats?.answer(text) || null; } catch (e) { log.debug('deterministic', e); return null; }
  }

  /** „Stimme auf Alya/Jarvis/Standard“ – Profil wechseln, ohne Sprachmodell. */
  voiceCommand(text) {
    const id = require('../voice/voice-presets').parseVoiceCommand(text);
    if (!id) return null;
    return { text: this.setVoice(id).message, deterministic: 'voice' };
  }

  setVoice(preset) {
    const { PRESETS, presetId } = require('../voice/voice-presets');
    const id = presetId(preset);
    const before = this.s.settings.get('voice')?.tts?.preset || 'standard';
    this.s.settings.update({ voice: { tts: { preset: id } } });
    const label = PRESETS[id].label;
    const message = before === id ? `Ich spreche schon mit der Stimme „${label}“.` : id === 'standard' ? 'Alles klar – wieder die Standardstimme.' : `Alles klar – ab jetzt spreche ich als ${label}.`;
    return { preset: id, label, changed: before !== id, message };
  }

  /** Alte Gespräche (vor 5.0): „private“ bleibt komplett lokal, Uni/Gaming wie gehabt. */
  legacyScope(cid) { const p = this.s.conversations.get(cid)?.privacy; return p === 'private' ? 'private' : ['study', 'gaming'].includes(p) ? p : 'general'; }

  /**
   * Eine Nachricht einordnen – ohne KI, sofort:
   * 'private' (lokales Modell; Termine, Finanzen, Familie, eigene Daten, Assistenz-Aktionen, Anhänge, eingefügte Bilder)
   * oder öffentlich mit Thema 'gaming' | 'study' | 'general' (Gemini, nur mit nicht-privatem Verlauf).
   * Kurze Folgefragen direkt nach einer privaten Nachricht bleiben privat, solange sie kein eigenes öffentliches Thema haben.
   */
  classify(cid, text, { attachments = [], images = [], screen = false } = {}) {
    const conv = this.s.conversations.get(cid);
    if (conv?.privacy === 'private') return 'private';
    if (attachments.length || (images.length && !screen)) return 'private';
    if (privacy.privateText(text) || privacy.personalText(text)) return 'private';
    const st = (() => { try { return this.s.gaming?.context?.state?.() || {}; } catch { return {}; } })();
    const topic = screen ? 'gaming' : privacy.publicTopic(text, { gameActive: !!(st.active || st.discussed) });
    if (!topic) {
      const last = this.s.conversations.messages(cid, { limit: 4 }).reverse().find((m) => m.role === 'user');
      if (last?.meta?.scope === 'private' && Date.now() - Date.parse(last.createdAt) < 15 * 60000 && String(text).length < 160) return 'private';
    }
    return topic || (['study', 'gaming'].includes(conv?.privacy) ? conv.privacy : 'general');
  }

  /**
   * Routing einer Nachricht: privat → lokales Modell; sonst Gemini, falls erlaubt – sonst (lokaler Modus,
   * Funktion aus, Budget) das lokale Modell mit sichtbarem Hinweis. Ein lokaler Fehler löst nie einen Cloud-Aufruf aus.
   */
  route(cid, images = [], scope = this.legacyScope(cid)) {
    if (scope === 'private') return { provider: 'local', tools: 'private' };
    // Öffentlich und ohne Bild: zuerst Groq (kostenlos, schnell), sonst Gemini, sonst lokal
    if (!images.length && this.s.groq?.available()) return { provider: 'groq', tools: scope };
    return this.routeGemini(images, scope);
  }

  routeGemini(images, scope) {
    let reason = null;
    try { this.s.gemini.policy(images.length ? 'vision' : 'chat'); const ex = this.s.costGuard?.exceeded(); if (ex) reason = { day: 'Tagesbudget erreicht', session: 'Sitzungsbudget erreicht', month: 'Monatsbudget erreicht' }[ex]; }
    catch (e) { reason = e.code === 'CLOUD_OFF' ? e.message.replace(/\s*\(Einstellungen.*$|\s*Einstellungen →.*$/, '') : e.message; }
    if (!reason) return { provider: 'cloud', tools: scope };
    if (this.s.localLLM?.cfg().model && !images.length) return { provider: 'local', tools: scope, note: reason };
    return { provider: 'blocked', reason };
  }

  async run({ cid, msg, text, channel, images = [], upTo, hint = '', scope = this.legacyScope(cid) }) {
    const { conversations, gemini, bus } = this.s;
    const routed = this.route(cid, images, scope);
    if (routed.provider === 'blocked') {
      const content = `⚠️ ${routed.reason}. Es ist kein lokales Modell eingerichtet (Einstellungen → Lokale KI).`;
      conversations.update(msg.id, { content, meta: { streaming: false, error: true } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id, error: content });
      bus.emit('pet:answer', { messageId: msg.id, text: content, error: true, mood: moodFor({ error: true }) });
      return conversations.messages(cid, { limit: 1 })[0];
    }
    let isLocal = routed.provider === 'local';
    let isGroq = routed.provider === 'groq';
    const isPrivateConv = routed.tools === 'private';
    let provider = isLocal ? this.s.localLLM : isGroq ? this.s.groq : gemini;
    const ac = new AbortController();
    this.cancel(cid);
    this.active.set(cid, ac);
    const spar = this.s.settings.get('aiCostMode') !== 'max';
    // Gemini sieht nur nicht-private Nachrichten; das lokale Modell sieht alles.
    // Groq-Gratiskontingent zählt Token pro Minute → etwas kürzerer Verlauf
    const contents = conversations.history(cid, isGroq ? 8 : spar ? 10 : 14, isGroq ? 9000 : spar ? 16000 : 24000, upTo, { publicOnly: !isLocal, legacyPrivate: conversations.get(cid)?.privacy === 'private' });
    if (images.length) {
      const lastUser = [...contents].reverse().find((c) => c.role === 'user');
      if (lastUser) lastUser.parts.unshift(...images.slice(0, 3).map((im) => ({ inlineData: { mimeType: im.mimeType || 'image/jpeg', data: im.data } })));
    }
    const role = needsReasoning(text) ? 'reasoning' : 'fast';
    // Gaming-Chats ohne Bild und ohne „gründlich“-Frage: Sparmodell (Flash-Lite, ältere Generation, ca. 8× günstiger)
    const cc = gemini.cloudCfg();
    const lite = !isLocal && role === 'fast' && !images.length && cc.economy !== false && cc.liteGamingChat !== false && scope === 'gaming' ? gemini.model('lite') : '';
    const geminiModel = () => lite || gemini.model(role) || gemini.requireModel('fast');
    let model = isLocal ? this.s.localLLM.cfg().model : isGroq ? this.s.groq.cfg().model : geminiModel();
    // Fester Teil der Anweisung + Werkzeuge + bisheriger Verlauf bleiben gleich → Googles Cache greift.
    // Wechselnder Kontext (Uhrzeit, Spiel, Gedächtnis) hängt nur an der neuesten Nutzernachricht (wird nicht gespeichert).
    const { stable, context } = isPrivateConv ? this.systemSplit(channel, text) : { stable: privacy.CLOUD_SYSTEM, context: '' };
    const lastUser = [...contents].reverse().find((c) => c.role === 'user');
    if (lastUser) lastUser.parts = [{ text: context }, ...lastUser.parts, ...(hint ? [{ text: hint }] : [])]; else contents.push({ role: 'user', parts: [{ text: context }] });
    // Vorlesen startet schon beim ersten fertigen Satz (statt erst nach der ganzen Antwort)
    const vs0 = this.s.settings.get('voice') || {};
    const wantSpeech = (channel === 'voice' && vs0.speakVoiceReplies !== false) || (!isPrivateConv && vs0.speakReplies && channel === 'text');
    // Beim Zocken spricht die Google-Stimme – private Antworten gehen nicht dorthin, sondern nur als Text ins Overlay
    const overlayOnly = wantSpeech && (isPrivateConv ? this.quietPrivate() : this.quietPublic());
    const speak = wantSpeech && !overlayOnly;
    const talk = speak ? new (require('../voice/sentence-stream').SentenceStream)({ id: msg.id, short: vs0.tts?.short !== false, emit: (e) => bus.emit('tts:stream', { ...e, private: isPrivateConv }) }) : null;
    // Sprechblase der Figur live mitschreiben (höchstens alle 250 ms)
    let petAt = 0; let petTimer = null;
    const petDelta = () => {
      const fire = () => { petTimer = null; petAt = Date.now(); bus.emit('pet:delta', { messageId: msg.id, text: full }); };
      if (Date.now() - petAt > 250) fire(); else if (!petTimer) petTimer = setTimeout(fire, 250);
    };
    const cards = []; const sources = []; const used = []; let full = routed.note ? `_(Lokal beantwortet – ${routed.note}.)_\n\n` : '';
    if (routed.note) bus.emit('chat:delta', { conversationId: cid, messageId: msg.id, delta: full });
    bus.emit('orb:state', { state: 'thinking' });
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (ac.signal.aborted) throw new Error('Abgebrochen.');
        let emitted = false;
        const step = () => {
          const allowed = isPrivateConv ? privacy.LOCAL_TOOLS : isLocal ? new Set([...privacy.LOCAL_TOOLS].filter((n) => privacy.cloudTools(scope).has(n))) : privacy.cloudTools(scope);
          return provider.stepStream({
            model, system: stable, contents, tools: [{ functionDeclarations: this.declarations()[0].functionDeclarations.filter((t) => allowed.has(t.name)) }], signal: ac.signal, feature: images.length ? 'vision' : 'chat', effort: role === 'reasoning' ? 'high' : 'low',
            onWait: (ms) => bus.emit('chat:tool', { conversationId: cid, messageId: msg.id, name: 'quota_wait', state: 'running', seconds: Math.round(ms / 1000) }),
            onText: (d) => { emitted = true; full += d; bus.emit('chat:delta', { conversationId: cid, messageId: msg.id, delta: d }); talk?.push(d); petDelta(); },
          });
        };
        let r; let groqErr = null;
        try { r = await step(); } catch (e) {
          groqErr = e;
          // Groq ausgefallen/Kontingent leer, bevor Text kam → nahtlos mit Gemini (oder lokal) weiter
          if (!isGroq || emitted || ac.signal.aborted) throw e;
          // Nur das Minutenlimit (wenige Sekunden)? Kurz warten statt auf das kostenpflichtige Gemini auszuweichen
          const wait = (this.s.groq.exhaustedUntil || 0) - Date.now();
          if (e.status === 429 && wait > 0 && wait <= 7000) {
            bus.emit('chat:tool', { conversationId: cid, messageId: msg.id, name: 'quota_wait', state: 'running', seconds: Math.ceil(wait / 1000) });
            await new Promise((res) => setTimeout(res, wait));
            this.s.groq.exhaustedUntil = 0;
            try { r = await step(); } catch (e2) { if (emitted || ac.signal.aborted) throw e2; groqErr = e2; }
          }
        }
        if (!r) {
          const fb = this.routeGemini([], scope);
          if (fb.provider === 'blocked') throw groqErr;
          log.info(`Groq nicht genutzt (${groqErr?.message}) – weiter mit ${fb.provider === 'local' ? 'lokalem Modell' : 'Gemini'}`);
          isGroq = false; isLocal = fb.provider === 'local';
          provider = isLocal ? this.s.localLLM : gemini;
          model = isLocal ? this.s.localLLM.cfg().model : geminiModel();
          r = await step();
        }
        contents.push({ role: 'model', parts: r.parts.length ? r.parts : [{ text: r.text || '' }] });
        if (!r.functionCalls.length) break;
        const responses = [];
        for (const fc of r.functionCalls) {
          used.push(fc.name);
          bus.emit('chat:tool', { conversationId: cid, messageId: msg.id, name: fc.name, state: 'running' });
          const execute = () => this.execute(fc.name, fc.args, { conversationId: cid, channel, scope });
          const out = await (isPrivateConv ? privacy.local(execute) : isLocal ? execute() : privacy.cloud(execute));
          if (out.card) { cards.push(out.card); bus.emit('chat:card', { conversationId: cid, messageId: msg.id, card: out.card }); }
          for (const src of out.response?.sources || []) if (src.url && !sources.some((x) => x.url === src.url)) sources.push(src);
          for (const res of out.response?.results || []) if (res.citation && !sources.some((x) => x.title === res.citation)) sources.push({ title: res.citation, docId: res.docId, page: res.page, kind: 'document' });
          responses.push({ functionResponse: { name: fc.name, id: fc.id, response: sanitizeResponse(out.response) } });
          bus.emit('chat:tool', { conversationId: cid, messageId: msg.id, name: fc.name, state: 'done' });
        }
        contents.push({ role: 'user', parts: responses });
        if (step === MAX_STEPS - 1) full += '\n\n_(Abgebrochen: zu viele Werkzeugschritte.)_';
      }
      const final = conversations.update(msg.id, { content: full.trim() || (cards.length ? '' : '…'), meta: { streaming: false, cards, sources: sources.slice(0, 12), model, scope, local: isLocal } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id });
      clearTimeout(petTimer); bus.emit('pet:answer', { messageId: msg.id, text: final.content, mood: moodFor({ userText: text, answer: final.content }) });
      // Brain selbstständig erweitern (Hintergrund; privat → lokales Modell, sonst Gemini-Sparmodell)
      if (!routed.note) setImmediate(() => this.s.learner?.learn({ cid, messageId: msg.id, userText: text, answer: final.content, scope: isLocal && scope !== 'private' ? 'private' : scope, sources, usedRemember: used.includes('remember') }).catch(() => {}));
      talk?.end(); // Rest der Antwort vorlesen (der Anfang läuft schon)
      if (overlayOnly) bus.emit('overlay:answer', { question: text, answer: final.content, cards, private: true, mood: moodFor({ userText: text, answer: final.content }) });
      return final;
    } catch (e) {
      // Lösungs-Marker → Markdown-Link (Chat rendert Markdown)
      const err = friendlyError(e).replace(/\s*⟨fix:([^|⟩]+)\|([^⟩]+)⟩/, (_, label, target) => (target.startsWith('https://') ? ` → [${label.trim()}](${target.trim()})` : ` → ${label.trim()}`));
      log.warn('Chat fehlgeschlagen', e);
      talk?.end();
      conversations.update(msg.id, { content: (full ? full + '\n\n' : '') + `⚠️ ${err}`, meta: { streaming: false, error: true, cards, sources } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id, error: err });
      clearTimeout(petTimer); bus.emit('pet:answer', { messageId: msg.id, text: `⚠️ ${err}`, error: true, mood: moodFor({ error: true }) });
      return conversations.messages(cid, { limit: 1 })[0];
    } finally {
      if (this.active.get(cid) === ac) this.active.delete(cid);
      bus.emit('orb:state', { state: 'idle' });
    }
  }

  /** Called when the user clicks Bestätigen/Ablehnen on a card. */
  async resolveConfirmation(token, approve) {
    const res = await this.s.confirmations.resolve(token, approve);
    const item = res.item;
    const cid = item?.conversationId;
    if (cid) {
      const nick = this.s.settings.get('nickname') || 'Chef';
      const text = approve ? `Erledigt, ${nick}: ${item.summary}.${res.result?.created?.pending ? ' (Google war nicht erreichbar – wird automatisch nachgetragen.)' : ''}` : 'Alles klar, abgebrochen.';
      this.s.conversations.add(cid, { role: 'assistant', content: text, meta: { confirmation: { token, approved: approve } } });
    }
    return { approved: approve, result: res.result };
  }
}

/** Keep tool responses compact and JSON-safe for the model. */
function sanitizeResponse(r, max = 30000) {
  const json = JSON.stringify(r ?? {}, (k, v) => (typeof v === 'string' ? truncate(v, 8000) : v));
  return JSON.parse(json.length > max ? JSON.stringify({ truncated: true, data: json.slice(0, max) }) : json);
}

module.exports = { Orchestrator };

