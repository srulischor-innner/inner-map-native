// User identity — stored in Expo SecureStore (Keychain on iOS, EncryptedSharedPreferences
// on Android). One anonymous UUID per install. The Railway server scopes every request
// by the `X-User-Id` header.
//
// `react-native-get-random-values` must be imported BEFORE `uuid` so crypto.getRandomValues
// is polyfilled before uuid touches it. That's why we do it at the top of this module.

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as SecureStore from 'expo-secure-store';

const KEY = 'innerMapUserId';
let _cached: string | null = null;

export async function getUserId(): Promise<string> {
  if (_cached) return _cached;
  console.log('[user] getUserId — reading SecureStore');
  try {
    // 1.5s timeout: SecureStore occasionally stalls on simulators and in
    // first-launch conditions. Don't let that hang the first API call.
    const existing = await Promise.race<string | null>([
      SecureStore.getItemAsync(KEY),
      new Promise<null>((r) => setTimeout(() => {
        console.warn('[user] SecureStore read timed out @1500ms');
        r(null);
      }, 1500)),
    ]);
    if (existing) {
      _cached = existing;
      console.log('[user] got cached id');
      return existing;
    }
  } catch (e) {
    console.warn('[user] SecureStore read failed:', (e as Error).message);
  }
  const fresh = uuidv4();
  console.log('[user] generating fresh id');
  try {
    // Best-effort write — if the device refuses, still use the id in memory.
    await Promise.race<void>([
      SecureStore.setItemAsync(KEY, fresh),
      new Promise<void>((r) => setTimeout(() => {
        console.warn('[user] SecureStore write timed out @1500ms');
        r();
      }, 1500)),
    ]);
  } catch (e) {
    console.warn('[user] SecureStore write failed:', (e as Error).message);
  }
  _cached = fresh;
  return fresh;
}
