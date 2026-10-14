import { useEffect, useRef, useState } from 'preact/hooks';
import { X, Check, ChevronRight } from 'lucide-preact';
import { useStore } from '../lib/store.js';

export function Panel({ icon: Icon, title, sub, right, children, class: cls = '', bodyClass = '', style, glow, onHeadClick }) {
  return (
    <section class={`panel ${glow ? 'glow' : ''} ${cls}`} style={style}>
      {(title || Icon) && (
        <div class="panel-head" onClick={onHeadClick} style={onHeadClick ? { cursor: 'pointer' } : undefined}>
          {Icon && <div class="ico"><Icon size={28} strokeWidth={1.6} /></div>}
          <div class="grow">
            <h3>{title}</h3>
            {sub && <div class="sub">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      <div class={`panel-body ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, disabled, title }) {
  return (
    <label class="toggle" title={title} style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span />
    </label>
  );
}

export function Field({ label, children, wide, hint }) {
  return (
    <div class={`field ${wide ? 'wide' : ''}`}>
      <div class="lbl">{label}{hint && <div class="tiny muted">{hint}</div>}</div>
      <div style={{ justifySelf: 'end', width: '100%', display: 'flex', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  );
}

/**
 * Eigenes Dropdown statt nativem <select>: die nativen Auswahllisten öffnen
 * sich in Electron als separates Systemfenster und funktionierten nicht
 * zuverlässig (z. B. unter dem Overlay oder bei Skalierung). Dieses rendert im
 * Fenster selbst, mit Tastatur (↑ ↓ Enter Esc) und ohne Abschneiden (position: fixed).
 */
export function Select({ value, onChange, options, style, placeholder = '–', class: cls = '' }) {
  const opts = (options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(); const list = useRef();
  const cur = opts.find((o) => String(o.value) === String(value));
  const place = () => {
    const r = btn.current.getBoundingClientRect();
    const h = Math.min(320, opts.length * 34 + 8);
    const below = window.innerHeight - r.bottom > h + 8 || r.top < h + 8;
    setPos({ left: r.left, width: Math.max(r.width, 160), top: below ? r.bottom + 4 : r.top - h - 4, maxHeight: h });
  };
  const toggle = () => { if (open) return setOpen(false); place(); setHi(Math.max(0, opts.findIndex((o) => String(o.value) === String(value)))); setOpen(true); };
  const pick = (o) => { setOpen(false); if (String(o.value) !== String(value)) onChange(o.value); btn.current?.focus(); };
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!btn.current?.contains(e.target) && !list.current?.contains(e.target)) setOpen(false); };
    const close = (e) => { if (!list.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', away, true); window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);
  useEffect(() => { if (open) list.current?.children[hi]?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);
  const key = (e) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); toggle(); return; }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((hi + 1) % opts.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((hi - 1 + opts.length) % opts.length); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (opts[hi]) pick(opts[hi]); }
  };
  return (
    <>
      <button type="button" ref={btn} class={`sel dd ${open ? 'open' : ''} ${cls}`} style={style} onClick={toggle} onKeyDown={key} aria-haspopup="listbox" aria-expanded={open}>
        <span class="ellipsis">{cur ? cur.label : placeholder}</span>
      </button>
      {open && pos && (
        <div ref={list} class="dd-list panel glow" role="listbox" style={{ left: pos.left, top: pos.top, minWidth: pos.width, maxHeight: pos.maxHeight }}>
          {opts.map((o, i) => (
            <div role="option" aria-selected={String(o.value) === String(value)} class={`dd-opt ${i === hi ? 'hi' : ''} ${String(o.value) === String(value) ? 'cur' : ''}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              <span class="grow">{o.label}</span>{String(o.value) === String(value) && <Check size={14} />}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function Checkbox({ checked, onChange, title }) {
  return (
    <div class={`checkbox ${checked ? 'on' : ''}`} title={title} onClick={(e) => { e.stopPropagation(); onChange(!checked); }}>
      {checked && <Check size={14} strokeWidth={3} />}
    </div>
  );
}

export function Modal({ title, sub, children, onClose, actions, width }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div class="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div class="panel glow modal" style={width ? { width } : undefined}>
        <div class="row" style={{ alignItems: 'flex-start' }}>
          <div class="grow"><h2>{title}</h2>{sub && <div class="muted small">{sub}</div>}</div>
          {onClose && <button class="btn icon xs ghost" onClick={onClose}><X size={16} /></button>}
        </div>
        <div class="mt">{children}</div>
        {actions && <div class="actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div class="toasts">{toasts.map((t) => <div key={t.id} class={`toast ${t.kind}`}><FixText text={t.text} /></div>)}</div>;
}

export function Empty({ children }) { return <div class="empty">{children}</div>; }

export function SectionHead({ icon: Icon, title, count, open, onToggle, right }) {
  return (
    <div class="section-head" onClick={onToggle}>
      {Icon && <Icon size={20} />}
      <span class="hud-title">{title}</span>
      {right}
      {count !== undefined && <span class="cnt">{count}</span>}
      {onToggle && <ChevronRight size={16} style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: '.15s' }} />}
    </div>
  );
}

export function StatusDot({ state }) { return <span class={`status-dot dot-${state}`} />; }

export function SourceTag({ source, fetchedAt, offline }) {
  if (!source) return null;
  return <span class="source-tag">Quelle: {source}{fetchedAt ? ` · Stand ${new Date(fetchedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}{offline ? ' · offline (Cache)' : ''}</span>;
}

export function useInterval(fn, ms) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { if (!ms) return undefined; const t = setInterval(() => ref.current(), ms); return () => clearInterval(t); }, [ms]);
}

export function useNow(ms = 1000) {
  const [n, set] = useState(Date.now());
  useInterval(() => set(Date.now()), ms);
  return n;
}

export function Spinner({ size = 16 }) {
  return <svg class="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 12a9 9 0 1 1-6.2-8.56" stroke-linecap="round" /></svg>;
}

/* ---- Prompt / confirm replacements (window.prompt is not available in Electron) ---- */
import { setState as _set } from '../lib/store.js';
export function ask(title, value = '', { multiline = false, confirmOnly = false, danger = false, okLabel, password = false } = {}) {
  return new Promise((resolve) => _set({ ask: { title, value, multiline, confirmOnly, danger, okLabel, password, resolve } }));
}
export function AskHost() {
  const a = useStore((s) => s.ask);
  const [v, setV] = useState('');
  useEffect(() => { if (a) setV(a.value || ''); }, [a]);
  if (!a) return null;
  const done = (r) => { _set({ ask: null }); a.resolve(r); };
  return (
    <Modal title={a.title} onClose={() => done(null)} width="480px"
      actions={<><button class="btn sm ghost" onClick={() => done(null)}>Abbrechen</button><button class={`btn sm ${a.danger ? 'danger' : 'primary'}`} onClick={() => done(a.confirmOnly ? true : v)}>{a.okLabel || 'OK'}</button></>}>
      {!a.confirmOnly && (a.multiline
        ? <textarea class="ta" value={v} onInput={(e) => setV(e.currentTarget.value)} autofocus rows={5} />
        : <input class="inp" type={a.password ? 'password' : 'text'} autocomplete={a.password ? 'off' : undefined} value={v} onInput={(e) => setV(e.currentTarget.value)} autofocus onKeyDown={(e) => { if (e.key === 'Enter') done(v); }} />)}
    </Modal>
  );
}

/** Fehlertext mit Lösungs-Knopf: „… ⟨fix:Label|https://…⟩“ oder „⟨fix:Label|action:settings⟩“. Links im Text werden klickbar. */
export function FixText({ text, class: cls }) {
  const str = String(text ?? '');
  const m = str.match(/\s*⟨fix:([^|⟩]+)\|([^⟩]+)⟩/);
  const body = m ? str.replace(m[0], '') : str;
  const parts = body.split(/(https:\/\/[^\s)]+)/g);
  const go = (target) => (target.startsWith('action:') ? import('../lib/store.js').then(({ setState }) => setState({ page: target.slice(7) }))
    : target.startsWith('rpc:') ? Promise.all([import('../lib/api.js'), import('../lib/store.js')]).then(([{ rpc }, { guard }]) => guard(() => rpc(target.slice(4))))
      : import('../lib/api.js').then(({ rpc }) => rpc('shell.openExternal', { url: target })));
  return (
    <span class={cls}>
      {parts.map((p) => (/^https:\/\//.test(p) ? <a onClick={() => go(p)} title={p}>{p.replace(/^https:\/\//, '').slice(0, 48)}{p.length > 56 ? '…' : ''}</a> : p))}
      {m && <button class="btn xs fix-btn" onClick={(e) => { e.stopPropagation(); go(m[2].trim()); }}>{m[1].trim()}</button>}
    </span>
  );
}
