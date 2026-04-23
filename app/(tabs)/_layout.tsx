// Tabs layout with a CUSTOM TOP tab bar and a hamburger menu button.
//
// Layout inside the SafeArea top inset:
//   ┌─────────────────────────────────────────────────────┐
//   │ ☰                                                   │  <- header row
//   │ CHAT    MAP    JOURNAL   JOURNEY   GUIDE            │  <- tab row
//   └─────────────────────────────────────────────────────┘
//
// The default bottom tab bar is hidden; our TopTabBar above handles navigation.
// Active tab gets amber text + a chunkier amber underline with a stronger glow
// so it reads as "lit" even in bright environments.

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/theme';
import { HamburgerMenu } from '../../components/HamburgerMenu';

const TAB_ROUTES: { name: string; label: string; path: string }[] = [
  { name: 'index',   label: 'CHAT',    path: '/' },
  { name: 'map',     label: 'MAP',     path: '/map' },
  { name: 'journal', label: 'JOURNAL', path: '/journal' },
  { name: 'journey', label: 'JOURNEY', path: '/journey' },
  { name: 'guide',   label: 'GUIDE',   path: '/guide' },
];

function TopTabBar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.headerRow}>
        <Pressable onPress={onMenu} hitSlop={10} style={styles.menuBtn} accessibilityLabel="Open menu">
          <Ionicons name="menu" size={22} color={colors.amber} />
        </Pressable>
      </View>
      <View style={styles.bar}>
        {TAB_ROUTES.map((r) => {
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
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopTabBar onMenu={() => setMenuOpen(true)} />
      <Tabs
        screenOptions={{
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
      <HamburgerMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 12,
    height: 34,
  },
  menuBtn: { padding: 4 },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    height: 40,
    paddingHorizontal: 8,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  label: {
    color: colors.creamFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  labelActive: { color: colors.amber, fontWeight: '700' },
  // Chunkier, glowier active underline per the latest spec. 2px tall with a
  // strong amber shadow so it reads as "lit" even in daylight.
  underline: {
    position: 'absolute',
    left: 14, right: 14, bottom: 0,
    height: 2,
    backgroundColor: colors.amber,
    borderRadius: 2,
    shadowColor: colors.amber,
    shadowOpacity: 0.95,
    shadowRadius: Platform.OS === 'ios' ? 8 : 0,
    shadowOffset: { width: 0, height: 1 },
    // Android doesn't render iOS shadow; elevation gives a comparable soft glow.
    elevation: 5,
  },
});
