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
  const changed = _cached !== null && _cached !== trimmed;
  console.warn(`[user] setUserId — overriding identity to ${trimmed.slice(0, 8)}… (changed=${changed})`);
  // Tokens are bound to a specific sub (= user id). If the identity is
  // actually CHANGING (cross-device restore to a different account, or the
  // dev recovery override), the old identity's access/refresh tokens are
  // invalid for the new one — drop them. The caller (e.g. authSignIn)
  // writes the new identity's tokens via setTokens immediately after. When
  // the id is UNCHANGED (the common migration case: server returns the same
  // anonymous UUID) we leave tokens alone so a same-id re-sign-in doesn't
  // needlessly churn a still-valid pair before setTokens overwrites it.
  if (changed) await clearTokens();
  // Cache FIRST so any in-flight getUserId() picks up the override
  // immediately, even if the disk writes stall.
  _cached = trimmed;
  await writeBoth(trimmed);
  return trimmed;
}

/**
 * Read the currently-stored user id WITHOUT minting. Returns null
 * when neither the in-memory cache nor either disk store has a
 * value — i.e. genuinely first-launch.
 *
 * Build 11 / account recovery — the sign-in flow needs to send the
 * existing anonymous user_id (when present) so the server can run
 * the migration branch instead of minting a fresh user_id. Calling
 * getUserId() before sign-in would create a UUID we don't want to
 * keep if the server returns a different (existing-identity) id.
 *
 * Same timeouts + cache semantics as getUserId, just without the
 * mint-on-miss fallback. A truly stalled store still returns null
 * here (treated as "no id known yet"); the caller can decide
 * whether to gate the sign-in flow on it.
 */
export async function peekUserId(): Promise<string | null> {
  if (_cached) return _cached;
  const s = await readSecure();
  if (s.ok && typeof s.value === 'string' && s.value) {
    _cached = s.value;
    return s.value;
  }
  const a = await readAsync();
  if (a.ok && typeof a.value === 'string' && a.value) {
    _cached = a.value;
    return a.value;
  }
  return null;
}

/**
 * Clear the cached + persisted user id. Used by the sign-out flow.
 * After this returns, the next getUserId() call mints a fresh id —
 * which is the intended behavior for a sign-out (the user is now
 * anonymous on this device until they sign in again).
 *
 * Both stores are cleared best-effort; a stall on one doesn't block
 * the other. The cache is reset synchronously so subsequent reads
 * within the same process see the clear immediately.
 */
export async function clearUserId(): Promise<void> {
  console.warn('[user] clearUserId — wiping identity (sign-out)');
  _cached = null;
  // Sign-out also drops the token pair — a different identity must not
  // inherit the previous user's Bearer. (Phase 2b token store below.)
  await clearTokens();
  await Promise.allSettled([
    withTimeout(SecureStore.deleteItemAsync(KEY), SECURE_WRITE_TIMEOUT_MS, 'SecureStore delete'),
    withTimeout(AsyncStorage.removeItem(KEY), ASYNC_TIMEOUT_MS, 'AsyncStorage delete'),
  ]);
}

// ===========================================================================
// AUTH TOKENS (Phase 2b) — signed JWT access token + opaque refresh token.
// ===========================================================================
// Stored in the SAME dual-store (SecureStore primary, AsyncStorage backup)
// as the user id, for the same cold-boot-resilience reasons. The access
// token is short-lived (15 min) and re-minted by the single-flight refresh
// in services/api.ts; the refresh token is long-lived (90 days), single-use,
// and rotated on every refresh. refreshExpiresAt lets the client know when
// the refresh token itself has expired (→ must re-bootstrap / sign in).
//
// IMPORTANT: during the migration window the client sends BOTH the Bearer
// (when present) AND X-User-Id. The server dual-accepts (Bearer wins). So
// a missing/expired token is NOT fatal while REQUIRE_BEARER is off — the
// request still resolves via X-User-Id. Tokens "fail open" to the legacy
// path until the server-side cutover flag is flipped.

const ACCESS_TOKEN_KEY = 'innerMapAccessToken';
const REFRESH_TOKEN_KEY = 'innerMapRefreshToken';
const REFRESH_EXPIRES_KEY = 'innerMapRefreshExpiresAt';

export type TokenPair = {
  accessToken: string | null;
  refreshToken: string | null;
  refreshExpiresAt: string | null;
};

// Module-level token cache — same rationale as _cached for the user id:
// avoid hammering SecureStore on every request, and keep a single source
// of truth within a process. Set by readTokens(), setTokens(), clearTokens().
let _tokenCache: TokenPair | null = null;

async function readKey(key: string, label: string): Promise<string | null> {
  const s = await withTimeout(SecureStore.getItemAsync(key), SECURE_READ_TIMEOUT_MS, `SecureStore read ${label}`);
  if (s.ok && typeof s.value === 'string' && s.value) return s.value;
  const a = await withTimeout(AsyncStorage.getItem(key), ASYNC_TIMEOUT_MS, `AsyncStorage read ${label}`);
  if (a.ok && typeof a.value === 'string' && a.value) return a.value;
  return null;
}

async function writeKey(key: string, value: string): Promise<void> {
  await Promise.allSettled([
    withTimeout(SecureStore.setItemAsync(key, value), SECURE_WRITE_TIMEOUT_MS, `SecureStore write ${key}`),
    withTimeout(AsyncStorage.setItem(key, value), ASYNC_TIMEOUT_MS, `AsyncStorage write ${key}`),
  ]);
}

async function deleteKey(key: string): Promise<void> {
  await Promise.allSettled([
    withTimeout(SecureStore.deleteItemAsync(key), SECURE_WRITE_TIMEOUT_MS, `SecureStore delete ${key}`),
    withTimeout(AsyncStorage.removeItem(key), ASYNC_TIMEOUT_MS, `AsyncStorage delete ${key}`),
  ]);
}

/** Read the stored token pair (cached). Returns nulls when no tokens are
 *  stored yet (anonymous user who hasn't bootstrapped, or pre-token build). */
export async function getTokens(): Promise<TokenPair> {
  if (_tokenCache) return _tokenCache;
  const [accessToken, refreshToken, refreshExpiresAt] = await Promise.all([
    readKey(ACCESS_TOKEN_KEY, 'access'),
    readKey(REFRESH_TOKEN_KEY, 'refresh'),
    readKey(REFRESH_EXPIRES_KEY, 'refreshExp'),
  ]);
  _tokenCache = { accessToken, refreshToken, refreshExpiresAt };
  return _tokenCache;
}

/** Convenience: just the access token (or null). Used by the Bearer header
 *  injector + the single-flight refresh retry. */
export async function getAccessToken(): Promise<string | null> {
  return (await getTokens()).accessToken;
}

/** Persist a token pair from sign-in / bootstrap / refresh. Partial pairs
 *  are tolerated — a refresh response may rotate only access+refresh while
 *  the caller keeps the prior refreshExpiresAt. Any field left undefined is
 *  preserved; pass null to explicitly clear a field. */
export async function setTokens(pair: Partial<TokenPair>): Promise<void> {
  const current = await getTokens();
  const next: TokenPair = {
    accessToken: pair.accessToken !== undefined ? pair.accessToken : current.accessToken,
    refreshToken: pair.refreshToken !== undefined ? pair.refreshToken : current.refreshToken,
    refreshExpiresAt: pair.refreshExpiresAt !== undefined ? pair.refreshExpiresAt : current.refreshExpiresAt,
  };
  // Cache FIRST so in-flight requests see the new token immediately even
  // if the disk write stalls.
  _tokenCache = next;
  const ops: Promise<void>[] = [];
  if (next.accessToken) ops.push(writeKey(ACCESS_TOKEN_KEY, next.accessToken)); else ops.push(deleteKey(ACCESS_TOKEN_KEY));
  if (next.refreshToken) ops.push(writeKey(REFRESH_TOKEN_KEY, next.refreshToken)); else ops.push(deleteKey(REFRESH_TOKEN_KEY));
  if (next.refreshExpiresAt) ops.push(writeKey(REFRESH_EXPIRES_KEY, next.refreshExpiresAt)); else ops.push(deleteKey(REFRESH_EXPIRES_KEY));
  await Promise.allSettled(ops);
  console.log(`[user] setTokens — access=${next.accessToken ? 'set' : 'cleared'} refresh=${next.refreshToken ? 'set' : 'cleared'}`);
}

/** Wipe all tokens (sign-out, refresh-token theft/expiry, account delete).
 *  Leaves the user id intact — clearing tokens drops the user to the
 *  X-User-Id legacy path (which still works while REQUIRE_BEARER is off),
 *  it does NOT orphan their data. */
export async function clearTokens(): Promise<void> {
  _tokenCache = { accessToken: null, refreshToken: null, refreshExpiresAt: null };
  await Promise.allSettled([
    deleteKey(ACCESS_TOKEN_KEY),
    deleteKey(REFRESH_TOKEN_KEY),
    deleteKey(REFRESH_EXPIRES_KEY),
  ]);
}

// ===========================================================================
// ONE HEADER INJECTOR (Phase 2a) — every outbound request builds its auth
// headers here. Centralizing means the Phase-2b Bearer addition + any future
// header change happens in exactly ONE place, not 5 scattered sites.
// ===========================================================================
export type IdentityHeaderOpts = {
  /** 'mint' (default) → getUserId (mints a UUID on genuine first launch).
   *  'peek' → peekUserId (never mints) — the sign-in path uses this so we
   *  don't burn a throwaway UUID before the server resolves the identity. */
  mode?: 'mint' | 'peek';
  /** Content-Type to set. Defaults to application/json; the binary upload
   *  sites (map-voice turn, transcribe) pass the recording's mime. */
  contentType?: string;
};

export async function buildIdentityHeaders(
  opts: IdentityHeaderOpts = {},
): Promise<Record<string, string>> {
  const mode = opts.mode ?? 'mint';
  const headers: Record<string, string> = {
    'Content-Type': opts.contentType ?? 'application/json',
  };
  const userId = mode === 'peek' ? await peekUserId() : await getUserId();
  // X-User-Id stays on EVERY request during the migration window — the
  // server dual-accepts (Bearer wins) so un-flipped servers + the
  // bootstrap/migration paths keep working. It's removed only after the
  // server-side REQUIRE_BEARER cutover (which ignores it anyway).
  if (userId) headers['X-User-Id'] = userId;
  // Phase 2b — attach the Bearer access token when we have one. A missing
  // token is non-fatal: the request resolves via X-User-Id (dual-accept).
  const accessToken = (await getTokens()).accessToken;
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}
