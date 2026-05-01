// Root layout — wraps the app in a Stack with a boot-time onboarding gate.
//
// HARDENED against every cause of "stuck on splash" we've hit so far:
//   1. The Stack is ALWAYS rendered so Expo Router has a live navigator.
//      We no longer gate Stack mount on `ready` — that used to drop the
//      router.replace('/onboarding') call before the navigator existed.
//   2. getOnboardingState() is raced against a 3s timeout. Even if
//      AsyncStorage hangs, we proceed to a sensible default (assume
//      onboarded so the user lands on the main tabs).
//   3. Every step of the boot sequence logs to the Metro console so we
//      can see exactly where it stalls when it does.
//   4. The redirect to /onboarding runs after a setTimeout(0) so the
//      Stack's layoutEffects have fired and the route is registered.

import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, Image, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useFonts } from 'expo-font';

import { colors } from '../constants/theme';
import { getOnboardingState, OnboardingState } from '../services/onboarding';
import { registerForPushNotifications } from '../services/push';
import {
  ensureDefaultPreference, authenticate as authenticateBiometric, isLockEnabled,
} from '../services/biometrics';
// import { LockScreen } from '../components/LockScreen';  // TEMP: bypassed — see _layout render below
import { LandingScreen } from '../components/LandingScreen';

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

export default function RootLayout() {
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
  // True until the LandingScreen completes its 1500ms hold. Shown after
  // biometrics pass on every cold open so the user lands on a calm
  // arrival moment instead of jumping straight into the chat tab.
  const [showLanding, setShowLanding] = useState(true);
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
        console.log('[boot] step 1/3 — reading onboarding flags');
        // If AsyncStorage hangs, fall through at 3s. Fallback "everything
        // complete" is safer than spinning forever — per-screen flags
        // still write themselves as the user touches each onboarding
        // screen, so next launch corrects itself.
        const fallback: OnboardingState = {
          hasSeenIntro: true, termsAccepted: true, intakeComplete: true,
        };
        const state = await withTimeout(getOnboardingState(), 3000, fallback, 'getOnboardingState');
        console.log('[boot] step 1/3 done — state:', state);

        const complete = state.hasSeenIntro && state.termsAccepted && state.intakeComplete;
        console.log('[boot] step 2/3 — complete?', complete);

        if (!complete && !hasRedirectedToOnboarding) {
          hasRedirectedToOnboarding = true;
          // Defer by one tick so the Stack's layoutEffects have wired up the
          // route registry before we try to replace.
          setTimeout(() => {
            try {
              console.log('[boot] → replace(/onboarding)');
              router.replace('/onboarding');
            } catch (e) {
              console.warn('[boot] router.replace threw:', (e as Error)?.message);
            }
          }, 0);
        } else if (!complete) {
          console.log('[boot] flags incomplete but already redirected this session — not re-redirecting');
        } else {
          console.log('[boot] step 3/3 — registering push notifications (fire-and-forget)');
          registerForPushNotifications().catch((e) =>
            console.warn('[boot] push register failed:', (e as Error)?.message),
          );
        }
        console.log('[boot] boot sequence complete');
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
    return () => {
      try { responseSubRef.current?.remove(); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const fontsReady = fontsLoaded || fontTimeoutElapsed;
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
            // TEMP: LockScreen replaced with plain View to isolate
            // whether @shopify/react-native-skia is the cause of the
            // standalone-build splash hang. If the app loads past
            // splash with this change, Skia's native binary inclusion
            // is the culprit and the real LockScreen needs to be
            // restored once Skia is fixed.
            <View style={{ flex: 1, backgroundColor: '#000' }} />
          ) : null}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // After biometrics, before the tabs — show the LandingScreen for ~1500ms.
  // This is the arrival moment + a free window for the returning-greeting
  // fetch on the chat tab to complete in the background.
  if (showLanding) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0a0a0f' }}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <LandingScreen onReady={() => setShowLanding(false)} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // Stack is ALWAYS rendered — no spinner gate. A user who needs onboarding
  // will flash the tabs for <100ms before the replace takes effect; acceptable
  // vs. the risk of hanging on a spinner forever.
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
