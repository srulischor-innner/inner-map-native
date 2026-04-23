// Tabs layout with a CUSTOM TOP tab bar. The default React Navigation bottom
// tab bar is hidden; we render our own amber-accented row above the screen
// content. Active tab is derived from usePathname() so it always matches the
// router, even after hard navigation (e.g. notification tap).
//
// Design:
//   - Dark bar below the iPhone status bar / Dynamic Island
//   - Five uppercase labels: CHAT | MAP | JOURNAL | JOURNEY | GUIDE
//   - Active tab: amber text + amber underline
//   - Inactive: dim cream text
//   - 11px font, 1px letter spacing, numberOfLines=1, allowFontScaling=false

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/theme';

const TAB_ROUTES: { name: string; label: string; path: string }[] = [
  { name: 'index',   label: 'CHAT',    path: '/' },
  { name: 'map',     label: 'MAP',     path: '/map' },
  { name: 'journal', label: 'JOURNAL', path: '/journal' },
  { name: 'journey', label: 'JOURNEY', path: '/journey' },
  { name: 'guide',   label: 'GUIDE',   path: '/guide' },
];

function TopTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.bar}>
        {TAB_ROUTES.map((r) => {
          // Match exact path for non-index routes; match '/' or '/index' for CHAT.
          const active =
            r.path === '/'
              ? pathname === '/' || pathname === '/index'
              : pathname === r.path || pathname.startsWith(r.path + '/');
          return (
            <Pressable
              key={r.name}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                router.push(r.path as any);
              }}
              style={styles.tab}
              hitSlop={6}
            >
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={[styles.label, active && styles.labelActive]}
              >
                {r.label}
              </Text>
              {active ? <View style={styles.underline} /> : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function TabsLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopTabBar />
      <Tabs
        screenOptions={{
          // Hide the default bottom bar entirely — our TopTabBar above handles
          // navigation. tabBarButton={() => null} + zero height is a belt-and-
          // braces combo that works across Safe Area quirks on iOS.
          headerShown: false,
          tabBarStyle: { display: 'none', height: 0 },
          tabBarButton: () => null,
        }}
      >
        <Tabs.Screen name="index"   options={{ title: 'Chat' }} />
        <Tabs.Screen name="map"     options={{ title: 'Map' }} />
        <Tabs.Screen name="journal" options={{ title: 'Journal' }} />
        <Tabs.Screen name="journey" options={{ title: 'Journey' }} />
        <Tabs.Screen name="guide"   options={{ title: 'Guide' }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  label: {
    color: colors.creamFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  labelActive: { color: colors.amber, fontWeight: '700' },
  underline: {
    position: 'absolute',
    left: 16, right: 16, bottom: 0,
    height: 2,
    backgroundColor: colors.amber,
    borderRadius: 1,
    shadowColor: colors.amber,
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
});
