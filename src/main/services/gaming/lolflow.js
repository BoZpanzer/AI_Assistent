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
    this.weeklyTimer = setTimeout(() => { try { this.weeklyCheck(); } catch (e) { log.debug('weekly', e); } }, 60000); this.weeklyTimer.unref?.();
    this.weeklyEvery = setInterval(() => { try { this.weeklyCheck(); } catch (e) { log.debug('weekly', e); } }, 3 * 3600_000); this.weeklyEvery.unref?.();
  }
  dispose() { clearTimeout(this.weeklyTimer); clearInterval(this.weeklyEvery); this.stop(); }

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
      if (phase === 'InProgress' && !this.gameId) {
        const sess = await L.lcuGet('/lol-gameflow/v1/session').catch(() => null);
        if (sess?.gameData?.gameId) this.gameId = sess.gameData.gameId;
      }
      if (prev === 'InProgress' && phase && phase !== 'InProgress' && phase !== 'Reconnect') {
        // Spiel vorbei → das Spiel gezielt per gameId holen (ohne Umweg über die Matchhistorie)
        const gid = this.gameId; this.gameId = null;
        clearTimeout(this.reviewPending);
        this.reviewPending = setTimeout(() => this.afterGame(gid).catch((e) => log.warn('afterGame', e)), 15000);
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
    // Wahrscheinlicher Lane-Gegner: nur wenn eindeutig (Bot → einziger Schütze, Support → einziger Supporter)
    const want = role === 'ADC' ? 'Marksman' : role === 'Support' ? 'Support' : null;
    const cands = want ? enemies.filter((e) => champs.find((c) => c.name === e)?.tags?.[0] === want) : [];
    const laneGuess = cands.length === 1 ? cands[0] : null;
    this.champ = { active: true, myChampion, locked, role, enemies, tips, laneGuess, advice: this.champ?.adviceKey === key ? this.champ.advice : null, matchup: this.champ?.matchup?.key === `${myChampion}|${laneGuess}` ? this.champ.matchup : null };
    this.remember();
    this.s.bus.emit('lol:champselect', this.champ);
    if (myChampion && laneGuess && !this.champ.matchup && this.cfg().lolMatchupCard !== false) {
      this.matchup({ mine: myChampion, vs: laneGuess, role }).then((mu) => {
        if (this.lastSelectKey !== key || !this.champ) return;
        this.champ = { ...this.champ, matchup: { key: `${myChampion}|${laneGuess}`, ...mu } }; this.remember(); this.s.bus.emit('lol:champselect', this.champ);
      }).catch((e) => log.debug('matchup', e));
    }
    if (myChampion && enemies.length && this.s.gemini.hasKey()) this.advise(key, myChampion, role, enemies).catch((e) => log.debug('advice', e));
  }

  async advise(key, myChampion, role, enemies) {
    const ck = 'lol:advice:' + [myChampion, role, ...[...enemies].sort()].join('|');
    const cached = this.s.gaming.cache.get(ck)?.value;
    let advice = cached;
    if (!advice) {
      const goals = this.s.gaming.league.goals().map((g) => g.text).slice(0, 3);
      const st = this.s.gaming.league.stats(20).current;
      advice = await this.s.gemini.generate({ feature: 'lol',
        model: this.s.gemini.requireModel('fast'), temperature: 0.4,
        system: 'Du bist ein knapper League-of-Legends-Coach. Antworte auf Deutsch in max. 4 kurzen Stichpunkten (Markdown-Liste). Nur Champion-Matchup-Wissen, keine erfundenen Zahlen oder Patch-Details. Keine Aussagen über andere Spieler.',
        contents: [{ role: 'user', parts: [{ text: `Ich spiele ${myChampion}${role ? ' auf ' + role : ''}. Gegnerische Champions: ${enemies.join(', ')}.${st ? ` Meine Ø-Werte: ${st.csPerMin} CS/min, ${st.avgD} Tode.` : ''}${goals.length ? ' Meine Trainingsziele: ' + goals.join('; ') + '.' : ''} Worauf muss ich in diesem Spiel achten (Lane-Phase, gefährlichste Fähigkeiten, Item-Hinweis)?` }] }],
      });
      this.s.gaming.cache.set(ck, advice, 'Gemini (Champion-Wissen)', 3 * 86400000);
    }
    if (this.lastSelectKey !== key || !this.champ) return;
    this.champ = { ...this.champ, advice, adviceKey: key };
    this.remember();
    this.s.bus.emit('lol:champselect', this.champ);
  }

  /**
   * Matchup-Karte: Spielphasen (wer ist wann stärker), Win-Condition, Gefahren, Build-Hinweis (KI-Champion-Wissen,
   * pro Patch einmal erzeugt und gespeichert) + deine eigene Bilanz in dem Matchup + deine eigenen Notizen.
   * Nur für Championauswahl und Nachbereitung – nicht als Anweisung im laufenden Spiel.
   */
  async matchup({ mine, vs, role = null, ai = true }) {
    const L = this.s.gaming.league;
    if (!vs) throw new Error('Gegner-Champion fehlt');
    const [stats, notes] = await Promise.all([L.matchupStats(vs, mine), L.matchupNotes(vs, mine)]);
    let card = null; let patch = null; let cardError = null;
    if (mine && ai) {
      try { patch = String(await L.ddVersion()).split('.').slice(0, 2).join('.'); } catch { patch = null; }
      const K = await L.keyer();
      const ck = `lol:matchup:${patch || 'x'}:${K(mine)}:${K(vs)}:${role || ''}`;
      card = this.s.gaming.cache.get(ck)?.value || null;
      if (!card && this.s.gemini.hasKey()) {
        try {
          card = await this.s.gemini.generate({ feature: 'lol', model: this.s.gemini.requireModel('fast'), temperature: 0.3, json: true, schema: MATCHUP_SCHEMA,
            system: 'Du bist ein erfahrener League-of-Legends-Coach. Deutsch, knapp, konkret. Nur allgemein bekanntes Champion- und Matchup-Wissen (Stärken je Spielphase, Fähigkeiten, typische Spielweise). Keine erfundenen Zahlen, Winrates oder Patch-Details. Bist du dir bei einem Punkt unsicher, lass ihn weg und setze confidence entsprechend.',
            contents: [{ role: 'user', parts: [{ text: `Matchup: Ich spiele ${mine}${role ? ' (' + role + ')' : ''} gegen ${vs}${patch ? ` (Patch ${patch})` : ''}. Beschreibe für jede Phase (Level 1–3, Level 6, Midgame, Lategame), wer im Vorteil ist (du/gegner/ausgeglichen) und was das für mich heißt – z. B. ob es okay ist, früh zu verlieren, oder ob ich früh Druck machen muss. Dazu Win-Condition, was ich vermeiden sollte, gefährlichste Fähigkeiten des Gegners und ein kurzer Item-/Runen-Hinweis.` }] }],
          });
          if (typeof card === 'string') card = JSON.parse(card);
          if (card?.phases) this.s.gaming.cache.set(ck, card, 'Gemini (Champion-Wissen' + (patch ? ', Patch ' + patch : '') + ')', 30 * 86400000);
        } catch (e) { cardError = e.message; card = null; }
      }
    }
    return { mine, vs, role, patch, card, cardSource: card ? 'KI-Champion-Wissen – kann nach Patches abweichen' : null, cardError, stats, notes };
  }

  remember() { if (this.champ?.myChampion) this.s.gaming.cache.set('lol:lastchamp', { ...this.champ, active: false, at: nowIso() }, 'League-Client (lokal)', 365 * 86400000); }
  state() { return this.champ || { active: false, last: this.s.gaming.cache.get('lol:lastchamp', { allowStale: true })?.value || null }; }

  /**
   * Nach Spielende: gameId aus der Sitzung bzw. dem Endbildschirm, dann das Spiel direkt laden.
   * Riot braucht ein paar Sekunden bis Minuten, bis das Spiel abrufbar ist → bis zu 4 Minuten erneut versuchen.
   */
  async afterGame(gameId, { tries = 16, delayMs = 15000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const L = this.s.gaming.league;
    if (!gameId) {
      const eog = await L.lcuGet('/lol-end-of-game/v1/eog-stats-block').catch(() => null);
      gameId = eog?.gameId || null;
    }
    let me = null; let m = null;
    for (let i = 0; i < tries && gameId; i++) {
      try {
        me = me || await L.lcuGet('/lol-summoner/v1/current-summoner');
        const g = await L.clientGame(gameId);
        if (g?.gameDuration && (g.participants || []).length) { m = await L.storeClientGame(g, me); if (m) break; }
      } catch (e) { log.debug('Spiel noch nicht abrufbar', e); }
      await sleep(delayMs);
    }
    try { await L.syncFromClient(); } catch { /* Client evtl. schon zu */ }
    let deep = null;
    if (m) { try { deep = await L.deepAnalyze(m.matchId, { me }); } catch (e) { log.debug('deep', e); } }
    this.s.bus.emit('game:data', { game: 'league' });
    if (this.cfg().lolReview !== false) await this.review({ match: m || undefined, deep });
    return m;
  }

  /** Post-game review of the newest game. */
  async review({ force = false, match, deep } = {}) {
    const L = this.s.gaming.league;
    const m = match || await L.latestClientGame();
    if (!m) return null;
    if (!force && this.s.db.get("SELECT 1 x FROM game_reviews WHERE game='league' AND ref=?", m.matchId)) return null;
    if (Date.now() - Date.parse(m.playedAt) - m.duration * 1000 > 3 * 3600_000 && !force) return null; // nur frische Spiele
    try { await L.syncFromClient(); } catch { /* ignore */ }
    const avg = L.stats(20).current;
    deep = deep || L.getDeep(m.matchId);
    const tips = reviewTips(m, avg, L.goals(), deep);
    let summary = `**${m.win ? 'Sieg' : 'Niederlage'}** mit ${m.champion} · ${m.kills}/${m.deaths}/${m.assists} · ${m.csPerMin} CS/min${m.vision != null ? ` · Vision ${m.vision}` : ''} · ${Math.round(m.duration / 60)} min`;
    deep = deep || L.getDeep(m.matchId);
    if (deep?.hasTimeline) {
      const facts = [];
      if (deep.opponent?.champion && deep.csDiff10 != null) facts.push(`Lane gegen ${deep.opponent.champion}: ${deep.csDiff10 >= 0 ? '+' : ''}${deep.csDiff10} CS bei 10 Min.${deep.goldDiff15 != null ? `, ${deep.goldDiff15 >= 0 ? '+' : ''}${deep.goldDiff15} Gold bei 15 Min.` : ''}`);
      if (deep.deathsDetail?.length) facts.push('Tode: ' + deep.deathsDetail.map((d) => `${d.min}. Min ${d.zone}${d.by?.length ? ` durch ${d.by.join(' + ')}` : ''}${d.solo ? ' (1v1)' : d.enemies >= 3 ? ` (gegen ${d.enemies})` : ''}${d.jungler ? ' – Jungler beteiligt' : ''}${d.gold != null && d.gold >= 1300 ? `, ${d.gold} Gold dabei` : ''}`).join('; '));
      if (deep.objectives?.lostWhileDead?.length) facts.push('Während du tot warst, hat der Gegner geholt: ' + deep.objectives.lostWhileDead.join(', '));
      facts.push(...jungleFacts(deep));
      if (facts.length) summary += '\n\n' + facts.map((t) => '- ' + t).join('\n');
    }
    if (tips.length) summary += '\n\n' + tips.map((t) => '- ' + t).join('\n');
    // Eigene Notizen aus dem Spiel („Jarvis, notier: …“) – Zeitfenster: Spielstart bis 10 Min. nach Spielende
    const start = Date.parse(m.playedAt);
    const notes = Number.isFinite(start) ? L.liveNotes(new Date(start - 5 * 60000).toISOString(), new Date(start + (m.duration + 600) * 1000).toISOString()) : [];
    if (notes.length) summary += '\n\n**Deine Notizen im Spiel:**\n' + notes.map((n) => `- ${n.gameSec != null ? `${Math.floor(n.gameSec / 60)}:${String(n.gameSec % 60).padStart(2, '0')} ` : ''}${n.text}`).join('\n');
    // Build-Timing gegen den eigenen Schnitt auf dem Champion
    if (deep?.firstItemMin != null) {
      const det = L.deepDetail(m.matchId);
      if (det?.firstItemAvg != null) summary += `\n- Erstes fertiges Item: ${deep.firstItemMin}. Min.${deep.items?.[0]?.name ? ` (${deep.items[0].name})` : ''} · dein Schnitt auf ${m.champion}: ${det.firstItemAvg}. Min.`;
    }
    if (deep?.levels?.me?.[6] != null && deep?.levels?.opp?.[6] != null) {
      const d6 = Math.round((deep.levels.me[6] - deep.levels.opp[6]) * 10) / 10;
      if (Math.abs(d6) >= 0.3) summary += `\n- Level 6: ${deep.levels.me[6]}. Min., ${deep.opponent?.champion || 'dein Gegner'} ${deep.levels.opp[6]}. Min. (${d6 > 0 ? d6 + ' Min. später' : Math.abs(d6) + ' Min. früher'})`;
    }
    let questions = [];
    if (this.cfg().lolReviewAi !== false && this.s.gemini.hasKey()) {
      try {
        const res = await this.s.gemini.generate({ feature: 'lol', json: true, schema: REVIEW_SCHEMA,
          model: this.s.gemini.requireModel('fast'), temperature: 0.4,
          system: 'Du bist ein ehrlicher, motivierender LoL-Coach. Deutsch, max. 4 Sätze. Nutze NUR die gelieferten Zahlen und Notizen, erfinde nichts. Wenn Notizen da sind, verknüpfe sie mit den Zahlen (z. B. Notiz „Jungler kam bot“ + Tod mit Jungler-Beteiligung).',
          contents: [{ role: 'user', parts: [{ text: `Spiel: ${JSON.stringify(m)}\n${deep?.hasTimeline ? `Timeline-Auswertung (Tode mit Minute/Ort/beteiligten Gegnern/Gold in der Tasche, Lane-Differenzen, Objectives, gegnerischer Jungler, eigenes Jungling): ${JSON.stringify({ deaths: deep.deathsDetail, csDiff10: deep.csDiff10, goldDiff15: deep.goldDiff15, opponent: deep.opponent?.champion, objectives: deep.objectives, enemyJungle: deep.enemyJungle, jungle: deep.jungle, wardsBefore14: deep.wardsBefore14, firstBackMin: deep.firstBackMin })}\n` : ''}${notes.length ? `Notizen, die ich mir im Spiel gemacht habe (meine eigene Wahrnehmung): ${JSON.stringify(notes.map((n) => ({ min: n.gameSec != null ? Math.round(n.gameSec / 60) : null, text: n.text })))}\n` : ''}Mein Schnitt (letzte 20 Ranked): ${JSON.stringify(avg)}\nRegelbasierte Hinweise: ${tips.join(' | ')}\nGib mir eine kurze Nachbesprechung mit dem wichtigsten Fokus fürs nächste Spiel (review). Stelle außerdem 2–3 kurze, konkrete Reflexionsfragen zu Momenten aus den Daten (z. B. zu einem bestimmten Tod mit Minute), die ich in einem Satz beantworten kann (questions).` }] }],
        });
        const ai = typeof res === 'string' ? res : res?.review;
        if (ai) summary += '\n\n' + String(ai).trim();
        questions = L.setDebriefQuestions(m.matchId, Array.isArray(res?.questions) ? res.questions : []);
      } catch (e) { log.debug('ai review', e); }
    }
    const title = `${m.champion} · ${m.win ? 'Sieg' : 'Niederlage'}`;
    this.s.db.run('INSERT OR REPLACE INTO game_reviews(id,game,ref,title,summary,tips,source,created_at) VALUES(?,?,?,?,?,?,?,?)', id('rv'), 'league', m.matchId, title, summary, JSON.stringify(tips), 'League-Client (lokal)', nowIso());
    this.s.notifications.push({ category: 'gaming', origin: 'client', game: 'league', dedupeKey: 'review:' + m.matchId, title: 'Nachbesprechung: ' + title, body: tips[0] || 'Gutes Spiel – Details im Gaming-Bereich.' });
    this.s.bus.emit('lol:review', { title, summary, win: m.win, matchId: m.matchId, questions });
    // Pause vorschlagen, wenn die eigene Statistik nach Niederlagen-Serien deutlich schlechter ist
    try {
      const { breakHint } = require('./lolcoach');
      const hint = this.cfg().lolBreakHint !== false ? breakHint(L.sessionStats()) : null;
      if (hint) this.s.notifications.push({ category: 'gaming', origin: 'client', game: 'league', dedupeKey: 'lolbreak:' + m.matchId, title: 'Kurze Pause?', body: hint });
    } catch (e) { log.debug('break', e); }
    this.s.bus.emit('game:data', { game: 'league' });
    return { title, summary, tips, questions };
  }

  /** Wochenbericht einmal pro Woche (ab Montag) als Nachbesprechung + Benachrichtigung, wenn letzte Woche gespielt wurde. */
  weeklyCheck(now = new Date()) {
    if (this.cfg().lolWeekly === false) return null;
    const L = this.s.gaming.league;
    const w = L.weekly(now);
    const key = 'lolweekly:' + w.from.slice(0, 10);
    if (!w.previous || this.s.db.get("SELECT 1 x FROM game_reviews WHERE game='league' AND ref=?", key)) return null;
    const p = w.previous; const g = w.goals.filter((x) => x.measured);
    const lines = [`**Letzte Woche:** ${p.games} Ranked · ${p.winrate} % Siege · ${p.csPerMin} CS/min · Ø ${p.deaths} Tode${p.earlyDeaths != null ? ` (davon vor Min. 14: ${p.earlyDeaths})` : ''}${p.vision != null ? ` · Vision ${p.vision}` : ''}`];
    if (g.length) lines.push('**Ziele (diese Woche bisher):** ' + g.map((x) => `${x.text}: ${x.met}/${x.measured}`).join(' · '));
    if (w.suggestions.length) lines.push('**Vorschläge für neue Ziele:**\n' + w.suggestions.map((x) => `- ${x.text} – ${x.why}`).join('\n'));
    const summary = lines.join('\n\n');
    this.s.db.run('INSERT OR REPLACE INTO game_reviews(id,game,ref,title,summary,tips,source,created_at) VALUES(?,?,?,?,?,?,?,?)', id('rv'), 'league', key, 'Wochenbericht', summary, JSON.stringify(w.suggestions.map((x) => x.text)), 'Gespeicherte Ranked-Spiele', nowIso());
    this.s.notifications.push({ category: 'gaming', origin: 'client', game: 'league', dedupeKey: key, title: 'LoL-Wochenbericht', body: `${p.games} Spiele, ${p.winrate} % Siege${w.suggestions[0] ? ' · Vorschlag: ' + w.suggestions[0].text : ''}` });
    this.s.bus.emit('game:data', { game: 'league' });
    return summary;
  }

  reviews(limit = 10) {
    return this.s.db.all("SELECT * FROM game_reviews WHERE game='league' ORDER BY created_at DESC LIMIT ?", limit).map((r) => ({ id: r.id, ref: r.ref, title: r.title, summary: r.summary, tips: safeJson(r.tips, []), source: r.source, createdAt: r.created_at }));
  }
}

const REVIEW_SCHEMA = { type: 'object', required: ['review', 'questions'], properties: { review: { type: 'string' }, questions: { type: 'array', items: { type: 'string' } } } };
const MATCHUP_SCHEMA = {
  type: 'object', required: ['summary', 'phases', 'winCondition', 'confidence'],
  properties: {
    summary: { type: 'string', description: 'ein Satz: Charakter des Matchups' },
    phases: { type: 'array', items: { type: 'object', required: ['phase', 'edge', 'tip'], properties: { phase: { type: 'string', enum: ['Level 1–3', 'Level 6', 'Midgame', 'Lategame'] }, edge: { type: 'string', enum: ['du', 'gegner', 'ausgeglichen'] }, tip: { type: 'string' } } } },
    winCondition: { type: 'string' },
    avoid: { type: 'array', items: { type: 'string' } },
    dangers: { type: 'array', items: { type: 'string' } },
    build: { type: 'string' },
    confidence: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'] },
  },
};

/** Jungle-/Gank-Fakten aus der Timeline-Analyse (nach dem Spiel). */
function jungleFacts(d) {
  const f = [];
  const ej = d.enemyJungle;
  if (ej?.champion) {
    const side = ej.earlySide === 'top' ? 'auf der oberen Seite' : ej.earlySide === 'bot' ? 'auf der unteren Seite' : ej.earlySide === 'gemischt' ? 'auf beiden Seiten' : null;
    let t = `Gegnerischer Jungler ${ej.champion}${side ? ` war in Min. 3–6 ${side}` : ''}`;
    if (ej.firstGank) t += `; erster erfolgreicher Gank ${ej.firstGank.min}. Min. (${ej.firstGank.zone}${ej.firstGank.victim ? ', ' + ej.firstGank.victim : ''})`;
    if (ej.ganksBefore14 != null) t += `; ${ej.ganksBefore14} Kills mit ihm vor Min. 14, davon ${ej.ganksOnMe || 0} an dir`;
    f.push(t + '.');
  }
  if (d.jungle) {
    const j = d.jungle; const lanes = Object.entries(j.laneVisitsBefore14 || {}).map(([z, n]) => `${z} ${n}×`).join(', ');
    f.push(`Dein Jungling: ${j.jungleCsAt10 ?? '–'} Jungle-CS bei 10 Min., ${j.gankKillsBefore14} Gank-Kills/Assists vor Min. 14${lanes ? `, Minuten an Lanes: ${lanes}` : ''}${j.earlySide ? `, Start ${j.earlySide === 'top' ? 'oben' : j.earlySide === 'bot' ? 'unten' : 'gemischt'}` : ''}.`);
  }
  if (d.firstBackMin != null) f.push(`Erster Einkauf nach dem Start: ${d.firstBackMin}. Min.${d.wardsBefore14 != null ? ` · ${d.wardsBefore14} Wards vor Min. 14` : ''}`);
  return f;
}

/** Rule-based, number-backed hints (no invented data). */
function reviewTips(m, avg, goals = [], deep = null) {
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
    if (g.metric === 'earlyDeaths' && g.target != null && deep?.earlyDeaths != null) t.push(`Ziel max. ${g.target} Tode vor Min. 14: ${deep.earlyDeaths <= g.target ? 'erreicht ✓' : 'verfehlt (' + deep.earlyDeaths + ')'}`);
    if (g.metric === 'vision' && g.target != null && m.vision != null) t.push(`Ziel Vision ${g.target}: ${m.vision >= g.target ? 'erreicht ✓' : 'verfehlt (' + m.vision + ')'}`);
  }
  return t.slice(0, 6);
}

module.exports = { LolFlow, reviewTips, jungleFacts, MATCHUP_SCHEMA };
