// Tests für die Abzeichen: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { achievements, emptyProfileData, recordDailyResult, recordEndlessResult, EXTREME_KEYS } from '../js/game.js';

const earnedIds = (data) => achievements(data).filter((a) => a.earned).map((a) => a.id);

test('neues Profil hat kein Abzeichen', () => {
  const list = achievements(emptyProfileData());
  assert.equal(list.length, 11);
  assert.deepEqual(earnedIds(emptyProfileData()), []);
});

test('erster Sieg und Volltreffer', () => {
  const data = emptyProfileData();
  data.stats.endless = recordEndlessResult(data.stats.endless, true, 1);
  assert.deepEqual(earnedIds(data), ['first-win', 'one-guess']);
});

test('Tagesserie von sieben Tagen', () => {
  const data = emptyProfileData();
  let stats = data.stats.daily;
  for (let i = 0; i < 7; i++) {
    const day = `2026-10-${String(20 + i).padStart(2, '0')}`;
    stats = recordDailyResult(stats, day, true, 4);
  }
  data.stats.daily = stats;
  const ids = earnedIds(data);
  assert.ok(ids.includes('streak-7'));
  assert.ok(!ids.includes('streak-30'));
  assert.ok(ids.includes('daily-10') === false);
});

test('Extrem-Abzeichen: jede Variante einzeln, Alle erst mit allen vier', () => {
  const data = emptyProfileData();
  data.extremeStats.devil = recordEndlessResult(data.extremeStats.devil, true, 7);
  let ids = earnedIds(data);
  assert.ok(ids.includes('devil'));
  assert.ok(!ids.includes('all-extreme'));
  for (const key of EXTREME_KEYS) data.extremeStats[key] = recordEndlessResult(data.extremeStats[key], true, 5);
  ids = earnedIds(data);
  assert.ok(ids.includes('all-extreme'));
  assert.ok(ids.includes('liar') && ids.includes('blind') && ids.includes('mastermind'));
});

test('Abzeichen mit Beschreibung auch für noch nicht erreichte', () => {
  const locked = achievements(emptyProfileData()).find((a) => a.id === 'streak-30');
  assert.equal(locked.earned, false);
  assert.equal(typeof locked.title, 'string');
  assert.ok(locked.text.includes('30'));
});
