// Reine Spiellogik ohne DOM-Zugriff, damit sie auch in Node getestet werden kann.

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;

export function letters(word) {
  return Array.from(word);
}

// Liefert pro Buchstabe 'correct', 'present' oder 'absent'.
// Doppelte Buchstaben werden nur so oft markiert, wie sie im Lösungswort vorkommen.
export function evaluateGuess(guess, answer) {
  const g = letters(guess);
  const a = letters(answer);
  const result = new Array(g.length).fill('absent');
  const remaining = new Map();

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      result[i] = 'correct';
    } else {
      remaining.set(a[i], (remaining.get(a[i]) || 0) + 1);
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (result[i] === 'correct') continue;
    const left = remaining.get(g[i]) || 0;
    if (left > 0) {
      result[i] = 'present';
      remaining.set(g[i], left - 1);
    }
  }
  return result;
}

// Schwerer Modus: aufgedeckte Hinweise müssen in späteren Versuchen verwendet werden.
// Gibt eine Fehlermeldung zurück oder null, wenn der Versuch erlaubt ist.
export function hardModeViolation(guess, previousGuesses, answer) {
  const g = letters(guess);
  for (const prev of previousGuesses) {
    const p = letters(prev);
    const result = evaluateGuess(prev, answer);

    for (let i = 0; i < p.length; i++) {
      if (result[i] === 'correct' && g[i] !== p[i]) {
        return `${i + 1}. Buchstabe muss ${p[i]} sein`;
      }
    }

    const required = new Map();
    for (let i = 0; i < p.length; i++) {
      if (result[i] !== 'absent') required.set(p[i], (required.get(p[i]) || 0) + 1);
    }
    for (const [letter, count] of required) {
      const have = g.filter((l) => l === letter).length;
      if (have < count) return `Wort muss ${letter} enthalten`;
    }
  }
  return null;
}

const STATE_RANK = { absent: 1, present: 2, correct: 3 };

// Bester bekannter Zustand je Buchstabe, für die Bildschirmtastatur.
export function keyboardStates(guesses, answer) {
  const states = {};
  for (const guess of guesses) {
    const result = evaluateGuess(guess, answer);
    letters(guess).forEach((letter, i) => {
      const current = states[letter];
      if (!current || STATE_RANK[result[i]] > STATE_RANK[current]) states[letter] = result[i];
    });
  }
  return states;
}

// Kalendertag in Deutschland als "JJJJ-MM-TT", damit alle um Mitternacht (MEZ/MESZ) ein neues Wort bekommen.
export function berlinDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dayKeyToUtc(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dayNumber(dayKey) {
  return Math.round((dayKeyToUtc(dayKey) - EPOCH_UTC) / DAY_MS);
}

export function shiftDayKey(dayKey, days) {
  return new Date(dayKeyToUtc(dayKey) + days * DAY_MS).toISOString().slice(0, 10);
}

export function puzzleNumber(dayKey) {
  return dayNumber(dayKey) + 1;
}

function mulberry32(seed) {
  return function next() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const orderCache = new WeakMap();

// Feste, gemischte Reihenfolge der Lösungswörter, damit das Tageswort nicht alphabetisch vorhersehbar ist.
function shuffledSolutions(solutions) {
  let order = orderCache.get(solutions);
  if (!order) {
    order = [...solutions].sort();
    const random = mulberry32(20260101);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    orderCache.set(solutions, order);
  }
  return order;
}

export function dailyAnswer(dayKey, solutions) {
  const order = shuffledSolutions(solutions);
  const n = dayNumber(dayKey);
  return order[((n % order.length) + order.length) % order.length];
}

export function randomAnswer(solutions, exclude) {
  if (solutions.length < 2) return solutions[0];
  let word;
  do {
    word = solutions[Math.floor(Math.random() * solutions.length)];
  } while (word === exclude);
  return word;
}

export function emptyStats() {
  return { played: 0, won: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], lastWonDay: null };
}

// Tagesrätsel: Serie zählt aufeinanderfolgende gewonnene Tage.
export function recordDailyResult(stats, dayKey, won, guessCount) {
  const next = { ...emptyStats(), ...stats, dist: [...(stats?.dist || emptyStats().dist)] };
  next.played += 1;
  if (won) {
    next.won += 1;
    next.dist[guessCount - 1] += 1;
    next.streak = next.lastWonDay === shiftDayKey(dayKey, -1) ? next.streak + 1 : 1;
    next.lastWonDay = dayKey;
  } else {
    next.streak = 0;
  }
  next.maxStreak = Math.max(next.maxStreak, next.streak);
  return next;
}

// Endlos-Modus: Serie zählt aufeinanderfolgende gewonnene Runden.
export function recordEndlessResult(stats, won, guessCount) {
  const next = { ...emptyStats(), ...stats, dist: [...(stats?.dist || emptyStats().dist)] };
  next.played += 1;
  if (won) {
    next.won += 1;
    next.dist[guessCount - 1] += 1;
    next.streak += 1;
  } else {
    next.streak = 0;
  }
  next.maxStreak = Math.max(next.maxStreak, next.streak);
  return next;
}

// Eine Tagesserie verfällt, wenn gestern nicht gewonnen wurde.
export function currentDailyStreak(stats, todayKey) {
  if (!stats?.lastWonDay) return 0;
  if (stats.lastWonDay === todayKey || stats.lastWonDay === shiftDayKey(todayKey, -1)) return stats.streak;
  return 0;
}

export function emptyProfileData() {
  return {
    version: 1,
    daily: null,
    endless: null,
    stats: { daily: emptyStats(), endless: emptyStats() },
    settings: { hardMode: false },
  };
}

// Ergänzt fehlende Felder, damit ältere oder beschädigte Datensätze das Spiel nicht abstürzen lassen.
export function normalizeProfileData(data) {
  const base = emptyProfileData();
  if (!data || typeof data !== 'object') return base;
  return {
    ...base,
    ...data,
    stats: {
      daily: { ...emptyStats(), ...(data.stats?.daily || {}) },
      endless: { ...emptyStats(), ...(data.stats?.endless || {}) },
    },
    settings: { ...base.settings, ...(data.settings || {}) },
  };
}

export const SHARE_EMOJI = { correct: '🟩', present: '🟨', absent: '⬛' };

export function shareGrid(guesses, answer) {
  return guesses
    .map((guess) => evaluateGuess(guess, answer).map((s) => SHARE_EMOJI[s]).join(''))
    .join('\n');
}
