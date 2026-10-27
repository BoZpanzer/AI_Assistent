import { useState, useEffect } from 'preact/hooks';
import { Wallet, ShoppingCart, Dumbbell, Gift, Refrigerator, Repeat, CookingPot, Plus, Check, X, Timer, Sparkles, Trash2, TrendingUp, TrainFront, CalendarClock, Mail, RefreshCw, Search } from 'lucide-preact';
import { rpc, useRpc, useEvent } from '../lib/api.js';
import { guard, setState } from '../lib/store.js';
import { ChatBar } from '../components/Shell.jsx';
import { Panel, Spinner, Empty, Select, useNow, ask } from '../components/ui.jsx';
import { fmtDateTime, ago, countdown } from '../lib/format.js';

const eur = (v) => (v == null ? '–' : `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const dmy = (d) => (d ? d.split('-').reverse().join('.') : '–');
const CYCLE = { month: 'monatlich', year: 'jährlich', week: 'wöchentlich' };

export function Life() {
  return (
    <div class="page">
      <div class="page-body" style={{ overflow: 'auto' }}>
        <div class="widgets">
          <div class="w-6"><Transit /></div>
          <div class="w-6"><DeadlinesPanel /></div>
          <div class="w-6"><Finance /></div>
          <div class="w-6"><MoneyPlan /></div>
          <div class="w-6"><Buckets /></div>
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
  const [f, setF] = useState({ amount: '', note: '', bucketId: '' });
  const add = async () => { if (!f.amount) return; if (await guard(() => rpc('life.addExpense', { amount: f.amount, note: f.note, bucketId: f.bucketId || null }))) { setF({ amount: '', note: '', bucketId: f.bucketId }); reload(); } };
  if (!m) return <Panel icon={Wallet} title="Ausgaben"><Spinner /></Panel>;
  const max = Math.max(1, ...m.categories.map((c) => c.sum));
  const pct = m.budget ? Math.min(100, Math.round((m.totalWithSubs + (m.reserved || 0)) / m.budget * 100)) : null;
  return (
    <Panel icon={Wallet} title="Ausgaben" sub={`${m.month.split('-').reverse().join('/')} · nur was du einträgst, bleibt auf deinem PC`}>
      {m.income ? <div class="row wrap gap-s mb" style={{ alignItems: 'baseline' }}><span style={{ fontSize: 22, fontWeight: 700, color: m.balance < 0 ? 'var(--red, #e5484d)' : 'var(--green)' }}>{eur(m.balance)}</span><span class="small muted">frei bis Monatsende{m.perDay != null ? ` · ${eur(m.perDay)} pro Tag` : ''}</span></div> : null}
      {m.income ? <div class="tiny muted mb">Einnahmen {eur(m.income)} − Fixkosten {eur(m.fixedOut)} − Abos {eur(m.subsThisMonth)} − Ausgaben {eur(m.total)} − reserviert {eur(m.reserved)}</div> : <div class="tiny muted mb">Trag deine festen Einnahmen ein (rechts), dann zeigt JARVIS, was bis Monatsende frei ist.</div>}
      <div class="row wrap gap-s"><span class="chip static">Ausgegeben {eur(m.total)}</span><span class="chip static">Reserviert {eur(m.reserved)}</span><span class="chip static">Abos {eur(m.subscriptions)}/Monat</span>{m.budget ? <span class="chip static" style={{ color: m.left < 0 ? 'var(--red, #e5484d)' : 'var(--green)' }}>Budget übrig {eur(m.left)}</span> : null}{m.forecast != null && <span class="chip static" title="Hochrechnung bis Monatsende (ohne Abos)">Prognose {eur(m.forecast)}</span>}</div>
      {pct != null && <div style={{ height: 6, background: 'var(--line)', borderRadius: 3, marginTop: 8 }}><div style={{ width: pct + '%', height: '100%', borderRadius: 3, background: pct >= 100 ? 'var(--red, #e5484d)' : pct >= 80 ? 'var(--orange)' : 'var(--cyan)' }} /></div>}
      {!m.budget && <div class="tiny muted mt">Monatsbudget in den Einstellungen setzen, dann zeigt JARVIS, was übrig ist.</div>}
      <div class="col mt" style={{ gap: 3 }}>{m.categories.map((c) => <div class="row small" style={{ gap: 8 }}><span style={{ width: 130 }}>{c.category}</span><div class="grow" style={{ height: 8, background: 'var(--line)', borderRadius: 4 }}><div style={{ width: (c.sum / max) * 100 + '%', height: '100%', background: 'var(--cyan)', borderRadius: 4 }} /></div><span style={{ width: 80, textAlign: 'right' }}>{eur(c.sum)}</span></div>)}</div>
      <div class="row gap-s mt"><input class="inp" style={{ width: 90 }} placeholder="€" inputmode="decimal" value={f.amount} onInput={(e) => setF({ ...f, amount: e.currentTarget.value })} /><input class="inp grow" placeholder="wofür? (z. B. Döner, Tanken)" value={f.note} onInput={(e) => setF({ ...f, note: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />{!!m.buckets?.length && <Select style={{ width: 150 }} value={f.bucketId} onChange={(v) => setF({ ...f, bucketId: v })} options={[{ value: '', label: 'ohne Bucket' }, ...m.buckets.map((b) => ({ value: b.id, label: '→ ' + b.name }))]} />}<button class="btn xs" onClick={add}><Plus size={12} /></button></div>
      <div class="col mt" style={{ gap: 2, maxHeight: 160, overflow: 'auto' }}>{m.recent.map((x) => <div class="row small"><span class="tiny muted" style={{ width: 70 }}>{new Date(x.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span><span class="grow">{x.note || x.category}<span class="tiny muted"> · {x.category}{x.bucketId && m.buckets?.find((b) => b.id === x.bucketId) ? ' · ' + m.buckets.find((b) => b.id === x.bucketId).name : ''}</span></span><span>{eur(x.amount)}</span><button class="btn xs ghost" onClick={() => guard(() => rpc('life.removeExpense', { id: x.id })).then(reload)}><X size={11} /></button></div>)}</div>
    </Panel>
  );
}

const CYC2 = { month: 'monatlich', quarter: 'vierteljährlich', year: 'jährlich' };
function MoneyPlan() {
  const [list, reload] = useRpc('life.recurring', {}, { events: ['life:data'], initial: [] });
  const [m] = useRpc('life.month', {}, { events: ['life:data'] });
  const [f, setF] = useState({ kind: 'income', name: '', amount: '', day: 1, cycle: 'month', month: '' });
  const [once, setOnce] = useState({ amount: '', note: '' });
  const add = async () => { if (!f.name || !f.amount) return; if (await guard(() => rpc('life.addRecurring', { ...f, day: Number(f.day), month: f.month ? Number(f.month) : null }), 'Gespeichert')) { setF({ ...f, name: '', amount: '' }); reload(); } };
  const addOnce = async () => { if (!once.amount) return; if (await guard(() => rpc('life.addIncome', once), 'Einnahme erfasst')) setOnce({ amount: '', note: '' }); };
  const row = (x) => { const due = m?.fixed?.find((y) => y.id === x.id); return (
    <div class="row small mb" style={{ opacity: x.active ? 1 : 0.5 }}><span class="grow"><b>{x.name}</b> <span class="muted">{CYC2[x.cycle]} am {x.day}.{x.cycle !== 'month' && x.month ? ` (ab Monat ${x.month})` : ''}{x.category ? ' · ' + x.category : ''}</span>{due ? <span class="tiny" style={{ color: due.due ? 'var(--text-3)' : 'var(--cyan)' }}> · {due.due ? 'diesen Monat fällig gewesen' : 'kommt noch'}</span> : null}</span><span style={{ color: x.kind === 'income' ? 'var(--green)' : undefined }}>{x.kind === 'income' ? '+' : '−'}{eur(x.amount)}</span>
      <button class="btn xs ghost" title={x.active ? 'Pausieren' : 'Aktivieren'} onClick={() => guard(() => rpc('life.updateRecurring', { id: x.id, active: !x.active })).then(reload)}>{x.active ? 'an' : 'aus'}</button>
      <button class="btn xs ghost" onClick={() => guard(() => rpc('life.removeRecurring', { id: x.id })).then(reload)}><Trash2 size={11} /></button></div>); };
  const inc = list.filter((x) => x.kind === 'income'); const out = list.filter((x) => x.kind === 'expense');
  return (
    <Panel icon={Repeat} title="Einnahmen & Fixkosten" sub="Feste Posten mit Stichtag – zählen jeden Monat automatisch mit">
      <b class="small">Einnahmen</b>{!inc.length && <div class="tiny muted mb">z. B. Vergütung, BAföG, Kindergeld</div>}{inc.map(row)}
      <b class="small">Fixkosten</b>{!out.length && <div class="tiny muted mb">z. B. Miete, Versicherung, Handyvertrag</div>}{out.map(row)}
      <div class="row wrap gap-s mt">
        <Select style={{ width: 120 }} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'income', label: 'Einnahme' }, { value: 'expense', label: 'Fixkosten' }]} />
        <input class="inp" style={{ width: 130 }} placeholder="Name" value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <input class="inp" style={{ width: 80 }} placeholder="€" value={f.amount} onInput={(e) => setF({ ...f, amount: e.currentTarget.value })} />
        <label class="tiny muted">am <input class="inp" type="number" min="1" max="31" style={{ width: 56 }} value={f.day} onInput={(e) => setF({ ...f, day: e.currentTarget.value })} />.</label>
        <Select style={{ width: 140 }} value={f.cycle} onChange={(v) => setF({ ...f, cycle: v })} options={[{ value: 'month', label: 'monatlich' }, { value: 'quarter', label: 'vierteljährlich' }, { value: 'year', label: 'jährlich' }]} />
        {f.cycle !== 'month' && <label class="tiny muted">Monat <input class="inp" type="number" min="1" max="12" style={{ width: 56 }} value={f.month} onInput={(e) => setF({ ...f, month: e.currentTarget.value })} /></label>}
        <button class="btn xs" onClick={add}><Plus size={12} /></button>
      </div>
      <div class="row gap-s mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><span class="small">Einmalig bekommen:</span><input class="inp" style={{ width: 80 }} placeholder="€" value={once.amount} onInput={(e) => setOnce({ ...once, amount: e.currentTarget.value })} /><input class="inp grow" placeholder="wofür? (z. B. Nebenjob, von Oma)" value={once.note} onInput={(e) => setOnce({ ...once, note: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && addOnce()} /><button class="btn xs" onClick={addOnce}><Plus size={12} /></button></div>
      {m?.incomes?.length > 0 && <div class="col mt" style={{ gap: 2 }}>{m.incomes.map((x) => <div class="row small"><span class="tiny muted" style={{ width: 50 }}>{new Date(x.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span><span class="grow">{x.note || 'Einnahme'}</span><span style={{ color: 'var(--green)' }}>+{eur(x.amount)}</span><button class="btn xs ghost" onClick={() => guard(() => rpc('life.removeIncome', { id: x.id }))}><X size={11} /></button></div>)}</div>}
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

const hm = (x) => (x ? new Date(x).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–');
function Transit() {
  const [st, reloadSt] = useRpc('transit.state', {}, { events: ['transit:data', 'calendar:changed', 'settings:changed'] });
  const [deps, setDeps] = useState(null); const [err, setErr] = useState(null);
  const [q, setQ] = useState(''); const [hits, setHits] = useState(null);
  useNow(30000);
  const loadDeps = async () => { try { setDeps(await rpc('transit.departures')); setErr(null); } catch (e) { setErr(String(e.message).replace(/^.*?Error: /, '')); } };
  useEffect(() => { if (st?.home) { loadDeps(); const t = setInterval(loadDeps, 60000); return () => clearInterval(t); } }, [st?.home?.id]);
  const search = async () => { if (q.trim().length < 3) return; setHits(await guard(() => rpc('transit.search', { q }))); };
  const pick = async (h) => { await guard(() => rpc('transit.setHome', h), 'Haltestelle gespeichert'); setHits(null); setQ(''); reloadSt(); };
  const j = st?.plan?.journeys?.[0];
  return (
    <Panel icon={TrainFront} title="Unterwegs" sub={st?.home ? `Ab ${st.home.name} · DB-Daten inkl. LVB` : 'Abfahrten und „wann muss ich los?“'}>
      {(!st?.home || hits) && <div class="col" style={{ gap: 6 }}>
        <div class="row gap-s"><input class="inp grow" placeholder="Deine Haltestelle, z. B. „Leipzig, Hauptbahnhof“" value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /><button class="btn xs" onClick={search}><Search size={12} /></button></div>
        {(hits || []).map((h) => <button class="chip" onClick={() => pick(h)}>{h.name}</button>)}
      </div>}
      {st?.event && <div class="notice small mb">
        <b>{st.event.title}</b> um {hm(st.event.start_at)} · {st.event.location}
        {j ? <div>Los um <b>{hm(j.leave)}</b> · {j.legs.filter((l) => !l.walking).map((l) => `${l.line} ${hm(l.dep)}${l.platform ? ' Gl. ' + l.platform : ''}${l.delayMin ? ` (+${l.delayMin})` : ''}`).join(' → ')} · an {hm(j.arrive)}</div> : <div class="muted">{st.plan?.error || 'Verbindung wird gesucht …'}</div>}
      </div>}
      {st?.home && <>
        {err && <div class="small muted">{err}</div>}
        <div class="col" style={{ gap: 2, maxHeight: 230, overflow: 'auto' }}>{(deps || []).slice(0, 10).map((d) => <div class="row small" style={{ opacity: d.cancelled ? 0.5 : 1 }}><b style={{ width: 54 }}>{d.line}</b><span class="grow">{d.direction}{d.platform ? <span class="tiny muted"> · Gl. {d.platform}</span> : null}</span><span style={{ textDecoration: d.cancelled ? 'line-through' : undefined }}>{hm(d.when)}</span>{d.delayMin ? <span style={{ color: 'var(--orange)', width: 36, textAlign: 'right' }}>+{d.delayMin}</span> : <span style={{ width: 36 }} />}</div>)}</div>
        <div class="row tiny muted mt"><span class="grow">Vor Terminen mit Ort meldet sich JARVIS kurz vor der Abfahrt.</span><a href="#" onClick={(e) => { e.preventDefault(); setHits([]); }}>Haltestelle ändern</a></div>
      </>}
    </Panel>
  );
}

const SRC_DE = { calendar: 'Kalender', task: 'Aufgabe', exam: 'Klausur', mail: 'Mail', manual: 'eingetragen' };
export function DeadlinesPanel() {
  const [list, reload] = useRpc('deadlines.list', {}, { events: ['deadlines:changed', 'calendar:changed', 'tasks:changed'], initial: [] });
  const [cands, reloadC] = useRpc('deadlines.candidates', {}, { events: ['deadlines:changed'], initial: [] });
  const [mail, reloadM] = useRpc('deadlines.mailStatus', {}, { events: ['settings:changed'] });
  const [f, setF] = useState({ title: '', date: '' }); const [busy, setBusy] = useState(false);
  useEffect(() => { rpc('deadlines.refresh').then(reload).catch(() => {}); }, []);
  const add = async () => { if (!f.title || !f.date) return; if (await guard(() => rpc('deadlines.add', { title: f.title, dueAt: new Date(f.date).toISOString() }), 'Abgabe eingetragen')) { setF({ title: '', date: '' }); reload(); } };
  const connect = async () => { setBusy(true); await guard(() => rpc('deadlines.connectMail'), 'Gmail verbunden'); setBusy(false); reloadM(); reloadC(); };
  const col = (d) => (d < 2 ? 'var(--red, #e5484d)' : d < 7 ? 'var(--orange)' : 'var(--text-2)');
  return (
    <Panel icon={CalendarClock} title="Abgaben & Fristen" sub="Aus Kalender, Aufgaben, Klausurmodus und – wenn du willst – Gmail · Erinnerung 7, 2, 1 Tag und 3 h vorher">
      {!list.length && <Empty>Keine Abgaben in Sicht. Termine mit „Abgabe“, „Frist“ oder „Prüfung“ im Titel landen automatisch hier.</Empty>}
      {list.map((d) => <div class="row small mb"><button class="btn xs ghost" title="Erledigt" onClick={() => guard(() => rpc('deadlines.done', { id: d.id })).then(reload)}><Check size={12} /></button><span class="grow"><b>{d.title}</b><span class="tiny muted"> · {SRC_DE[d.source] || d.source}{d.course ? ' · ' + d.course : ''}</span></span><span style={{ color: col(d.inDays) }}>{fmtDateTime(d.dueAt)}</span></div>)}
      {cands.length > 0 && <div class="col mt" style={{ gap: 4, borderTop: '1px solid var(--line)', paddingTop: 6 }}><b class="small"><Mail size={12} /> Vorschläge aus deinen Mails</b>{cands.map((c) => <div class="row small"><span class="grow">{c.title} <span class="tiny muted">· {fmtDateTime(c.dueAt)} · „{c.subject}“</span></span><button class="btn xs" onClick={() => guard(() => rpc('deadlines.accept', { id: c.id })).then(() => { reload(); reloadC(); })}><Check size={12} /></button><button class="btn xs ghost" onClick={() => guard(() => rpc('deadlines.reject', { id: c.id })).then(reloadC)}><X size={11} /></button></div>)}</div>}
      <div class="row gap-s mt"><input class="inp grow" placeholder="Abgabe, z. B. Praxisbericht" value={f.title} onInput={(e) => setF({ ...f, title: e.currentTarget.value })} /><input class="inp" type="datetime-local" style={{ width: 200, flex: 'none' }} value={f.date} onInput={(e) => setF({ ...f, date: e.currentTarget.value })} /><button class="btn xs" onClick={add}><Plus size={12} /></button></div>
      {mail && !mail.ready && <div class="tiny muted mt">Fristen aus Mails: <a href="#" onClick={(e) => { e.preventDefault(); if (!busy) connect(); }}>{busy ? 'verbinde …' : 'Gmail verbinden'}</a> (nur lesend: Betreff + Vorschau, Vorschläge musst du bestätigen)</div>}
      {mail?.ready && <div class="tiny muted mt">Gmail verbunden – JARVIS schaut alle 6 Stunden nach. <a href="#" onClick={(e) => { e.preventDefault(); guard(() => rpc('deadlines.scanMail')).then(reloadC); }}>Jetzt prüfen</a></div>}
    </Panel>
  );
}


const ymOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };
const shiftYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + n, 1)); };

/** Säulendiagramm: je Bucket eine Säule; Umriss = geplant, Füllung = schon ausgegeben (rot über dem Plan). */
export function BucketChart({ rows }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((b) => Math.max(b.amount, b.spent))) || 1;
  const pct = (v) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return <div class="bucket-chart" role="img" aria-label={rows.map((b) => `${b.name}: ${eur(b.spent)} von ${eur(b.amount)}`).join('; ')}>
    {rows.map((b) => <div class="bc-col" title={`${b.name}: ${eur(b.spent)} von ${eur(b.amount)} ausgegeben${b.over ? ` · ${eur(b.over)} drüber` : ` · ${eur(b.remaining)} übrig`}`}>
      <div class={'bc-val' + (b.over ? ' over' : '')}>{eur(b.spent)}</div>
      <div class="bc-track">
        <div class="bc-plan" style={{ height: pct(b.amount) }} />
        <div class={'bc-fill' + (b.over ? ' over' : '')} style={{ height: pct(b.spent) }} />
      </div>
      <div class="bc-name">{b.name}</div>
      <div class="bc-sub">von {eur(b.amount)}</div>
    </div>)}
  </div>;
}

function Buckets() {
  const [month, setMonth] = useState(ymOf());
  const blank = { name: '', amount: '', month };
  const [f, setF] = useState(blank);
  const [spend, setSpend] = useState({});
  const [open, setOpen] = useState('');
  const [rows] = useRpc('life.buckets', { month }, { events: ['life:data'], initial: [], deps: [month] });
  const [items] = useRpc('life.bucketExpenses', { id: open }, { events: ['life:data'], initial: [], deps: [open], enabled: !!open });
  const planned = rows.reduce((a, b) => a + b.amount, 0); const spent = rows.reduce((a, b) => a + b.spent, 0);
  const book = async (b) => {
    const v = spend[b.id] || {}; if (!v.amount) return;
    if (await guard(() => rpc('life.addExpense', { amount: v.amount, note: v.note || '', bucketId: b.id }), 'In „' + b.name + '“ gebucht')) setSpend({ ...spend, [b.id]: {} });
  };
  return <Panel icon={Wallet} title="Buckets" sub="Geld je Zweck verplanen und Ausgaben direkt hineinbuchen. Der offene Rest wird im Monat vom freien Geld abgezogen.">
    <div class="row wrap gap-s"><input class="inp grow" placeholder="Wofür? (z. B. Urlaub, Essen gehen)" value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} /><input class="inp" style={{ width: 95 }} placeholder="Plan €" value={f.amount} onInput={(e) => setF({ ...f, amount: e.currentTarget.value })} /><input class="inp" type="month" value={f.month} onInput={(e) => setF({ ...f, month: e.currentTarget.value })} /><button class="btn sm" onClick={async () => { if (await guard(() => rpc('life.saveBucket', f))) { setMonth(f.month); setF({ ...blank, month: f.month }); } }}>{f.id ? 'Ändern' : 'Anlegen'}</button>{f.id && <button class="btn xs" onClick={() => setF(blank)}>Abbrechen</button>}</div>
    <div class="row gap-s mt" style={{ alignItems: 'center' }}>
      <button class="btn xs ghost" title="Vormonat" onClick={() => setMonth(shiftYm(month, -1))}>‹</button>
      <b style={{ minWidth: 130, textAlign: 'center' }}>{monthLabel(month)}</b>
      <button class="btn xs ghost" title="Nächster Monat" onClick={() => setMonth(shiftYm(month, 1))}>›</button>
      <span class="grow" />
      {!!rows.length && <span class="small muted">{eur(spent)} von {eur(planned)} ausgegeben</span>}
    </div>
    {!rows.length ? <Empty>Für {monthLabel(month)} ist noch kein Geld verplant.</Empty> : <BucketChart rows={rows} />}
    {rows.map((b) => <div class="bucket-row">
      <div class="row wrap small" style={{ alignItems: 'center' }}>
        <span class="grow"><b>{b.name}</b> · {eur(b.spent)} / {eur(b.amount)} {b.over ? <span style={{ color: 'var(--red)' }}>· {eur(b.over)} drüber</span> : <span class="muted">· {eur(b.remaining)} übrig</span>}</span>
        {b.bookings > 0 && <button class="btn xs ghost" onClick={() => setOpen(open === b.id ? '' : b.id)}>{b.bookings} Buchung{b.bookings === 1 ? '' : 'en'} {open === b.id ? '▴' : '▾'}</button>}
        <button class="btn xs" onClick={() => setF({ id: b.id, name: b.name, amount: b.amount, month: b.month, category: b.category })}>Bearbeiten</button>
        {b.remaining > 0 && <button class="btn xs" title="Den offenen Rest als bezahlt buchen" onClick={async () => { if (await ask(`${b.name}: offenen Rest von ${eur(b.remaining)} heute als Ausgabe buchen?`, '', { confirmOnly: true, okLabel: 'Buchen' })) await guard(() => rpc('life.bookBucket', { id: b.id })); }}>Rest bezahlt</button>}
        <button class="btn xs ghost" title={b.bookings ? 'Bucket löschen – gebuchte Ausgaben bleiben erhalten' : 'Bucket löschen'} onClick={() => guard(() => rpc('life.removeBucket', { id: b.id }))}><Trash2 size={12} /></button>
      </div>
      <div class="row gap-s" style={{ marginTop: 6 }}>
        <input class="inp" style={{ width: 95 }} placeholder="Betrag €" value={spend[b.id]?.amount || ''} onInput={(e) => setSpend({ ...spend, [b.id]: { ...spend[b.id], amount: e.currentTarget.value } })} onKeyDown={(e) => e.key === 'Enter' && book(b)} />
        <input class="inp grow" placeholder={'Wofür? (optional, sonst „' + b.name + '“)'} value={spend[b.id]?.note || ''} onInput={(e) => setSpend({ ...spend, [b.id]: { ...spend[b.id], note: e.currentTarget.value } })} onKeyDown={(e) => e.key === 'Enter' && book(b)} />
        <button class="btn sm" onClick={() => book(b)}><Plus size={13} /> Ausgabe</button>
      </div>
      {open === b.id && items.map((x) => <div class="row small muted" style={{ paddingLeft: 8, marginTop: 4 }}><span class="grow">{dmy(x.at.slice(0, 10))} · {x.note || b.name}</span><span>{eur(x.amount)}</span><button class="btn xs ghost" title="Buchung löschen" onClick={() => guard(() => rpc('life.removeExpense', { id: x.id }))}><X size={12} /></button></div>)}
    </div>)}
  </Panel>;
}
