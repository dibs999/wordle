// Tests für Rangliste und Dauer einer Runde: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyRanking, streakRanking, durationMs, formatDuration, emptyProfileData, recordDailyResult } from '../js/game.js';

const DAY = '2026-10-26';

function profile(name, daily, stats) {
  const data = emptyProfileData();
  if (daily) data.daily = daily;
  if (stats) data.stats.daily = stats;
  return { name, data };
}

const won = (guesses, startedAt, finishedAt) => ({
  day: DAY,
  answer: 'APFEL',
  guesses: Array(guesses).fill('LEBEN'),
  status: 'won',
  startedAt,
  finishedAt,
});

test('Dauer einer Runde und Anzeige im Format m:ss', () => {
  assert.equal(durationMs(won(3, 1000, 85000)), 84000);
  assert.equal(durationMs({ status: 'won' }), null);
  assert.equal(formatDuration(84000), '1:24');
  assert.equal(formatDuration(5000), '0:05');
  assert.equal(formatDuration(null), '');
});

test('Tagesrangliste: gewonnen vor verloren, wenige Versuche und schnelle zuerst', () => {
  const ranking = dailyRanking(
    [
      profile('Lena', { day: DAY, answer: 'APFEL', guesses: ['A', 'B', 'C'], status: 'lost' }),
      profile('Papa', won(4, 0, 60000)),
      profile('Oma', won(3, 0, 120000)),
      profile('Max', won(3, 0, 40000)),
      profile('Emil', { day: DAY, answer: 'APFEL', guesses: ['LEBEN'], status: 'playing' }),
      profile('Ida', null),
    ],
    DAY,
  );
  assert.deepEqual(
    ranking.map((r) => r.name),
    ['Max', 'Oma', 'Papa', 'Lena', 'Emil', 'Ida'],
  );
});

test('Gestern gespielte Runden zählen heute nicht', () => {
  const ranking = dailyRanking([profile('Alt', { ...won(2, 0, 1000), day: '2026-10-25' })], DAY);
  assert.equal(ranking[0].tier, 3);
});

test('Serien-Rangliste: längste aktuelle Serie zuerst', () => {
  let streakA = recordDailyResult(emptyProfileData().stats.daily, '2026-10-25', true, 2);
  streakA = recordDailyResult(streakA, DAY, true, 3);
  const streakB = recordDailyResult(emptyProfileData().stats.daily, DAY, true, 4);
  const ranking = streakRanking(
    [profile('Anna', null, streakB), profile('Ben', null, streakA), profile('Cem', null, null)],
    DAY,
  );
  assert.deepEqual(
    ranking.map((r) => [r.name, r.streak]),
    [
      ['Ben', 2],
      ['Anna', 1],
      ['Cem', 0],
    ],
  );
});
