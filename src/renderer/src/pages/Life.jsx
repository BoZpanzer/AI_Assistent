import { useState, useEffect } from 'preact/hooks';
import { Wallet, ShoppingCart, Dumbbell, Gift, Refrigerator, Repeat, CookingPot, Plus, Check, X, Timer, Sparkles, Trash2, TrendingUp } from 'lucide-preact';
import { rpc, useRpc, useEvent } from '../lib/api.js';
import { guard, setState } from '../lib/store.js';
import { ChatBar } from '../components/Shell.jsx';
import { Panel, Spinner, Empty, Select, useNow } from '../components/ui.jsx';
import { fmtDateTime, ago, countdown } from '../lib/format.js';

const eur = (v) => (v == null ? '–' : `${Number(v).toFixed(2).replace('.', ',')} €`);
const dmy = (d) => (d ? d.split('-').reverse().join('.') : '–');
const CYCLE = { month: 'monatlich', year: 'jährlich', week: 'wöchentlich' };

export function Life() {
  return (
    <div class="page">
      <div class="page-body" style={{ overflow: 'auto' }}>
        <div class="widgets">
          <div class="w-6"><Finance /></div>
          <div class="w-6"><Subscriptions /></div>
          <div class="w-6"><Shopping /></div>
          <div class="w-6"><Pantry /></div>
          <div class="w-7"><Training /></div>
          <div class="w-5"><Birthdays /></div>
        </div>
      </div>
      <ChatBar actions={[
        { icon: Wallet, label: 'Ausgabe', onClick: () => setState({ page: 'chat', chatDraft: 'Ausgabe: ' }) },
        { icon: ShoppingCart, label: 'Einkauf', onClick: () => setState({ page: 'chat', chatDraft: 'Setz auf die Einkaufsliste: ' }) },
        { icon: Dumbbell, label: 'Training', onClick: () => setState({ page: 'chat', chatDraft: 'Training: ' }) },
      ]} />
    </div>
  );
}

function Finance() {
  const [m, reload] = useRpc('life.month', {}, { events: ['life:data'] });
  const [f, setF] = useState({ amount: '', note: '' });
  const add = async () => { if (!f.amount) return; if (await guard(() => rpc('life.addExpense', { amount: f.amount, note: f.note }))) { setF({ amount: '', note: '' }); reload(); } };
  if (!m) return <Panel icon={Wallet} title="Ausgaben"><Spinner /></Panel>;
  const max = Math.max(1, ...m.categories.map((c) => c.sum));
  const pct = m.budget ? Math.min(100, Math.round(m.totalWithSubs / m.budget * 100)) : null;
  return (
    <Panel icon={Wallet} title="Ausgaben" sub={`${m.month.split('-').reverse().join('/')} · nur was du einträgst, bleibt auf deinem PC`}>
      <div class="row wrap gap-s"><span class="chip static">Ausgegeben {eur(m.total)}</span><span class="chip static">Abos {eur(m.subscriptions)}/Monat</span>{m.budget ? <span class="chip static" style={{ color: m.left < 0 ? 'var(--red, #e5484d)' : 'var(--green)' }}>Übrig {eur(m.left)}</span> : null}{m.forecast != null && <span class="chip static" title="Hochrechnung bis Monatsende (ohne Abos)">Prognose {eur(m.forecast)}</span>}</div>
      {pct != null && <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, marginTop: 8 }}><div style={{ width: pct + '%', height: '100%', borderRadius: 3, background: pct >= 100 ? 'var(--red, #e5484d)' : pct >= 80 ? 'var(--orange)' : 'var(--cyan)' }} /></div>}
      {!m.budget && <div class="tiny muted mt">Monatsbudget in den Einstellungen setzen, dann zeigt JARVIS, was übrig ist.</div>}
      <div class="col mt" style={{ gap: 3 }}>{m.categories.map((c) => <div class="row small" style={{ gap: 8 }}><span style={{ width: 130 }}>{c.category}</span><div class="grow" style={{ height: 8, background: 'var(--line)', borderRadius: 4 }}><div style={{ width: (c.sum / max) * 100 + '%', height: '100%', background: 'var(--cyan)', borderRadius: 4 }} /></div><span style={{ width: 80, textAlign: 'right' }}>{eur(c.sum)}</span></div>)}</div>
      <div class="row gap-s mt"><input class="inp" style={{ width: 90 }} placeholder="€" inputmode="decimal" value={f.amount} onInput={(e) => setF({ ...f, amount: e.currentTarget.value })} /><input class="inp grow" placeholder="wofür? (z. B. Döner, Tanken)" value={f.note} onInput={(e) => setF({ ...f, note: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} /><button class="btn xs" onClick={add}><Plus size={12} /></button></div>
      <div class="col mt" style={{ gap: 2, maxHeight: 160, overflow: 'auto' }}>{m.recent.map((x) => <div class="row small"><span class="tiny muted" style={{ width: 70 }}>{new Date(x.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span><span class="grow">{x.note || x.category}<span class="tiny muted"> · {x.category}</span></span><span>{eur(x.amount)}</span><button class="btn xs ghost" onClick={() => guard(() => rpc('life.removeExpense', { id: x.id })).then(reload)}><X size={11} /></button></div>)}</div>
    </Panel>
  );
}

function Subscriptions() {
  const [list, reload] = useRpc('life.subs', {}, { events: ['life:data'], initial: [] });
  const [f, setF] = useState({ name: '', amount: '', cycle: 'month', nextCharge: '', cancelBy: '' });
  const add = async () => { if (!f.name || !f.amount) return; if (await guard(() => rpc('life.addSub', { ...f, nextCharge: f.nextCharge || undefined, cancelBy: f.cancelBy || null, remind: true }), 'Abo gespeichert')) { setF({ name: '', amount: '', cycle: 'month', nextCharge: '', cancelBy: '' }); reload(); } };
  const total = list.filter((x) => x.active).reduce((a, x) => a + x.monthly, 0);
  return (
    <Panel icon={Repeat} title="Abos" sub={`${eur(total)} pro Monat · Erinnerung 2 Tage vor Abbuchung und vor Kündigungsfristen`}>
      {!list.length && <Empty>Noch keine Abos. Sag z. B. „Jarvis, Netflix 13,99 € monatlich, nächste Abbuchung am 3.“</Empty>}
      {list.map((x) => <div class="row small mb" style={{ opacity: x.active ? 1 : 0.5 }}><span class="grow"><b>{x.name}</b> <span class="muted">{eur(x.amount)} {CYCLE[x.cycle]}</span><div class="tiny muted">nächste Abbuchung {dmy(x.nextCharge)}{x.cancelBy ? ` · kündigen bis ${dmy(x.cancelBy)}` : ''}</div></span>
        <button class="btn xs ghost" title={x.remind ? 'Erinnerung aus' : 'Erinnerung an'} onClick={() => guard(() => rpc('life.updateSub', { id: x.id, remind: !x.remind })).then(reload)}>{x.remind ? '🔔' : '🔕'}</button>
        <button class="btn xs ghost" title={x.active ? 'Pausieren/gekündigt' : 'Wieder aktiv'} onClick={() => guard(() => rpc('life.updateSub', { id: x.id, active: !x.active })).then(reload)}>{x.active ? 'aktiv' : 'aus'}</button>
        <button class="btn xs ghost" onClick={() => guard(() => rpc('life.removeSub', { id: x.id })).then(reload)}><Trash2 size={11} /></button></div>)}
      <div class="row wrap gap-s mt">
        <input class="inp" style={{ width: 120 }} placeholder="Name" value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <input class="inp" style={{ width: 70 }} placeholder="€" value={f.amount} onInput={(e) => setF({ ...f, amount: e.currentTarget.value })} />
        <Select style={{ width: 110 }} value={f.cycle} onChange={(v) => setF({ ...f, cycle: v })} options={[{ value: 'month', label: 'monatlich' }, { value: 'year', label: 'jährlich' }, { value: 'week', label: 'wöchentlich' }]} />
        <label class="tiny muted">nächste <input class="inp" type="date" value={f.nextCharge} onInput={(e) => setF({ ...f, nextCharge: e.currentTarget.value })} /></label>
        <label class="tiny muted">kündigen bis <input class="inp" type="date" value={f.cancelBy} onInput={(e) => setF({ ...f, cancelBy: e.currentTarget.value })} /></label>
        <button class="btn xs" onClick={add}><Plus size={12} /></button>
      </div>
    </Panel>
  );
}

function Shopping() {
  const [l, reload] = useRpc('life.shopping', {}, { events: ['life:data'] });
  const [t, setT] = useState('');
  const add = async () => { if (!t.trim()) return; await guard(() => rpc('life.addShopping', { text: t })); setT(''); reload(); };
  return (
    <Panel icon={ShoppingCart} title="Einkaufsliste" sub="Nach Ladenbereich sortiert · abgehakt landet es in den Vorräten" right={l?.done?.length ? <button class="btn xs ghost" onClick={() => guard(() => rpc('life.clearShopping')).then(reload)}>Erledigte weg</button> : null}>
      <div class="row gap-s mb"><input class="inp grow" placeholder="Milch, Eier, Nudeln …" value={t} onInput={(e) => setT(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><button class="btn xs" onClick={add}><Plus size={12} /></button></div>
      {!l?.open && <Empty>Liste ist leer. „Jarvis, setz Milch und Eier auf die Einkaufsliste.“</Empty>}
      {(l?.groups || []).map((g) => <div class="mb"><div class="hud-label" style={{ fontSize: 11 }}>{g.section}</div>{g.items.map((x) => <div class="sub-row"><button class="btn xs ghost" title="Gekauft" onClick={() => guard(() => rpc('life.checkShopping', { id: x.id })).then(reload)}><Check size={12} /></button><span class="grow">{x.name}{x.qty ? <span class="muted"> · {x.qty}</span> : null}</span><X size={12} style={{ cursor: 'pointer', color: 'var(--text-3)' }} onClick={() => guard(() => rpc('life.removeShopping', { id: x.id })).then(reload)} /></div>)}</div>)}
      {l?.done?.length > 0 && <div class="tiny muted">Erledigt: {l.done.map((x) => x.name).join(', ')}</div>}
    </Panel>
  );
}

function Pantry() {
  const [list, reload] = useRpc('life.pantry', {}, { events: ['life:data'], initial: [] });
  const [f, setF] = useState({ name: '', expires: '' });
  const [rec, setRec] = useState(null); const [busy, setBusy] = useState(false);
  const add = async () => { if (!f.name.trim()) return; await guard(() => rpc('life.addPantry', { items: [{ name: f.name.trim(), expires: f.expires || undefined }] })); setF({ name: '', expires: '' }); reload(); };
  const recipes = async () => { setBusy(true); setRec(await guard(() => rpc('life.recipes'))); setBusy(false); };
  const soon = (d) => d && Date.parse(d) - Date.now() < 2 * 86400000;
  return (
    <Panel icon={Refrigerator} title="Vorräte" sub="Was du da hast – Rezeptideen daraus, bald Ablaufendes zuerst" right={<button class="btn xs" disabled={busy || list.length < 3} onClick={recipes}>{busy ? <Spinner size={12} /> : <CookingPot size={12} />}Rezeptideen</button>}>
      {!list.length && <Empty>Noch nichts eingetragen. Gekauftes von der Einkaufsliste landet automatisch hier.</Empty>}
      <div class="row wrap gap-s">{list.map((x) => <span class="chip static" style={{ color: soon(x.expires) ? 'var(--orange)' : undefined }} title={x.expires ? 'haltbar bis ' + dmy(x.expires) : ''}>{x.name}{x.qty ? ` (${x.qty})` : ''}{x.expires ? ` · ${dmy(x.expires).slice(0, 6)}` : ''} <X size={10} style={{ cursor: 'pointer' }} onClick={() => guard(() => rpc('life.usePantry', { names: [x.name] })).then(reload)} /></span>)}</div>
      <div class="row gap-s mt"><input class="inp grow" style={{ minWidth: 140 }} placeholder="Vorrat hinzufügen" value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} /><input class="inp" type="date" style={{ width: 150, flex: 'none' }} title="haltbar bis (optional)" value={f.expires} onInput={(e) => setF({ ...f, expires: e.currentTarget.value })} /><button class="btn xs" onClick={add}><Plus size={12} /></button></div>
      {rec?.recipes?.length > 0 && <div class="col mt" style={{ gap: 6 }}>{rec.recipes.map((r) => <details><summary class="small" style={{ cursor: 'pointer' }}><b>{r.name}</b> <span class="muted">· {r.minutes} min{r.missing?.length ? ` · fehlt: ${r.missing.join(', ')}` : ''}</span></summary><ol class="small" style={{ margin: '4px 0 0 18px' }}>{r.steps.map((s) => <li>{s}</li>)}</ol></details>)}<div class="tiny muted">KI-Vorschläge aus deinen Vorräten</div></div>}
    </Panel>
  );
}

function Training() {
  const [d, reload] = useRpc('life.progress', {}, { events: ['life:data'] });
  const [t, setT] = useState(''); const [rest, setRest] = useState(null);
  useNow(1000);
  useEvent('life:rest', (x) => setRest(x.done ? null : x));
  const log = async () => { if (!t.trim()) return; const r = await guard(() => rpc('life.logWorkout', { text: t })); if (r) { setT(''); reload(); } };
  const prog = d?.progress || [];
  return (
    <Panel icon={Dumbbell} title="Training" sub="„Bankdrücken 3×8 mit 70 kg“ – Fortschritt als geschätztes 1RM, Rekorde werden gemeldet">
      <div class="row gap-s"><input class="inp grow" placeholder="Bankdrücken 3x8 70kg, Klimmzüge 3x10" value={t} onInput={(e) => setT(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && log()} /><button class="btn xs" onClick={log}><Plus size={12} />Eintragen</button></div>
      <div class="row gap-s mt" style={{ alignItems: 'center' }}><Timer size={14} /><span class="small">Pause:</span>{[60, 90, 120, 180].map((sec) => <button class="chip" onClick={() => rpc('life.rest', { seconds: sec }).then(setRest)}>{sec} s</button>)}{rest?.endsAt && <b style={{ color: 'var(--cyan)', marginLeft: 6 }}>{countdown(rest.endsAt)}</b>}</div>
      {!prog.length && <Empty>Noch kein Training eingetragen.</Empty>}
      <div class="widgets mt" style={{ gap: 8 }}>{prog.slice(0, 6).map((p) => { const vals = p.points.map((x) => x.v); const lo = Math.min(...vals); const hi = Math.max(...vals); const span = Math.max(1, hi - lo); return (
        <div class="w-6" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
          <div class="row small"><b class="grow">{p.exercise}</b><span class="tiny muted">{p.sessions}×</span></div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: '100%', height: 36 }}>{vals.length > 1 ? <polyline points={vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${27 - ((v - lo) / span) * 24}`).join(' ')} fill="none" stroke="var(--cyan)" stroke-width="1.5" vector-effect="non-scaling-stroke" /> : <circle cx="50" cy="15" r="2" fill="var(--cyan)" />}</svg>
          <div class="tiny muted">{p.last} {p.unit}{p.change ? <span style={{ color: p.change > 0 ? 'var(--green)' : 'var(--orange)' }}> · {p.change > 0 ? '+' : ''}{p.change}</span> : null}</div>
        </div>); })}</div>
      {d?.recent?.length > 0 && <div class="col mt" style={{ gap: 2, maxHeight: 120, overflow: 'auto' }}>{d.recent.slice(0, 8).map((x) => <div class="row small"><span class="tiny muted" style={{ width: 90 }}>{fmtDateTime(x.at)}</span><span class="grow">{x.exercise} {x.sets}×{x.reps}{x.weight ? ` · ${x.weight} kg` : ''}</span><button class="btn xs ghost" onClick={() => guard(() => rpc('life.removeWorkout', { id: x.id })).then(reload)}><X size={11} /></button></div>)}</div>}
    </Panel>
  );
}

function Birthdays() {
  const [list] = useRpc('life.birthdays', { days: 60 }, { events: ['brain:changed'], initial: [] });
  const [ideas, setIdeas] = useState({}); const [busy, setBusy] = useState(null);
  const gen = async (name) => { setBusy(name); const r = await guard(() => rpc('life.gifts', { name })); setBusy(null); if (r) setIdeas({ ...ideas, [name]: r }); };
  return (
    <Panel icon={Gift} title="Geburtstage" sub="Aus dem Brain · eine Woche vorher Erinnerung mit Geschenkideen">
      {!list.length && <Empty>In den nächsten 60 Tagen keine Geburtstage im Brain. „Jarvis, merk dir: Lisa hat am 4. Mai Geburtstag.“</Empty>}
      {list.map((b) => { const ide = ideas[b.name] || b.ideas; return (
        <div class="mb">
          <div class="row small"><span class="grow"><b>{b.name}</b>{b.turns ? <span class="muted"> · wird {b.turns}</span> : null}</span><span class="tiny muted">{b.inDays === 0 ? 'heute' : b.inDays === 1 ? 'morgen' : `in ${b.inDays} Tagen`} · {b.day}.{b.month}.</span>{!ide && <button class="btn xs ghost" disabled={busy === b.name} title="Geschenkideen" onClick={() => gen(b.name)}>{busy === b.name ? <Spinner size={11} /> : <Sparkles size={12} />}</button>}</div>
          {ide?.ideas?.length > 0 && <ul class="small" style={{ margin: '2px 0 0 16px' }}>{ide.ideas.map((x) => <li><b>{x.idea}</b>{x.budget ? <span class="muted"> ({x.budget})</span> : null} – <span class="muted">{x.why}</span></li>)}</ul>}
          {ide && <div class="tiny muted">{ide.basedOn ? `aus ${ide.basedOn} Brain-Einträgen` : 'wenig Infos im Brain – eher allgemeine Ideen'}</div>}
        </div>); })}
    </Panel>
  );
}
