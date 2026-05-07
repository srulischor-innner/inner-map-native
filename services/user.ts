// User identity — stored in Expo SecureStore (Keychain on iOS, EncryptedSharedPreferences
// on Android) AND mirrored to AsyncStorage as a redundant backup. One anonymous UUID per
// install. The Railway server scopes every request by the `X-User-Id` header.
//
// Why dual-store + 8s timeouts: SecureStore (and to a lesser extent AsyncStorage)
// can stall for several seconds on cold boot — Keychain access on iOS, the JS bridge
// under Metro debugger load, simulator quirks. The original 1.5s timeout treated a
// stall identically to "no value stored" and minted a fresh UUID, OVERWRITING the
// real id and orphaning the user from their own DB rows. 8s gives a slow store
// enough time to respond; the dual-store fallback recovers from a single-store
// stall; and the module-level _cached prevents the SAME process from minting
// multiple replacement ids if reads keep failing.
//
// react-native-get-random-values polyfills crypto.getRandomValues so uuid v4
// has entropy. It MUST run before uuid is called. We use require() inside
// try/catch instead of `import 'react-native-get-random-values'` because
// this module is reachable from app/_layout.tsx's transitive import graph
// (via services/push.ts) — a throw at the bare-import statement kills the
// entire boot path and the splash hangs forever with no React tree
// mounted. Wrapping it lets boot continue; if uuid is later called without
// the polyfill it'll throw at THAT point, which is recoverable.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-get-random-values');
} catch (e) {
  console.error('[user] react-native-get-random-values polyfill failed to load:', (e as Error)?.message);
}
import { v4 as uuidv4 } from 'uuid';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'innerMapUserId';

// Module-level identity cache. SET ONCE per process — by a successful
// read OR a setUserId override OR a genuine first-launch mint. NEVER
// reset within a process. Once we've established an id, every subsequent
// getUserId() returns this value, so transient store stalls partway
// through a session can't trigger a re-mint that would orphan data.
let _cached: string | null = null;

// 8s timeouts — generous on purpose. SecureStore on iOS has been observed
// stalling 5-7s on cold boot when the keychain is contended; tighter
// timeouts triggered the silent identity-reset bug that orphaned existing
// users from their data. AsyncStorage gets the same budget for symmetry.
const SECURE_READ_TIMEOUT_MS = 8000;
const SECURE_WRITE_TIMEOUT_MS = 8000;
const ASYNC_TIMEOUT_MS = 8000;

// Discriminated read result so callers can tell `key not present` (clean
// null) apart from `store stalled` (timeout) — that distinction matters
// for the mint-vs-orphan decision below.
type ReadResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: 'timeout' | 'error' };

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'timeout' | 'error' }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[user] ${label} timed out @${ms}ms`);
      resolve({ ok: false, reason: 'timeout' });
    }, ms);
    p.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn(`[user] ${label} threw:`, (e as Error)?.message);
        resolve({ ok: false, reason: 'error' });
      },
    );
  });
}

async function readSecure(): Promise<ReadResult> {
  return withTimeout(SecureStore.getItemAsync(KEY), SECURE_READ_TIMEOUT_MS, 'SecureStore read');
}

async function readAsync(): Promise<ReadResult> {
  return withTimeout(AsyncStorage.getItem(KEY), ASYNC_TIMEOUT_MS, 'AsyncStorage read');
}

// Best-effort dual write. Promise.allSettled lets one store succeed even
// if the other stalls. The withTimeout caps the wait per leg.
async function writeBoth(id: string): Promise<void> {
  await Promise.allSettled([
    withTimeout(SecureStore.setItemAsync(KEY, id), SECURE_WRITE_TIMEOUT_MS, 'SecureStore write'),
    withTimeout(AsyncStorage.setItem(KEY, id), ASYNC_TIMEOUT_MS, 'AsyncStorage write'),
  ]);
}

export async function getUserId(): Promise<string> {
  // (1) Cache short-circuit — once we have an id for this process, NEVER
  //     re-resolve. Prevents a transient stall mid-session from rolling
  //     the identity to a new UUID and orphaning everything saved before.
  if (_cached) {
    return _cached;
  }
  console.log('[user] getUserId — resolving (SecureStore primary, AsyncStorage fallback, 8s budgets)');

  // (2) SecureStore — canonical store on a healthy device.
  const s = await readSecure();
  if (s.ok && typeof s.value === 'string' && s.value) {
    _cached = s.value;
    console.log(`[user] resolved from SecureStore — ${s.value.slice(0, 8)}…`);
    // Mirror to AsyncStorage so a future SecureStore stall has a backup
    // to recover from. Fire-and-forget; don't block return.
    AsyncStorage.setItem(KEY, s.value).catch(() => {});
    return s.value;
  }

  // (3) AsyncStorage — redundant backup. If SecureStore returned null
  //     OR stalled, try here BEFORE deciding it's a fresh launch.
  const a = await readAsync();
  if (a.ok && typeof a.value === 'string' && a.value) {
    _cached = a.value;
    console.warn(`[user] SecureStore empty/stalled — restoring from AsyncStorage (${a.value.slice(0, 8)}…)`);
    // Try to repair SecureStore so the canonical store catches up.
    SecureStore.setItemAsync(KEY, a.value).catch(() => {});
    return a.value;
  }

  // (4) Both reads returned without a value. Two distinct sub-cases:
  //
  //     (4a) BOTH STALLED — neither store responded in 8s. We don't
  //          actually know whether the user has an id or not. Minting
  //          a fresh UUID and writing it to disk would overwrite the
  //          real id (if one exists) on the next slow boot — the bug
  //          we're fixing. Mint an in-memory transient id, cache it,
  //          and DO NOT write it to either store. On the next launch
  //          we'll retry reads with full 8s budgets; if those succeed
  //          this transient dies with the process and the real id
  //          comes back. If reads keep failing for the entire process,
  //          the cached transient at least keeps THIS session
  //          consistent (no per-call re-minting).
  const sStalled = !s.ok && s.reason === 'timeout';
  const aStalled = !a.ok && a.reason === 'timeout';
  if (sStalled && aStalled) {
    const transient = uuidv4();
    _cached = transient;
    console.warn(`[user] ⚠ BOTH STORES STALLED — issuing transient in-memory id (${transient.slice(0, 8)}…). NOT writing to disk; next launch will retry.`);
    return transient;
  }

  //     (4b) GENUINE FIRST LAUNCH — at least one store responded
  //          cleanly with no value, and neither came back with one.
  //          Safe to mint and persist.
  const fresh = uuidv4();
  _cached = fresh;
  console.log(`[user] genuine first launch — minting fresh id (${fresh.slice(0, 8)}…)`);
  await writeBoth(fresh);
  return fresh;
}

/**
 * Override the stored user id and reset the in-memory cache. Used by the
 * __DEV__-only Settings recovery flow when a user's id has been orphaned
 * (e.g. by a SecureStore stall under the old timeout-mints-fresh logic).
 * Writes to both stores so the override survives a reload regardless of
 * which store the next read consults first.
 *
 * Returns the id that ended up cached (= the input, after trim).
 */
export async function setUserId(id: string): Promise<string> {
  const trimmed = String(id || '').trim();
  if (!trimmed) throw new Error('setUserId: empty id');
  console.warn(`[user] setUserId — overriding identity to ${trimmed.slice(0, 8)}…`);
  // Cache FIRST so any in-flight getUserId() picks up the override
  // immediately, even if the disk writes stall.
  _cached = trimmed;
  await writeBoth(trimmed);
  return trimmed;
}
