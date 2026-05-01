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
  // CRITICAL — timeout default is TRUE, not FALSE.
  //
  // The previous version returned `false` on timeout, which combined
  // with the redirect-on-incomplete gate in app/_layout.tsx produced
  // a hard onboarding loop on fresh installs: every flag read timed
  // out → every flag was false → redirect fired → remount → same
  // race → same redirect → infinite loop, app unusable.
  //
  // Defaulting to TRUE on timeout means the worst case is "user
  // reaches the main app despite not having onboarded" — which is
  // recoverable (each onboarding screen still writes its own flag
  // when completed, and the user can just back out and complete it).
  // The previous default of FALSE made the worst case "user is
  // permanently trapped in an onboarding loop" — not recoverable.
  //
  // We track the timeout firing via a closure flag rather than a
  // sentinel return value so a genuine null from AsyncStorage (the
  // expected fresh-install state when keys legitimately don't exist
  // and the read returns FAST) is still distinguishable from a real
  // timeout. Genuine fresh installs read null → return false → user
  // is correctly routed to /onboarding. Only ACTUAL timeouts default
  // to true.
  try {
    let timedOut = false;
    const raw = await Promise.race<string | null>([
      AsyncStorage.getItem(key),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          console.warn(
            `[onboarding] AsyncStorage.getItem(${key}) timed out @5000ms — defaulting to TRUE to break onboarding loop`,
          );
          resolve(null);
        }, 5000),
      ),
    ]);
    if (timedOut) return true;
    return raw === '1';
  } catch (e) {
    console.warn(`[onboarding] AsyncStorage.getItem(${key}) threw:`, (e as Error)?.message);
    // Throws are different from timeouts — these are typically
    // structural errors (storage corrupted, etc) where retrying
    // probably won't help. Default false is fine here; the redirect
    // guard prevents the loop, and the user lands on /onboarding
    // once where they can manually proceed.
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
