// Face ID / biometric lock for Inner Map.
//
// On first launch we set the user preference to ON whenever the device has
// hardware + at least one enrolled biometric. The user can later flip it
// off in Settings. We re-check on every cold start AND every time the app
// returns from background — that's the spec for "private inner world".
//
// All AsyncStorage writes are best-effort; if storage hangs we fall back
// to "unlocked" so the user is never trapped on a black screen.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

const PREF_KEY = 'faceIdEnabled';

/** Capability probe — true only when the device has hardware AND the user
 *  has at least one enrolled biometric (face / touch / etc). Used both to
 *  decide whether to show the Settings toggle and to gate the lock check. */
export async function biometricsAvailable(): Promise<boolean> {
  try {
    const [hasHw, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return !!(hasHw && isEnrolled);
  } catch (e) {
    console.warn('[biometrics] capability probe failed:', (e as Error)?.message);
    return false;
  }
}

/** Read the user preference. Returns false when never written so the boot
 *  initializer can apply the default (ON when hardware is available). */
export async function isLockEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PREF_KEY);
    return v === 'true';
  } catch { return false; }
}

export async function setLockEnabled(on: boolean): Promise<void> {
  try { await AsyncStorage.setItem(PREF_KEY, on ? 'true' : 'false'); } catch {}
}

/** First-launch default — if no preference has been written yet, set it
 *  based on whether the device supports biometrics. Called once at boot. */
export async function ensureDefaultPreference(): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(PREF_KEY);
    if (existing !== null) return;
    const available = await biometricsAvailable();
    await AsyncStorage.setItem(PREF_KEY, available ? 'true' : 'false');
    console.log('[biometrics] default preference set to:', available ? 'true' : 'false');
  } catch (e) {
    console.warn('[biometrics] ensureDefault failed:', (e as Error)?.message);
  }
}

/** Run the auth prompt. Returns true when the user successfully verified or
 *  when biometrics are not enabled / not available (i.e. nothing to gate
 *  on). Returns false on cancel / failure so the caller can show the lock
 *  screen and prompt for a retry. */
export async function authenticate(): Promise<boolean> {
  try {
    const enabled = await isLockEnabled();
    if (!enabled) return true;
    const available = await biometricsAvailable();
    if (!available) return true;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Open Inner Map',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
    });
    return !!result.success;
  } catch (e) {
    console.warn('[biometrics] authenticate threw:', (e as Error)?.message);
    return false;
  }
}
