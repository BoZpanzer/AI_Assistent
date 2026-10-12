'use strict';
const { assertPublicUrl, htmlToText } = require('../web');

/**
 * MediaWiki reader for games with a public wiki API (wiki.gg, Fandom,
 * minecraft.wiki …). Content is cached and always shown with its source.
 */
class Wiki {
  constructor(ctx) { this.fetch = ctx.fetch; this.cache = ctx.gameCache; }

  async json(url) {
    await assertPublicUrl(url);
    const r = await this.fetch(url, { headers: { 'User-Agent': 'JARVIS-Desktop/3 (personal assistant)', Accept: 'application/json' } });
    if (!r.ok) throw new Error('Wiki antwortet mit ' + r.status);
    return r.json();
  }

  async search(wiki, q, limit = 6) {
    const u = new URL(wiki.api);
    u.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srlimit: String(limit), format: 'json', formatversion: '2' }).toString();
    const r = await this.cache.wrap('wiki:s:' + u, wiki.label, 3 * 86400000, async () => {
      const j = await this.json(u.toString());
      return (j.query?.search || []).map((s) => ({ title: s.title, snippet: htmlToText(s.snippet || '').text, url: articleUrl(wiki.api, s.title) }));
    });
    return { results: r.value, source: wiki.label, fetchedAt: r.fetchedAt, offline: r.offline };
  }

  async page(wiki, title, maxChars = 6000) {
    const u = new URL(wiki.api);
    u.search = new URLSearchParams({ action: 'parse', page: title, prop: 'text|revid', redirects: '1', format: 'json', formatversion: '2', disableeditsection: '1' }).toString();
    const r = await this.cache.wrap('wiki:p:' + u, wiki.label, 7 * 86400000, async () => {
      const j = await this.json(u.toString());
      if (!j.parse) throw new Error('Seite nicht gefunden');
      const { text } = htmlToText(j.parse.text || '');
      return { title: j.parse.title, revision: j.parse.revid, text: text.slice(0, 40000), url: articleUrl(wiki.api, j.parse.title) };
    });
    return { ...r.value, text: r.value.text.slice(0, maxChars), source: wiki.label, fetchedAt: r.fetchedAt, offline: r.offline };
  }
}

function articleUrl(api, title) {
  const base = api.replace(/api\.php$/, '');
  const path = base.includes('wiki.leagueoflegends.com') ? base : (base.endsWith('/') ? base : base + '/') + (base.includes('fandom.com') || base.includes('wiki.gg') || base.includes('minecraft.wiki') || base.includes('factorio') ? 'wiki/' : '');
  return path + encodeURIComponent(title.replace(/ /g, '_'));
}

module.exports = { Wiki };
