// Tests für die Töne: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

// Ein Speicher wie localStorage, damit der Schalter ohne Browser geprüft werden kann.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const sound = await import('../js/sound.js');

test('Töne sind standardmäßig an', () => {
  assert.equal(sound.isSoundEnabled(), true);
});

test('Stummschalten wird gespeichert und wieder aufgehoben', () => {
  sound.setSoundEnabled(false);
  assert.equal(sound.isSoundEnabled(), false);
  assert.equal(storage.get('wordle-de:sound'), 'off');
  sound.setSoundEnabled(true);
  assert.equal(sound.isSoundEnabled(), true);
  assert.equal(storage.has('wordle-de:sound'), false);
});

test('ohne Audio-Unterstützung läuft nichts und wirft keinen Fehler', () => {
  assert.doesNotThrow(() => {
    sound.playTap();
    sound.playFlip('correct');
    sound.playFlip('absent');
    sound.playInvalid();
    sound.playWin();
    sound.playLose();
  });
});

test('stummgeschaltet wird gar nicht erst versucht zu spielen', () => {
  sound.setSoundEnabled(false);
  assert.doesNotThrow(() => sound.playWin());
  sound.setSoundEnabled(true);
});
