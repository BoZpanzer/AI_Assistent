import { useEffect, useState, useCallback, useRef } from 'preact/hooks';

const bridge = window.jarvis;

export const rpc = (method, params) => bridge.rpc(method, params);
export const on = (type, cb) => bridge.on(type, cb);

/** Subscribe to one or more bus events for the component lifetime. */
export function useEvent(types, cb, deps = []) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const list = Array.isArray(types) ? types : [types];
    const offs = list.map((t) => on(t, (d) => ref.current(d, t)));
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Data hook: loads via RPC and reloads when any of `events` fire.
 * Returns [data, reload, {loading, error}].
 */
export function useRpc(method, params, { events = [], deps = [], initial = null, debounce = 120, enabled = true } = {}) {
  const [data, setData] = useState(initial);
  const [state, setState] = useState({ loading: true, error: null });
  const seq = useRef(0);
  const timer = useRef(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    const n = ++seq.current;
    try {
      const r = await rpc(method, params);
      if (n === seq.current) { setData(r); setState({ loading: false, error: null }); }
    } catch (e) {
      if (n === seq.current) setState({ loading: false, error: cleanErr(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, JSON.stringify(params), enabled]);
  useEffect(() => { load(); }, [load, ...deps]);
  useEvent(events, () => { clearTimeout(timer.current); timer.current = setTimeout(load, debounce); }, [load]);
  return [data, load, state];
}

export function cleanErr(e) {
  return String(e?.message || e).replace(/^Error invoking remote method 'rpc': (Error: )?/, '');
}
