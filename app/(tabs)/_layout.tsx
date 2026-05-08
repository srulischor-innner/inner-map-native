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

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, fonts } from '../../constants/theme';
import { HamburgerMenu } from '../../components/HamburgerMenu';
import { subscribeMapPulse } from '../../utils/mapPulse';

const TAB_ROUTES: { name: string; label: string; path: string }[] = [
  { name: 'index',         label: 'CHAT',    path: '/' },
  { name: 'map',           label: 'MAP',     path: '/map' },
  { name: 'journal',       label: 'JOURNAL', path: '/journal' },
  { name: 'journey',       label: 'JOURNEY', path: '/journey' },
  // Relationships tab. Label rendered as PARTNER (7 chars) to fit the
  // 1/6 horizontal allotment alongside the longer existing tabs;
  // the screen header still calls itself "Relationships" in full.
  { name: 'relationships', label: 'PARTNER', path: '/relationships' },
  { name: 'guide',         label: 'GUIDE',   path: '/guide' },
];

function TopTabBar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  // MAP tab pulse — triggered via subscribeMapPulse() when CHAT_META arrives
  // in Chat. Scale 1.0 → 1.1 → 1.0 (300ms out, 300ms in) and brightness ramp
  // from dim → full amber → dim. RN Animated so it drives the same
  // transform/opacity as regular tab state without fighting Reanimated.
  const mapScale = useRef(new Animated.Value(1)).current;
  const mapBrightness = useRef(new Animated.Value(0)).current; // 0 = normal, 1 = brightened
  useEffect(() => {
    const unsubscribe = subscribeMapPulse(() => {
      mapScale.setValue(1);
      mapBrightness.setValue(0);
      Animated.parallel([
        Animated.sequence([
          Animated.timing(mapScale, { toValue: 1.1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(mapScale, { toValue: 1.0, duration: 300, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(mapBrightness, { toValue: 1, duration: 200, useNativeDriver: false }),
          Animated.timing(mapBrightness, { toValue: 0, duration: 300, useNativeDriver: false }),
        ]),
      ]).start();
    });
    return unsubscribe;
  }, [mapScale, mapBrightness]);

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
          const isMap = r.name === 'map';
          // Interpolate the map label color between its current state (active
          // amber or inactive faint cream) and a pure full amber during pulse.
          const mapColor = isMap
            ? mapBrightness.interpolate({
                inputRange: [0, 1],
                outputRange: [active ? colors.amber : colors.creamFaint, colors.amber],
              })
            : undefined;
          const TextNode = isMap ? Animated.Text : Text;
          const animatedWrapStyle = isMap ? { transform: [{ scale: mapScale }] } : undefined;
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
              <Animated.View style={animatedWrapStyle}>
                <TextNode
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={[
                    styles.label,
                    active && styles.labelActive,
                    isMap && mapColor ? { color: mapColor as any } : null,
                  ]}
                >
                  {r.label}
                </TextNode>
              </Animated.View>
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
        <Tabs.Screen name="index"         options={{ title: 'Chat' }} />
        <Tabs.Screen name="map"           options={{ title: 'Map' }} />
        <Tabs.Screen name="journal"       options={{ title: 'Journal' }} />
        <Tabs.Screen name="journey"       options={{ title: 'Journey' }} />
        <Tabs.Screen name="relationships" options={{ title: 'Relationships' }} />
        <Tabs.Screen name="guide"         options={{ title: 'Guide' }} />
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
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  labelActive: { color: colors.amber, fontFamily: fonts.sansBold },
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
