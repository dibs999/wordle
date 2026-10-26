import { SOLUTIONS, ALLOWED } from './words.js';
import {
  WORD_LENGTH,
  MAX_GUESSES,
  EXTREME_VARIANTS,
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
  countsSnapshot,
  reuseUnchangedGames,
  dailyRanking,
  streakRanking,
  formatDuration,
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
import { playTap, playFlip, playInvalid, playWin, playLose, isSoundEnabled, setSoundEnabled } from './sound.js';

const ALLOWED_SET = new Set([...ALLOWED, ...SOLUTIONS]);
const LAST_PROFILE_KEY = 'wordle-de:last-profile';
const THEME_KEY = 'wordle-de:theme';
const CONTRAST_KEY = 'wordle-de:contrast';
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
  dailyNumber: $('daily-number'),
  variantBar: $('variant-bar'),
  variantCaption: $('variant-caption'),
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
  rankingDaily: $('ranking-daily'),
  rankingStreak: $('ranking-streak'),
  themeSelect: $('theme-select'),
};

const state = {
  profiles: [],
  profile: null,
  mode: 'daily', // 'daily' | 'endless' | 'extreme'
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
  state.mode = mode;
  state.current = [];
  clearTimeout(state.statsTimer);
  state.statsTimer = null;
  ensureGames();
  if (mode !== 'daily' && currentGame().status !== 'playing') {
    startNextRound();
    // Gleich speichern, damit ein Abgleich mit dem Server die neue Runde nicht wieder verdrängt.
    persist();
  }
  els.dailyNumber.textContent = `#${puzzleNumber(state.today)}`;
  clearToasts();
  renderAll();
}

// Reiter, Varianten-Knöpfe und Variantenleiste passend zum aktuellen Spielstand.
function syncModeChrome() {
  for (const tab of document.querySelectorAll('.mode-tab')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.mode === state.mode));
  }
  for (const chip of document.querySelectorAll('.variant-chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.variant === extremeVariant()));
  }
  els.variantBar.hidden = state.mode !== 'extreme';
}

function renderAll() {
  syncModeChrome();
  renderBoard();
  renderKeyboardStates();
  renderCaption();
}

function renderCaption() {
  if (state.mode !== 'extreme') return;
  const variant = extremeVariant();
  const game = currentGame();
  let text = EXTREME_VARIANTS[variant].caption;
  if (variant === 'devil' && game.status === 'playing' && game.guesses.length > 0) {
    const left = devilCandidates(game, SOLUTIONS).length;
    text = left === 1 ? 'Nur noch ein Wort möglich!' : `Noch ${left} Wörter möglich.`;
  }
  els.variantCaption.textContent = text;
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
  els.dailyNumber.textContent = `#${puzzleNumber(state.today)}`;
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
  profile.syncedCounts = countsSnapshot(remote.data);
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
        playFlip(states[i]);
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
  if (inputBlocked() || state.current.length >= WORD_LENGTH) return;
  state.current.push(letter);
  renderCurrentRow();
  const tile = rowTiles(currentGame().guesses.length)[state.current.length - 1];
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
  if (game.status !== 'playing') {
    // Im Endlos- und Extrem-Modus startet Enter nach einer Runde das nächste Wort
    // (erst wenn das Ergebnis angezeigt wurde).
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
  // Zeiten für die Rangliste: vom ersten Versuch bis zum Ende der Runde.
  if (firstGuess) game.startedAt = Date.now();
  if (game.status !== 'playing') game.finishedAt = Date.now();

  if (game.status !== 'playing') {
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
  }

  const profile = state.profile;
  const mode = state.mode;
  const isCurrent = () => state.profile === profile && state.mode === mode && currentGame() === game;
  state.busy = true;
  persist();
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
  renderCaption();
  announce(`Versuch ${rowIndex + 1}: ${describeFeedback(guess, feedback)}`);

  if (won) {
    toast(praise(rowIndex), 1800);
    bounceRow(rowIndex);
    playWin();
    burstConfetti();
    scheduleStats(profile, mode, game, REDUCED_MOTION ? 600 : 1800);
  } else if (game.status === 'lost') {
    toast(game.answer, 2600);
    playLose();
    scheduleStats(profile, mode, game, 1800);
  }
}

function scheduleStats(profile, mode, game, delay) {
  clearTimeout(state.statsTimer);
  state.statsTimer = setTimeout(() => {
    state.statsTimer = null;
    if (state.profile !== profile || state.mode !== mode || currentGame() !== game) return;
    showStats({ fromGameEnd: true });
  }, delay);
}

// ---------- Statistik & Teilen ----------

function modeLabel(mode, variant) {
  if (mode === 'daily') return 'Tagesrätsel';
  if (mode === 'endless') return 'Endlos';
  return `${EXTREME_VARIANTS[variant].emoji} ${EXTREME_VARIANTS[variant].label}`;
}

function shareText() {
  const { game, mode, variant } = state.statsView;
  const score = game.status === 'won' ? game.guesses.length : 'X';
  const url = `${location.origin}${location.pathname}`;
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

function showStats({ fromGameEnd = false } = {}) {
  if (!state.profile) return;
  if (state.busy && !fromGameEnd) return;
  if (fromGameEnd && document.querySelector('dialog[open]')) return;
  const game = currentGame();
  const mode = state.mode;
  const variant = mode === 'extreme' ? extremeVariant() : null;
  const stats = currentStats();
  const finished = game.status !== 'playing';
  state.statsView = finished ? { game, mode, variant } : null;

  $('stats-mode').textContent = modeLabel(mode, variant);
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
  openDialog(els.statsDialog);
}

// Rangliste: wer hat heute schon gelöst und wer hat die längste Serie. Stand aus den geladenen Profilen.
function renderRanking() {
  const describe = (row) => {
    if (row.tier === 0) return `✓ ${row.guesses}/6${row.ms != null ? ` · ${formatDuration(row.ms)}` : ''}`;
    if (row.tier === 1) return '✗ verloren';
    if (row.tier === 2) return `läuft · ${row.guesses}/6`;
    return 'noch offen';
  };
  const entry = (name, value) => {
    const li = document.createElement('li');
    const nameEl = Object.assign(document.createElement('span'), { className: 'ranking-name', textContent: name });
    const valueEl = Object.assign(document.createElement('span'), { className: 'ranking-value', textContent: value });
    li.append(nameEl, valueEl);
    return li;
  };
  els.rankingDaily.replaceChildren(
    ...dailyRanking(state.profiles, state.today).map((row) => entry(row.name, describe(row))),
  );
  els.rankingStreak.replaceChildren(
    ...streakRanking(state.profiles, state.today).map((row) => entry(row.name, row.streak ? `🔥 ${row.streak}` : '–')),
  );
}

function openRanking() {
  renderRanking();
  openDialog(els.rankingDialog);
  // Im Hintergrund auffrischen, damit auch Ergebnisse von anderen Geräten erscheinen.
  if (isCloud) loadProfiles({ quiet: true }).then(() => {
    if (els.rankingDialog.open) renderRanking();
  });
}

function nextRound() {
  if (state.busy || !state.profile) return;
  if (els.statsDialog.open) els.statsDialog.close();
  // setMode startet im Endlos- und Extrem-Modus automatisch ein neues Wort, wenn das letzte beendet ist.
  setMode(state.mode === 'daily' ? 'endless' : state.mode);
}

function selectVariant(variant) {
  if (state.busy || state.switching || !state.profile || !EXTREME_VARIANTS[variant]) return;
  if (state.mode === 'extreme' && variant === extremeVariant()) return;
  state.profile.data.settings.extremeVariant = variant;
  setMode('extreme');
  persist();
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

  els.rankingButton.addEventListener('click', openRanking);
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
      if (mode !== state.mode) setMode(mode);
      // Nochmal auf den Reiter tippen startet nach einer beendeten Runde das nächste Wort.
      else if (mode !== 'daily' && currentGame().status !== 'playing' && !state.statsTimer) setMode(mode);
    });
  }
  for (const chip of document.querySelectorAll('.variant-chip')) {
    chip.addEventListener('click', () => selectVariant(chip.dataset.variant));
  }

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
