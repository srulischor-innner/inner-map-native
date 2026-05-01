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
  // Per-key 5s timeout. The previous 1.5s was too aggressive for fresh
  // installs — AsyncStorage's first reads on a cold install can take
  // 2-3s while the storage backend warms up, and a premature timeout
  // returned `false` for every flag. Combined with the gate in
  // app/_layout.tsx that redirects to /onboarding when any flag is
  // false, that produced an onboarding-loop on fresh install: each
  // boot read timed out, all three returned false, redirect fired,
  // remount happened, same race repeated.
  // The root _layout's outer 3s timeout still acts as the ultimate
  // safety net if AsyncStorage genuinely hangs (it falls back to
  // "all true" so the user reaches the tabs rather than spinning).
  try {
    const raw = await Promise.race<string | null>([
      AsyncStorage.getItem(key),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          console.warn(`[onboarding] AsyncStorage.getItem(${key}) timed out @5000ms`);
          resolve(null);
        }, 5000),
      ),
    ]);
    return raw === '1';
  } catch (e) {
    console.warn(`[onboarding] AsyncStorage.getItem(${key}) threw:`, (e as Error)?.message);
    return false;
  }
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
