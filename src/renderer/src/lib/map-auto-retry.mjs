// Automatic map operations: bounded backoff; temporary errors do not permanently
// mark a map as handled. Kept separate from the UI for deterministic tests.
export function createMapAutoRetry({ maxAttempts = 4, initialDelayMs = 2000, maxDelayMs = 30000 } = {}) {
  const records = new Map();
  const due = (key, now = Date.now()) => {
    const entry = records.get(key);
    if (!entry) return 0;
    if (entry.running || entry.done || entry.attempts >= maxAttempts) return null;
    return Math.max(0, entry.nextAt - now);
  };
  const start = (key, now = Date.now()) => {
    if (due(key, now) !== 0) return false;
    const entry = records.get(key) || { attempts: 0, done: false, nextAt: 0, running: false };
    entry.attempts++;
    entry.running = true;
    records.set(key, entry);
    return true;
  };
  const finish = (key, succeeded, now = Date.now()) => {
    const entry = records.get(key);
    if (!entry || !entry.running) return null;
    entry.running = false;
    entry.done = succeeded === true;
    if (!entry.done) entry.nextAt = now + Math.min(maxDelayMs, initialDelayMs * (2 ** (entry.attempts - 1)));
    return due(key, now);
  };
  const status = (key) => {
    const e = records.get(key);
    return !e ? 'idle' : e.running ? 'running' : e.done ? 'ready' : e.attempts >= maxAttempts ? 'failed' : 'waiting';
  };
  return { due, start, finish, status, reset: (key) => records.delete(key) };
}
