// Live part-confidence indicator for the Chat tab in EXPLORE mode.
//
// Visualizes MAP_UPDATE markers as they fire on the assistant stream:
//   confidence: 'partial'   → ring fills to ~50%
//   confidence: 'confirmed' → ring fills to 100%, briefly pulses,
//                              fades, then resets to invisible
//   part === null           → entire indicator is invisible
//
// Below the ring sits the current part name in Cormorant italic
// amber. Process mode never shows this indicator at all — the
// triangle attention indicator covers Process.
//
// Tapping the indicator (always — even when invisible) opens an
// info modal explaining what the ring means. Modal style matches
// the Process/Explore info modal in ChatModeToggle.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import Animated, {
  useSharedValue, withTiming, withSequence, withDelay,
  useAnimatedStyle, Easing, useDerivedValue,
} from 'react-native-reanimated';

const SIZE = 44;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const TRACK_COLOR = 'rgba(230,180,122,0.4)';
const FILL_COLOR = 'rgba(230,180,122,0.9)';

export type PartConfidence = 'partial' | 'confirmed';

type Props = {
  part: string | null;             // 'fixer' | 'wound' | 'skeptic' | 'manager' | 'firefighter' | 'self-like' | 'self' | null
  confidence: PartConfidence | null;
};

export function PartConfidenceIndicator({ part, confidence }: Props) {
  // 0..1 progress around the ring. partial=0.5, confirmed=1.0.
  const progress = useSharedValue(0);
  // Pulse + fade on confirmed: scale 1→1.15→1, opacity 1→0.4 over a beat.
  const pulse = useSharedValue(1);
  const wrapOpacity = useSharedValue(0);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (!part || !confidence) {
      // Reset to hidden whenever there's nothing to track.
      wrapOpacity.value = withTiming(0, { duration: 350 });
      progress.value = withTiming(0, { duration: 200 });
      pulse.value = 1;
      return;
    }
    // Make sure the indicator is visible.
    wrapOpacity.value = withTiming(1, { duration: 350 });
    if (confidence === 'partial') {
      progress.value = withTiming(0.5, { duration: 600, easing: Easing.out(Easing.ease) });
      pulse.value = 1;
    } else {
      // confirmed — fill, pulse, then fade.
      progress.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.ease) });
      pulse.value = withSequence(
        withTiming(1.15, { duration: 280, easing: Easing.out(Easing.ease) }),
        withTiming(1.0, { duration: 320, easing: Easing.in(Easing.ease) }),
      );
      // Fade the whole indicator out after ~1.5s and reset progress
      // so the next detection starts fresh.
      wrapOpacity.value = withDelay(
        1500,
        withTiming(0, { duration: 600, easing: Easing.in(Easing.ease) }),
      );
    }
  }, [part, confidence, progress, pulse, wrapOpacity]);

  // Build a circular arc path whose sweep grows with `progress`. We
  // build the path inside useDerivedValue so the path object is
  // recomputed on the UI thread when progress changes.
  const arcPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    if (progress.value <= 0) return p;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const start = -90;                // top of circle
    const sweep = 360 * progress.value;
    p.addArc(
      { x: cx - RADIUS, y: cy - RADIUS, width: RADIUS * 2, height: RADIUS * 2 },
      start,
      sweep,
    );
    return p;
  }, [progress]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity: wrapOpacity.value,
    transform: [{ scale: pulse.value }],
  }));

  return (
    <>
      {/* Tappable wrapper — always tappable, even when the ring itself is
          invisible, so the user can ask "what is this circle?" at any
          time. The Animated.View inside carries the visual fade/pulse;
          pointerEvents on it is "none" so the press lands on the
          Pressable. */}
      <Pressable
        onPress={() => setShowInfo(true)}
        style={styles.tapTarget}
        hitSlop={8}
        accessibilityLabel="What does this confidence ring mean"
      >
        <Animated.View style={[styles.root, wrapStyle]} pointerEvents="none">
          <Canvas style={{ width: SIZE, height: SIZE }}>
            {/* Track — full ring at low alpha. */}
            <Path
              path={(() => {
                const p = Skia.Path.Make();
                p.addCircle(SIZE / 2, SIZE / 2, RADIUS);
                return p;
              })()}
              color={TRACK_COLOR}
              style="stroke"
              strokeWidth={STROKE}
            />
            {/* Fill — clockwise arc from top, animated. */}
            <Path
              path={arcPath}
              color={FILL_COLOR}
              style="stroke"
              strokeWidth={STROKE}
              strokeCap="round"
            />
          </Canvas>
          {part ? (
            <Text style={styles.label} numberOfLines={1}>
              {part}
            </Text>
          ) : null}
        </Animated.View>
      </Pressable>

      <Modal
        visible={showInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfo(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setShowInfo(false)}>
          {/* Inner Pressable swallows the backdrop press so taps inside
              the card don't dismiss the modal accidentally. */}
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.title}>Your map is building</Text>

            <Text style={styles.body}>
              As we talk, I'm noticing patterns and parts that make up your inner world. This circle shows how close a part is to being confirmed on your map.
            </Text>

            <View style={styles.divider} />

            <View style={{ marginBottom: 4 }}>
              <Text style={styles.bullet}>
                <Text style={styles.bulletLabel}>Empty</Text>
                <Text style={styles.bulletBody}> — something just surfaced</Text>
              </Text>
              <Text style={styles.bullet}>
                <Text style={styles.bulletLabel}>Filling</Text>
                <Text style={styles.bulletBody}> — getting clearer</Text>
              </Text>
              <Text style={styles.bullet}>
                <Text style={styles.bulletLabel}>Complete</Text>
                <Text style={styles.bulletBody}> — added to your map</Text>
              </Text>
            </View>

            <Pressable onPress={() => setShowInfo(false)} style={styles.gotIt}>
              <Text style={styles.gotItText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  tapTarget: {
    // Push the indicator down a touch — the headerStrip was clipping
    // the top of the ring on some devices. 9px clears the clip and
    // gives the label below a bit more breathing room.
    marginTop: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 11,
    color: 'rgba(230,180,122,0.6)',
    letterSpacing: 0.3,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: '#0e0e1a',
    borderRadius: 20,
    padding: 24,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.2)',
    width: '100%',
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#F0EDE8',
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: 'rgba(240,237,232,0.7)',
    lineHeight: 21,
    marginBottom: 16,
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(230,180,122,0.1)',
    marginBottom: 14,
  },
  bullet: {
    marginBottom: 8,
  },
  bulletLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#E6B47A',
    letterSpacing: 0.5,
  },
  bulletBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: 'rgba(240,237,232,0.7)',
    lineHeight: 21,
  },
  gotIt: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 8,
  },
  gotItText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: 'rgba(230,180,122,0.5)',
  },
});
