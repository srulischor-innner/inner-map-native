// Push notification setup. On first run (after onboarding) we:
//   1. Request permissions
//   2. Fetch an Expo push token
//   3. Store it locally (AsyncStorage) and on the server (best-effort — if the
//      endpoint doesn't exist yet it returns silently; no user-facing failure).
//
// Foreground handler is set globally so notifications that arrive while the user
// is in the app still show a subtle banner instead of being swallowed.
// Response handler (tap-to-open) deep-links based on the payload's `route`.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { buildIdentityHeaders } from './user';

const TOKEN_STORE_KEY = 'push.expoToken';

// Foreground behavior — show banner + play sound if the notification arrives while
// the app is active. Without this, foreground notifications are silently dropped.
//
// Wrapped in try/catch — this runs at module-import time, so if
// expo-notifications' native module isn't fully initialized yet (which
// can happen in preview/standalone builds during cold start), an
// unhandled throw here would prevent app/_layout.tsx (and therefore
// the entire app) from ever mounting. Foreground banner config is
// non-critical; better to skip it than crash.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (e) {
  console.warn('[push] setNotificationHandler at import threw:', (e as Error)?.message);
}

/** One POST/DELETE to /api/push-token with the shared identity headers, and a
 *  single retry without the Bearer if the server answers 401. Push registration
 *  is best-effort and deliberately silent, so a stale access token must not be
 *  able to switch it off with nobody finding out. */
async function pushFetch(method: 'POST' | 'DELETE', body?: string): Promise<void> {
  const url =
    ((Constants.expoConfig?.extra as any)?.apiBaseUrl ||
      'https://inner-map-production.up.railway.app') + '/api/push-token';
  const headers = await buildIdentityHeaders();
  const res = await fetch(url, { method, headers, body });
  if (res.status !== 401 || !headers['Authorization']) return;
  const bare: Record<string, string> = { ...headers };
  delete bare['Authorization'];
  await fetch(url, { method, headers: bare, body });
}

export async function registerForPushNotifications(): Promise<string | null> {
  // Physical device check — push tokens can't be issued on simulators.
  if (!Device.isDevice) {
    console.log('[push] skipping — simulator/web');
    return null;
  }

  // Android requires a channel before notifications can display.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E6B47A',
    });
  }

  // Permission ladder: check current, ask only if undetermined.
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') {
    console.log('[push] permission denied');
    return null;
  }

  // Expo push token — opaque string we POST to our own server when the user is
  // identified. `projectId` falls back to the one Expo Go fills in.
  const projectId =
    (Constants.expoConfig?.extra as any)?.eas?.projectId ||
    Constants.easConfig?.projectId;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await AsyncStorage.setItem(TOKEN_STORE_KEY, token);
    // Best-effort server registration. If the endpoint isn't live yet, we still
    // have the token stashed locally and can resync on next boot. Headers go
    // through the shared injector (X-User-Id + Bearer) — this is a raw fetch
    // (not apiFetch), so it gets no refresh-and-replay. Once the server answers
    // 401 on a stale Bearer (2026-08-23) that starts to matter: registration
    // would fail for anyone holding an expired access token, and this call is
    // silent by design, so nobody would ever find out. pushFetch drops the
    // Bearer and retries once, which is all a best-effort call needs.
    try {
      await pushFetch('POST', JSON.stringify({ token, platform: Platform.OS }));
    } catch {}
    console.log('[push] token:', token.slice(0, 16) + '…');
    return token;
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync failed:', (e as Error).message);
    return null;
  }
}

export async function getCachedPushToken(): Promise<string | null> {
  try { return await AsyncStorage.getItem(TOKEN_STORE_KEY); }
  catch { return null; }
}

// ── Opt-in for inbox notifications ──────────────────────────────────────────
// The ONLY notification type is the inbox card. Opt-in is contextual (a
// Settings toggle + a one-time in-app prompt) — never at boot. The server-side
// send gate is token PRESENCE: opting in registers a token; opting out clears
// it, so the send path finds none and silently no-ops.
const OPTIN_STORE_KEY = 'push.optedIn';

/** Local source of truth for the Settings toggle's on/off state. */
export async function getInboxPushOptIn(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(OPTIN_STORE_KEY)) === '1'; }
  catch { return false; }
}

/** Opt IN: run the OS permission ask + register the Expo token (reusing
 *  registerForPushNotifications), then persist the opt-in. Returns true only if
 *  a token was obtained (permission granted, real device). */
export async function enableInboxPush(): Promise<boolean> {
  const token = await registerForPushNotifications();
  if (!token) return false; // denied / simulator — stay opted-out
  try { await AsyncStorage.setItem(OPTIN_STORE_KEY, '1'); } catch {}
  return true;
}

/** Opt OUT: clear the server token(s) + local token + opt-in flag. Best-effort,
 *  never throws — the send path then finds no token and no-ops. */
export async function disableInboxPush(): Promise<void> {
  try {
    await pushFetch('DELETE');
  } catch {}
  try { await AsyncStorage.removeItem(TOKEN_STORE_KEY); } catch {}
  try { await AsyncStorage.setItem(OPTIN_STORE_KEY, '0'); } catch {}
}
