// Tests für die Spiellogik: npm test  (oder: node --test tests/*.test.mjs)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGuess,
  keyboardStates,
  berlinDayKey,
  dayNumber,
  shiftDayKey,
  dailyAnswer,
  recordDailyResult,
  recordEndlessResult,
  currentDailyStreak,
  emptyStats,
  normalizeProfileData,
  mergeProfileData,
  emptyProfileData,
  shareGrid,
} from '../js/game.js';
import { SOLUTIONS, ALLOWED } from '../js/words.js';

test('alle Buchstaben richtig', () => {
  assert.deepEqual(evaluateGuess('APFEL', 'APFEL'), ['correct', 'correct', 'correct', 'correct', 'correct']);
});

test('doppelte Buchstaben werden nur so oft markiert, wie sie vorkommen', () => {
  // Lösung hat ein E, Versuch zwei: nur eins darf gelb sein.
  assert.deepEqual(evaluateGuess('EBENE', 'TRAUM'), ['absent', 'absent', 'absent', 'absent', 'absent']);
  assert.deepEqual(evaluateGuess('EEXXX', 'APFEL'), ['present', 'absent', 'absent', 'absent', 'absent']);
  // Grün hat Vorrang vor Gelb.
  assert.deepEqual(evaluateGuess('LEBEN', 'LESEN'), ['correct', 'correct', 'absent', 'correct', 'correct']);
  assert.deepEqual(evaluateGuess('EBENE', 'ENKEL'), ['correct', 'absent', 'present', 'present', 'absent']);
});

test('Umlaute zählen als ein Buchstabe', () => {
  assert.deepEqual(evaluateGuess('KÖNIG', 'KÖNIG'), Array(5).fill('correct'));
  assert.deepEqual(evaluateGuess('KONIG', 'KÖNIG'), ['correct', 'absent', 'correct', 'correct', 'correct']);
});

test('Tastatur zeigt den besten bekannten Zustand', () => {
  const states = keyboardStates(['LESEN', 'ENKEL'], 'ESSEN');
  assert.equal(states.E, 'correct');
  assert.equal(states.S, 'correct');
  assert.equal(states.L, 'absent');
  assert.equal(states.K, 'absent');
  assert.equal(states.N, 'correct');
});

test('Tageszählung nach deutscher Zeit', () => {
  assert.equal(dayNumber('2026-01-01'), 0);
  assert.equal(dayNumber('2026-10-26'), 298);
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDayKey('2026-03-29', 1), '2026-03-30');
  // 23:30 UTC am 26.10. ist in Berlin schon der 27.10.
  assert.equal(berlinDayKey(new Date('2026-10-26T23:30:00Z')), '2026-10-27');
  assert.equal(berlinDayKey(new Date('2026-10-26T22:59:00Z')), '2026-10-26');
});

test('Tageswort ist fest und wechselt täglich', () => {
  const a = dailyAnswer('2026-10-26', SOLUTIONS);
  assert.equal(dailyAnswer('2026-10-26', SOLUTIONS), a);
  assert.ok(SOLUTIONS.includes(a));
  // Die Liste steht in Tagesreihenfolge: Tag 1 ist das erste Wort.
  assert.equal(dailyAnswer('2026-01-01', SOLUTIONS), SOLUTIONS[0]);
  assert.equal(dailyAnswer(shiftDayKey('2026-01-01', SOLUTIONS.length), SOLUTIONS), SOLUTIONS[0]);
  // Ein angehängtes Wort verschiebt die bisherigen Tage nicht.
  assert.equal(dailyAnswer('2026-10-26', [...SOLUTIONS, 'XXXXX']), a);
  const days = Array.from({ length: 60 }, (_, i) => dailyAnswer(shiftDayKey('2026-10-26', i), SOLUTIONS));
  assert.equal(new Set(days).size, days.length);
});

test('Tagesserie zählt nur aufeinanderfolgende Siege', () => {
  let stats = emptyStats();
  stats = recordDailyResult(stats, '2026-10-24', true, 3);
  stats = recordDailyResult(stats, '2026-10-25', true, 4);
  assert.equal(stats.streak, 2);
  assert.equal(currentDailyStreak(stats, '2026-10-26'), 2);
  assert.equal(currentDailyStreak(stats, '2026-10-27'), 0);
  stats = recordDailyResult(stats, '2026-10-27', true, 2);
  assert.equal(stats.streak, 1);
  assert.equal(stats.maxStreak, 2);
  stats = recordDailyResult(stats, '2026-10-28', false, 6);
  assert.equal(stats.streak, 0);
  assert.equal(stats.played, 4);
  assert.equal(stats.won, 3);
  assert.deepEqual(stats.dist, [0, 1, 1, 1, 0, 0]);
});

test('Endlos-Serie zählt Siege in Folge', () => {
  let stats = emptyStats();
  stats = recordEndlessResult(stats, true, 1);
  stats = recordEndlessResult(stats, true, 6);
  stats = recordEndlessResult(stats, false, 6);
  assert.equal(stats.streak, 0);
  assert.equal(stats.maxStreak, 2);
  assert.deepEqual(stats.dist, [1, 0, 0, 0, 0, 1]);
});

test('kaputte Profildaten werden aufgefüllt', () => {
  const data = normalizeProfileData({ stats: { daily: { played: 3 } } });
  assert.equal(data.stats.daily.played, 3);
  assert.deepEqual(data.stats.endless, emptyStats());
  assert.equal(data.settings.extremeVariant, 'devil');
  assert.equal(normalizeProfileData(null).version, 1);
});

test('ungültige Spielstände werden verworfen', () => {
  const data = normalizeProfileData({ daily: { day: 5, guesses: 'x' }, endless: { answer: 'APFEL', guesses: ['LEBEN', 3], status: '?' } });
  assert.equal(data.daily, null);
  assert.deepEqual(data.endless.guesses, ['LEBEN']);
  assert.equal(data.endless.status, 'playing');
});

test('Zusammenführen zweier Geräte verliert keine Runde', () => {
  const remote = emptyProfileData();
  remote.daily = { day: '2026-10-26', answer: 'APFEL', guesses: ['LEBEN', 'APFEL'], status: 'won' };
  remote.stats.daily = recordDailyResult(remote.stats.daily, '2026-10-26', true, 2);
  remote.endless = { answer: 'TISCH', guesses: [], status: 'playing' };

  // Veraltetes Gerät: Tagesrätsel von gestern, dafür eine laufende Endlos-Runde.
  const local = emptyProfileData();
  local.daily = { day: '2026-10-25', answer: 'BLUME', guesses: ['BLUME'], status: 'won' };
  local.endless = { answer: 'KATZE', guesses: ['KANNE'], status: 'playing' };
  local.settings.extremeVariant = 'liar';

  const merged = mergeProfileData(remote, local);
  assert.equal(merged.daily.day, '2026-10-26');
  assert.equal(merged.daily.status, 'won');
  assert.equal(merged.stats.daily.played, 1);
  assert.equal(merged.endless.answer, 'KATZE');
  assert.equal(merged.settings.extremeVariant, 'liar');

  // Gleiches Spiel: der weiter fortgeschrittene Stand gewinnt.
  const a = emptyProfileData();
  a.daily = { day: '2026-10-26', answer: 'APFEL', guesses: ['LEBEN'], status: 'playing' };
  const b = emptyProfileData();
  b.daily = { day: '2026-10-26', answer: 'APFEL', guesses: ['LEBEN', 'ESSEN'], status: 'playing' };
  assert.equal(mergeProfileData(b, a).daily.guesses.length, 2);
  assert.equal(mergeProfileData(a, b).daily.guesses.length, 2);
});

test('Teilen-Raster', () => {
  assert.equal(shareGrid(['LESEN', 'ESSEN'], 'ESSEN'), '⬛🟨🟩🟩🟩\n🟩🟩🟩🟩🟩');
});

test('Wortlisten sind gültig', () => {
  const valid = (w) => /^[A-ZÄÖÜ]+$/.test(w) && Array.from(w).length === 5;
  assert.ok(SOLUTIONS.length >= 300, `nur ${SOLUTIONS.length} Lösungswörter`);
  assert.deepEqual(SOLUTIONS.filter((w) => !valid(w)), []);
  assert.deepEqual(ALLOWED.filter((w) => !valid(w)), []);
  assert.equal(new Set(SOLUTIONS).size, SOLUTIONS.length);
  const allowed = new Set(ALLOWED);
  assert.deepEqual(SOLUTIONS.filter((w) => !allowed.has(w)), []);
});
