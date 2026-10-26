// Tests für das Zusammenführen von Spielständen zweier Geräte: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProfileData,
  emptyStats,
  normalizeProfileData,
  mergeProfileData,
  mergeCounts,
  countsSnapshot,
  recordDailyResult,
  recordEndlessResult,
  newExtremeGame,
  playExtremeGuess,
  devilGameStale,
} from '../js/game.js';
import { SOLUTIONS } from '../js/words.js';

function played(stats, results) {
  return results.reduce((s, [won, guesses]) => recordEndlessResult(s, won, guesses), stats);
}

test('Runden beider Geräte seit dem gemeinsamen Stand werden addiert', () => {
  const base = played(emptyStats(), [[true, 3]]);
  const remote = played(base, [[true, 2]]); // anderes Gerät: Sieg in 2
  const local = played(base, [[false, 6]]); // dieses Gerät: Niederlage
  const merged = mergeCounts(remote, local, base);
  assert.equal(merged.played, 3);
  assert.equal(merged.won, 2);
  assert.deepEqual(merged.dist, [0, 1, 1, 0, 0, 0]);
  assert.equal(merged.streak, 0, 'die lokale Niederlage beendet die Serie');
  assert.equal(merged.maxStreak, 2);
});

test('ohne gemeinsamen Stand gilt die Statistik mit mehr Runden', () => {
  const a = played(emptyStats(), [[true, 3]]);
  const b = played(emptyStats(), [[true, 3], [true, 4]]);
  assert.equal(mergeCounts(a, b, null).played, 2);
  assert.equal(mergeCounts(b, a, null).played, 2);
});

test('nur ein Gerät hat gespielt: dessen Statistik gilt, nie eine kleinere', () => {
  const base = played(emptyStats(), [[true, 3]]);
  const local = played(base, [[true, 4]]);
  assert.equal(mergeCounts(base, local, base).played, 2);
  const remote = played(base, [[true, 5]]);
  assert.equal(mergeCounts(remote, base, base).played, 2);
  // Ein zurückgedrehter Server (z. B. durch einen alten Tab) senkt die lokale Zahl nicht.
  assert.equal(mergeCounts(emptyStats(), base, base).played, 1);
});

test('dasselbe Tagesrätsel auf zwei Geräten zählt nur einmal', () => {
  const remote = emptyProfileData();
  const local = emptyProfileData();
  const daily = { day: '2026-10-26', answer: 'APFEL', guesses: ['APFEL'], status: 'won' };
  remote.daily = { ...daily };
  local.daily = { ...daily, guesses: ['LEBEN', 'APFEL'] };
  remote.stats.daily = recordDailyResult(remote.stats.daily, '2026-10-26', true, 1);
  local.stats.daily = recordDailyResult(local.stats.daily, '2026-10-26', true, 2);
  const merged = mergeProfileData(remote, local, countsSnapshot(emptyProfileData()));
  assert.equal(merged.stats.daily.played, 1);
});

test('Extrem-Statistik von beiden Geräten wird addiert', () => {
  const base = emptyProfileData();
  const remote = emptyProfileData();
  const local = emptyProfileData();
  remote.extremeStats.liar = recordEndlessResult(remote.extremeStats.liar, true, 7);
  local.extremeStats.liar = recordEndlessResult(local.extremeStats.liar, true, 8);
  const merged = mergeProfileData(remote, local, countsSnapshot(base));
  assert.equal(merged.extremeStats.liar.played, 2);
  assert.equal(merged.extremeStats.liar.dist[6], 1);
  assert.equal(merged.extremeStats.liar.dist[7], 1);
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
