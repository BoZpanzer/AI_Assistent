import { useState } from 'preact/hooks';
import { Timer, Skull, ListChecks, Calculator, Plus, Trash2, Check, RotateCcw } from 'lucide-preact';
import { rpc, useRpc } from '../../lib/api.js';
import { guard } from '../../lib/store.js';
import { Panel, Checkbox, Empty, Select, useNow } from '../../components/ui.jsx';
import { countdown } from '../../lib/format.js';

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`);
const time = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Feldbosse (Respawn ab Kill) + feste Events (Kaira, Belagerung, Executors). Countdowns erscheinen auch im Overlay. */
export function Aion2Bosses() {
  const now = useNow(1000);
  const [q, setQ] = useState(''); const [zone, setZone] = useState('');
  const [ev] = useRpc('aion2.events', {}, { events: ['game:data', 'settings:changed'] });
  const [b, reload] = useRpc('aion2.bosses', { query: q, zone }, { deps: [q, zone], events: ['game:data', 'game:timers'], debounce: 200 });
  const [edit, setEdit] = useState(null);
  const kill = async (id, minutesAgo = 0) => { await guard(() => rpc('aion2.killed', { id, minutesAgo }), 'Respawn-Timer läuft – auch im Overlay'); reload(); };
  return (
    <Panel icon={Skull} title="Boss- & Event-Timer" sub={`Serverzeit ${ev?.regionLabel || 'Europa'} · Respawn startet mit dem Kill`}>
      {(ev?.events || []).map((e) => (
        <div class="row small" style={{ padding: '3px 0' }}>
          <span class="grow"><b>{e.name}</b>{e.pvp ? <span class="chip static" style={{ marginLeft: 6 }}>PvP</span> : null}<div class="tiny muted">{e.where}</div></span>
          <span style={{ textAlign: 'right' }}>{e.running ? <b style={{ color: 'var(--green)' }}>läuft · noch {countdown(e.end)}</b> : <b>{countdown(e.start)}</b>}<div class="tiny muted">{time(e.start)}</div></span>
        </div>
      ))}
      <div class="row gap-s mt"><input class="inp grow" placeholder="Feldboss oder Gebiet suchen …" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        <Select style={{ width: 120 }} value={zone} onChange={setZone} options={[{ value: '', label: 'Alle Gebiete' }, ...(b?.zones || []).map((z) => ({ value: z, label: z }))]} /></div>
      <div class="col mt" style={{ gap: 4, maxHeight: 300, overflow: 'auto' }}>
        {(b?.bosses || []).map((x) => {
          const due = x.nextSpawn && Date.parse(x.nextSpawn) <= now;
          return <div class="row small" style={{ gap: 6, alignItems: 'center' }}>
            <span class="grow ellipsis" title={`${x.zone} · ${x.area}`}><b>{x.name}</b> <span class="tiny muted">{x.zone} · {x.area}</span></span>
            {edit === x.id
              ? <input class="inp" type="number" min="5" style={{ width: 70 }} defaultValue={x.respawn} title="Respawn in Minuten" onChange={(e) => guard(() => rpc('aion2.setRespawn', { id: x.id, minutes: e.currentTarget.value })).then(() => { setEdit(null); reload(); })} />
              : <span class="tiny muted" style={{ cursor: 'pointer' }} title="Respawn-Zeit ändern" onClick={() => setEdit(x.id)}>{fmtMin(x.respawn)}{x.edited ? '*' : ''}</span>}
            <span style={{ width: 92, textAlign: 'right' }}>{x.nextSpawn ? (due ? <b style={{ color: 'var(--green)' }}>da?</b> : <b>{countdown(x.nextSpawn)}</b>) : <span class="tiny muted">–</span>}</span>
            <button class="btn xs" title="Jetzt getötet" onClick={() => kill(x.id)}>✓ tot</button>
            {x.lastKill && <button class="btn xs ghost" title="Timer löschen" onClick={() => guard(() => rpc('aion2.clearKill', { id: x.id })).then(reload)}><RotateCcw size={11} /></button>}
          </div>;
        })}
        {b && !b.bosses.length && <Empty>Kein Boss gefunden.</Empty>}
      </div>
      <div class="tiny muted mt">{b?.source} · * = eigene Respawn-Zeit (auf die Zeit klicken zum Ändern)</div>
    </Panel>
  );
}

/** Daily-/Weekly-Tracker (setzt sich beim Reset selbst zurück) + Regenerations-Rechner. */
export function Aion2Resets() {
  const now = useNow(30000);
  const [t, reload] = useRpc('aion2.tasks', {}, { events: ['game:data', 'settings:changed'] });
  const [kinds] = useRpc('aion2.regenKinds', {}, { initial: [] });
  const [label, setLabel] = useState(''); const [period, setPeriod] = useState('daily');
  const [kind, setKind] = useState('odyle'); const [cur, setCur] = useState(''); const [rg, setRg] = useState(null);
  const [cd, setCd] = useState('');
  void now;
  if (!t) return null;
  const list = (p) => t.tasks.filter((x) => x.period === p);
  const row = (x) => <div class="row small" style={{ gap: 6 }}><Checkbox checked={x.done} onChange={(v) => guard(() => rpc('aion2.toggleTask', { id: x.id, done: v })).then(reload)} /><span class="grow" style={x.done ? { textDecoration: 'line-through', opacity: 0.6 } : null}>{x.label}</span>{String(x.id).startsWith('own-') && <button class="btn xs ghost" onClick={() => guard(() => rpc('aion2.removeTask', { id: x.id })).then(reload)}><Trash2 size={11} /></button>}</div>;
  return (
    <Panel icon={ListChecks} title="Daily / Weekly" sub={`Täglicher Reset in ${countdown(t.nextDaily)} · wöchentlich in ${countdown(t.nextWeekly)}`}>
      <div class="row gap-s"><b class="small grow">Täglich</b><span class="tiny muted">{list('daily').filter((x) => x.done).length}/{list('daily').length}</span></div>
      {list('daily').map(row)}
      <div class="row gap-s mt"><b class="small grow">Wöchentlich (Mittwoch)</b><span class="tiny muted">{list('weekly').filter((x) => x.done).length}/{list('weekly').length}</span></div>
      {list('weekly').map(row)}
      <div class="row gap-s mt"><input class="inp grow" placeholder="Eigene Aufgabe …" value={label} onInput={(e) => setLabel(e.currentTarget.value)} />
        <Select style={{ width: 110 }} value={period} onChange={setPeriod} options={[{ value: 'daily', label: 'täglich' }, { value: 'weekly', label: 'wöchentlich' }]} />
        <button class="btn xs" disabled={!label.trim()} onClick={() => guard(() => rpc('aion2.addTask', { label, period })).then(() => { setLabel(''); reload(); })}><Plus size={12} /></button></div>
      <details class="mt"><summary class="small">Reset-Uhrzeit: {t.resetTime} Uhr (Serverzeit) – stimmt nicht?</summary>
        <div class="tiny muted">Im Spiel steht „Daily recharge in …“. Trag die Restzeit ein, JARVIS stellt die Uhrzeit danach ein.</div>
        <div class="row gap-s mt"><input class="inp grow" placeholder="z. B. 7:12" value={cd} onInput={(e) => setCd(e.currentTarget.value)} /><button class="btn xs" disabled={!cd.trim()} onClick={() => guard(() => rpc('aion2.resetFromCountdown', { countdown: cd }), 'Reset-Uhrzeit übernommen').then(() => { setCd(''); reload(); })}><Check size={12} />Übernehmen</button></div>
      </details>
      <div class="row gap-s mt" style={{ alignItems: 'center' }}><Timer size={14} /><b class="small grow">Regeneration</b></div>
      <div class="row gap-s"><Select style={{ width: 180 }} value={kind} onChange={(v) => { setKind(v); setRg(null); }} options={(kinds || []).map((k) => ({ value: k.id, label: `${k.label} (max. ${k.cap})` }))} />
        <input class="inp grow" type="number" min="0" placeholder="aktuell" value={cur} onInput={(e) => setCur(e.currentTarget.value)} />
        <button class="btn xs" disabled={cur === ''} onClick={async () => setRg(await guard(() => rpc('aion2.regen', { kind, current: Number(cur) })))}>Wann voll?</button></div>
      {rg && <div class="small mt">{rg.full ? 'Schon voll – jetzt verbrauchen, sonst verfällt Zuwachs.' : <>Voll ({rg.cap}) spätestens <b>{new Date(rg.at).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</b> · in {fmtMin(rg.minutes)}</>}
        {!rg.full && <button class="btn xs ghost" style={{ marginLeft: 6 }} onClick={() => guard(() => rpc('game.addTimer', { game: 'aion2', label: `${rg.label} voll`, kind: 'custom', endsAt: rg.at }), 'Erinnerung gesetzt (auch im Overlay)')}>Erinnern</button>}</div>}
      <div class="tiny muted mt">{t.source}</div>
    </Panel>
  );
}

/** Upgrade-Rechner (Erfolgschance) + Crafting-Rechner (Materialliste, speicherbar). Reine Rechnung. */
export function Aion2Calc() {
  const [chance, setChance] = useState(''); const [cost, setCost] = useState(''); const [up, setUp] = useState(null);
  const [mats, setMats] = useState([{ name: '', qty: '', price: '' }]); const [count, setCount] = useState('1'); const [sell, setSell] = useState('');
  const [name, setName] = useState(''); const [cr, setCr] = useState(null);
  const [recipes, reloadR] = useRpc('aion2.recipes', {}, { initial: [], events: ['game:data'] });
  const k = (n) => Math.round(n).toLocaleString('de-DE');
  const calcCraft = async () => setCr(await guard(() => rpc('aion2.craft', { materials: mats, count: Number(count) || 1, sellPrice: sell === '' ? null : Number(sell) })));
  return (
    <Panel icon={Calculator} title="Upgrade- & Crafting-Rechner" sub="Reine Rechnung – Werte aus dem Spiel eintragen">
      <b class="small">Upgrade</b>
      <div class="row gap-s mt"><input class="inp" style={{ width: 110 }} type="number" min="0.1" max="100" step="0.1" placeholder="Chance %" value={chance} onInput={(e) => setChance(e.currentTarget.value)} />
        <input class="inp grow" type="number" min="0" placeholder="Kosten pro Versuch (Kinah)" value={cost} onInput={(e) => setCost(e.currentTarget.value)} />
        <button class="btn xs" disabled={!chance} onClick={async () => setUp(await guard(() => rpc('aion2.upgrade', { chance: Number(chance), costPerTry: Number(cost) || 0 })))}>Rechnen</button></div>
      {up && <div class="small mt">Im Schnitt <b>{up.expectedTries} Versuche</b>{up.expectedCost ? <> · ca. <b>{k(up.expectedCost)} Kinah</b></> : null}. Mit 50 %: {up.tries50} · mit 90 %: {up.tries90}{up.cost90 ? ` (${k(up.cost90)} Kinah)` : ''} · mit 99 %: {up.tries99} Versuchen.</div>}
      <b class="small mt" style={{ display: 'block', marginTop: 12 }}>Crafting</b>
      {mats.map((m, i) => <div class="row gap-s mt">
        <input class="inp grow" placeholder="Material" value={m.name} onInput={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, name: e.currentTarget.value } : x)))} />
        <input class="inp" style={{ width: 70 }} type="number" min="0" placeholder="Menge" value={m.qty} onInput={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, qty: e.currentTarget.value } : x)))} />
        <input class="inp" style={{ width: 100 }} type="number" min="0" placeholder="Preis/Stk" value={m.price} onInput={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, price: e.currentTarget.value } : x)))} />
        <button class="btn xs ghost" onClick={() => setMats(mats.length > 1 ? mats.filter((_, j) => j !== i) : [{ name: '', qty: '', price: '' }])}><Trash2 size={11} /></button></div>)}
      <div class="row gap-s mt"><button class="btn xs ghost" onClick={() => setMats([...mats, { name: '', qty: '', price: '' }])}><Plus size={12} />Material</button>
        <input class="inp" style={{ width: 70 }} type="number" min="1" title="Anzahl herstellen" value={count} onInput={(e) => setCount(e.currentTarget.value)} />
        <input class="inp grow" type="number" min="0" placeholder="Verkaufspreis/Stk (optional)" value={sell} onInput={(e) => setSell(e.currentTarget.value)} />
        <button class="btn xs" onClick={calcCraft}>Rechnen</button></div>
      {cr && <div class="small mt">{cr.rows.map((r) => <div>{r.name}: {k(r.need)} Stk · {k(r.cost)} Kinah</div>)}<b>Gesamt {k(cr.total)} Kinah</b> · {k(cr.perItem)} pro Stück{cr.profit != null ? <> · <b style={{ color: cr.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{cr.profit >= 0 ? 'Gewinn' : 'Verlust'} {k(Math.abs(cr.profit))}</b></> : null}</div>}
      <div class="row gap-s mt"><input class="inp grow" placeholder="Rezept speichern als …" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <button class="btn xs" disabled={!name.trim()} onClick={() => guard(() => rpc('aion2.saveRecipe', { name, materials: mats.map((m) => ({ name: m.name, qty: Number(m.qty) || 0, price: Number(m.price) || 0 })), sellPrice: sell === '' ? null : Number(sell) }), 'Rezept gespeichert').then(() => { setName(''); reloadR(); })}>Speichern</button></div>
      {recipes?.length > 0 && <div class="row wrap gap-s mt">{recipes.map((r) => <span class="chip" onClick={() => { setMats(r.materials.map((m) => ({ name: m.name, qty: String(m.qty), price: String(m.price) }))); setSell(r.sellPrice == null ? '' : String(r.sellPrice)); setCr(null); }}>{r.name} <span onClick={(e) => { e.stopPropagation(); guard(() => rpc('aion2.removeRecipe', { name: r.name })).then(reloadR); }}>×</span></span>)}</div>}
    </Panel>
  );
}
