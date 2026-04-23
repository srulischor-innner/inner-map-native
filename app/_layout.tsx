// Root layout — wraps the entire app in a Stack with a boot-time gate that decides
// whether to show the onboarding flow or the main tabs. The gate reads three
// AsyncStorage flags (hasSeenIntro, termsAccepted, intakeComplete) and if any are
// missing, redirects the user to /onboarding on first render.
//
// GestureHandlerRootView sits at the outermost level so any future bottom sheets
// or swipeable surfaces work anywhere in the tree.

import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';

import { colors } from '../constants/theme';
import { getOnboardingState } from '../services/onboarding';
import { registerForPushNotifications } from '../services/push';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const router = useRouter();

  // Notification tap → navigate the user to the right tab. `route` is an optional
  // field on the notification payload; we default to chat when absent.
  const responseSubRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    (async () => {
      const state = await getOnboardingState();
      const complete = state.hasSeenIntro && state.termsAccepted && state.intakeComplete;
      if (!complete) {
        // Route the user to the onboarding flow. The (tabs) group is registered
        // below so the back navigation or completion replacement still works.
        router.replace('/onboarding');
      } else {
        // Only ask for push permission AFTER onboarding is done so the prompt
        // doesn't crash into the intake flow's focus.
        registerForPushNotifications().catch(() => {});
      }
      setReady(true);
    })();

    // Route on notification tap.
    responseSubRef.current = Notifications.addNotificationResponseReceivedListener(
      (resp) => {
        const data = resp.notification.request.content.data || {};
        const route = typeof data.route === 'string' ? data.route : '/';
        router.push(route);
      },
    );
    return () => { responseSubRef.current?.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {!ready ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.amber} />
          </View>
        ) : (
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
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
