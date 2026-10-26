// Tests für das Zusammenführen von Spielständen zweier Geräte: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProfileData,
  normalizeProfileData,
  mergeProfileData,
  recordEndlessResult,
  recordDailyResult,
  newExtremeGame,
  playExtremeGuess,
  devilGameStale,
} from '../js/game.js';
import { SOLUTIONS } from '../js/words.js';

function withEndless(results) {
  const data = emptyProfileData();
  for (const [won, guesses] of results) data.stats.endless = recordEndlessResult(data.stats.endless, won, guesses);
  return data;
}

test('Statistik: der Stand mit mehr gespielten Runden gilt, Runden werden nicht addiert', () => {
  // Beide Geräte haben dieselbe Runde gesehen und dann jeweils eine eigene gespielt.
  const remote = withEndless([[true, 3], [true, 2]]);
  const local = withEndless([[true, 3], [false, 6]]);
  const merged = mergeProfileData(remote, local);
  assert.equal(merged.stats.endless.played, 2, 'nicht 3: keine Doppelzählung');
});

test('Statistik: ein älterer Stand des Servers senkt die lokale Zahl nie', () => {
  const local = withEndless([[true, 3], [true, 4]]);
  const remote = withEndless([[true, 3]]);
  assert.equal(mergeProfileData(remote, local).stats.endless.played, 2);
  assert.equal(mergeProfileData(local, remote).stats.endless.played, 2);
});

test('dasselbe Tagesrätsel auf zwei Geräten zählt nur einmal', () => {
  const remote = emptyProfileData();
  const local = emptyProfileData();
  remote.stats.daily = recordDailyResult(remote.stats.daily, '2026-10-26', true, 1);
  local.stats.daily = recordDailyResult(local.stats.daily, '2026-10-26', true, 2);
  const merged = mergeProfileData(remote, local);
  assert.equal(merged.stats.daily.played, 1);
});

test('Extrem-Statistik: je Variante der Stand mit mehr Runden', () => {
  const remote = emptyProfileData();
  const local = emptyProfileData();
  remote.extremeStats.liar = recordEndlessResult(remote.extremeStats.liar, true, 7);
  local.extremeStats.liar = recordEndlessResult(local.extremeStats.liar, true, 8);
  local.extremeStats.liar = recordEndlessResult(local.extremeStats.liar, true, 8);
  const merged = mergeProfileData(remote, local);
  assert.equal(merged.extremeStats.liar.played, 2);
  assert.equal(merged.extremeStats.liar.dist[7], 2);
});

test('kurzzeitig unter stats.extreme gespeicherte Statistik wird übernommen', () => {
  const legacy = { stats: { extreme: { devil: { played: 4, won: 3, streak: 1, maxStreak: 2, dist: [0, 0, 0, 1, 1, 1, 0, 0] } } } };
  const data = normalizeProfileData(legacy);
  assert.equal(data.extremeStats.devil.played, 4);
  assert.equal('extreme' in data.stats, false);
  // Neuere Statistik unter extremeStats hat Vorrang, wenn sie mehr Runden enthält.
  const both = normalizeProfileData({ ...legacy, extremeStats: { devil: { played: 6, won: 5, dist: [0, 0, 0, 2, 2, 1, 0, 0] } } });
  assert.equal(both.extremeStats.devil.played, 6);
});

test('ein Tab mit älterer App-Version behält die Extrem-Statistik', () => {
  // So hat die Vorversion Profildaten zusammengeführt: "stats" neu aufgebaut, Rest übernommen.
  const oldMerge = (remote, local) => ({ ...remote, ...local, stats: { daily: local.stats.daily, endless: local.stats.endless } });
  const data = emptyProfileData();
  data.extremeStats.blind = recordEndlessResult(data.extremeStats.blind, true, 4);
  const afterOldTab = oldMerge(data, JSON.parse(JSON.stringify(data)));
  assert.equal(normalizeProfileData(afterOldTab).extremeStats.blind.played, 1);
});

test('Teufels-Spiel ohne passendes Wort nach Änderung der Wortliste wird erkannt', () => {
  const game = newExtremeGame('devil', SOLUTIONS);
  playExtremeGuess(game, 'SONNE', SOLUTIONS);
  assert.equal(devilGameStale(game, SOLUTIONS), false);
  assert.equal(devilGameStale(game, ['XXXXX']), true);
  assert.equal(devilGameStale(newExtremeGame('devil', SOLUTIONS), ['XXXXX']), false, 'ohne Versuche ist nichts veraltet');
});
