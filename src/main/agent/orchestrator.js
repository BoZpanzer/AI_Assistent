'use strict';
const { validate, toGeminiSchema } = require('../core/validate');
const { truncate } = require('../core/util');
const { buildTools, internalTools } = require('./tools');
const { systemPrompt, systemParts, needsReasoning } = require('./prompts');
const { friendlyError } = require('../providers/gemini');
const log = require('../core/logger').scope('agent');

const MAX_STEPS = 7;
const privacy = require('../core/privacy');

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
  async execute(name, rawArgs, { conversationId, channel = 'text' } = {}) {
    if (conversationId && this.s.conversations.get(conversationId)?.privacy === 'private' && !privacy.isPrivate()) return privacy.local(() => this.execute(name, rawArgs, { conversationId, channel }));
    if (privacy.isPrivate() && !privacy.LOCAL_TOOLS.has(name)) return { response: { error: 'Private: Dieses Werkzeug ist nicht für lokale Verarbeitung freigegeben.' } };
    const cloud = conversationId && ['study', 'gaming'].includes(this.s.conversations.get(conversationId)?.privacy);
    if (cloud && !privacy.CLOUD_TOOLS.has(name)) return { response: { error: 'Dieses Werkzeug benötigt ein privates, lokales Gespräch.' } };
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
  async chat({ conversationId, text, attachments = [], images = [], channel = 'text', hint = '' }) {
    const { conversations, gemini, bus } = this.s;
    const conv = conversationId ? conversations.get(conversationId) : conversations.current();
    if (!conv) throw new Error('Gespräch nicht gefunden');
    const cid = conv.id;
    if (privacy.privateText(text) || attachments.length || images.length) conversations.markPrivate(cid);
    let userText = String(text || '').slice(0, 30000);
    const attachInfo = [];
    for (const a of attachments.slice(0, 5)) {
      attachInfo.push({ name: a.name, docId: a.docId });
      userText += `\n\n[Anhang: ${a.name}${a.docId ? ` (docId ${a.docId}, mit read_document lesbar)` : ''}]`;
    }
    for (const im of images.slice(0, 3)) attachInfo.push({ name: im.name || 'Bild', image: true });
    conversations.add(cid, { role: 'user', content: userText, meta: attachInfo.length ? { attachments: attachInfo } : {}, channel });
    conversations.autoTitle(cid, text || attachInfo[0]?.name || 'Gespräch');
    const msg = conversations.add(cid, { role: 'assistant', content: '', meta: { streaming: true }, channel });

    if (conversations.get(cid).privacy !== 'private' && !gemini.hasKey()) {
      const content = 'Ich brauche zuerst einen Gemini-API-Schlüssel, Chef. Öffne **Einstellungen → Gemini / KI** oder den Einrichtungsassistenten.';
      conversations.update(msg.id, { content, meta: { streaming: false, error: true } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id });
      return conversations.messages(cid, { limit: 1 })[0];
    }
    return this.run({ cid, msg, text, channel, images, hint });
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
    if (this.s.conversations.get(conversationId)?.privacy !== 'private' && !this.s.gemini.hasKey()) throw new Error('Kein Gemini-API-Schlüssel hinterlegt');
    const fresh = conversations.update(msg.id, { content: '', meta: { streaming: true, error: false, cards: [], sources: [] } });
    bus.emit('chat:retry', { conversationId, messageId });
    return this.run({ cid: conversationId, msg: fresh, text: user.content, channel: msg.channel || 'text', images: [], upTo: user.id });
  }

  async run({ cid, msg, text, channel, images = [], upTo, hint = '' }) {
    const { conversations, gemini, bus } = this.s;
    const isLocal = conversations.get(cid)?.privacy === 'private';
    const provider = isLocal ? this.s.localLLM : gemini;
    const ac = new AbortController();
    this.cancel(cid);
    this.active.set(cid, ac);
    const contents = conversations.history(cid, 14, 24000, upTo);
    if (images.length) {
      const lastUser = [...contents].reverse().find((c) => c.role === 'user');
      if (lastUser) lastUser.parts.unshift(...images.slice(0, 3).map((im) => ({ inlineData: { mimeType: im.mimeType || 'image/jpeg', data: im.data } })));
    }
    const role = needsReasoning(text) ? 'reasoning' : 'fast';
    const model = isLocal ? this.s.localLLM.cfg().model : gemini.model(role) || gemini.requireModel('fast');
    // Fester Teil der Anweisung + Werkzeuge + bisheriger Verlauf bleiben gleich → Googles Cache greift.
    // Wechselnder Kontext (Uhrzeit, Spiel, Gedächtnis) hängt nur an der neuesten Nutzernachricht (wird nicht gespeichert).
    const { stable, context } = isLocal ? this.systemSplit(channel, text) : { stable: 'Du bist JARVIS. Dieses Gespräch ist ausschließlich für freigegebene Uni-/Gaming-Inhalte. Für persönliche Themen einen neuen privaten Chat verlangen. Kein Zugriff auf private Daten.', context: '' };
    const lastUser = [...contents].reverse().find((c) => c.role === 'user');
    if (lastUser) lastUser.parts = [{ text: context }, ...lastUser.parts, ...(hint ? [{ text: hint }] : [])]; else contents.push({ role: 'user', parts: [{ text: context }] });
    const cards = []; const sources = []; let full = '';
    bus.emit('orb:state', { state: 'thinking' });
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (ac.signal.aborted || (!isLocal && conversations.get(cid)?.privacy === 'private')) throw new Error('Gespräch wurde auf Private gesetzt oder abgebrochen. Bitte lokal erneut senden.');
        const r = await provider.stepStream({
          model, system: stable, contents, tools: isLocal ? [{ functionDeclarations: this.declarations()[0].functionDeclarations.filter((t) => privacy.LOCAL_TOOLS.has(t.name)) }] : [{ functionDeclarations: this.declarations()[0].functionDeclarations.filter((t) => privacy.CLOUD_TOOLS.has(t.name)) }], signal: ac.signal, feature: channel === 'voice' ? 'voice' : 'chat', effort: role === 'reasoning' ? 'high' : 'low',
          onWait: (ms) => bus.emit('chat:tool', { conversationId: cid, messageId: msg.id, name: 'quota_wait', state: 'running', seconds: Math.round(ms / 1000) }),
          onText: (d) => { full += d; bus.emit('chat:delta', { conversationId: cid, messageId: msg.id, delta: d }); },
        });
        contents.push({ role: 'model', parts: r.parts.length ? r.parts : [{ text: r.text || '' }] });
        if (!r.functionCalls.length) break;
        const responses = [];
        for (const fc of r.functionCalls) {
          bus.emit('chat:tool', { conversationId: cid, messageId: msg.id, name: fc.name, state: 'running' });
          const execute = () => this.execute(fc.name, fc.args, { conversationId: cid, channel });
          const out = await (isLocal ? privacy.local(execute) : execute());
          if (out.card) { cards.push(out.card); bus.emit('chat:card', { conversationId: cid, messageId: msg.id, card: out.card }); }
          for (const src of out.response?.sources || []) if (src.url && !sources.some((x) => x.url === src.url)) sources.push(src);
          for (const res of out.response?.results || []) if (res.citation && !sources.some((x) => x.title === res.citation)) sources.push({ title: res.citation, docId: res.docId, page: res.page, kind: 'document' });
          responses.push({ functionResponse: { name: fc.name, id: fc.id, response: sanitizeResponse(out.response) } });
          bus.emit('chat:tool', { conversationId: cid, messageId: msg.id, name: fc.name, state: 'done' });
        }
        contents.push({ role: 'user', parts: responses });
        if (step === MAX_STEPS - 1) full += '\n\n_(Abgebrochen: zu viele Werkzeugschritte.)_';
      }
      const final = conversations.update(msg.id, { content: full.trim() || (cards.length ? '' : '…'), meta: { streaming: false, cards, sources: sources.slice(0, 12), model } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id });
      if (!isLocal && this.s.settings.get('voice').speakReplies && channel === 'text') bus.emit('tts:speak', { text: stripMd(final.content).slice(0, 1200) });
      return final;
    } catch (e) {
      // Lösungs-Marker → Markdown-Link (Chat rendert Markdown)
      const err = friendlyError(e).replace(/\s*⟨fix:([^|⟩]+)\|([^⟩]+)⟩/, (_, label, target) => (target.startsWith('https://') ? ` → [${label.trim()}](${target.trim()})` : ` → ${label.trim()}`));
      log.warn('Chat fehlgeschlagen', e);
      conversations.update(msg.id, { content: (full ? full + '\n\n' : '') + `⚠️ ${err}`, meta: { streaming: false, error: true, cards, sources } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id, error: err });
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
function sanitizeResponse(r) {
  const json = JSON.stringify(r ?? {}, (k, v) => (typeof v === 'string' ? truncate(v, 8000) : v));
  return JSON.parse(json.length > 60000 ? JSON.stringify({ truncated: true, data: json.slice(0, 60000) }) : json);
}
function stripMd(t) { return String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_#>`|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); }

module.exports = { Orchestrator };

