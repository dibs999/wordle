import { SOLUTIONS, ALLOWED } from './words.js';
import {
  WORD_LENGTH,
  MAX_GUESSES,
  EXTREME_VARIANTS,
  EXTREME_KEYS,
  letters,
  evaluateGuess,
  keyboardStates,
  berlinDayKey,
  puzzleNumber,
  dailyAnswer,
  randomAnswer,
  recordDailyResult,
  recordEndlessResult,
  currentDailyStreak,
  emptyProfileData,
  shareGrid,
  newExtremeGame,
  playExtremeGuess,
  devilCandidates,
  devilGameStale,
  extremeKeyboardStates,
  extremeShareGrid,
  mergeProfileData,
  reuseUnchangedGames,
  dailyRanking,
  streakRanking,
  blitzRanking,
  BLITZ_START_SECONDS,
  blitzPoints,
  blitzTimeBonus,
  recordBlitzRun,
  achievementRanking,
  rankOf,
  durationMs,
  formatDuration,
  ACHIEVEMENT_GROUPS,
  achievements,
  unlockAchievements,
  recordWinTime,
} from './game.js';
import { burstConfetti } from './fx.js';
import {
  isCloud,
  listProfiles,
  fetchProfile,
  createProfile,
  saveProfile,
  flushPending,
  flushAllPending,
  hasPendingSave,
  pendingData,
  cleanName,
  timeValue,
  onConflictMerged,
  setActiveProfile,
  listLocalOnlyProfiles,
  importLocalProfile,
} from './store.js';
import {
  playTap,
  playFlip,
  playInvalid,
  playWin,
  playLose,
  playTick,
  playCount,
  playTimeUp,
  playBadge,
  isSoundEnabled,
  setSoundEnabled,
} from './sound.js';

const ALLOWED_SET = new Set([...ALLOWED, ...SOLUTIONS]);
const LAST_PROFILE_KEY = 'wordle-de:last-profile';
const THEME_KEY = 'wordle-de:theme';
const CONTRAST_KEY = 'wordle-de:contrast';
const EXTREME_INTRO_KEY = 'wordle-de:extreme-intro';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLIP_STEP = REDUCED_MOTION ? 0 : 300;
const FLIP_HALF = REDUCED_MOTION ? 0 : 250;
const PRAISE = ['Genial!', 'Großartig!', 'Beeindruckend!', 'Super!', 'Gut gemacht!', 'Geschafft!', 'Stark!'];
const AVATAR_COLOR_COUNT = 6;
const KEY_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
  ['ENTER', 'Y', 'X', 'C', 'V', 'B', 'N', 'M', 'BACKSPACE'],
];
const STATE_LABEL = { correct: 'richtig', present: 'an anderer Stelle', absent: 'nicht im Wort' };
const BLITZ_PAUSE = 1300;
const BLITZ_URGENT_MS = 10_000; // in den letzten Sekunden tickt die Uhr und der Balken wird rot
const BADGE_POPUP_MS = 3600;
const TIER_LABEL = { bronze: 'Bronze', silver: 'Silber', gold: 'Gold' };
const TIER_CONFETTI = {
  bronze: ['#c27a3b', '#e0a46b', '#8a4f22', '#f3c99d'],
  silver: ['#9aa4ae', '#d7dde2', '#ffffff', '#6f7c88'],
  gold: ['#e3a90c', '#ffd23f', '#fff3b0', '#c98a00'],
};
const MEDALS = ['🥇', '🥈', '🥉'];

const $ = (id) => document.getElementById(id);
const els = {
  profileScreen: $('profile-screen'),
  profileList: $('profile-list'),
  profileStatus: $('profile-status'),
  profileToasts: $('profile-toasts'),
  localHint: $('local-hint'),
  localImport: $('local-import'),
  localImportList: $('local-import-list'),
  newProfileButton: $('new-profile-button'),
  newProfileDialog: $('new-profile-dialog'),
  newProfileForm: $('new-profile-form'),
  newProfileName: $('new-profile-name'),
  newProfileError: $('new-profile-error'),
  gameScreen: $('game-screen'),
  switchProfile: $('switch-profile'),
  variantBar: $('variant-bar'),
  board: $('board'),
  keyboard: $('keyboard'),
  toasts: $('toasts'),
  srStatus: $('sr-status'),
  statsDialog: $('stats-dialog'),
  settingsDialog: $('settings-dialog'),
  highContrast: $('high-contrast'),
  soundToggle: $('sound-toggle'),
  rankingButton: $('ranking-button'),
  rankingDialog: $('ranking-dialog'),
  rankingList: $('ranking-list'),
  variantDialog: $('variant-dialog'),
  variantOptions: $('variant-options'),
  badgePopup: $('badge-popup'),
  blitzStart: $('blitz-start'),
  blitzStartPanel: $('blitz-start-panel'),
  blitzSkip: $('blitz-skip'),
  blitzCountdown: $('blitz-countdown'),
  themeSelect: $('theme-select'),
};

const state = {
  profiles: [],
  profile: null,
  mode: 'daily', // 'daily' | 'endless' | 'extreme' | 'blitz'
  today: berlinDayKey(),
  current: [],
  busy: false, // Wort wird gerade aufgedeckt
  switching: false, // Profilwechsel läuft
  selectToken: 0,
  loadToken: 0,
  localRevision: 0, // zählt lokale Änderungen, damit ein veralteter Serverstand sie nicht überschreibt
  statsTimer: null,
  countdownTimer: null,
  statsView: null, // Spiel, dessen Ergebnis der Statistik-Dialog gerade zeigt
  boardShape: '',
  boardIdentity: '',
  blitzRound: null, // Wort des laufenden Blitz-Durchgangs (wird nicht gespeichert)
  blitz: null, // laufender Durchgang: Phase (countdown/running), Ende, Punkte, Wörter, Kombo und Zeitgeber
  blitzLast: null, // Punkte und Wörter des zuletzt beendeten Durchgangs (für die Anzeige)
  blitzHintAt: 0,
  statsTab: 'stats', // 'stats' | 'badges'
  rankingBoard: 'daily', // 'daily' | 'streak' | 'blitz' | 'badges'
  unseenBadges: new Set(), // in dieser Sitzung erreicht und noch nicht angesehen
  badgePopup: null, // Warteschlange der Meldungen „Neues Abzeichen“
};

// ---------- Hilfsfunktionen ----------

function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Privater Modus o. Ä.: Einstellung gilt dann nur bis zum Neuladen.
  }
}

// Meldungen erscheinen im offenen Dialog, sonst auf dem sichtbaren Bildschirm.
function toast(message, duration = 1500) {
  const host =
    document.querySelector('dialog[open] .toasts') || (els.gameScreen.hidden ? els.profileToasts : els.toasts);
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.prepend(el);
  if (duration > 0) {
    setTimeout(() => {
      el.classList.add('is-hiding');
      setTimeout(() => el.remove(), 350);
    }, duration);
  }
  return el;
}

function clearToasts() {
  for (const host of document.querySelectorAll('.toasts')) host.replaceChildren();
}

// Für Screenreader: Ergebnis eines Versuchs vorlesen lassen.
function announce(message) {
  els.srStatus.textContent = '';
  requestAnimationFrame(() => {
    els.srStatus.textContent = message;
  });
}

function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function nameHash(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash;
}

// Jeder Name bekommt eine feste Farbe aus der Palette und eine leichte, verspielte Drehung.
function fillAvatar(el, name) {
  const hash = nameHash(name);
  el.textContent = letters(name)[0] || '?';
  el.style.setProperty('--avatar', `var(--avatar-${(hash % AVATAR_COLOR_COUNT) + 1})`);
  el.style.setProperty('--r', `${(hash % 11) - 5}deg`);
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeAllDialogs() {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}

// ---------- Profile ----------

function lastProfileId() {
  return readSetting(LAST_PROFILE_KEY);
}

function profileSummary(profile) {
  const { daily, stats } = profile.data;
  const parts = [];
  const streak = currentDailyStreak(stats.daily, state.today);
  if (streak > 0) parts.push({ text: `🔥 ${streak}`, kind: 'streak' });
  const earned = achievements(profile.data).filter((a) => a.earned).length;
  if (earned > 0) parts.push({ text: `🏅 ${earned}`, kind: 'badge' });
  if (daily?.day === state.today && daily.status === 'won') parts.push({ text: `Heute ✓ ${daily.guesses.length}/6`, kind: 'win' });
  else if (daily?.day === state.today && daily.status === 'lost') parts.push({ text: 'Heute ✗', kind: 'open' });
  else parts.push({ text: 'Heute offen', kind: 'open' });
  return parts;
}

function renderProfiles() {
  const lastId = lastProfileId();
  const sorted = [...state.profiles].sort((a, b) => {
    if (a.id === lastId) return -1;
    if (b.id === lastId) return 1;
    return a.name.localeCompare(b.name, 'de');
  });

  els.profileList.replaceChildren(
    ...sorted.map((profile) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-card';
      button.dataset.id = profile.id;
      if (profile.id === lastId) {
        button.classList.add('is-last');
        const badge = document.createElement('span');
        badge.className = 'badge-last';
        badge.textContent = 'Zuletzt gespielt';
        button.append(badge);
      }

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      fillAvatar(avatar, profile.name);

      const name = document.createElement('span');
      name.className = 'profile-card-name';
      name.textContent = profile.name;

      const meta = document.createElement('span');
      meta.className = 'profile-card-meta';
      for (const part of profileSummary(profile)) {
        const item = document.createElement('span');
        item.className = `pill pill-${part.kind}`;
        item.textContent = part.text;
        meta.append(item);
      }

      button.append(avatar, name, meta);
      li.append(button);
      return li;
    }),
  );

  if (state.profiles.length === 0) {
    setProfileStatus('Noch keine Profile. Leg das erste an!');
  }
}

function renderLocalImport() {
  const locals = listLocalOnlyProfiles();
  els.localImport.hidden = locals.length === 0;
  els.localImportList.replaceChildren(
    ...locals.map((profile) => {
      const li = document.createElement('li');
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      fillAvatar(avatar, profile.name);
      const name = document.createElement('span');
      name.className = 'local-import-name';
      name.textContent = profile.name;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button';
      button.dataset.importId = profile.id;
      button.textContent = 'Online übernehmen';
      button.setAttribute('aria-label', `${profile.name} online übernehmen`);
      li.append(avatar, name, button);
      return li;
    }),
  );
}

async function importProfile(button) {
  button.disabled = true;
  button.parentElement.querySelector('.local-import-error')?.remove();
  try {
    const profile = await importLocalProfile(button.dataset.importId);
    state.profiles.push(profile);
    setProfileStatus('');
    renderProfiles();
    renderLocalImport();
    toast(`${profile.name} ist jetzt auf allen Geräten verfügbar`, 2500);
  } catch (error) {
    button.disabled = false;
    const message = document.createElement('span');
    message.className = 'local-import-error';
    message.setAttribute('role', 'alert');
    message.textContent =
      error.code === 'duplicate'
        ? 'Diesen Namen gibt es online schon.'
        : error.message || 'Übernehmen fehlgeschlagen.';
    button.parentElement.append(message);
  }
}

function setProfileStatus(message, { error = false, retry = false } = {}) {
  els.profileStatus.replaceChildren(message);
  els.profileStatus.classList.toggle('is-error', error);
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-secondary';
    button.textContent = 'Erneut versuchen';
    button.style.marginTop = '0.8rem';
    button.addEventListener('click', () => loadProfiles());
    els.profileStatus.append(document.createElement('br'), button);
  }
}

// quiet: bereits angezeigte Profile stehen lassen und nur im Hintergrund auffrischen.
async function loadProfiles({ quiet = false } = {}) {
  const token = ++state.loadToken;
  if (!quiet) setProfileStatus('Profile werden geladen …');
  try {
    const profiles = await listProfiles();
    if (token !== state.loadToken) return;
    state.profiles = profiles;
    setProfileStatus('');
    renderProfiles();
    renderLocalImport();
  } catch (error) {
    if (token !== state.loadToken) return;
    if (quiet) setProfileStatus('Offline – zuletzt geladener Stand.');
    else setProfileStatus(error.message || 'Profile konnten nicht geladen werden.', { error: true, retry: true });
  }
}

function replaceListedProfile(profile) {
  const index = state.profiles.findIndex((p) => p.id === profile.id);
  if (index >= 0) state.profiles[index] = profile;
  else state.profiles.push(profile);
}

function showProfileScreen() {
  // Ein laufender Blitz-Durchgang wird zuerst beendet, solange das Profil noch ausgewählt ist.
  finishBlitz();
  dismissBadgePopups();
  closeAllDialogs();
  stopCountdown();
  clearTimeout(state.statsTimer);
  state.statsTimer = null;
  state.selectToken += 1;
  // Den aktuellen Stand in der Liste behalten, falls das Neuladen offline scheitert.
  if (state.profile) replaceListedProfile(state.profile);
  state.profile = null;
  setActiveProfile(null);
  state.current = [];
  els.gameScreen.hidden = true;
  els.profileScreen.hidden = false;
  document.title = 'Wordle Deutsch';
  if (state.profiles.length > 0) {
    setProfileStatus('');
    renderProfiles();
  }
  loadProfiles({ quiet: state.profiles.length > 0 });
}

async function selectProfile(id) {
  const token = ++state.selectToken;
  let profile = state.profiles.find((p) => p.id === id);
  if (!profile) return;
  if (isCloud) {
    const card = els.profileList.querySelector(`[data-id="${CSS.escape(id)}"]`);
    card?.classList.add('is-loading');
    // Erst eine evtl. laufende Speicherung abwarten, damit Daten und Serverstand zusammenpassen.
    await flushPending(id).catch(() => null);
    if (!hasPendingSave(id)) {
      // Frisch laden, falls auf einem anderen Gerät inzwischen gespielt wurde.
      let fresh;
      try {
        fresh = await fetchProfile(id);
      } catch {
        fresh = undefined; // Offline: mit dem zuletzt geladenen Stand weiterspielen.
      }
      if (fresh === null && token === state.selectToken) {
        card?.classList.remove('is-loading');
        state.profiles = state.profiles.filter((p) => p.id !== id);
        renderProfiles();
        toast('Dieses Profil gibt es nicht mehr.', 3000);
        return;
      }
      if (fresh) profile = fresh;
    }
    card?.classList.remove('is-loading');
    // Ein späterer Klick oder der Weg zurück zur Liste hat diese Auswahl überholt.
    if (token !== state.selectToken) return;
  }
  // Noch nicht hochgeladene Runden dieses Geräts haben Vorrang vor einem älteren Listenstand.
  const pending = pendingData(id);
  if (pending) profile.data = pending;
  replaceListedProfile(profile);
  state.profile = profile;
  setActiveProfile(profile);
  writeSetting(LAST_PROFILE_KEY, id);
  state.today = berlinDayKey();
  ensureGames();
  state.unseenBadges.clear();
  // Abzeichen, die schon vor dieser Version verdient waren, still mit dem heutigen Datum nachtragen.
  if (unlockAchievements(profile.data).length > 0) persist();

  const dailyDone = profile.data.daily.status !== 'playing';
  els.profileScreen.hidden = true;
  els.gameScreen.hidden = false;
  fillAvatar(els.switchProfile.querySelector('.avatar'), profile.name);
  els.switchProfile.querySelector('.profile-chip-name').textContent = profile.name;
  els.switchProfile.setAttribute('aria-label', `${profile.name} – Profil wechseln`);
  document.title = `Wordle Deutsch – ${profile.name}`;
  setMode(dailyDone ? 'endless' : 'daily');
  if (dailyDone) toast('Tagesrätsel heute schon gespielt ✓', 2200);
}

async function submitNewProfile(event) {
  event.preventDefault();
  const name = cleanName(els.newProfileName.value);
  if (!name) {
    els.newProfileError.textContent = 'Bitte einen Namen eingeben.';
    return;
  }
  if (state.profiles.some((p) => p.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) {
    els.newProfileError.textContent = 'Diesen Namen gibt es schon. Wähle ihn in der Liste aus.';
    return;
  }
  const submit = els.newProfileForm.querySelector('[type="submit"]');
  submit.disabled = true;
  els.newProfileError.textContent = '';
  try {
    const profile = await createProfile(name, emptyProfileData());
    state.profiles.push(profile);
    els.newProfileDialog.close();
    await selectProfile(profile.id);
  } catch (error) {
    if (error.code === 'duplicate') {
      // Jemand anderes hat den Namen gerade angelegt: Liste auffrischen, damit das Profil sichtbar wird.
      els.newProfileError.textContent = 'Diesen Namen gibt es schon. Wähle ihn in der Liste aus.';
      if (isCloud) loadProfiles({ quiet: true });
    } else {
      els.newProfileError.textContent = error.message || 'Profil konnte nicht angelegt werden.';
    }
  } finally {
    submit.disabled = false;
  }
}

async function persist() {
  const profile = state.profile;
  if (!profile) return;
  state.localRevision += 1;
  const result = await saveProfile(profile);
  if (result.status === 'offline') {
    toast('Offline – wird gespeichert, sobald du wieder online bist', 2500);
  } else if (result.status === 'error') {
    toast(`${result.error?.message || 'Speichern fehlgeschlagen'} Wird erneut versucht.`, 3000);
  } else if (result.status === 'missing') {
    state.profiles = state.profiles.filter((p) => p.id !== profile.id);
    if (state.profile === profile && !state.busy) {
      // Vorher abmelden, damit showProfileScreen das gelöschte Profil nicht wieder in die Liste setzt.
      state.profile = null;
      showProfileScreen();
    }
    toast('Dieses Profil gibt es nicht mehr.', 3000);
  }
}

// ---------- Spielstand ----------

function extremeVariant() {
  return state.profile.data.settings.extremeVariant;
}

function ensureGames() {
  const data = state.profile.data;
  if (!data.daily || data.daily.day !== state.today) {
    data.daily = { day: state.today, answer: dailyAnswer(state.today, SOLUTIONS), guesses: [], status: 'playing' };
  } else if (!data.daily.answer) {
    // Spielstände von vor dieser Version: bei einem Sieg ist der letzte Versuch die Lösung.
    const lastGuess = data.daily.guesses[data.daily.guesses.length - 1];
    data.daily.answer = data.daily.status === 'won' && lastGuess ? lastGuess : dailyAnswer(data.daily.day, SOLUTIONS);
  }
  if (!data.endless) {
    data.endless = { answer: randomAnswer(SOLUTIONS), guesses: [], status: 'playing' };
  }
  const variant = extremeVariant();
  // Ein Teufels-Spiel, zu dem nach einer Änderung der Wortliste kein Wort mehr passt, neu beginnen.
  if (!data.extreme[variant] || devilGameStale(data.extreme[variant], SOLUTIONS)) {
    data.extreme[variant] = newExtremeGame(variant, SOLUTIONS);
  }
}

function currentGame() {
  const data = state.profile.data;
  // Das Blitz-Wort wird nicht gespeichert, es gehört nur zum laufenden Durchgang.
  if (state.mode === 'blitz') return state.blitzRound;
  if (state.mode === 'daily') return data.daily;
  if (state.mode === 'endless') return data.endless;
  return data.extreme[extremeVariant()];
}

function maxGuesses() {
  return state.mode === 'extreme' ? EXTREME_VARIANTS[extremeVariant()].maxGuesses : MAX_GUESSES;
}

function currentStats() {
  const data = state.profile.data;
  return state.mode === 'extreme' ? data.extremeStats[extremeVariant()] : data.stats[state.mode];
}

// Angezeigte Rückmeldung eines Versuchs: Farben pro Buchstabe oder (Mastermind) nur Anzahlen.
function rowFeedback(game, row) {
  return state.mode === 'extreme' ? game.feedback[row] : evaluateGuess(game.guesses[row], game.answer);
}

// Kennung des Spiels auf dem Bildschirm, um nach einem Abgleich zu erkennen, ob es noch dasselbe ist.
function gameIdentity(data = state.profile?.data) {
  if (!data) return '';
  if (state.mode === 'blitz') return `blitz:${state.blitzRound?.guesses.length ?? 0}:${state.blitzRound?.status ?? ''}`;
  const game =
    state.mode === 'daily' ? data.daily : state.mode === 'endless' ? data.endless : data.extreme?.[data.settings?.extremeVariant];
  if (!game) return state.mode;
  return [state.mode, game.id || game.day || '', game.answer || '', game.guesses.length, game.status].join(':');
}

// Neues Wort im Endlos- oder Extrem-Modus, wenn die letzte Runde beendet ist.
function startNextRound() {
  const data = state.profile.data;
  if (state.mode === 'endless') {
    data.endless = { answer: randomAnswer(SOLUTIONS, data.endless?.answer), guesses: [], status: 'playing' };
  } else if (state.mode === 'extreme') {
    const variant = extremeVariant();
    data.extreme[variant] = newExtremeGame(variant, SOLUTIONS);
  }
}

function setMode(mode) {
  // Ein laufender Blitz-Durchgang endet beim Wechsel still, sein Ergebnis wird trotzdem gespeichert.
  if (state.mode === 'blitz' && mode !== 'blitz') finishBlitz();
  state.mode = mode;
  state.current = [];
  clearTimeout(state.statsTimer);
  state.statsTimer = null;
  // Blitz wartet auf „Start“ und beginnt dann mit einem frischen Wort.
  if (mode === 'blitz') state.blitzRound = newBlitzRound('idle');
  ensureGames();
  if (mode !== 'daily' && currentGame().status !== 'playing') {
    startNextRound();
    // Gleich speichern, damit ein Abgleich mit dem Server die neue Runde nicht wieder verdrängt.
    persist();
  }
  clearToasts();
  renderAll();
}

// Reiter und Blitz-Leiste passend zum aktuellen Spielstand. Die Extrem-Variante steht als Emoji
// im Reiter, damit über dem Spielfeld nichts Platz wegnimmt.
function syncModeChrome() {
  for (const tab of document.querySelectorAll('.mode-tab')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.mode === state.mode));
  }
  const { emoji, label } = EXTREME_VARIANTS[extremeVariant()];
  $('extreme-badge').textContent = emoji;
  const extremeTab = document.querySelector('.mode-tab[data-mode="extreme"]');
  extremeTab.setAttribute(
    'aria-label',
    state.mode === 'extreme' ? `Extrem, Variante ${label}. Antippen, um die Variante zu wechseln` : `Extrem, Variante ${label}`,
  );
  els.variantBar.hidden = state.mode !== 'blitz';
}

function renderAll() {
  syncModeChrome();
  renderBoard();
  renderKeyboardStates();
  renderBlitzBar();
}

// Teufel: nach jedem Versuch kurz einblenden, wie viele Wörter noch passen (ohne festen Platz).
function showDevilCount(game) {
  if (game.variant !== 'devil' || game.status !== 'playing') return;
  const left = devilCandidates(game, SOLUTIONS).length;
  const text = left === 1 ? 'Nur noch ein Wort möglich!' : `Noch ${left.toLocaleString('de-DE')} Wörter möglich`;
  toast(`😈 ${text}`, 2200);
  return text;
}

// Erkennt Mitternacht (deutsche Zeit) und lädt dann das neue Tagesrätsel.
function checkNewDay() {
  const today = berlinDayKey();
  // Während ein Wort aufgedeckt wird, später erneut prüfen.
  if (today === state.today || state.busy) return;
  state.today = today;
  if (!state.profile) {
    if (!els.profileScreen.hidden) renderProfiles();
    return;
  }
  ensureGames();
  if (state.mode === 'daily') {
    // Das Ergebnis von gestern nicht mehr anzeigen oder teilen.
    if (els.statsDialog.open) els.statsDialog.close();
    clearTimeout(state.statsTimer);
    state.statsTimer = null;
    state.current = [];
    toast('Neues Tagesrätsel!', 2000);
    renderAll();
  }
}

// Übernimmt einen Stand vom Server (oder aus einem Konflikt) und zeichnet neu.
// before: Kennung des Spiels, das vorher zu sehen war. Getippte Buchstaben bleiben nur im selben Spiel.
function applyProfileUpdate(before) {
  ensureGames();
  if (gameIdentity() !== before || currentGame().status !== 'playing') state.current = [];
  if (state.busy) return;
  renderAll();
}

// Holt beim Zurückkehren zur Seite den aktuellen Stand, falls auf einem anderen Gerät gespielt wurde.
async function refreshFromCloud() {
  const profile = state.profile;
  if (!isCloud || !profile) return;
  await flushPending(profile.id, profile).catch(() => null);
  if (hasPendingSave(profile.id)) return;
  const revision = state.localRevision;
  let remote;
  try {
    remote = await fetchProfile(profile.id);
  } catch {
    return;
  }
  // Während des Ladens lokal weitergespielt: der geladene Stand ist dann veraltet.
  if (!remote || state.profile !== profile || state.busy || state.localRevision !== revision || hasPendingSave(profile.id)) {
    return;
  }
  // Jeder andere Serverstand stammt von einem anderen Gerät (Uhren der Geräte können abweichen).
  if (timeValue(remote.updatedAt) === timeValue(profile.updatedAt)) return;
  // Zusammenführen statt blind übernehmen: Die gewählte Variante bleibt die dieses Geräts, und ein
  // veralteter Tab (z. B. mit älterer App-Version) kann keine Runden oder Statistik zurückdrehen.
  const merged = mergeProfileData(remote.data, profile.data);
  const before = gameIdentity();
  profile.data = reuseUnchangedGames(profile.data, merged);
  profile.updatedAt = remote.updatedAt;
  applyProfileUpdate(before);
  // Hat das Zusammenführen etwas repariert, den reparierten Stand zurückspeichern.
  if (JSON.stringify(merged) !== JSON.stringify(remote.data)) persist();
}

// ---------- Spielfeld ----------

function buildBoard() {
  const rowsCount = maxGuesses();
  const withHints = state.mode === 'extreme' && extremeVariant() === 'mastermind';
  const shape = `${rowsCount}:${withHints}`;
  if (shape === state.boardShape) return;
  state.boardShape = shape;
  els.board.style.setProperty('--rows', rowsCount);
  els.board.classList.toggle('with-hints', withHints);
  const rows = [];
  for (let r = 0; r < rowsCount; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'row');
    for (let c = 0; c < WORD_LENGTH; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.setAttribute('role', 'gridcell');
      row.append(tile);
    }
    if (withHints) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.setAttribute('role', 'gridcell');
      row.append(hint);
    }
    rows.push(row);
  }
  els.board.replaceChildren(...rows);
}

function rowTiles(index) {
  return [...els.board.children[index].querySelectorAll('.tile')];
}

function setTile(tile, letter, tileState, position) {
  tile.textContent = letter || '';
  tile.toggleAttribute('data-filled', Boolean(letter));
  if (tileState) tile.dataset.state = tileState;
  else delete tile.dataset.state;
  const label = letter ? `${position}. Buchstabe ${letter}` : `${position}. Buchstabe leer`;
  tile.setAttribute('aria-label', tileState && STATE_LABEL[tileState] ? `${label}, ${STATE_LABEL[tileState]}` : label);
}

function setHint(rowIndex, counts) {
  const hint = els.board.children[rowIndex]?.querySelector('.hint');
  if (!hint) return;
  if (!counts) {
    hint.replaceChildren();
    hint.removeAttribute('aria-label');
    return;
  }
  const badge = (kind, value) => Object.assign(document.createElement('span'), { className: `hint-badge hint-${kind}`, textContent: value });
  hint.replaceChildren(badge('correct', counts.correct), badge('present', counts.present));
  hint.setAttribute('aria-label', `${counts.correct} an der richtigen Stelle, ${counts.present} an einer anderen Stelle`);
}

function renderBoard({ hideStateOfRow = -1 } = {}) {
  buildBoard();
  const game = currentGame();
  for (let r = 0; r < maxGuesses(); r++) {
    const guess = game.guesses[r];
    const rowLetters = guess ? letters(guess) : r === game.guesses.length ? state.current : [];
    const feedback = guess && r !== hideStateOfRow ? rowFeedback(game, r) : null;
    const states = Array.isArray(feedback) ? feedback : feedback ? new Array(WORD_LENGTH).fill('locked') : null;
    rowTiles(r).forEach((tile, c) => {
      tile.classList.remove('flip', 'bounce', 'pop');
      setTile(tile, rowLetters[c], states?.[c], c + 1);
    });
    setHint(r, feedback && !Array.isArray(feedback) ? feedback : null);
  }
  state.boardIdentity = gameIdentity();
}

function renderCurrentRow() {
  const game = currentGame();
  const row = game.guesses.length;
  if (row >= maxGuesses()) return;
  rowTiles(row).forEach((tile, c) => setTile(tile, state.current[c], null, c + 1));
}

function shakeRow() {
  const row = els.board.children[currentGame().guesses.length];
  if (!row) return;
  playInvalid();
  row.classList.remove('shake');
  void row.offsetWidth;
  row.classList.add('shake');
  row.addEventListener('animationend', () => row.classList.remove('shake'), { once: true });
}

// isCurrent() verhindert, dass ein laufendes Aufdecken auf ein inzwischen anderes Spielfeld malt.
function revealRow(rowIndex, guess, feedback, isCurrent) {
  const tiles = rowTiles(rowIndex);
  const chars = letters(guess);
  const states = Array.isArray(feedback) ? feedback : new Array(WORD_LENGTH).fill('locked');
  tiles.forEach((tile, i) => {
    setTimeout(() => {
      if (!isCurrent()) return;
      tile.classList.add('flip');
      setTimeout(() => {
        if (!isCurrent()) return;
        setTile(tile, chars[i], states[i], i + 1);
        playFlip(states[i], i);
      }, FLIP_HALF);
      tile.addEventListener('animationend', () => tile.classList.remove('flip'), { once: true });
    }, i * FLIP_STEP);
  });
  const duration = (tiles.length - 1) * FLIP_STEP + FLIP_HALF * 2 + 30;
  return new Promise((resolve) =>
    setTimeout(() => {
      if (isCurrent() && !Array.isArray(feedback)) setHint(rowIndex, feedback);
      resolve();
    }, duration),
  );
}

function bounceRow(rowIndex) {
  rowTiles(rowIndex).forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.add('bounce');
      tile.addEventListener('animationend', () => tile.classList.remove('bounce'), { once: true });
    }, i * 100);
  });
}

// ---------- Tastatur ----------

function buildKeyboard() {
  const rows = KEY_ROWS.map((keys) => {
    const row = document.createElement('div');
    row.className = 'keyboard-row';
    for (const key of keys) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'key';
      button.dataset.key = key;
      if (key === 'ENTER') {
        button.classList.add('key-wide');
        button.textContent = 'Enter';
      } else if (key === 'BACKSPACE') {
        button.classList.add('key-wide');
        button.setAttribute('aria-label', 'Löschen');
        button.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7.07L2.4 12l4.66-7H22v14zm-11.59-2L14 13.41 17.59 17 19 15.59 15.41 12 19 8.41 17.59 7 14 10.59 10.41 7 9 8.41 12.59 12 9 15.59z"/></svg>';
      } else {
        button.textContent = key;
      }
      row.append(button);
    }
    return row;
  });
  els.keyboard.replaceChildren(...rows);
}

function renderKeyboardStates() {
  const game = currentGame();
  const states = state.mode === 'extreme' ? extremeKeyboardStates(game) : keyboardStates(game.guesses, game.answer);
  for (const button of els.keyboard.querySelectorAll('.key')) {
    const keyState = states[button.dataset.key];
    if (keyState) {
      button.dataset.state = keyState;
      button.setAttribute('aria-label', `${button.dataset.key}, ${STATE_LABEL[keyState]}`);
    } else {
      delete button.dataset.state;
      if (button.dataset.key.length === 1) button.removeAttribute('aria-label');
    }
  }
}

function handleKey(key) {
  if (key === 'ENTER') submitGuess();
  else if (key === 'BACKSPACE') removeLetter();
  else addLetter(key);
}

// ---------- Spielzüge ----------

function inputBlocked() {
  return state.busy || state.switching || !state.profile || currentGame().status !== 'playing';
}

function addLetter(letter) {
  if (state.mode === 'blitz' && !state.blitz && state.profile && !state.busy) {
    hintBlitzStart();
    return;
  }
  if (inputBlocked() || state.current.length >= WORD_LENGTH) return;
  const game = currentGame();
  // Die Zeit für Rangliste und „Schnelldenker“ läuft ab dem ersten getippten Buchstaben.
  if (!game.startedAt && game.guesses.length === 0) game.startedAt = Date.now();
  state.current.push(letter);
  renderCurrentRow();
  const tile = rowTiles(game.guesses.length)[state.current.length - 1];
  tile.classList.remove('pop');
  void tile.offsetWidth;
  tile.classList.add('pop');
  playTap();
}

function removeLetter() {
  if (inputBlocked() || state.current.length === 0) return;
  state.current.pop();
  renderCurrentRow();
}

function praise(rowIndex) {
  if (rowIndex === maxGuesses() - 1) return 'Puh, knapp!';
  return PRAISE[Math.min(rowIndex, PRAISE.length - 1)];
}

function describeFeedback(guess, feedback) {
  if (!Array.isArray(feedback)) {
    return `${feedback.correct} an der richtigen Stelle, ${feedback.present} an einer anderen Stelle`;
  }
  return letters(guess)
    .map((ch, i) => `${ch} ${STATE_LABEL[feedback[i]]}`)
    .join(', ');
}

async function submitGuess() {
  if (state.busy || state.switching || !state.profile) return;
  const game = currentGame();
  // Im Blitz startet Enter den Durchgang (nur vor dem ersten, danach über „Nochmal“).
  if (state.mode === 'blitz' && !state.blitz) {
    if (game.status === 'idle') startBlitzCountdown();
    return;
  }
  if (game.status !== 'playing') {
    // Im Endlos- und Extrem-Modus startet Enter nach einer Runde das nächste Wort
    // (erst wenn das Ergebnis angezeigt wurde).
    // Im Blitz geht es nach jedem Wort von selbst weiter.
    if (state.mode === 'blitz') return;
    if (state.mode !== 'daily' && !state.statsTimer) nextRound();
    return;
  }
  const guess = state.current.join('');

  if (state.current.length < WORD_LENGTH) {
    shakeRow();
    toast('Zu wenige Buchstaben');
    return;
  }
  if (!ALLOWED_SET.has(guess)) {
    shakeRow();
    toast('Kein gültiges Wort');
    return;
  }

  const rowIndex = game.guesses.length;
  const firstGuess = rowIndex === 0;
  let feedback;
  let won;
  if (state.mode === 'extreme') {
    ({ feedback, won } = playExtremeGuess(game, guess, SOLUTIONS));
  } else {
    feedback = evaluateGuess(guess, game.answer);
    won = guess === game.answer;
    game.guesses.push(guess);
    if (won) game.status = 'won';
    else if (game.guesses.length === MAX_GUESSES) game.status = 'lost';
  }
  state.current = [];
  // Zeiten für die Rangliste: vom ersten Buchstaben bis zum Ende der Runde.
  if (firstGuess && !game.startedAt) game.startedAt = Date.now();
  if (game.status !== 'playing') game.finishedAt = Date.now();

  // Blitz-Wörter gehen nicht in die normale Statistik ein, sondern in den Bestwert des Durchgangs.
  let unlocked = [];
  if (game.status !== 'playing' && state.mode !== 'blitz') {
    const stats = state.profile.data.stats;
    if (state.mode === 'daily') {
      stats.daily = recordDailyResult(stats.daily, game.day, won, game.guesses.length);
    } else if (state.mode === 'endless') {
      stats.endless = recordEndlessResult(stats.endless, won, game.guesses.length);
    } else {
      const { extremeStats } = state.profile.data;
      const variant = extremeVariant();
      extremeStats[variant] = recordEndlessResult(extremeStats[variant], won, game.guesses.length);
    }
    if (won) recordWinTime(state.profile.data, durationMs(game));
    unlocked = collectAchievements();
  }

  const profile = state.profile;
  const mode = state.mode;
  const blitzRun = mode === 'blitz' ? state.blitz : null;
  const isCurrent = () => state.profile === profile && state.mode === mode && currentGame() === game;
  state.busy = true;
  if (mode !== 'blitz') persist();
  renderBoard({ hideStateOfRow: rowIndex });
  await revealRow(rowIndex, guess, feedback, isCurrent);
  state.busy = false;
  if (state.profile !== profile) return;
  if (!isCurrent()) {
    // Der Spielstand wurde inzwischen mit einem anderen Gerät zusammengeführt.
    renderAll();
    return;
  }
  renderKeyboardStates();
  renderBlitzBar();
  const devilText = mode === 'extreme' ? showDevilCount(game) : null;
  announce(`Versuch ${rowIndex + 1}: ${describeFeedback(guess, feedback)}${devilText ? `. ${devilText}` : ''}`);
  if (mode === 'blitz') {
    if (game.status !== 'playing') afterBlitzWord(blitzRun, won, game.answer, game.guesses.length);
    return;
  }

  if (won) {
    toast(praise(rowIndex), 1800);
    bounceRow(rowIndex);
    playWin();
    burstConfetti();
    scheduleStats(profile, mode, game, REDUCED_MOTION ? 600 : 1800, unlocked);
  } else if (game.status === 'lost') {
    toast(game.answer, 2600);
    playLose();
    scheduleStats(profile, mode, game, 1800, unlocked);
  }
}

// Nach dem Ende einer Runde: erst neue Abzeichen feiern, dann das Ergebnis zeigen.
// statsTimer bleibt so lange gesetzt, damit Enter in der Zwischenzeit kein neues Wort startet.
function scheduleStats(profile, mode, game, delay, unlocked = []) {
  clearTimeout(state.statsTimer);
  const stillHere = () => state.profile === profile && state.mode === mode && currentGame() === game;
  const timer = setTimeout(async () => {
    if (stillHere()) await showBadgePopups(unlocked);
    if (state.statsTimer !== timer) return;
    state.statsTimer = null;
    if (stillHere()) showStats({ fromGameEnd: true });
  }, delay);
  state.statsTimer = timer;
}

// ---------- Statistik & Teilen ----------

// day: Tag des Tagesrätsels, damit die Statistik die Rätselnummer zeigt (der Reiter zeigt sie nicht).
function modeLabel(mode, variant, day = null) {
  if (mode === 'daily') return day ? `Tagesrätsel #${puzzleNumber(day)}` : 'Tagesrätsel';
  if (mode === 'endless') return 'Endlos';
  return `${EXTREME_VARIANTS[variant].emoji} ${EXTREME_VARIANTS[variant].label}`;
}

function shareText() {
  const { game, mode, variant, result } = state.statsView;
  const url = `${location.origin}${location.pathname}`;
  if (mode === 'blitz') {
    const row = result.words.map((w) => (w.solved ? '🟩' : '⬛')).join('');
    const words = result.solved === 1 ? 'Wort' : 'Wörter';
    return `Wordle Deutsch Blitz ⚡ ${result.score} Punkte · ${result.solved} ${words}\n\n${row}\n\n${url}`;
  }
  const score = game.status === 'won' ? game.guesses.length : 'X';
  if (mode === 'extreme') {
    const { maxGuesses: max } = EXTREME_VARIANTS[variant];
    return `Wordle Deutsch Extrem ${modeLabel(mode, variant)} ${score}/${max}\n\n${extremeShareGrid(game)}\n\n${url}`;
  }
  const title = mode === 'daily' ? `Wordle Deutsch #${puzzleNumber(game.day)}` : 'Wordle Deutsch (Endlos)';
  return `${title} ${score}/6\n\n${shareGrid(game.guesses, game.answer)}\n\n${url}`;
}

async function share() {
  if (!state.statsView) return;
  const text = shareText();
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('In die Zwischenablage kopiert');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    els.statsDialog.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    toast(ok ? 'In die Zwischenablage kopiert' : 'Kopieren nicht möglich');
  }
}

function secondsUntilBerlinMidnight() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return Math.max(0, 86_400 - (get('hour') * 3600 + get('minute') * 60 + get('second')));
}

function updateCountdown() {
  const total = secondsUntilBerlinMidnight();
  const pad = (n) => String(n).padStart(2, '0');
  const text = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  $('countdown').replaceChildren('Neues Tagesrätsel in ', Object.assign(document.createElement('strong'), { textContent: text }));
  checkNewDay();
}

function stopCountdown() {
  clearInterval(state.countdownTimer);
  state.countdownTimer = null;
}

function showStats({ fromGameEnd = false, tab = 'stats' } = {}) {
  if (!state.profile) return;
  if (state.busy && !fromGameEnd) return;
  if (fromGameEnd && document.querySelector('dialog[open]')) return;
  if (state.mode === 'blitz') {
    showBlitzStats(null, tab);
    return;
  }
  setBlitzView(false);
  const game = currentGame();
  const mode = state.mode;
  const variant = mode === 'extreme' ? extremeVariant() : null;
  const stats = currentStats();
  const finished = game.status !== 'playing';
  state.statsView = finished ? { game, mode, variant } : null;

  $('stats-mode').textContent = modeLabel(mode, variant, mode === 'daily' ? game.day : null);
  $('stat-played').textContent = stats.played;
  $('stat-winrate').textContent = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  $('stat-streak').textContent = mode === 'daily' ? currentDailyStreak(stats, state.today) : stats.streak;
  $('stat-max').textContent = stats.maxStreak;

  const max = Math.max(1, ...stats.dist);
  $('distribution').replaceChildren(
    ...stats.dist.map((count, i) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = i + 1;
      const bar = document.createElement('span');
      bar.className = 'bar';
      if (finished && game.status === 'won' && game.guesses.length === i + 1) bar.classList.add('is-current');
      bar.style.width = `${Math.max(7, (count / max) * 100)}%`;
      bar.textContent = count;
      li.append(label, bar);
      return li;
    }),
  );

  $('result-section').hidden = !finished;
  $('countdown').hidden = !(finished && mode === 'daily');
  stopCountdown();
  if (finished) {
    const won = game.status === 'won';
    // Das Lösungswort als kleine, schiefe Kacheln: grün bei Sieg, grau bei Niederlage.
    $('result-tiles').replaceChildren(
      ...letters(game.answer).map((ch, i) => {
        const tile = document.createElement('span');
        tile.className = 'tile';
        tile.dataset.state = won ? 'correct' : 'absent';
        tile.textContent = ch;
        tile.style.setProperty('--r', `${[-5, 4, -2, 5, -4][i % 5]}deg`);
        tile.style.setProperty('--y', `${[2, -3, 0, -2, 2][i % 5]}px`);
        return tile;
      }),
    );
    $('result-title').textContent = won ? 'Gewonnen! 🎉' : 'Leider verloren 😅';
    // Das Wort im Duden nachschlagen (nur das Lösungswort wird übertragen, sonst nichts).
    $('duden-link').href = `https://www.duden.de/suchen/dudenonline/${encodeURIComponent(game.answer.toLocaleLowerCase('de'))}`;
    const word = Object.assign(document.createElement('strong'), { textContent: game.answer });
    if (variant === 'devil' && game.status === 'lost' && game.remainingAtEnd > 1) {
      $('result-word').replaceChildren('Möglich gewesen wäre z. B. ', word, ` (noch ${game.remainingAtEnd} Wörter)`);
    } else {
      $('result-word').replaceChildren('Das Wort war: ', word);
    }
    $('next-label').textContent = mode === 'daily' ? 'Endlos spielen' : 'Nächstes Wort';
    if (mode === 'daily') {
      updateCountdown();
      state.countdownTimer = setInterval(updateCountdown, 1000);
    }
  }
  renderBadges();
  selectStatsTab(tab);
  openDialog(els.statsDialog);
}

// ---------- Blitz ----------

// status 'idle': wartet auf „Start“; 'over': Durchgang beendet.
function newBlitzRound(status = 'playing') {
  return { answer: randomAnswer(SOLUTIONS, state.blitzRound?.answer), guesses: [], status };
}

function blitzOver() {
  return !state.blitz && state.blitzRound?.status === 'over';
}

function blitzRemainingMs() {
  const run = state.blitz;
  if (run?.phase === 'running') return Math.max(0, run.endsAt - Date.now());
  return blitzOver() ? 0 : BLITZ_START_SECONDS * 1000;
}

// Restzeit als Uhr, z. B. 1:05 (aufgerundet, damit 0:00 erst am Ende erscheint).
function formatClock(ms) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// Anzeige über dem Spielfeld (Zeit, Punkte, Wörter, Kombo) und die Start-Karte.
function renderBlitzBar() {
  const on = state.mode === 'blitz';
  $('blitz-bar').hidden = !on;
  els.blitzStartPanel.hidden = !on || Boolean(state.blitz);
  if (!on) return;
  const run = state.blitz;
  const running = run?.phase === 'running';
  const left = blitzRemainingMs();
  const urgent = running && left <= BLITZ_URGENT_MS;
  // Nach dem Ende bleibt das Ergebnis des letzten Durchgangs stehen.
  const shown = run || (blitzOver() ? state.blitzLast : null);
  $('blitz-time').textContent = formatClock(left);
  $('blitz-points').textContent = shown?.score ?? 0;
  $('blitz-solved').textContent = shown?.solved ?? 0;
  const combo = running ? run.combo : 0;
  $('blitz-combo').hidden = combo < 2;
  $('blitz-combo').textContent = `×${combo}`;
  $('blitz-clock').classList.toggle('is-urgent', urgent);
  $('blitz-meter-fill').style.width = `${Math.min(1, left / (BLITZ_START_SECONDS * 1000)) * 100}%`;
  $('blitz-meter').classList.toggle('is-urgent', urgent);
  els.blitzSkip.disabled = !running || state.busy || state.blitzRound?.status !== 'playing';

  const over = blitzOver();
  $('blitz-start-title').textContent = over ? 'Zeit um!' : 'Blitz';
  els.blitzStart.lastChild.textContent = over ? ' Nochmal' : ' Start';
  const record = state.profile?.data.blitzStats.bestScore;
  $('blitz-record').textContent = record ? `Dein Rekord: ${record} Punkte` : '';
}

// Kurz aufsteigende Einblendung wie „+40“ über einem Feld der Blitz-Anzeige.
function floatText(id, text) {
  const host = $(id);
  const float = el('span', 'blitz-float', text);
  float.setAttribute('aria-hidden', 'true');
  host.append(float);
  float.addEventListener('animationend', () => float.remove(), { once: true });
  host.classList.remove('is-bumped');
  void host.offsetWidth;
  host.classList.add('is-bumped');
}

function hintBlitzStart() {
  if (Date.now() - state.blitzHintAt < 1800) return;
  state.blitzHintAt = Date.now();
  toast('Erst auf „Start“ drücken', 1400);
}

// 3, 2, 1, los! Erst danach lässt sich tippen.
function startBlitzCountdown() {
  if (state.mode !== 'blitz' || state.blitz || state.busy || !state.profile) return;
  if (els.statsDialog.open) els.statsDialog.close();
  clearToasts();
  state.blitzRound = newBlitzRound('idle');
  state.blitzLast = null;
  state.current = [];
  // score: Punkte, solved: gelöste Wörter, combo: gelöste Wörter in Folge.
  const run = { phase: 'countdown', endsAt: 0, score: 0, solved: 0, combo: 0, words: [], timer: null, lastTick: null };
  state.blitz = run;
  renderAll();
  const count = (n) => {
    if (state.blitz !== run) return;
    els.blitzCountdown.hidden = false;
    els.blitzCountdown.replaceChildren(el('span', '', n > 0 ? String(n) : 'Los!'));
    playCount(n);
    if (n > 0) run.timer = setTimeout(() => count(n - 1), 800);
    else startBlitzRun(run);
  };
  count(3);
}

function startBlitzRun(run) {
  run.phase = 'running';
  run.endsAt = Date.now() + BLITZ_START_SECONDS * 1000;
  run.timer = setInterval(tickBlitz, 100);
  state.blitzRound = newBlitzRound();
  state.current = [];
  renderAll();
  setTimeout(() => {
    if (state.blitz === run) els.blitzCountdown.hidden = true;
  }, 650);
}

function tickBlitz() {
  const run = state.blitz;
  if (run?.phase !== 'running') return;
  const left = run.endsAt - Date.now();
  // Während ein Wort aufgedeckt wird, endet der Durchgang erst danach (ein gelöstes Wort bringt noch Zeit).
  if (left <= 0 && !state.busy) {
    finishBlitz({ show: true });
    return;
  }
  const second = Math.ceil(left / 1000);
  if (left > 0 && left <= BLITZ_URGENT_MS && second !== run.lastTick) {
    run.lastTick = second;
    playTick(second <= 3);
  }
  renderBlitzBar();
}

// Beendet den Durchgang (oder bricht den Countdown ab) und speichert Rekorde, Durchgänge und Wörter.
// show: Ergebnis anzeigen (nur wenn die Zeit regulär abgelaufen ist).
function finishBlitz({ show = false } = {}) {
  const run = state.blitz;
  if (!run) return;
  clearTimeout(run.timer);
  clearInterval(run.timer);
  state.blitz = null;
  els.blitzCountdown.hidden = true;
  const round = state.blitzRound;
  if (run.phase !== 'running') {
    if (round) round.status = 'idle';
    renderBlitzBar();
    return;
  }
  // Das angefangene Wort zählt als nicht gelöst.
  if (round?.status === 'playing') run.words.push({ answer: round.answer, solved: false });
  if (round) round.status = 'over';
  state.blitzLast = { score: run.score, solved: run.solved };
  state.current = [];
  const data = state.profile?.data;
  const isNewBest = Boolean(data) && run.score > 0 && run.score > data.blitzStats.bestScore;
  if (data) data.blitzStats = recordBlitzRun(data.blitzStats, { score: run.score, words: run.solved });
  // Erst nach dem Speichern zeichnen, damit die Start-Karte schon den neuen Rekord zeigt.
  if (state.mode === 'blitz') renderAll();
  if (!data) return;
  const unlocked = collectAchievements();
  persist();
  if (!show) return;

  // Die Zeit ist um: ein Gong, kein Jubel. Gefeiert wird nur ein neues Abzeichen.
  playTimeUp();
  const profile = state.profile;
  const stillHere = () => state.profile === profile && state.mode === 'blitz' && !state.blitz;
  const result = { score: run.score, solved: run.solved, words: run.words, isNewBest };
  setTimeout(async () => {
    if (!stillHere()) return;
    await showBadgePopups(unlocked);
    if (stillHere() && !document.querySelector('dialog[open]')) showBlitzStats(result);
  }, 900);
}

function nextBlitzRound(run) {
  if (state.blitz !== run || run.phase !== 'running' || state.mode !== 'blitz') return;
  state.blitzRound = newBlitzRound();
  state.current = [];
  renderAll();
}

// Nach jedem Wort im Blitz: bei einem Sieg Punkte, Extrazeit und Kombo, sonst die Lösung zeigen
// und die Kombo zurücksetzen. Dann kurz Pause und das nächste Wort.
function afterBlitzWord(run, won, answer, guesses) {
  if (!run || state.blitz !== run) return;
  if (won) {
    run.combo += 1;
    const points = blitzPoints(guesses, run.combo);
    const bonus = blitzTimeBonus(guesses);
    run.score += points;
    run.solved += 1;
    run.endsAt += bonus * 1000;
    run.lastTick = null;
    run.words.push({ answer, solved: true, points });
    renderBlitzBar();
    floatText('blitz-points-box', `+${points}`);
    floatText('blitz-clock', `+${bonus} s`);
    if (run.combo >= 2) toast(`Kombo ×${run.combo}!`, 1100);
    announce(`Gelöst: ${points} Punkte und ${bonus} Sekunden extra.`);
    burstConfetti({ kind: 'burst', count: 45, origin: { x: 0.5, y: 0.4 }, power: 10 });
    playWin({ short: true });
  } else {
    run.combo = 0;
    run.words.push({ answer, solved: false });
    toast(answer, 1600);
    playLose();
    renderBlitzBar();
  }
  setTimeout(() => nextBlitzRound(run), won ? BLITZ_PAUSE - 400 : BLITZ_PAUSE);
}

// Wort überspringen: zählt als nicht gelöst und beendet die Kombo.
function skipBlitzWord() {
  const run = state.blitz;
  const round = state.blitzRound;
  if (run?.phase !== 'running' || state.busy || round?.status !== 'playing') return;
  run.words.push({ answer: round.answer, solved: false });
  run.combo = 0;
  round.status = 'lost';
  toast(round.answer, 1200);
  nextBlitzRound(run);
}

// Im Statistik-Dialog stehen im Blitz Rekord, Durchgänge und Schnitt statt der normalen Zahlen.
function setBlitzView(on) {
  $('blitz-stats').hidden = !on;
  $('stats-numbers').hidden = on;
  $('distribution').hidden = on;
  $('distribution-title').hidden = on;
  $('duden-link').hidden = on;
  $('result-tiles').hidden = on;
  $('result-word').hidden = on;
  $('blitz-result').hidden = !on;
}

function showBlitzStats(result = null, tab = 'stats') {
  setBlitzView(true);
  const { bestScore, runs, words } = state.profile.data.blitzStats;
  $('blitz-best').textContent = bestScore;
  $('blitz-runs').textContent = runs;
  $('blitz-average').textContent = runs ? (words / runs).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '0';
  $('stats-mode').textContent = '⚡ Blitz';
  $('result-section').hidden = !result;
  $('countdown').hidden = true;
  stopCountdown();
  state.statsView = result ? { mode: 'blitz', result } : null;
  if (result) {
    $('result-title').textContent = 'Zeit um! ⏱';
    $('blitz-score').textContent = result.score;
    $('blitz-score-label').textContent = `Punkte · ${result.solved} ${result.solved === 1 ? 'Wort' : 'Wörter'} gelöst`;
    $('blitz-best-note').hidden = !result.isNewBest;
    const rows = blitzRanking(rankingProfiles());
    const place = rankOf(rows, state.profile.id, (row) => row.score);
    $('blitz-rank').textContent =
      rows.length > 1 && bestScore > 0 && place
        ? `Mit deinem Rekord von ${bestScore} Punkten bist du auf Platz ${place} von ${rows.length}.`
        : '';
    $('blitz-words').replaceChildren(
      ...result.words.map((w) => {
        const li = el('li', w.solved ? 'is-solved' : 'is-missed', w.answer);
        if (w.solved) li.append(el('small', '', `+${w.points}`));
        li.setAttribute('aria-label', w.solved ? `${w.answer}, gelöst, ${w.points} Punkte` : `${w.answer}, nicht gelöst`);
        return li;
      }),
    );
    $('next-label').textContent = 'Nochmal';
  }
  renderBadges();
  selectStatsTab(tab);
  openDialog(els.statsDialog);
}

// ---------- Abzeichen ----------

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Trägt neu erreichte Abzeichen mit Datum ins Profil ein (wird mit dem Profil gespeichert).
function collectAchievements() {
  const unlocked = unlockAchievements(state.profile.data);
  for (const badge of unlocked) state.unseenBadges.add(badge.id);
  return unlocked;
}

function badgeItem(badge) {
  const li = el('li', badge.earned ? 'badge is-earned' : 'badge');
  li.dataset.tier = badge.tier;
  const medal = el('span', 'badge-medal', badge.icon);
  medal.setAttribute('aria-hidden', 'true');
  li.append(medal, el('span', 'badge-title', badge.title), el('span', 'badge-text', badge.text));
  if (badge.earned) {
    const date = badge.earnedAt ? formatDate(badge.earnedAt) : '';
    li.append(el('span', 'badge-date', date ? `${TIER_LABEL[badge.tier]} · ${date}` : TIER_LABEL[badge.tier]));
    if (state.unseenBadges.has(badge.id)) li.append(el('span', 'badge-new', 'Neu'));
    li.append(el('span', 'sr-only', 'erreicht'));
  } else {
    const progress = el('div', 'badge-progress');
    if (badge.target > 1) {
      const meter = el('div', 'meter');
      meter.setAttribute('aria-hidden', 'true');
      const fill = el('span');
      fill.style.width = `${(badge.progress / badge.target) * 100}%`;
      meter.append(fill);
      progress.append(meter, el('small', '', `${badge.progress} / ${badge.target}`));
    } else {
      progress.append(el('small', '', 'Noch offen'));
    }
    li.append(progress, el('span', 'sr-only', `noch nicht erreicht, ${badge.progress} von ${badge.target}`));
  }
  return li;
}

// Abzeichen-Reiter im Statistik-Dialog: Übersicht nach Stufen und alle Abzeichen nach Gruppen.
function renderBadges() {
  const list = achievements(state.profile.data);
  const earned = list.filter((a) => a.earned);
  const tierCount = (tier) => earned.filter((a) => a.tier === tier).length;
  $('badge-count').textContent = `${earned.length}/${list.length}`;
  $('badge-count').classList.toggle('has-new', state.unseenBadges.size > 0);
  $('badge-summary-count').textContent = earned.length;
  $('badge-summary-total').textContent = list.length;
  $('badge-summary-bar').style.width = `${(earned.length / list.length) * 100}%`;
  $('badge-gold').textContent = tierCount('gold');
  $('badge-silver').textContent = tierCount('silver');
  $('badge-bronze').textContent = tierCount('bronze');
  $('badge-groups').replaceChildren(
    ...ACHIEVEMENT_GROUPS.map((group) => {
      const items = list.filter((a) => a.group === group.id);
      const section = el('section', 'badge-group');
      const heading = el('h3', '', group.title);
      heading.append(el('span', 'badge-group-count', `${items.filter((a) => a.earned).length}/${items.length}`));
      const grid = el('ul', 'badge-grid');
      grid.append(...items.map(badgeItem));
      section.append(heading, grid);
      return section;
    }),
  );
}

function selectStatsTab(tab) {
  const badges = tab === 'badges';
  state.statsTab = badges ? 'badges' : 'stats';
  $('tab-stats').setAttribute('aria-selected', String(!badges));
  $('tab-badges').setAttribute('aria-selected', String(badges));
  $('panel-stats').hidden = badges;
  $('panel-badges').hidden = !badges;
  if (badges) {
    renderBadges();
    // Einmal angesehen, sind die neuen Abzeichen beim nächsten Mal nicht mehr „neu“.
    state.unseenBadges.clear();
    $('badge-count').classList.remove('has-new');
  }
}

// Zeigt neue Abzeichen nacheinander groß an, mit Klang und Konfetti in der Farbe der Stufe.
// Schließt sich von selbst, per Klick oder mit Enter, Leertaste oder Escape.
function showBadgePopups(list) {
  if (!list.length) return Promise.resolve();
  return new Promise((resolve) => {
    const popup = { queue: [...list], timer: null, next: null };
    popup.next = () => {
      clearTimeout(popup.timer);
      const badge = popup.queue.shift();
      if (!badge) {
        els.badgePopup.hidden = true;
        if (state.badgePopup === popup) state.badgePopup = null;
        resolve();
        return;
      }
      els.badgePopup.dataset.tier = badge.tier;
      $('badge-popup-icon').textContent = badge.icon;
      $('badge-popup-title').textContent = badge.title;
      $('badge-popup-text').textContent = badge.text;
      $('badge-popup-tier').textContent = TIER_LABEL[badge.tier];
      els.badgePopup.hidden = false;
      // Animation für jedes Abzeichen neu starten.
      for (const node of [els.badgePopup.firstElementChild, $('badge-popup-icon')]) {
        node.style.animation = 'none';
        void node.offsetWidth;
        node.style.animation = '';
      }
      state.unseenBadges.add(badge.id);
      playBadge(badge.tier);
      burstConfetti({ kind: 'burst', count: badge.tier === 'gold' ? 110 : 70, origin: { x: 0.5, y: 0.4 }, colors: TIER_CONFETTI[badge.tier], power: 12 });
      popup.timer = setTimeout(popup.next, BADGE_POPUP_MS);
    };
    state.badgePopup = popup;
    popup.next();
  });
}

function dismissBadgePopups() {
  const popup = state.badgePopup;
  if (!popup) return;
  popup.queue.length = 0;
  popup.next();
}

// ---------- Rangliste ----------

const RANKING_CAPTION = {
  daily: () => `Tagesrätsel #${puzzleNumber(state.today)}: weniger Versuche zuerst, bei Gleichstand die schnellere Zeit.`,
  streak: () => 'Aktuelle Serie im Tagesrätsel, bei Gleichstand zählt die beste Serie.',
  blitz: () => 'Höchste Punktzahl in einem Blitz-Durchgang, bei Gleichstand zählen die Wörter.',
  badges: () => 'Erreichte Abzeichen, bei Gleichstand zählen Gold und dann Silber.',
};

// Alle Profile für die Rangliste; das eigene mit seinem aktuellen, evtl. noch nicht gespeicherten Stand.
function rankingProfiles() {
  const list = state.profiles.map((p) => (state.profile && p.id === state.profile.id ? state.profile : p));
  if (state.profile && !list.includes(state.profile)) list.push(state.profile);
  return list;
}

// Zeilen einer Tafel: Platz (nur wer schon etwas erreicht hat), Wert rechts und eine Zeile unter dem Namen.
function rankingRows(board, profiles) {
  if (board === 'daily') {
    const rows = dailyRanking(profiles, state.today);
    return rows.map((row) => {
      if (row.tier === 0) {
        const place = rankOf(rows, row.id, (r) => `${r.tier}:${r.guesses}:${r.ms}`);
        return { ...row, place, value: `${row.guesses}/6`, sub: row.ms != null ? `gelöst in ${formatDuration(row.ms)}` : 'gelöst' };
      }
      if (row.tier === 1) return { ...row, value: '✗', sub: 'nicht gelöst' };
      if (row.tier === 2) return { ...row, value: '…', sub: `spielt gerade · ${row.guesses}/6`, empty: true };
      return { ...row, value: '–', sub: 'noch nicht gespielt', empty: true };
    });
  }
  if (board === 'streak') {
    const rows = streakRanking(profiles, state.today);
    return rows.map((row) => ({
      ...row,
      place: row.streak > 0 ? rankOf(rows, row.id, (r) => r.streak) : null,
      value: row.streak > 0 ? `🔥 ${row.streak}` : '0',
      sub: `beste Serie: ${row.best}`,
      empty: row.streak === 0,
    }));
  }
  if (board === 'blitz') {
    const rows = blitzRanking(profiles);
    return rows.map((row) => {
      const runs = `${row.runs} ${row.runs === 1 ? 'Durchgang' : 'Durchgänge'}`;
      const words = `max. ${row.words} ${row.words === 1 ? 'Wort' : 'Wörter'}`;
      return {
        ...row,
        place: row.score > 0 ? rankOf(rows, row.id, (r) => `${r.score}:${r.words}`) : null,
        value: row.score > 0 ? `⚡ ${row.score}` : '–',
        sub: row.runs ? `${runs} · ${words}` : 'noch nicht gespielt',
        empty: row.score === 0,
      };
    });
  }
  const rows = achievementRanking(profiles);
  return rows.map((row) => ({
    ...row,
    place: row.count > 0 ? rankOf(rows, row.id, (r) => `${r.count}:${r.gold}:${r.silver}`) : null,
    value: `🏅 ${row.count}`,
    sub: `${row.gold} Gold · ${row.silver} Silber`,
    empty: row.count === 0,
  }));
}

function renderRanking() {
  const board = state.rankingBoard;
  for (const tab of els.rankingDialog.querySelectorAll('[data-board]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.board === board));
  }
  $('ranking-caption').textContent = RANKING_CAPTION[board]();
  const rows = rankingRows(board, rankingProfiles());
  if (rows.length === 0) {
    els.rankingList.replaceChildren(el('li', 'ranking-row is-empty', 'Noch keine Profile.'));
    return;
  }
  // Hervorgehoben wird das gerade gespielte Profil, auf der Startseite das zuletzt gespielte.
  const ownId = state.profile?.id ?? lastProfileId();
  els.rankingList.replaceChildren(
    ...rows.map((row) => {
      const li = el('li', 'ranking-row');
      li.classList.toggle('is-me', row.id === ownId);
      li.classList.toggle('is-empty', Boolean(row.empty));
      const place = el('span', 'ranking-place', row.place ? MEDALS[row.place - 1] || `${row.place}.` : '–');
      place.classList.toggle('is-medal', Boolean(row.place && row.place <= MEDALS.length));
      place.setAttribute('aria-label', row.place ? `Platz ${row.place}` : 'ohne Platz');
      const avatar = el('span', 'avatar');
      avatar.setAttribute('aria-hidden', 'true');
      fillAvatar(avatar, row.name);
      const who = el('span', 'ranking-who');
      who.append(el('span', 'ranking-name', row.name), el('span', 'ranking-sub', row.sub));
      li.append(place, avatar, who, el('span', 'ranking-value', row.value));
      return li;
    }),
  );
}

function openRanking(board = state.rankingBoard) {
  state.rankingBoard = RANKING_CAPTION[board] ? board : 'daily';
  renderRanking();
  openDialog(els.rankingDialog);
  // Im Hintergrund auffrischen, damit auch Ergebnisse von anderen Geräten erscheinen.
  if (isCloud) {
    loadProfiles({ quiet: true }).then(() => {
      if (els.rankingDialog.open) renderRanking();
    });
  }
}

// Vom Statistik-Dialog aus: die Tafel, die zum gerade Gezeigten passt.
function openRankingFromStats() {
  if (state.statsTab === 'badges') openRanking('badges');
  else if (state.mode === 'blitz' || state.mode === 'daily') openRanking(state.mode);
  else openRanking();
}

function nextRound() {
  if (state.busy || !state.profile) return;
  if (els.statsDialog.open) els.statsDialog.close();
  if (state.mode === 'blitz') {
    startBlitzCountdown();
    return;
  }
  // setMode startet im Endlos- und Extrem-Modus automatisch ein neues Wort, wenn das letzte beendet ist.
  setMode(state.mode === 'daily' ? 'endless' : state.mode);
}

function selectVariant(variant) {
  if (state.busy || state.switching || !state.profile || !EXTREME_VARIANTS[variant]) return;
  if (state.mode === 'extreme' && variant === extremeVariant()) {
    // Dieselbe Variante nach einer beendeten Runde: nächstes Wort.
    if (currentGame().status !== 'playing' && !state.statsTimer) setMode('extreme');
    return;
  }
  state.profile.data.settings.extremeVariant = variant;
  setMode('extreme');
  persist();
  // Die Regel kurz einblenden, da über dem Spielfeld keine Erklärung mehr steht.
  const { emoji, label, short } = EXTREME_VARIANTS[variant];
  toast(`${emoji} ${label}: ${short}`, 2600);
}

// Auswahl der Extrem-Variante: alle vier mit ausführlicher Erklärung und eigener Statistik.
function openVariantPicker() {
  if (!state.profile) return;
  const current = extremeVariant();
  els.variantOptions.replaceChildren(
    ...EXTREME_KEYS.map((key) => {
      const { emoji, label, caption, maxGuesses: max } = EXTREME_VARIANTS[key];
      const { played, won } = state.profile.data.extremeStats[key];
      const option = el('button', 'variant-option');
      option.type = 'button';
      option.dataset.variant = key;
      option.setAttribute('aria-pressed', String(key === current));
      const icon = el('span', 'variant-option-emoji', emoji);
      icon.setAttribute('aria-hidden', 'true');
      const name = el('span', 'variant-option-name', label);
      if (key === current) name.append(el('span', 'variant-option-current', 'Aktiv'));
      const record = played ? `${won} von ${played} gewonnen` : 'noch nicht gespielt';
      option.append(icon, name, el('span', 'variant-option-text', caption), el('span', 'variant-option-meta', `${max} Versuche · ${record}`));
      return option;
    }),
  );
  openDialog(els.variantDialog);
}

// ---------- Einstellungen ----------

function syncThemeColor() {
  const theme = document.documentElement.dataset.theme;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const dark = theme === 'dark' || (!theme && meta.media.includes('dark'));
    meta.content = dark ? '#221921' : '#fff8f0';
  }
}

function applyTheme(value) {
  if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
  syncThemeColor();
}

function openSettings() {
  els.soundToggle.checked = isSoundEnabled();
  els.highContrast.checked = document.documentElement.dataset.contrast === 'high';
  els.themeSelect.value = document.documentElement.dataset.theme || 'system';
  openDialog(els.settingsDialog);
}

// ---------- Ereignisse ----------

function bindEvents() {
  els.profileList.addEventListener('click', (event) => {
    const card = event.target.closest('.profile-card');
    if (card) selectProfile(card.dataset.id);
  });
  els.localImportList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-import-id]');
    if (button && !button.disabled) importProfile(button);
  });

  els.rankingButton.addEventListener('click', () => openRanking());
  els.newProfileButton.addEventListener('click', () => {
    els.newProfileForm.reset();
    els.newProfileError.textContent = '';
    openDialog(els.newProfileDialog);
    els.newProfileName.focus();
  });
  els.newProfileForm.addEventListener('submit', submitNewProfile);

  els.switchProfile.addEventListener('click', async () => {
    if (state.busy || state.switching) return;
    state.switching = true;
    try {
      if (state.profile) await flushPending(state.profile.id, state.profile).catch(() => null);
    } finally {
      state.switching = false;
    }
    showProfileScreen();
  });

  for (const tab of document.querySelectorAll('.mode-tab')) {
    tab.addEventListener('click', () => {
      if (state.busy || state.switching || !state.profile) return;
      const mode = tab.dataset.mode;
      // Ein laufender Blitz-Durchgang darf nicht durch Antippen des Reiters neu beginnen.
      if (mode === 'blitz' && state.mode === 'blitz' && state.blitz) return;
      // Im Extrem-Modus öffnet nochmal Antippen die Auswahl der Variante.
      if (mode === 'extreme' && state.mode === 'extreme') {
        openVariantPicker();
        return;
      }
      if (mode !== state.mode) setMode(mode);
      // Nochmal auf den Reiter tippen startet nach einer beendeten Runde das nächste Wort.
      else if (mode !== 'daily' && currentGame().status !== 'playing' && !state.statsTimer) setMode(mode);
      // Beim ersten Besuch im Extrem-Modus (pro Gerät) gleich die Varianten mit Erklärung zeigen.
      if (mode === 'extreme' && !readSetting(EXTREME_INTRO_KEY)) {
        writeSetting(EXTREME_INTRO_KEY, '1');
        openVariantPicker();
      }
    });
  }
  els.variantOptions.addEventListener('click', (event) => {
    const option = event.target.closest('.variant-option');
    if (!option) return;
    els.variantDialog.close();
    selectVariant(option.dataset.variant);
  });
  els.blitzStart.addEventListener('click', startBlitzCountdown);
  els.blitzSkip.addEventListener('click', skipBlitzWord);

  els.keyboard.addEventListener('click', (event) => {
    const key = event.target.closest('.key');
    if (key) handleKey(key.dataset.key);
  });

  // Nach Mausklicks den Fokus lösen, bevor ein Dialog ihn sich merkt. Sonst würde Enter später
  // den Knopf erneut auslösen, statt das Wort abzuschicken. Läuft daher in der Capture-Phase.
  els.gameScreen.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('button');
      if (button && event.detail > 0) button.blur();
    },
    true,
  );

  document.addEventListener('keydown', (event) => {
    // Solange ein neues Abzeichen gezeigt wird, schließen Enter, Leertaste und Escape die Meldung.
    if (state.badgePopup) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
        event.preventDefault();
        if (!event.repeat) state.badgePopup.next();
      }
      return;
    }
    if (els.gameScreen.hidden || document.querySelector('dialog[open]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const onOtherControl =
      target instanceof HTMLElement && target.closest('button, input, select, textarea') && !target.closest('.key');

    if (event.key === 'Enter') {
      if (onOtherControl) return;
      event.preventDefault();
      // Gedrückt gehaltenes Enter nicht wiederholen (würde sonst das Ergebnis überspringen).
      if (!event.repeat) submitGuess();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      removeLetter();
    } else if (event.key === 'ß') {
      addLetter('S');
      addLetter('S');
    } else if (event.key.length === 1) {
      const letter = event.key.toLocaleUpperCase('de-DE');
      if (/^[A-ZÄÖÜ]$/.test(letter)) addLetter(letter);
    }
  });

  for (const button of document.querySelectorAll('[data-open]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.open;
      if (id === 'stats-dialog') showStats();
      else if (id === 'settings-dialog') openSettings();
      else openDialog($(id));
    });
  }

  for (const dialog of document.querySelectorAll('dialog')) {
    // Nur schließen, wenn der Klick auf dem abgedunkelten Hintergrund begonnen hat
    // (nicht beim Markieren von Text, das außerhalb endet).
    let pressedOnBackdrop = false;
    dialog.addEventListener('pointerdown', (event) => {
      pressedOnBackdrop = event.target === dialog;
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && pressedOnBackdrop) dialog.close();
      pressedOnBackdrop = false;
    });
    for (const close of dialog.querySelectorAll('[data-close]')) {
      close.addEventListener('click', () => dialog.close());
    }
    dialog.addEventListener('close', () => dialog.querySelector('.toasts')?.replaceChildren());
  }
  els.statsDialog.addEventListener('close', stopCountdown);

  $('share-button').addEventListener('click', share);
  $('next-button').addEventListener('click', nextRound);
  $('tab-stats').addEventListener('click', () => selectStatsTab('stats'));
  $('tab-badges').addEventListener('click', () => selectStatsTab('badges'));
  $('stats-ranking').addEventListener('click', openRankingFromStats);
  for (const tab of els.rankingDialog.querySelectorAll('[data-board]')) {
    tab.addEventListener('click', () => {
      state.rankingBoard = tab.dataset.board;
      renderRanking();
    });
  }
  els.badgePopup.addEventListener('click', () => state.badgePopup?.next());

  els.soundToggle.addEventListener('change', () => {
    setSoundEnabled(els.soundToggle.checked);
    // Kurzer Klick als Probe, damit man sofort hört, ob die Töne an sind.
    if (els.soundToggle.checked) playTap();
  });
  els.highContrast.addEventListener('change', () => {
    if (els.highContrast.checked) document.documentElement.dataset.contrast = 'high';
    else delete document.documentElement.dataset.contrast;
    writeSetting(CONTRAST_KEY, els.highContrast.checked ? '1' : null);
  });
  els.themeSelect.addEventListener('change', () => {
    const value = els.themeSelect.value;
    applyTheme(value);
    writeSetting(THEME_KEY, value === 'system' ? null : value);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    checkNewDay();
    if (state.profile) refreshFromCloud();
    else if (isCloud && !els.profileScreen.hidden) loadProfiles({ quiet: true });
  });
  window.addEventListener('online', () => {
    flushAllPending().then(() => {
      if (!state.profile && !els.profileScreen.hidden) loadProfiles({ quiet: true });
    });
  });
  setInterval(() => {
    checkNewDay();
    if (state.profile && hasPendingSave(state.profile.id)) flushPending(state.profile.id, state.profile).catch(() => null);
  }, 30_000);

  onConflictMerged((profile, previousData) => {
    if (profile === state.profile) applyProfileUpdate(gameIdentity(previousData));
  });
}

function init() {
  buildKeyboard();
  bindEvents();
  syncThemeColor();
  els.localHint.hidden = isCloud;
  showProfileScreen();
}

init();
