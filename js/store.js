// Speichert Profile in Supabase (geräteübergreifend) oder, ohne Konfiguration, im localStorage dieses Browsers.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { normalizeProfileData, mergeProfileData } from './game.js';

// Nur der Teil bis ".supabase.co" zählt, auch wenn "/rest/v1/" mitkopiert wurde.
const BASE_URL = String(SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const API_KEY = String(SUPABASE_KEY || '').trim();

export const isCloud = Boolean(BASE_URL && API_KEY);

const LOCAL_PROFILES_KEY = 'wordle-de:profiles';
const PENDING_PREFIX = 'wordle-de:pending:';
const NAME_MAX = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const SELECT = 'select=id,name,data,updated_at';

// Noch nicht hochgeladene Spielstände: { data, base }, wobei base der Serverstand (updated_at) ist,
// auf dem die Daten aufbauen. Zusätzlich im Speicher, falls localStorage nicht verfügbar ist.
const memoryPending = new Map();
const inflight = new Map();
let conflictHandler = null;

export class StoreError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toProfile(row) {
  return {
    id: row.id,
    name: row.name,
    data: normalizeProfileData(row.data),
    updatedAt: row.updated_at || null,
  };
}

export function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

// Supabase liefert Zeitstempel mit Mikrosekunden; manche Browser parsen nur Millisekunden.
export function timeValue(stamp) {
  if (!stamp) return 0;
  return Date.parse(String(stamp).replace(/(\.\d{3})\d+/, '$1')) || 0;
}

// Wird aufgerufen, wenn ein Profil nach einem Speicherkonflikt mit dem Serverstand zusammengeführt wurde.
export function onConflictMerged(handler) {
  conflictHandler = handler;
}

// --- Supabase (REST, ohne Zusatzbibliothek) ---

function headers(extra = {}) {
  const h = { apikey: API_KEY, 'Content-Type': 'application/json', ...extra };
  // Ältere "anon"-Schlüssel sind JWTs und gehören zusätzlich in den Authorization-Header,
  // die neuen "sb_publishable_…"-Schlüssel nicht.
  if (!API_KEY.startsWith('sb_')) h.Authorization = `Bearer ${API_KEY}`;
  return h;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${BASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: headers(options.headers),
      signal: controller.signal,
    });
  } catch {
    throw new StoreError('Server nicht erreichbar. Bist du online?', 'offline');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let detail = null;
    try {
      detail = await response.json();
    } catch {
      // Antwort ohne JSON-Body
    }
    if (response.status === 409 || detail?.code === '23505') {
      throw new StoreError('Diesen Namen gibt es schon.', 'duplicate');
    }
    if (response.status >= 500) {
      throw new StoreError('Server gerade nicht erreichbar. Bitte später erneut versuchen.', 'server');
    }
    throw new StoreError(`Speicherfehler (${response.status})`, 'server');
  }
  return response.status === 204 ? null : response.json();
}

// --- Vorgemerkte Speicherungen ---

function readPending(id) {
  if (memoryPending.has(id)) return memoryPending.get(id);
  const raw = readLocal(PENDING_PREFIX + id, null);
  if (!raw) return null;
  // Ältere Version hat nur die Daten ohne Serverstand gespeichert.
  return 'data' in raw && 'base' in raw ? raw : { data: raw, base: null };
}

function writePending(id, entry) {
  memoryPending.set(id, entry);
  writeLocal(PENDING_PREFIX + id, entry);
}

function clearPending(id) {
  memoryPending.delete(id);
  writeLocal(PENDING_PREFIX + id, undefined);
}

function pendingIds() {
  const ids = new Set(memoryPending.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PENDING_PREFIX)) ids.add(key.slice(PENDING_PREFIX.length));
    }
  } catch {
    // localStorage nicht verfügbar
  }
  return [...ids];
}

export function hasPendingSave(id) {
  return isCloud && readPending(id) !== null;
}

// --- Öffentliche Schnittstelle ---

export async function listProfiles() {
  if (!isCloud) return readLocal(LOCAL_PROFILES_KEY, []).map(toProfile);
  // Liegengebliebene Speicherungen (auch anderer Profile) zuerst hochladen.
  await flushAllPending();
  const rows = await request(`profiles?${SELECT}&order=name.asc`);
  return rows.map((row) => {
    const profile = toProfile(row);
    const pending = readPending(profile.id);
    // Noch nicht hochgeladene Änderungen dieses Geräts haben Vorrang.
    if (pending) profile.data = normalizeProfileData(pending.data);
    return profile;
  });
}

export async function fetchProfile(id) {
  if (!isCloud) {
    const row = readLocal(LOCAL_PROFILES_KEY, []).find((p) => p.id === id);
    return row ? toProfile(row) : null;
  }
  const rows = await request(`profiles?id=eq.${encodeURIComponent(id)}&${SELECT}`);
  return rows[0] ? toProfile(rows[0]) : null;
}

export async function createProfile(rawName, data) {
  const name = cleanName(rawName);
  if (!name) throw new StoreError('Bitte einen Namen eingeben.', 'invalid');

  if (!isCloud) {
    const rows = readLocal(LOCAL_PROFILES_KEY, []);
    if (rows.some((p) => p.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) {
      throw new StoreError('Diesen Namen gibt es schon.', 'duplicate');
    }
    const row = { id: crypto.randomUUID(), name, data, updated_at: new Date().toISOString() };
    rows.push(row);
    if (!writeLocal(LOCAL_PROFILES_KEY, rows)) throw new StoreError('Speichern im Browser nicht möglich.', 'storage');
    return toProfile(row);
  }

  const rows = await request(`profiles?${SELECT}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name, data }),
  });
  return toProfile(rows[0]);
}

// Speichert die Profildaten. Ergebnis: { status: 'ok' | 'offline' | 'error' | 'missing', error? }.
// Was nicht hochgeladen werden konnte, bleibt vorgemerkt und wird später erneut gesendet.
export async function saveProfile(profile) {
  if (!isCloud) {
    const rows = readLocal(LOCAL_PROFILES_KEY, []);
    const row = rows.find((p) => p.id === profile.id);
    if (!row) return { status: 'missing' };
    row.data = profile.data;
    row.updated_at = new Date().toISOString();
    if (!writeLocal(LOCAL_PROFILES_KEY, rows)) {
      return { status: 'error', error: new StoreError('Speichern im Browser nicht möglich.', 'storage') };
    }
    profile.updatedAt = row.updated_at;
    return { status: 'ok' };
  }

  const previous = readPending(profile.id);
  writePending(profile.id, {
    data: clone(profile.data),
    // Baut auf demselben Serverstand auf wie eine noch nicht gesendete Änderung.
    base: previous ? previous.base : profile.updatedAt,
  });
  return flushPending(profile.id, profile);
}

// Sendet vorgemerkte Daten. Aufrufe für dasselbe Profil laufen nacheinander,
// damit eine ältere Speicherung nie eine neuere überholt.
export function flushPending(id, profile = null) {
  if (!isCloud) return Promise.resolve({ status: 'ok' });
  const previous = inflight.get(id) || Promise.resolve();
  const run = previous.catch(() => {}).then(() => flushNow(id, profile));
  inflight.set(id, run);
  const cleanup = () => {
    if (inflight.get(id) === run) inflight.delete(id);
  };
  run.then(cleanup, cleanup);
  return run;
}

export async function flushAllPending() {
  if (!isCloud) return;
  await Promise.all(pendingIds().map((id) => flushPending(id).catch(() => null)));
}

async function flushNow(id, profile) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = readPending(id);
    if (!entry) return { status: 'ok' };

    // Nur speichern, wenn auf dem Server noch der Stand liegt, auf dem diese Daten aufbauen.
    const guard = entry.base ? `&updated_at=eq.${encodeURIComponent(entry.base)}` : '';
    let rows;
    try {
      rows = await request(`profiles?id=eq.${encodeURIComponent(id)}${guard}&${SELECT}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ data: entry.data, updated_at: new Date().toISOString() }),
      });
    } catch (error) {
      return { status: error.code === 'offline' ? 'offline' : 'error', error };
    }

    if (rows.length > 0) {
      const savedAt = rows[0].updated_at;
      const latest = readPending(id);
      if (latest && JSON.stringify(latest.data) === JSON.stringify(entry.data)) clearPending(id);
      // Was inzwischen neu vorgemerkt wurde, baut jetzt auf dem gerade gespeicherten Stand auf.
      else if (latest) writePending(id, { ...latest, base: savedAt });
      if (profile) profile.updatedAt = savedAt;
      return { status: 'ok' };
    }

    // Kein Treffer: Ein anderes Gerät hat zwischendurch gespeichert (oder das Profil wurde gelöscht).
    let remote;
    try {
      remote = await fetchProfile(id);
    } catch (error) {
      return { status: error.code === 'offline' ? 'offline' : 'error', error };
    }
    if (!remote) {
      clearPending(id);
      return { status: 'missing' };
    }
    const latest = readPending(id) || entry;
    const merged = mergeProfileData(remote.data, latest.data);
    writePending(id, { data: clone(merged), base: remote.updatedAt });
    if (profile) {
      profile.data = merged;
      profile.updatedAt = remote.updatedAt;
      conflictHandler?.(profile);
    }
  }
  return { status: 'error', error: new StoreError('Speichern fehlgeschlagen.', 'conflict') };
}

// Profile, die vor der Supabase-Einrichtung nur im Browser angelegt wurden.
export function listLocalOnlyProfiles() {
  if (!isCloud) return [];
  return readLocal(LOCAL_PROFILES_KEY, []).map(toProfile);
}

// Lädt ein lokales Profil samt Statistik zu Supabase hoch und entfernt es danach aus dem Browser.
export async function importLocalProfile(id) {
  const local = listLocalOnlyProfiles().find((p) => p.id === id);
  if (!local) throw new StoreError('Profil nicht gefunden.', 'missing');
  const profile = await createProfile(local.name, local.data);
  writeLocal(
    LOCAL_PROFILES_KEY,
    readLocal(LOCAL_PROFILES_KEY, []).filter((p) => p.id !== id),
  );
  return profile;
}
