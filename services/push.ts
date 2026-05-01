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
import { getUserId } from './user';

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
    // have the token stashed locally and can resync on next boot.
    try {
      const userId = await getUserId();
      await fetch(
        ((Constants.expoConfig?.extra as any)?.apiBaseUrl ||
          'https://inner-map-production.up.railway.app') + '/api/push-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ token, platform: Platform.OS }),
        },
      );
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
