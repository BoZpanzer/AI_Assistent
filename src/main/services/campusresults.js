'use strict';
const { sha256 } = require('../core/util');
const { sapValue } = require('./ics');
const log = require('../core/logger').scope('campusresults');

/**
 * Prüfungsergebnisse aus Campus Dual beobachten (neues Portal fep.campus-dual.de, angemeldete Sitzung).
 *
 * Campus Dual dokumentiert seine Dienste nicht. JARVIS geht deshalb so vor:
 *  1. Die Launchpad-Kachel „Ergebnisse“ (PIQ_COURSE_STUDY_DETAILS_SRV/ResultsParametersSet) lesen –
 *     ändert sich ihr Inhalt (z. B. die Zahl), ist vermutlich ein neues Ergebnis da.
 *  2. Im selben Dienst über $metadata nach Listen suchen, deren Name nach Ergebnissen/Noten klingt,
 *     und diese lesen. Neue Einträge → Benachrichtigung mit Modul und Note (falls erkennbar).
 * Nur lesend. Gefundene Quellen und Feldnamen (ohne Inhalte) werden gespeichert, um die Erkennung anzupassen.
 */
const SRV = '/sap/opu/odata/sap/PIQ_COURSE_STUDY_DETAILS_SRV';
const TILE = `${SRV}/ResultsParametersSet(TileType='Result')?sap-client=100`;
const LIST_RE = /result|grade|note|noten|leistung|pruef|prüf|exam|assessment|ergebnis/i;
const VOLATILE = /^(__metadata|__deferred)$|timestamp|changed|aenderung|lastchange|uuid|guid$/i;

const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => !VOLATILE.test(k) && (v === null || typeof v !== 'object')));

/** Entity-Sets aus dem OData-$metadata-XML (Name + Schlüsselfelder). */
function parseMetadata(xml) {
  const types = {};
  for (const m of String(xml).matchAll(/<EntityType\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g)) {
    const keys = [...m[2].matchAll(/<PropertyRef\s+Name="([^"]+)"/g)].map((x) => x[1]);
    types[m[1]] = { keys };
  }
  return [...String(xml).matchAll(/<EntitySet\s+Name="([^"]+)"\s+EntityType="([^"]+)"/g)].map((m) => ({ name: m[1], type: m[2].split('.').pop(), keys: types[m[2].split('.').pop()]?.keys || [] }));
}

/** Sinnvolle Felder (Modul, Note, Datum, Credits, Status) aus einem Ergebnis-Datensatz erkennen. */
function summarize(records) {
  const list = (records || []).map(clean);
  if (!list.length) return [];
  const keys = Object.keys(list[0]);
  const strKey = (re, not) => keys.find((k) => re.test(k) && !(not && not.test(k)) && list.some((r) => typeof r[k] === 'string' && r[k].trim() && !sapValue(r[k])));
  const titleK = strKey(/^(stext|title|titel|modul|module|short|kurz|name|bez|text|description|course|smtext|sm_?stext)/i, /id$|key$|nr$/i) || strKey(/text|titel|title|name|bez|modul|module|course/i, /id$|key$|nr$|grade|note|status/i);
  const gradeK = keys.find((k) => /grade|note|bewert|result|ergebnis|mark/i.test(k) && !/text|symbol|scale|type|id$|date|datum/i.test(k) && list.some((r) => r[k] !== '' && r[k] != null && !sapValue(String(r[k]))))
    || keys.find((k) => /grade|note|bewert|mark/i.test(k) && list.some((r) => r[k] !== '' && r[k] != null));
  const gradeTextK = keys.find((k) => k !== gradeK && /(grade|note|bewert).*(text|symbol)|(text|symbol).*(grade|note)/i.test(k));
  const dateK = keys.find((k) => list.some((r) => ['date', 'datetime'].includes(sapValue(String(r[k] ?? ''))?.kind)) && /date|datum|ergdat|bookdate|perf/i.test(k))
    || keys.find((k) => list.some((r) => ['date', 'datetime'].includes(sapValue(String(r[k] ?? ''))?.kind)));
  const creditsK = keys.find((k) => /ects|credit|cpunit|^cp|lp$|leistungspunkt/i.test(k) && !/unit$|einheit/i.test(k));
  const statusK = keys.find((k) => /status|state|passed|bestanden|agrst/i.test(k) && !/date|datum/i.test(k));
  const attemptK = keys.find((k) => /attempt|versuch|repeat/i.test(k));
  const fmtDate = (v) => { const p = sapValue(String(v ?? '')); return p && p.y ? `${String(p.d).padStart(2, '0')}.${String(p.mo).padStart(2, '0')}.${p.y}` : null; };
  return list.map((r) => ({
    key: sha256(JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]))).slice(0, 20),
    title: String((titleK && r[titleK]) || '').trim() || 'Ergebnis',
    grade: gradeK != null && r[gradeK] !== '' && r[gradeK] != null ? String(r[gradeK]).trim() : null,
    gradeText: gradeTextK && r[gradeTextK] ? String(r[gradeTextK]).trim() : null,
    date: dateK ? fmtDate(r[dateK]) : null,
    credits: creditsK && r[creditsK] !== '' && r[creditsK] != null ? String(r[creditsK]).trim() : null,
    status: statusK && r[statusK] !== '' && r[statusK] != null ? String(r[statusK]).trim() : null,
    attempt: attemptK && r[attemptK] ? String(r[attemptK]).trim() : null,
  }));
}

/** Kachelinhalt (Zahl, Info, Untertitel …) als vergleichbarer Text. */
function tileText(d) {
  const c = clean(d);
  const parts = ['number', 'numberUnit', 'info', 'subtitle', 'title', 'Number', 'Info', 'Subtitle'].filter((k) => c[k] != null && c[k] !== '').map((k) => String(c[k]).trim());
  return parts.length ? parts.join(' · ') : Object.values(c).filter((v) => v !== '' && v != null).map(String).join(' · ').slice(0, 200);
}

class CampusResults {
  constructor(s) { this.s = s; this.busy = null; }
  meta(k, def) { try { return JSON.parse(this.s.system.meta('campusdual:results:' + k) || 'null') ?? def; } catch { return def; } }
  setMeta(k, v) { this.s.system.setMeta('campusdual:results:' + k, JSON.stringify(v)); }

  enabled() { return this.s.settings.get('campusDualResults')?.enabled !== false; }
  /** Läuft nur, wenn Campus Dual eingerichtet ist (Sitzung oder gespeicherte Zugangsdaten) – öffnet nie ungefragt ein Fenster. */
  async available() {
    const cd = this.s.platform?.campusDual;
    if (!cd) return false;
    return cd.hasCreds?.() || (await cd.loggedIn());
  }

  status() {
    const st = this.meta('status', {});
    return { enabled: this.enabled(), lastCheck: st.lastCheck || null, lastError: st.lastError || null, tile: st.tile || null, count: (this.meta('list', []) || []).length, sources: this.meta('sources', []), results: this.meta('list', []) };
  }

  /** Jetzt prüfen. notify=false: nur Stand aktualisieren (erster Lauf legt die Basis ohne Meldung). */
  check({ notify = true } = {}) {
    if (!this.busy) this.busy = this._check({ notify }).finally(() => { this.busy = null; });
    return this.busy;
  }

  async _check({ notify }) {
    const feeds = this.s.feeds;
    const st = this.meta('status', {});
    const out = { tile: null, newResults: [], tileChanged: false, sources: [] };
    try {
      // 1) Kachel
      try {
        const j = await feeds.campusDualJson(TILE);
        out.tile = tileText(j?.d || j);
      } catch (e) { if (e.expired) throw e; log.info('Ergebnis-Kachel nicht lesbar: ' + e.message); }

      // 2) Listen im Dienst suchen (einmal pro Tag neu, sonst gemerkte Quellen)
      let sets = this.meta('sets', null);
      if (!sets || Date.now() - Date.parse(st.setsAt || 0) > 24 * 3600_000) {
        try {
          const xml = await feeds.campusDualGet(`${SRV}/$metadata?sap-client=100`, { json: false });
          sets = parseMetadata(xml).filter((x) => LIST_RE.test(x.name) && !/Parameter/i.test(x.name)).map((x) => x.name);
          this.setMeta('sets', sets); st.setsAt = new Date().toISOString();
        } catch (e) { if (e.expired) throw e; log.info('$metadata nicht lesbar: ' + e.message); sets = sets || []; }
      }
      const all = [];
      for (const name of sets.slice(0, 8)) {
        try {
          const j = await feeds.campusDualJson(`${SRV}/${name}?sap-client=100&$top=1000`);
          const recs = j?.d?.results || (Array.isArray(j?.d) ? j.d : []) || [];
          out.sources.push({ set: name, count: recs.length, fields: recs[0] ? Object.keys(clean(recs[0])) : [] });
          if (recs.length) all.push(...summarize(recs).map((r) => ({ ...r, source: name })));
        } catch (e) {
          if (e.expired) throw e;
          out.sources.push({ set: name, count: 0, error: e.message.slice(0, 120) });
        }
      }
      this.setMeta('sources', out.sources);

      // 3) Vergleichen
      const known = new Set(this.meta('known', null) || []);
      const firstRun = !this.meta('known', null);
      out.newResults = firstRun ? [] : all.filter((r) => !known.has(r.key));
      out.tileChanged = !firstRun && !!out.tile && !!st.tile && out.tile !== st.tile;
      this.setMeta('known', [...new Set([...known, ...all.map((r) => r.key)])].slice(-2000));
      if (all.length || !this.meta('list', []).length) this.setMeta('list', all.slice(0, 300));

      if (notify && out.newResults.length) {
        const lines = out.newResults.slice(0, 5).map((r) => `${r.title}${r.grade ? ': ' + r.grade : r.gradeText ? ': ' + r.gradeText : ''}`);
        this.s.notifications.push({ category: 'calendar', origin: 'system', dedupeKey: 'cd-results:' + out.newResults.map((r) => r.key).join(',').slice(0, 200), title: out.newResults.length === 1 ? 'Neues Prüfungsergebnis in Campus Dual' : `${out.newResults.length} neue Prüfungsergebnisse in Campus Dual`, body: lines.join(' · ') });
      } else if (notify && out.tileChanged) {
        this.s.notifications.push({ category: 'calendar', origin: 'system', dedupeKey: 'cd-tile:' + sha256(out.tile).slice(0, 12), title: 'Campus Dual: Ergebnisse haben sich geändert', body: `Die Kachel „Ergebnisse“ zeigt jetzt: ${out.tile} (vorher: ${st.tile}). Schau in Campus Dual nach – vermutlich ist ein neues Ergebnis da.` });
      }
      this.setMeta('status', { ...st, lastCheck: new Date().toISOString(), lastError: null, tile: out.tile || st.tile || null });
      this.s.bus?.emit?.('campusdual:results', this.status());
      return { ...out, firstRun, count: all.length };
    } catch (e) {
      this.setMeta('status', { ...st, lastCheck: new Date().toISOString(), lastError: e.message });
      throw e;
    }
  }
}

module.exports = { CampusResults, parseMetadata, summarize, tileText };
