// Map tab — the inner map visualization. Pulls the current map state from the
// Railway backend on mount, measures the canvas area with onLayout, and hands
// geometry + tap handler to InnerMapCanvas. Tapping a node opens a bottom-sheet
// folder. Map conversation (mic, OpenAI Realtime) lands in a later step.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { colors, fonts } from '../../constants/theme';
import { api } from '../../services/api';
import { armSelfMode } from '../../utils/selfMode';
import { computeMapGeometry, MapGeometry } from '../../utils/mapLayout';
import { InnerMapCanvas, NodeKey } from '../../components/map/InnerMapCanvas';
import { PartFolderModal } from '../../components/map/PartFolderModal';
import { MapVoiceButton } from '../../components/map/MapVoiceButton';
import { ProgressStrip } from '../../components/map/ProgressStrip';
import { CircleMapCanvas, IntegrationKey } from '../../components/map/CircleMapCanvas';
import { IntegrationPanel } from '../../components/map/IntegrationPanel';

const INTEGRATION_VIEW_SEEN_KEY = 'integration_view_seen';

export default function MapScreen() {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [mapData, setMapData] = useState<any | null>(null);
  const [activePart, setActivePart] = useState<NodeKey | null>(null);
  const [folderPart, setFolderPart] = useState<NodeKey | null>(null);
  const sessionIdRef = useRef<string>(uuidv4());

  // Wipe activePart after ~8 s so the breathing node doesn't stay inflated forever.
  useEffect(() => {
    if (!activePart) return;
    const t = setTimeout(() => setActivePart(null), 8000);
    return () => clearTimeout(t);
  }, [activePart]);

  // Fetch the latest map + parts on mount. Swallow errors — empty still renders.
  // The DB columns + API fields keep their legacy "...Score" suffix to avoid a
  // destructive rename, but every user-facing string says "reading" instead.
  const [outsideInScore, setOutsideInScore] = useState<number | null>(null);
  const [fragmentedScore, setFragmentedScore] = useState<number | null>(null);
  const [blendedSelfLedScore, setBlendedSelfLedScore] = useState<number | null>(null);
  const [parts, setParts] = useState<any[]>([]);
  // clinicalPatterns (outsideInKeywords / insideOutKeywords / blendedKeywords /
  // selfLedKeywords / ...) powers the "what the spectrum is picking up" lists
  // in the detail panel. Pulled from /api/journey lazily on mount.
  const [clinicalPatterns, setClinicalPatterns] = useState<any>(null);
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const [res, ps, journey] = await Promise.all([
        api.getLatestMap(),
        api.getParts(),
        api.getJourney(),
      ]);
      const md = res?.mapData || res || {};
      setMapData(md);
      if (res?.detectedManagers) md.detectedManagers = res.detectedManagers;
      if (res?.detectedFirefighters) md.detectedFirefighters = res.detectedFirefighters;
      if (typeof res?.outsideInScore === 'number') setOutsideInScore(res.outsideInScore);
      if (typeof res?.fragmentedScore === 'number') setFragmentedScore(res.fragmentedScore);
      if (typeof res?.blendedSelfLedScore === 'number') setBlendedSelfLedScore(res.blendedSelfLedScore);
      setParts(ps);
      if (journey?.clinicalPatterns) setClinicalPatterns(journey.clinicalPatterns);
    })();
  }, []);

  const geom: MapGeometry | null = size ? computeMapGeometry(size.w, size.h) : null;

  // Node-specific haptic patterns. Heavier impact for parts that carry heavier
  // somatic weight (wound, firefighter), soft notification for Self. Matches the
  // clinical spec that each part has its own felt-sense.
  // Per-node haptic pattern. Matches the clinical weight each part carries:
  //   heavier parts (wound) → heavier impact
  //   medium-weight (fixer, firefighter) → medium
  //   lighter protectors + soft-self (skeptic, manager, self-like) → light
  //   true Self → soft success notification (the landed feeling)
  function tapHaptic(k: NodeKey) {
    switch (k) {
      case 'wound':       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); break;
      case 'fixer':       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); break;
      case 'firefighter': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); break;
      case 'skeptic':     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); break;
      case 'manager':     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); break;
      case 'self-like':   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); break;
      case 'self':        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); break;
    }
  }

  function handleTap(k: NodeKey) {
    tapHaptic(k);
    setActivePart(k);
    setFolderPart(k);
  }

  // ---------- INTEGRATION (TIKUN) VIEW ----------
  // Toggle between the triangle map and a circle layout that shows what
  // the system looks like in integration. Cross-fades over 800ms.
  const [view, setView] = useState<'triangle' | 'circle'>('triangle');
  const [integrationPartKey, setIntegrationPartKey] = useState<IntegrationKey | null>(null);
  const triangleOpacity = useRef(new Animated.Value(1)).current;
  const circleOpacity = useRef(new Animated.Value(0)).current;

  // First-time discoverability label — fades in beside the toggle for
  // 4s the very first time the Map tab is shown after the integration
  // toggle exists. AsyncStorage flag ensures it never shows again.
  const [showSeeIntegrationLabel, setShowSeeIntegrationLabel] = useState(false);
  const labelOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(INTEGRATION_VIEW_SEEN_KEY);
        if (seen === '1' || cancelled) return;
        setShowSeeIntegrationLabel(true);
        Animated.timing(labelOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
        setTimeout(() => {
          Animated.timing(labelOpacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(
            () => setShowSeeIntegrationLabel(false),
          );
          AsyncStorage.setItem(INTEGRATION_VIEW_SEEN_KEY, '1').catch(() => {});
        }, 4000);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [labelOpacity]);

  function toggleView() {
    Haptics.selectionAsync().catch(() => {});
    const goingToCircle = view === 'triangle';
    setView(goingToCircle ? 'circle' : 'triangle');
    Animated.parallel([
      Animated.timing(triangleOpacity, {
        toValue: goingToCircle ? 0 : 1,
        duration: 800,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(circleOpacity, {
        toValue: goingToCircle ? 1 : 0,
        duration: 800,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* Title/subtitle removed on mobile — they ate valuable real estate and
          the map's triangle itself is the title. The tab bar already tells
          the user where they are. */}
      <View
        style={styles.canvasWrap}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) setSize({ w: width, h: height });
        }}
      >
        {/* Triangle map — always mounted, opacity cross-fades with circle. */}
        {geom ? (
          <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: triangleOpacity }]}
                         pointerEvents={view === 'triangle' ? 'box-none' : 'none'}>
            <InnerMapCanvas geom={geom} activePart={activePart} onNodeTap={handleTap} />
          </Animated.View>
        ) : null}
        {/* Circle (integration) map — also always mounted; the inactive
            view has pointerEvents:'none' so it can't intercept taps. */}
        {size ? (
          <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: circleOpacity }]}
                         pointerEvents={view === 'circle' ? 'box-none' : 'none'}>
            <CircleMapCanvas
              width={size.w}
              height={size.h}
              onNodeTap={(k) => {
                Haptics.selectionAsync().catch(() => {});
                setIntegrationPartKey(k);
              }}
            />
          </Animated.View>
        ) : null}

        {/* Integration toggle button — bottom left, above the YOUR PROGRESS
            strip. Outline circle when triangle view is active, filled
            circle when integration view is active. */}
        <View style={styles.toggleWrap} pointerEvents="box-none">
          {showSeeIntegrationLabel ? (
            <Animated.View style={[styles.toggleLabel, { opacity: labelOpacity }]} pointerEvents="none">
              <Text style={styles.toggleLabelText}>See integration</Text>
            </Animated.View>
          ) : null}
          <Pressable
            onPress={toggleView}
            hitSlop={10}
            style={styles.toggleBtn}
            accessibilityLabel={view === 'triangle' ? 'Switch to integration view' : 'Switch back to map view'}
          >
            <View
              style={[
                styles.toggleInner,
                view === 'circle' ? styles.toggleInnerFilled : styles.toggleInnerOutline,
              ]}
            />
          </Pressable>
        </View>
      </View>

      <MapVoiceButton
        sessionId={sessionIdRef.current}
        onDetectedPart={(part) => {
          // Narrowing the string to NodeKey — guarded by the known part list so a
          // future server-side category doesn't crash the canvas.
          const known: Record<string, NodeKey> = {
            wound: 'wound', fixer: 'fixer', skeptic: 'skeptic', self: 'self',
            'self-like': 'self-like', compromised: 'self-like',
            manager: 'manager', firefighter: 'firefighter',
          };
          const key = known[part];
          if (key) setActivePart(key);
        }}
      />

      <ProgressStrip
        outsideInScore={outsideInScore}
        fragmentedScore={fragmentedScore}
        blendedSelfLedScore={blendedSelfLedScore}
        clinicalPatterns={clinicalPatterns}
      />

      <IntegrationPanel
        visible={!!integrationPartKey}
        partKey={integrationPartKey}
        onClose={() => setIntegrationPartKey(null)}
      />

      <PartFolderModal
        visible={!!folderPart}
        partKey={folderPart}
        mapData={mapData}
        parts={parts}
        onClose={() => setFolderPart(null)}
        onEnterSelfMode={() => {
          // Arm the one-shot Self-mode flag, then navigate to Chat. Chat
          // consumes the flag on mount and sends selfMode:true with its
          // next /api/chat request so the server swaps in the Self-mode
          // system prompt prefix.
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          armSelfMode();
          setFolderPart(null);
          router.push('/');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  canvasWrap: { flex: 1, overflow: 'hidden' },

  // Integration toggle — bottom left of the canvas, above the
  // YOUR PROGRESS strip. Small, unobtrusive; reads as a quiet
  // alternative-view affordance, not a feature button.
  toggleWrap: {
    position: 'absolute',
    left: 16,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(20,19,26,0.7)',
  },
  toggleInner: {
    width: 18, height: 18, borderRadius: 9,
  },
  toggleInnerOutline: {
    borderWidth: 1.5,
    borderColor: 'rgba(230,180,122,0.5)',
  },
  toggleInnerFilled: {
    backgroundColor: '#E6B47A',
    shadowColor: '#E6B47A',
    shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  // First-time discoverability label "See integration" beside the toggle.
  toggleLabel: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,19,26,0.85)',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.3)',
  },
  toggleLabelText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
