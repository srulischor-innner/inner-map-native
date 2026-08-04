// Root layout — wraps the app in a Stack with a boot-time onboarding gate.
//
// HARDENED against every cause of "stuck on splash" we've hit so far:
//   1. The Stack is gated ONLY by the lock/font splash, and the boot
//      redirect waits for that gate to clear before it navigates. The
//      original bug here was gating Stack mount on `ready` while firing
//      router.replace('/onboarding') anyway — expo-router THROWS on a
//      replace with no navigator mounted, so the redirect was dropped.
//      Any future early return added to this component re-opens that hole
//      unless it is also reflected in `stackMounted` below.
//   2. getOnboardingState() is raced against a 3s timeout. Even if
//      AsyncStorage hangs, we proceed to a sensible default (assume
//      onboarded so the user lands on the main tabs).
//   3. Every step of the boot sequence logs to the Metro console so we
//      can see exactly where it stalls when it does.
//   4. The redirect to /onboarding runs after a setTimeout(0) so the
//      Stack's layoutEffects have fired and the route is registered.

import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, Image, StyleSheet, Alert, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { useFonts } from 'expo-font';

import { api, API_BASE_URL } from '../services/api';
import { markSignInChoiceMade } from '../services/onboarding';

import { colors } from '../constants/theme';
import {
  getOnboardingState, OnboardingState,
  isTermsSyncPending, clearTermsSyncPending,
} from '../services/onboarding';
import { registerForPushNotifications } from '../services/push';
import { configurePurchases, identifyUser } from '../services/purchases';
import { peekUserId } from '../services/user';
import { NOTIFICATIONS_ENABLED } from '../constants/features';
import {
  ensureDefaultPreference, authenticate as authenticateBiometric, isLockEnabled,
} from '../services/biometrics';
import { LockScreen } from '../components/LockScreen';

// =============================================================================
// SENTRY — crash + error reporting (June 2026). Initialized as early as
// possible (module-eval time) so even boot-path errors are captured. The DSN
// comes from app.config.js extra.sentryDsn (a public client key — safe in
// config); the source-map upload auth token is an EAS secret, never in code.
// Privacy: sendDefaultPii:false — this is a mental-health app, so we do NOT
// send PII to Sentry. Crash reporting only — no performance tracing / replay.
// A NEW EAS build is required for any of this to take effect on device.
// =============================================================================
const SENTRY_DSN = ((Constants.expoConfig?.extra as any)?.sentryDsn as string) || '';
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    // --- Content scrubbing (mental-health app: a crash report must carry NO
    // user content — conversations, journals, messages, or map data). We keep
    // the exception TYPE, STACK TRACE, and device/OS context (what actually
    // locates a crash) and strip every free-text field that could carry
    // content. ---
    // 1) Drop console breadcrumbs — the SDK records console.* by default, and
    //    a log line could include content. This is the main residual vector.
    beforeBreadcrumb: (breadcrumb) =>
      breadcrumb.category === 'console' ? null : breadcrumb,
    // 2) On the outgoing event: remove ALL breadcrumbs, and redact any
    //    free-text message / exception value (type + stack are preserved), so
    //    even an Error whose message interpolated user text cannot leak it.
    //    Also drop request payload + any app-set extra (the app sets neither
    //    today) as defense in depth.
    beforeSend: (event) => {
      delete event.breadcrumbs;
      if (event.message) event.message = '[redacted]';
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = '[redacted]';
        }
      }
      delete event.request;
      delete event.extra;
      return event;
    },
  });
  console.log('[sentry] initialized');
} else {
  console.warn('[sentry] no DSN in config.extra.sentryDsn — Sentry disabled');
}

// =============================================================================
// COLD-START DIAGNOSTICS — runs at module-evaluation time (after the imports
// above succeed). If you don't see "[splash] _layout.tsx is executing" in
// device logs (xcrun simctl log stream / Console.app on macOS, adb logcat
// on Android) then one of the IMPORT statements above threw and the file
// never finished evaluating — meaning the splash hangs because no React
// tree was ever defined. Common offender: a side-effect import in the
// transitive graph (e.g. react-native-get-random-values polyfill, native
// module not properly bundled in the standalone build).
// =============================================================================
console.log('[splash] _layout.tsx is executing');

// =============================================================================
// BOOT DIAGNOSTICS — API base URL + reachability probe.
//
// May 2026 Android outage post-mortem: Android Internal Testing build
// shipped without INTERNET permission (see app.config.js note on
// android.permissions). Zero requests reached Railway from ua=
// okhttp/4.12.0 — but nothing in the device logs immediately surfaced
// the cause, because every failure was just a generic toast in the
// auth flow and we had no boot-time observability. The two logs below
// give a 5-second triage path:
//
//   [boot] API_URL=...        — if this prints "" or anything other
//                               than the prod Railway URL, the build
//                               is misconfigured and no fetch will work
//   [boot] health: 200        — server reachable, networking OK
//   [boot] health FAILED: ... — server unreachable; the error message
//                               tells you whether it's TLS, DNS, blocked
//                               cleartext, missing INTERNET, etc.
//
// The health-check fires fire-and-forget so it adds no boot latency.
// It's wrapped in try/catch because a fetch crash on Android with no
// INTERNET permission throws synchronously in some RN builds, not as
// a rejected promise.
// =============================================================================
console.log(
  '[boot] API_URL=', API_BASE_URL,
  'platform=', Platform.OS,
  'isProd=', !__DEV__,
);
try {
  fetch(`${API_BASE_URL}/api/health`, { method: 'GET' })
    .then((r) => console.log('[boot] health:', r.status))
    .catch((e) => console.log('[boot] health FAILED:', (e as Error)?.message));
} catch (e) {
  console.log('[boot] health THREW SYNC:', (e as Error)?.message);
}

// Global uncaught-error logger. Installed once per JS context. Any error
// thrown after this point — whether in a useEffect, an async IIFE, a
// timer, or a render — gets logged with stack before whatever default
// handler runs. We chain to the previous handler so RN's default red-box
// behavior in dev still fires.
try {
  const G = (globalThis as any);
  if (G.ErrorUtils && typeof G.ErrorUtils.setGlobalHandler === 'function') {
    const prev = typeof G.ErrorUtils.getGlobalHandler === 'function'
      ? G.ErrorUtils.getGlobalHandler()
      : null;
    G.ErrorUtils.setGlobalHandler((err: Error, isFatal: boolean) => {
      console.error(
        '[splash][global error]',
        isFatal ? 'FATAL' : 'non-fatal',
        err?.message,
        err?.stack,
      );
      try { prev?.(err, isFatal); } catch {}
    });
    console.log('[splash] global error handler installed');
  } else {
    console.warn('[splash] ErrorUtils not available — cannot install global handler');
  }
} catch (e) {
  console.error('[splash] failed to install global error handler:', (e as Error)?.message);
}

// Module-level flags for the biometric lock. These persist for the life of
// the JS process — i.e. cold-start to cold-start. Two purposes:
//   1. hasAuthenticatedThisSession — once the user has unlocked, we never
//      prompt again from any code path during this run (no AppState
//      'active' churn, no remounts of RootLayout, nothing).
//   2. lastBackgroundedAt — when the app goes to background we stamp it.
//      On return-to-active, ONLY if more than 30 minutes have passed do
//      we clear the session flag and re-arm the lock. This stops the
//      "Face ID prompt every 2 seconds" bug where any system overlay
//      (notification, Control Center, Camera) was triggering an active
//      transition that kicked off a fresh auth.
let hasAuthenticatedThisSession = false;
let lastBackgroundedAt = 0;
const RE_AUTH_AFTER_BACKGROUND_MS = 30 * 60 * 1000;   // 30 minutes

// Loop guard. RootLayout's boot effect can run more than once per process
// (remount on router.replace, hot reload, etc). Without this flag, every
// remount that read flags-as-false would re-fire router.replace('/onboarding'),
// producing the onboarding-loop bug observed on fresh installs where the
// AsyncStorage read raced with a too-tight per-key timeout.
// Set true on first redirect, never reset for the life of the JS process —
// a cold launch is the only thing that re-arms it.
let hasRedirectedToOnboarding = false;

// Race helper — if `p` doesn't settle inside `ms`, resolve with `fallback`. Used
// to cap how long the boot sequence can spend reading flags from AsyncStorage.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T, tag: string): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[boot] ${tag} timed out after ${ms}ms — using fallback`);
      resolve(fallback);
    }, ms);
    p.then((v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      console.warn(`[boot] ${tag} threw — using fallback:`, (e as Error)?.message);
      resolve(fallback);
    });
  });
}

function RootLayout() {
  const router = useRouter();
  const responseSubRef = useRef<Notifications.Subscription | null>(null);
  // Biometric lock state. Both flags START AS TRUE so the very first
  // pixel rendered is the dark + triangle splash. Nothing else can
  // ever flash behind the Face ID prompt:
  //   - `locked` flips to false on successful auth OR when the lock
  //     preference is disabled (the runAuthCheck early-return below).
  //   - `isCheckingBiometrics` flips to false in the cold-start
  //     useEffect's finally block once the prompt resolves.
  //   - During cold-start (isCheckingBiometrics is true) we
  //     deliberately do NOT show the LockScreen overlay — just the
  //     dark triangle. The LockScreen only appears AFTER the initial
  //     check completes with a failure (locked && !isCheckingBiometrics).
  const [locked, setLocked] = useState(true);
  const [isCheckingBiometrics, setIsCheckingBiometrics] = useState(true);
  // Boot routing decision, held until there is a navigator to route WITH.
  // The boot effect DECIDES (reads the onboarding flags); the effect further
  // down DELIVERS, and only once the Stack is actually mounted. Keeping the
  // decision in state rather than firing it inline is the whole fix for the
  // dropped-redirect bug described on that effect.
  const [pendingRoute, setPendingRoute] = useState<'/sign-in' | '/onboarding' | null>(null);
  // Force-pass for the font-load gate. If useFonts hasn't resolved
  // within 2.5s — which happens in some preview/standalone builds
  // where asset bundling races with first render — we proceed with
  // system fonts rather than stranding the user on the dark splash.
  // The trade-off is one frame of fallback-font flash; the previous
  // unconditional gate could permanently brick the app on cold start
  // if any font asset failed to resolve.
  const [fontTimeoutElapsed, setFontTimeoutElapsed] = useState(false);

  // Run an auth prompt iff the lock preference is on AND the user hasn't
  // already authenticated this session. The session flag is the firewall
  // against the "every 2 seconds" bug: anything that re-enters this code
  // path (remounts, AppState transitions, etc.) is a no-op once the user
  // has unlocked once. The flag is reset only by full process death (cold
  // launch) or by the 30-minute background grace period below.
  async function runAuthCheck(reason: string) {
    if (hasAuthenticatedThisSession) {
      console.log(`[lock] skip (${reason}) — already authenticated this session`);
      return;
    }
    try {
      const enabled = await isLockEnabled();
      if (!enabled) { setLocked(false); return; }
      console.log(`[lock] auth check (${reason})`);
      const ok = await authenticateBiometric();
      if (ok) {
        hasAuthenticatedThisSession = true;
        setLocked(false);
        console.log('[lock] unlocked');
      } else if (reason === 'cold-start') {
        // Fresh-install Face ID escape hatch. The first cold-start
        // prompt on iOS is the OS-level permission grant; if the user
        // declines or cancels it, the app would otherwise stay locked
        // forever with no recovery path (the LockScreen's Unlock
        // button just re-prompts, which they've already declined).
        // Fall open instead — they can re-enable the lock from the
        // settings screen if they want it. Better recoverable wrong
        // than permanently trapped.
        console.log('[lock] cold-start auth failed/canceled — unlocking to avoid permanent trap');
        hasAuthenticatedThisSession = true;
        setLocked(false);
      } else {
        setLocked(true);
        console.log('[lock] failed/canceled — staying locked');
      }
    } catch (e) {
      console.warn('[lock] auth check threw:', (e as Error)?.message);
      // Fail-open rather than trapping the user behind a black screen if
      // the biometric subsystem itself misbehaves.
      setLocked(false);
    }
  }

  // ONE-TIME cold-start auth gate. Empty deps array — runs once per
  // process. No AppState listener that fires on every focus change.
  // While this is in flight we keep `isCheckingBiometrics` true so the
  // app renders only a dark+triangle splash; nothing else is visible
  // behind / around the Face ID prompt.
  useEffect(() => {
    (async () => {
      try {
        await ensureDefaultPreference();
        const enabled = await isLockEnabled();
        // Lock preference is OFF, OR this is a remount within the same
        // process and we're already authenticated. Either way, no auth
        // prompt — but `locked` was initialized to TRUE so we must
        // explicitly flip it false here so the splash gate exits.
        if (!enabled || hasAuthenticatedThisSession) {
          setLocked(false);
          return;
        }
        // Lock IS on. Don't bother flipping locked (it's already true).
        // runAuthCheck handles the success → setLocked(false) path.
        await runAuthCheck('cold-start');
      } catch (e) {
        // Top-level throw in the auth path. expo-local-authentication can
        // explode on cold start in standalone/preview builds when the
        // OS Face ID stack isn't ready yet — never let that strand the
        // user on splash. Fall open.
        console.error('[boot] cold-start auth threw — falling open:', (e as Error)?.message);
        hasAuthenticatedThisSession = true;
        setLocked(false);
      } finally {
        setIsCheckingBiometrics(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background grace-period guard. When the app moves to 'background' we
  // stamp the time. On return to 'active' we only re-arm the lock if it
  // has been MORE THAN 30 MINUTES since the user backgrounded. Anything
  // shorter (notifications, Control Center pull-down, brief switch to
  // another app, screen dim) is treated as continuous use — no prompt.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      try {
        if (next === 'background' || next === 'inactive') {
          lastBackgroundedAt = Date.now();
          return;
        }
        if (next !== 'active') return;
        // No previous backgrounding stamp → first activation, handled by
        // the cold-start effect above. Don't double-prompt.
        if (lastBackgroundedAt === 0) return;
        const awayMs = Date.now() - lastBackgroundedAt;
        if (awayMs < RE_AUTH_AFTER_BACKGROUND_MS) return;
        // Long enough away to require another auth.
        console.log(`[lock] grace expired (${Math.round(awayMs / 60000)}m) — re-arming`);
        hasAuthenticatedThisSession = false;
        (async () => {
          try {
            const enabled = await isLockEnabled();
            if (!enabled) return;
            setLocked(true);
            await runAuthCheck('grace-expired');
          } catch (e) {
            console.warn('[lock] grace re-arm threw:', (e as Error)?.message);
          }
        })();
      } catch (e) {
        console.warn('[lock] AppState handler threw:', (e as Error)?.message);
      }
    });
    return () => {
      try { sub?.remove(); } catch {}
    };
  }, []);

  // Load the custom font pairing (Cormorant Garamond for display, DM Sans
  // for body). TTFs live in assets/fonts/ and are required directly — we
  // used to pull them from @expo-google-fonts/* but that package's barrel
  // export caused a resolve failure on some bundles, so we own the assets
  // now. Keys passed to useFonts must match the `fontFamily` values in
  // theme.ts exactly.
  //
  // We intentionally don't BLOCK the Stack on font load — components fall
  // back to system fonts during the brief load window and swap in the
  // custom faces once `fontsLoaded` flips true. This keeps cold-start
  // fast and avoids any chance of a font-load hang stranding the user.
  const [fontsLoaded] = useFonts({
    CormorantGaramond_400Regular:         require('../assets/fonts/CormorantGaramond-Regular.ttf'),
    CormorantGaramond_400Regular_Italic:  require('../assets/fonts/CormorantGaramond-Italic.ttf'),
    CormorantGaramond_600SemiBold:        require('../assets/fonts/CormorantGaramond-SemiBold.ttf'),
    DMSans_400Regular:                    require('../assets/fonts/DMSans-Regular.ttf'),
    DMSans_500Medium:                     require('../assets/fonts/DMSans-Medium.ttf'),
    DMSans_600SemiBold:                   require('../assets/fonts/DMSans-SemiBold.ttf'),
  });
  useEffect(() => {
    if (fontsLoaded) console.log('[boot] custom fonts loaded ✓');
  }, [fontsLoaded]);

  // Font-load timeout safety net — see fontTimeoutElapsed comment above.
  // 2.5s is generous; useFonts normally resolves within a few hundred ms.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!fontsLoaded) {
        console.warn('[boot] font load did not resolve in 2.5s — proceeding with fallback fonts');
        setFontTimeoutElapsed(true);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [fontsLoaded]);

  useEffect(() => {
    console.log('[boot] RootLayout mount — starting boot sequence');

    // ENTIRE boot sequence wrapped in try/catch — this is the critical
    // path on cold start, and anything thrown here previously bubbled
    // up as an uncaught promise rejection that could crash the app
    // before any UI rendered (preview/standalone builds with no Metro
    // surface this as "stuck on splash"). Throws now log-and-skip; the
    // app reaches the main tabs regardless.
    (async () => {
      try {
        // Phase 2b — bootstrap-on-launch. An existing anonymous user with a
        // stored UUID but no tokens trades the UUID for a token pair (sub =
        // same UUID, all data preserved). No-op once tokens exist, on a
        // brand-new install with no UUID yet, or on any failure (stays on
        // X-User-Id dual-accept).
        //
        // DEFERRED (2026-07-30) — it used to fire HERE, concurrently with the
        // onboarding read, and that was the main cause of the 5s multiGet
        // timeouts. bootstrapTokens fans out to up to 4 SecureStore reads
        // (EncryptedSharedPreferences + AndroidKeyStore master-key retrieval on
        // first open) AND up to 4 AsyncStorage reads, each with an 8000ms
        // timeout — i.e. LONGER than the multiGet's own 5000ms, so a stalled
        // leg could not clear itself before the read it was blocking gave up.
        // On Android AsyncStorage runs one serial executor, so those reads sat
        // directly in front of the four onboarding keys.
        //
        // This is the "deferred bootstrap" half of the pairing that
        // plugins/withActivityResultPrewarm.js prescribes in its header
        // ("pair with the boot-I/O drain ... so the pre-warm thread gets disk
        // time"). It was never implemented until now. Moved below the boot
        // gate so routing — and the SharedPreferences pre-warm — get the disk
        // first. Still fire-and-forget; nothing awaits it.

        console.log('[boot] step 1/3 — reading onboarding flags');
        // If AsyncStorage hangs, fall through at 3s. Fallback "everything
        // complete" is safer than spinning forever — per-screen flags
        // still write themselves as the user touches each onboarding
        // screen, so next launch corrects itself.
        const fallback: OnboardingState = {
          hasSeenIntro: true, termsAccepted: true, intakeComplete: true,
          // Build 11 — default signInChoiceMade=true on timeout so a
          // stalled storage doesn't trap the user on /sign-in. The
          // sign-in screen still routes back to /onboarding on
          // explicit completion; defaulting true means the worst
          // case is "user lands on the main app without having seen
          // the sign-in screen" rather than "user is stuck on
          // sign-in forever."
          signInChoiceMade: true,
        };
        const state = await withTimeout(getOnboardingState(), 3000, fallback, 'getOnboardingState');
        console.log('[boot] step 1/3 done — state:', state);

        // Build 11 boot routing — TWO sequential gates:
        //   Gate A: signInChoiceMade=false AND hasSeenIntro=false →
        //     FRESH INSTALL on Build 11. Send to /sign-in. After the
        //     user signs in (or explicitly chooses anonymous), the
        //     sign-in screen sets signInChoiceMade=true and routes
        //     to /onboarding for the existing welcome → privacy →
        //     terms → intake flow.
        //   Gate B: onboarding incomplete (the existing rule) →
        //     /onboarding.
        //   Otherwise (fully onboarded) → fall through to the main
        //     tabs. The chat tab's mount checks /api/auth/identities
        //     and surfaces MigrationModal if the user is still
        //     anonymous AND signInChoiceMade=false (existing Build-10
        //     tester upgrading).
        const needsSignIn = !state.signInChoiceMade && !state.hasSeenIntro;
        const complete = state.hasSeenIntro && state.termsAccepted && state.intakeComplete;
        console.log(`[boot] step 2/3 — needsSignIn=${needsSignIn} complete=${complete}`);

        // DECIDE ONLY. Do not navigate from here — see the delivery effect
        // below for why an inline router.replace() at this point is thrown
        // away rather than honored.
        if (needsSignIn && !hasRedirectedToOnboarding) {
          console.log('[boot] → queue replace(/sign-in)');
          setPendingRoute('/sign-in');
        } else if (!complete && !hasRedirectedToOnboarding) {
          console.log('[boot] → queue replace(/onboarding)');
          setPendingRoute('/onboarding');
        } else if (!complete) {
          console.log('[boot] flags incomplete but already redirected this session — not re-redirecting');
        } else {
          if (NOTIFICATIONS_ENABLED) {
            console.log('[boot] step 3/3 — registering push notifications (fire-and-forget)');
            registerForPushNotifications().catch((e) =>
              console.warn('[boot] push register failed:', (e as Error)?.message),
            );
          } else {
            console.log('[boot] step 3/3 — push registration gated off (NOTIFICATIONS_ENABLED=false)');
          }
        }
        console.log('[boot] boot sequence complete');

        // ---- DEFERRED WORK (2026-07-30) --------------------------------
        // Everything below runs AFTER routing is decided, so it competes with
        // nothing on the critical path. Both are fire-and-forget.

        // 1. Token bootstrap (moved from the top of this effect — see the note
        //    there for why it was the main source of the multiGet stall).
        api.bootstrapTokens()
          .then((r) => console.log('[boot] bootstrapTokens →', r))
          .catch((e) => console.warn('[boot] bootstrapTokens threw:', (e as Error)?.message));

        // 2. TERMS RECONCILIATION. The local flag is a UI gate; the SERVER row
        //    is the audit trail, and until now nothing ever compared them —
        //    GET /api/terms had zero callers. Two divergences to heal, both
        //    only ever in the direction of RECORDING an acceptance that
        //    already happened; this never grants or revokes access, and never
        //    marks anyone as having accepted who did not:
        //      a. sync pending — the accept POST failed (offline). Retry it.
        //      b. local says accepted, server does not know — an older client
        //         wrote the flag before the POST existed or before it landed.
        //    A null from getTerms means "unknown" (transport failure) and is
        //    deliberately NOT treated as "not accepted".
        (async () => {
          try {
            const [pending, local] = await Promise.all([
              isTermsSyncPending(),
              getOnboardingState().then((s) => s.termsAccepted).catch(() => false),
            ]);
            if (!pending && !local) return;              // nothing to reconcile
            const server = await api.getTerms();
            if (server === null) return;                 // unknown — try again next launch
            if (server.termsAccepted) {
              if (pending) await clearTermsSyncPending();
              return;
            }
            if (local || pending) {
              const ok = await api.acceptTerms();
              console.log(`[terms] reconcile → server had no record, re-POSTed: ${ok ? 'ok' : 'failed'}`);
              if (ok) await clearTermsSyncPending();
            }
          } catch (e) {
            console.warn('[terms] reconcile threw:', (e as Error)?.message);
          }
        })();
      } catch (e) {
        console.error('[boot] boot sequence threw — proceeding to main app anyway:', (e as Error)?.message, (e as Error)?.stack);
      }
    })();

    // Tap-to-open handler for pushes that arrive while the app is in the tray.
    try {
      responseSubRef.current = Notifications.addNotificationResponseReceivedListener(
        (resp) => {
          try {
            const data = resp.notification.request.content.data || {};
            const route = typeof data.route === 'string' ? data.route : '/';
            console.log('[boot] notification tap → route:', route);
            router.push(route);
          } catch (e) {
            console.warn('[boot] notification tap handler threw:', (e as Error)?.message);
          }
        },
      );
    } catch (e) {
      console.warn('[boot] notification listener registration failed:', (e as Error)?.message);
    }

    // Build 11 — magic-link deep-link handler. The user's email
    // contains https://my-inner-map.com/auth/email?token=…; on iOS
    // and Android the universal-link / app-link routes that URL
    // straight into this app (via associatedDomains / intentFilters
    // in app.config.js). Tapping the link from inside the email
    // client opens the app with that URL as the initial deep link.
    //
    // We also accept the bare innermap://auth/email?token=… scheme
    // — used by the web fallback landing page when universal links
    // don't intercept (desktop browser opens, etc.).
    //
    // Handles both:
    //   - cold-launch (Linking.getInitialURL on first render)
    //   - warm relaunch (Linking.addEventListener while in foreground)
    const consumeAuthEmailUrl = async (url: string) => {
      try {
        if (!url) return;
        const parsed = Linking.parse(url);
        const isAuthEmail =
          (parsed.scheme === 'innermap' && parsed.hostname === 'auth' &&
            (parsed.path === '/email' || parsed.path === 'email')) ||
          (parsed.hostname === 'my-inner-map.com' && /\/auth\/email\/?$/.test(parsed.path || ''));
        if (!isAuthEmail) return;
        const token = parsed.queryParams?.token;
        const tokenStr = Array.isArray(token) ? token[0] : token;
        if (typeof tokenStr !== 'string' || !tokenStr) {
          console.warn('[boot] magic-link URL missing token:', url);
          return;
        }
        console.log('[boot] magic-link deep link received — completing sign-in');
        const out = await api.authSignIn('email', tokenStr);
        if (!out) {
          Alert.alert(
            'Sign-in link expired',
            'This link is invalid or has expired (links are good for 15 minutes). Request a fresh sign-in email.',
          );
          return;
        }
        await markSignInChoiceMade();
        // If the user was on /sign-in (or hasn't onboarded), proceed
        // to /onboarding. If they're already in the main app (e.g.
        // signing in from settings via a fresh email link), just
        // stay where they are — the api method has already updated
        // SecureStore with the resolved userId.
        try {
          router.replace(out.isNewUser ? '/onboarding' : '/');
        } catch (e) {
          console.warn('[boot] post-magic-link routing threw:', (e as Error)?.message);
        }
      } catch (e) {
        console.warn('[boot] magic-link handler threw:', (e as Error)?.message);
      }
    };
    Linking.getInitialURL().then((url) => {
      if (url) {
        console.log('[boot] initial URL:', url);
        consumeAuthEmailUrl(url);
      }
    }).catch(() => {});
    const linkingSub = Linking.addEventListener('url', (event) => {
      console.log('[boot] foreground URL event:', event?.url);
      if (event?.url) consumeAuthEmailUrl(event.url);
    });

    return () => {
      try { responseSubRef.current?.remove(); } catch {}
      try { linkingSub?.remove?.(); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // REVENUECAT — configure, then bind the store identity to OUR user id.
  //
  // Top-level effect on purpose. There are two return branches below
  // (lock/splash, main Stack) and the SDK has to be configured in both: an
  // entitlement read can be requested by the first screen the user lands on,
  // whichever that is. (Was three until the landing hold was removed.)
  //
  // UNGATED logIn — this app has no authenticated boot phase. There is no
  // auth context and no isSignedIn flag; every user, anonymous or
  // provider-linked, carries a stable UUID from first launch. Waiting for a
  // "signed in" signal that never arrives would strand anonymous purchases
  // under a RevenueCat-minted anonymous id, and the purchase webhook would
  // then have no user row to land on. So identify fires immediately after
  // configure, for everyone.
  //
  // ORDER IS LOAD-BEARING: identifyUser() funnels through readySdk(), which
  // returns null until configure() has actually run. Awaiting configure
  // first is what makes the logIn a real call instead of a silent no-op.
  //
  // peekUserId() rather than getUserId(): peek never MINTS. On a genuine
  // first launch the id doesn't exist yet and getUserId would create one
  // here, ahead of the sign-in screen's migration branch (which passes the
  // existing anonymous id to the server precisely so a fresh UUID isn't
  // minted). A null just means "not yet" — we still configure, and skip
  // identify.
  //
  // That skip is NOT the last word, and must not be: a first-launch user who
  // reaches the store this session would otherwise transact under a
  // RevenueCat anonymous id, which is the exact webhook-matching failure the
  // ungated logIn exists to prevent. services/purchases.ts closes it —
  // purchase() and restore() both bind the current id immediately before the
  // store call (ensureIdentified), and re-bind if sign-in swapped the
  // identity after this effect ran. So this is the EARLY binding, not the
  // only one.
  //
  // Fire-and-forget, and nothing here can throw: services/purchases.ts
  // resolves every failure to a value, and the .catch is the backstop for
  // the peek (SecureStore/AsyncStorage). Placed after the boot effect above
  // so its two store reads queue behind routing on Android's serial
  // AsyncStorage executor rather than in front of it.
  // =========================================================================
  useEffect(() => {
    (async () => {
      await configurePurchases();
      const userId = await peekUserId();
      if (!userId) {
        console.log('[purchases] no user id yet — configured; identity binds at first store call');
        return;
      }
      await identifyUser(userId);
    })().catch((e) =>
      console.warn('[purchases] boot wiring threw:', (e as Error)?.message),
    );
  }, []);

  // Hoisted above the render gate because the redirect-delivery effect below
  // needs it too: it is one of the three conditions that decide whether the
  // Stack — and therefore a navigator — is on screen this render.
  const fontsReady = fontsLoaded || fontTimeoutElapsed;

  // =========================================================================
  // BOOT REDIRECT — DELIVERY. Gated on the Stack actually being mounted.
  //
  // WHY THIS EXISTS (bug, not polish). expo-router's router.replace() is not
  // queued when there is no navigator: linkTo() calls assertIsReady(), which
  // reads navigationRef.isReady() — implemented in React Navigation as
  // "has a navigator registered a focus listener yet" — and THROWS if not.
  // Every early return in this component (the lock/font splash, and until
  // now the landing screen) renders a bare View, so during those returns no
  // navigator exists and any replace() thrown from the boot effect died in
  // its catch block. The old code set hasRedirectedToOnboarding to true
  // BEFORE firing, so the throw was never retried: the user simply stayed on
  // the tabs. With a ~3.9s landing hold in front of the Stack and the flag
  // read capped at 3s, the boot decision ALWAYS landed inside that window —
  // so the onboarding/sign-in redirect was dead on every cold start that
  // needed it, from 58fddbf until now.
  //
  // `stackMounted` mirrors the render gate below exactly. When it flips true,
  // this effect runs AFTER that commit — and React fires child effects before
  // parent effects, so the Stack's navigator has already registered its focus
  // listener by the time we get here. The setTimeout(0) is a one-tick defer
  // for the route registry, NOT a stand-in for the readiness signal; the
  // signal is stackMounted.
  //
  // hasRedirectedToOnboarding is now set on SUCCESS rather than on intent, so
  // a replace that somehow still throws leaves pendingRoute set and gets
  // another attempt on the next render instead of silently stranding the user.
  // =========================================================================
  const stackMounted = !isCheckingBiometrics && !locked && fontsReady;
  useEffect(() => {
    if (!pendingRoute || !stackMounted) return;
    const t = setTimeout(() => {
      try {
        console.log(`[boot] → replace(${pendingRoute})`);
        router.replace(pendingRoute);
        hasRedirectedToOnboarding = true;
        setPendingRoute(null);
      } catch (e) {
        console.warn(
          `[boot] router.replace(${pendingRoute}) threw — retrying on next render:`,
          (e as Error)?.message,
        );
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoute, stackMounted]);

  // INVARIANT: render NOTHING but the dark splash + triangle while
  // ANY of these are true:
  //   - isCheckingBiometrics — the cold-start auth check hasn't
  //     resolved yet (initialized to TRUE on first render).
  //   - locked — auth has failed, OR we haven't authenticated yet
  //     this session and the lock is on (initialized to TRUE).
  //   - fonts not yet ready — `fontsLoaded` is true OR the 2.5s
  //     timeout (`fontTimeoutElapsed`) has fired. Either condition
  //     proceeds; the timeout is the safety net for preview/standalone
  //     builds where useFonts can fail to resolve and otherwise strand
  //     the user on splash forever.
  // The LockScreen overlay (with the explicit Unlock pill) ONLY
  // renders once the initial check has completed. During the
  // first-prompt window we show the bare dark triangle so Face ID
  // appears OVER nothing-but-icon.
  if (isCheckingBiometrics || locked || !fontsReady) {
    const showLockScreen = locked && !isCheckingBiometrics && fontsReady;
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0a0a0f' }}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <View style={splashStyles.root}>
            <Image
              source={require('../assets/icon.png')}
              style={splashStyles.icon}
              resizeMode="contain"
            />
          </View>
          {showLockScreen ? (
            <LockScreen onUnlock={() => runAuthCheck('button-tap')} />
          ) : null}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // The ~3.9s LandingScreen hold that used to sit HERE is GONE (founder call,
  // 2026-08-03). It was introduced to buy a background window for the chat
  // tab's returning-greeting fetch; that endpoint is deleted, and the premise
  // was never true anyway — this branch returned INSTEAD of the Stack, so the
  // tabs were not mounted and nothing was loading behind it. Every other
  // candidate consumer was traced and none is real: fonts have their own gate
  // above, the terms reconciliation is fire-and-forget with no UI, token
  // bootstrap is additive with an X-User-Id fallback, and the chat tab's
  // first-session status fetch cannot start until the tabs mount, which the
  // hold delayed rather than covered. Its only real effect was to keep the
  // navigator unmounted across the entire boot-routing window — see the
  // delivery effect above.
  //
  // Nothing replaces it: the splash branch above already owns every frame from
  // process start until biometrics/fonts resolve, and it shares this exact
  // background (#0a0a0f) and icon, so the handoff is a same-color cut, not a
  // blank or a flash.

  // Stack renders as soon as the splash gate clears — no spinner gate of its
  // own. A user who needs onboarding will flash the tabs for <100ms before the
  // replace takes effect; acceptable vs. the risk of hanging on a spinner
  // forever.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const splashStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: { width: 120, height: 120, opacity: 0.9 },
});

// Wrap the root with Sentry so render/navigation errors are captured with
// component context. Sentry.wrap is a transparent passthrough when init was
// skipped (no DSN), so this is safe in every build.
export default Sentry.wrap(RootLayout);
