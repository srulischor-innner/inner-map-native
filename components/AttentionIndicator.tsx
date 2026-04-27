// Tiny ambient indicator that lives in the chat tab header. Reflects the
// AI's processing state — never a percentage, never a "level" the user
// can climb toward. Three qualitative states only:
//
//   quiet     — barely visible, no animation
//   listening — gentle slow breathing (3s cycle)
//   noticing  — slightly faster breathing (2s cycle)
//
// Tap → opens an explanation bottom-sheet with the approved copy.
// First-time discovery: pulses ONCE the very first time it leaves 'quiet'
// (gated by an AsyncStorage flag), then never explicitly draws attention
// again. Cross-fades smoothly between states with a 350ms timing.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Canvas, Circle, Path, Skia, Group } from '@shopify/react-native-skia';
import ReanimatedDefault, {
  useSharedValue, withRepeat, withTiming, withSequence, Easing,
  useDerivedValue, useAnimatedStyle, runOnJS,
} from 'react-native-reanimated';
const ReanimatedView = ReanimatedDefault.View;

import { colors, fonts, radii, spacing } from '../constants/theme';
import type { AttentionState } from '../utils/markers';
import {
  useAttentionState, hasSeenFirstTransition, markFirstTransitionSeen,
  hasSeenFirstSessionLabel, markFirstSessionLabelSeen,
} from '../utils/attentionState';

const SIZE = 28;        // visible triangle size — bumped to 28 so it reads
                        //   as a clear interactive element, not an ambient pixel
const TAP = 48;         // generous touch target — 48x48 wrapper around the visual

// Per-state visual targets. Opacity oscillates between [low, high] over
// the given duration. Even 'quiet' breathes (subtly) so users can tell
// the indicator is interactive — a perfectly still pixel reads as decor.
type StateVisual = { low: number; high: number; duration: number };
const VISUALS: Record<AttentionState, StateVisual> = {
  quiet:     { low: 0.45, high: 0.55, duration: 4000 },  // softly lit + gentle breath
  listening: { low: 0.55, high: 0.75, duration: 3000 },
  noticing:  { low: 0.70, high: 1.00, duration: 2000 },
};

export function AttentionIndicator() {
  const state = useAttentionState();
  const [panelOpen, setPanelOpen] = useState(false);

  // Drives the smooth cross-fade between state visuals AND the per-state
  // breathing oscillation. Held as one shared value so transitions read
  // as a single warm motion rather than two stacked animations.
  const opacity = useSharedValue(VISUALS.quiet.low);
  // Separate pulse value used only for the once-per-app first-transition
  // attention beacon — multiplies the base opacity briefly.
  const pulse = useSharedValue(1);

  // Re-arm the breathing loop whenever state changes. ALL three states
  // breathe now — even "quiet" — so the indicator visibly reads as a
  // living, interactive element. Smooth 350ms cross-fade between states.
  useEffect(() => {
    const v = VISUALS[state];
    opacity.value = withTiming(v.low, { duration: 350, easing: Easing.inOut(Easing.ease) }, () => {
      opacity.value = withRepeat(
        withTiming(v.high, { duration: v.duration, easing: Easing.inOut(Easing.ease) }),
        -1, true,
      );
    });
  }, [state, opacity]);

  // First-time-discovery pulse. Fires exactly once across the app's
  // lifetime — when the indicator transitions out of 'quiet' for the
  // first time. After that, all transitions are smooth and ambient.
  useEffect(() => {
    if (state === 'quiet') return;
    let cancelled = false;
    (async () => {
      const seen = await hasSeenFirstTransition();
      if (seen || cancelled) return;
      // Brief amplitude boost — three short ramps so the user notices.
      pulse.value = withSequence(
        withTiming(2.0, { duration: 280, easing: Easing.out(Easing.ease) }),
        withTiming(1.0, { duration: 380, easing: Easing.in(Easing.ease) }),
        withTiming(1.6, { duration: 240, easing: Easing.out(Easing.ease) }),
        withTiming(1.0, { duration: 380, easing: Easing.in(Easing.ease) },
          () => { runOnJS(markFirstTransitionSeen)(); },
        ),
      );
    })();
    return () => { cancelled = true; };
  }, [state, pulse]);

  // Final opacity Skia reads — base oscillation × pulse multiplier, capped at 1.
  const groupOpacity = useDerivedValue(() => Math.min(1, opacity.value * pulse.value), [opacity, pulse]);

  // Triangle path — same equilateral shape as the typing indicator so the
  // map's visual identity is reinforced.
  // Triangle inscribed inside the canvas with padding for the outer glow
  // ring to live in. Pad = 6 on a 28px canvas leaves a 16px-tall triangle
  // with breathing room for the surrounding ring.
  const triPath = (() => {
    const p = Skia.Path.Make();
    const pad = 6;
    const top = { x: SIZE / 2, y: pad };
    const bl  = { x: pad, y: SIZE - pad };
    const br  = { x: SIZE - pad, y: SIZE - pad };
    p.moveTo(top.x, top.y);
    p.lineTo(br.x, br.y);
    p.lineTo(bl.x, bl.y);
    p.close();
    return p;
  })();
  // Subtle outer glow ring — present in every state. Reads as "this is
  // an interactive element", not an ambient pixel. Uses a separate softer
  // opacity that ALWAYS shows, even when the triangle dims to its low.
  const ringOpacity = useDerivedValue(() => Math.min(0.5, opacity.value * 0.6), [opacity]);
  const ringR = SIZE / 2 - 1;

  // First-session text label — shown ONCE per device for 5 seconds when
  // the chat tab first mounts, fades out, and never reappears. Helps
  // first-time users discover the indicator is interactive.
  const labelOpacity = useSharedValue(0);
  const labelAnimatedStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));
  const [labelMounted, setLabelMounted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await hasSeenFirstSessionLabel();
      if (seen || cancelled) return;
      setLabelMounted(true);
      labelOpacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.ease) });
      // Hold visible for 5s, then fade out over 600ms; flip the
      // AsyncStorage flag so it never appears again on this device.
      const t = setTimeout(() => {
        labelOpacity.value = withTiming(
          0,
          { duration: 600, easing: Easing.in(Easing.ease) },
          () => { runOnJS(markFirstSessionLabelSeen)(); runOnJS(setLabelMounted)(false); },
        );
      }, 5000);
      return () => { clearTimeout(t); };
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <View style={styles.row}>
        {labelMounted ? (
          <ReanimatedView style={[styles.label, labelAnimatedStyle]} pointerEvents="none">
            <Text style={styles.labelText}>Tap to learn what this is</Text>
          </ReanimatedView>
        ) : null}
        <Pressable
          onPress={() => setPanelOpen(true)}
          style={styles.tapTarget}
          accessibilityLabel="The map is listening — tap to learn what this indicator means"
          hitSlop={6}
        >
          <Canvas style={{ width: SIZE, height: SIZE }}>
            {/* Outer glow ring — always present, slightly dimmer than the
                triangle. Communicates "this is interactive". */}
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={ringR}
              color="#E6B47A"
              style="stroke"
              strokeWidth={0.7}
              opacity={ringOpacity}
            />
            {/* Breathing triangle inside the ring. Stroke 1.8 reads
                cleanly at 28px; the soft fill makes it look "lit from
                within" rather than a flat outline. */}
            <Group opacity={groupOpacity}>
              <Path path={triPath} color="#E6B47A" style="stroke" strokeWidth={1.8} />
              <Path path={triPath} color="#E6B47A33" style="fill" />
            </Group>
          </Canvas>
        </Pressable>
      </View>
      <ExplanationPanel visible={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}

// ============================================================================
// EXPLANATION PANEL — same bottom-sheet grammar as the spectrum / part-folder
// modals. Drag handle, X close, dark background, safe-area padding.
// ============================================================================
function ExplanationPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>The map is listening</Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close" hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.paragraph}>
            The map pays attention to your conversation as you talk. This small
            indicator reflects what it's noticing — quietly attentive most of
            the time, a little brighter when something is starting to take shape.
          </Text>
          <Text style={styles.paragraph}>
            It's not measuring you. It's not counting. It only ever shows where
            the map's attention is right now.
          </Text>
          <Text style={styles.paragraph}>
            The map will always ask before adding anything to it. Nothing is
            added without your permission.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ============================================================================
const styles = StyleSheet.create({
  tapTarget: {
    width: TAP, height: TAP,
    alignItems: 'center', justifyContent: 'center',
  },
  // Inline row holds the optional first-session text label to the LEFT
  // of the tap target so it reads as a hint that points at the triangle.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(20,20,30,0.85)',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.3)',
  },
  labelText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    maxHeight: '60%',
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 0.5,
    borderTopColor: colors.borderAmber,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 42, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  title: { color: colors.amber, fontFamily: fonts.serifBold, fontSize: 22, letterSpacing: 0.3 },
  close: { padding: 6 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  paragraph: {
    color: colors.cream, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 24, marginBottom: spacing.md,
  },
});
