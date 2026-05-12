// Post-account-delete local wipe.
//
// Called AFTER the server returns { status: "deleted" } from
// DELETE /api/account. The server has already purged this user's
// rows; this routine clears every locally-stored identifier and
// app-state flag so the device returns to a fresh-install state
// and the user can re-onboard cleanly under a new UUID.
//
// Order of operations matters:
//   1. Wipe encrypted journal entries (MMKV) — sensitive content.
//   2. Delete the SecureStore-held MMKV encryption key — without
//      this, a future install on the same device might re-read
//      the old MMKV file (if the volume persists across reinstall,
//      which iOS allows in some backup-restore paths).
//   3. Delete the SecureStore userId.
//   4. Delete the AsyncStorage mirror of the userId.
//   5. Clear all onboarding / preference flags from AsyncStorage.
//   6. Reset module-level identity cache so getUserId() mints fresh
//      on the next call.
//
// Each step is wrapped in try/catch — a partial failure on one
// surface shouldn't block the others. The user will see the
// "Account deleted" confirmation screen regardless, and the most
// important wipes (MMKV journal, SecureStore userId) almost always
// succeed.

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as encryptedStorage from './encryptedStorage';

// Keys we own and need to clear on account deletion. The match is
// EXACT for these — any future addition to AsyncStorage should
// be added here too if it represents per-account state.
const ASYNC_KEYS_TO_CLEAR = [
  'innerMapUserId',
  'hasSeenWelcome',
  'experienceLevel.v1',
  'faceIdEnabled',
  'push.expoToken',
  'journal.entries',          // legacy AsyncStorage journal — PR 2a stranded it
  'relationships.tabIntroSeen',
  'integration_view_seen',
  'second_layer_introduced',
  'circle_view_intro_seen',
  'map_intro_seen',
  'attentionIndicator.firstTransitionSeen.v1',
  'attention_indicator_seen',
];
// Anything matching one of these prefixes gets removed even if not
// listed above — covers per-relationship intro flags like
// "relationships.introSeen:<id>" and any future namespaced flags.
const ASYNC_PREFIXES_TO_CLEAR = [
  'relationships.introSeen:',
  'onboarding.',
];

const SECURE_KEYS_TO_CLEAR = [
  'innerMapUserId',
  'mmkv.encryptionKey',
];

export async function wipeLocalAccountData(): Promise<{
  journalCleared: boolean;
  secureKeysCleared: number;
  asyncKeysCleared: number;
}> {
  let journalCleared = false;
  let secureKeysCleared = 0;
  let asyncKeysCleared = 0;

  // 1. Encrypted journal entries.
  try {
    await encryptedStorage.clear();
    journalCleared = true;
  } catch (e) {
    console.warn('[local-cleanup] journal clear failed:', (e as Error)?.message);
  }

  // 2-3. SecureStore wipes.
  for (const key of SECURE_KEYS_TO_CLEAR) {
    try {
      await SecureStore.deleteItemAsync(key);
      secureKeysCleared++;
    } catch (e) {
      console.warn(`[local-cleanup] SecureStore deleteItemAsync(${key}) failed:`, (e as Error)?.message);
    }
  }

  // 4. AsyncStorage — exact keys.
  for (const key of ASYNC_KEYS_TO_CLEAR) {
    try {
      await AsyncStorage.removeItem(key);
      asyncKeysCleared++;
    } catch {
      // Silent — non-existent keys aren't errors here.
    }
  }

  // 5. AsyncStorage — prefix match (catches per-relationship intro
  // flags like "relationships.introSeen:<id>" without needing to
  // know the relationship ids).
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matched = allKeys.filter((k) =>
      ASYNC_PREFIXES_TO_CLEAR.some((p) => k.startsWith(p)),
    );
    if (matched.length > 0) {
      await AsyncStorage.multiRemove(matched);
      asyncKeysCleared += matched.length;
    }
  } catch (e) {
    console.warn('[local-cleanup] prefix-match removeItem failed:', (e as Error)?.message);
  }

  console.log(`[local-cleanup] journal=${journalCleared} secureKeys=${secureKeysCleared}/${SECURE_KEYS_TO_CLEAR.length} asyncKeys=${asyncKeysCleared}`);
  return { journalCleared, secureKeysCleared, asyncKeysCleared };
}
