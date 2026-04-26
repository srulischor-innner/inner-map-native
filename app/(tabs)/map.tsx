// Map tab — the inner map visualization. Pulls the current map state from the
// Railway backend on mount, measures the canvas area with onLayout, and hands
// geometry + tap handler to InnerMapCanvas. Tapping a node opens a bottom-sheet
// folder. Map conversation (mic, OpenAI Realtime) lands in a later step.

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { colors } from '../../constants/theme';
import { api } from '../../services/api';
import { armSelfMode } from '../../utils/selfMode';
import { computeMapGeometry, MapGeometry } from '../../utils/mapLayout';
import { InnerMapCanvas, NodeKey } from '../../components/map/InnerMapCanvas';
import { PartFolderModal } from '../../components/map/PartFolderModal';
import { MapVoiceButton } from '../../components/map/MapVoiceButton';
import { ProgressStrip } from '../../components/map/ProgressStrip';

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

      <ProgressStrip
        outsideInScore={outsideInScore}
        fragmentedScore={fragmentedScore}
        blendedSelfLedScore={blendedSelfLedScore}
        clinicalPatterns={clinicalPatterns}
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
});
