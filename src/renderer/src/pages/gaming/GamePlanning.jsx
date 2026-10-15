import { useState } from 'preact/hooks';
import { rpc, useRpc } from '../../lib/api.js';
import { guard } from '../../lib/store.js';

/**
 * Game-specific planning workspace. Goals are saved in the existing game
 * progress database (not a second, unsynchronised store).
 * Templates are suggestions, never claimed as imported game state.
 */
export const PLANS = Object.freeze({
  eft: ['Raid-Vorbereitung', 'Aktive Quests', 'Benötigte Items', 'Ausrüstung prüfen', 'Ausgänge und Karte'],
  league: ['Coaching-Ziel für nächste Runde', 'Wiederkehrenden Fehler notieren', 'Champion-Pool überprüfen', 'Match-Nachbesprechung'],
  ark: ['Zuchtlinie dokumentieren', 'Elterntiere und Mutationen', 'Schlüpf- und Prägungstermine', 'Boss-Tribute und Artefakte'],
  ark_asa: ['Zuchtlinie dokumentieren', 'Elterntiere und Mutationen', 'Schlüpf- und Prägungstermine', 'Boss-Tribute und Artefakte'],
  factorio: ['Produktionsziel definieren', 'Rezeptkette und benötigte Maschinen', 'Engpass dokumentieren', 'Verhältnis-Rechner verwenden'],
  stardew: ['Saisonplanung', 'Saatgut und Erntetermine', 'Community-Center-Bündel', 'Geburtstage und Geschenke'],
  cs2: ['Match-Review', 'Map-Training', 'Aiming-Ziel', 'Nächste Trainingssession'],
  valorant: ['Match-Review', 'Map-Training', 'Agenten-Training'],
  pubg: ['Match-Review', 'Drop-Spot analysieren', 'Ausrüstung optimieren'],
  apexlegends: ['Match-Review', 'Rotationsfehler analysieren', 'Legenden-Training'],
  fortnite: ['Match-Review', 'Drop-Spot analysieren', 'Build-Training'],
  assettocorsa: ['Setup für Fahrzeug und Strecke', 'Bestzeit dokumentieren', 'Reifendruck und Fahrwerk vergleichen'],
  raceroom: ['Setup für Fahrzeug und Strecke', 'Bestzeit dokumentieren', 'Fahrwerksänderungen vergleichen'],
  mxbikes: ['Setup für Motorrad und Strecke', 'Bestzeit dokumentieren', 'Federung vergleichen'],
  thecrew2: ['Fahrzeug-Setup dokumentieren', 'Bestzeit dokumentieren'],
  nfsheat: ['Fahrzeug-Setup dokumentieren', 'Bestzeit dokumentieren'],
});

export function GamePlanning({ game }) {
  const [data, reload] = useRpc('game.progress', { game: game.id }, { deps: [game.id], events: ['game:progress'] });
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const items = (data?.items || []).filter(x => x.category === 'other' && x.name.startsWith('Plan: '));
  const suggestions = PLANS[game.id] || ['Nächstes Ziel festlegen', 'Fortschritt überprüfen'];
  async function save(name, status = 'todo', extra = '') {
    setBusy(true);
    try {
      await rpc('game.progressUpsert', { game: game.id, item: { category: 'other', name: 'Plan: ' + name.slice(0, 110), status, note: extra.slice(0, 500) } });
      reload();
    } finally { setBusy(false); }
  }
  return <section class="panel" style={{ padding: 16 }}>
    <div class="row" style={{ gap: 8, marginBottom: 8 }}><strong>Mein Spielplan</strong><span class="tiny muted">Eigene Ziele · kein automatisch erkannter Spielstand</span></div>
    <div class="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      {suggestions.filter(n => !items.some(x => x.name === 'Plan: ' + n)).map(n =>
        <button key={n} class="btn xs" disabled={busy} onClick={() => guard(() => save(n), 'Ziel hinzugefügt')}>+ {n}</button>)}
    </div>
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map(item => <div key={item.id} class="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={item.status === 'done'} disabled={busy} aria-label={item.name + ' erledigt'} onChange={e => guard(() => save(item.name.slice(6), e.currentTarget.checked ? 'done' : 'todo', item.note || ''))} />
        <span style={{ flex: 1, textDecoration: item.status === 'done' ? 'line-through' : 'none' }}>{item.name.slice(6)}{item.note ? <span class="tiny muted"> · {item.note}</span> : null}</span>
        <button class="btn xs ghost" disabled={busy} onClick={() => guard(async () => { await rpc('game.progressRemove', { id: item.id }); reload(); })}>Entfernen</button>
      </div>)}
    </div>
    <form onSubmit={e => { e.preventDefault(); if (!draft.trim()) return; guard(async () => { await save(draft.trim(), 'todo', note); setDraft(''); setNote(''); }, 'Ziel gespeichert'); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
      <input class="inp" style={{ flex: '2 1 170px' }} maxLength={110} placeholder="Eigenes Ziel" value={draft} onInput={e => setDraft(e.currentTarget.value)} />
      <input class="inp" style={{ flex: '2 1 170px' }} maxLength={500} placeholder="Notiz, Werte oder Setup" value={note} onInput={e => setNote(e.currentTarget.value)} />
      <button class="btn sm" type="submit" disabled={busy || !draft.trim()}>Speichern</button>
    </form>
  </section>;
}
