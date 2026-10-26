// Kleine Töne, die der Browser selbst erzeugt, ganz ohne Audiodateien.
// Ausgeschaltet wird über den Schalter in den Einstellungen (wird pro Gerät gespeichert).

const SOUND_KEY = 'wordle-de:sound';
const MASTER_GAIN = 0.2;

// Der Audiokontext entsteht erst bei der ersten Tasteneingabe oder dem ersten Klick,
// weil Browser Töne ohne Nutzeraktion sonst blockieren.
let context = null;
let master = null;

export function isSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled) {
  try {
    if (enabled) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, 'off');
  } catch {
    // Privater Modus o. Ä.: Einstellung gilt dann nur bis zum Neuladen.
  }
}

function audio() {
  if (!isSoundEnabled()) return null;
  try {
    if (!context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') context.resume();
    return context;
  } catch {
    return null;
  }
}

// Ein kurzer Ton mit weichem Ein- und Ausklingen.
function tone(ctx, { freq, end = freq, type = 'sine', at = 0, duration = 0.12, volume = 0.5 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(end, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// Klick beim Tippen.
export function playTap() {
  const ctx = audio();
  if (ctx) tone(ctx, { freq: 620, end: 480, type: 'triangle', duration: 0.05, volume: 0.35 });
}

// Farbe beim Aufdecken: grün hoch, gelb mittel, grau tief. "locked" ist der neutrale Ton (Mastermind).
const FLIP_TONE = { correct: 784, present: 587, absent: 330, locked: 466 };

export function playFlip(state) {
  const ctx = audio();
  if (ctx) tone(ctx, { freq: FLIP_TONE[state] || FLIP_TONE.locked, duration: 0.16, volume: 0.45 });
}

// Kurzes Brummen bei einem ungültigen Versuch.
export function playInvalid() {
  const ctx = audio();
  if (ctx) {
    tone(ctx, { freq: 170, end: 150, type: 'square', duration: 0.12, volume: 0.15 });
    tone(ctx, { freq: 170, end: 150, type: 'square', at: 0.14, duration: 0.12, volume: 0.15 });
  }
}

// Aufsteigender Dreiklang beim Sieg.
const WIN_NOTES = [523, 659, 784, 1047];

export function playWin() {
  const ctx = audio();
  if (ctx) {
    WIN_NOTES.forEach((freq, i) => tone(ctx, { freq, type: 'triangle', at: i * 0.11, duration: 0.3, volume: 0.5 }));
  }
}

// Absteigende Töne bei einer Niederlage.
const LOSE_NOTES = [392, 330, 262];

export function playLose() {
  const ctx = audio();
  if (ctx) {
    LOSE_NOTES.forEach((freq, i) => tone(ctx, { freq, at: i * 0.22, duration: 0.35, volume: 0.45 }));
  }
}
