// Root layout — wraps the entire app in a Stack so modal/overlay screens (onboarding,
// intake, terms) can push on top of the main tabs without unmounting them.
// The (tabs) group renders the five-tab navigator. Modals go here as sibling routes.

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { colors } from '../constants/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
          {/* Future: onboarding / intake / terms / self-prompt overlay screens
              go here as siblings. They'll push on top of the tabs stack. */}
        </Stack>
      </View>
    </SafeAreaProvider>
  );
}
