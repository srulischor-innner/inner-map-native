// Journal-entry migration: AsyncStorage → encrypted MMKV.
//
// Critical contract (verify-before-delete):
//
//   1. If `journalMigrationComplete` flag is already set in MMKV →
//      skip; we've migrated before.
//   2. Read all entries from AsyncStorage[`journal.entries`].
//      - No raw → set complete flag, no-op (fresh install or already
//        migrated + previous AsyncStorage cleanup succeeded).
//      - Raw exists but JSON.parse fails → leave AsyncStorage in
//        place, set `journalMigrationFailed`, DO NOT clear. Better
//        to leave readable-but-unencrypted than to lose data.
//      - Empty array → set complete flag + clean up AsyncStorage,
//        no entries to copy.
//   3. Bulk-write entries to MMKV.
//   4. Read them back. Verify count + every source id + content
//      byte-equal.
//   5. If verified → set complete flag, THEN remove AsyncStorage
//      key. (Order matters: flag-then-delete means a crash between
//      the two leaves the next launch in a "flag set, AsyncStorage
//      stale" state — harmless, the next launch sees the flag and
//      skips migration entirely. The stale AsyncStorage key gets
//      cleaned up on next migration attempt — no, actually it
//      doesn't; we'd want a periodic re-cleanup. For v1 acceptable
//      since the flag-set wins authoritatively.)
//   6. If NOT verified → set `journalMigrationFailed`, KEEP both
//      stores. Next launch retries the migration. Log a sanitized
//      error (no entry content).
//
// The dependency-injection shape (MigrationDeps) means this module
// has no React Native imports and can be smoke-tested from plain
// Node with mock stores. Production wiring lives at the bottom of
// the file (runMigrationOnce) and supplies the real AsyncStorage +
// encrypted-MMKV functions.

const ASYNC_STORAGE_KEY      = 'journal.entries';
export const MIGRATION_FLAG  = 'journalMigrationComplete';
export const FAIL_FLAG       = 'journalMigrationFailed';

export type MigrationStatus =
  | 'already-complete'
  | 'no-data-fresh-install'
  | 'no-data-empty-array'
  | 'parse-failed'
  | 'verify-failed'
  | 'migrated'
  | 'threw';

export type MigrationResult = {
  status: MigrationStatus;
  count?: number;
  message?: string;
};

export interface MigrationDeps {
  asyncStorageGetItem:    (k: string) => Promise<string | null>;
  asyncStorageRemoveItem: (k: string) => Promise<void>;
  encGetFlag:             (name: string) => Promise<boolean>;
  encSetFlag:             (name: string, value: boolean) => Promise<void>;
  encGetAllEntries:       () => Promise<any[]>;
  encBulkWrite:           (entries: any[]) => Promise<void>;
}

/** Pure migration runner — takes its dependencies as args so the
 *  smoke test can supply mocks. Production wrapper at the bottom of
 *  this file passes the real AsyncStorage + encrypted-MMKV fns. */
export async function runMigrationWith(deps: MigrationDeps): Promise<MigrationResult> {
  try {
    // Step 1 — already-migrated short-circuit.
    if (await deps.encGetFlag(MIGRATION_FLAG)) {
      return { status: 'already-complete' };
    }

    // Step 2 — read source-of-truth from AsyncStorage.
    const raw = await deps.asyncStorageGetItem(ASYNC_STORAGE_KEY);
    if (raw == null) {
      // No legacy data. Fresh install (or a previous migration
      // already cleaned the key).
      await deps.encSetFlag(MIGRATION_FLAG, true);
      return { status: 'no-data-fresh-install' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupted AsyncStorage value. Don't lose it — leave in
      // place and flag failure. Future debug path can repair.
      await deps.encSetFlag(FAIL_FLAG, true);
      return { status: 'parse-failed', message: 'AsyncStorage value is not valid JSON' };
    }

    const entries = Array.isArray(parsed) ? parsed : [];
    if (entries.length === 0) {
      // Empty array. Set complete flag + clean up the empty key.
      await deps.encSetFlag(MIGRATION_FLAG, true);
      try { await deps.asyncStorageRemoveItem(ASYNC_STORAGE_KEY); } catch {}
      return { status: 'no-data-empty-array' };
    }

    // Step 3 — bulk-write to MMKV.
    await deps.encBulkWrite(entries);

    // Step 4 — read back + verify.
    const written = await deps.encGetAllEntries();
    if (!verify(entries, written)) {
      // Step 6 (failure path) — KEEP both stores. Flag for retry
      // on next launch. The failure-flag also gives the app a hook
      // to surface a debug warning if we ever want one.
      await deps.encSetFlag(FAIL_FLAG, true);
      return {
        status: 'verify-failed',
        message: `source=${entries.length} written=${written.length}`,
      };
    }

    // Step 5 — verified. Set complete flag FIRST, then clear
    // AsyncStorage. If the AsyncStorage delete fails (transient
    // platform issue), the next launch sees the complete flag and
    // skips the whole migration — the stale AsyncStorage key is
    // harmless because journal reads now route through MMKV.
    await deps.encSetFlag(MIGRATION_FLAG, true);
    try { await deps.asyncStorageRemoveItem(ASYNC_STORAGE_KEY); } catch {}
    return { status: 'migrated', count: entries.length };
  } catch (e) {
    // Never throw from migration — the journal feature must
    // continue to work even if migration fails. Sanitize the error:
    // log a short message only, no entry content.
    return { status: 'threw', message: (e as Error)?.message || 'unknown' };
  }
}

/** Verification: byte-equal content on every id; counts match.
 *  Only checks the fields the spec requires (count, id, content).
 *  Optional fields (prompt, detectedParts) can round-trip with
 *  benign shape drift (undefined vs missing) and aren't
 *  data-loss indicators. */
function verify(source: any[], written: any[]): boolean {
  if (source.length !== written.length) return false;
  const byId = new Map<string, any>();
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

// =============================================================================
// PRODUCTION WIRING — lazy module-level singleton so migration runs at
// most once per process. First caller awaits the real work; subsequent
// callers receive the cached result without re-reading any store.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as encryptedStorage from '../utils/encryptedStorage';

let _migrationPromise: Promise<MigrationResult> | null = null;

export function runMigrationOnce(): Promise<MigrationResult> {
  if (_migrationPromise) return _migrationPromise;
  _migrationPromise = runMigrationWith({
    asyncStorageGetItem:    (k) => AsyncStorage.getItem(k),
    asyncStorageRemoveItem: async (k) => { await AsyncStorage.removeItem(k); },
    encGetFlag:             (name) => encryptedStorage._migrationGetFlag(name),
    encSetFlag:             (name, v) => encryptedStorage._migrationSetFlag(name, v),
    encGetAllEntries:       () => encryptedStorage.getAllEntries(),
    encBulkWrite:           (entries) => encryptedStorage._migrationBulkWrite(entries),
  }).then((result) => {
    const tag = result.status === 'migrated'
      ? `migrated ${result.count} entries to encrypted MMKV`
      : `status=${result.status}${result.message ? ' (' + result.message + ')' : ''}`;
    console.log(`[journal-migration] ${tag}`);
    return result;
  });
  return _migrationPromise;
}
