'use strict';
const { nowIso } = require('../../core/util');
const log = require('../../core/logger').scope('deals');

/**
 * Preis-Wächter für deine Steam-Wunschliste: Wunschliste (öffentlich sichtbar nötig) über
 * IWishlistService/GetWishlist, Preise über die Store-API (price_overview, Euro). Meldet einen Rabatt
 * ab der eingestellten Mindesthöhe einmal pro Angebot. Ohne Schlüssel, nur lesend.
 */
const WISHLIST = (id64) => `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${id64}`;
const PRICES = (ids) => `https://store.steampowered.com/api/appdetails?appids=${ids.join(',')}&filters=price_overview&cc=de&l=german`;

class Deals {
  constructor(s) { this.s = s; }
  cfg() { return this.s.settings.get('gaming') || {}; }
  async json(url) {
    const r = await this.s.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return r.json();
  }

  async wishlist() {
    const acc = await this.s.gaming.steam.accountId();
    if (!acc) throw new Error('Kein Steam-Konto auf diesem PC gefunden.');
    let j;
    try { j = await this.json(WISHLIST(acc.id64)); } catch (e) { throw new Error(e.status === 403 || e.status === 401 ? 'Die Wunschliste ist nicht öffentlich (Steam → Profil → Privatsphäre → Spieldetails „Öffentlich“).' : 'Wunschliste nicht abrufbar (' + e.message + ').'); }
    return (j?.response?.items || []).map((x) => Number(x.appid)).filter(Boolean);
  }

  /** Preise in 50er-Blöcken (Store-API erlaubt mehrere IDs nur mit filters=price_overview). */
  async prices(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try {
        const j = await this.json(PRICES(chunk));
        for (const id of chunk) { const p = j?.[id]?.success ? j[id].data?.price_overview : null; if (p) out.set(id, { final: p.final / 100, initial: p.initial / 100, discount: p.discount_percent || 0, currency: p.currency || 'EUR' }); }
      } catch (e) { log.debug('prices', e); }
    }
    return out;
  }

  /** Abgleich: Rabatte speichern, neue Angebote ab Mindestrabatt melden. */
  async check({ notify = true } = {}) {
    if (this.cfg().wishlistAlerts === false) return { skipped: true };
    const ids = await this.wishlist();
    const prices = await this.prices(ids);
    const min = Number(this.cfg().wishlistMinDiscount ?? 30);
    const list = [];
    for (const id of ids) {
      const p = prices.get(id); if (!p) continue;
      const info = await this.s.gaming.steam.storeInfo(id).catch(() => null);
      list.push({ appid: id, name: info?.name || `App ${id}`, header: info?.header || null, ...p, url: `https://store.steampowered.com/app/${id}/` });
    }
    list.sort((a, b) => b.discount - a.discount);
    this.s.gaming.cache.set('steam:wishlist', { at: nowIso(), items: list }, 'Steam Store', 7 * 86400000);
    let notified = 0;
    if (notify) for (const d of list.filter((x) => x.discount >= min)) {
      const r = this.s.notifications.push({ category: 'gaming', origin: 'system', dedupeKey: `deal:${d.appid}:${d.discount}:${d.final}`, title: `Im Angebot: ${d.name} −${d.discount} %`, body: `${d.final.toFixed(2).replace('.', ',')} € statt ${d.initial.toFixed(2).replace('.', ',')} € (Steam-Wunschliste)` });
      if (r) notified++;
    }
    this.s.bus.emit('game:data', { game: 'deals' });
    return { items: list.length, onSale: list.filter((x) => x.discount > 0).length, notified };
  }
  state() { return this.s.gaming.cache.get('steam:wishlist', { allowStale: true })?.value || null; }
}

module.exports = { Deals };
