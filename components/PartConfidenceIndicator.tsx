// Live part-confidence indicator for the Chat tab — BOTH modes.
//
// Visualizes MAP_UPDATE markers as they fire on the assistant stream:
//   confidence: 'partial'   → ring fills to ~50%
//   confidence: 'confirmed' → ring fills to 100%, briefly pulses,
//                              fades, then settles back to idle
//   part === null           → idle: softly lit, slowly breathing
//
// Below the ring sits the current part name in Cormorant italic
// amber. The centerSlot in index.tsx time-shares this with the
// AttentionIndicator triangle: triangle during generation
// (thinking/streaming/detected), ring the rest of the time — in
// Process AND Explore (Process previously never rendered the ring,
// which made its background mapping invisible).
//
// Tapping the indicator (always — even when invisible) opens an
// info modal explaining what the ring means. Modal style matches
// the Process/Explore info modal in ChatModeToggle.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Canvas, Path, Skia, BlurMask } from '@shopify/react-native-skia';
import Animated, {
  useSharedValue, withTiming, withSequence, withRepeat,
  useAnimatedStyle, Easing, useDerivedValue,
} from 'react-native-reanimated';

// =============================================================================
// TUNABLES — eyeball + dial in on a real device. (Redesign, June 2026.)
// The ring is the home-screen's living centerpiece between Explore/Process.
// It is ALWAYS softly lit and slowly breathing; detection only changes the
// fill sweep, glow strength, and the word beneath. The state SOURCE
// (part/confidence) is untouched — this is purely how those states render.
// =============================================================================
const SIZE = 44;                 // ring diameter
const STROKE = 2.5;              // track + fill stroke
const RADIUS = (SIZE - STROKE) / 2;
const GLOW_STROKE = 6;           // glowing-ring stroke (pre-blur) → soft halo
const GLOW_BLUR = 7;             // halo softness
const GLOW_PAD = 13;             // canvas breathing room around the ring for the bloom
const BOX = SIZE + GLOW_PAD * 2; // Skia canvas square (ring centered inside)

// Breathing pulse — subtle + CALM, never a fast blink (a blink reads as a
// loading error). Opacity-only on the ring+glow layer (transform/opacity →
// runs on the UI thread). Full inhale→exhale cycle ≈ BREATH_PERIOD_MS.
const BREATH_MIN = 0.70;         // trough opacity
const BREATH_MAX = 1.0;          // peak opacity
const BREATH_PERIOD_MS = 2600;   // ~2.6s full cycle (spec: 2–3s)

// Fill sweep per state. "Forming" is a MOOD signal ("something is actively
// forming, almost there") — NOT a literal percentage.
const FORMING_PROGRESS = 0.8;    // ~75–85%
const COMPLETE_PROGRESS = 1.0;

// Glow strength per state (Skia opacity on the blurred halo ring).
const GLOW_IDLE = 0.18;
const GLOW_FORMING = 0.36;
const GLOW_COMPLETE = 0.55;

// How long "added" holds before settling back to idle "present".
const COMPLETE_HOLD_MS = 1400;

const TRACK_COLOR = 'rgba(230,180,122,0.18)';
const FILL_COLOR = 'rgba(230,180,122,0.95)';
const GLOW_COLOR = 'rgba(230,180,122,1)';

// OPTIONAL fallback — if the empty ring + pulse reads too stark on device,
// flip to true for a faint ~15% base arc even at idle (a hint of fill).
// Default: empty ring (per spec).
const IDLE_BASE_FILL = false;
const IDLE_BASE_PROGRESS = 0.15;

export type PartConfidence = 'partial' | 'confirmed';

type Props = {
  part: string | null;             // 'fixer' | 'wound' | 'skeptic' | 'manager' | 'firefighter' | 'self-like' | 'self' | null
  confidence: PartConfidence | null;
};

export function PartConfidenceIndicator({ part, confidence }: Props) {
  // 0..1 fill sweep. idle=0 (or IDLE_BASE_PROGRESS), forming≈0.8, complete=1.
  const progress = useSharedValue(IDLE_BASE_FILL ? IDLE_BASE_PROGRESS : 0);
  // Brief scale bump on complete (transform-only).
  const pulse = useSharedValue(1);
  // Always-on slow breath (opacity multiplier on ring + glow).
  const breath = useSharedValue(BREATH_MAX);
  // Glow halo strength (Skia opacity on the blurred ring).
  const glow = useSharedValue(GLOW_IDLE);
  const [showInfo, setShowInfo] = useState(false);
  // The word beneath the ring: present | forming | added. Derived from the
  // existing state source; "added" briefly holds on complete, then settles
  // back to "present". Presentation-only — no detection state added.
  const [word, setWord] = useState<'present' | 'forming' | 'added'>('present');
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kick off the always-on breathing once, on mount.
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(BREATH_MIN, {
        duration: BREATH_PERIOD_MS / 2,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,   // forever
      true, // reverse → smooth inhale/exhale
    );
  }, [breath]);

  useEffect(() => {
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    if (!part || !confidence) {
      // Idle ("present") — empty ring (faint base arc only if the flag is on),
      // soft glow, the word "present".
      progress.value = withTiming(IDLE_BASE_FILL ? IDLE_BASE_PROGRESS : 0, { duration: 300 });
      glow.value = withTiming(GLOW_IDLE, { duration: 400 });
      pulse.value = withTiming(1, { duration: 200 });
      setWord('present');
      return;
    }
    if (confidence === 'partial') {
      // Forming — ring fills to a mood-level ~80%, glow strengthens.
      progress.value = withTiming(FORMING_PROGRESS, { duration: 650, easing: Easing.out(Easing.ease) });
      glow.value = withTiming(GLOW_FORMING, { duration: 450 });
      pulse.value = withTiming(1, { duration: 200 });
      setWord('forming');
      return;
    }
    // Complete — fill to 100%, brighter glow, brief scale pulse, word "added".
    // Then settle back to idle "present" after a short hold.
    progress.value = withTiming(COMPLETE_PROGRESS, { duration: 450, easing: Easing.out(Easing.ease) });
    glow.value = withTiming(GLOW_COMPLETE, { duration: 300 });
    pulse.value = withSequence(
      withTiming(1.12, { duration: 260, easing: Easing.out(Easing.ease) }),
      withTiming(1.0, { duration: 300, easing: Easing.in(Easing.ease) }),
    );
    setWord('added');
    settleTimer.current = setTimeout(() => {
      progress.value = withTiming(IDLE_BASE_FILL ? IDLE_BASE_PROGRESS : 0, { duration: 600, easing: Easing.in(Easing.ease) });
      glow.value = withTiming(GLOW_IDLE, { duration: 600 });
      setWord('present');
    }, COMPLETE_HOLD_MS);
  }, [part, confidence, progress, pulse, glow]);

  // Clean up the settle timer on unmount.
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);

  // Arc path (fill sweep), recomputed on the UI thread as progress changes.
  const arcPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    if (progress.value <= 0) return p;
    const cx = BOX / 2;
    const cy = BOX / 2;
    const start = -90;                // top of circle
    const sweep = 360 * progress.value;
    p.addArc(
      { x: cx - RADIUS, y: cy - RADIUS, width: RADIUS * 2, height: RADIUS * 2 },
      start,
      sweep,
    );
    return p;
  }, [progress]);

  // Ring + glow breathe together (opacity) and bump on complete (scale).
  const ringStyle = useAnimatedStyle(() => ({
    opacity: breath.value,
    transform: [{ scale: pulse.value }],
  }));

  const fullCircle = React.useMemo(() => {
    const p = Skia.Path.Make();
    p.addCircle(BOX / 2, BOX / 2, RADIUS);
    return p;
  }, []);

  return (
    <>
      <View style={styles.root} pointerEvents="box-none">
        {/* Ring + glow layer — breathes + pulses. pointerEvents none so the
            press lands on the "i" affordance below, not the canvas. */}
        <Animated.View style={[styles.canvasWrap, ringStyle]} pointerEvents="none">
          <Canvas style={{ width: BOX, height: BOX }}>
            {/* Glow halo — a blurred amber ring stroke behind the track.
                Empty center (it's a stroke, not a fill); the blur blooms it
                into a soft halo. Opacity tracks the state via `glow`. */}
            <Path
              path={fullCircle}
              color={GLOW_COLOR}
              style="stroke"
              strokeWidth={GLOW_STROKE}
              opacity={glow}
            >
              <BlurMask blur={GLOW_BLUR} style="normal" />
            </Path>
            {/* Track — faint full ring, always present. */}
            <Path
              path={fullCircle}
              color={TRACK_COLOR}
              style="stroke"
              strokeWidth={STROKE}
            />
            {/* Fill — clockwise sweep from the top, animated. */}
            <Path
              path={arcPath}
              color={FILL_COLOR}
              style="stroke"
              strokeWidth={STROKE}
              strokeCap="round"
            />
          </Canvas>
        </Animated.View>

        {/* Label + "i" affordance, pinned just below the ring. Absolute so
            it does NOT add to the layout height — the parent toggle row
            then centers the Explore/Process pills to the RING's midpoint
            (the box), not to the taller ring+label stack. The "i" carries
            a ~44px tap target via hitSlop and opens the existing
            "Your map is building" explainer. */}
        <View style={styles.labelRow}>
          <Text style={styles.label} numberOfLines={1}>{word}</Text>
          <Pressable
            onPress={() => setShowInfo(true)}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityRole="button"
            accessibilityLabel="What does this ring mean"
            style={styles.infoBtn}
          >
            <View style={styles.infoCircle}>
              <Text style={styles.infoChar}>i</Text>
            </View>
          </Pressable>
        </View>
      </View>

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
  // The ring's box defines the layout size (BOX×BOX). The label+"i" below
  // is absolutely positioned so it does NOT grow this box — that lets the
  // parent toggle row center the pills to the ring's vertical midpoint.
  root: {
    width: BOX,
    height: BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasWrap: {
    width: BOX,
    height: BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelRow: {
    position: 'absolute',
    // Sits just below the ring box. The parent toggle bar reserves a bit of
    // bottom padding so this lands inside the bar, above the divider.
    top: BOX - 6,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  label: {
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 12,
    color: 'rgba(230,180,122,0.7)',
    letterSpacing: 0.4,
  },
  infoBtn: {
    // Small visible glyph; the ~44px tap target comes from hitSlop above.
    paddingHorizontal: 1,
    paddingVertical: 1,
  },
  infoCircle: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoChar: {
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 10,
    lineHeight: 12,
    color: 'rgba(230,180,122,0.65)',
    marginTop: -1,
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
