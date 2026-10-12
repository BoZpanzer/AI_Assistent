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

export function Select({ value, onChange, options, style }) {
  return (
    <select class="sel" value={value} onChange={(e) => onChange(e.currentTarget.value)} style={style}>
      {options.map((o) => (typeof o === 'string' ? <option value={o}>{o}</option> : <option value={o.value}>{o.label}</option>))}
    </select>
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
  return <div class="toasts">{toasts.map((t) => <div key={t.id} class={`toast ${t.kind}`}>{t.text}</div>)}</div>;
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
export function ask(title, value = '', { multiline = false, confirmOnly = false, danger = false, okLabel } = {}) {
  return new Promise((resolve) => _set({ ask: { title, value, multiline, confirmOnly, danger, okLabel, resolve } }));
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
        : <input class="inp" value={v} onInput={(e) => setV(e.currentTarget.value)} autofocus onKeyDown={(e) => { if (e.key === 'Enter') done(v); }} />)}
    </Modal>
  );
}
