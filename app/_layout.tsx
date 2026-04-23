// Root layout — wraps the entire app in a Stack so modal/overlay screens (onboarding,
// intake, terms) can push on top of the main tabs without unmounting them.
// The (tabs) group renders the five-tab navigator. Modals go here as sibling routes.

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '../constants/theme';

export default function RootLayout() {
  return (
    // GestureHandlerRootView must wrap everything so gesture handlers (bottom sheets,
    // swipeable panels) work anywhere inside the app. Reanimated is enabled globally via
    // the babel plugin — nothing to wire up at the React tree level for that.
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
          {/* Future: onboarding / intake / terms / self-prompt overlay screens
              go here as siblings. They'll push on top of the tabs stack. */}
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
