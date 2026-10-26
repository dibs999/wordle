// Tests für die Blitz-Statistik und -Wertung: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProfileData,
  normalizeProfileData,
  mergeProfileData,
  achievements,
  blitzPoints,
  blitzTimeBonus,
  recordBlitzRun,
  blitzRanking,
} from '../js/game.js';

test('Blitz-Statistik: Bestwerte und Anzahl der Durchgänge werden übernommen', () => {
  const remote = emptyProfileData();
  remote.blitzStats = { best: 7, runs: 3, words: 0, bestScore: 120 };
  const local = emptyProfileData();
  local.blitzStats = { best: 4, runs: 5, words: 0, bestScore: 310 };
  const merged = mergeProfileData(remote, local);
  assert.deepEqual(merged.blitzStats, { best: 7, runs: 5, words: 0, bestScore: 310 });
});

test('Blitz-Statistik fehlt in älteren Profilen: wird mit 0 ergänzt', () => {
  const data = normalizeProfileData({ stats: { daily: { played: 1 } } });
  assert.deepEqual(data.blitzStats, { best: 0, runs: 0, words: 0, bestScore: 0 });
  const broken = normalizeProfileData({ blitzStats: { best: 'viele' } });
  assert.equal(broken.blitzStats.best, 0);
  assert.equal(broken.blitzStats.bestScore, 0);
});

test('Abzeichen für zehn Wörter im Blitz', () => {
  const data = emptyProfileData();
  data.blitzStats.best = 10;
  const blitz = achievements(data).find((a) => a.id === 'blitz-10');
  assert.equal(blitz.earned, true);
});

test('weniger Versuche geben mehr Punkte und mehr Extrazeit', () => {
  for (let guesses = 1; guesses < 6; guesses++) {
    assert.ok(blitzPoints(guesses) > blitzPoints(guesses + 1), `Punkte bei ${guesses}`);
    assert.ok(blitzTimeBonus(guesses) > blitzTimeBonus(guesses + 1), `Zeit bei ${guesses}`);
  }
  assert.equal(blitzPoints(7), 0, 'mehr als sechs Versuche gibt es nicht');
  assert.equal(blitzTimeBonus(7), 0);
});

test('Kombo: ab dem zweiten Wort in Folge +10, höchstens +50', () => {
  assert.equal(blitzPoints(4, 1), blitzPoints(4));
  assert.equal(blitzPoints(4, 2) - blitzPoints(4, 1), 10);
  assert.equal(blitzPoints(4, 6) - blitzPoints(4, 1), 50);
  assert.equal(blitzPoints(4, 20) - blitzPoints(4, 1), 50);
});

test('ein Durchgang erhöht Bestwerte nur, wenn er besser war', () => {
  let stats = emptyProfileData().blitzStats;
  stats = recordBlitzRun(stats, { score: 150, words: 3 });
  stats = recordBlitzRun(stats, { score: 90, words: 4 });
  assert.deepEqual(stats, { best: 4, runs: 2, words: 7, bestScore: 150 });
});

test('Blitz-Rangliste nach Punkten, bei Gleichstand nach Wörtern', () => {
  const profile = (id, bestScore, best) => {
    const data = emptyProfileData();
    data.blitzStats = { ...data.blitzStats, bestScore, best, runs: 1 };
    return { id, name: id, data };
  };
  const rows = blitzRanking([profile('a', 100, 2), profile('b', 240, 4), profile('c', 100, 3)]);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'c', 'a']);
});
