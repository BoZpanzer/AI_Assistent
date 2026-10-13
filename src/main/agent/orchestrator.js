'use strict';
const { validate, toGeminiSchema } = require('../core/validate');
const { truncate } = require('../core/util');
const { buildTools, internalTools } = require('./tools');
const { systemPrompt, needsReasoning } = require('./prompts');
const { friendlyError } = require('../providers/gemini');
const log = require('../core/logger').scope('agent');

const MAX_STEPS = 7;

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

  system(channel, userText = '') {
    const settings = this.s.settings.all();
    let progress = '';
    try { progress = this.s.gaming.progressContext(userText); } catch { /* never block a reply */ }
    const extra = [];
    for (const fn of this.s.contextProviders || []) { try { const t = fn(userText, channel); if (t) extra.push(t); } catch { /* ignore */ } }
    return systemPrompt({ settings, primer: this.s.brain.personalPrimer(), game: this.s.gaming.context.state(), progress: [progress, ...extra].filter(Boolean).join('\n\n'), channel });
  }

  /**
   * Execute a tool call coming from any channel. Returns the function response
   * object and an optional UI card.
   */
  async execute(name, rawArgs, { conversationId, channel = 'text' } = {}) {
    const tool = this.byName[name];
    if (!tool) return { response: { error: 'Unbekanntes Werkzeug ' + name } };
    const v = validate(tool.schema, rawArgs || {});
    if (!v.ok) return { response: { error: 'Ungültige Argumente: ' + v.errors.join('; ') } };
    const args = v.value;
    try {
      if (tool.mode === 'confirm') {
        const sum = await tool.summarize(args);
        const c = this.s.confirmations.create({ tool: name, args, summary: sum.summary, details: sum.details, conversationId, run: (a) => tool.run(a) });
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
  async chat({ conversationId, text, attachments = [], images = [], channel = 'text' }) {
    const { conversations, gemini, bus } = this.s;
    const conv = conversationId ? conversations.get(conversationId) : conversations.current();
    if (!conv) throw new Error('Gespräch nicht gefunden');
    const cid = conv.id;
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

    if (!gemini.hasKey()) {
      const content = 'Ich brauche zuerst einen Gemini-API-Schlüssel, Chef. Öffne **Einstellungen → Gemini / KI** oder den Einrichtungsassistenten.';
      conversations.update(msg.id, { content, meta: { streaming: false, error: true } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id });
      return conversations.messages(cid, { limit: 1 })[0];
    }

    const ac = new AbortController();
    this.cancel(cid);
    this.active.set(cid, ac);
    const contents = conversations.history(cid, 14);
    if (images.length) {
      const lastUser = [...contents].reverse().find((c) => c.role === 'user');
      if (lastUser) for (const im of images.slice(0, 3)) lastUser.parts.unshift({ inlineData: { mimeType: im.mimeType || 'image/jpeg', data: im.data } });
    }
    const role = needsReasoning(text) ? 'reasoning' : 'fast';
    const model = gemini.model(role) || gemini.requireModel('fast');
    const cards = []; const sources = []; let full = '';
    bus.emit('orb:state', { state: 'thinking' });
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const r = await gemini.stepStream({
          model, system: this.system(channel, text), contents, tools: this.declarations(), signal: ac.signal,
          onText: (d) => { full += d; bus.emit('chat:delta', { conversationId: cid, messageId: msg.id, delta: d }); },
        });
        contents.push({ role: 'model', parts: r.parts.length ? r.parts : [{ text: r.text || '' }] });
        if (!r.functionCalls.length) break;
        const responses = [];
        for (const fc of r.functionCalls) {
          bus.emit('chat:tool', { conversationId: cid, messageId: msg.id, name: fc.name, state: 'running' });
          const out = await this.execute(fc.name, fc.args, { conversationId: cid, channel });
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
      if (this.s.settings.get('voice').speakReplies && channel === 'text') bus.emit('tts:speak', { text: stripMd(final.content).slice(0, 1200) });
      return final;
    } catch (e) {
      const err = friendlyError(e);
      log.warn('Chat fehlgeschlagen', e);
      conversations.update(msg.id, { content: (full ? full + '\n\n' : '') + `⚠️ ${err}`, meta: { streaming: false, error: true, cards, sources } });
      bus.emit('chat:done', { conversationId: cid, messageId: msg.id, error: err });
      return conversations.messages(cid, { limit: 1 })[0];
    } finally {
      this.active.delete(cid);
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
