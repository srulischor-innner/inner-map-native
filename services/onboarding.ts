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
  // ---- 18+ age gate (2026-08) ----------------------------------------
  // ageGateBlocked  — set the moment a date of birth evaluates to under 18.
  //                   Survives backgrounding, force-quit and app updates, and
  //                   is checked at boot BEFORE any routing, so a declined
  //                   minor is not re-asked and cannot walk back into the
  //                   flow. Cleared only when a corrected date passes.
  // ageGateRetryUsed— set when the declined user takes the single correction
  //                   offer. Once set, the block screen has no way forward.
  //
  // NEITHER key records the date, the age, or anything derived from either
  // beyond "this device was declined". That is the entire on-device
  // footprint of a declined minor, by founder ruling: they are someone we
  // just declined to serve, and collecting their birthdate at that moment is
  // the one thing we actively must not do.
  ageGateBlocked:   'onboarding.ageGateBlocked',
  ageGateRetryUsed: 'onboarding.ageGateRetryUsed',
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
  // Boot I/O drain (July 2026 ANR mitigation): ONE multiGet instead of four
  // separate getItem round-trips through AsyncStorage's serial executor. Fewer
  // concurrent reads at cold start = less disk contention = the SharedPreferences
  // pre-warm thread (see plugins/withActivityResultPrewarm.js) finishes sooner.
  // Semantics preserved EXACTLY from the old per-key getBool path:
  //   - timeout @5000ms → default ALL true (break the onboarding/sign-in loop;
  //     each screen still writes its own flag, so next launch self-corrects),
  //   - structural throw → default all false (redirect guard prevents a loop;
  //     user lands on /onboarding once and proceeds manually).
  const keys = [KEYS.hasSeenIntro, KEYS.termsAccepted, KEYS.intakeComplete, KEYS.signInChoiceMade];
  try {
    let timedOut = false;
    const pairs = await Promise.race<readonly [string, string | null][] | null>([
      AsyncStorage.multiGet(keys),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          console.warn(
            '[onboarding] AsyncStorage.multiGet timed out @5000ms — defaulting to TRUE to break onboarding loop',
          );
          resolve(null);
        }, 5000),
      ),
    ]);
    if (timedOut || !pairs) {
      // ⚠️ termsAccepted stays FALSE here, deliberately, while the other three
      // default true (founder ruling 2026-07-30). The other three exist to
      // break onboarding/sign-in loops, and defaulting them true is the right
      // failure direction. Terms is a LEGAL gate: it must fail toward showing
      // the screen again. The cost of a false negative is one extra terms
      // screen on a slow boot; the cost of a false positive is a user inside
      // the app who never accepted. Nothing writes the flag on this path, so
      // no one is falsely RECORDED as accepting either.
      return { hasSeenIntro: true, termsAccepted: false, intakeComplete: true, signInChoiceMade: true };
    }
    const map = new Map<string, string | null>(pairs);
    const on = (k: string) => map.get(k) === '1';
    return {
      hasSeenIntro:     on(KEYS.hasSeenIntro),
      termsAccepted:    on(KEYS.termsAccepted),
      intakeComplete:   on(KEYS.intakeComplete),
      signInChoiceMade: on(KEYS.signInChoiceMade),
    };
  } catch (e) {
    console.warn('[onboarding] getOnboardingState multiGet threw:', (e as Error)?.message);
    return { hasSeenIntro: false, termsAccepted: false, intakeComplete: false, signInChoiceMade: false };
  }
}

export const markIntroSeen          = () => setBool(KEYS.hasSeenIntro, true);
export const markTermsAccepted      = () => setBool(KEYS.termsAccepted, true);

// ---- terms server-sync bookkeeping (2026-07-30) ----------------------------
// The local flag is a UI gate; the SERVER row is the audit trail. When the
// accept POST fails (offline is the obvious case) we still let the user
// through — re-showing terms every launch until they reconnect would be
// punitive — but we mark the sync PENDING so the boot reconciliation retries.
// Without this, an offline acceptance diverged permanently: local true,
// server never told, and nothing ever checked.
const TERMS_SYNC_PENDING = 'onboarding.termsSyncPending';
export const markTermsSyncPending  = () => setBool(TERMS_SYNC_PENDING, true);
export const clearTermsSyncPending = () => setBool(TERMS_SYNC_PENDING, false);
export async function isTermsSyncPending(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(TERMS_SYNC_PENDING)) === '1'; }
  catch { return false; }
}
export const markIntakeComplete     = () => setBool(KEYS.intakeComplete, true);
export const markPrivacyNoticeSeen  = () => setBool(KEYS.privacyNoticeSeen, true);

// ---- 18+ age gate (2026-08) -------------------------------------------------
// The device-local half of the gate. The SERVER half (age18Confirmed +
// timestamp + policy version, in user_settings) is the audit trail and is
// written only for users who PASS.
//
// WHAT A DECLINED MINOR DOES AND DOES NOT LEAVE BEHIND — stated precisely,
// because an earlier version of this comment ("no server row, no request, and
// no analytics event of any kind") was false of the FLOW even though it was
// true of the 'under' branch, and it is the kind of line that gets quoted into
// a privacy assessment.
//
//   NO age18 row, ever. No date of birth and no age is stored, sent or logged
//   anywhere, on any path — the date lives in component state, is reduced to a
//   boolean, and is discarded (utils/ageGate.ts). The 'under' branch itself
//   issues no request and fires no analytics event, and from that point on the
//   blocked branch in app/_layout.tsx returns before token bootstrap, terms
//   reconciliation, age reconciliation and RevenueCat identify, so a blocked
//   device makes no boot request either.
//
//   NO TERMS ROW EITHER, SINCE THE 2026-08 REORDER. The gate used to be intake
//   step 1, one phase AFTER terms, so api.acceptTerms() had already written
//   termsAccepted + termsAcceptedAt in user_settings against this user id by
//   the time anyone was declined. The gate is now its own onboarding phase
//   sitting BEFORE the terms screen, and AgeGateScreen's onPass is the only
//   writer of phase 'terms' in app/onboarding.tsx — so neither acceptTerms
//   call site is reachable without a passing evaluation. The live Terms of
//   Service promise to close the account and delete the data if we learn a
//   user is under 18; the founder chose to make that clause dormant by never
//   writing the row, rather than to fire a DELETE. Every phase upstream of the
//   gate (welcome, privacy notice) writes device-local flags only.
//
//   ROWS FROM BEFORE ONBOARDING STILL DO EXIST. If the user signed in before
//   onboarding (the sign-in screen runs first on a fresh install) an
//   auth_identities row holds their email, a user id was minted, and boot's
//   deferred token bootstrap may have run against it. None of that is created
//   by the gate and nothing here removes any of it; the erasure question is
//   with the founder and no deletion is performed from this path.
//
// markAgeGateBlocked is called the instant a date evaluates 'under', BEFORE
// the block screen renders — so a force-quit at the sight of the screen still
// leaves the device blocked. clearAgeGateBlocked exists for exactly one
// caller: a corrected date that passes.
export const markAgeGateBlocked   = () => setBool(KEYS.ageGateBlocked, true);
export const clearAgeGateBlocked  = () => AsyncStorage.removeItem(KEYS.ageGateBlocked).catch(() => {});
export const markAgeGateRetryUsed = () => setBool(KEYS.ageGateRetryUsed, true);

/** Is this device blocked? Read directly rather than through
 *  getOnboardingState because the answer must NOT participate in that call's
 *  "default everything true on timeout" loop-breaker.
 *
 *  THIS FUNCTION HAS NO TIMEOUT, AND CANNOT SENSIBLY HAVE ONE. The catch below
 *  handles a THROW. It does NOT handle a STALL — AsyncStorage hanging returns a
 *  promise that never settles, so there is nothing to catch and no value to
 *  return. Every caller must therefore impose its own cap AND choose its own
 *  fallback, because the safe direction differs by call site:
 *    - app/_layout.tsx boot gate  → cap 3000ms, fallback TRUE (unknown ⇒ do not
 *      let the device rest in the tabs; route to /onboarding).
 *    - the magic-link and notification handlers → same cap, same TRUE.
 *    - app/onboarding.tsx mount   → cap 3000ms, fallback FALSE (unknown ⇒ fall
 *      into the FLOW, never into the app, so the user meets the live gate at
 *      the 'age' phase rather than sitting on a held blank frame — and that
 *      phase is upstream of terms, so falling through lands nobody past it).
 *    - app/(tabs)/_layout.tsx backstop → cap 1500ms, fallback FALSE (it sits
 *      behind a boot gate that already failed closed).
 *  Adding a bare `await isAgeGateBlocked()` anywhere new re-opens the bypass
 *  this shape exists to prevent. */
export async function isAgeGateBlocked(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEYS.ageGateBlocked)) === '1'; }
  catch { return false; }
}

/** Has the single correction offer already been taken on this device? */
export async function isAgeGateRetryUsed(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEYS.ageGateRetryUsed)) === '1'; }
  catch { return false; }
}

// ---- age-confirmation server-sync bookkeeping ------------------------------
// Same contract as termsSyncPending directly above: the attestation POST is
// the audit trail, and an offline signup must not silently lose it. We let the
// user through (they ARE 18; refusing them over a dropped packet is punitive)
// and mark the sync pending so the boot reconciliation re-POSTs it.
const AGE_SYNC_PENDING = 'onboarding.age18SyncPending';
export const markAgeSyncPending  = () => setBool(AGE_SYNC_PENDING, true);
export const clearAgeSyncPending = () => setBool(AGE_SYNC_PENDING, false);
export async function isAgeSyncPending(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(AGE_SYNC_PENDING)) === '1'; }
  catch { return false; }
}
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
    // The age gate resets with everything else. This is a DEV-ONLY helper
    // (Settings → dev reset); it is not reachable by a declined user, who has
    // no route into the app at all.
    AsyncStorage.removeItem(KEYS.ageGateBlocked),
    AsyncStorage.removeItem(KEYS.ageGateRetryUsed),
    AsyncStorage.removeItem(AGE_SYNC_PENDING),
  ]);
}
