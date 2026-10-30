'use strict';
const { safeJson, nowIso, normText, truncate } = require('../core/util');

// Examples guide the conversation. None of them becomes a fact about the user.
const TOPICS = [
  { id: 'situation', title: 'Wohnen & Alltag', days: 90, question: 'Wie wohnst du gerade – bei Familie, in einer WG oder allein – und welche Alltagsdinge organisierst du selbst? Eine grobe Beschreibung reicht.' },
  { id: 'study', title: 'Studium & Praxis', days: 30, question: 'Was studierst du, in welcher Theorie- oder Praxisphase bist du gerade und was steht als Nächstes an? Zum Beispiel ein Phasenwechsel, eine Prüfung oder eine Abgabe.' },
  { id: 'income', title: 'Einnahmen', days: 30, question: 'Welche regelmäßigen Einnahmen bekommst du ungefähr? Falls du Beträge nennen möchtest: netto oder brutto und monatlich oder anders? Unbekannte Beträge dürfen offenbleiben.' },
  { id: 'costs', title: 'Laufende Kosten', days: 30, question: 'Was bezahlst du regelmäßig selbst? Denk zum Beispiel an Wohnen, Fahrtkosten, Lebensmittel und Handy. Auch jährliche Zahlungen sind wichtig; grobe Schätzungen bitte als solche nennen.' },
  { id: 'contracts', title: 'Verträge & Abos', days: 60, question: 'Welche Verträge oder Abos fallen dir ein – etwa Handy, Internet, Streaming, Fitnessstudio oder Versicherungen? Wer bezahlt sie? Namen reichen zunächst; Preis und Kündigungsfrist können wir später am Dokument prüfen.' },
  { id: 'deadlines', title: 'Fristen & Papierkram', days: 14, question: 'Liegt gerade etwas herum, um das du dich kümmern musst? Zum Beispiel ein Brief, eine Rechnung, ein Formular, eine Rückgabe oder Unterlagen für Hochschule oder Arbeitgeber.' },
  { id: 'priorities', title: 'Was dich entlastet', days: 30, question: 'Was soll JARVIS dir zuerst abnehmen: Geldüberblick, Verträge, Studienorganisation oder etwas anderes? Und wie oft möchtest du deine Übersicht kurz prüfen?' },
];
const LABELS = { captured: 'Angabe erfasst', unknown: 'Noch unbekannt', skipped: 'Später klären', not_applicable: 'Trifft laut dir nicht zu', missing: 'Noch nicht besprochen' };
const START = /^(?:(?:bitte\s+)?(?:starte?|beginne?|mach(?:e)?)(?:\s+bitte)?\s+(?:(?:mein|das|ein)\s+)?)?(?:startbriefing|startgespräch|bestandsaufnahme|alltagscheck|alltagsbriefing)(?:\s+(?:starten|beginnen|fortsetzen))?[.!?]*$/i;
const RESUME = /^(?:startbriefing|alltagscheck|bestandsaufnahme)\s+(?:weiter|fortsetzen)[.!?]*$/i;
const HELP = 'Antworte in deinen Worten. „Weiß ich nicht“, „später“ und „trifft nicht zu“ sind okay. Mit „Pause“ unterbrichst du das Gespräch. Am Ende prüfst du die Übersicht.';

class LifeIntake {
  constructor(s) { this.s = s; }
  session() { return this.s.db.get('SELECT * FROM life_intake_session WHERE id=1') || null; }
  active(cid) { const x = this.session(); return !!x && x.conversation_id === cid && ['active', 'review'].includes(x.status); }
  wantsStart(text) { return START.test(String(text).trim()) || RESUME.test(String(text).trim()); }
  emit() { this.s.bus.emit('intake:changed', {}); }

  snapshot() {
    const session = this.session();
    const rows = this.s.db.all(`SELECT a.*, COALESCE(o.content,m.content) content, COALESCE(o.conversation_id,m.conversation_id) conversation_id
      FROM life_intake_answers a JOIN messages m ON m.id=a.message_id LEFT JOIN messages o ON o.id=a.source_message_id ORDER BY a.id DESC`);
    const topics = TOPICS.map(t => {
      const answer = rows.find(a => a.topic === t.id && (a.reviewed_at || a.round === session?.round));
      const checked = answer?.reviewed_at;
      return { ...t, status: answer?.status || 'missing', statusLabel: LABELS[answer?.status || 'missing'],
        answer: answer?.content || '', sourceMessageId: answer?.source_message_id || answer?.message_id || null, sourceConversationId: answer?.conversation_id || null,
        capturedAt: answer?.captured_at || null, reviewedAt: checked || null,
        draft: !!answer && !checked, stale: !!checked && Date.now() - Date.parse(checked) >= t.days * 86400000 };
    });
    const addressed = topics.filter(t => t.reviewedAt).length;
    const open = topics.filter(t => !t.reviewedAt || ['unknown', 'skipped'].includes(t.status));
    const due = topics.filter(t => t.stale);
    const snoozed = session?.snoozed_until && session.snoozed_until > nowIso();
    return { session: session ? { status: session.status, conversationId: session.conversation_id, cursor: session.cursor, total: safeJson(session.topics, []).length } : null,
      topics, addressed, open: open.length, due: due.length,
      offer: !snoozed && (!session || session.status !== 'done' || addressed < TOPICS.length || due.length > 0),
      complete: addressed === TOPICS.length, note: 'Besprochen heißt nicht vollständig. Fehlende Angaben sind keine Nullwerte.' };
  }

  begin(cid) {
    if (!this.s.conversations.get(cid)) throw new Error('Gespräch nicht gefunden');
    // The whole guided conversation is private, including short answers such as "1200".
    this.s.conversations.markPrivate(cid);
    let x = this.session();
    if (x && x.status !== 'done') {
      if (!x.conversation_id) {
        this.s.db.run('UPDATE life_intake_session SET cursor=0 WHERE id=1');
        x = this.session();
      }
      const status = x.cursor >= safeJson(x.topics, []).length ? 'review' : 'active';
      this.s.db.run('UPDATE life_intake_session SET conversation_id=?,status=?,snoozed_until=NULL,updated_at=? WHERE id=1', cid, status, nowIso());
    } else {
      const overview = this.snapshot();
      const pending = overview.topics.filter(t => !t.reviewedAt || t.stale || ['unknown', 'skipped'].includes(t.status)).map(t => t.id);
      const topics = pending.length ? pending : TOPICS.map(t => t.id);
      this.s.db.run(`INSERT INTO life_intake_session(id,conversation_id,round,status,topics,cursor,updated_at)
        VALUES(1,?,?,'active',?,0,?) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,round=excluded.round,status='active',topics=excluded.topics,cursor=0,updated_at=excluded.updated_at,snoozed_until=NULL`,
      cid, (x?.round || 0) + 1, JSON.stringify(topics), nowIso());
    }
    this.emit();
    return 'Wir bauen deine Alltagsübersicht Schritt für Schritt auf. Deine Antworten bleiben zunächst als Notizen mit Originalquelle erhalten; daraus werden noch keine Buchungen, Verträge oder Termine angelegt.\n\n' + HELP + '\n\n' + this.question();
  }

  open() {
    const x = this.session();
    const existing = x?.conversation_id && this.s.conversations.get(x.conversation_id);
    const c = existing || this.s.conversations.create('Mein Alltagsbriefing', 'private');
    const text = this.begin(c.id);
    this.s.conversations.add(c.id, { role: 'assistant', content: text, meta: { scope: 'private', deterministic: 'life-intake' } });
    return { conversationId: c.id };
  }

  question() {
    const x = this.session();
    if (!x) return '';
    const ids = safeJson(x.topics, []);
    if (x.cursor >= ids.length) return this.review();
    const t = TOPICS.find(t => t.id === ids[x.cursor]);
    const prev = this.snapshot().topics.find(p => p.id === t.id);
    const before = prev?.reviewedAt ? `\nLetzter besprochener Stand (${prev.reviewedAt.slice(0, 10)}): ${truncate(prev.answer, 500)}\nWenn das noch stimmt, sag „unverändert“.\n` : '';
    return `**${x.cursor + 1}/${ids.length} · ${t.title}**\n${before}\n${t.question}`;
  }

  review() {
    const x = this.session();
    const rows = this.s.db.all(`SELECT a.topic,a.status,COALESCE(o.content,m.content) content FROM life_intake_answers a
      JOIN messages m ON m.id=a.message_id LEFT JOIN messages o ON o.id=a.source_message_id WHERE a.round=? ORDER BY a.id`, x.round);
    return '**Deine Bestandsaufnahme – bitte prüfen**\n\n' + rows.map(r => `- **${TOPICS.find(t => t.id === r.topic)?.title}:** ${LABELS[r.status]}\n  ${truncate(r.content.replace(/\s+/g, ' '), 700)}`).join('\n') +
      '\n\nDas sind deine Angaben, keine geprüften Vertragsdaten und kein vollständiger Finanzplan. Mit „übernehmen“ bestätigst du diese Notizen. Mit „zurück“ korrigierst du die letzte Antwort; „Pause“ verschiebt die Prüfung. Die vollständigen Antworten stehen im Chat.';
  }

  handle({ cid, messageId, text }) {
    if (this.wantsStart(text)) return { text: this.begin(cid), deterministic: 'life-intake' };
    if (!this.active(cid)) return null;
    const result = text => ({ text, deterministic: 'life-intake' });
    const x = this.session();
    const cmd = normText(text).replace(/ß/g, 'ss');
    if (['pause', 'stopp', 'stop', 'abbrechen', 'spater weitermachen'].includes(cmd)) {
      this.s.db.run("UPDATE life_intake_session SET status='paused',updated_at=? WHERE id=1", nowIso()); this.emit();
      return result('Pausiert. Deine bisherigen Antworten bleiben als Entwurf erhalten. Sag „Startbriefing fortsetzen“, wenn es passt. Du kannst jetzt normal mit mir sprechen.');
    }
    if (['zuruck', 'zuruck bitte'].includes(cmd)) {
      this.s.db.run("UPDATE life_intake_session SET cursor=MAX(0,cursor-1),status='active',updated_at=? WHERE id=1", nowIso()); this.emit();
      return result(this.question());
    }
    if (x.status === 'review') {
      if (!['ubernehmen', 'bitte ubernehmen', 'passt ubernehmen'].includes(cmd)) return result(this.review());
      this.s.db.tx(() => {
        this.s.db.run('UPDATE life_intake_answers SET reviewed_at=? WHERE round=?', nowIso(), x.round);
        this.s.db.run("UPDATE life_intake_session SET status='done',completed_at=?,updated_at=? WHERE id=1", nowIso(), nowIso());
      }); this.emit();
      return result('Deine Bestandsaufnahme ist unter Alltag gespeichert. Unbekannte und übersprungene Bereiche bleiben offen. Beträge werden noch nicht als Einnahmen oder Ausgaben gebucht; Verträge und Fristen müssen wir dafür gezielt prüfen. Mit „Alltagscheck“ kannst du später den Stand aktualisieren.');
    }
    const m = this.s.db.get('SELECT * FROM messages WHERE id=? AND conversation_id=? AND role=\'user\'', messageId, cid);
    if (!m) throw new Error('Originalnachricht fehlt');
    if (this.s.db.get('SELECT 1 FROM life_intake_answers WHERE message_id=?', messageId)) return result(this.question());
    if (['hilfe', 'was meinst du', 'was soll ich sagen'].includes(cmd) || !cmd || cmd.length < 2) return result(HELP + '\n\n' + this.question());
    const topic = safeJson(x.topics, [])[x.cursor];
    let status = ['weiss ich nicht', 'weis ich nicht', 'keine ahnung', 'unbekannt'].includes(cmd) ? 'unknown'
      : ['spater', 'uberspringen', 'weiter'].includes(cmd) ? 'skipped'
        : ['trifft nicht zu', 'nicht zutreffend'].includes(cmd) ? 'not_applicable' : 'captured';
    let source = null;
    if (['unverandert', 'alles unverandert', 'ist noch so'].includes(cmd)) {
      const prev = this.s.db.get('SELECT * FROM life_intake_answers WHERE topic=? AND reviewed_at IS NOT NULL ORDER BY id DESC LIMIT 1', topic);
      if (!prev) return result('Dazu haben wir noch keinen bestätigten Stand. ' + this.question());
      // Reference the original assertion; renew its date only after the final review.
      status = prev.status; source = prev.source_message_id || prev.message_id;
    }
    this.s.db.tx(() => {
      this.s.db.run('DELETE FROM life_intake_answers WHERE round=? AND topic=? AND reviewed_at IS NULL', x.round, topic);
      this.s.db.run('INSERT INTO life_intake_answers(round,topic,message_id,source_message_id,status,captured_at) VALUES(?,?,?,?,?,?)', x.round, topic, messageId, source, status, m.created_at);
      const next = x.cursor + 1;
      this.s.db.run('UPDATE life_intake_session SET cursor=?,status=?,updated_at=? WHERE id=1', next, next >= safeJson(x.topics, []).length ? 'review' : 'active', nowIso());
    }); this.emit();
    return result((status === 'captured' ? 'Als Angabe notiert.' : LABELS[status] + '.') + '\n\n' + this.question());
  }

  snooze() {
    const until = new Date(Date.now() + 7 * 86400000).toISOString();
    if (!this.session()) this.s.db.run("INSERT INTO life_intake_session(id,round,status,topics,cursor,updated_at) VALUES(1,0,'paused',?,0,?)", JSON.stringify(TOPICS.map(t => t.id)), nowIso());
    this.s.db.run('UPDATE life_intake_session SET snoozed_until=? WHERE id=1', until); this.emit();
    return { until };
  }
}

module.exports = { LifeIntake, TOPICS, LABELS };
