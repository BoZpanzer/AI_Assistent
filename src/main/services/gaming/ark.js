'use strict';
const { id, nowIso } = require('../../core/util');
const { parseDuration } = require('./rok');

/**
 * ARK-Zucht-Tracker: Babys mit Reife-Zeitpunkt und Prägung („will kuscheln“) als Erinnerungen aufs Handy.
 * Keine eingebauten Artenwerte (die hängen von Art und Server-Raten ab) – Restzeiten kommen von dir oder
 * per Screenshot aus dem Spiel. Prägungs-Intervall: Einstellung (ARK-Standard offizielle Server: 8 h).
 */
class Ark {
  constructor(s) { this.s = s; }
  key(game) { return 'ark:babies:' + game; }
  cfgInterval() { return Number(this.s.settings.get('gaming')?.arkCuddleHours || 8) * 60; }
  list(game) { try { return JSON.parse(this.s.gaming.context.getState(this.key(game)) || '[]'); } catch { return []; } }
  save(game, list) { this.s.gaming.context.setState(this.key(game), list); this.s.bus.emit('game:data', { game }); }

  /**
   * Baby anlegen: matureIn (Restzeit bis ausgewachsen, z. B. "1d 4h"), cuddleIn (bis zur nächsten Prägung,
   * Standard = Intervall), interval (Minuten oder Dauer, Standard Einstellung).
   */
  add(game, { name, species = '', matureIn, cuddleIn, interval } = {}) {
    if (!['ark', 'ark_asa'].includes(game)) throw new Error('Nur für ARK');
    if (!name) throw new Error('Name fehlt');
    const now = Date.now();
    const mature = matureIn ? now + parseDuration(matureIn) * 60000 : null;
    const iv = interval ? Math.round(parseDuration(interval)) : this.cfgInterval();
    if (iv < 5) throw new Error('Intervall zu kurz');
    const first = now + (cuddleIn ? parseDuration(cuddleIn) : iv) * 60000;
    const b = { id: id('bb'), name: String(name).slice(0, 60), species: String(species).slice(0, 60), matureAt: mature ? new Date(mature).toISOString() : null, interval: iv, imprints: 0, series: id('ts'), createdAt: nowIso() };
    this.schedule(game, b, first);
    this.save(game, [...this.list(game).filter((x) => x.name !== b.name), b]);
    return b;
  }
  schedule(game, b, firstMs) {
    const G = this.s.gaming; const gname = G.context.profile(game)?.name || game;
    G.removeSeries(b.series);
    const label = `${b.name}${b.species ? ' (' + b.species + ')' : ''}`;
    if (!b.matureAt || firstMs < Date.parse(b.matureAt)) G.addTimer({ game: gname, label: `Prägen: ${label}`, kind: 'breeding', endsAt: new Date(firstMs).toISOString(), repeatMinutes: b.interval, ...(b.matureAt ? { until: b.matureAt } : {}), series: b.series, note: 'ARK-Prägung (Intervall ' + Math.round(b.interval / 6) / 10 + ' h)' });
    if (b.matureAt && Date.parse(b.matureAt) > Date.now()) G.addTimer({ game: gname, label: `Ausgewachsen: ${label}`, kind: 'breeding', endsAt: b.matureAt, series: b.series });
  }
  /** „Geprägt“ → nächste Prägung ab jetzt + Intervall. */
  imprinted(game, babyId) {
    const list = this.list(game); const b = list.find((x) => x.id === babyId || x.name === babyId);
    if (!b) throw new Error('Baby nicht gefunden');
    b.imprints++;
    this.schedule(game, b, Date.now() + b.interval * 60000);
    this.save(game, list);
    return b;
  }
  remove(game, babyId) {
    const list = this.list(game); const b = list.find((x) => x.id === babyId || x.name === babyId);
    if (b) this.s.gaming.removeSeries(b.series);
    this.save(game, list.filter((x) => x !== b));
    return !!b;
  }
  state(game) {
    const timers = this.s.gaming.timers({ game });
    return this.list(game).map((b) => {
      const next = timers.filter((t) => t.series === b.series && !t.fired && t.label.startsWith('Prägen')).sort((x, y) => x.endsAt.localeCompare(y.endsAt))[0];
      return { ...b, nextCuddle: next?.endsAt || null, grown: !!b.matureAt && Date.parse(b.matureAt) <= Date.now() };
    });
  }
}

module.exports = { Ark };
