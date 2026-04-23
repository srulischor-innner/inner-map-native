// Map tab — the inner map visualization. Pulls the current map state from the
// Railway backend on mount, measures the canvas area with onLayout, and hands
// geometry + tap handler to InnerMapCanvas. Tapping a node opens a bottom-sheet
// folder. Map conversation (mic, OpenAI Realtime) lands in a later step.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { colors, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { computeMapGeometry, MapGeometry } from '../../utils/mapLayout';
import { InnerMapCanvas, NodeKey } from '../../components/map/InnerMapCanvas';
import { PartFolderModal } from '../../components/map/PartFolderModal';

export default function MapScreen() {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [mapData, setMapData] = useState<any | null>(null);
  const [activePart, setActivePart] = useState<NodeKey | null>(null);
  const [folderPart, setFolderPart] = useState<NodeKey | null>(null);

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

  function handleTap(k: NodeKey) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
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
