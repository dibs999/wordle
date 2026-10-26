// Tests für die Abzeichen: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_GROUPS,
  achievements,
  unlockAchievements,
  recordWinTime,
  emptyProfileData,
  normalizeProfileData,
  mergeProfileData,
  recordDailyResult,
  recordEndlessResult,
  EXTREME_KEYS,
} from '../js/game.js';

const earnedIds = (data) => achievements(data).filter((a) => a.earned).map((a) => a.id);

test('jedes Abzeichen hat Gruppe, Stufe, Ziel und eindeutige Kennung', () => {
  const groups = new Set(ACHIEVEMENT_GROUPS.map((g) => g.id));
  const ids = new Set();
  for (const a of ACHIEVEMENTS) {
    assert.ok(groups.has(a.group), a.id);
    assert.ok(['bronze', 'silver', 'gold'].includes(a.tier), a.id);
    assert.ok(a.target >= 1, a.id);
    assert.ok(!ids.has(a.id), `doppelt: ${a.id}`);
    ids.add(a.id);
  }
  assert.equal(ACHIEVEMENTS.length, 25);
});

test('neues Profil hat kein Abzeichen, aber Fortschritt 0 von Ziel', () => {
  const list = achievements(emptyProfileData());
  assert.deepEqual(earnedIds(emptyProfileData()), []);
  const wins = list.find((a) => a.id === 'win-25');
  assert.equal(wins.progress, 0);
  assert.equal(wins.target, 25);
});

test('Freischalten speichert das Datum und meldet nur neue Abzeichen', () => {
  const data = emptyProfileData();
  data.stats.endless = recordEndlessResult(data.stats.endless, true, 1);
  const first = unlockAchievements(data, '2026-10-26T10:00:00.000Z');
  assert.deepEqual(first.map((a) => a.id).sort(), ['one-guess', 'win-1']);
  assert.equal(data.achievements['win-1'], '2026-10-26T10:00:00.000Z');
  assert.deepEqual(unlockAchievements(data, '2026-10-27T10:00:00.000Z'), [], 'nichts doppelt melden');
  assert.equal(achievements(data).find((a) => a.id === 'win-1').earnedAt, '2026-10-26T10:00:00.000Z');
});

test('ein gespeichertes Abzeichen bleibt, auch wenn die Statistik kleiner wird', () => {
  const data = emptyProfileData();
  data.achievements['streak-7'] = '2026-10-20T08:00:00.000Z';
  assert.ok(earnedIds(data).includes('streak-7'));
});

test('Tagesserien und Fortschritt', () => {
  const data = emptyProfileData();
  let stats = data.stats.daily;
  for (let i = 0; i < 5; i++) stats = recordDailyResult(stats, `2026-10-${String(20 + i).padStart(2, '0')}`, true, 4);
  data.stats.daily = stats;
  const ids = earnedIds(data);
  assert.ok(ids.includes('streak-3'));
  assert.ok(!ids.includes('streak-7'));
  assert.equal(achievements(data).find((a) => a.id === 'streak-7').progress, 5);
});

test('Extrem: jede Variante einzeln, „Alle Extreme“ zählt die Varianten', () => {
  const data = emptyProfileData();
  data.extremeStats.devil = recordEndlessResult(data.extremeStats.devil, true, 7);
  assert.equal(achievements(data).find((a) => a.id === 'all-extreme').progress, 1);
  for (const key of EXTREME_KEYS) data.extremeStats[key] = recordEndlessResult(data.extremeStats[key], true, 5);
  const ids = earnedIds(data);
  assert.ok(ids.includes('all-extreme'));
  assert.ok(ids.includes('liar') && ids.includes('blind') && ids.includes('mastermind'));
});

test('Schnelldenker über die schnellste gespeicherte Lösung', () => {
  const data = emptyProfileData();
  recordWinTime(data, 95_000);
  assert.ok(!earnedIds(data).includes('fast'));
  recordWinTime(data, 42_000);
  recordWinTime(data, 80_000);
  assert.equal(data.records.fastestWinMs, 42_000);
  assert.ok(earnedIds(data).includes('fast'));
});

test('Abzeichen und Rekorde zweier Geräte werden vereinigt (frühestes Datum, bester Wert)', () => {
  const remote = emptyProfileData();
  remote.achievements = { 'win-1': '2026-10-20T00:00:00.000Z', 'devil': '2026-10-22T00:00:00.000Z' };
  remote.records.fastestWinMs = 50_000;
  const local = emptyProfileData();
  local.achievements = { 'win-1': '2026-10-18T00:00:00.000Z', 'blitz-3': '2026-10-25T00:00:00.000Z' };
  local.records.fastestWinMs = 70_000;
  const merged = mergeProfileData(remote, local);
  assert.deepEqual(merged.achievements, {
    'win-1': '2026-10-18T00:00:00.000Z',
    'devil': '2026-10-22T00:00:00.000Z',
    'blitz-3': '2026-10-25T00:00:00.000Z',
  });
  assert.equal(merged.records.fastestWinMs, 50_000);
});

test('ungültige gespeicherte Abzeichen und Rekorde werden verworfen', () => {
  const data = normalizeProfileData({ achievements: { 'win-1': 5, 'devil': '2026-10-22' }, records: { fastestWinMs: -3 } });
  assert.deepEqual(data.achievements, { devil: '2026-10-22' });
  assert.equal(data.records.fastestWinMs, null);
});
