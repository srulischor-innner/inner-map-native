// Onboarding flags — three booleans stored in AsyncStorage. Mirrors the web app's
// dual-storage pattern but scoped to a single source on device (SecureStore is fine
// too but these flags aren't sensitive).
//
//   hasSeenIntro     — viewed the welcome slides at least once
//   termsAccepted    — tapped "I understand — continue" on the terms screen
//   intakeComplete   — completed (or intentionally skipped) the intake form
//
// The gate in app/_layout.tsx reads all three on mount. Only when all three are true
// does the main app render; otherwise the user is routed to /onboarding.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  hasSeenIntro:   'onboarding.hasSeenIntro',
  termsAccepted:  'onboarding.termsAccepted',
  intakeComplete: 'onboarding.intakeComplete',
} as const;

export type OnboardingState = {
  hasSeenIntro: boolean;
  termsAccepted: boolean;
  intakeComplete: boolean;
};

async function getBool(key: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(key)) === '1'; }
  catch { return false; }
}
async function setBool(key: string, v: boolean): Promise<void> {
  try { await AsyncStorage.setItem(key, v ? '1' : '0'); }
  catch {}
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const [a, b, c] = await Promise.all([
    getBool(KEYS.hasSeenIntro),
    getBool(KEYS.termsAccepted),
    getBool(KEYS.intakeComplete),
  ]);
  return { hasSeenIntro: a, termsAccepted: b, intakeComplete: c };
}

export const markIntroSeen      = () => setBool(KEYS.hasSeenIntro, true);
export const markTermsAccepted  = () => setBool(KEYS.termsAccepted, true);
export const markIntakeComplete = () => setBool(KEYS.intakeComplete, true);

/** Dev-only — wipes every flag so the next launch restarts onboarding. */
export async function resetOnboarding(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.hasSeenIntro),
    AsyncStorage.removeItem(KEYS.termsAccepted),
    AsyncStorage.removeItem(KEYS.intakeComplete),
  ]);
}
