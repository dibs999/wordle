// Tests für Hinweis und Blitz-Statistik: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hintPosition,
  emptyProfileData,
  normalizeProfileData,
  mergeProfileData,
  achievements,
} from '../js/game.js';

test('Hinweis zeigt eine Stelle, die noch nicht richtig geraten ist', () => {
  // Stelle 0 (T) und 1 (I) sind schon richtig geraten, offen sind nur 2, 3, 4.
  const game = { answer: 'TISCH', guesses: ['TIGER'] };
  for (let i = 0; i < 50; i++) {
    const pos = hintPosition(game);
    assert.ok([2, 3, 4].includes(pos), `Position ${pos} ist schon bekannt`);
  }
});

test('Hinweis fällt auf eine beliebige Stelle zurück, wenn schon alles bekannt ist', () => {
  const game = { answer: 'TISCH', guesses: ['TISCH'] };
  const pos = hintPosition(game, () => 0);
  assert.equal(pos, 0);
});

test('Blitz-Statistik: Bestwert und Anzahl der Durchgänge werden übernommen', () => {
  const remote = emptyProfileData();
  remote.blitzStats = { best: 7, runs: 3 };
  const local = emptyProfileData();
  local.blitzStats = { best: 4, runs: 5 };
  const merged = mergeProfileData(remote, local);
  assert.deepEqual(merged.blitzStats, { best: 7, runs: 5 });
});

test('Blitz-Statistik fehlt in älteren Profilen: wird mit 0 ergänzt', () => {
  const data = normalizeProfileData({ stats: { daily: { played: 1 } } });
  assert.deepEqual(data.blitzStats, { best: 0, runs: 0 });
  const broken = normalizeProfileData({ blitzStats: { best: 'viele' } });
  assert.equal(broken.blitzStats.best, 0);
});

test('Abzeichen für zehn Wörter im Blitz', () => {
  const data = emptyProfileData();
  data.blitzStats.best = 10;
  const blitz = achievements(data).find((a) => a.id === 'blitz-10');
  assert.equal(blitz.earned, true);
});
