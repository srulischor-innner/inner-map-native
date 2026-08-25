// PREVIEW ROOT — a throwaway expo-router root used only to LOOK at the
// reading element (founder ruling 2026-08-23: "nobody has seen it work").
//
// It is a separate router root, selected with EXPO_ROUTER_APP_ROOT=preview-app,
// so the real app/_layout.tsx — with its native-only sign-in, purchases and
// deep-link guards — is never loaded. Nothing in app/ is touched, and nothing
// in this directory ships.
import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function PreviewLayout() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0f' } }} />
    </SafeAreaProvider>
  );
}
