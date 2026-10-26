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
      if (have < count) return count > 1 ? `Wort muss ${count}× ${letter} enthalten` : `Wort muss ${letter} enthalten`;
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

// Die Lösungsliste steht bereits in Tagesreihenfolge (siehe js/words.js).
export function dailyAnswer(dayKey, solutions) {
  const n = dayNumber(dayKey);
  return solutions[((n % solutions.length) + solutions.length) % solutions.length];
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

function normalizeGame(game, keyField) {
  if (!game || typeof game !== 'object' || typeof game[keyField] !== 'string' || !Array.isArray(game.guesses)) {
    return null;
  }
  return {
    ...game,
    guesses: game.guesses.filter((guess) => typeof guess === 'string').slice(0, MAX_GUESSES),
    status: ['playing', 'won', 'lost'].includes(game.status) ? game.status : 'playing',
  };
}

function normalizeStats(stats) {
  const next = { ...emptyStats(), ...(stats && typeof stats === 'object' ? stats : {}) };
  if (!Array.isArray(next.dist) || next.dist.length !== MAX_GUESSES) next.dist = emptyStats().dist;
  return next;
}

// Ergänzt fehlende Felder, damit ältere oder beschädigte Datensätze das Spiel nicht abstürzen lassen.
export function normalizeProfileData(data) {
  const base = emptyProfileData();
  if (!data || typeof data !== 'object') return base;
  return {
    ...base,
    ...data,
    daily: normalizeGame(data.daily, 'day'),
    endless: normalizeGame(data.endless, 'answer'),
    stats: {
      daily: normalizeStats(data.stats?.daily),
      endless: normalizeStats(data.stats?.endless),
    },
    settings: { ...base.settings, ...(data.settings || {}) },
  };
}

function progress(game) {
  if (!game) return -1;
  return game.guesses.length + (game.status === 'playing' ? 0 : MAX_GUESSES + 1);
}

function pickDaily(remote, local) {
  if (!remote || !local) return local || remote;
  if (remote.day !== local.day) return remote.day > local.day ? remote : local;
  return progress(local) >= progress(remote) ? local : remote;
}

function pickEndless(remote, local) {
  if (!remote || !local) return local || remote;
  if (remote.answer === local.answer) return progress(local) >= progress(remote) ? local : remote;
  const active = (game) => game.status === 'playing' && game.guesses.length > 0;
  return active(remote) && !active(local) ? remote : local;
}

// Statistiken zählen nur hoch: die mit mehr gespielten Runden enthält die neueren Ergebnisse.
function pickStats(remote, local) {
  return local.played >= remote.played ? local : remote;
}

// Führt zwei Stände desselben Profils zusammen, wenn zwei Geräte gleichzeitig gespeichert haben.
// Pro Teil gewinnt der weiter fortgeschrittene Stand, damit keine Runde verloren geht.
export function mergeProfileData(remoteData, localData) {
  const remote = normalizeProfileData(remoteData);
  const local = normalizeProfileData(localData);
  return {
    ...remote,
    ...local,
    daily: pickDaily(remote.daily, local.daily),
    endless: pickEndless(remote.endless, local.endless),
    stats: {
      daily: pickStats(remote.stats.daily, local.stats.daily),
      endless: pickStats(remote.stats.endless, local.stats.endless),
    },
    settings: local.settings,
  };
}

export const SHARE_EMOJI = { correct: '🟩', present: '🟨', absent: '⬛' };

export function shareGrid(guesses, answer) {
  return guesses
    .map((guess) => evaluateGuess(guess, answer).map((s) => SHARE_EMOJI[s]).join(''))
    .join('\n');
}
