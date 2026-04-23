// Five-tab layout: Chat / Map / Journal / Journey / Guide.
// Chat is the default route (index.tsx). Tab bar is dark with an amber accent
// on the active tab and respects the home indicator via safe-area insets.

import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { colors, fonts } from '../../constants/theme';

// Tiny text-only icon — we'll swap to proper SVG/PNG icons later.
// Keeping the shell icon-free for now so the visual language is set purely
// by the tab label + the amber active underline.
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Text
        style={{
          fontSize: 11,
          fontWeight: focused ? fonts.bold : fonts.medium,
          letterSpacing: 1.4,
          color: focused ? colors.amber : colors.creamFaint,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.amber,
        tabBarInactiveTintColor: colors.creamFaint,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chat',
          tabBarIcon: ({ focused }) => <TabIcon label="Chat" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ focused }) => <TabIcon label="Map" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: 'Journal',
          tabBarIcon: ({ focused }) => <TabIcon label="Journal" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="journey"
        options={{
          title: 'Journey',
          tabBarIcon: ({ focused }) => <TabIcon label="Journey" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="guide"
        options={{
          title: 'Guide',
          tabBarIcon: ({ focused }) => <TabIcon label="Guide" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
