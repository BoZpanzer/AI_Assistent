import { useEffect, useRef, useState } from 'preact/hooks';
import { rpc, on, cleanErr } from './api.js';

/**
 * Tiny global store (no framework dependency). Components subscribe with
 * useStore(selector).
 */
const state = {
  ready: false,
  page: 'dashboard',
  settings: null,
  secrets: {},
  version: '',
  game: { active: null, discussed: null, running: [], gaming: false },
  counts: { open: 0, today: 0, overdue: 0, important: 0 },
  unread: 0,
  orb: 'idle',
  voice: 'off',
  micLevel: 0,
  outLevel: 0,
  google: { connected: false },
  windowVisible: true,
  toasts: [],
  conversationId: null,
  confirmations: {},
  showSetup: false,
  chatDraft: null,
};
const subs = new Set();

export function getState() { return state; }
export function setState(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  for (const s of subs) s();
}
export function useStore(selector) {
  const [, force] = useState(0);
  const value = selector(state);
  const rendered = useRef(value);
  rendered.current = value;
  useEffect(() => {
    let prev = rendered.current;
    const fn = () => { const next = selector(state); if (next !== prev) { prev = next; force((n) => n + 1); } };
    subs.add(fn);
    fn(); // catch updates that happened between render and subscription
    return () => subs.delete(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

export function navigate(page) { setState({ page, miniChatOpen: false }); }

let toastId = 0;
export function toast(text, kind = 'info', ms = 4000) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}
export async function guard(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(cleanErr(e), 'error', 6000); return undefined; }
}

export async function bootstrap() {
  const b = await rpc('app.bootstrap');
  const conv = await rpc('conv.current');
  const confirmations = Object.fromEntries((b.confirmations || []).map((c) => [c.token, { ...c, status: 'pending' }]));
  setState({
    ready: true, settings: b.settings, secrets: b.secrets, version: b.version, game: b.game, counts: b.counts, unread: b.unread,
    voice: b.voice, google: b.google, update: b.update || null, conversationId: conv.id, page: b.settings.startPage || 'dashboard', showSetup: !b.settings.setupComplete, confirmations,
  });
  on('settings:changed', async () => setState({ settings: await rpc('settings.get') }));
  on('game:context', (g) => setState({ game: g }));
  on('tasks:changed', async () => setState({ counts: await rpc('tasks.counts') }));
  on('notification', () => setState((s) => ({ unread: s.unread + 1 })));
  on('notifications:changed', async () => setState({ unread: (await rpc('notify.list', { unreadOnly: true, limit: 200 })).length }));
  on('orb:state', ({ state: o }) => setState({ orb: o }));
  on('voice:state', ({ state: v, error }) => { setState({ voice: v }); if (error) toast(error, 'error', 6000); });
  on('ui:navigate', ({ page }) => setState({ page }));
  on('calendar:sync', async () => setState({ google: await rpc('calendar.status') }));
  on('window', (w) => { if (w.visible !== undefined) setState({ windowVisible: w.visible }); });
  on('confirm:new', (c) => setState((s) => ({ confirmations: { ...s.confirmations, [c.token]: { ...c, status: 'pending' } } })));
  on('confirm:resolved', ({ token, approved, error }) => setState((s) => ({ confirmations: { ...s.confirmations, [token]: { ...(s.confirmations[token] || {}), status: error ? 'error' : approved ? 'done' : 'declined', error } } })));
  on('confirm:expired', ({ token }) => setState((s) => ({ confirmations: { ...s.confirmations, [token]: { ...(s.confirmations[token] || {}), status: 'expired' } } })));
  on('update:state', (u) => setState({ update: u }));
  on('data:imported', (c) => toast(`Import abgeschlossen: ${c.tasks} Aufgaben, ${c.memories} Erinnerungen, ${c.messages} Nachrichten`));
}
