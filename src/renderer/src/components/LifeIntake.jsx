import { useState } from 'preact/hooks';
import { rpc, useRpc } from '../lib/api.js';
import { guard, setState } from '../lib/store.js';

export function LifeIntake({ compact = false }) {
  const [data, reload] = useRpc('intake.status', {}, { events: ['intake:changed', 'conversations:changed'] });
  const [busy, setBusy] = useState(false);
  if (!data || (compact && !data.offer)) return null;
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try { const r = await guard(() => rpc('intake.open')); if (r) setState({ conversationId: r.conversationId, page: 'chat' }); }
    finally { setBusy(false); reload(); }
  };
  const started = !!data.session && data.session.status !== 'done';
  return <section class="panel" style={{ padding: compact ? 12 : 16, flexShrink: 0 }}>
    <div class="row wrap gap-s">
      <div class="grow"><div class="hud-title">Deine Alltagsübersicht aufbauen</div>
        <p class="small muted">JARVIS fragt dich nacheinander nach Studium, Einnahmen, Kosten, Verträgen und offenen Dingen. Du brauchst keine fertige Liste.</p>
      </div>
      <button class="btn" disabled={busy} onClick={open}>{started ? 'Gespräch fortsetzen' : data.addressed ? 'Kurzer Alltagscheck' : 'Startgespräch beginnen'}</button>
      {compact && <button class="btn ghost" disabled={busy} onClick={() => guard(async () => { await rpc('intake.snooze'); reload(); })}>In einer Woche</button>}
    </div>
    <div class="small muted">{data.addressed} von {data.topics.length} Bereichen besprochen · {data.open} offen · {data.due} zur erneuten Prüfung. Keine Vollständigkeitsbewertung.</div>
    {!compact && <div class="col gap-s mt">
      {data.topics.map(t => <details key={t.id} class="panel" style={{ padding: 10 }}>
        <summary style={{ cursor: 'pointer' }}>{t.title} · {t.statusLabel}{t.draft ? ' · Entwurf' : ''}{t.stale ? ' · erneut prüfen' : ''}</summary>
        <p class="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.answer || t.question}</p>
        {t.reviewedAt && <p class="tiny muted">Zuletzt von dir geprüft: {new Date(t.reviewedAt).toLocaleDateString('de-DE')}</p>}
        {t.sourceConversationId && <button class="btn xs ghost" onClick={() => setState({ page: 'chat', conversationId: t.sourceConversationId })}>Originalgespräch öffnen</button>}
      </details>)}
      <p class="tiny muted">Angaben bleiben Notizen mit Originalquelle. Unbekannt bedeutet nicht 0 €. Aus diesem Gespräch werden noch keine Buchungen oder Kündigungen ausgeführt.</p>
    </div>}
  </section>;
}
