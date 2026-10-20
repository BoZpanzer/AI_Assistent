'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGame } = require('../src/main/services/gaming/lolanalysis');

// Spiel wie im Screenshot (League-Client-Format): Malphite mit Support-Item, Leona als Top-Tank.
// Die Lane-Schätzung des Clients ist falsch (Malphite „TOP“, Leona „BOTTOM/SUPPORT“).
const P = (id, champ, lane, role, items, spells, cs, team = 100) => ({ participantId: id, teamId: team, championId: id, spell1Id: spells[0], spell2Id: spells[1], timeline: { lane, role },
  stats: { win: true, kills: 1, deaths: 1, assists: 1, totalMinionsKilled: cs, neutralMinionsKilled: 0, item0: items[0] || 0, item1: items[1] || 0, item2: items[2] || 0 } });
const game = {
  gameId: 1, platformId: 'EUW1', gameDuration: 1800, queueId: 420,
  participantIdentities: [1, 2, 3, 4, 5].map((i) => ({ participantId: i, player: { puuid: 'p' + i } })),
  participants: [
    P(1, 'Malphite', 'TOP', 'SOLO', [3870, 3047], [4, 14], 40),
    P(2, 'Kayn', 'JUNGLE', 'NONE', [6692], [4, 11], 160),
    P(3, 'Syndra', 'MIDDLE', 'SOLO', [6655], [4, 12], 250),
    P(4, 'Sivir', 'BOTTOM', 'CARRY', [6672], [4, 7], 280),
    P(5, 'Leona', 'BOTTOM', 'SUPPORT', [3068, 3047], [4, 12], 190),
  ],
};

test('LoL role: support item beats the client lane guess; roles are unique per team', () => {
  const g = normalizeGame(game, 'p1');
  assert.equal(g.me.role, 'UTILITY', 'Malphite mit Support-Item war Support, nicht Top');
  const roles = Object.fromEntries(g.parts.map((p) => [p.id, p.role]));
  assert.deepEqual(roles, { 1: 'UTILITY', 2: 'JUNGLE', 3: 'MIDDLE', 4: 'BOTTOM', 5: 'TOP' });
});

test('LoL role: Riot match-v5 teamPosition stays authoritative', () => {
  const v5 = { info: { gameId: 2, gameDuration: 1800, participants: [
    { participantId: 1, puuid: 'a', teamId: 100, championName: 'Malphite', teamPosition: 'TOP', individualPosition: 'TOP', item0: 3870, summoner1Id: 4, summoner2Id: 14, totalMinionsKilled: 200 },
  ] }, metadata: { matchId: 'EUW1_2' } };
  assert.equal(normalizeGame(v5, 'a').me.role, 'TOP');
});

test('LoL role: positions in minutes 3–10 decide when there are no item/spell hints', () => {
  const frames = Array.from({ length: 12 }, (_, m) => ({ timestamp: m * 60000, participantFrames: { 1: { participantId: 1, position: { x: 1200, y: 9000 } } } }));
  const g2 = structuredClone(game); g2.participants[0] = P(1, 'Malphite', 'BOTTOM', 'SUPPORT', [3047], [4, 14], 200);
  g2.participants[4] = P(5, 'Leona', 'BOTTOM', 'SUPPORT', [3870], [4, 14], 30);
  const g = normalizeGame(g2, 'p1', frames);
  assert.equal(g.me.role, 'TOP');
});
