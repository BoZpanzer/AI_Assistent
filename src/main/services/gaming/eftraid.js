'use strict';
const { safeJson } = require('../../core/util');
const log = require('../../core/logger').scope('eftraid');

/**
 * Raid-Begleiter für Escape from Tarkov (wie TarkovMonitor) – nur aus den Log-Dateien des Spiels:
 *  - Match gesucht / gefunden (Karte), Countdown, Raid gestartet, Raid vorbei
 *  - Raid-Zeit, Runthrough-Grenze (Standard 7:10 – darunter gibt es „Run Through“ statt „Survived“)
 *  - Scav-Abklingzeit nach einem Scav-Raid (Schätzung: Basiszeit, verkürzt durch gebaute Hideout-Boni)
 *  - Raids pro Karte, Flohmarkt-Verkäufe (Anzahl, Rubel)
 * Log-Zeilen wie von TarkovMonitor ausgewertet (application-/notifications-Log). Nur Anzeige, keine Eingaben.
 */
const LINE_START = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?/;
const LOCATION = { bigmap: 'customs', factory4_day: 'factory', factory4_night: 'factory', interchange: 'interchange', laboratory: 'the-lab', lighthouse: 'lighthouse', rezervbase: 'reserve', shoreline: 'shoreline', tarkovstreets: 'streets-of-tarkov', woods: 'woods', sandbox: 'ground-zero', sandbox_high: 'ground-zero', labyrinth: 'the-labyrinth', terminal: 'terminal' };
const CURRENCY = { '5449016a4bdc2d6f028b456f': 'RUB', '5696686a4bdc2da3298b456a': 'USD', '569668774bdc2da2298b4568': 'EUR' };
const FLEA_SOLD = '5bdabfb886f7743e152e867e 0';

/** Logtext → Einträge { at (Date), message (Text nach dem 4. „|“ bzw. ganze Zeile), json (Objekt|null) }. */
function parseEntries(text) {
  const out = []; let cur = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.rest.join('\n'); const a = body.indexOf('{'); const b = body.lastIndexOf('}');
    let json = null; if (a >= 0 && b > a) { try { json = JSON.parse(body.slice(a, b + 1)); } catch { json = null; } }
    out.push({ at: cur.at, line: cur.line, json });
  };
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(LINE_START);
    if (m) { flush(); cur = { at: new Date(`${m[1]}T${m[2]}`), line, rest: [] }; } else if (cur) cur.rest.push(line);
  }
  flush();
  return out;
}

class EftRaid {
  constructor(s) {
    this.s = s;
    this.st = { phase: 'idle', map: null, mapId: null, online: null, raidId: null, startingAt: null, startedAt: null, endedAt: null, type: null, runthroughNotified: false, ...safeJson(s.gaming.context.getState('eft:raid'), {}) };
    this.accountId = (s.gaming.context.getState('eft:account') || null);
    this.scavTimer = null;
    this.armScav();
  }
  cfg() { return this.s.settings.get('gaming') || {}; }
  alerts() { return { matchFound: true, raidStart: true, runthrough: true, scavReady: true, speak: false, ...(this.cfg().eftAlerts || {}) }; }
  save() { this.s.gaming.context.setState('eft:raid', this.st); this.s.bus.emit('eft:raid', this.state()); }
  stats() { return safeJson(this.s.gaming.context.getState('eft:raidstats'), { plays: {}, flea: { count: 0, rub: 0, usd: 0, eur: 0 } }) || { plays: {}, flea: { count: 0, rub: 0 } }; }
  saveStats(x) { this.s.gaming.context.setState('eft:raidstats', x); }

  state(now = Date.now()) {
    const st = this.st;
    const runthrough = (this.cfg().eftRunthroughSec ?? 430);
    const inRaid = st.phase === 'inraid' && st.startedAt;
    const elapsed = inRaid ? Math.max(0, Math.round((now - Date.parse(st.startedAt)) / 1000)) : null;
    return { ...st, elapsed, runthroughLeft: inRaid ? Math.max(0, runthrough - elapsed) : null, scavReadyAt: (this.s.gaming.context.getState('eft:scavready') || null), stats: this.stats(), accountKnown: !!this.accountId };
  }

  /** Neue Log-Einträge verarbeiten. initial=true: beim ersten Lesen (Spiel lief schon) nur Zustand übernehmen, nicht melden. */
  onEntries(entries, { initial = false } = {}) {
    for (const e of entries) this.onEntry(e, initial);
  }

  notify(kind, title, body) {
    if (!this.alerts()[kind]) return;
    this.s.notifications.push({ category: 'gaming', origin: 'client', game: 'eft', dedupeKey: `eftraid:${kind}:${this.st.raidId || ''}:${Date.now() - (Date.now() % 60000)}`, title, body });
    if (this.alerts().speak) this.s.bus.emit('tts:speak', { text: title });
  }

  onEntry(e, initial) {
    const L = e.line; const st = this.st;
    const acc = L.match(/(?:Select(?:ed)?Profile|PrepareSelectedProfileLocally) ProfileId:\w+ AccountId:(\d+)/);
    if (acc && acc[1] !== this.accountId) { this.accountId = acc[1]; this.s.gaming.context.setState('eft:account', acc[1]); }
    if (/application\|LocationLoaded/.test(L)) { Object.assign(st, { phase: 'searching', raidId: null, startingAt: null, startedAt: null, endedAt: null, type: null, runthroughNotified: false }); this.save(); return; }
    if (/application\|TRACE-NetworkGameCreate profileStatus/.test(L)) {
      const id = (L.match(/Location: ([^,]+)/) || [])[1] || null;
      const raidId = (L.match(/shortId: ([A-Z0-9]{6})/) || [])[1] || null;
      const reconnect = !!raidId && raidId === st.raidId;
      Object.assign(st, { mapId: id, map: id ? LOCATION[id.toLowerCase()] || null : null, online: /RaidMode: Online/.test(L), raidId, phase: reconnect ? st.phase : 'found' });
      if (st.map) this.s.gaming.setLastMap('eft', st.map);
      this.save();
      if (!initial && !reconnect) this.notify('matchFound', `Match gefunden${st.map ? ': ' + this.mapName(st.map) : ''}`, 'Raid lädt – gleich geht\'s los.');
      return;
    }
    if (/application\|GameStarting/.test(L)) { st.startingAt = st.startingAt || e.at.toISOString(); st.phase = 'starting'; this.save(); if (!initial) this.notify('raidStart', 'Raid startet', `Countdown läuft${st.map ? ' auf ' + this.mapName(st.map) : ''}.`); return; }
    if (/application\|GameStarted/.test(L)) {
      st.startedAt = st.startedAt || e.at.toISOString();
      // PMC: zwischen GameStarting und GameStarted liegt der Countdown; Scav: direkt
      st.type = st.startingAt && (Date.parse(st.startedAt) - Date.parse(st.startingAt)) / 1000 > 3 ? 'pmc' : 'scav';
      st.phase = 'inraid'; st.runthroughNotified = false;
      if (!initial && st.map) { const x = this.stats(); x.plays[st.map] = (x.plays[st.map] || 0) + 1; this.saveStats(x); }
      this.save();
      return;
    }
    if (/application\|Network game matching (aborted|cancelled)/.test(L)) { Object.assign(st, { phase: 'idle' }); this.save(); return; }
    if (/Got notification \| UserMatchOver/.test(L)) {
      st.endedAt = e.at.toISOString(); st.phase = 'ended';
      if (st.type === 'scav') this.startScavCooldown(e.at, initial);
      this.save();
      return;
    }
    if (/Got notification \| ChatMessageReceived/.test(L) && e.json?.message?.type === 4 && e.json.message.templateId === FLEA_SOLD) {
      const key = `${e.json.message._id || e.json.eventId || e.at.toISOString()}`;
      const x = this.stats(); x.fleaSeen = x.fleaSeen || [];
      if (x.fleaSeen.includes(key)) return;
      x.fleaSeen = [...x.fleaSeen, key].slice(-300);
      let amount = 0; let cur = 'RUB';
      for (const it of e.json.message.items?.data || []) if (CURRENCY[it._tpl]) { cur = CURRENCY[it._tpl]; amount += Number(it.upd?.StackObjectsCount || 0); }
      x.flea = x.flea || { count: 0, rub: 0, usd: 0, eur: 0 };
      x.flea.count++; x.flea[cur.toLowerCase()] = (x.flea[cur.toLowerCase()] || 0) + amount;
      this.saveStats(x);
      if (!initial && this.alerts().fleaSold !== false) {
        const sd = e.json.message.systemData || {};
        const push = (name) => this.s.notifications.push({ category: 'gaming', origin: 'client', game: 'eft', dedupeKey: 'flea:' + key, title: 'Flohmarkt: verkauft', body: `${sd.itemCount || 1}× ${name} an ${sd.buyerNickname || 'jemanden'} für ${amount.toLocaleString('de-DE')} ${cur === 'RUB' ? '₽' : cur === 'USD' ? '$' : '€'}` });
        Promise.resolve(this.s.gaming.tarkov.itemNameById?.(sd.soldItem)).then((n) => push(n || 'Item')).catch(() => push('Item'));
      }
    }
  }

  mapName(id) { return ({ customs: 'Zollgebiet', factory: 'Fabrik', interchange: 'Interchange', 'the-lab': 'Labor', lighthouse: 'Leuchtturm', reserve: 'Reserve', shoreline: 'Küste', 'streets-of-tarkov': 'Streets', woods: 'Wald', 'ground-zero': 'Ground Zero', 'the-labyrinth': 'Labyrinth', terminal: 'Terminal' })[id] || id; }

  /** Scav-Abklingzeit (Sekunden): Basis aus den Einstellungen, verkürzt um gebaute Hideout-Boni („ScavCooldownTimer“). */
  async scavCooldownSec() {
    const base = Number(this.cfg().eftScavCooldownMin ?? 25) * 60;
    let bonus = 0;
    try {
      const built = this.s.gaming.eftHideoutBuilt();
      const hs = await this.s.gaming.tarkov.hideoutStations(this.s.gaming.tracker?.tdMode?.());
      for (const st of hs.value || []) for (const l of st.levels || []) if (built.has(l.id)) for (const b of l.bonuses || []) if (b.type === 'ScavCooldownTimer') bonus += Math.abs(Number(b.value) || 0);
    } catch { /* ohne Hideout-Daten: Basiszeit */ }
    if (bonus > 1) bonus /= 100; // Prozentangaben
    return Math.round(base * (1 - Math.min(0.9, bonus)));
  }
  async startScavCooldown(at, initial) {
    const sec = await this.scavCooldownSec();
    const ready = new Date(at.getTime() + sec * 1000).toISOString();
    this.s.gaming.context.setState('eft:scavready', ready);
    this.s.bus.emit('eft:raid', this.state());
    if (!initial) this.armScav();
  }
  armScav() {
    clearTimeout(this.scavTimer);
    const ready = (this.s.gaming.context.getState('eft:scavready') || null);
    const ms = ready ? Date.parse(ready) - Date.now() : -1;
    if (ms > 0 && ms < 3 * 3600_000) { this.scavTimer = setTimeout(() => this.notify('scavReady', 'Scav ist wieder bereit', 'Die Scav-Abklingzeit ist vorbei (Schätzung).'), ms); this.scavTimer.unref?.(); }
  }

  /** Alle paar Sekunden: Runthrough-Grenze melden. */
  tick(now = Date.now()) {
    const s = this.state(now);
    if (s.phase === 'inraid' && s.runthroughLeft === 0 && !this.st.runthroughNotified) {
      this.st.runthroughNotified = true; this.save();
      this.notify('runthrough', 'Runthrough-Zeit vorbei', 'Ab jetzt zählt ein Extract als „Überlebt“ statt „Run Through“.');
    }
    return s;
  }
  stop() { clearTimeout(this.scavTimer); }
}

module.exports = { EftRaid, parseEntries, LOCATION };
