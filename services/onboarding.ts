// Onboarding flags — booleans stored in AsyncStorage. Mirrors the web app's
// dual-storage pattern but scoped to a single source on device (SecureStore is fine
// too but these flags aren't sensitive).
//
//   hasSeenIntro        — viewed the welcome slides at least once
//   termsAccepted       — tapped "I understand — continue" on the terms screen
//   intakeComplete      — completed (or intentionally skipped) the intake form
//   privacyNoticeSeen   — tapped "Got it →" on the first-launch privacy notice
//                         (the warm summary that runs between Welcome slides
//                         and Terms). Not part of the boot gate — by the time
//                         the user finishes intake the notice has been seen.
//                         markPrivacyNoticeSeen is its own setter so the
//                         onboarding screen can persist it the moment the
//                         user acknowledges.
//
// The gate in app/_layout.tsx reads hasSeenIntro / termsAccepted / intakeComplete
// only. Only when all three are true does the main app render; otherwise the
// user is routed to /onboarding.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  hasSeenIntro:       'onboarding.hasSeenIntro',
  termsAccepted:      'onboarding.termsAccepted',
  intakeComplete:     'onboarding.intakeComplete',
  privacyNoticeSeen:  'onboarding.privacyNoticeSeen',
  // Build 11 — set true once the user has made a sign-in choice on
  // the new sign-in screen (either signed in with a provider OR
  // explicitly opted into anonymous mode). Drives the boot gate
  // that routes brand-new installs to /sign-in BEFORE onboarding.
  // Existing Build-10 testers who upgrade have this flag absent
  // (false) AND hasSeenIntro=true — that combination triggers the
  // soft migration modal on next boot rather than the full sign-in
  // screen.
  signInChoiceMade:   'onboarding.signInChoiceMade',
  // Build 11 — bookkeeping for the soft migration modal. Dismiss
  // count increments every time the user taps "Remind me later";
  // after 5 dismissals OR 7 days, the modal shifts to an aggressive
  // variant that requires an explicit "continue anonymously" confirm.
  migrationDismissCount: 'onboarding.migrationDismissCount',
  migrationFirstSeenAt:  'onboarding.migrationFirstSeenAt',
  // Phase 2c (auth migration) — throttle for the gentle provider-link
  // nudge shown to users who ALREADY made a sign-in choice (i.e. opted
  // into anonymous) but are still unlinked. Distinct from the migration
  // modal's bookkeeping: this one re-surfaces periodically during the
  // grace window without ever escalating or trapping. lastShownAt is an
  // epoch-ms timestamp; shownCount caps the total number of reminders.
  graceNudgeLastShownAt: 'onboarding.graceNudgeLastShownAt',
  graceNudgeShownCount:  'onboarding.graceNudgeShownCount',
} as const;

export type OnboardingState = {
  hasSeenIntro: boolean;
  termsAccepted: boolean;
  intakeComplete: boolean;
  signInChoiceMade: boolean;
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
  const [a, b, c, d] = await Promise.all([
    getBool(KEYS.hasSeenIntro),
    getBool(KEYS.termsAccepted),
    getBool(KEYS.intakeComplete),
    getBool(KEYS.signInChoiceMade),
  ]);
  return { hasSeenIntro: a, termsAccepted: b, intakeComplete: c, signInChoiceMade: d };
}

export const markIntroSeen          = () => setBool(KEYS.hasSeenIntro, true);
export const markTermsAccepted      = () => setBool(KEYS.termsAccepted, true);
export const markIntakeComplete     = () => setBool(KEYS.intakeComplete, true);
export const markPrivacyNoticeSeen  = () => setBool(KEYS.privacyNoticeSeen, true);
// Build 11 — set when the user has either signed in OR explicitly
// chosen anonymous on the new sign-in screen. Boot gate uses this
// to decide whether to route brand-new installs to /sign-in.
export const markSignInChoiceMade   = () => setBool(KEYS.signInChoiceMade, true);

/** Read the migration-modal bookkeeping flags. Used by the chat-tab
 *  mount to decide whether to show the soft modal, the aggressive
 *  modal, or skip the prompt this session. Caller can also bump the
 *  dismissCount via incrementMigrationDismissCount() below. */
export async function getMigrationDismissState(): Promise<{
  dismissCount: number;
  firstSeenAt: number | null;
}> {
  try {
    const [c, f] = await Promise.all([
      AsyncStorage.getItem(KEYS.migrationDismissCount),
      AsyncStorage.getItem(KEYS.migrationFirstSeenAt),
    ]);
    return {
      dismissCount: c ? Math.max(0, parseInt(c, 10) || 0) : 0,
      firstSeenAt: f ? Math.max(0, parseInt(f, 10) || 0) || null : null,
    };
  } catch { return { dismissCount: 0, firstSeenAt: null }; }
}

/** Increment dismissCount; set firstSeenAt to now if not yet stamped.
 *  Returns the new dismissCount so the caller can branch on it. */
export async function incrementMigrationDismissCount(): Promise<number> {
  try {
    const cur = await AsyncStorage.getItem(KEYS.migrationDismissCount);
    const next = (cur ? Math.max(0, parseInt(cur, 10) || 0) : 0) + 1;
    await AsyncStorage.setItem(KEYS.migrationDismissCount, String(next));
    const seen = await AsyncStorage.getItem(KEYS.migrationFirstSeenAt);
    if (!seen) {
      await AsyncStorage.setItem(KEYS.migrationFirstSeenAt, String(Date.now()));
    }
    return next;
  } catch { return 0; }
}

/** Read-only check used by the onboarding screen to skip the privacy
 *  notice phase on re-entry if the user already acknowledged it in a
 *  prior incomplete onboarding attempt. */
export async function hasSeenPrivacyNotice(): Promise<boolean> {
  return getBool(KEYS.privacyNoticeSeen);
}

/** Phase 2c — read the grace-nudge throttle state. lastShownAt is null
 *  until the first reminder is shown. shownCount is the total reminders
 *  shown so far (caps the series so we never pester indefinitely). */
export async function getGraceNudgeState(): Promise<{
  lastShownAt: number | null;
  shownCount: number;
}> {
  try {
    const [t, c] = await Promise.all([
      AsyncStorage.getItem(KEYS.graceNudgeLastShownAt),
      AsyncStorage.getItem(KEYS.graceNudgeShownCount),
    ]);
    return {
      lastShownAt: t ? Math.max(0, parseInt(t, 10) || 0) || null : null,
      shownCount: c ? Math.max(0, parseInt(c, 10) || 0) : 0,
    };
  } catch { return { lastShownAt: null, shownCount: 0 }; }
}

/** Phase 2c — record that a grace nudge was just shown: stamp the time
 *  and bump the count. Called by the chat-tab mount the moment it decides
 *  to surface the reminder, so the throttle starts immediately. */
export async function markGraceNudgeShown(): Promise<void> {
  try {
    const cur = await AsyncStorage.getItem(KEYS.graceNudgeShownCount);
    const next = (cur ? Math.max(0, parseInt(cur, 10) || 0) : 0) + 1;
    await Promise.all([
      AsyncStorage.setItem(KEYS.graceNudgeShownCount, String(next)),
      AsyncStorage.setItem(KEYS.graceNudgeLastShownAt, String(Date.now())),
    ]);
  } catch { /* best-effort — a failed write just means we may re-nudge sooner */ }
}

/** Dev-only — wipes every flag so the next launch restarts onboarding.
 *  Includes the new privacy-notice flag so a dev-reset re-runs the
 *  full warm-onboarding experience, not a partial one. */
export async function resetOnboarding(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEYS.hasSeenIntro),
    AsyncStorage.removeItem(KEYS.termsAccepted),
    AsyncStorage.removeItem(KEYS.intakeComplete),
    AsyncStorage.removeItem(KEYS.privacyNoticeSeen),
    AsyncStorage.removeItem(KEYS.signInChoiceMade),
    AsyncStorage.removeItem(KEYS.migrationDismissCount),
    AsyncStorage.removeItem(KEYS.migrationFirstSeenAt),
    AsyncStorage.removeItem(KEYS.graceNudgeLastShownAt),
    AsyncStorage.removeItem(KEYS.graceNudgeShownCount),
  ]);
}
