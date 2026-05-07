// User identity — stored in Expo SecureStore (Keychain on iOS, EncryptedSharedPreferences
// on Android) AND mirrored to AsyncStorage as a redundant backup. One anonymous UUID per
// install. The Railway server scopes every request by the `X-User-Id` header.
//
// Why dual-store: SecureStore occasionally stalls (Keychain access on cold boot,
// simulator hangs, certain iCloud Keychain sync races). The previous flow timed
// out the read at 1.5s and then MINTED A FRESH UUID, overwriting the real id in
// SecureStore and orphaning the user from their own data. Dual-store fixes
// this — if SecureStore stalls or returns null, we try AsyncStorage; only if
// BOTH paths come back empty do we treat it as a true first-launch and mint.
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
let _cached: string | null = null;

const SECURE_READ_TIMEOUT_MS = 1500;
const SECURE_WRITE_TIMEOUT_MS = 1500;
const ASYNC_TIMEOUT_MS = 1500;

// Helper: race a promise against a timeout, returning null on timeout
// rather than rejecting. Lets callers distinguish "no value" from
// "transient failure" higher up.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return Promise.race<T | null>([
    p,
    new Promise<null>((r) =>
      setTimeout(() => {
        console.warn(`[user] ${label} timed out @${ms}ms`);
        r(null);
      }, ms),
    ),
  ]);
}

async function readSecureStore(): Promise<{ value: string | null; failed: boolean }> {
  try {
    const v = await withTimeout(SecureStore.getItemAsync(KEY), SECURE_READ_TIMEOUT_MS, 'SecureStore read');
    // Distinguish "explicit null returned by SecureStore" (key absent) from
    // "we don't know" (timeout). Only the timeout path gets the failed flag.
    // SecureStore.getItemAsync resolves to null when the key is missing;
    // the timeout's Promise.race resolves to null too — but we can't tell
    // them apart at this level. So we treat any non-null as truth and any
    // null as "ambiguous, fall back to AsyncStorage."
    return { value: v, failed: v == null };
  } catch (e) {
    console.warn('[user] SecureStore read threw:', (e as Error).message);
    return { value: null, failed: true };
  }
}

async function readAsyncStorage(): Promise<string | null> {
  try {
    return await withTimeout(AsyncStorage.getItem(KEY), ASYNC_TIMEOUT_MS, 'AsyncStorage read');
  } catch (e) {
    console.warn('[user] AsyncStorage read threw:', (e as Error).message);
    return null;
  }
}

async function writeBoth(id: string): Promise<void> {
  // Best-effort writes to both stores. AsyncStorage rarely fails; SecureStore
  // can stall — the timeout caps each leg so the caller isn't blocked.
  await Promise.allSettled([
    withTimeout(SecureStore.setItemAsync(KEY, id), SECURE_WRITE_TIMEOUT_MS, 'SecureStore write'),
    withTimeout(AsyncStorage.setItem(KEY, id), ASYNC_TIMEOUT_MS, 'AsyncStorage write'),
  ]);
}

export async function getUserId(): Promise<string> {
  if (_cached) return _cached;
  console.log('[user] getUserId — reading SecureStore (with AsyncStorage fallback)');

  // 1) Try SecureStore first — it's the canonical store on a healthy device.
  const { value: secureValue } = await readSecureStore();
  if (secureValue) {
    _cached = secureValue;
    console.log('[user] resolved from SecureStore');
    // Mirror to AsyncStorage in case the previous launch wrote only to one
    // store (e.g. partial migration from the old single-store flow).
    AsyncStorage.setItem(KEY, secureValue).catch(() => {});
    return secureValue;
  }

  // 2) SecureStore returned null OR timed out. BEFORE minting a new id,
  //    check AsyncStorage — if a value lives there, the SecureStore null
  //    was a stall, not a "key absent" condition, and we MUST recover the
  //    existing identity rather than orphan it.
  const asyncValue = await readAsyncStorage();
  if (asyncValue) {
    console.warn('[user] SecureStore empty/stalled but AsyncStorage has the id — restoring');
    _cached = asyncValue;
    // Try to write it back to SecureStore so the canonical store is in
    // sync. Don't block the caller on it.
    SecureStore.setItemAsync(KEY, asyncValue).catch(() => {});
    return asyncValue;
  }

  // 3) Both stores empty → genuine first launch. Mint and persist to both.
  const fresh = uuidv4();
  console.log('[user] genuine first launch — minting fresh id');
  await writeBoth(fresh);
  _cached = fresh;
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
  await writeBoth(trimmed);
  _cached = trimmed;
  return trimmed;
}
