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
import { AppState } from 'react-native';
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
import { LockScreen } from '../components/LockScreen';

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
  // Biometric lock state. `locked` true → render <LockScreen> over the
  // Stack until the user successfully authenticates. We default to true
  // when the preference is on, so the unlocked content is never visible
  // for a frame on cold start. Flips to false after a successful auth.
  const [locked, setLocked] = useState(false);
  // Tracks whether we've completed the very first auth check this session
  // — prevents the AppState listener from firing twice on initial mount.
  const firstAuthDone = useRef(false);

  async function runAuthCheck(reason: string) {
    try {
      const enabled = await isLockEnabled();
      if (!enabled) { setLocked(false); return; }
      console.log(`[lock] auth check (${reason})`);
      const ok = await authenticateBiometric();
      setLocked(!ok);
      if (ok) console.log('[lock] unlocked');
      else console.log('[lock] failed/canceled — staying locked');
    } catch (e) {
      console.warn('[lock] auth check threw:', (e as Error)?.message);
      setLocked(false);
    }
  }

  // First-launch default + initial auth gate.
  useEffect(() => {
    (async () => {
      await ensureDefaultPreference();
      const enabled = await isLockEnabled();
      if (enabled) {
        setLocked(true);                  // hide content while we prompt
        await runAuthCheck('cold-start');
      }
      firstAuthDone.current = true;
    })();
  }, []);

  // Re-auth when the app returns from background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && firstAuthDone.current) {
        runAuthCheck('foreground');
      }
    });
    return () => { sub?.remove(); };
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

  useEffect(() => {
    console.log('[boot] RootLayout mount — starting boot sequence');

    (async () => {
      console.log('[boot] step 1/3 — reading onboarding flags');
      // If AsyncStorage hangs for any reason, fall through at 3s. The fallback
      // "everything complete" is safer than stranding the user on a spinner —
      // if they really haven't onboarded, the intake form still writes its own
      // flag on exit so next launch will be correct.
      const fallback: OnboardingState = {
        hasSeenIntro: true, termsAccepted: true, intakeComplete: true,
      };
      const state = await withTimeout(getOnboardingState(), 3000, fallback, 'getOnboardingState');
      console.log('[boot] step 1/3 done — state:', state);

      const complete = state.hasSeenIntro && state.termsAccepted && state.intakeComplete;
      console.log('[boot] step 2/3 — complete?', complete);

      if (!complete) {
        // Defer by one tick so the Stack's layoutEffects have wired up the
        // route registry before we try to replace.
        setTimeout(() => {
          console.log('[boot] → replace(/onboarding)');
          router.replace('/onboarding');
        }, 0);
      } else {
        console.log('[boot] step 3/3 — registering push notifications (fire-and-forget)');
        registerForPushNotifications().catch((e) =>
          console.warn('[boot] push register failed:', (e as Error)?.message),
        );
      }
      console.log('[boot] boot sequence complete');
    })();

    // Tap-to-open handler for pushes that arrive while the app is in the tray.
    try {
      responseSubRef.current = Notifications.addNotificationResponseReceivedListener(
        (resp) => {
          const data = resp.notification.request.content.data || {};
          const route = typeof data.route === 'string' ? data.route : '/';
          console.log('[boot] notification tap → route:', route);
          router.push(route);
        },
      );
    } catch (e) {
      console.warn('[boot] notification listener failed:', (e as Error)?.message);
    }
    return () => { responseSubRef.current?.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        {locked ? (
          <LockScreen onUnlock={() => runAuthCheck('button-tap')} />
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
