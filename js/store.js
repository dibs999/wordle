// Speichert Profile in Supabase (geräteübergreifend) oder, ohne Konfiguration, im localStorage dieses Browsers.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { normalizeProfileData } from './game.js';

export const isCloud = Boolean(SUPABASE_URL && SUPABASE_KEY);

const LOCAL_PROFILES_KEY = 'wordle-de:profiles';
const PENDING_PREFIX = 'wordle-de:pending:';
const NAME_MAX = 20;

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

function toProfile(row) {
  return {
    id: row.id,
    name: row.name,
    data: normalizeProfileData(row.data),
    updatedAt: row.updated_at,
  };
}

export function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

// --- Supabase (REST, ohne Zusatzbibliothek) ---

function headers(extra = {}) {
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...extra };
  // Ältere "anon"-Schlüssel sind JWTs und gehören zusätzlich in den Authorization-Header,
  // die neuen "sb_publishable_…"-Schlüssel nicht.
  if (!SUPABASE_KEY.startsWith('sb_')) h.Authorization = `Bearer ${SUPABASE_KEY}`;
  return h;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
      ...options,
      headers: headers(options.headers),
    });
  } catch {
    throw new StoreError('Server nicht erreichbar. Bist du online?', 'offline');
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
    throw new StoreError(`Speicherfehler (${response.status})`, 'server');
  }
  return response.status === 204 ? null : response.json();
}

// --- Öffentliche Schnittstelle ---

export async function listProfiles() {
  if (!isCloud) return readLocal(LOCAL_PROFILES_KEY, []).map(toProfile);
  const rows = await request('profiles?select=id,name,data,updated_at&order=name.asc');
  return rows.map((row) => {
    const profile = toProfile(row);
    // Noch nicht hochgeladene Änderungen dieses Geräts haben Vorrang.
    const pending = readLocal(PENDING_PREFIX + profile.id, null);
    if (pending) profile.data = normalizeProfileData(pending);
    return profile;
  });
}

export async function fetchProfile(id) {
  if (!isCloud) {
    const row = readLocal(LOCAL_PROFILES_KEY, []).find((p) => p.id === id);
    return row ? toProfile(row) : null;
  }
  const rows = await request(`profiles?id=eq.${encodeURIComponent(id)}&select=id,name,data,updated_at`);
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

  const rows = await request('profiles?select=id,name,data,updated_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name, data }),
  });
  return toProfile(rows[0]);
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

export function hasPendingSave(id) {
  return isCloud && readLocal(PENDING_PREFIX + id, null) !== null;
}

// Speichert die Profildaten. Schlägt das Hochladen fehl, bleiben sie lokal liegen
// und werden beim nächsten Speichern oder bei flushPending() erneut gesendet.
export async function saveProfile(profile) {
  const updatedAt = new Date().toISOString();

  if (!isCloud) {
    const rows = readLocal(LOCAL_PROFILES_KEY, []);
    const row = rows.find((p) => p.id === profile.id);
    if (!row) throw new StoreError('Profil nicht gefunden.', 'missing');
    row.data = profile.data;
    row.updated_at = updatedAt;
    if (!writeLocal(LOCAL_PROFILES_KEY, rows)) throw new StoreError('Speichern im Browser nicht möglich.', 'storage');
    profile.updatedAt = updatedAt;
    return true;
  }

  writeLocal(PENDING_PREFIX + profile.id, profile.data);
  return flushPending(profile.id);
}

export async function flushPending(id) {
  if (!isCloud) return true;
  const data = readLocal(PENDING_PREFIX + id, null);
  if (!data) return true;
  try {
    await request(`profiles?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
    });
  } catch (error) {
    if (error.code === 'offline' || error.code === 'server') return false;
    throw error;
  }
  // Nur entfernen, wenn in der Zwischenzeit nichts Neueres vorgemerkt wurde.
  const latest = readLocal(PENDING_PREFIX + id, null);
  if (JSON.stringify(latest) === JSON.stringify(data)) writeLocal(PENDING_PREFIX + id, undefined);
  return true;
}
