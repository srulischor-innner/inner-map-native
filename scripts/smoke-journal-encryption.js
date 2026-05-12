// Logic smoke test for the journal AsyncStorage → encrypted MMKV
// migration. Runs in plain Node — no React Native runtime, no native
// modules. Uses in-memory mocks for AsyncStorage + MMKV + SecureStore
// and runs the same migration contract that services/journalMigration.ts
// implements.
//
// The migration logic is RE-IMPLEMENTED inside this test as
// `runMigrationWith` (verbatim mirror of the TS source — keep these
// two in lockstep on any contract change). The point of the smoke
// test is to lock the BEHAVIORS: verify-before-delete, idempotency,
// fresh-install fast path, parse-failure preservation, etc.
//
// Run: node scripts/smoke-journal-encryption.js
// Output: STEP lines, ALL GREEN on success.
//
// No new dependencies — pure Node.

// ============================================================================
// Migration logic — mirror of services/journalMigration.ts:runMigrationWith().
// Any behavioral change there MUST be reflected here, and vice versa.
// The contract is small enough that drift would be caught in review.
// ============================================================================

const MIGRATION_FLAG = 'journalMigrationComplete';
const FAIL_FLAG      = 'journalMigrationFailed';
const ASYNC_KEY      = 'journal.entries';

async function runMigrationWith(deps) {
  try {
    if (await deps.encGetFlag(MIGRATION_FLAG)) {
      return { status: 'already-complete' };
    }
    const raw = await deps.asyncStorageGetItem(ASYNC_KEY);
    if (raw == null) {
      await deps.encSetFlag(MIGRATION_FLAG, true);
      return { status: 'no-data-fresh-install' };
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      await deps.encSetFlag(FAIL_FLAG, true);
      return { status: 'parse-failed' };
    }
    const entries = Array.isArray(parsed) ? parsed : [];
    if (entries.length === 0) {
      await deps.encSetFlag(MIGRATION_FLAG, true);
      try { await deps.asyncStorageRemoveItem(ASYNC_KEY); } catch {}
      return { status: 'no-data-empty-array' };
    }
    await deps.encBulkWrite(entries);
    const written = await deps.encGetAllEntries();
    if (!verify(entries, written)) {
      await deps.encSetFlag(FAIL_FLAG, true);
      return { status: 'verify-failed', source: entries.length, written: written.length };
    }
    await deps.encSetFlag(MIGRATION_FLAG, true);
    try { await deps.asyncStorageRemoveItem(ASYNC_KEY); } catch {}
    return { status: 'migrated', count: entries.length };
  } catch (e) {
    return { status: 'threw', message: e && e.message };
  }
}

function verify(source, written) {
  if (source.length !== written.length) return false;
  const byId = new Map();
  for (const w of written) {
    if (w && typeof w.id === 'string') byId.set(w.id, w);
  }
  for (const e of source) {
    if (!e || typeof e.id !== 'string') return false;
    const w = byId.get(e.id);
    if (!w) return false;
    if (String(w.content || '') !== String(e.content || '')) return false;
  }
  return true;
}

// ============================================================================
// Test doubles — in-memory stand-ins for the real stores.
// ============================================================================

function makeAsyncStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    _store: store,
    get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null),
    set: (k, v) => { store.set(k, v); return Promise.resolve(); },
    remove: (k) => { store.delete(k); return Promise.resolve(); },
  };
}

function makeEncryptedStore() {
  const flags = new Map();
  let entries = []; // current state of MMKV-side entries array
  return {
    _flags: flags,
    _entriesRef: () => entries,
    getFlag: (n) => Promise.resolve(flags.get(n) === true),
    setFlag: (n, v) => { flags.set(n, v); return Promise.resolve(); },
    getAllEntries: () => Promise.resolve(entries.slice()),
    bulkWrite: (e) => { entries = e.slice(); return Promise.resolve(); },
    // Test hook: simulate a write that LOSES one entry. Used to trip
    // the verify-before-delete safety net in STEP 4.
    _simulateLossyWrite: (dropCount) => {
      const original = makeEncryptedStore().bulkWrite;
      return async (e) => { entries = e.slice(Math.max(0, dropCount)); };
    },
  };
}

function deps(async_, enc) {
  return {
    asyncStorageGetItem:    (k) => async_.get(k),
    asyncStorageRemoveItem: (k) => async_.remove(k),
    encGetFlag:             (n) => enc.getFlag(n),
    encSetFlag:             (n, v) => enc.setFlag(n, v),
    encGetAllEntries:       () => enc.getAllEntries(),
    encBulkWrite:           (e) => enc.bulkWrite(e),
  };
}

// ============================================================================
// Steps
// ============================================================================

let pass = true;
function step(n, label, ok, extra) {
  console.log(`STEP ${n} — ${label}: ${ok ? 'OK' : 'FAIL'}${extra ? ' — ' + extra : ''}`);
  if (!ok) pass = false;
}

function sampleEntries(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `entry-${i}`,
      kind: i % 2 === 0 ? 'freeflow' : 'deepdive',
      createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      content: `journal body number ${i} with some words to count`,
      prompt: i % 2 === 0 ? undefined : 'Something to notice',
    });
  }
  return out;
}

(async () => {
  // ----- STEP 1: Fresh install — no AsyncStorage data, no MMKV data -----
  // Expect: migration sets complete flag, no entries.
  {
    const as = makeAsyncStorage();
    const enc = makeEncryptedStore();
    const r = await runMigrationWith(deps(as, enc));
    step(1, 'fresh install → status="no-data-fresh-install" + flag set',
      r.status === 'no-data-fresh-install' &&
      enc._flags.get(MIGRATION_FLAG) === true &&
      enc._entriesRef().length === 0,
      `status=${r.status}`);
  }

  // ----- STEP 2: Existing user with 5 entries -----
  // Expect: migration moves all 5 to MMKV, verifies, deletes from
  // AsyncStorage, sets flag.
  {
    const source = sampleEntries(5);
    const as = makeAsyncStorage({ [ASYNC_KEY]: JSON.stringify(source) });
    const enc = makeEncryptedStore();
    const r = await runMigrationWith(deps(as, enc));
    const written = enc._entriesRef();
    const cleared = !as._store.has(ASYNC_KEY);
    const ok =
      r.status === 'migrated' &&
      r.count === 5 &&
      written.length === 5 &&
      written.every((e, i) => e.id === source[i].id && e.content === source[i].content) &&
      enc._flags.get(MIGRATION_FLAG) === true &&
      enc._flags.get(FAIL_FLAG) !== true &&
      cleared;
    step(2, '5 entries migrate + verify + AsyncStorage cleaned + flag set', ok,
      `status=${r.status} written=${written.length} cleared=${cleared}`);
  }

  // ----- STEP 3: Re-launch after successful migration -----
  // Expect: migration sees the flag and short-circuits. Entries still
  // present in MMKV (it's the same enc store).
  {
    const source = sampleEntries(3);
    const as = makeAsyncStorage({ [ASYNC_KEY]: JSON.stringify(source) });
    const enc = makeEncryptedStore();
    // First run — full migration.
    await runMigrationWith(deps(as, enc));
    // Second run — should be no-op.
    const r2 = await runMigrationWith(deps(as, enc));
    const ok =
      r2.status === 'already-complete' &&
      enc._entriesRef().length === 3 &&
      !as._store.has(ASYNC_KEY);
    step(3, 're-launch after success → already-complete short-circuit', ok,
      `status=${r2.status}`);
  }

  // ----- STEP 4: Verification failure preserves AsyncStorage -----
  // Simulate a lossy bulk-write (drops 2 of 5 entries before being
  // read back). Expect: failure flag set, AsyncStorage retained,
  // complete flag NOT set, retry possible next launch.
  {
    const source = sampleEntries(5);
    const as = makeAsyncStorage({ [ASYNC_KEY]: JSON.stringify(source) });
    const enc = makeEncryptedStore();
    // Override bulkWrite to drop the first 2 entries — simulating a
    // partial-write failure on a flaky platform.
    enc.bulkWrite = (entries) => {
      enc.bulkWrite._lastInput = entries.slice();
      // "Lossy" write: persists only entries[2..].
      const trimmed = entries.slice(2);
      // Replace the internal entries via the existing getAllEntries
      // round-trip.
      const orig = makeEncryptedStore();
      enc.getAllEntries = () => Promise.resolve(trimmed.slice());
      return Promise.resolve();
    };
    const r = await runMigrationWith(deps(as, enc));
    const asyncStillThere = as._store.has(ASYNC_KEY);
    const ok =
      r.status === 'verify-failed' &&
      asyncStillThere &&
      enc._flags.get(MIGRATION_FLAG) !== true &&
      enc._flags.get(FAIL_FLAG) === true;
    step(4, 'verify failure → AsyncStorage RETAINED + failure flag + retry possible', ok,
      `status=${r.status} asyncStillThere=${asyncStillThere}`);
  }

  // ----- STEP 5: Idempotency — running migration twice is a no-op -----
  {
    const source = sampleEntries(2);
    const as = makeAsyncStorage({ [ASYNC_KEY]: JSON.stringify(source) });
    const enc = makeEncryptedStore();
    const r1 = await runMigrationWith(deps(as, enc));
    const r2 = await runMigrationWith(deps(as, enc));
    const r3 = await runMigrationWith(deps(as, enc));
    const ok =
      r1.status === 'migrated' &&
      r2.status === 'already-complete' &&
      r3.status === 'already-complete' &&
      enc._entriesRef().length === 2;
    step(5, 'run migration N times → N-1 short-circuits, no extra writes', ok,
      `r1=${r1.status} r2=${r2.status} r3=${r3.status}`);
  }

  // ----- STEP 6: Empty array in AsyncStorage — not a fresh install,
  //             just an old empty key. Should clean up + set flag. -----
  {
    const as = makeAsyncStorage({ [ASYNC_KEY]: '[]' });
    const enc = makeEncryptedStore();
    const r = await runMigrationWith(deps(as, enc));
    const ok =
      r.status === 'no-data-empty-array' &&
      enc._flags.get(MIGRATION_FLAG) === true &&
      !as._store.has(ASYNC_KEY);
    step(6, 'empty array in AsyncStorage → flag set + key cleaned', ok,
      `status=${r.status}`);
  }

  // ----- STEP 7: Corrupted AsyncStorage JSON preserves data + flags failure -----
  {
    const as = makeAsyncStorage({ [ASYNC_KEY]: '{this is not json' });
    const enc = makeEncryptedStore();
    const r = await runMigrationWith(deps(as, enc));
    const ok =
      r.status === 'parse-failed' &&
      as._store.has(ASYNC_KEY) && // STILL THERE
      enc._flags.get(MIGRATION_FLAG) !== true &&
      enc._flags.get(FAIL_FLAG) === true;
    step(7, 'corrupted AsyncStorage JSON → preserved + failure flag (retry next launch)', ok,
      `status=${r.status}`);
  }

  // ----- STEP 8: verify() function rejects content mismatch -----
  {
    const a = [{ id: 'a', content: 'hello' }];
    const b = [{ id: 'a', content: 'olleh' }];
    step(8, 'verify() rejects content-mismatch on same id', verify(a, b) === false);
  }

  // ----- STEP 9: verify() function rejects count mismatch -----
  {
    const a = [{ id: 'a', content: 'x' }, { id: 'b', content: 'y' }];
    const b = [{ id: 'a', content: 'x' }];
    step(9, 'verify() rejects count mismatch', verify(a, b) === false);
  }

  console.log('');
  console.log(pass ? 'ALL GREEN' : 'FAILURES');
  process.exit(pass ? 0 : 1);
})();
