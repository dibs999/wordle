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

const STATE_RANK = { absent: 1, present: 2, correct: 3 };

// Bester bekannter Zustand je Buchstabe, für die Bildschirmtastatur.
// rows: pro Versuch die angezeigten Zustände.
export function keyboardStatesFromRows(guesses, rows) {
  const states = {};
  guesses.forEach((guess, r) => {
    const result = rows[r];
    if (!Array.isArray(result)) return;
    letters(guess).forEach((letter, i) => {
      const current = states[letter];
      if (!current || STATE_RANK[result[i]] > STATE_RANK[current]) states[letter] = result[i];
    });
  });
  return states;
}

export function keyboardStates(guesses, answer) {
  return keyboardStatesFromRows(guesses, guesses.map((guess) => evaluateGuess(guess, answer)));
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

export function randomAnswer(solutions, exclude, random = Math.random) {
  if (solutions.length < 2) return solutions[0];
  let word;
  do {
    word = solutions[Math.floor(random() * solutions.length)];
  } while (word === exclude);
  return word;
}

export function emptyStats(maxGuesses = MAX_GUESSES) {
  return { played: 0, won: 0, streak: 0, maxStreak: 0, dist: new Array(maxGuesses).fill(0), lastWonDay: null };
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

// Endlos- und Extrem-Modus: Serie zählt aufeinanderfolgende gewonnene Runden.
export function recordEndlessResult(stats, won, guessCount) {
  const next = { ...emptyStats(), ...stats, dist: [...(stats?.dist || emptyStats().dist)] };
  while (next.dist.length < guessCount) next.dist.push(0);
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

// ---------- Extrem-Modi ----------

export const EXTREME_VARIANTS = {
  devil: {
    label: 'Teufel',
    emoji: '😈',
    maxGuesses: 8,
    caption: 'Das Wort weicht dir aus und legt sich erst fest, wenn nur noch eins passt.',
    short: 'Weicht dir aus, bis nur ein Wort passt',
  },
  liar: {
    label: 'Lügner',
    emoji: '🤥',
    maxGuesses: 8,
    caption: 'In jeder Reihe zeigt genau eine Kachel die falsche Farbe.',
    short: 'In jeder Reihe lügt eine Kachel',
  },
  blind: {
    label: 'Blind',
    emoji: '🙈',
    maxGuesses: 6,
    caption: 'Kein Gelb und keine Farben auf der Tastatur – merk dir alles selbst.',
    short: 'Kein Gelb, keine Farben auf der Tastatur',
  },
  mastermind: {
    label: 'Mastermind',
    emoji: '🎯',
    maxGuesses: 8,
    caption: 'Nur die Anzahl: 🟩 an der richtigen Stelle, 🟨 an einer anderen Stelle.',
    short: 'Nur Anzahlen: 🟩 richtig, 🟨 woanders',
  },
};

export const EXTREME_KEYS = Object.keys(EXTREME_VARIANTS);

const STATE_KEY = { correct: 'c', present: 'p', absent: 'a' };

function patternKey(states) {
  return states.map((s) => STATE_KEY[s]).join('');
}

function patternScore(states) {
  return states.reduce((sum, s) => sum + (s === 'correct' ? 2 : s === 'present' ? 1 : 0), 0);
}

function randomId(random) {
  return Math.floor(random() * 2 ** 48).toString(36);
}

export function newExtremeGame(variant, solutions, random = Math.random) {
  return {
    id: randomId(random),
    variant,
    // Der Teufel legt sich erst am Ende fest.
    answer: variant === 'devil' ? null : randomAnswer(solutions, null, random),
    guesses: [],
    feedback: [],
    status: 'playing',
  };
}

// Teufel: alle Lösungswörter, die zu den bisher gezeigten Farben passen.
export function devilCandidates(game, solutions) {
  return solutions.filter((word) =>
    game.guesses.every((guess, i) => patternKey(evaluateGuess(guess, word)) === patternKey(game.feedback[i])),
  );
}

// Teufel: Antwortet mit dem Farbmuster, nach dem die meisten Wörter übrig bleiben.
// Bei Gleichstand das Muster mit weniger Grün und Gelb, damit der Sieg so spät wie möglich kommt.
export function devilRespond(guess, candidates) {
  const groups = new Map();
  for (const word of candidates) {
    const states = evaluateGuess(guess, word);
    const key = patternKey(states);
    if (!groups.has(key)) groups.set(key, { states, words: [] });
    groups.get(key).words.push(word);
  }
  let best = null;
  for (const [key, group] of groups) {
    if (
      !best ||
      group.words.length > best.group.words.length ||
      (group.words.length === best.group.words.length &&
        (patternScore(group.states) < patternScore(best.group.states) ||
          (patternScore(group.states) === patternScore(best.group.states) && key < best.key)))
    ) {
      best = { key, group };
    }
  }
  return { states: best.group.states, remaining: best.group.words };
}

// Lügner: genau eine Kachel bekommt eine falsche Farbe – aber nie so, dass alles grün aussieht.
export function liarFeedback(truth, random = Math.random) {
  const options = [];
  truth.forEach((state, pos) => {
    for (const other of ['correct', 'present', 'absent']) {
      if (other === state) continue;
      const shown = [...truth];
      shown[pos] = other;
      if (!shown.every((s) => s === 'correct')) options.push(shown);
    }
  });
  return options[Math.floor(random() * options.length)];
}

export function mastermindCounts(guess, answer) {
  const states = evaluateGuess(guess, answer);
  return {
    correct: states.filter((s) => s === 'correct').length,
    present: states.filter((s) => s === 'present').length,
  };
}

// Spielt einen Versuch im Extrem-Modus und speichert die angezeigte Rückmeldung im Spiel.
export function playExtremeGuess(game, guess, solutions, random = Math.random) {
  const { maxGuesses } = EXTREME_VARIANTS[game.variant];
  let feedback;
  let won;
  let remaining = null;

  if (game.variant === 'devil') {
    let candidates = devilCandidates(game, solutions);
    // Nur Absturzschutz: Ein durch eine geänderte Wortliste unlösbares Spiel ersetzt die App schon beim Laden
    // (siehe devilGameStale).
    if (candidates.length === 0) candidates = solutions;
    ({ states: feedback, remaining } = devilRespond(guess, candidates));
    won = feedback.every((s) => s === 'correct');
  } else {
    const truth = evaluateGuess(guess, game.answer);
    won = guess === game.answer;
    if (game.variant === 'blind') feedback = truth.map((s) => (s === 'present' ? 'absent' : s));
    else if (game.variant === 'liar') feedback = won ? truth : liarFeedback(truth, random);
    else feedback = mastermindCounts(guess, game.answer);
  }

  game.guesses.push(guess);
  game.feedback.push(feedback);
  if (won) {
    game.status = 'won';
    if (game.variant === 'devil') game.answer = guess;
  } else if (game.guesses.length >= maxGuesses) {
    game.status = 'lost';
    if (game.variant === 'devil') {
      game.answer = remaining[0];
      game.remainingAtEnd = remaining.length;
    }
  }
  return { feedback, won };
}

// Ein laufendes Teufels-Spiel, zu dem kein Lösungswort mehr passt (weil die Wortliste geändert wurde).
export function devilGameStale(game, solutions) {
  return (
    game?.variant === 'devil' &&
    game.status === 'playing' &&
    game.guesses.length > 0 &&
    devilCandidates(game, solutions).length === 0
  );
}

// Tastaturfarben gibt es im Extrem-Modus nur beim Teufel (dort sind die Farben ehrlich).
export function extremeKeyboardStates(game) {
  if (game.variant !== 'devil') return {};
  return keyboardStatesFromRows(game.guesses, game.feedback);
}

export function extremeShareGrid(game) {
  return game.feedback
    .map((fb) =>
      Array.isArray(fb) ? fb.map((s) => SHARE_EMOJI[s]).join('') : `🟩 ${fb.correct}  🟨 ${fb.present}`,
    )
    .join('\n');
}

export function emptyExtremeStats() {
  return Object.fromEntries(EXTREME_KEYS.map((key) => [key, emptyStats(EXTREME_VARIANTS[key].maxGuesses)]));
}

// ---------- Profildaten ----------

// Die Extrem-Statistik liegt bewusst nicht unter "stats": Ältere App-Versionen bauen "stats" neu auf
// und würden sie dabei verwerfen, unbekannte Schlüssel auf oberster Ebene behalten sie dagegen.
export function emptyProfileData() {
  return {
    version: 1,
    daily: null,
    endless: null,
    extreme: {},
    stats: { daily: emptyStats(), endless: emptyStats() },
    extremeStats: emptyExtremeStats(),
    // Blitz: meiste gelöste Wörter in einem Durchgang, Anzahl der Durchgänge, gelöste Wörter insgesamt
    // und die höchste Punktzahl eines Durchgangs.
    blitzStats: { best: 0, runs: 0, words: 0, bestScore: 0 },
    // Erreichte Abzeichen mit Datum der Freischaltung: { [id]: ISO-Zeit }.
    achievements: {},
    // Bestwerte, die sich nicht aus der Statistik ablesen lassen.
    records: { fastestWinMs: null },
    settings: { extremeVariant: 'devil' },
  };
}


function normalizeExtremeGame(game, variant) {
  if (!game || typeof game !== 'object' || game.variant !== variant) return null;
  if (!Array.isArray(game.guesses) || !Array.isArray(game.feedback)) return null;
  const { maxGuesses } = EXTREME_VARIANTS[variant];
  const count = Math.min(game.guesses.length, game.feedback.length, maxGuesses);
  const answer = typeof game.answer === 'string' ? game.answer : null;
  if (variant !== 'devil' && !answer) return null;
  const status = ['playing', 'won', 'lost'].includes(game.status) ? game.status : 'playing';
  // Ein beendeter Teufel braucht sein Lösungswort.
  if (variant === 'devil' && status !== 'playing' && !answer) return null;
  return {
    ...game,
    id: typeof game.id === 'string' ? game.id : String(game.id ?? ''),
    answer,
    guesses: game.guesses.slice(0, count).map(String),
    feedback: game.feedback.slice(0, count),
    status,
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

function normalizeStats(stats, maxGuesses = MAX_GUESSES) {
  const next = { ...emptyStats(maxGuesses), ...(stats && typeof stats === 'object' ? stats : {}) };
  if (!Array.isArray(next.dist) || next.dist.length !== maxGuesses) next.dist = emptyStats(maxGuesses).dist;
  return next;
}

// Ergänzt fehlende Felder, damit ältere oder beschädigte Datensätze das Spiel nicht abstürzen lassen.
export function normalizeProfileData(data) {
  const base = emptyProfileData();
  if (!data || typeof data !== 'object') return base;
  const settings = { ...base.settings, ...(data.settings || {}) };
  if (!EXTREME_KEYS.includes(settings.extremeVariant)) settings.extremeVariant = 'devil';
  return {
    ...base,
    ...data,
    daily: normalizeGame(data.daily, 'day'),
    endless: normalizeGame(data.endless, 'answer'),
    extreme: Object.fromEntries(
      EXTREME_KEYS.map((key) => [key, normalizeExtremeGame(data.extreme?.[key], key)]).filter(([, game]) => game),
    ),
    stats: {
      daily: normalizeStats(data.stats?.daily),
      endless: normalizeStats(data.stats?.endless),
    },
    blitzStats: {
      best: Number(data.blitzStats?.best) || 0,
      runs: Number(data.blitzStats?.runs) || 0,
      words: Number(data.blitzStats?.words) || 0,
      bestScore: Number(data.blitzStats?.bestScore) || 0,
    },
    achievements: Object.fromEntries(
      Object.entries(data.achievements && typeof data.achievements === 'object' ? data.achievements : {}).filter(
        ([id, at]) => typeof id === 'string' && typeof at === 'string',
      ),
    ),
    records: {
      fastestWinMs: Number(data.records?.fastestWinMs) > 0 ? Number(data.records.fastestWinMs) : null,
    },
    // Übernimmt auch die kurzzeitig unter stats.extreme gespeicherte Statistik (die mit mehr Runden gilt).
    extremeStats: Object.fromEntries(
      EXTREME_KEYS.map((key) => {
        const { maxGuesses } = EXTREME_VARIANTS[key];
        const current = normalizeStats(data.extremeStats?.[key], maxGuesses);
        const legacy = normalizeStats(data.stats?.extreme?.[key], maxGuesses);
        return [key, legacy.played > current.played ? legacy : current];
      }),
    ),
    settings,
  };
}

// Übernimmt neue Daten, behält aber unveränderte Spiele als dieselben Objekte,
// damit ein laufendes Aufdecken nicht unterbrochen wird.
export function reuseUnchangedGames(live, next) {
  const same = (a, b) => a && b && JSON.stringify(a) === JSON.stringify(b);
  const result = { ...next, extreme: { ...next.extreme } };
  if (same(live?.daily, next.daily)) result.daily = live.daily;
  if (same(live?.endless, next.endless)) result.endless = live.endless;
  for (const key of Object.keys(result.extreme)) {
    if (same(live?.extreme?.[key], result.extreme[key])) result.extreme[key] = live.extreme[key];
  }
  return result;
}

function progress(game) {
  if (!game) return -1;
  return game.guesses.length + (game.status === 'playing' ? 0 : 100);
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

function pickExtreme(remote, local) {
  if (!remote || !local) return local || remote;
  if (remote.id === local.id) return progress(local) >= progress(remote) ? local : remote;
  const active = (game) => game.status === 'playing' && game.guesses.length > 0;
  return active(remote) && !active(local) ? remote : local;
}

// Statistiken zählen nur hoch: die mit mehr gespielten Runden enthält die neueren Ergebnisse.
function pickStats(remote, local) {
  return local.played >= remote.played ? local : remote;
}

function minOrNull(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

function mergeAchievementDates(remote, local) {
  const merged = { ...remote };
  for (const [id, at] of Object.entries(local)) {
    if (!merged[id] || at < merged[id]) merged[id] = at;
  }
  return merged;
}

// Führt zwei Stände desselben Profils zusammen, wenn zwei Geräte gleichzeitig gespeichert haben.
// Spiele: Der weiter fortgeschrittene Stand gewinnt. Statistik: Der Stand mit mehr gespielten Runden gilt.
// Runden werden nicht addiert, so zählt nie eine Runde doppelt (dafür kann eine gleichzeitig gespielte fehlen).
export function mergeProfileData(remoteData, localData) {
  const remote = normalizeProfileData(remoteData);
  const local = normalizeProfileData(localData);
  return {
    ...remote,
    ...local,
    daily: pickDaily(remote.daily, local.daily),
    endless: pickEndless(remote.endless, local.endless),
    extreme: Object.fromEntries(
      EXTREME_KEYS.map((key) => [key, pickExtreme(remote.extreme[key], local.extreme[key])]).filter(([, game]) => game),
    ),
    stats: {
      daily: pickStats(remote.stats.daily, local.stats.daily),
      endless: pickStats(remote.stats.endless, local.stats.endless),
    },
    extremeStats: Object.fromEntries(
      EXTREME_KEYS.map((key) => [key, pickStats(remote.extremeStats[key], local.extremeStats[key])]),
    ),
    // Bestwerte und Anzahl der Durchgänge: jeweils der höhere Stand.
    blitzStats: {
      best: Math.max(remote.blitzStats.best, local.blitzStats.best),
      runs: Math.max(remote.blitzStats.runs, local.blitzStats.runs),
      words: Math.max(remote.blitzStats.words, local.blitzStats.words),
      bestScore: Math.max(remote.blitzStats.bestScore, local.blitzStats.bestScore),
    },
    // Ein Abzeichen, das ein Gerät erreicht hat, bleibt erreicht (mit dem frühesten Datum).
    achievements: mergeAchievementDates(remote.achievements, local.achievements),
    records: {
      fastestWinMs: minOrNull(remote.records.fastestWinMs, local.records.fastestWinMs),
    },
    settings: local.settings,
  };
}

// ---------- Blitz ----------

// Ein Durchgang beginnt mit zwei Minuten; jedes gelöste Wort bringt Punkte und Extrazeit,
// beides umso mehr, je weniger Versuche es gebraucht hat (Index = Versuche - 1).
export const BLITZ_START_SECONDS = 120;
const BLITZ_POINTS = [60, 50, 40, 30, 20, 10];
const BLITZ_TIME_BONUS = [30, 25, 20, 15, 10, 5];
const BLITZ_COMBO_STEP = 10;
const BLITZ_COMBO_MAX = 50;

// Punkte für ein gelöstes Wort. combo zählt die gelösten Wörter in Folge (dieses mitgerechnet):
// ab dem zweiten gibt es je +10 Bonus, höchstens +50.
export function blitzPoints(guesses, combo = 1) {
  const base = BLITZ_POINTS[guesses - 1] ?? 0;
  if (!base) return 0;
  return base + Math.min(BLITZ_COMBO_MAX, Math.max(0, combo - 1) * BLITZ_COMBO_STEP);
}

// Extrazeit in Sekunden für ein gelöstes Wort.
export function blitzTimeBonus(guesses) {
  return BLITZ_TIME_BONUS[guesses - 1] ?? 0;
}

// Übernimmt einen beendeten Durchgang in die Statistik.
export function recordBlitzRun(stats, { score, words }) {
  return {
    ...stats,
    best: Math.max(stats.best, words),
    bestScore: Math.max(stats.bestScore, score),
    runs: stats.runs + 1,
    words: stats.words + words,
  };
}

// Dauer vom ersten Versuch bis zum Ende einer Runde in Millisekunden (null, wenn nicht bekannt).
export function durationMs(game) {
  if (!game?.startedAt || !game?.finishedAt) return null;
  return game.finishedAt - game.startedAt;
}

export function formatDuration(ms) {
  if (ms == null) return '';
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ---------- Ranglisten ----------

// Tagesrätsel: gewonnen (wenigste Versuche, dann schnellste zuerst),
// danach verloren, laufend und zuletzt die, die heute noch nicht angefangen haben.
export function dailyRanking(profiles, day) {
  const rows = profiles.map(({ id, name, data }) => {
    const game = data.daily;
    if (!game || game.day !== day) return { id, name, tier: 3, guesses: 0, ms: null };
    if (game.status === 'won') return { id, name, tier: 0, guesses: game.guesses.length, ms: durationMs(game) };
    if (game.status === 'lost') return { id, name, tier: 1, guesses: game.guesses.length, ms: null };
    return { id, name, tier: game.guesses.length ? 2 : 3, guesses: game.guesses.length, ms: null };
  });
  return rows.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.guesses - b.guesses ||
      (a.ms ?? Number.MAX_SAFE_INTEGER) - (b.ms ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name, 'de'),
  );
}

// Aktuelle Tagesserie (bei Gleichstand entscheidet die beste Serie).
export function streakRanking(profiles, today) {
  return profiles
    .map(({ id, name, data }) => ({
      id,
      name,
      streak: currentDailyStreak(data.stats.daily, today),
      best: data.stats.daily.maxStreak,
    }))
    .sort((a, b) => b.streak - a.streak || b.best - a.best || a.name.localeCompare(b.name, 'de'));
}

// Höchste Punktzahl im Blitz (bei Gleichstand zählen mehr Wörter, dann weniger Durchgänge).
export function blitzRanking(profiles) {
  return profiles
    .map(({ id, name, data }) => {
      const { bestScore, best, runs } = data.blitzStats;
      return { id, name, score: bestScore, words: best, runs };
    })
    .sort((a, b) => b.score - a.score || b.words - a.words || a.runs - b.runs || a.name.localeCompare(b.name, 'de'));
}

// Anzahl erreichter Abzeichen (bei Gleichstand zählen goldene, dann silberne mehr).
export function achievementRanking(profiles) {
  return profiles
    .map(({ id, name, data }) => {
      const earned = achievements(data).filter((a) => a.earned);
      const tierCount = (tier) => earned.filter((a) => a.tier === tier).length;
      return { id, name, count: earned.length, gold: tierCount('gold'), silver: tierCount('silver') };
    })
    .sort((a, b) => b.count - a.count || b.gold - a.gold || b.silver - a.silver || a.name.localeCompare(b.name, 'de'));
}

// Platz in einer sortierten Rangliste (1-basiert); Gleichstand teilt sich den Platz.
export function rankOf(rows, id, value) {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const mine = value(rows[index]);
  return rows.findIndex((row) => value(row) === mine) + 1;
}

// ---------- Abzeichen ----------

// Gruppen in der Reihenfolge, in der sie angezeigt werden.
export const ACHIEVEMENT_GROUPS = [
  { id: 'wins', title: 'Siege' },
  { id: 'daily', title: 'Tagesrätsel' },
  { id: 'skill', title: 'Können' },
  { id: 'endless', title: 'Endlos' },
  { id: 'extreme', title: 'Extrem' },
  { id: 'blitz', title: 'Blitz' },
];

function totalWins(data) {
  return data.stats.daily.won + data.stats.endless.won + EXTREME_KEYS.reduce((sum, key) => sum + data.extremeStats[key].won, 0);
}

// Wie oft ein Wort mit genau n Versuchen gelöst wurde (Tagesrätsel und Endlos).
function solvedWith(data, guesses) {
  return data.stats.daily.dist[guesses - 1] + data.stats.endless.dist[guesses - 1];
}

const dailyWins = (d) => d.stats.daily.won;
const bestStreak = (d) => d.stats.daily.maxStreak;
const endlessWins = (d) => d.stats.endless.won;
const blitzBest = (d) => d.blitzStats.best;
const extremeWins = (key) => (d) => d.extremeStats[key].won;

// tier: bronze, silver oder gold. value(d) ist der Fortschritt, target das Ziel.
export const ACHIEVEMENTS = [
  { id: 'win-1', group: 'wins', tier: 'bronze', icon: '🎉', title: 'Erster Sieg', text: 'Ein Wort gelöst.', target: 1, value: totalWins },
  { id: 'win-25', group: 'wins', tier: 'bronze', icon: '📚', title: 'Wortkenner', text: '25 Wörter gelöst.', target: 25, value: totalWins },
  { id: 'win-100', group: 'wins', tier: 'silver', icon: '🎓', title: 'Wortprofi', text: '100 Wörter gelöst.', target: 100, value: totalWins },
  { id: 'win-500', group: 'wins', tier: 'gold', icon: '👑', title: 'Wortmeister', text: '500 Wörter gelöst.', target: 500, value: totalWins },

  { id: 'daily-10', group: 'daily', tier: 'bronze', icon: '📅', title: 'Stammgast', text: '10 Tagesrätsel gelöst.', target: 10, value: dailyWins },
  { id: 'daily-50', group: 'daily', tier: 'silver', icon: '🗓️', title: 'Tagesrätsel-Fan', text: '50 Tagesrätsel gelöst.', target: 50, value: dailyWins },
  { id: 'daily-200', group: 'daily', tier: 'gold', icon: '🏛️', title: 'Institution', text: '200 Tagesrätsel gelöst.', target: 200, value: dailyWins },
  { id: 'streak-3', group: 'daily', tier: 'bronze', icon: '🔥', title: 'Drei am Stück', text: '3 Tagesrätsel hintereinander gelöst.', target: 3, value: bestStreak },
  { id: 'streak-7', group: 'daily', tier: 'silver', icon: '💪', title: 'Woche am Stück', text: '7 Tagesrätsel hintereinander gelöst.', target: 7, value: bestStreak },
  { id: 'streak-30', group: 'daily', tier: 'gold', icon: '🌟', title: 'Ein ganzer Monat', text: '30 Tagesrätsel hintereinander gelöst.', target: 30, value: bestStreak },

  { id: 'last-guess', group: 'skill', tier: 'bronze', icon: '😅', title: 'Knapp gerettet', text: 'Ein Wort mit dem letzten Versuch gelöst.', target: 1, value: (d) => solvedWith(d, MAX_GUESSES) },
  { id: 'two-guess', group: 'skill', tier: 'silver', icon: '🧩', title: 'Scharfsinn', text: '5 Wörter mit nur zwei Versuchen gelöst.', target: 5, value: (d) => solvedWith(d, 2) },
  { id: 'fast', group: 'skill', tier: 'silver', icon: '🚀', title: 'Schnelldenker', text: 'Ein Wort in unter einer Minute gelöst.', target: 1, value: (d) => (d.records.fastestWinMs != null && d.records.fastestWinMs <= 60_000 ? 1 : 0) },
  { id: 'one-guess', group: 'skill', tier: 'gold', icon: '🎯', title: 'Volltreffer', text: 'Ein Wort mit dem ersten Versuch erraten.', target: 1, value: (d) => solvedWith(d, 1) },

  { id: 'endless-25', group: 'endless', tier: 'bronze', icon: '♾️', title: 'Vielspieler', text: '25 Wörter im Endlos-Modus gelöst.', target: 25, value: endlessWins },
  { id: 'endless-100', group: 'endless', tier: 'silver', icon: '🏃', title: 'Marathon', text: '100 Wörter im Endlos-Modus gelöst.', target: 100, value: endlessWins },

  { id: 'devil', group: 'extreme', tier: 'bronze', icon: '😈', title: 'Teufel bezwungen', text: 'Den Teufel einmal besiegt.', target: 1, value: extremeWins('devil') },
  { id: 'liar', group: 'extreme', tier: 'bronze', icon: '🤥', title: 'Lügner durchschaut', text: 'Den Lügner einmal besiegt.', target: 1, value: extremeWins('liar') },
  { id: 'blind', group: 'extreme', tier: 'bronze', icon: '🙈', title: 'Blind getroffen', text: 'Den Blind-Modus einmal gewonnen.', target: 1, value: extremeWins('blind') },
  { id: 'mastermind', group: 'extreme', tier: 'bronze', icon: '🧠', title: 'Meister der Zahlen', text: 'Den Mastermind-Modus einmal gewonnen.', target: 1, value: extremeWins('mastermind') },
  { id: 'all-extreme', group: 'extreme', tier: 'silver', icon: '🏆', title: 'Alle Extreme', text: 'Jede Extrem-Variante mindestens einmal gewonnen.', target: EXTREME_KEYS.length, value: (d) => EXTREME_KEYS.filter((key) => d.extremeStats[key].won >= 1).length },
  { id: 'devil-10', group: 'extreme', tier: 'gold', icon: '👹', title: 'Teufelsaustreiber', text: 'Den Teufel 10-mal besiegt.', target: 10, value: extremeWins('devil') },

  { id: 'blitz-3', group: 'blitz', tier: 'bronze', icon: '⏱️', title: 'Flink', text: '3 Wörter in einem Blitz-Durchgang.', target: 3, value: blitzBest },
  { id: 'blitz-6', group: 'blitz', tier: 'silver', icon: '⚡', title: 'Blitzschnell', text: '6 Wörter in einem Blitz-Durchgang.', target: 6, value: blitzBest },
  { id: 'blitz-10', group: 'blitz', tier: 'gold', icon: '🌩️', title: 'Licht\u00ADgeschwindigkeit', text: '10 Wörter in einem Blitz-Durchgang.', target: 10, value: blitzBest },
];

// Stand aller Abzeichen eines Profils: Fortschritt, ob erreicht und seit wann.
// Ein gespeichertes Abzeichen bleibt erreicht, auch wenn die Statistik sich später ändert.
export function achievements(data) {
  return ACHIEVEMENTS.map(({ value, ...a }) => {
    const progress = Math.min(value(data), a.target);
    const earnedAt = data.achievements[a.id] || null;
    return { ...a, progress, earned: Boolean(earnedAt) || progress >= a.target, earnedAt };
  });
}

// Trägt neu erreichte Abzeichen mit Datum ein und gibt sie zurück (für die Meldung „Neues Abzeichen“).
export function unlockAchievements(data, now = new Date().toISOString()) {
  const unlocked = [];
  for (const { value, ...a } of ACHIEVEMENTS) {
    if (data.achievements[a.id] || value(data) < a.target) continue;
    data.achievements[a.id] = now;
    unlocked.push(a);
  }
  return unlocked;
}

// Merkt sich die schnellste Lösung eines Wortes (für „Schnelldenker“).
export function recordWinTime(data, ms) {
  if (!(ms > 0)) return;
  data.records.fastestWinMs = minOrNull(data.records.fastestWinMs, ms);
}

export const SHARE_EMOJI = { correct: '🟩', present: '🟨', absent: '⬛' };

export function shareGrid(guesses, answer) {
  return guesses
    .map((guess) => evaluateGuess(guess, answer).map((s) => SHARE_EMOJI[s]).join(''))
    .join('\n');
}
