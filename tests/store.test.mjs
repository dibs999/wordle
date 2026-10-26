// Tests für das Speichern mit Supabase, gegen einen nachgebauten Server (kein Netzwerk nötig).

import test from 'node:test';
import assert from 'node:assert/strict';

// --- Browser-Umgebung nachbilden ---

const storage = new Map();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  key: (i) => [...storage.keys()][i] ?? null,
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

// Nachbau der PostgREST-Schnittstelle für die Tabelle "profiles".
const server = {
  rows: new Map(),
  online: true,
  requests: [],
  // Supabase liefert Zeitstempel mit Mikrosekunden und "+00:00".
  stamp(date) {
    return new Date(date).toISOString().replace('Z', '123+00:00');
  },
};

function filters(url) {
  const params = new URL(url).searchParams;
  const id = params.get('id')?.replace(/^eq\./, '');
  const updatedAt = params.get('updated_at')?.replace(/^eq\./, '');
  return { id, updatedAt };
}

const same = (a, b) => Date.parse(a.replace(/(\.\d{3})\d+/, '$1')) === Date.parse(b.replace(/(\.\d{3})\d+/, '$1'));

globalThis.fetch = async (url, options = {}) => {
  server.requests.push(`${options.method || 'GET'} ${url}`);
  if (!server.online) throw new TypeError('Failed to fetch');
  const method = options.method || 'GET';
  const { id, updatedAt } = filters(url);
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (method === 'GET') {
    const rows = [...server.rows.values()].filter((r) => !id || r.id === id);
    return json(rows.map((r) => structuredClone(r)));
  }
  if (method === 'POST') {
    const body = JSON.parse(options.body);
    const row = { id: crypto.randomUUID(), name: body.name, data: body.data, updated_at: server.stamp(Date.now()) };
    server.rows.set(row.id, row);
    return json([structuredClone(row)], 201);
  }
  if (method === 'PATCH') {
    const body = JSON.parse(options.body);
    const row = server.rows.get(id);
    if (!row || (updatedAt && !same(row.updated_at, updatedAt))) return json([]);
    row.data = body.data;
    row.updated_at = server.stamp(body.updated_at);
    return json([structuredClone(row)]);
  }
  return json({ message: 'unsupported' }, 400);
};

const store = await import('../js/store.js');
const { emptyProfileData } = await import('../js/game.js');

let clock = Date.parse('2026-10-26T10:00:00Z');
const RealDate = Date;
// Jede Speicherung bekommt einen eigenen, späteren Zeitstempel.
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      clock += 1000;
      super(clock);
    } else {
      super(...args);
    }
  }
  static now() {
    clock += 1000;
    return clock;
  }
};

async function newProfile(name) {
  const created = await store.createProfile(name, emptyProfileData());
  return store.fetchProfile(created.id);
}

// Ohne Supabase-Konfiguration in js/config.js werden diese Tests übersprungen.
test('Speichern lädt hoch und merkt den Serverstand', { skip: !store.isCloud }, async () => {
  const profile = await newProfile('Anna');
  profile.data.settings.extremeVariant = 'blind';
  const result = await store.saveProfile(profile);
  assert.equal(result.status, 'ok');
  assert.equal(store.hasPendingSave(profile.id), false);
  assert.equal(server.rows.get(profile.id).data.settings.extremeVariant, 'blind');
  assert.equal(profile.updatedAt, server.rows.get(profile.id).updated_at);
});

test('offline gespeicherte Runden werden später nachgereicht', { skip: !store.isCloud }, async () => {
  const profile = await newProfile('Ben');
  server.online = false;
  profile.data.endless = { answer: 'KATZE', guesses: ['KANNE'], status: 'playing' };
  assert.equal((await store.saveProfile(profile)).status, 'offline');
  assert.equal(store.hasPendingSave(profile.id), true);

  server.online = true;
  await store.flushAllPending();
  assert.equal(store.hasPendingSave(profile.id), false);
  assert.deepEqual(server.rows.get(profile.id).data.endless.guesses, ['KANNE']);
});

test('veraltetes Gerät überschreibt keinen neueren Stand, sondern führt zusammen', { skip: !store.isCloud }, async () => {
  const profile = await newProfile('Clara');
  let merged = null;
  store.onConflictMerged((p) => {
    merged = p;
  });

  // Anderes Gerät löst inzwischen das Tagesrätsel.
  const row = server.rows.get(profile.id);
  row.data = {
    ...row.data,
    daily: { day: '2026-10-26', answer: 'APFEL', guesses: ['APFEL'], status: 'won' },
    stats: { ...row.data.stats, daily: { ...row.data.stats.daily, played: 1, won: 1 } },
  };
  row.updated_at = server.stamp(Date.now());

  // Dieses Gerät kennt den Stand noch nicht und spielt Endlos.
  profile.data.endless = { answer: 'KATZE', guesses: ['KANNE'], status: 'playing' };
  const result = await store.saveProfile(profile);

  assert.equal(result.status, 'ok');
  const saved = server.rows.get(profile.id).data;
  assert.equal(saved.daily.status, 'won', 'Sieg vom anderen Gerät bleibt erhalten');
  assert.equal(saved.stats.daily.played, 1);
  assert.deepEqual(saved.endless.guesses, ['KANNE'], 'eigene Runde bleibt erhalten');
  assert.equal(merged, profile, 'App wird über das Zusammenführen informiert');
  assert.equal(profile.data.daily.status, 'won');
  assert.equal(store.hasPendingSave(profile.id), false);
});

test('schnell hintereinander gespeicherte Stände kommen in der richtigen Reihenfolge an', { skip: !store.isCloud }, async () => {
  const profile = await newProfile('Dora');
  const saves = [];
  for (const guesses of [['LEBEN'], ['LEBEN', 'ESSEN'], ['LEBEN', 'ESSEN', 'APFEL']]) {
    profile.data.endless = { answer: 'APFEL', guesses, status: guesses.length === 3 ? 'won' : 'playing' };
    saves.push(store.saveProfile(profile));
  }
  const results = await Promise.all(saves);
  assert.ok(results.every((r) => r.status === 'ok'));
  assert.deepEqual(server.rows.get(profile.id).data.endless.guesses, ['LEBEN', 'ESSEN', 'APFEL']);
  assert.equal(store.hasPendingSave(profile.id), false);
});

test('gleichzeitig gespielte Runden auf zwei Geräten werden nie doppelt gezählt', { skip: !store.isCloud }, async () => {
  const { recordEndlessResult } = await import('../js/game.js');
  const profile = await newProfile('Emil');

  // Anderes Gerät gewinnt eine Endlos-Runde und speichert.
  const row = server.rows.get(profile.id);
  row.data = { ...row.data, stats: { ...row.data.stats, endless: recordEndlessResult(row.data.stats.endless, true, 2) } };
  row.updated_at = server.stamp(Date.now());

  // Dieses Gerät verliert zeitgleich eine Runde, ohne den neuen Stand zu kennen.
  profile.data.stats.endless = recordEndlessResult(profile.data.stats.endless, false, 6);
  const result = await store.saveProfile(profile);

  assert.equal(result.status, 'ok');
  const saved = server.rows.get(profile.id).data.stats.endless;
  assert.equal(saved.played, 1, 'nicht 2 oder 3: keine Doppelzählung');
  assert.equal(store.hasPendingSave(profile.id), false);

  // Eine weitere Runde danach zählt genau einmal dazu.
  profile.data.stats.endless = recordEndlessResult(profile.data.stats.endless, true, 3);
  await store.saveProfile(profile);
  assert.equal(server.rows.get(profile.id).data.stats.endless.played, 2);
});
