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
  },
  liar: {
    label: 'Lügner',
    emoji: '🤥',
    maxGuesses: 8,
    caption: 'In jeder Reihe zeigt genau eine Kachel die falsche Farbe.',
  },
  blind: {
    label: 'Blind',
    emoji: '🙈',
    maxGuesses: 6,
    caption: 'Kein Gelb und keine Farben auf der Tastatur – merk dir alles selbst.',
  },
  mastermind: {
    label: 'Mastermind',
    emoji: '🎯',
    maxGuesses: 8,
    caption: 'Nur die Anzahl: 🟩 an der richtigen Stelle, 🟨 an einer anderen Stelle.',
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
    // Blitz: meiste gelöste Wörter in einem Durchgang und Anzahl der Durchgänge.
    blitzStats: { best: 0, runs: 0 },
    settings: { extremeVariant: 'devil' },
  };
}

// Position für einen Hinweis: ein Buchstabe, den man noch nicht an der richtigen Stelle hat.
export function hintPosition(game, random = Math.random) {
  const answer = letters(game.answer);
  const open = answer.map((_, i) => i).filter((i) => !game.guesses.some((guess) => letters(guess)[i] === answer[i]));
  const pool = open.length ? open : answer.map((_, i) => i);
  return pool[Math.floor(random() * pool.length)];
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

// Stand der Statistik, auf dem eine lokale Änderung aufbaut (für das Zusammenführen per Zuwachs).
export function countsSnapshot(data) {
  const normalized = normalizeProfileData(data);
  return JSON.parse(JSON.stringify({ stats: normalized.stats, extremeStats: normalized.extremeStats }));
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

// Zählt die seit dem gemeinsamen Stand (base) lokal gespielten Runden auf den Serverstand,
// damit Runden beider Geräte erhalten bleiben. Ohne base: der Stand mit mehr Runden gilt.
export function mergeCounts(remote, local, base) {
  if (!base) return pickStats(remote, local);
  const localGain = local.played - base.played;
  const remoteGain = remote.played - base.played;
  if (localGain <= 0) return pickStats(local, remote);
  if (remoteGain <= 0) return local;
  const wonGain = Math.max(0, local.won - base.won);
  const length = Math.max(remote.dist.length, local.dist.length);
  const dist = Array.from(
    { length },
    (_, i) => (remote.dist[i] || 0) + Math.max(0, (local.dist[i] || 0) - (base.dist[i] || 0)),
  );
  // Reihenfolge der Runden beider Geräte ist unbekannt: Hat das Gerät verloren, zählt seine Serie,
  // sonst setzt es die Serie des Servers fort.
  const streak = wonGain < localGain ? local.streak : remote.streak + wonGain;
  return {
    ...remote,
    played: remote.played + localGain,
    won: remote.won + wonGain,
    dist,
    streak,
    maxStreak: Math.max(remote.maxStreak, local.maxStreak, streak),
  };
}

// Wie mergeCounts, aber ein auf beiden Geräten beendetes, gleiches Tagesrätsel zählt nur einmal,
// und die Serie richtet sich nach dem spätesten Siegtag.
function mergeDailyCounts(remote, local, base, remoteDaily, localDaily) {
  if (!base) return pickStats(remote, local);
  const localGain = local.played - base.played;
  const remoteGain = remote.played - base.played;
  if (localGain <= 0) return pickStats(local, remote);
  if (remoteGain <= 0) return local;
  const sameDayOnBoth =
    remoteDaily && localDaily && remoteDaily.day === localDaily.day &&
    remoteDaily.status !== 'playing' && localDaily.status !== 'playing';
  if (sameDayOnBoth && localGain === 1 && remoteGain === 1) return remote;
  const merged = mergeCounts(remote, local, base);
  const later = (local.lastWonDay || '') > (remote.lastWonDay || '') ? local : remote;
  return {
    ...merged,
    lastWonDay: later.lastWonDay,
    streak: later.streak,
    maxStreak: Math.max(merged.maxStreak, later.streak),
  };
}

// Führt zwei Stände desselben Profils zusammen, wenn zwei Geräte gleichzeitig gespeichert haben.
// Spiele: Der weiter fortgeschrittene Stand gewinnt. Statistik: Mit baseCounts (Stand, auf dem die
// lokalen Daten aufbauen) werden die lokalen Runden auf den Serverstand addiert, sonst gilt der größere.
export function mergeProfileData(remoteData, localData, baseCounts = null) {
  const remote = normalizeProfileData(remoteData);
  const local = normalizeProfileData(localData);
  const base = baseCounts ? normalizeProfileData(baseCounts) : null;
  return {
    ...remote,
    ...local,
    daily: pickDaily(remote.daily, local.daily),
    endless: pickEndless(remote.endless, local.endless),
    extreme: Object.fromEntries(
      EXTREME_KEYS.map((key) => [key, pickExtreme(remote.extreme[key], local.extreme[key])]).filter(([, game]) => game),
    ),
    stats: {
      daily: mergeDailyCounts(remote.stats.daily, local.stats.daily, base?.stats.daily, remote.daily, local.daily),
      endless: mergeCounts(remote.stats.endless, local.stats.endless, base?.stats.endless),
    },
    extremeStats: Object.fromEntries(
      EXTREME_KEYS.map((key) => [key, mergeCounts(remote.extremeStats[key], local.extremeStats[key], base?.extremeStats[key])]),
    ),
    // Bestwerte und Anzahl der Durchgänge: jeweils der höhere Stand (ein Durchgang kann dabei zählen, aber nie verloren gehen).
    blitzStats: {
      best: Math.max(remote.blitzStats.best, local.blitzStats.best),
      runs: Math.max(remote.blitzStats.runs, local.blitzStats.runs),
    },
    settings: local.settings,
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

// Rangliste für ein Tagesrätsel: gewonnen (wenigste Versuche, dann schnellste zuerst),
// danach verloren, laufend und zuletzt die, die heute noch nicht angefangen haben.
export function dailyRanking(profiles, day) {
  const rows = profiles.map(({ name, data }) => {
    const game = data.daily;
    if (!game || game.day !== day) return { name, tier: 3, guesses: 0, ms: null };
    if (game.status === 'won') return { name, tier: 0, guesses: game.guesses.length, ms: durationMs(game) };
    if (game.status === 'lost') return { name, tier: 1, guesses: game.guesses.length, ms: null };
    return { name, tier: game.guesses.length ? 2 : 3, guesses: game.guesses.length, ms: null };
  });
  return rows.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.guesses - b.guesses ||
      (a.ms ?? Number.MAX_SAFE_INTEGER) - (b.ms ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name, 'de'),
  );
}

// ---------- Abzeichen ----------

// Die Abzeichen werden aus den Statistiken berechnet, nichts davon muss gespeichert werden.
function totalWins(data) {
  return data.stats.daily.won + data.stats.endless.won + EXTREME_KEYS.reduce((sum, key) => sum + data.extremeStats[key].won, 0);
}

export const ACHIEVEMENTS = [
  {
    id: 'first-win',
    icon: '🎉',
    title: 'Erster Sieg',
    text: 'Ein Wort gelöst.',
    earned: (d) => totalWins(d) >= 1,
  },
  {
    id: 'one-guess',
    icon: '🎯',
    title: 'Volltreffer',
    text: 'Ein Wort mit dem ersten Versuch erraten.',
    earned: (d) => d.stats.daily.dist[0] + d.stats.endless.dist[0] >= 1,
  },
  {
    id: 'daily-10',
    icon: '📅',
    title: 'Stammgast',
    text: '10 Tagesrätsel gelöst.',
    earned: (d) => d.stats.daily.won >= 10,
  },
  {
    id: 'streak-7',
    icon: '🔥',
    title: 'Woche am Stück',
    text: '7 Tagesrätsel hintereinander gelöst.',
    earned: (d) => d.stats.daily.maxStreak >= 7,
  },
  {
    id: 'streak-30',
    icon: '🌟',
    title: 'Ein ganzer Monat',
    text: '30 Tagesrätsel hintereinander gelöst.',
    earned: (d) => d.stats.daily.maxStreak >= 30,
  },
  {
    id: 'endless-25',
    icon: '♾️',
    title: 'Vielspieler',
    text: '25 Wörter im Endlos-Modus gelöst.',
    earned: (d) => d.stats.endless.won >= 25,
  },
  {
    id: 'devil',
    icon: '😈',
    title: 'Teufel bezwungen',
    text: 'Den Teufel im Extrem-Modus besiegt.',
    earned: (d) => d.extremeStats.devil.won >= 1,
  },
  {
    id: 'liar',
    icon: '🤥',
    title: 'Lügner durchschaut',
    text: 'Den Lügner im Extrem-Modus besiegt.',
    earned: (d) => d.extremeStats.liar.won >= 1,
  },
  {
    id: 'blind',
    icon: '🙈',
    title: 'Blind getroffen',
    text: 'Den Blind-Modus gewonnen.',
    earned: (d) => d.extremeStats.blind.won >= 1,
  },
  {
    id: 'mastermind',
    icon: '🧠',
    title: 'Meister der Zahlen',
    text: 'Den Mastermind-Modus gewonnen.',
    earned: (d) => d.extremeStats.mastermind.won >= 1,
  },
  {
    id: 'all-extreme',
    icon: '🏆',
    title: 'Alle Extreme',
    text: 'Jede Extrem-Variante mindestens einmal gewonnen.',
    earned: (d) => EXTREME_KEYS.every((key) => d.extremeStats[key].won >= 1),
  },
  {
    id: 'blitz-10',
    icon: '⏱️',
    title: 'Blitzschnell',
    text: '10 Wörter in einem Blitz-Durchgang gelöst.',
    earned: (d) => d.blitzStats.best >= 10,
  },
];

// Alle Abzeichen eines Profils mit dem Stand, ob sie erreicht sind.
export function achievements(data) {
  return ACHIEVEMENTS.map(({ id, icon, title, text, earned }) => ({ id, icon, title, text, earned: Boolean(earned(data)) }));
}

// Rangliste der aktuellen Tagesserien, längste zuerst.
export function streakRanking(profiles, today) {
  return profiles
    .map(({ name, data }) => ({ name, streak: currentDailyStreak(data.stats.daily, today) }))
    .sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name, 'de'));
}

export const SHARE_EMOJI = { correct: '🟩', present: '🟨', absent: '⬛' };

export function shareGrid(guesses, answer) {
  return guesses
    .map((guess) => evaluateGuess(guess, answer).map((s) => SHARE_EMOJI[s]).join(''))
    .join('\n');
}
