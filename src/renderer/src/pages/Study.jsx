import { useState, useEffect } from 'preact/hooks';
import { Plus, Trash2, Target, BookOpen, FolderOpen, RefreshCw, Upload, Search, FileText, PenLine, Sparkles, ListChecks, Layers, GraduationCap, CalendarDays, ExternalLink, TriangleAlert, CircleCheck, Lightbulb, Scale } from 'lucide-preact';
import { rpc, useRpc } from '../lib/api.js';
import { useStore, setState, guard, toast, getState } from '../lib/store.js';
import { ChatBar } from '../components/Shell.jsx';
import { Panel, Spinner, Empty, Modal, ask } from '../components/ui.jsx';
import { ago } from '../lib/format.js';

const TOOLS = [
  { icon: Sparkles, label: 'Zusammenfassen', prompt: (d) => `Fasse das Dokument „${d.path}“ (docId ${d.id}) strukturiert zusammen – mit Seitenverweisen.` },
  { icon: Lightbulb, label: 'Erklären', prompt: (d) => `Erkläre mir die wichtigsten Konzepte aus „${d.path}“ (docId ${d.id}) Schritt für Schritt als Tutor.` },
  { icon: ListChecks, label: 'Lernfragen', prompt: (d) => `Erstelle 10 Lernfragen mit Musterlösungen zu „${d.path}“ (docId ${d.id}). Nenne zu jeder Frage die Seite.` },
  { icon: GraduationCap, label: 'Quiz', prompt: (d) => `Starte ein Quiz zu „${d.path}“ (docId ${d.id}): stelle mir nacheinander je eine Multiple-Choice-Frage und bewerte meine Antwort, bevor du die nächste stellst.` },
  { icon: Layers, label: 'Lernkarten', prompt: (d) => `Erstelle Lernkarten (Vorderseite | Rückseite) als Tabelle zu „${d.path}“ (docId ${d.id}).` },
  { icon: CalendarDays, label: 'Lernplan', prompt: (d) => `Erstelle mir einen Lernplan für diese Woche zu „${d.path}“ (docId ${d.id}). Prüfe meine freien Zeitfenster und schlage konkrete Termine vor.` },
];

export function Study() {
  const [status, reloadStatus] = useRpc('study.status', {}, { events: ['study:changed', 'study:progress', 'settings:changed'] });
  const [subject, setSubject] = useState('');
  const [subjects] = useRpc('study.subjects', {}, { events: ['study:changed'], initial: [] });
  const [docs] = useRpc('study.documents', { subject: subject || undefined }, { events: ['study:changed'], initial: [], deps: [subject] });
  const focusDoc = useStore((s) => s.focusDoc);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => { if (focusDoc) { setSel(focusDoc); setState({ focusDoc: null }); } }, [focusDoc]);
  const search = async (text) => {
    const t = (text ?? q).trim(); if (!t) { setHits(null); return; }
    setSearching(true);
    const r = await guard(() => rpc('brain.search', { q: t, scope: 'documents' }));
    setSearching(false);
    setHits((r?.results || []).filter((x) => x.source !== 'web'));
  };
  const pickFolder = async () => {
    const f = await rpc('dialog.pickFolder');
    if (!f) return;
    const c = await rpc('study.check', { folder: f });
    if (!c.ok) return toast(c.error, 'error');
    await guard(() => rpc('settings.update', { study: { folder: f, source: 'folder', enabled: true } }), `Ordner verbunden (${c.files} Dateien gefunden) – Indexierung läuft`);
    reloadStatus();
  };
  const p = status?.progress;
  return (
    <div class="page">
      <div class="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 10 }}>
        <div class="col" style={{ minHeight: 0 }}>
          <section class="panel glow" style={{ padding: '14px 16px' }}>
            <div class="row">
              <div class="center" style={{ width: 56, height: 56, border: '1px solid var(--line-strong)', borderRadius: 10, color: 'var(--cyan)' }}><BookOpen size={30} /></div>
              <div class="grow">
                <div class="hud-title" style={{ color: 'white', fontSize: 24 }}>Studium</div>
                <div class="muted small">{status?.source === 'drive' ? <>Goodnotes → Google Drive „{status.driveFolder}“ → JARVIS-Index → Brain</> : <>Goodnotes → {status?.folder ? <span class="selectable" style={{ color: 'var(--text-2)' }}>{status.folder}</span> : 'Ordner wählen'} → JARVIS-Index → Brain</>}</div>
              </div>
              {status?.source === 'drive'
                ? (status.driveGranted ? <button class="btn sm" onClick={async () => { const r = await guard(() => rpc('drive.sync', {})); if (r) toast(`Drive abgeglichen: ${r.files} Dateien, ${r.changed} geändert`); reloadStatus(); }}><RefreshCw size={16} />Drive abgleichen</button>
                  : <button class="btn sm primary" onClick={async () => { const r = await guard(() => rpc('drive.connect')); if (r) { toast('Google Drive verbunden'); reloadStatus(); } }}>Google Drive verbinden</button>)
                : <button class="btn sm" onClick={pickFolder}><FolderOpen size={16} />{status?.folder ? 'Ordner ändern' : 'Ordner wählen'}</button>}
              <button class="btn sm" disabled={!status?.enabled} onClick={() => guard(() => rpc('study.scan'), 'Scan gestartet')}><RefreshCw size={16} />Scannen</button>
            </div>
            <div class="row wrap mt" style={{ gap: 18 }}>
              <span class="pill"><span class={`status-dot ${status?.watching ? 'dot-ok' : 'dot-off'}`} />{status?.watching ? 'Ordnerüberwachung aktiv' : 'Keine Überwachung'}</span>
              <span class="pill"><CircleCheck size={14} />{status?.indexed || 0} / {status?.documents || 0} indexiert</span>
              {status?.errors > 0 && <span class="pill err"><TriangleAlert size={14} />{status.errors} Fehler</span>}
              <span class="pill"><PenLine size={14} />{status?.handwritingPending || 0} handschriftliche Seiten ohne Transkription</span>
              <span class="pill">Seitenanalysen heute übrig: {status?.visionBudgetLeft ?? '–'}</span>
              {p?.state === 'running' && <span class="pill"><Spinner />{p.done}/{p.total} · {p.current}</span>}
            </div>
          </section>
          <section class="panel" style={{ padding: 12 }}>
            <div class="row">
              <div class="grow" style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: 10, top: 8, color: 'var(--text-3)' }} />
                <input class="inp" style={{ paddingLeft: 32 }} placeholder="In Mitschriften suchen (z. B. Backpropagation, Scheitelpunktform)…" value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
              </div>
              <button class="btn sm" onClick={() => search()}>{searching ? <Spinner /> : <Search size={14} />}Suchen</button>
              {hits && <button class="btn sm ghost" onClick={() => { setHits(null); setQ(''); }}>Zurück</button>}
            </div>
          </section>
          {hits ? (
            <section class="panel col scroll" style={{ flex: 1, minHeight: 0, padding: 12, gap: 8 }}>
              {!hits.length && <Empty>Keine Treffer in den Unterlagen.</Empty>}
              {hits.map((h) => (
                <div class="result-row" style={{ alignItems: 'flex-start' }} onClick={() => setSel(h.docId)}>
                  <FileText size={18} />
                  <div class="grow"><div style={{ fontWeight: 600 }}>{h.citation}</div><div class="small" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{h.snippet}</div></div>
                  <span class="chip static">{h.subject}</span>
                </div>
              ))}
              <button class="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setState({ page: 'chat', chatDraft: `Beantworte mit Quellen aus meinen Mitschriften: ${q}` })}><Sparkles size={14} />Mit JARVIS beantworten</button>
            </section>
          ) : (
            <section class="panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div class="row wrap gap-s" style={{ padding: 12 }}>
                <span class={`chip ${!subject ? 'active' : ''}`} onClick={() => setSubject('')}>Alle Fächer</span>
                {(subjects || []).map((s) => <span class={`chip ${subject === s.subject ? 'active' : ''}`} onClick={() => setSubject(s.subject)}>{s.subject} · {s.count}</span>)}
              </div>
              <div class="col scroll" style={{ padding: '0 12px 12px', gap: 6, flex: 1 }}>
                {!docs?.length && <Empty>{status?.enabled ? 'Noch keine Dokumente indexiert – der erste Abgleich kann ein paar Minuten dauern.' : 'Verbinde deinen Google-Drive-Ordner „Goodnotes“ (oder einen Ordner auf diesem PC) – JARVIS indexiert PDFs, DOCX, PPTX, Markdown, TXT und Notebooks automatisch.'}</Empty>}
                {(docs || []).map((d) => (
                  <div class={`result-row ${sel === d.id ? 'sel' : ''}`} onClick={() => setSel(d.id)}>
                    <FileText size={18} />
                    <div class="grow"><div class="ellipsis" style={{ fontWeight: 600 }}>{d.title}</div><div class="tiny muted ellipsis">{d.path} · {d.pages} Seiten · {d.ext.toUpperCase()}{d.indexedAt ? ' · ' + ago(d.indexedAt) : ''}</div></div>
                    {d.handwritingPages > 0 && <span class="chip static" title="Seiten ohne Textebene (Handschrift)"><PenLine size={12} />{d.handwritingPages}</span>}
                    <span class={`status-dot ${d.status === 'indexed' ? 'dot-ok' : d.status === 'error' ? 'dot-err' : d.status === 'duplicate' ? 'dot-off' : 'dot-warn'}`} title={d.error || d.status} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <div class="col" style={{ minHeight: 0, gap: 10 }}>
          <ExamsPanel />
          <DocDetail id={sel} />
        </div>
      </div>
      <ChatBar actions={[
        { icon: Sparkles, label: 'Lernplan', onClick: () => setState({ page: 'chat', chatDraft: 'Erstelle mir einen Lernplan für diese Woche. Prüfe meine Termine und Aufgaben und schlage freie Zeitfenster vor für: ' }) },
        { icon: Scale, label: 'Vergleichen', onClick: () => setState({ page: 'chat', chatDraft: 'Vergleiche in meinen Mitschriften die Themen ' }) },
        { icon: Upload, label: 'Import', onClick: async () => { const r = await guard(() => rpc('study.import')); if (r?.length) toast(`${r.filter((x) => !x.error).length} Datei(en) indexiert`); } },
      ]} />
    </div>
  );
}

function DocDetail({ id }) {
  const [d, reload] = useRpc('study.document', { id }, { events: ['study:changed'], enabled: !!id, deps: [id] });
  const [busy, setBusy] = useState(null);
  if (!id || !d) return <section class="panel center"><Empty>Dokument auswählen für Details und Lernwerkzeuge.</Empty></section>;
  const hw = d.pages.filter((p) => p.needs_vision === 1);
  const analyze = async (page) => { setBusy(page); await guard(() => rpc('study.analyzePage', { id: d.id, page }), `Seite ${page} transkribiert`); setBusy(null); reload(); };
  const ask = (t) => { setState({ page: 'chat' }); rpc('chat.send', { conversationId: getState().conversationId, text: t.prompt(d) }); };
  return (
    <section class="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div class="col scroll" style={{ padding: 16, gap: 12 }}>
        <div class="row"><FileText size={22} style={{ color: 'var(--cyan)' }} /><div class="grow" style={{ fontWeight: 700, fontSize: 16 }}>{d.title}</div></div>
        <div class="small muted selectable">{d.path}</div>
        <div class="row gap-s"><span class="chip static">{d.subject}</span><span class="chip static">{d.pages.length} Seiten</span><span class="chip static">{d.ext?.toUpperCase()}</span></div>
        <button class="btn sm" onClick={() => rpc('shell.showDocument', { docId: d.id })}><ExternalLink size={14} />Datei öffnen</button>
        <div class="hud-label mt">Lernwerkzeuge</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {TOOLS.map((t) => <button class="btn sm" onClick={() => ask(t)}><t.icon size={14} />{t.label}</button>)}
        </div>
        <div class="hud-label mt">Handschrift & Formeln</div>
        {!hw.length ? <div class="small muted">Alle Seiten haben eine Textebene{d.pages.some((p) => p.needs_vision === 2) ? ' bzw. wurden bereits transkribiert' : ''}.</div> : (
          <>
            <div class="small muted">Diese Seiten enthalten keine digitale Textebene (z. B. Goodnotes-Handschrift). Gemini kann sie bei Bedarf transkribieren – das Ergebnis wird per Seitenprüfsumme zwischengespeichert.</div>
            <div class="row wrap gap-s">{hw.slice(0, 60).map((p) => <button class="btn xs" disabled={busy != null} onClick={() => analyze(p.page)}>{busy === p.page ? <Spinner size={12} /> : <PenLine size={12} />}S. {p.page}</button>)}</div>
          </>
        )}
      </div>
    </section>
  );
}

const dLocal = (iso) => { const d = new Date(iso); return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };

/** Klausurmodus: Prüfungen (auch automatisch aus Campus Dual), Lernstand, Lernplan vorschlagen → bestätigen. */
function ExamsPanel() {
  const [exams, reload] = useRpc('exams.list', {}, { events: ['exams:changed'], initial: [] });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', date: '', targetHours: 15 });
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(null);
  const add = async () => {
    const r = await guard(() => rpc('exams.create', { title: f.title.trim(), date: new Date(f.date).toISOString(), targetHours: Number(f.targetHours) || 15 }), 'Klausur angelegt');
    if (r) { setAdding(false); setF({ title: '', date: '', targetHours: 15 }); reload(); }
  };
  const propose = async (x) => { setBusy(x.id); const p = await guard(() => rpc('exams.propose', { id: x.id })); setBusy(null); if (p) setPlan({ ...p, exam: x }); };
  const apply = async () => { setBusy('apply'); const r = await guard(() => rpc('exams.apply', { id: plan.examId, sessions: plan.sessions })); setBusy(null); if (r) { toast(`${r.created} Lerneinheiten eingetragen`); setPlan(null); reload(); } };
  return (
    <section class="panel" style={{ padding: 12, maxHeight: '48%', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div class="row"><GraduationCap size={18} style={{ color: 'var(--cyan)' }} /><b class="grow">Klausuren</b><button class="btn icon xs" title="Klausur anlegen" onClick={() => setAdding(!adding)}><Plus size={14} /></button></div>
      {adding && <div class="col mt" style={{ gap: 6 }}>
        <input class="inp" placeholder="z. B. Mathematik II" value={f.title} onInput={(e) => setF({ ...f, title: e.currentTarget.value })} />
        <div class="row gap-s"><input class="inp" type="datetime-local" value={f.date} onInput={(e) => setF({ ...f, date: e.currentTarget.value })} /><input class="inp" type="number" min="1" max="300" title="Lernziel in Stunden" style={{ width: 70 }} value={f.targetHours} onInput={(e) => setF({ ...f, targetHours: e.currentTarget.value })} /><span class="tiny muted">h</span></div>
        <button class="btn xs primary" disabled={!f.title.trim() || !f.date} onClick={add}>Anlegen</button>
      </div>}
      <div class="col scroll mt" style={{ gap: 8, minHeight: 0 }}>
        {!exams.length && !adding && <div class="small muted">Keine Klausuren. Prüfungen aus deinem Campus-Dual-Stundenplan legt JARVIS automatisch an – oder „+“.</div>}
        {exams.map((x) => {
          const pct = Math.min(100, Math.round((100 * x.hoursDone) / (x.targetHours || 1)));
          return (
            <div class="sub-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div class="row"><b class="grow ellipsis" title={x.notes || ''}>{x.title}</b><span class={`chip static ${x.daysLeft <= 7 ? 'warn' : ''}`}>{x.daysLeft <= 0 ? 'heute' : `in ${x.daysLeft} T.`}</span></div>
              <div class="tiny muted">{dLocal(x.date)}{/Campus Dual/.test(x.notes || '') ? ' · aus Campus Dual' : ''}{x.missed ? ` · ${x.missed} verpasst` : ''}</div>
              <div style={{ height: 5, background: 'var(--line)', borderRadius: 3 }}><div style={{ width: pct + '%', height: '100%', background: 'var(--cyan)', borderRadius: 3 }} /></div>
              <div class="row tiny"><span class="grow muted">{x.hoursDone}/{x.targetHours} h gelernt{x.hoursPlanned ? ` · ${x.hoursPlanned} h geplant` : ''}{x.nextSession ? ` · nächste: ${dLocal(x.nextSession.start)}` : ''}</span>
                <button class="btn xs" disabled={busy != null} onClick={() => propose(x)}>{busy === x.id ? <Spinner size={12} /> : <CalendarDays size={12} />}{x.hoursPlanned ? 'Neu planen' : 'Lernplan'}</button>
                <button class="btn icon xs ghost" title="Löschen" onClick={async () => { if (await ask(`Klausur „${x.title}“ und ihre künftigen Lerneinheiten löschen?`, '', { confirmOnly: true, danger: true, okLabel: 'Löschen' })) { await guard(() => rpc('exams.remove', { id: x.id })); reload(); } }}><Trash2 size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>
      {plan && (
        <Modal title={`Lernplan: ${plan.exam.title}`} onClose={() => setPlan(null)}>
          {!plan.sessions.length ? <div class="notice warn">{plan.note || 'Keine freien Zeiten gefunden.'}</div> : <>
            <div class="small muted">{plan.sessions.length} Einheiten · {plan.hours} h in deinen freien Zeiten (Stundenplan und Termine berücksichtigt){plan.replaces ? ` · ersetzt ${plan.replaces} geplante Einheiten` : ''}</div>
            {plan.note && <div class="notice warn small mt">{plan.note}</div>}
            <div class="col scroll mt" style={{ maxHeight: 340, gap: 4 }}>{plan.sessions.map((x) => <div class="row small"><Target size={12} style={{ color: 'var(--cyan)' }} /><span style={{ width: 150 }}>{dLocal(x.start)}</span><span class="grow ellipsis">{x.topic}</span></div>)}</div>
            <div class="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}><button class="btn sm ghost" onClick={() => setPlan(null)}>Abbrechen</button><button class="btn sm primary" disabled={busy === 'apply'} onClick={apply}>{busy === 'apply' ? <Spinner /> : null}In den Kalender eintragen</button></div>
          </>}
        </Modal>
      )}
    </section>
  );
}
