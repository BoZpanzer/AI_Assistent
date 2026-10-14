'use strict';
const { nowIso } = require('../core/util');
const log = require('../core/logger').scope('transit');

/**
 * „Wann muss ich los?“ – Abfahrten (Tram/Bus/S-Bahn/Zug inkl. LVB) und Verbindungen über die öffentliche
 * db-rest-API (transport.rest, Daten der Deutschen Bahn, ohne Schlüssel; Adresse in den Einstellungen änderbar).
 * Für den nächsten Termin mit Ort wird die Verbindung so geplant, dass du X Minuten vorher ankommst;
 * kurz vor der Abfahrt kommt eine Meldung mit Linie, Gleis und Verspätung.
 */
const ONLINE = /zoom|teams|meet\.google|webex|discord|online|https?:\/\//i;

class Transit {
  constructor(s) { this.s = s; this.plans = new Map(); }
  cfg() { return this.s.settings.get('transit') || {}; }
  base() { return String(this.cfg().api || 'https://v6.db.transport.rest').replace(/\/+$/, ''); }
  async get(path, query = {}) {
    const u = new URL(this.base() + path);
    for (const [k, v] of Object.entries(query)) if (v != null && v !== '') u.searchParams.set(k, String(v));
    const r = await this.s.fetch(u.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (r.status === 429) throw new Error('Fahrplan-API: zu viele Anfragen, gleich nochmal.');
    if (!r.ok) throw new Error('Fahrplan-API antwortet mit ' + r.status);
    return r.json();
  }

  async searchStops(q) {
    const list = await this.get('/locations', { query: q, results: 8, stops: 'true', addresses: 'false', poi: 'false' });
    return (list || []).filter((x) => x.type === 'stop' || x.type === 'station').map((x) => ({ id: x.id, name: x.name }));
  }
  setHome({ id, name }) { if (!id) throw new Error('Haltestelle fehlt'); this.s.settings.update({ transit: { homeId: String(id), homeName: String(name || '').slice(0, 120) } }); this.plans.clear(); return { id, name }; }

  /** Abfahrten ab Heimathaltestelle (oder id). */
  async departures({ stopId, minutes = 40 } = {}) {
    const sid = stopId || this.cfg().homeId; if (!sid) throw new Error('Keine Haltestelle eingestellt (Alltag → Unterwegs).');
    const j = await this.get(`/stops/${encodeURIComponent(sid)}/departures`, { duration: minutes, results: 14, remarks: 'false' });
    const list = Array.isArray(j) ? j : j.departures || [];
    return list.map((d) => ({ line: d.line?.name || '?', product: d.line?.product || null, direction: d.direction || '', when: d.when || d.plannedWhen, planned: d.plannedWhen, delayMin: d.delay != null ? Math.round(d.delay / 60) : null, platform: d.platform || d.plannedPlatform || null, cancelled: !!d.cancelled }))
      .sort((a, b) => String(a.when).localeCompare(String(b.when)));
  }

  /** Ziel aus freiem Text (Termin-Ort): Haltestelle oder Adresse. */
  async resolveTarget(text) {
    const list = await this.get('/locations', { query: text, results: 1, stops: 'true', addresses: 'true', poi: 'true' });
    const x = list?.[0]; if (!x) return null;
    if (x.type === 'stop' || x.type === 'station') return { to: x.id, name: x.name };
    const loc = x.location || x;
    if (loc.latitude == null) return null;
    return { 'to.address': x.address || x.name || text, 'to.latitude': loc.latitude, 'to.longitude': loc.longitude, name: x.address || x.name || text };
  }

  /** Verbindung, mit der du `buffer` Minuten vor `arriveBy` am Ziel bist. */
  async plan(location, arriveBy) {
    const home = this.cfg().homeId; if (!home) throw new Error('Keine Heimathaltestelle eingestellt.');
    const target = await this.resolveTarget(location); if (!target) throw new Error('Ort nicht gefunden: ' + location);
    const { name, ...to } = target;
    const arrival = new Date(new Date(arriveBy).getTime() - (Number(this.cfg().bufferMin ?? 5)) * 60000).toISOString();
    const j = await this.get('/journeys', { from: home, ...to, arrival, results: 3, stopovers: 'false', remarks: 'false' });
    const js = (j.journeys || []).filter((x) => x.legs?.length).map((x) => {
      const first = x.legs[0]; const last = x.legs[x.legs.length - 1];
      const rides = x.legs.filter((l) => !l.walking);
      return { leave: first.departure || first.plannedDeparture, arrive: last.arrival || last.plannedArrival, transfers: Math.max(0, rides.length - 1),
        legs: x.legs.map((l) => ({ walking: !!l.walking, line: l.line?.name || null, from: l.origin?.name || null, to: l.destination?.name || null, dep: l.departure || l.plannedDeparture, arr: l.arrival || l.plannedArrival, delayMin: l.departureDelay != null ? Math.round(l.departureDelay / 60) : null, platform: l.departurePlatform || l.plannedDeparturePlatform || null, direction: l.direction || null, cancelled: !!l.cancelled })) };
    }).filter((x) => x.arrive && Date.parse(x.arrive) <= Date.parse(arrival) + 60000 && !x.legs.some((l) => l.cancelled));
    js.sort((a, b) => Date.parse(b.leave) - Date.parse(a.leave)); // spätestmögliche passende Verbindung
    return { target: name, arriveBy, journeys: js };
  }

  /** Nächster Termin mit (Präsenz-)Ort in den nächsten Stunden. */
  nextEvent(now = new Date()) {
    const to = new Date(now.getTime() + Number(this.cfg().lookaheadHours || 4) * 3600000).toISOString();
    return this.s.db.all("SELECT id,title,location,start_at FROM events WHERE status!='cancelled' AND all_day=0 AND location!='' AND start_at>? AND start_at<=? ORDER BY start_at", now.toISOString(), to)
      .find((e) => !ONLINE.test(e.location)) || null;
  }

  /** Alle paar Minuten: Verbindung zum nächsten Termin planen und rechtzeitig „los“ melden. */
  async check() { return { skipped: 'private-calendar', message: 'Automatische Routen zu privaten Terminen bleiben deaktiviert.' }; }
  state() { const ev = this.nextEvent(); return { home: this.cfg().homeId ? { id: this.cfg().homeId, name: this.cfg().homeName } : null, event: ev, plan: ev ? this.plans.get(ev.id) || null : null }; }
}

module.exports = { Transit, ONLINE };

