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
import { AppState, View, Text, Pressable, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, fonts } from '../../constants/theme';
import { PARTNER_ENABLED } from '../../constants/features';
import { HamburgerMenu } from '../../components/HamburgerMenu';
import { subscribeMapPulse } from '../../utils/mapPulse';
import { subscribeMapSeen, refreshMapSeenStatus } from '../../services/mapSeen';
import { refreshInboxStatus, subscribeInbox } from '../../services/messagesInbox';
import { subscribeChatActivity } from '../../services/chatActivity';
import {
  subscribePartnerSharedSeen,
  refreshPartnerSharedSeenStatus,
} from '../../services/partnerSharedSeen';
import { api } from '../../services/api';

const TAB_ROUTES: { name: string; label: string; path: string }[] = [
  { name: 'index',         label: 'CHAT',    path: '/' },
  { name: 'map',           label: 'MAP',     path: '/map' },
  { name: 'journal',       label: 'JOURNAL', path: '/journal' },
  { name: 'journey',       label: 'JOURNEY', path: '/journey' },
  // Relationships tab. Label rendered as PARTNER (7 chars) to fit the
  // 1/6 horizontal allotment alongside the longer existing tabs;
  // the screen header still calls itself "Relationships" in full.
  // Hidden behind PARTNER_ENABLED for v1 launch (constants/features.ts);
  // the bar's flex layout spaces the remaining five tabs evenly.
  ...(PARTNER_ENABLED
    ? [{ name: 'relationships', label: 'PARTNER', path: '/relationships' }]
    : []),
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

  // MAP-SEEN DOT — subscribes to the map-seen service. The dot shows
  // when the user has new map content they haven't viewed yet (server
  // computes the boolean from lastSeenMapAt vs mapUpdatedAt). The
  // service caches for 30s; we refresh on every relevant event:
  //   - mount (initial fetch)
  //   - app foreground (AppState 'active')
  //   - pathname change (any tab nav — captures the "switched to a
  //     different tab and came back" case without explicit focus
  //     listeners)
  // Markseen happens elsewhere — in app/(tabs)/map.tsx on tab focus
  // — so this layout just reads + renders.
  const [mapHasUnseen, setMapHasUnseen] = useState(false);
  useEffect(() => {
    const unsub = subscribeMapSeen((s) => setMapHasUnseen(s.hasUnseen));
    refreshMapSeenStatus().catch(() => {});
    // Inbox badge piggybacks the same foreground signal — the GET also
    // runs the server's lazy abandoned-session sweep.
    refreshInboxStatus().catch(() => {});
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshMapSeenStatus().catch(() => {});
        refreshInboxStatus().catch(() => {});
      }
    });
    return () => {
      unsub();
      try { sub.remove(); } catch {}
    };
  }, []);
  // Re-poll on pathname change. The user moving between tabs is the
  // strongest signal that they care about the current state; this
  // catches updates that landed while they were on Chat / Journal /
  // etc., before they ever go look at the Map tab.
  useEffect(() => {
    refreshMapSeenStatus().catch(() => {});
  }, [pathname]);

  // PARTNER-SHARED-SEEN DOT (PR 2). Parallel to the map-seen dot above
  // but for the Partner tab. The dot lights when the shared space
  // has content this user hasn't seen yet (lastSeenAt < latest non-
  // self message). Suppressed during off-purpose freeze — there's
  // nothing the user can act on while paused, so the indicator stays
  // quiet.
  //
  // The relationshipId isn't known at layout-mount time, so we cache
  // the most-recent-from-listRelationships id locally and refresh
  // the seen-status against it on the usual pathname / AppState
  // signals. Most users have at most one active pairing, so this
  // works for the foreseeable future.
  // All three effects below early-return when PARTNER_ENABLED is false —
  // the tab isn't in the bar, so the dot can't render and the polling
  // would be wasted network traffic. Hooks stay unconditional; only the
  // bodies are gated.
  const [partnerHasUnread, setPartnerHasUnread] = useState(false);
  const [activeRelIdForDot, setActiveRelIdForDot] = useState<string | null>(null);
  useEffect(() => {
    if (!PARTNER_ENABLED) return;
    const unsub = subscribePartnerSharedSeen((s) => {
      // Suppress dot during cooldown — nothing actionable.
      const inCooldown = !!s.frozenUntil && new Date(s.frozenUntil).getTime() > Date.now();
      setPartnerHasUnread(s.hasUnread && !inCooldown);
    });
    return unsub;
  }, []);
  // Refresh the active relationship id periodically (cheap — listed
  // by /api/relationships, which the Partner tab already polls).
  // We do this here only often enough to keep the dot accurate
  // when an invite gets accepted from a different device.
  const resolveActiveRelId = React.useCallback(async () => {
    try {
      const list = await api.listRelationships();
      const active = (Array.isArray(list) ? list : []).find(
        (r: any) => r && r.status === 'active',
      );
      const id = active?.id || null;
      setActiveRelIdForDot(id);
      return id;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    if (!PARTNER_ENABLED) return;
    let cancelled = false;
    resolveActiveRelId().then((id) => {
      if (!cancelled) refreshPartnerSharedSeenStatus(id).catch(() => {});
    });
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        resolveActiveRelId().then((id) =>
          refreshPartnerSharedSeenStatus(id).catch(() => {}),
        );
      }
    });
    return () => {
      cancelled = true;
      try { sub.remove(); } catch {}
    };
  }, [resolveActiveRelId]);
  useEffect(() => {
    if (!PARTNER_ENABLED) return;
    // On any tab nav, re-poll the shared-seen status against the
    // currently-known active relId. Don't refetch the list every
    // nav — only the seen-status check.
    if (activeRelIdForDot) {
      refreshPartnerSharedSeenStatus(activeRelIdForDot).catch(() => {});
    }
  }, [pathname, activeRelIdForDot]);

  // MAP-TAB LISTENING PULSE — separate from the discrete pulseMapTab()
  // flash above. This is an ambient, slow opacity oscillation
  // (0.85 → 1.0 → 0.85, ~2s cycle) that signals "your map is
  // listening" while a live chat session is in progress. Conditions:
  //   - services/chatActivity says a session is active (the user has
  //     sent at least one message and hasn't ended the session)
  //   - the user is currently on the chat tab (pathname is '/' or
  //     '/index'). On any other tab the pulse stops — they're not
  //     in front of the listening surface anymore.
  // Distinct from the unseen-content dot (services/mapSeen) — that
  // dot is a concrete "new content waiting" signal that persists
  // until the user opens the Map tab. The pulse is purely ambient.
  const mapListeningOpacity = useRef(new Animated.Value(1)).current;
  const [chatActive, setChatActive] = useState(false);
  useEffect(() => subscribeChatActivity(setChatActive), []);
  // "Noticed items waiting" dot on the hamburger button — un-acted inbox
  // items (persist until the user accepts/declines them in Messages). Same
  // subscribeInbox stream the Messages-row badge uses; the layout already
  // calls refreshInboxStatus on mount + foreground above.
  const [inboxWaiting, setInboxWaiting] = useState(0);
  useEffect(() => subscribeInbox((s) => setInboxWaiting(s.unactedCount)), []);
  const isOnChatTab = pathname === '/' || pathname === '/index';
  const shouldPulseMapListening = chatActive && isOnChatTab;
  useEffect(() => {
    if (shouldPulseMapListening) {
      mapListeningOpacity.setValue(1);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(mapListeningOpacity, {
            toValue: 0.85, duration: 1000,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
          Animated.timing(mapListeningOpacity, {
            toValue: 1, duration: 1000,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => {
        loop.stop();
        // Reset to full opacity so the label doesn't freeze mid-pulse
        // when the user leaves the chat tab.
        mapListeningOpacity.setValue(1);
      };
    } else {
      mapListeningOpacity.setValue(1);
    }
  }, [shouldPulseMapListening, mapListeningOpacity]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onMenu}
          hitSlop={10}
          style={styles.menuBtn}
          accessibilityLabel={inboxWaiting > 0 ? 'Open menu — items waiting in Messages' : 'Open menu'}
        >
          <View>
            <Ionicons name="menu" size={22} color={colors.amber} />
            {inboxWaiting > 0 ? <View style={styles.menuDot} pointerEvents="none" /> : null}
          </View>
        </Pressable>
      </View>
      <View style={styles.bar}>
        {TAB_ROUTES.map((r) => {
          const active =
            r.path === '/'
              ? pathname === '/' || pathname === '/index'
              : pathname === r.path || pathname.startsWith(r.path + '/');
          const isMap = r.name === 'map';
          const isPartner = r.name === 'relationships';
          // Interpolate the map label color between its current state (active
          // amber or inactive faint cream) and a pure full amber during pulse.
          const mapColor = isMap
            ? mapBrightness.interpolate({
                inputRange: [0, 1],
                outputRange: [active ? colors.amber : colors.creamFaint, colors.amber],
              })
            : undefined;
          const TextNode = isMap ? Animated.Text : Text;
          // For the Map tab specifically, the wrapper animates BOTH a
          // scale (driven by mapScale → discrete pulseMapTab flash) and
          // an opacity (mapListeningOpacity → ambient listening pulse
          // while chat session is live). The two animated values run
          // independently; the scale flash is rare + short, the opacity
          // pulse is slow + continuous while shouldPulseMapListening
          // is true. opacity stays at 1 otherwise.
          const animatedWrapStyle = isMap
            ? { transform: [{ scale: mapScale }], opacity: mapListeningOpacity }
            : undefined;
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
                {/* Unseen-map dot. Only renders on the MAP tab when the
                    user has map content they haven't viewed since the
                    last server-side mapUpdatedAt bump. The dot clears
                    optimistically the moment the user enters the Map
                    tab (services/mapSeen.ts handles the optimistic
                    broadcast + the mark-seen POST). Sits in the
                    top-right corner of the label so it reads as a
                    badge without crowding the typography. */}
                {isMap && mapHasUnseen ? (
                  <View style={styles.tabDot} pointerEvents="none" />
                ) : null}
                {/* PR 2 — Unseen-partner dot. Lights on the PARTNER tab
                    when the shared space has new content this user
                    hasn't seen yet (server compares lastSeenAt to the
                    newest non-self shared_messages row). Cleared
                    optimistically when the user opens the Partner tab
                    (services/partnerSharedSeen.markPartnerSharedSeen).
                    Suppressed during off-purpose cooldown — see the
                    layout's effect block above. */}
                {isPartner && partnerHasUnread ? (
                  <View style={styles.tabDot} pointerEvents="none" />
                ) : null}
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
        {/* Partner hidden for v1 — the route file still exists (expo-router
            auto-registers it) but with no tab button and no nav calls it is
            unreachable. Gated alongside TAB_ROUTES above. */}
        {PARTNER_ENABLED ? (
          <Tabs.Screen name="relationships" options={{ title: 'Relationships' }} />
        ) : null}
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
  // "Items waiting in Messages" dot — small amber circle at the top-right of
  // the hamburger icon. Mirrors tabDot's visual language; shows whenever there
  // are un-acted noticed items, clears when the user handles them.
  menuDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.amber,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    height: 40,
    paddingHorizontal: 8,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  // Tightened typography for the six-tab bar. Previously fontSize 11
  // + letterSpacing 1.2 made the longer labels (JOURNAL, JOURNEY,
  // PARTNER) crowd into each other once a sixth pill landed. ~15%
  // smaller font + halved letter-spacing fits all six cleanly with
  // even spacing across the bar.
  label: {
    color: colors.creamFaint,
    fontFamily: fonts.sansBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
  },
  labelActive: { color: colors.amber, fontFamily: fonts.sansBold },
  // Chunkier, glowier active underline per the latest spec. 2px tall with a
  // strong amber shadow so it reads as "lit" even in daylight. Inset
  // tightened from 14 → 8 to match the smaller label footprint.
  underline: {
    position: 'absolute',
    left: 8, right: 8, bottom: 0,
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
  // Unseen-map dot. Small filled amber circle, anchored to the
  // top-right of the MAP tab's label text. Absolute-positioned
  // INSIDE the Animated.View wrapper so the existing map-pulse
  // animation (scale 1→1.1→1) carries the dot with it without
  // additional transform plumbing. Subtle shadow matches the
  // active-underline visual language at smaller scale.
  tabDot: {
    position: 'absolute',
    top: -3,
    right: -8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.9,
    shadowRadius: Platform.OS === 'ios' ? 4 : 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
});
