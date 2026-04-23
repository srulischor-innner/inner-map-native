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
  try {
    const existing = await SecureStore.getItemAsync(KEY);
    if (existing) {
      _cached = existing;
      return existing;
    }
  } catch (e) {
    console.warn('[user] SecureStore read failed:', (e as Error).message);
  }
  const fresh = uuidv4();
  try {
    await SecureStore.setItemAsync(KEY, fresh);
  } catch (e) {
    console.warn('[user] SecureStore write failed:', (e as Error).message);
  }
  _cached = fresh;
  return fresh;
}
