import { useState, useMemo } from 'preact/hooks';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, CirclePlus, Sparkles, Upload, TriangleAlert, Cloud, CloudOff } from 'lucide-preact';
import { rpc, useRpc } from '../lib/api.js';
import { useStore, setState, guard } from '../lib/store.js';
import { ChatBar } from '../components/Shell.jsx';
import { Panel, Toggle, Spinner } from '../components/ui.jsx';
import { fmtTime, ago } from '../lib/format.js';

const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const sod = (d) => { const z = new Date(d); z.setHours(0, 0, 0, 0); return z; };
const startOfWeek = (d) => { const z = sod(d); z.setDate(z.getDate() - ((z.getDay() + 6) % 7)); return z; };

export function Calendar() {
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(new Date());
  const google = useStore((s) => s.google);
  const range = useMemo(() => {
    if (view === 'week') { const s = startOfWeek(cursor); return [s, new Date(s.getTime() + 7 * 86400000)]; }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const s = startOfWeek(first);
    return [s, new Date(s.getTime() + 42 * 86400000)];
  }, [view, cursor]);
  const [events] = useRpc('calendar.list', { from: range[0].toISOString(), to: range[1].toISOString() }, { events: ['calendar:changed'], initial: [] });
  const [tasks] = useRpc('tasks.list', { filter: 'all', limit: 500 }, { events: ['tasks:changed'], initial: [] });
  const [cals, reloadCals] = useRpc('calendar.calendars', {}, { events: ['calendar:changed'], initial: [] });
  const [status] = useRpc('calendar.status', {}, { events: ['calendar:sync', 'calendar:changed'] });
  const step = (n) => { const d = new Date(cursor); if (view === 'week') d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n); setCursor(d); };
  const title = view === 'week' ? `KW ${isoWeek(range[0])} · ${range[0].toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} – ${new Date(range[1] - 1).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}` : cursor.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const byDay = (d) => {
    const a = sod(d).getTime(), b = a + 86400000;
    return [
      ...(events || []).filter((e) => Date.parse(e.start) < b && Date.parse(e.end) > a).map((e) => ({ ...e, kind: 'event' })),
      ...(tasks || []).filter((t) => t.dueAt && Date.parse(t.dueAt) >= a && Date.parse(t.dueAt) < b).map((t) => ({ id: t.id, title: t.title, start: t.dueAt, allDay: t.allDay, kind: 'task' })),
    ].sort((x, y) => (x.allDay === y.allDay ? x.start.localeCompare(y.start) : x.allDay ? -1 : 1));
  };
  const openNew = (d, allDay = false) => { const s = new Date(d); if (s.getHours() === 0) s.setHours(10); setState({ quickEvent: { title: '', start: s, allDay } }); };
  return (
    <div class="page">
      <div class="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 250px', gap: 10 }}>
        <section class="panel glow" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: 14, gap: 10 }}>
          <div class="row">
            <CalendarDays size={28} style={{ color: 'var(--cyan)' }} />
            <div class="hud-title" style={{ fontSize: 22, color: 'white', minWidth: 260 }}>{title}</div>
            <button class="btn icon sm" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
            <button class="btn sm" onClick={() => setCursor(new Date())}>Heute</button>
            <button class="btn icon sm" onClick={() => step(1)}><ChevronRight size={18} /></button>
            <span class="grow" />
            <div class="tabs sm"><button class={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Monat</button><button class={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Woche</button></div>
          </div>
          {view === 'month' ? (
            <div class="cal-grid" style={{ gridTemplateRows: 'auto repeat(6, 1fr)' }}>
              {DOW.map((d) => <div class="dow">{d}</div>)}
              {Array.from({ length: 42 }, (_, i) => {
                const d = new Date(range[0].getTime() + i * 86400000);
                const items = byDay(d);
                const today = sod(d).getTime() === sod(new Date()).getTime();
                return (
                  <div class={`cal-cell ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${today ? 'today' : ''}`} onDblClick={() => openNew(d, true)}>
                    <div class="d">{d.getDate()}</div>
                    {items.slice(0, 4).map((e) => <EvChip e={e} />)}
                    {items.length > 4 && <div class="tiny muted">+{items.length - 4} weitere</div>}
                  </div>
                );
              })}
            </div>
          ) : <Week start={range[0]} byDay={byDay} onNew={openNew} />}
          <div class="tiny muted">Doppelklick auf einen Tag (ganztägig) oder eine Stunde legt einen Termin an · gelb = Aufgaben · 🎂 Geburtstage · 🎉 Feiertage · 📝 Prüfungen · 📚 Lernen</div>
        </section>
        <div class="col scroll" style={{ minHeight: 0 }}>
          <Panel icon={google.connected ? Cloud : CloudOff} title="Google Kalender" sub={google.connected ? (status?.account || 'verbunden') : 'nicht verbunden'}>
            {google.connected ? <>
              <div class="small muted">Letzter Abgleich: {status?.lastSync ? ago(status.lastSync) : '—'}{status?.syncing ? ' · läuft…' : ''}</div>
              {status?.pending > 0 && <div class="small warn">{status.pending} Änderung(en) warten auf Upload</div>}
              {status?.error && <div class="small err">{status.error}</div>}
              <button class="btn sm mt" onClick={() => guard(() => rpc('calendar.sync'), 'Synchronisiert')}>{status?.syncing ? <Spinner /> : <RefreshCw size={14} />}Jetzt synchronisieren</button>
            </> : <><div class="small muted">Termine bleiben lokal, bis du Google verbindest.</div><button class="btn sm mt" onClick={() => setState({ page: 'settings' })}>Verbinden…</button></>}
          </Panel>
          <Panel title="Kalender" sub="Sichtbarkeit">
            {(cals || []).map((c) => (
              <div class="row" style={{ padding: '4px 0' }}>
                <span class="status-dot" style={{ background: c.color }} />
                <span class="grow ellipsis small">{c.name}{c.primary ? ' (Haupt)' : ''}</span>
                <Toggle checked={c.selected} onChange={async (v) => { await rpc('calendar.select', { id: c.id, selected: v }); reloadCals(); if (v) rpc('calendar.sync').catch(() => {}); }} />
              </div>
            ))}
          </Panel>
          <Conflicts events={events} />
        </div>
      </div>
      <ChatBar actions={[
        { icon: CirclePlus, label: 'Neuer Termin', onClick: () => openNew(new Date()) },
        { icon: Sparkles, label: 'Planen', onClick: () => setState({ page: 'chat', chatDraft: 'Plane mir diese Woche drei Lerneinheiten à 90 Minuten in freien Zeitfenstern für: ' }) },
        { icon: Upload, label: 'Import', onClick: () => guard(() => rpc('study.import'), 'Importiert') },
      ]} />
    </div>
  );
}

function EvChip({ e }) {
  const cls = e.kind === 'task' ? 'task' : e.syncState?.startsWith('pending') ? 'pending' : e.syncState === 'conflict' ? 'conflict' : '';
  return (
    <div class={`ev ${cls} ${e.kind === 'event' ? 'colored' : ''} ${e.allDay ? 'allday' : ''}`} style={e.kind === 'event' && e.color ? { borderLeftColor: e.color, ...(e.allDay ? { background: hexA(e.color, 0.28) } : {}) } : undefined} title={`${e.title}${e.categoryLabel ? ' · ' + e.categoryLabel : ''}${e.location ? ' · ' + e.location : ''}`}
      onClick={(ev) => { ev.stopPropagation(); if (e.kind === 'task') setState({ page: 'tasks', focusTask: e.id }); else rpc('calendar.get', { id: e.instanceOf || e.id }).then((full) => setState({ quickEvent: { event: full || e } })); }}>
      {e.icon && <span>{e.icon} </span>}{!e.allDay && <b>{fmtTime(e.start)} </b>}{e.title}
    </div>
  );
}

function Week({ start, byDay, onNew }) {
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000));
  const H = 48;
  const now = new Date();
  return (
    <div class="week" ref={(el) => { if (el && !el.dataset.scrolled) { el.scrollTop = H * 7; el.dataset.scrolled = '1'; } }}>
      <div class="hcol">{Array.from({ length: 24 }, (_, h) => <div class="hour">{String(h).padStart(2, '0')}:00</div>)}</div>
      {days.map((d) => {
        const items = byDay(d);
        return (
          <div class="hcol" style={{ minHeight: H * 24 }}>
            <div style={{ position: 'sticky', top: 0, zIndex: 3, background: 'rgba(5,18,32,0.96)', textAlign: 'center', padding: 4, borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-hud)', fontWeight: 700, color: sod(d).getTime() === sod(now).getTime() ? 'var(--cyan-2)' : 'var(--text-2)' }}>
              {DOW[(d.getDay() + 6) % 7]} {d.getDate()}.
              {items.filter((e) => e.allDay).map((e) => <EvChip e={e} />)}
            </div>
            {Array.from({ length: 24 }, (_, h) => <div class="hour" onDblClick={() => { const s = new Date(d); s.setHours(h); onNew(s); }} />)}
            {items.filter((e) => !e.allDay).map((e) => {
              const s = new Date(e.start); const en = e.end ? new Date(e.end) : new Date(s.getTime() + 1800000);
              const top = (s.getHours() + s.getMinutes() / 60) * H + 30; const h = Math.max(20, ((en - s) / 3600000) * H);
              return <div class="wev" style={{ top, height: h, ...(e.kind === 'task' ? { background: 'rgba(250,204,21,0.15)', borderColor: 'rgba(250,204,21,0.5)' } : e.color ? { borderColor: e.color, background: hexA(e.color, 0.18) } : {}) }}
                onClick={() => (e.kind === 'task' ? setState({ page: 'tasks', focusTask: e.id }) : rpc('calendar.get', { id: e.instanceOf || e.id }).then((full) => setState({ quickEvent: { event: full || e } })))}>
                <b>{fmtTime(e.start)}</b> {e.icon ? e.icon + ' ' : ''}{e.title}
              </div>;
            })}
            {sod(d).getTime() === sod(now).getTime() && <div class="now" style={{ top: (now.getHours() + now.getMinutes() / 60) * H + 30 }} />}
          </div>
        );
      })}
    </div>
  );
}

function Conflicts({ events }) {
  const list = (events || []).filter((e) => e.syncState === 'conflict');
  if (!list.length) return null;
  return (
    <Panel icon={TriangleAlert} title="Konflikte" sub="Auf beiden Seiten geändert">
      {list.map((e) => (
        <div class="col gap-s" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
          <div class="small"><b>{e.title}</b> (lokal)</div>
          <div class="tiny muted">Google: „{e.conflict?.remoteTitle}“ {e.conflict?.remoteStart ? new Date(e.conflict.remoteStart).toLocaleString('de-DE') : ''}</div>
          <div class="row gap-s"><button class="btn xs" onClick={() => guard(() => rpc('calendar.resolveConflict', { id: e.id, keep: 'local' }), 'Lokale Version übernommen')}>Meine behalten</button><button class="btn xs" onClick={() => guard(() => rpc('calendar.resolveConflict', { id: e.id, keep: 'remote' }), 'Google-Version übernommen')}>Google übernehmen</button></div>
        </div>
      ))}
    </Panel>
  );
}

function hexA(hex, a) { const m = String(hex).match(/^#?([0-9a-f]{6})$/i); if (!m) return undefined; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

function isoWeek(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 86400000 + 1) / 7); }
