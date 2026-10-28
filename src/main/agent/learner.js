'use strict';
/**
 * Brain selbstständig erweitern: Nach einer Antwort prüft dasselbe Modell, das geantwortet hat, ob etwas
 * dauerhaft Nützliches dabei war – private Nachrichten das lokale Modell, öffentliche Gemini (Sparmodell).
 * - Nur Dauerhaftes: Vorlieben, Ziele, Projekte, Gewohnheiten, Entscheidungen; Wissen nur mit Quelle.
 * - Sensibles wird nie automatisch gespeichert (Brain lehnt es ab); Duplikate/Änderungen erkennt das Brain.
 * - Läuft im Hintergrund, blockiert nichts; Gemini höchstens LEARN_DAILY_CLOUD-mal am Tag.
 */
const log = require('../core/logger').scope('learner');
const privacy = require('../core/privacy');

const LEARN_DAILY_CLOUD = 40;
const MIN_GAP_MS = 20000;
const SCHEMA = {
  type: 'object', required: ['entries'],
  properties: { entries: { type: 'array', maxItems: 2, items: { type: 'object', required: ['title', 'content', 'domain', 'kind'], properties: {
    title: { type: 'string' }, content: { type: 'string' },
    domain: { type: 'string', enum: ['projects', 'study', 'knowledge', 'memories', 'ideas', 'personal', 'technology', 'gaming'] },
    kind: { type: 'string', enum: ['memory', 'preference', 'fact', 'idea', 'experience', 'project', 'note'] },
    subjectKey: { type: 'string' }, game: { type: 'string' }, sourceUrl: { type: 'string' },
  } } } },
};
const SYSTEM = [
  'Du pflegst das Langzeitgedächtnis („Brain“) des persönlichen Assistenten JARVIS. Prüfe den folgenden Austausch.',
  'Speichere nur, was in Wochen noch nützlich und wahr ist:',
  '- was der Nutzer über sich sagt: Vorlieben, Ziele, Projekte, Gewohnheiten, Entscheidungen, Personen in seinem Leben, seine Spiele/Mains/Builds, Studienfächer;',
  '- Wissen nur, wenn es durch eine angegebene Quelle belegt ist (dann sourceUrl setzen).',
  'Nicht speichern: Smalltalk, einmalige Fragen, Vermutungen, Antworten des Assistenten als Fakt über den Nutzer, Uhrzeiten/Wetter, bereits Gespeichertes,',
  'Gesundheit, Finanzbeträge, Religion, Politik, Sexualität (außer der Nutzer bittet ausdrücklich darum).',
  'Kurz und eigenständig formulieren (ein Satz, 3. Person: „Der Nutzer …“). Für Dinge, die sich ändern können, einen stabilen subjectKey (z. B. „lol-main-champion“).',
  'Meist ist nichts zu speichern – dann {"entries":[]}. Höchstens 2 Einträge.',
].join('\n');

class Learner {
  constructor(s) { this.s = s; this.last = new Map(); this.running = new Set(); }

  enabled() { return this.s.settings.get('autoMemory') !== false && this.s.settings.get('brainAutoLearn') !== false; }

  cloudCount() { const d = new Date().toISOString().slice(0, 10); return Number(this.s.db.get('SELECT value FROM meta WHERE key=?', 'learn:cloud:' + d)?.value || 0); }
  bumpCloud() { const d = new Date().toISOString().slice(0, 10); this.s.db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'learn:cloud:' + d, String(this.cloudCount() + 1)); }

  /** Lohnt sich ein Lernschritt? (ohne KI) */
  worth({ userText, scope, usedRemember }) {
    const t = String(userText || '').trim();
    if (!this.enabled() || usedRemember || t.length < 12) return false;
    if (/^(?:hi|hallo|hey|danke|ok(?:ay)?|ja|nein|cool|nice|super)\b[\s!.?]*$/i.test(t)) return false;
    if (scope !== 'private' && this.cloudCount() >= LEARN_DAILY_CLOUD && !this.s.groq?.available()) return false;
    return true;
  }

  /** Nach einer Antwort im Hintergrund aufrufen. Gibt die gespeicherten Einträge zurück. */
  async learn({ cid, messageId, userText, answer, scope, sources = [], usedRemember = false }) {
    if (!this.worth({ userText, scope, usedRemember })) return [];
    const key = (cid || 'x') + (scope === 'private' ? ':lokal' : ':cloud');
    // Gemini-Lernschritte höchstens alle 20 s pro Gespräch (Kosten); lokal nur einer gleichzeitig
    if (this.running.has(key) || (scope !== 'private' && Date.now() - (this.last.get(key) || 0) < MIN_GAP_MS)) return [];
    this.running.add(key); this.last.set(key, Date.now());
    try {
      const isPrivate = scope === 'private';
      const src = sources.filter((x) => x.url).slice(0, 5).map((x) => `- ${x.title || x.url}: ${x.url}`).join('\n');
      const contents = [{ role: 'user', parts: [{ text: `Nutzer: ${String(userText).slice(0, 2000)}\n\nAssistent: ${String(answer || '').slice(0, 2500)}${src ? '\n\nQuellen:\n' + src : ''}` }] }];
      const run = () => this.s.gemini.generate({ system: SYSTEM, contents, json: true, schema: SCHEMA, feature: 'chat', tier: 'lite', background: true, maxOut: 500, temperature: 0.2 });
      // Private Nachrichten: nur das lokale Modell (privacy.local erzwingt das); öffentliche: Gemini-Sparmodell.
      if (isPrivate && !this.s.localLLM?.cfg().model) return [];
      // Öffentlich: zuerst Groq (kostenlos), sonst Gemini-Sparmodell (zählt gegen das Tageslimit)
      const viaGroq = () => privacy.cloud(() => this.s.groq.generate({ system: SYSTEM, contents, json: true, schema: SCHEMA, maxOut: 500, temperature: 0.2 }));
      const viaGemini = () => { this.bumpCloud(); return privacy.cloud(run); };
      const out = isPrivate ? await privacy.local(run) : this.s.groq?.available() ? await viaGroq().catch(() => viaGemini()) : await viaGemini();
      const saved = [];
      for (const e of (out?.entries || []).slice(0, 2)) {
        if (!e?.content || String(e.content).length < 8) continue;
        const gid = e.game ? this.s.gaming?.context?.resolve?.(e.game)?.id : undefined;
        const r = this.s.brain.add({
          title: String(e.title || '').slice(0, 120), content: String(e.content).slice(0, 1000), domain: isPrivate && e.domain === 'knowledge' ? 'personal' : e.domain, kind: e.kind,
          subjectKey: e.subjectKey || undefined, game: gid, sourceType: 'chat', sourceUrl: !isPrivate && /^https:\/\//.test(e.sourceUrl || '') ? e.sourceUrl : undefined,
          tags: ['automatisch', isPrivate ? 'lokal' : 'gemini'],
        }, { auto: true });
        if (r.entry && ['created', 'superseded', 'conflict'].includes(r.action)) saved.push({ id: r.entry.id, title: r.entry.title, action: r.action });
      }
      if (saved.length && messageId) this.s.conversations.update(messageId, { meta: { learned: saved } });
      if (saved.length) log.info(`Brain: ${saved.length} Eintrag/Einträge automatisch gelernt (${isPrivate ? 'lokal' : 'Gemini'})`);
      return saved;
    } catch (e) { log.debug('Lernschritt übersprungen: ' + e.message); return []; } finally { this.running.delete(key); }
  }
}

module.exports = { Learner, SYSTEM, LEARN_DAILY_CLOUD };
