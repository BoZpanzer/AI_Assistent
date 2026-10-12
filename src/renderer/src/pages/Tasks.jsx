import { useState, useEffect, useRef } from 'preact/hooks';
import { SquareCheckBig, RefreshCw, Clock, CircleCheck, Star, CalendarDays, Flag, BookOpen, Plus, FileText, Link as LinkIcon, NotebookPen, Trash2, SlidersHorizontal, CirclePlus, Repeat, Globe, Upload, Paperclip, X, Bell, History, ListChecks } from 'lucide-preact';
import { rpc, useRpc } from '../lib/api.js';
import { useStore, setState, guard, toast, getState } from '../lib/store.js';
import { ChatBar } from '../components/Shell.jsx';
import { Checkbox, Modal, Field, Select, SectionHead, ask } from '../components/ui.jsx';
import { fmtTime, fmtDate, relDay, PRIO, PRIO_COLOR, catColor, toLocalInput, fromLocalInput, fmtDateLong } from '../lib/format.js';

const FILTERS = [['all', 'Alle'], ['today', 'Heute'], ['important', 'Wichtig'], ['overdue', 'Überfällig'], ['done', 'Erledigt']];
const DAYS = [['MO', 'Mo'], ['TU', 'Di'], ['WE', 'Mi'], ['TH', 'Do'], ['FR', 'Fr'], ['SA', 'Sa'], ['SU', 'So']];

function TaskRow({ t, sel, onSel }) {
  const time = t.recurrence ? t.recurrenceLabel : t.dueAt ? (t.dueAt && new Date(t.dueAt).toDateString() === new Date().toDateString() ? (t.allDay ? 'heute' : fmtTime(t.dueAt)) : fmtDate(t.dueAt, { day: '2-digit', month: 'short', year: 'numeric' })) : '—';
  return (
    <div class={`task-row ${sel ? 'sel' : ''} ${t.done ? 'done' : ''}`} onClick={() => onSel(t.id)}>
      <Checkbox checked={t.done} onChange={(v) => guard(() => rpc('tasks.complete', { id: t.id, done: v }), v && t.recurrence ? 'Erledigt – nächste Wiederholung geplant' : undefined)} />
      <span class="pdot" style={{ background: t.done ? 'var(--text-3)' : PRIO_COLOR[t.priority] === 'var(--text-3)' ? catColor(t.category) : PRIO_COLOR[t.priority], boxShadow: '0 0 6px currentColor' }} />
      <span class="title">{t.title}{t.subtaskTotal ? <span class="tiny muted"> · {t.subtaskDone}/{t.subtaskTotal}</span> : null}</span>
      <span class="cat">{t.category}</span>
      <span class={`time ${t.overdue ? 'over' : ''}`}>{t.done ? fmtDate(t.completedAt, { day: '2-digit', month: 'short' }) : time}</span>
      {t.done ? <span /> : <span class={`badge ${t.priority}`}>{PRIO[t.priority]}</span>}
    </div>
  );
}

function Section({ icon, title, list, sel, onSel, defaultOpen = true, date }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div class="section">
      <SectionHead icon={icon} title={title} count={`${list.length} Aufgabe${list.length === 1 ? '' : 'n'}`} open={open} onToggle={() => setOpen(!open)} right={date && <span class="small muted">{date}</span>} />
      {open && <div class="section-body">{list.length ? list.map((t) => <TaskRow t={t} sel={sel === t.id} onSel={onSel} />) : <div class="empty" style={{ padding: 12 }}>Keine Aufgaben</div>}</div>}
    </div>
  );
}

export function Tasks() {
  const [filter, setFilter] = useState('all');
  const focus = useStore((s) => s.focusTask);
  const [sel, setSel] = useState(focus || null);
  const [board] = useRpc('tasks.board', {}, { events: ['tasks:changed'] });
  const [filtered] = useRpc('tasks.list', { filter, limit: 300 }, { events: ['tasks:changed'], initial: [], enabled: filter !== 'all', deps: [filter] });
  const [newTask, setNewTask] = useState(null);
  useEffect(() => { if (focus) { setSel(focus); setState({ focusTask: null }); } }, [focus]);
  useEffect(() => { if (!sel && board?.today?.[0]) setSel(board.today[0].id); }, [board]);
  const quickAdd = async (text) => {
    if (!text) { setNewTask({}); return; }
    const t = await guard(() => rpc('tasks.create', parseQuick(text)), 'Aufgabe erstellt');
    if (t) setSel(t.id);
  };
  return (
    <div class="page">
      <div class="page-body">
        <section class="panel glow" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div class="row" style={{ padding: '14px 16px' }}>
            <div class="center" style={{ width: 56, height: 56, border: '1px solid var(--line-strong)', borderRadius: 10, color: 'var(--cyan)', boxShadow: 'var(--glow-sm)' }}><SquareCheckBig size={30} /></div>
            <div class="grow">
              <div class="hud-title" style={{ color: 'white', fontSize: 24 }}>Aufgaben</div>
              <div class="muted">Plane. Organisiere. Erledige. Mit JARVIS.</div>
            </div>
            <div class="tabs">{FILTERS.map(([k, l]) => <button class={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}{k === 'overdue' && board?.counts.overdue ? ` (${board.counts.overdue})` : ''}</button>)}</div>
            <button class="btn icon sm" title="Neue Aufgabe (Details)" onClick={() => setNewTask({})}><SlidersHorizontal size={18} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: 10, padding: '0 12px 12px', flex: 1, minHeight: 0 }}>
            <div class="col scroll" style={{ minHeight: 0, paddingRight: 4 }}>
              {filter === 'all' && board ? <>
                <Section icon={RefreshCw} title="Heute" date={fmtDateLong()} list={board.today} sel={sel} onSel={setSel} />
                <Section icon={Repeat} title="Wiederkehrende Aufgaben" list={board.recurring} sel={sel} onSel={setSel} />
                <Section icon={Clock} title="Fällig in Kürze" list={board.soon} sel={sel} onSel={setSel} />
                <Section icon={ListChecks} title="Ohne Termin / später" list={board.later} sel={sel} onSel={setSel} defaultOpen={board.later.length < 8} />
                <Section icon={CircleCheck} title="Erledigte Aufgaben" list={board.done} sel={sel} onSel={setSel} defaultOpen={false} />
              </> : (
                <div class="section"><SectionHead icon={ListChecks} title={FILTERS.find((f) => f[0] === filter)[1]} count={`${(filtered || []).length} Aufgaben`} />
                  <div class="section-body">{(filtered || []).length ? filtered.map((t) => <TaskRow t={t} sel={sel === t.id} onSel={setSel} />) : <div class="empty">Nichts hier.</div>}</div></div>
              )}
            </div>
            <TaskDetail id={sel} onDeleted={() => setSel(null)} />
          </div>
        </section>
      </div>
      <ChatBar placeholder="Neue Aufgabe eingeben … (z. B. „Abgabe morgen 14:00 !hoch #Studium“)" onSubmit={quickAdd}
        actions={[
          { icon: CirclePlus, label: 'Neue Aufgabe', onClick: () => setNewTask({}) },
          { icon: Repeat, label: 'Routine', onClick: () => setNewTask({ recurrence: { freq: 'daily' } }) },
          { icon: Globe, label: 'Recherche', onClick: () => setState({ page: 'chat', chatDraft: 'Recherchiere zu meiner Aufgabe: ' }) },
          { icon: Upload, label: 'Import', onClick: () => guard(() => rpc('study.import'), 'Importiert') },
        ]} />
      {newTask && <TaskEditor initial={newTask} onClose={() => setNewTask(null)} onSaved={(t) => { setNewTask(null); setSel(t.id); }} />}
    </div>
  );
}

/** "Titel morgen 14:00 !hoch #Kategorie" → task */
function parseQuick(text) {
  let t = text; const out = {};
  const prio = t.match(/!(hoch|high|mittel|medium|niedrig|low)\b/i);
  if (prio) { out.priority = { hoch: 'high', high: 'high', mittel: 'medium', medium: 'medium', niedrig: 'low', low: 'low' }[prio[1].toLowerCase()]; t = t.replace(prio[0], ''); }
  const cat = t.match(/#([\wäöüÄÖÜß-]+)/);
  if (cat) { out.category = cat[1]; t = t.replace(cat[0], ''); }
  const d = new Date(); let has = false;
  if (/\bübermorgen\b/i.test(t)) { d.setDate(d.getDate() + 2); has = true; t = t.replace(/\bübermorgen\b/i, ''); }
  else if (/\bmorgen\b/i.test(t)) { d.setDate(d.getDate() + 1); has = true; t = t.replace(/\bmorgen\b/i, ''); }
  else if (/\bheute\b/i.test(t)) { has = true; t = t.replace(/\bheute\b/i, ''); }
  const dm = t.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\b/);
  if (dm) { d.setMonth(+dm[2] - 1, +dm[1]); if (dm[3]) d.setFullYear(dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]); has = true; t = t.replace(dm[0], ''); }
  const tm = t.match(/\b(?:um\s+)?(\d{1,2})(?::(\d{2}))?\s*uhr\b|\b(\d{1,2}):(\d{2})\b/i);
  if (tm) { d.setHours(+(tm[1] || tm[3]), +(tm[2] || tm[4] || 0), 0, 0); has = true; t = t.replace(tm[0], ''); out.allDay = false; }
  else if (has) { d.setHours(23, 59, 0, 0); out.allDay = true; }
  if (has) out.dueAt = d.toISOString();
  out.title = t.replace(/\s+/g, ' ').trim() || text;
  return out;
}

function TaskDetail({ id, onDeleted }) {
  const [t, reload] = useRpc('tasks.get', { id }, { events: ['tasks:changed'], enabled: !!id, deps: [id] });
  const [notes, setNotes] = useState('');
  const [sub, setSub] = useState('');
  const [edit, setEdit] = useState(false);
  const saveTimer = useRef();
  useEffect(() => { if (t) setNotes(t.notes || ''); }, [t?.id]);
  if (!id || !t) return <section class="panel center"><div class="empty">Wähle eine Aufgabe aus.</div></section>;
  const saveNotes = (v) => { setNotes(v); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => rpc('tasks.update', { id: t.id, patch: { notes: v } }), 600); };
  return (
    <section class="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div class="col scroll" style={{ padding: 16, gap: 14 }}>
        <div class="row">
          <span class="pdot" style={{ width: 16, height: 16, background: PRIO_COLOR[t.priority] === 'var(--text-3)' ? catColor(t.category) : PRIO_COLOR[t.priority], boxShadow: '0 0 10px currentColor' }} />
          <div class="grow" style={{ fontSize: 18, fontWeight: 700 }}>{t.title}</div>
          <button class="btn icon xs ghost" title="Wichtig" onClick={() => rpc('tasks.update', { id: t.id, patch: { starred: !t.starred } })}><Star size={18} fill={t.starred ? 'var(--yellow)' : 'none'} style={{ color: t.starred ? 'var(--yellow)' : undefined }} /></button>
        </div>
        <div class="detail-meta">
          <CalendarDays size={16} /><span>{t.dueAt ? `${relDay(t.dueAt)}, ${fmtDate(t.dueAt)}` : 'Ohne Fälligkeit'}</span>
          <Clock size={16} /><span>{t.dueAt && !t.allDay ? fmtTime(t.dueAt) + ' Uhr' : 'ganztägig'}{t.reminderMinutes != null ? ` · Erinnerung ${t.reminderMinutes ? t.reminderMinutes + ' Min vorher' : 'zur Fälligkeit'}` : ''}</span>
          <BookOpen size={16} /><span>{t.category}</span>
          <Flag size={16} style={{ color: PRIO_COLOR[t.priority] }} /><span style={{ color: PRIO_COLOR[t.priority] }}>{PRIO[t.priority]}</span>
          {t.recurrence && <><Repeat size={16} /><span>{t.recurrenceLabel}</span></>}
        </div>
        <div class="row gap-s">
          <button class="btn xs" onClick={() => setEdit(true)}>Bearbeiten</button>
          <button class="btn xs" onClick={() => setState({ quickEvent: { title: t.title } })}><CalendarDays size={12} />Zeit blocken</button>
          <span class="grow" />
          <button class="btn icon xs danger" title="Löschen" onClick={async () => { if (await ask(`„${t.title}“ löschen?`, '', { confirmOnly: true, danger: true, okLabel: 'Löschen' })) { await guard(() => rpc('tasks.remove', { id: t.id }), 'Gelöscht'); onDeleted(); } }}><Trash2 size={14} /></button>
        </div>
        <div class="hr" />
        <div class="row"><ListChecks size={16} style={{ color: 'var(--cyan)' }} /><span class="hud-label grow">Unteraufgaben</span><span class="small muted">{t.subtasks.filter((s) => s.done).length} / {t.subtasks.length}</span></div>
        <div>
          {t.subtasks.map((s) => (
            <div class={`sub-row ${s.done ? 'done' : ''}`}>
              <Checkbox checked={s.done} onChange={(v) => rpc('tasks.complete', { id: s.id, done: v })} />
              <span class="grow">{s.title}</span>
              <X size={13} style={{ cursor: 'pointer', color: 'var(--text-3)' }} onClick={() => rpc('tasks.remove', { id: s.id })} />
            </div>
          ))}
          <div class="add-row mt"><Plus size={16} /><input placeholder="Unteraufgabe hinzufügen" value={sub} onInput={(e) => setSub(e.currentTarget.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && sub.trim()) { await rpc('tasks.create', { title: sub.trim(), parentId: t.id }); setSub(''); reload(); } }} /></div>
        </div>
        <div class="row"><Paperclip size={16} style={{ color: 'var(--cyan)' }} /><span class="hud-label grow">Dateien & Links</span><span class="small muted">{t.attachments.length}</span></div>
        <div class="col gap-s">
          {t.attachments.map((a) => (
            <div class="row small" style={{ cursor: 'pointer' }}>
              {a.kind === 'link' ? <LinkIcon size={14} /> : <FileText size={14} />}
              <span class="grow ellipsis" onClick={() => rpc('tasks.openAttachment', { ref: a.ref })}>{a.name}</span>
              <X size={13} style={{ color: 'var(--text-3)' }} onClick={() => rpc('tasks.removeAttachment', { id: a.id })} />
            </div>
          ))}
          <div class="add-row" onClick={async () => {
            const v = await ask('Link (https://…) einfügen – oder leer lassen, um eine Datei zu wählen', '');
            if (v === null) return;
            if (v.trim()) return guard(() => rpc('tasks.addAttachment', { id: t.id, kind: 'link', name: v.trim().replace(/^https?:\/\//, '').slice(0, 60), ref: v.trim() }));
            const files = await rpc('dialog.pickFiles', { kind: 'any' });
            for (const f of files || []) await guard(() => rpc('tasks.addAttachment', { id: t.id, kind: 'file', name: f.split(/[\\/]/).pop(), ref: f }));
          }}><Plus size={16} />Datei oder Link hinzufügen</div>
        </div>
        <div class="row"><NotebookPen size={16} style={{ color: 'var(--cyan)' }} /><span class="hud-label">Notizen</span></div>
        <textarea class="ta" rows={4} placeholder="Notiz zu dieser Aufgabe …" value={notes} onInput={(e) => saveNotes(e.currentTarget.value)} />
        {t.history?.length > 0 && <details class="small muted"><summary style={{ cursor: 'pointer' }}><History size={12} /> Verlauf</summary>{t.history.map((h) => <div>{new Date(h.at).toLocaleString('de-DE')} · {HIST[h.action] || h.action}{h.detail ? ` (${h.detail})` : ''}</div>)}</details>}
      </div>
      {edit && <TaskEditor initial={t} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
    </section>
  );
}
const HIST = { created: 'erstellt', updated: 'geändert', done: 'erledigt', reopened: 'wieder geöffnet', occurrence_done: 'Wiederholung erledigt', attachment: 'Anhang', deleted: 'gelöscht' };

function TaskEditor({ initial, onClose, onSaved }) {
  const [cats] = useRpc('tasks.categories', {}, { initial: [] });
  const [f, setF] = useState({
    title: initial.title || '', notes: initial.notes || '', category: initial.category || 'Allgemein', priority: initial.priority || 'medium',
    dueAt: toLocalInput(initial.dueAt), allDay: !!initial.allDay, reminderMinutes: initial.reminderMinutes ?? '', recurrence: initial.recurrence || null,
  });
  const set = (p) => setF({ ...f, ...p });
  const save = async () => {
    const body = { title: f.title, notes: f.notes, category: f.category || 'Allgemein', priority: f.priority, dueAt: fromLocalInput(f.dueAt), allDay: f.allDay,
      reminderMinutes: f.reminderMinutes === '' ? null : Number(f.reminderMinutes), recurrence: f.recurrence };
    const t = await guard(() => (initial.id ? rpc('tasks.update', { id: initial.id, patch: body }) : rpc('tasks.create', body)), initial.id ? 'Gespeichert' : 'Aufgabe erstellt');
    if (t) onSaved(t);
  };
  const r = f.recurrence;
  return (
    <Modal title={initial.id ? 'Aufgabe bearbeiten' : r ? 'Neue Routine' : 'Neue Aufgabe'} onClose={onClose}
      actions={<><button class="btn sm ghost" onClick={onClose}>Abbrechen</button><button class="btn sm primary" disabled={!f.title.trim()} onClick={save}>Speichern</button></>}>
      <Field label="Titel" wide><input class="inp" value={f.title} onInput={(e) => set({ title: e.currentTarget.value })} autofocus /></Field>
      <Field label="Kategorie" wide><input class="inp" list="cats" value={f.category} onInput={(e) => set({ category: e.currentTarget.value })} /><datalist id="cats">{['Studium', 'Privat', 'Gesundheit', 'Organisation', 'Persönlich', 'Gaming', 'Routine', ...(cats || [])].map((c) => <option value={c} />)}</datalist></Field>
      <Field label="Priorität" wide><Select value={f.priority} onChange={(v) => set({ priority: v })} options={[{ value: 'high', label: 'Hoch' }, { value: 'medium', label: 'Mittel' }, { value: 'low', label: 'Niedrig' }]} /></Field>
      <Field label="Fällig" wide><input class="inp" type="datetime-local" value={f.dueAt} onInput={(e) => set({ dueAt: e.currentTarget.value })} /></Field>
      <Field label={<span><Bell size={12} /> Erinnerung</span>} wide>
        <Select value={String(f.reminderMinutes)} onChange={(v) => set({ reminderMinutes: v })} options={[{ value: '', label: 'Keine' }, { value: '0', label: 'Zur Fälligkeit' }, { value: '10', label: '10 Min vorher' }, { value: '30', label: '30 Min vorher' }, { value: '60', label: '1 Std vorher' }, { value: '1440', label: '1 Tag vorher' }]} />
      </Field>
      <Field label="Wiederholung" wide>
        <Select value={r?.freq || ''} onChange={(v) => set({ recurrence: v ? { freq: v, interval: r?.interval || 1, byDay: v === 'weekly' ? r?.byDay : undefined } : null })}
          options={[{ value: '', label: 'Keine' }, { value: 'daily', label: 'Täglich' }, { value: 'weekly', label: 'Wöchentlich' }, { value: 'monthly', label: 'Monatlich' }, { value: 'yearly', label: 'Jährlich' }]} />
      </Field>
      {r && <Field label="Alle … " wide><input class="inp" type="number" min="1" max="365" value={r.interval || 1} onInput={(e) => set({ recurrence: { ...r, interval: Number(e.currentTarget.value) || 1 } })} /></Field>}
      {r?.freq === 'weekly' && <div class="row wrap gap-s" style={{ justifyContent: 'flex-end' }}>{DAYS.map(([k, l]) => <span class={`chip ${r.byDay?.includes(k) ? 'active' : ''}`} onClick={() => { const b = new Set(r.byDay || []); b.has(k) ? b.delete(k) : b.add(k); set({ recurrence: { ...r, byDay: [...b] } }); }}>{l}</span>)}</div>}
      <Field label="Notizen" wide><textarea class="ta" value={f.notes} onInput={(e) => set({ notes: e.currentTarget.value })} /></Field>
    </Modal>
  );
}
