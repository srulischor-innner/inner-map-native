// Map tab — the inner map visualization. Pulls the current map state from the
// Railway backend on mount, measures the canvas area with onLayout, and hands
// geometry + tap handler to InnerMapCanvas. Tapping a node opens a bottom-sheet
// folder. Map conversation (mic, OpenAI Realtime) lands in a later step.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { colors, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { computeMapGeometry, MapGeometry } from '../../utils/mapLayout';
import { InnerMapCanvas, NodeKey } from '../../components/map/InnerMapCanvas';
import { PartFolderModal } from '../../components/map/PartFolderModal';
import { MapVoiceButton } from '../../components/map/MapVoiceButton';

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

  // Fetch the latest map on mount. Swallow errors — an empty map still renders.
  useEffect(() => {
    (async () => {
      const res = await api.getLatestMap();
      const md = res?.mapData || res || {};
      setMapData(md);
      // For v1, fold manager/firefighter arrays into the flat shape the modal expects.
      if (res?.detectedManagers) md.detectedManagers = res.detectedManagers;
      if (res?.detectedFirefighters) md.detectedFirefighters = res.detectedFirefighters;
    })();
  }, []);

  const geom: MapGeometry | null = size ? computeMapGeometry(size.w, size.h) : null;

  // Node-specific haptic patterns. Heavier impact for parts that carry heavier
  // somatic weight (wound, firefighter), soft notification for Self. Matches the
  // clinical spec that each part has its own felt-sense.
  function tapHaptic(k: NodeKey) {
    switch (k) {
      case 'wound':       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); break;
      case 'firefighter': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); break;
      case 'fixer':       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); break;
      case 'self-like':   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); break;
      case 'skeptic':     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); break;
      case 'manager':     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); break;
      case 'self':        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); break;
    }
  }

  function handleTap(k: NodeKey) {
    tapHaptic(k);
    setActivePart(k);
    setFolderPart(k);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Inner Map</Text>
        <Text style={styles.sub}>
          {mapData && mapData.wound
            ? 'Tap any node to see what it holds'
            : 'Your map grows with every conversation'}
        </Text>
      </View>
      <View
        style={styles.canvasWrap}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) setSize({ w: width, h: height });
        }}
      >
        {geom ? (
          <InnerMapCanvas geom={geom} activePart={activePart} onNodeTap={handleTap} />
        ) : null}
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

      <PartFolderModal
        visible={!!folderPart}
        partKey={folderPart}
        mapData={mapData}
        onClose={() => setFolderPart(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  title: { color: colors.cream, fontSize: 24, fontWeight: '500' },
  sub: { color: colors.creamFaint, fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  canvasWrap: { flex: 1, overflow: 'hidden' },
});
