// Töne, die der Browser selbst erzeugt, ganz ohne Audiodateien: Marimba-Schläge beim Aufdecken,
// Glockenklänge bei Sieg und Abzeichen, dazu etwas Raumhall.
// Ausgeschaltet wird über den Schalter in den Einstellungen (wird pro Gerät gespeichert).

const SOUND_KEY = 'wordle-de:sound';
const MASTER_GAIN = 0.5;
const REVERB_SECONDS = 1.8;

// Obertöne als [Verhältnis zum Grundton, Lautstärke, Anteil an der Ausklingzeit].
const MARIMBA = [
  [1, 1, 1],
  [3.93, 0.32, 0.22],
  [9.2, 0.1, 0.07],
];
const BELL = [
  [1, 1, 1],
  [2, 0.45, 0.6],
  [2.76, 0.3, 0.45],
  [5.4, 0.14, 0.22],
  [8.93, 0.06, 0.12],
];
const WOOD = [
  [1, 1, 1],
  [2.71, 0.35, 0.4],
];

// Der Audiokontext entsteht erst bei der ersten Tasteneingabe oder dem ersten Klick,
// weil Browser Töne ohne Nutzeraktion sonst blockieren.
let context = null;
let master = null; // trockenes Signal, geht über einen sanften Kompressor zum Lautsprecher
let reverb = null; // Eingang des Halls
let noise = null; // Rauschen für Anschlag- und Klickgeräusche

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

// Nachhall aus abklingendem Rauschen, für jeden Kanal etwas anders (wirkt räumlich).
function impulse(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

function noiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function setup(ctx) {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.25;
  compressor.connect(ctx.destination);

  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(compressor);

  const convolver = ctx.createConvolver();
  convolver.buffer = impulse(ctx, REVERB_SECONDS);
  // Der Hall klingt weich: die hohen Anteile werden vorher etwas abgedämpft.
  const damping = ctx.createBiquadFilter();
  damping.type = 'lowpass';
  damping.frequency.value = 5200;
  reverb = ctx.createGain();
  reverb.connect(damping).connect(convolver).connect(master);

  noise = noiseBuffer(ctx);
}

function audio() {
  if (!isSoundEnabled()) return null;
  try {
    if (!context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      setup(ctx);
      context = ctx;
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

// Ausgang für einen Klang: etwas nach links oder rechts gerückt und mit einem Anteil Hall.
function output(ctx, { pan = 0, space = 0.2, volume = 1 } = {}) {
  const node = ctx.createGain();
  node.gain.value = volume;
  let tail = node;
  if (pan && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    tail = node.connect(panner);
  }
  tail.connect(master);
  if (space > 0) {
    const send = ctx.createGain();
    send.gain.value = space;
    tail.connect(send).connect(reverb);
  }
  return node;
}

// Angeschlagener Ton wie bei Marimba oder Glocke: Grundton plus schneller verklingende Obertöne.
function strike(ctx, out, { freq, at = 0, duration = 0.5, volume = 0.5, partials = MARIMBA }) {
  const start = ctx.currentTime + at;
  for (const [ratio, level, share] of partials) {
    const pitch = freq * ratio;
    if (pitch > ctx.sampleRate / 2.2) continue;
    const length = Math.max(0.03, duration * share);
    const osc = ctx.createOscillator();
    osc.frequency.value = pitch;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume * level, start + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }
}

// Kurzes, gefiltertes Rauschen: Anschlag eines Schlegels, Klick einer Taste, Holzblock.
function click(ctx, out, { at = 0, freq = 2500, q = 1, duration = 0.03, volume = 0.3 }) {
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(out);
  source.start(start, Math.random() * 0.8);
  source.stop(start + duration + 0.02);
}

// Weicher, gehaltener Klang aus zwei leicht verstimmten Oszillatoren hinter einem Tiefpass.
function pad(ctx, out, { freq, at = 0, duration = 1.2, volume = 0.2, cutoff = 2000 }) {
  const start = ctx.currentTime + at;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  filter.Q.value = 0.4;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.25, duration * 0.3));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  filter.connect(gain).connect(out);
  for (const detune of [-8, 8]) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }
}

// Ein paar hohe, leise Glöckchen zufällig im Raum verteilt.
function sparkle(ctx, { at = 0, count = 6, volume = 0.07 }) {
  const notes = [2093, 2349, 2637, 3136, 3520];
  for (let i = 0; i < count; i++) {
    const out = output(ctx, { pan: Math.random() * 1.4 - 0.7, space: 0.5 });
    const freq = notes[Math.floor(Math.random() * notes.length)];
    strike(ctx, out, { freq, at: at + i * 0.065 + Math.random() * 0.03, duration: 0.7, volume, partials: BELL });
  }
}

// Leichter Klick beim Tippen, jedes Mal minimal anders, damit es nicht mechanisch klingt.
export function playTap() {
  const ctx = audio();
  if (!ctx) return;
  const out = output(ctx, { space: 0.04 });
  const vary = 1 + (Math.random() - 0.5) * 0.1;
  click(ctx, out, { freq: 3400 * vary, q: 0.8, duration: 0.022, volume: 0.14 });
  strike(ctx, out, { freq: 1180 * vary, duration: 0.06, volume: 0.1, partials: WOOD });
}

// Beim Aufdecken: grüne Felder spielen eine aufsteigende Tonleiter, gelbe dieselbe eine Oktave tiefer,
// graue einen gedämpften tiefen Ton. Ein ganz grünes Wort klingt so wie eine kleine Melodie.
const CORRECT_NOTES = [784, 880, 1047, 1175, 1319];
const PRESENT_NOTES = [392, 440, 523, 587, 659];

export function playFlip(state, index = 2) {
  const ctx = audio();
  if (!ctx) return;
  const position = Math.max(0, Math.min(4, index));
  const out = output(ctx, { pan: (position - 2) * 0.2, space: state === 'absent' ? 0.08 : 0.22 });
  click(ctx, out, { freq: 1600, q: 0.7, duration: 0.018, volume: 0.07 });
  if (state === 'correct') {
    strike(ctx, out, { freq: CORRECT_NOTES[position], duration: 0.9, volume: 0.32 });
  } else if (state === 'present') {
    strike(ctx, out, { freq: PRESENT_NOTES[position], duration: 0.7, volume: 0.36 });
  } else if (state === 'absent') {
    strike(ctx, out, { freq: 196, duration: 0.22, volume: 0.32, partials: WOOD });
  } else {
    // Mastermind: neutraler Ton, die Auswertung kommt erst danach als Zahl.
    strike(ctx, out, { freq: 330, duration: 0.45, volume: 0.3 });
  }
}

// Zwei dumpfe, tiefer werdende Schläge bei einem ungültigen Versuch.
export function playInvalid() {
  const ctx = audio();
  if (!ctx) return;
  const out = output(ctx, { space: 0.06 });
  strike(ctx, out, { freq: 233, duration: 0.16, volume: 0.36, partials: WOOD });
  strike(ctx, out, { freq: 196, at: 0.12, duration: 0.2, volume: 0.36, partials: WOOD });
}

// Sieg: Glocken-Arpeggio, danach ein schimmernder Akkord mit Glöckchen.
// short: kurze Variante für ein gelöstes Wort im Blitz.
export function playWin({ short = false } = {}) {
  const ctx = audio();
  if (!ctx) return;
  if (short) {
    const out = output(ctx, { space: 0.3 });
    strike(ctx, out, { freq: 1319, duration: 0.6, volume: 0.22, partials: BELL });
    strike(ctx, out, { freq: 1760, at: 0.08, duration: 0.8, volume: 0.22, partials: BELL });
    return;
  }
  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((freq, i) => {
    const out = output(ctx, { pan: (i - 2) * 0.15, space: 0.35 });
    strike(ctx, out, { freq, at: i * 0.085, duration: 1.1, volume: 0.24, partials: BELL });
  });
  const chord = output(ctx, { space: 0.5 });
  for (const freq of [523, 659, 784]) pad(ctx, chord, { freq, at: 0.42, duration: 1.8, volume: 0.07, cutoff: 2600 });
  sparkle(ctx, { at: 0.48, count: 7 });
}

// Niederlage: drei weiche, fallende Töne in Moll, darunter ein dunkler Akkord.
export function playLose() {
  const ctx = audio();
  if (!ctx) return;
  const out = output(ctx, { space: 0.35 });
  [392, 311, 262].forEach((freq, i) => strike(ctx, out, { freq, at: i * 0.26, duration: 0.9, volume: 0.3 }));
  for (const freq of [131, 156, 196]) pad(ctx, out, { freq, at: 0.52, duration: 1.6, volume: 0.08, cutoff: 900 });
}

// Holzblock-Ticken in den letzten Sekunden eines Blitz-Durchgangs; urgent klingt höher.
export function playTick(urgent = false) {
  const ctx = audio();
  if (!ctx) return;
  const out = output(ctx, { space: 0.06 });
  click(ctx, out, { freq: urgent ? 2600 : 2000, q: 3, duration: 0.03, volume: 0.3 });
  strike(ctx, out, { freq: urgent ? 1480 : 1110, duration: 0.07, volume: 0.24, partials: WOOD });
}

// Countdown vor dem Blitz: 3, 2, 1 als kurze Glocke, bei 0 („Los!“) ein heller Akkord.
export function playCount(n) {
  const ctx = audio();
  if (!ctx) return;
  const out = output(ctx, { space: 0.3 });
  if (n > 0) {
    strike(ctx, out, { freq: 880, duration: 0.45, volume: 0.28, partials: BELL });
    return;
  }
  for (const freq of [880, 1109, 1319, 1760]) strike(ctx, out, { freq, duration: 1, volume: 0.11, partials: BELL });
  click(ctx, out, { freq: 3000, q: 0.6, duration: 0.04, volume: 0.1 });
}

// Ende eines Blitz-Durchgangs: ein tiefer Gong.
export function playTimeUp() {
  const ctx = audio();
  if (!ctx) return;
  const out = output(ctx, { space: 0.45 });
  strike(ctx, out, { freq: 262, duration: 1.8, volume: 0.26, partials: BELL });
  strike(ctx, out, { freq: 392, at: 0.02, duration: 1.4, volume: 0.13, partials: BELL });
}

// Neues Abzeichen: kleine Fanfare in Dur, danach ein schimmernder Klang.
// Gold bekommt mehr Glöckchen als Silber und Bronze.
const BADGE_SPARKLES = { bronze: 4, silver: 7, gold: 12 };

export function playBadge(tier = 'bronze') {
  const ctx = audio();
  if (!ctx) return;
  [784, 988, 1175, 1568].forEach((freq, i) => {
    const out = output(ctx, { pan: (i - 1.5) * 0.2, space: 0.4 });
    strike(ctx, out, { freq, at: i * 0.075, duration: 1.2, volume: 0.22, partials: BELL });
  });
  const chord = output(ctx, { space: 0.55 });
  for (const freq of [784, 988, 1175]) pad(ctx, chord, { freq, at: 0.3, duration: 2, volume: 0.06, cutoff: 3000 });
  sparkle(ctx, { at: 0.36, count: BADGE_SPARKLES[tier] || BADGE_SPARKLES.bronze });
}
