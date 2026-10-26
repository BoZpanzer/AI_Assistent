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
    this.generation = 0; this.busyGeneration = null; this.disposed = false;
    this.onClientChange = ({ league }) => (league ? this.start() : this.stop());
    this.onSettingsChange = ({ keys }) => { if (keys.includes('gaming')) this.reconsider(); };
    s.bus.on('game:client', this.onClientChange);
    s.bus.on('settings:changed', this.onSettingsChange);
    this.weeklyTimer = setTimeout(() => { try { this.weeklyCheck(); } catch (e) { log.debug('weekly', e); } }, 60000); this.weeklyTimer.unref?.();
    this.weeklyEvery = setInterval(() => { try { this.weeklyCheck(); } catch (e) { log.debug('weekly', e); } }, 3 * 3600_000); this.weeklyEvery.unref?.();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.weeklyTimer); clearInterval(this.weeklyEvery);
    this.s.bus.off?.('game:client', this.onClientChange);
    this.s.bus.off?.('settings:changed', this.onSettingsChange);
    this.stop();
  }

  cfg() { return this.s.settings.get('gaming') || {}; }
  wanted() { const c = this.cfg(); return c.lolChampSelect !== false || c.lolReview !== false; }
  reconsider() { if (this.s.gaming.context.leagueClient && this.wanted()) this.start(); else this.stop(); }

  start() {
    if (this.disposed || this.timer || !this.wanted()) return;
    this.generation++; // invalidate responses from a previous client session
    log.info('League-Client erkannt – Championauswahl/Nachbesprechung aktiv');
    this.timer = setInterval(() => this.tick().catch((e) => log.debug('tick', e)), 4000);
    this.tick().catch(() => {});
  }
  stop() {
    this.generation++; // pending LCU promises/timers belong to an obsolete session
    clearInterval(this.timer); this.timer = null; this.phase = null;
    clearTimeout(this.reviewPending); this.reviewPending = null;
    this.busy = false; this.busyGeneration = null;
    this.gameId = null; this.lastSelectKey = ''; this.adviceKey = '';
    if (this.champ) { this.champ = null; this.s.bus.emit('lol:champselect', { active: false }); }
  }

  async tick() {
    if (this.disposed) return;
    const generation = this.generation;
    if (this.busy && this.busyGeneration === generation) return;
    this.busy = true; this.busyGeneration = generation;
    const active = () => !this.disposed && this.generation === generation;
    try {
      const L = this.s.gaming.league;
      const phase = await L.lcuGet('/lol-gameflow/v1/gameflow-phase').catch(() => null);
      if (!active() || !phase) return; // stale result after stop/restart or brief outage
      const prev = this.phase; this.phase = phase;
      if (phase === 'ChampSelect' && this.cfg().lolChampSelect !== false) await this.champSelect(generation);
      else if (prev === 'ChampSelect' && this.champ) { this.champ = null; this.lastSelectKey = ''; this.s.bus.emit('lol:champselect', { active: false }); }
      if (!active()) return;
      if (['InProgress', 'Reconnect'].includes(phase) && !this.gameId) {
        const sess = await L.lcuGet('/lol-gameflow/v1/session').catch(() => null);
        if (!active()) return;
        if (sess?.gameData?.gameId) this.gameId = sess.gameData.gameId;
      }
      if (!active()) return;
      if (['InProgress', 'Reconnect'].includes(prev) && !['InProgress', 'Reconnect'].includes(phase)) {
        // The callback must still belong to this exact active client session.
        const gid = this.gameId; this.gameId = null;
        clearTimeout(this.reviewPending);
        this.reviewPending = setTimeout(() => {
          if (!active()) return;
          this.reviewPending = null;
          this.afterGame(gid, { generation }).catch((e) => log.warn('afterGame', e));
        }, 15000);
      }
    } finally {
      if (this.busyGeneration === generation) { this.busy = false; this.busyGeneration = null; }
    }
  }

  /** Read champ select session (own pick + enemy champions only). */
  async champSelect(generation = this.generation) {
    const L = this.s.gaming.league;
    const sess = await L.lcuGet('/lol-champ-select/v1/session').catch(() => null);
    if (!sess || this.disposed || generation !== this.generation) return;
    const champs = await L.champions().then((r) => r.value).catch(() => []);
    if (this.disposed || generation !== this.generation) return;
    const name = (cid) => (cid ? champs.find((c) => String(c.key) === String(cid))?.name || null : null);
    const me = (sess.myTeam || []).find((x) => x.cellId === sess.localPlayerCellId) || {};
    const myChampion = name(me.championId) || name(me.championPickIntent);
    const locked = !!me.championId;
    const enemies = (sess.theirTeam || []).map((x) => name(x.championId)).filter(Boolean);
    const allies = (sess.myTeam || []).filter((x) => x.cellId !== sess.localPlayerCellId).map((x) => name(x.championId) || name(x.championPickIntent)).filter(Boolean);
    const bans = [...(sess.bans?.myTeamBans || []), ...(sess.bans?.theirTeamBans || [])].map(name).filter(Boolean);
    const role = POS[String(me.assignedPosition || '').toLowerCase()] || null;
    const key = [myChampion, locked, role, ...enemies, '/', ...allies, '/', ...bans].join('|');
    if (key === this.lastSelectKey) return;
    this.lastSelectKey = key;
    const tips = [];
    for (const e of enemies.slice(0, 5)) {
      try { const c = await L.champion(e); if (c?.enemytips?.[0]) tips.push(`${c.name}: ${c.enemytips[0]}`); } catch { /* ignore */ }
      if (this.disposed || generation !== this.generation) return;
    }
    // Wahrscheinlicher Lane-Gegner: nur wenn eindeutig (Bot → einziger Schütze, Support → einziger Supporter)
    const want = role === 'ADC' ? 'Marksman' : role === 'Support' ? 'Support' : null;
    const cands = want ? enemies.filter((e) => champs.find((c) => c.name === e)?.tags?.[0] === want) : [];
    const laneGuess = cands.length === 1 ? cands[0] : null;
    const prev = this.champ;
    const enemyKey = [...enemies].sort().join('|');
    const pickKey = [role, enemyKey, [...allies, ...bans].sort().join('|')].join('#');
    this.champ = { active: true, myChampion, locked, role, enemies, allies, tips, laneGuess, advice: prev?.adviceKey === key ? prev.advice : null, matchup: prev?.matchup?.key === `${myChampion}|${laneGuess}` ? prev.matchup : null,
      enemyTips: prev?.enemyTipsKey === enemyKey ? prev.enemyTips : null, enemyTipsKey: prev?.enemyTipsKey === enemyKey ? enemyKey : null,
      picks: prev?.picksKey === pickKey ? prev.picks : null, picksKey: prev?.picksKey === pickKey ? pickKey : null };
    this.remember();
    this.s.bus.emit('lol:champselect', this.champ);
    const still = () => !this.disposed && generation === this.generation && this.lastSelectKey === key && this.champ;
    // Tipps gegen jeden gegnerischen Champion (vor dem Spiel, statisch – gilt dann auch im Spiel)
    if (enemies.length && !this.champ.enemyTips) {
      this.enemyTips({ enemies }).then((t) => { if (!still()) return; this.champ = { ...this.champ, enemyTips: t, enemyTipsKey: enemyKey }; this.remember(); this.s.bus.emit('lol:champselect', this.champ); }).catch((e) => log.debug('enemyTips', e));
    }
    // Champion-Empfehlung gegen das Gegnerteam – nur solange noch nicht festgelegt
    if (!locked && enemies.length && !this.champ.picks && this.cfg().lolPickAdvice !== false) {
      const pickable = await L.lcuGet('/lol-champ-select/v1/pickable-champion-ids').catch(() => null);
      const pickNames = Array.isArray(pickable) ? new Set(pickable.map(name).filter(Boolean)) : null;
      this.recommend({ role, enemies, allies, unavailable: bans, pickable: pickNames }).then((r) => { if (!still()) return; this.champ = { ...this.champ, picks: r, picksKey: pickKey }; this.remember(); this.s.bus.emit('lol:champselect', this.champ); }).catch((e) => log.debug('recommend', e));
    }
    if (myChampion && laneGuess && !this.champ.matchup && this.cfg().lolMatchupCard !== false) {
      this.matchup({ mine: myChampion, vs: laneGuess, role }).then((mu) => {
        if (this.disposed || generation !== this.generation || this.lastSelectKey !== key || !this.champ) return;
        this.champ = { ...this.champ, matchup: { key: `${myChampion}|${laneGuess}`, ...mu } }; this.remember(); this.s.bus.emit('lol:champselect', this.champ);
      }).catch((e) => log.debug('matchup', e));
    }
    // Team-Tipps: ein Gemini-Aufruf pro Gegner-Zusammenstellung (fast nie im Cache) → im Sparmodus aus.
    if (myChampion && enemies.length && this.cfg().lolTeamAdvice === true && this.s.gemini.cloudAllowed('lol')) this.advise(key, myChampion, role, enemies).catch((e) => log.debug('advice', e));
  }

  async advise(key, myChampion, role, enemies) {
    const ck = 'lol:advice:' + [myChampion, role, ...[...enemies].sort()].join('|');
    const cached = this.s.gaming.cache.get(ck)?.value;
    let advice = cached;
    if (!advice) {
      const goals = this.s.gaming.league.goals().map((g) => g.text).slice(0, 3);
      const st = this.s.gaming.league.stats(20).current;
      advice = await this.s.gemini.generate({ feature: 'lol', background: true, dedupe: true,
        tier: 'lite', temperature: 0.4, maxOut: 600,
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
   * Tipps gegen jeden gegnerischen Champion: gefährlichste Fähigkeit + 2–3 konkrete Konter-Tipps.
   * Statisches Champion-Wissen, VOR dem Spiel erzeugt und pro Patch gespeichert (ein gebündelter Aufruf mit dem
   * Sparmodell für alle noch unbekannten Champions). Ohne Cloud: Riots eigene „Enemy Tips“ (Data Dragon).
   * Riot-Regeln: keine Live-Entscheidungen, keine Cooldown-/Positionsverfolgung – nur, was man vor dem Spiel weiß.
   */
  async enemyTips({ enemies = [] } = {}) {
    const L = this.s.gaming.league; const K = await L.keyer();
    let patch = null; try { patch = String(await L.ddVersion()).split('.').slice(0, 2).join('.'); } catch { patch = null; }
    const list = [...new Set(enemies.filter(Boolean))].slice(0, 5);
    const ck = (e) => `lol:enemytip:${patch || 'x'}:${K(e)}`;
    const out = new Map(); const missing = [];
    for (const e of list) { const c = this.s.gaming.cache.get(ck(e))?.value; if (c?.tips?.length) out.set(e, { ...c, champion: e, source: 'ki' }); else missing.push(e); }
    if (missing.length && this.cfg().lolEnemyTips !== false && this.s.gemini.cloudAllowed('lol')) {
      try {
        let r = await this.s.gemini.generate({ feature: 'lol', background: true, dedupe: true, tier: 'lite', json: true, schema: ENEMY_SCHEMA, temperature: 0.3, maxOut: 1200,
          system: 'Du bist ein League-of-Legends-Coach. Für jeden genannten gegnerischen Champion: die gefährlichste Fähigkeit oder Stärke (danger, ein kurzer Satz mit Fähigkeitsname) und 2–3 konkrete, kurze Tipps, wie man dagegen spielt (worauf achten, was ausweichen/respektieren, wann er schwach ist, welches Item hilft). Allgemein bekanntes Champion-Wissen, keine erfundenen Zahlen oder Patchdetails. Deutsch, höchstens 16 Wörter pro Tipp.',
          contents: [{ role: 'user', parts: [{ text: `Gegnerische Champions: ${missing.join(', ')}${patch ? ` (Patch ${patch})` : ''}.` }] }] });
        if (typeof r === 'string') r = JSON.parse(r);
        for (const x of r?.enemies || []) {
          const nm = missing.find((m) => K(m) === K(x.champion || ''));
          if (!nm || !Array.isArray(x.tips) || !x.tips.length) continue;
          const v = { champion: nm, danger: String(x.danger || '').slice(0, 200), tips: x.tips.slice(0, 3).map((t) => String(t).slice(0, 160)) };
          this.s.gaming.cache.set(ck(nm), v, 'Gemini (Champion-Wissen' + (patch ? ', Patch ' + patch : '') + ')', 30 * 86400000);
          out.set(nm, { ...v, source: 'ki' });
        }
      } catch (e) { log.debug('enemyTips', e); }
    }
    for (const e of list) {
      if (out.has(e)) continue;
      try { const c = await L.champion(e); if (c?.enemytips?.length) out.set(e, { champion: e, danger: null, tips: c.enemytips.slice(0, 2), source: 'riot' }); } catch { /* offline */ }
    }
    return list.map((e) => out.get(e)).filter(Boolean);
  }

  /** Im Spiel: Gegner-Tipps einmal pro Match bereitstellen (aus dem Speicher, nicht blockierend). */
  liveEnemyTips(enemies = []) {
    const key = [...enemies].sort().join('|');
    if (!key) return null;
    if (this._live?.key === key) return this._live.tips;
    const fromSelect = this.champ?.enemyTipsKey === key ? this.champ.enemyTips : null;
    this._live = { key, tips: fromSelect || null };
    if (!fromSelect) this.enemyTips({ enemies }).then((t) => { if (this._live?.key === key) this._live.tips = t; }).catch(() => {});
    return this._live.tips;
  }

  /**
   * Champion-Empfehlung gegen das Gegnerteam: aus deinem eigenen Pool (gespeicherte Spiele, bevorzugt auf deiner Rolle),
   * gewichtet mit deiner Bilanz insgesamt und gegen genau diese Gegner (analysierte Spiele). Optional (Sparmodell):
   * Auswahl und Begründung passend zur Zusammenstellung (Schadensart, Engage, Lane). Nur Champions aus deinem Pool.
   */
  async recommend({ role = null, enemies = [], allies = [], unavailable = [], pickable = null } = {}) {
    const L = this.s.gaming.league; const K = await L.keyer();
    const roleKey = { Top: 'TOP', Jungle: 'JUNGLE', Mid: 'MIDDLE', ADC: 'BOTTOM', Support: 'UTILITY' }[role] || null;
    const ms = L.matches(300);
    const build = (filterRole) => {
      const pool = new Map();
      for (const m of ms) {
        if (!m.champion || (filterRole && roleKey && m.role && m.role !== roleKey)) continue;
        const p = pool.get(m.champion) || { champion: m.champion, games: 0, wins: 0 }; p.games++; if (m.win) p.wins++; pool.set(m.champion, p);
      }
      return pool;
    };
    let pool = build(true); let onRole = true;
    if ([...pool.values()].reduce((a, p) => a + p.games, 0) < 5) { pool = build(false); onRole = false; }
    const taken = new Set([...enemies, ...allies, ...unavailable].map((x) => K(x)));
    const pick = pickable ? new Set([...pickable].map((x) => K(x))) : null;
    // Bilanz gegen Lane-Gegner aus den analysierten Spielen – einmal einlesen
    const duels = [];
    for (const r of this.s.db.all('SELECT match_id FROM lol_matches ORDER BY played_at DESC LIMIT 300')) { const d = L.getDeep(r.match_id); if (d?.champion && d?.opponent?.champion) duels.push({ me: K(d.champion), vs: K(d.opponent.champion), win: !!d.win }); }
    const cands = [...pool.values()].filter((p) => !taken.has(K(p.champion)) && (!pick || pick.has(K(p.champion)))).map((p) => {
      const vs = [];
      let score = (p.wins + 2) / (p.games + 4) + Math.min(0.08, p.games * 0.005); // Erfahrung zählt etwas
      for (const e of enemies) {
        const g = duels.filter((x) => x.me === K(p.champion) && x.vs === K(e));
        if (g.length) { const w = g.filter((x) => x.win).length; vs.push({ enemy: e, wins: w, games: g.length }); score += ((w + 1) / (g.length + 2) - 0.5) * Math.min(1, g.length / 4) * 0.5; }
      }
      return { champion: p.champion, games: p.games, wins: p.wins, winrate: Math.round((p.wins / p.games) * 100), vs, score: Math.round(score * 1000) / 1000 };
    }).sort((a, b) => b.score - a.score || b.games - a.games).slice(0, 6);
    let ai = null; let aiError = null;
    if (cands.length >= 2 && enemies.length >= 2 && this.s.gemini.cloudAllowed('lol')) {
      let patch = null; try { patch = String(await L.ddVersion()).split('.').slice(0, 2).join('.'); } catch { patch = null; }
      const ck = `lol:pick:${patch || 'x'}:${roleKey || ''}:${enemies.map(K).sort().join(',')}:${allies.map(K).sort().join(',')}:${cands.map((c) => K(c.champion)).sort().join(',')}`;
      ai = this.s.gaming.cache.get(ck)?.value || null;
      if (!ai) {
        try {
          let r = await this.s.gemini.generate({ feature: 'lol', background: true, dedupe: true, tier: 'lite', json: true, schema: PICK_SCHEMA, temperature: 0.3, maxOut: 700,
            system: 'Du bist ein League-of-Legends-Coach in der Championauswahl. Wähle NUR aus dem genannten Champion-Pool des Spielers bis zu 3 Champions, die gegen das gegnerische Team am besten passen, und begründe jeweils in einem kurzen Satz (z. B. Schadensart des Gegners, Engage/Peel, Lane-Matchup, Synergie mit dem eigenen Team). Keine erfundenen Winrates. Deutsch.',
            contents: [{ role: 'user', parts: [{ text: `Meine Rolle: ${role || 'unbekannt'}. Gegnerteam: ${enemies.join(', ')}.${allies.length ? ' Mein Team: ' + allies.join(', ') + '.' : ''} Mein Pool (eigene Spiele): ${cands.map((c) => `${c.champion} (${c.games} Spiele, ${c.winrate} %)`).join(', ')}.` }] }] });
          if (typeof r === 'string') r = JSON.parse(r);
          const names = new Map(cands.map((c) => [K(c.champion), c.champion]));
          ai = { picks: (r?.picks || []).filter((x) => names.has(K(x.champion || ''))).slice(0, 3).map((x) => ({ champion: names.get(K(x.champion)), reason: String(x.reason || '').slice(0, 220) })), note: r?.note ? String(r.note).slice(0, 220) : null };
          if (ai.picks.length) this.s.gaming.cache.set(ck, ai, 'Gemini (Champion-Wissen)', 14 * 86400000); else ai = null;
        } catch (e) { aiError = e.message; ai = null; }
      }
    }
    return { role, onRole, basedOn: ms.length, candidates: cands, ai, aiError };
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
      if (!card && this.s.gemini.cloudAllowed('lol')) {
        try {
          card = await this.s.gemini.generate({ feature: 'lol', background: true, dedupe: true, tier: 'lite', temperature: 0.3, json: true, schema: MATCHUP_SCHEMA, maxOut: 1500,
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
  async afterGame(gameId, { tries = 16, delayMs = 15000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), generation = this.generation } = {}) {
    const active = () => !this.disposed && generation === this.generation;
    if (!active()) return null;
    const L = this.s.gaming.league;
    if (!gameId) {
      const eog = await L.lcuGet('/lol-end-of-game/v1/eog-stats-block').catch(() => null);
      if (!active()) return null;
      gameId = eog?.gameId || null;
    }
    let me = null; let m = null;
    for (let i = 0; i < tries && gameId && active(); i++) {
      try {
        me = me || await L.lcuGet('/lol-summoner/v1/current-summoner');
        if (!active()) return null;
        const g = await L.clientGame(gameId);
        if (!active()) return null;
        if (g?.gameDuration && (g.participants || []).length) {
          m = await L.storeClientGame(g, me);
          if (!active()) return null;
          if (m) break;
        }
      } catch (e) { log.debug('Spiel noch nicht abrufbar', e); }
      if (i < tries - 1 && !m) await sleep(delayMs);
    }
    if (!active()) return null;
    try { await L.syncFromClient(); } catch { /* Client evtl. schon zu */ }
    if (!active()) return null;
    let deep = null;
    if (m) { try { deep = await L.deepAnalyze(m.matchId, { me }); } catch (e) { log.debug('deep', e); } }
    if (!active()) return null;
    this.s.bus.emit('game:data', { game: 'league' });
    if (this.cfg().lolReview !== false) await this.review({ match: m || undefined, deep, generation });
    return active() ? m : null;
  }

  /** Post-game review of the newest game. */
  async review({ force = false, match, deep, generation = null } = {}) {
    // Manually requested reviews are independent; automated ones are cancelled on stop.
    const active = () => generation === null || (!this.disposed && generation === this.generation);
    if (!active()) return null;
    const L = this.s.gaming.league;
    const m = match || await L.latestClientGame();
    if (!m || !active()) return null;
    if (!force && this.s.db.get("SELECT 1 x FROM game_reviews WHERE game='league' AND ref=?", m.matchId)) return null;
    if (Date.now() - Date.parse(m.playedAt) - m.duration * 1000 > 3 * 3600_000 && !force) return null; // nur frische Spiele
    try { await L.syncFromClient(); } catch { /* ignore */ }
    if (!active()) return null;
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
    if (this.cfg().lolReviewAi === true && this.s.gemini.cloudAllowed('lol')) {
      try {
        const res = await this.s.gemini.generate({ feature: 'lol', json: true, schema: REVIEW_SCHEMA, background: true, dedupe: true, maxOut: 1200, tier: 'lite',
          model: this.s.gemini.requireModel('fast'), temperature: 0.4,
          system: 'Du bist ein ehrlicher, motivierender LoL-Coach. Deutsch, max. 4 Sätze. Nutze NUR die gelieferten Zahlen und Notizen, erfinde nichts. Wenn Notizen da sind, verknüpfe sie mit den Zahlen (z. B. Notiz „Jungler kam bot“ + Tod mit Jungler-Beteiligung).',
          contents: [{ role: 'user', parts: [{ text: `Spiel: ${JSON.stringify(m)}\n${deep?.hasTimeline ? `Timeline-Auswertung (Tode mit Minute/Ort/beteiligten Gegnern/Gold in der Tasche, Lane-Differenzen, Objectives, gegnerischer Jungler, eigenes Jungling): ${JSON.stringify({ deaths: deep.deathsDetail, csDiff10: deep.csDiff10, goldDiff15: deep.goldDiff15, opponent: deep.opponent?.champion, objectives: deep.objectives, enemyJungle: deep.enemyJungle, jungle: deep.jungle, wardsBefore14: deep.wardsBefore14, firstBackMin: deep.firstBackMin })}\n` : ''}${notes.length ? `Notizen, die ich mir im Spiel gemacht habe (meine eigene Wahrnehmung): ${JSON.stringify(notes.map((n) => ({ min: n.gameSec != null ? Math.round(n.gameSec / 60) : null, text: n.text })))}\n` : ''}Mein Schnitt (letzte 20 Ranked): ${JSON.stringify(avg)}\nRegelbasierte Hinweise: ${tips.join(' | ')}\nGib mir eine kurze Nachbesprechung mit dem wichtigsten Fokus fürs nächste Spiel (review). Stelle außerdem 2–3 kurze, konkrete Reflexionsfragen zu Momenten aus den Daten (z. B. zu einem bestimmten Tod mit Minute), die ich in einem Satz beantworten kann (questions).` }] }],
        });
        if (!active()) return null;
        const ai = typeof res === 'string' ? res : res?.review;
        if (ai) summary += '\n\n' + String(ai).trim();
        questions = L.setDebriefQuestions(m.matchId, Array.isArray(res?.questions) ? res.questions : []);
      } catch (e) { log.debug('ai review', e); }
    }
    if (!active()) return null;
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
const ENEMY_SCHEMA = { type: 'object', required: ['enemies'], properties: { enemies: { type: 'array', items: { type: 'object', required: ['champion', 'tips'], properties: { champion: { type: 'string' }, danger: { type: 'string' }, tips: { type: 'array', items: { type: 'string' } } } } } } };
const PICK_SCHEMA = { type: 'object', required: ['picks'], properties: { picks: { type: 'array', items: { type: 'object', required: ['champion', 'reason'], properties: { champion: { type: 'string' }, reason: { type: 'string' } } } }, note: { type: 'string' } } };
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
