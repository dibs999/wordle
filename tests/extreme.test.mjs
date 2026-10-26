// Tests für die Extrem-Modi: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTREME_VARIANTS,
  EXTREME_KEYS,
  evaluateGuess,
  newExtremeGame,
  playExtremeGuess,
  devilCandidates,
  devilRespond,
  liarFeedback,
  mastermindCounts,
  extremeKeyboardStates,
  extremeShareGrid,
  normalizeProfileData,
  mergeProfileData,
  emptyProfileData,
  recordEndlessResult,
} from '../js/game.js';
import { SOLUTIONS } from '../js/words.js';

// Reproduzierbarer Zufall für die Tests.
function seeded(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

test('Teufel weicht aus und bleibt mit allen gezeigten Farben vereinbar', () => {
  const game = newExtremeGame('devil', SOLUTIONS, seeded(1));
  assert.equal(game.answer, null);
  for (const guess of ['RENAL', 'THEKE', 'PIEZO']) {
    const before = devilCandidates(game, SOLUTIONS).length;
    playExtremeGuess(game, guess, SOLUTIONS);
    const after = devilCandidates(game, SOLUTIONS);
    assert.ok(after.length > 0 && after.length <= before);
    // Jedes verbliebene Wort erzeugt genau die gezeigten Farben.
    for (const word of after) {
      game.guesses.forEach((g, i) => assert.deepEqual(evaluateGuess(g, word), game.feedback[i]));
    }
  }
  assert.equal(game.status, 'playing');
});

test('Teufel lässt nicht gewinnen, solange noch ein anderes Wort passt', () => {
  const [a, b] = ['KATZE', 'TATZE'];
  const { states } = devilRespond('KATZE', [a, b]);
  assert.ok(!states.every((s) => s === 'correct'), 'bei Gleichstand nicht den Sieg wählen');
  const single = devilRespond('KATZE', ['KATZE']);
  assert.ok(single.states.every((s) => s === 'correct'));
});

test('Teufel: Sieg, wenn nur noch das geratene Wort übrig ist', () => {
  const game = newExtremeGame('devil', ['KATZE'], seeded(2));
  const { won } = playExtremeGuess(game, 'KATZE', ['KATZE']);
  assert.equal(won, true);
  assert.equal(game.status, 'won');
  assert.equal(game.answer, 'KATZE');
});

test('Teufel: nach dem letzten Versuch gibt es ein mögliches Lösungswort', () => {
  const game = newExtremeGame('devil', SOLUTIONS, seeded(3));
  for (const guess of ['XYLEM', 'QUARK', 'JUXEN', 'FJORD', 'ZWICK', 'PFAHL', 'BEBOP', 'GUMMI']) {
    if (game.status !== 'playing') break;
    playExtremeGuess(game, guess, SOLUTIONS);
  }
  if (game.status === 'lost') {
    assert.ok(SOLUTIONS.includes(game.answer));
    assert.ok(game.remainingAtEnd >= 1);
  }
});

test('Lügner: genau eine Kachel ist falsch und nie sieht alles grün aus', () => {
  const random = seeded(4);
  for (const [guess, answer] of [['SONNE', 'TONNE'], ['APFEL', 'ESSEN'], ['BLUSE', 'BLUME'], ['TONNE', 'SONNE']]) {
    for (let i = 0; i < 50; i++) {
      const truth = evaluateGuess(guess, answer);
      const shown = liarFeedback(truth, random);
      assert.equal(shown.filter((s, k) => s !== truth[k]).length, 1);
      assert.ok(!shown.every((s) => s === 'correct'));
    }
  }
});

test('Lügner: der Siegversuch wird ehrlich gezeigt', () => {
  const game = newExtremeGame('liar', ['APFEL'], seeded(5));
  const { feedback, won } = playExtremeGuess(game, 'APFEL', ['APFEL']);
  assert.equal(won, true);
  assert.ok(feedback.every((s) => s === 'correct'));
});

test('Blind zeigt kein Gelb', () => {
  const game = newExtremeGame('blind', ['TONNE'], seeded(6));
  const { feedback } = playExtremeGuess(game, 'NOTEN', ['TONNE']);
  assert.ok(!feedback.includes('present'));
  assert.deepEqual(extremeKeyboardStates(game), {});
});

test('Mastermind zählt richtig', () => {
  assert.deepEqual(mastermindCounts('SONNE', 'TONNE'), { correct: 4, present: 0 });
  assert.deepEqual(mastermindCounts('NOTEN', 'TONNE'), { correct: 1, present: 4 });
  assert.deepEqual(mastermindCounts('APFEL', 'TISCH'), { correct: 0, present: 0 });
  const game = newExtremeGame('mastermind', ['TONNE'], seeded(7));
  playExtremeGuess(game, 'SONNE', ['TONNE']);
  assert.equal(extremeShareGrid(game), '🟩 4  🟨 0');
});

test('Versuche je Variante und Verlieren nach dem letzten Versuch', () => {
  for (const key of ['liar', 'blind', 'mastermind']) {
    const game = newExtremeGame(key, ['TONNE'], seeded(8));
    for (let i = 0; i < EXTREME_VARIANTS[key].maxGuesses; i++) playExtremeGuess(game, 'SONNE', ['TONNE']);
    assert.equal(game.status, 'lost', key);
    assert.equal(game.guesses.length, EXTREME_VARIANTS[key].maxGuesses);
  }
});

test('Extrem-Statistik mit 8 Versuchen', () => {
  const stats = recordEndlessResult(emptyProfileData().extremeStats.devil, true, 8);
  assert.equal(stats.dist.length, 8);
  assert.equal(stats.dist[7], 1);
});

test('Extrem-Spielstände überstehen Normalisieren und Zusammenführen', () => {
  const local = emptyProfileData();
  local.extreme.liar = newExtremeGame('liar', SOLUTIONS, seeded(9));
  playExtremeGuess(local.extreme.liar, 'SONNE', SOLUTIONS, seeded(10));
  local.settings.extremeVariant = 'liar';

  const remote = emptyProfileData();
  remote.extreme.devil = newExtremeGame('devil', SOLUTIONS, seeded(11));
  playExtremeGuess(remote.extreme.devil, 'RENAL', SOLUTIONS);

  const normalized = normalizeProfileData(JSON.parse(JSON.stringify(local)));
  assert.deepEqual(normalized.extreme.liar, local.extreme.liar);
  assert.equal(normalized.settings.extremeVariant, 'liar');

  const merged = mergeProfileData(remote, local);
  assert.equal(merged.extreme.liar.guesses.length, 1);
  assert.equal(merged.extreme.devil.guesses.length, 1);
  for (const key of EXTREME_KEYS) assert.ok(merged.extremeStats[key]);

  // Kaputte Einträge werden verworfen statt das Spiel abstürzen zu lassen.
  const broken = normalizeProfileData({ extreme: { liar: { variant: 'liar', guesses: 'x' } }, settings: { extremeVariant: '??' } });
  assert.equal(broken.extreme.liar, undefined);
  assert.equal(broken.settings.extremeVariant, 'devil');
});
