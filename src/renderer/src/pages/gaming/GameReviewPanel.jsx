import { useState } from 'preact/hooks';
import { rpc, useRpc } from '../../lib/api.js';
import { guard } from '../../lib/store.js';

/** Screenshot extraction is user initiated. Nothing is saved before confirmation. */
function parseSuggestions(text) {
  const cleaned = String(text || '').trim().replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '');
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Keine strukturierte Erkennung. Bitte erneut versuchen.');
  return parsed;
}
export function GameReviewPanel({ game }) {
  const [memory, reload] = useRpc('game.memory', { game: game.id }, { deps: [game.id], events: ['game:progress'] });
  const [stage, setStage] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function analyze() {
    setBusy(true); setError(''); setStage(null);
    try {
      const response = await rpc('screen.ask', { question: 'Analysiere nur sichtbare, eindeutig lesbare Werte zum aktiven Spiel ' + game.name + '. Antworte ausschließlich als JSON-Array (maximal 20 Objekte) mit category (character,quest,commander,building,research,hero,item,skill,creature,base,achievement,resource,other), name, value, note und status (todo,in_progress,done,failed oder null). Wenn nichts sicher erkennbar ist, antworte []. Erfinde nichts. Keine anderen Inhalte.' });
      const entries = parseSuggestions(response?.content);
      if (!entries.length) { setError('Keine sicher erkennbaren Spieldaten gefunden.'); return; }
      const result = await rpc('game.reviewStage', { game: game.id, entries });
      setStage(result); setSelected(result.changes.map((_, i) => i));
    } catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  }
  async function finish(accept) {
    if (!stage) return;
    setBusy(true);
    try {
      if (accept) await rpc('game.reviewConfirm', { token: stage.token, indices: selected });
      else await rpc('game.reviewReject', { token: stage.token });
      setStage(null); setSelected([]); reload(); setError('');
    } catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  }
  return <section class="panel" style={{ padding: 16 }}>
    <strong>Spielgedächtnis & Screenshot-Prüfung</strong>
    <p class="small muted">Gespeicherte Angaben können veraltet sein. Ein Screenshot wird nur nach deinem Klick analysiert und kann dabei an den konfigurierten KI-Anbieter übertragen werden. Ohne Bestätigung wird nichts übernommen.</p>
    <div class="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span class="chip">{memory?.total || 0} gespeicherte Einträge</span>
      <span class="chip">{memory?.open?.length || 0} offene Einträge (Auswahl)</span>
      <button class="btn sm" disabled={busy} onClick={analyze}>Screenshot analysieren</button>
    </div>
    {(memory?.open || []).slice(0, 5).map(x => <div key={x.id} class="small" style={{ marginTop: 5 }}>• {x.name}{x.value ? ': ' + x.value : ''}</div>)}
    {error && <p class="small" role="alert">{error}</p>}
    {stage && <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      <strong>Erkannte Änderungen prüfen</strong>
      {stage.changes.map((change, i) => <label key={i} class="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={selected.includes(i)} onChange={e => setSelected(prev => e.currentTarget.checked ? [...prev, i] : prev.filter(x => x !== i))} />
        <span class="small"><b>{change.item.name}</b> · {change.change === 'new' ? 'Neu' : change.change === 'changed' ? 'Geändert' : 'Unverändert'}<br/>
          {change.previous ? 'Vorher: ' + (change.previous.value || '—') + ' → ' : ''}Erkannt: {change.item.value || '—'}
        </span>
      </label>)}
      <div class="row" style={{ gap: 8 }}>
        <button class="btn sm" disabled={busy || !selected.length} onClick={() => finish(true)}>Auswahl übernehmen</button>
        <button class="btn sm ghost" disabled={busy} onClick={() => finish(false)}>Verwerfen</button>
      </div>
    </div>}
  </section>;
}
