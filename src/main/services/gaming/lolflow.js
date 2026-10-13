'use strict';
const { id, nowIso, safeJson } = require('../../core/util');
const log = require('../../core/logger').scope('lolflow');

/**
 * Begleitet den League-Client (nur lesend, lokale Client-Schnittstelle):
 * - Championauswahl: eigene Wahl + gegnerische Champions → Matchup-Tipps.
 *   Bewusst KEINE Spielernamen/Statistiken anderer Spieler (Riot-Richtlinie:
 *   keine De-Anonymisierung in der Lobby), nur Champions.
 * - Nach dem Spiel: Nachbesprechung des letzten Matches (eigene Werte
 *   gegen den eigenen Schnitt + Trainingsziele, optional KI-Zusammenfassung).
 * Keine Eingaben in den Client, keine Automatisierung.
 */
const POS = { top: 'Top', jungle: 'Jungle', middle: 'Mid', bottom: 'ADC', utility: 'Support' };

class LolFlow {
  constructor(s) {
    this.s = s; this.timer = null; this.phase = null; this.champ = null; this.lastSelectKey = ''; this.adviceKey = ''; this.busy = false; this.reviewPending = null;
    s.bus.on('game:client', ({ league }) => (league ? this.start() : this.stop()));
    s.bus.on('settings:changed', ({ keys }) => { if (keys.includes('gaming')) this.reconsider(); });
  }

  cfg() { return this.s.settings.get('gaming') || {}; }
  wanted() { const c = this.cfg(); return c.lolChampSelect !== false || c.lolReview !== false; }
  reconsider() { if (this.s.gaming.context.leagueClient && this.wanted()) this.start(); else this.stop(); }

  start() {
    if (this.timer || !this.wanted()) return;
    log.info('League-Client erkannt – Championauswahl/Nachbesprechung aktiv');
    this.timer = setInterval(() => this.tick().catch((e) => log.debug('tick', e)), 4000);
    this.tick().catch(() => {});
  }
  stop() {
    clearInterval(this.timer); this.timer = null; this.phase = null;
    if (this.champ) { this.champ = null; this.s.bus.emit('lol:champselect', { active: false }); }
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const L = this.s.gaming.league;
      const phase = await L.lcuGet('/lol-gameflow/v1/gameflow-phase').catch(() => null);
      const prev = this.phase; this.phase = phase;
      if (phase === 'ChampSelect' && this.cfg().lolChampSelect !== false) await this.champSelect();
      else if (prev === 'ChampSelect' && this.champ) { this.champ = null; this.lastSelectKey = ''; this.s.bus.emit('lol:champselect', { active: false }); }
      if (prev === 'InProgress' && phase && phase !== 'InProgress' && phase !== 'Reconnect') {
        // Spiel vorbei → kurz warten, bis der Client die Statistik hat
        clearTimeout(this.reviewPending);
        if (this.cfg().lolReview !== false) this.reviewPending = setTimeout(() => this.review().catch((e) => log.warn('review', e)), 20000);
      }
    } finally { this.busy = false; }
  }

  /** Read champ select session (own pick + enemy champions only). */
  async champSelect() {
    const L = this.s.gaming.league;
    const sess = await L.lcuGet('/lol-champ-select/v1/session').catch(() => null);
    if (!sess) return;
    const champs = await L.champions().then((r) => r.value).catch(() => []);
    const name = (cid) => (cid ? champs.find((c) => String(c.key) === String(cid))?.name || null : null);
    const me = (sess.myTeam || []).find((x) => x.cellId === sess.localPlayerCellId) || {};
    const myChampion = name(me.championId) || name(me.championPickIntent);
    const locked = !!me.championId;
    const enemies = (sess.theirTeam || []).map((x) => name(x.championId)).filter(Boolean);
    const role = POS[String(me.assignedPosition || '').toLowerCase()] || null;
    const key = [myChampion, locked, role, ...enemies].join('|');
    if (key === this.lastSelectKey) return;
    this.lastSelectKey = key;
    const tips = [];
    for (const e of enemies.slice(0, 5)) {
      try { const c = await L.champion(e); if (c?.enemytips?.[0]) tips.push(`${c.name}: ${c.enemytips[0]}`); } catch { /* ignore */ }
    }
    this.champ = { active: true, myChampion, locked, role, enemies, tips, advice: this.champ?.adviceKey === key ? this.champ.advice : null };
    this.s.bus.emit('lol:champselect', this.champ);
    if (myChampion && enemies.length && this.s.gemini.hasKey()) this.advise(key, myChampion, role, enemies).catch((e) => log.debug('advice', e));
  }

  async advise(key, myChampion, role, enemies) {
    const ck = 'lol:advice:' + [myChampion, role, ...[...enemies].sort()].join('|');
    const cached = this.s.gaming.cache.get(ck)?.value;
    let advice = cached;
    if (!advice) {
      const goals = this.s.gaming.league.goals().map((g) => g.text).slice(0, 3);
      const st = this.s.gaming.league.stats(20).current;
      advice = await this.s.gemini.generate({
        model: this.s.gemini.requireModel('fast'), temperature: 0.4,
        system: 'Du bist ein knapper League-of-Legends-Coach. Antworte auf Deutsch in max. 4 kurzen Stichpunkten (Markdown-Liste). Nur Champion-Matchup-Wissen, keine erfundenen Zahlen oder Patch-Details. Keine Aussagen über andere Spieler.',
        contents: [{ role: 'user', parts: [{ text: `Ich spiele ${myChampion}${role ? ' auf ' + role : ''}. Gegnerische Champions: ${enemies.join(', ')}.${st ? ` Meine Ø-Werte: ${st.csPerMin} CS/min, ${st.avgD} Tode.` : ''}${goals.length ? ' Meine Trainingsziele: ' + goals.join('; ') + '.' : ''} Worauf muss ich in diesem Spiel achten (Lane-Phase, gefährlichste Fähigkeiten, Item-Hinweis)?` }] }],
      });
      this.s.gaming.cache.set(ck, advice, 'Gemini (Champion-Wissen)', 3 * 86400000);
    }
    if (this.lastSelectKey !== key || !this.champ) return;
    this.champ = { ...this.champ, advice, adviceKey: key };
    this.s.bus.emit('lol:champselect', this.champ);
  }

  /** Post-game review of the newest game. */
  async review({ force = false } = {}) {
    const L = this.s.gaming.league;
    const m = await L.latestClientGame();
    if (!m) return null;
    if (!force && this.s.db.get("SELECT 1 x FROM game_reviews WHERE game='league' AND ref=?", m.matchId)) return null;
    if (Date.now() - Date.parse(m.playedAt) - m.duration * 1000 > 3 * 3600_000 && !force) return null; // nur frische Spiele
    try { await L.syncFromClient(); } catch { /* ignore */ }
    const avg = L.stats(20).current;
    const tips = reviewTips(m, avg, L.goals());
    let summary = `**${m.win ? 'Sieg' : 'Niederlage'}** mit ${m.champion} · ${m.kills}/${m.deaths}/${m.assists} · ${m.csPerMin} CS/min${m.vision != null ? ` · Vision ${m.vision}` : ''} · ${Math.round(m.duration / 60)} min`;
    if (tips.length) summary += '\n\n' + tips.map((t) => '- ' + t).join('\n');
    if (this.cfg().lolReviewAi !== false && this.s.gemini.hasKey()) {
      try {
        const ai = await this.s.gemini.generate({
          model: this.s.gemini.requireModel('fast'), temperature: 0.4,
          system: 'Du bist ein ehrlicher, motivierender LoL-Coach. Deutsch, max. 3 Sätze. Nutze NUR die gelieferten Zahlen, erfinde nichts.',
          contents: [{ role: 'user', parts: [{ text: `Spiel: ${JSON.stringify(m)}\nMein Schnitt (letzte 20 Ranked): ${JSON.stringify(avg)}\nRegelbasierte Hinweise: ${tips.join(' | ')}\nGib mir eine kurze Nachbesprechung mit dem wichtigsten Fokus fürs nächste Spiel.` }] }],
        });
        if (ai) summary += '\n\n' + ai.trim();
      } catch (e) { log.debug('ai review', e); }
    }
    const title = `${m.champion} · ${m.win ? 'Sieg' : 'Niederlage'}`;
    this.s.db.run('INSERT OR REPLACE INTO game_reviews(id,game,ref,title,summary,tips,source,created_at) VALUES(?,?,?,?,?,?,?,?)', id('rv'), 'league', m.matchId, title, summary, JSON.stringify(tips), 'League-Client (lokal)', nowIso());
    this.s.notifications.push({ category: 'gaming', origin: 'client', game: 'league', dedupeKey: 'review:' + m.matchId, title: 'Nachbesprechung: ' + title, body: tips[0] || 'Gutes Spiel – Details im Gaming-Bereich.' });
    this.s.bus.emit('lol:review', { title, summary, win: m.win, matchId: m.matchId });
    this.s.bus.emit('game:data', { game: 'league' });
    return { title, summary, tips };
  }

  reviews(limit = 10) {
    return this.s.db.all("SELECT * FROM game_reviews WHERE game='league' ORDER BY created_at DESC LIMIT ?", limit).map((r) => ({ id: r.id, ref: r.ref, title: r.title, summary: r.summary, tips: safeJson(r.tips, []), source: r.source, createdAt: r.created_at }));
  }
}

/** Rule-based, number-backed hints (no invented data). */
function reviewTips(m, avg, goals = []) {
  const t = [];
  if (avg) {
    if (m.csPerMin < avg.csPerMin - 0.8) t.push(`Farm unter deinem Schnitt (${m.csPerMin} vs. Ø ${avg.csPerMin} CS/min).`);
    else if (m.csPerMin > avg.csPerMin + 0.8) t.push(`Starkes Farmen: ${m.csPerMin} CS/min (Ø ${avg.csPerMin}).`);
    if (m.deaths > avg.avgD + 2) t.push(`${m.deaths} Tode – deutlich über deinem Schnitt von ${avg.avgD}. Wo bist du ohne Sicht gestorben?`);
    if (m.vision != null && avg.vision != null && m.vision < avg.vision * 0.7) t.push(`Vision Score ${m.vision} (Ø ${avg.vision}) – mehr Wards/Control Wards.`);
    if (m.killParticipation != null && avg.kp != null && m.killParticipation < avg.kp - 15) t.push(`Kill-Beteiligung ${m.killParticipation}% (Ø ${avg.kp}%) – öfter zu Objectives rotieren.`);
  } else {
    if (m.csPerMin < 6) t.push(`${m.csPerMin} CS/min – Ziel 7+.`);
    if (m.deaths >= 7) t.push(`${m.deaths} Tode – Positionierung prüfen.`);
  }
  if (m.controlWards === 0 && m.duration > 15 * 60) t.push('Keine Control Ward gekauft.');
  for (const g of goals) {
    if (g.metric === 'csPerMin' && g.target != null) t.push(`Ziel CS/min ${g.target}: ${m.csPerMin >= g.target ? 'erreicht ✓' : 'verfehlt (' + m.csPerMin + ')'}`);
    if (g.metric === 'deaths' && g.target != null) t.push(`Ziel max. ${g.target} Tode: ${m.deaths <= g.target ? 'erreicht ✓' : 'verfehlt (' + m.deaths + ')'}`);
    if (g.metric === 'vision' && g.target != null && m.vision != null) t.push(`Ziel Vision ${g.target}: ${m.vision >= g.target ? 'erreicht ✓' : 'verfehlt (' + m.vision + ')'}`);
  }
  return t.slice(0, 6);
}

module.exports = { LolFlow, reviewTips };
