'use strict';
const dgram = require('node:dgram');
const net = require('node:net');

/**
 * Serverstatus deiner Lieblingsserver – nur lesende Standard-Abfragen, wie sie auch der Server-Browser macht:
 * - Steam/Source (A2S_INFO über UDP): Rust, ARK, CS2, Arma, Palworld-Community-Server …
 * - Minecraft (Server List Ping über TCP): Name/MOTD, Spieler, Version.
 * Adresse „host:port“ (Steam: Query-Port, oft Spielport + 1; Minecraft Standard 25565).
 */

function parseAddress(addr, def) {
  const m = String(addr || '').trim().match(/^\[?([^\]\s]+?)\]?(?::(\d{1,5}))?$/);
  if (!m) throw new Error('Adresse ungültig (host:port)');
  const port = m[2] ? Number(m[2]) : def;
  if (!port || port > 65535) throw new Error('Port fehlt');
  return { host: m[1], port };
}

// ---------- A2S_INFO ----------
const A2S_HEAD = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]);
const A2S_PAYLOAD = Buffer.from('Source Engine Query\0', 'latin1');

function readCString(buf, o) { const end = buf.indexOf(0, o); const e = end < 0 ? buf.length : end; return [buf.toString('utf8', o, e), e + 1]; }

/** Antwort (0x49) → { name, map, folder, game, players, maxPlayers, bots, vac, version }. */
function parseA2SInfo(buf) {
  if (buf.readInt32LE(0) !== -1 || buf[4] !== 0x49) throw new Error('Keine A2S-Antwort');
  let o = 6; let name; let map; let folder; let game;
  [name, o] = readCString(buf, o); [map, o] = readCString(buf, o); [folder, o] = readCString(buf, o); [game, o] = readCString(buf, o);
  const appId = buf.readUInt16LE(o); o += 2;
  const players = buf[o++]; const maxPlayers = buf[o++]; const bots = buf[o++];
  o += 3; // server type, environment, visibility
  const vac = buf[o++] === 1;
  let version = null; try { [version] = readCString(buf, o); } catch { /* optional */ }
  return { name, map, folder, game, appId, players, maxPlayers, bots, vac, version };
}

function a2sInfo(host, port, { timeoutMs = 2500, socketFactory = () => dgram.createSocket('udp4') } = {}) {
  return new Promise((resolve, reject) => {
    const sock = socketFactory(); const t0 = Date.now(); let done = false;
    const finish = (err, v) => { if (done) return; done = true; clearTimeout(timer); try { sock.close(); } catch { /* ignore */ } if (err) reject(err); else resolve(v); };
    const timer = setTimeout(() => finish(new Error('keine Antwort')), timeoutMs);
    sock.on('error', (e) => finish(e));
    sock.on('message', (msg) => {
      try {
        if (msg.readInt32LE(0) === -1 && msg[4] === 0x41) { // Challenge (seit 2020): Anfrage mit Challenge wiederholen
          sock.send(Buffer.concat([A2S_HEAD, A2S_PAYLOAD, msg.subarray(5, 9)]), port, host);
          return;
        }
        finish(null, { ...parseA2SInfo(msg), ping: Date.now() - t0 });
      } catch (e) { finish(e); }
    });
    sock.send(Buffer.concat([A2S_HEAD, A2S_PAYLOAD]), port, host, (e) => e && finish(e));
  });
}

// ---------- Minecraft Server List Ping ----------
function varint(n) { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); }
function readVarint(buf, o) { let n = 0; let shift = 0; let b; do { if (o >= buf.length) return null; b = buf[o++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && shift < 35); return [n, o]; }
function mcPacket(id, data) { const body = Buffer.concat([varint(id), data]); return Buffer.concat([varint(body.length), body]); }

function mcStatus(host, port, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port }); const t0 = Date.now(); let buf = Buffer.alloc(0); let done = false;
    const finish = (err, v) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); if (err) reject(err); else resolve(v); };
    const timer = setTimeout(() => finish(new Error('keine Antwort')), timeoutMs);
    sock.on('error', finish);
    sock.on('connect', () => {
      const h = Buffer.from(host, 'utf8');
      const hs = Buffer.concat([varint(767), varint(h.length), h, Buffer.from([port >> 8, port & 0xff]), varint(1)]);
      sock.write(mcPacket(0x00, hs)); sock.write(mcPacket(0x00, Buffer.alloc(0)));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const len = readVarint(buf, 0); if (!len || buf.length < len[1] + len[0]) return;
      try {
        let o = len[1]; const pid = readVarint(buf, o); o = pid[1];
        const sl = readVarint(buf, o); o = sl[1];
        const j = JSON.parse(buf.toString('utf8', o, o + sl[0]));
        const motd = typeof j.description === 'string' ? j.description : [j.description?.text, ...(j.description?.extra || []).map((x) => x.text || '')].filter(Boolean).join('');
        finish(null, { name: String(motd || '').replace(/§./g, '').trim() || host, players: j.players?.online ?? null, maxPlayers: j.players?.max ?? null, version: j.version?.name || null, ping: Date.now() - t0 });
      } catch (e) { finish(e); }
    });
  });
}

/** Einen gespeicherten Server abfragen → Status (nie werfen: offline = Ergebnis). */
async function query(srv, deps = {}) {
  const kind = srv.kind || (/minecraft/i.test(srv.game || '') ? 'minecraft' : 'steam');
  try {
    const { host, port } = parseAddress(srv.address, kind === 'minecraft' ? 25565 : 27015);
    const r = kind === 'minecraft' ? await (deps.mc || mcStatus)(host, port) : await (deps.a2s || a2sInfo)(host, port);
    return { ...srv, kind, online: true, ...r, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { ...srv, kind, online: false, error: e.message, checkedAt: new Date().toISOString() };
  }
}

module.exports = { query, a2sInfo, mcStatus, parseA2SInfo, parseAddress, varint, readVarint };
