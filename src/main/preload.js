'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Minimal, explicit bridge. The renderer never gets Node, fs or secrets —
 * only an RPC function, an event subscription and an audio channel.
 */
const listeners = new Map();
ipcRenderer.on('evt', (_e, { type, data }) => {
  for (const cb of listeners.get(type) || []) { try { cb(data); } catch (err) { console.error(err); } }
  for (const cb of listeners.get('*') || []) { try { cb(type, data); } catch (err) { console.error(err); } }
});

contextBridge.exposeInMainWorld('jarvis', {
  rpc: (method, params) => ipcRenderer.invoke('rpc', { method: String(method), params }),
  on: (type, cb) => {
    const set = listeners.get(type) || new Set();
    set.add(cb); listeners.set(type, set);
    return () => set.delete(cb);
  },
  /** Absolute path of a dropped/selected File (Electron ≥ 32). */
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
