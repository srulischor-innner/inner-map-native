// Integration ("Tikun") view of the inner map. Circle layout — all
// nodes equidistant on a single circle, Self at the absolute center.
//
// Visual identity is intentionally different from the triangle view:
//   - No containing borders or stroke circles. Each part is its NAME
//     only — floating italic text in its color, softly glowing.
//   - A faint white connecting arc around the perimeter — a unified
//     circle, not the triangle's structural lines.
//   - Self: a steady, larger glowing presence at center. Slow concentric
//     rings of soft purple light radiate outward toward the perimeter.
//   - The atmospheric purple-amber glow softens and spreads evenly
//     instead of pooling between Fixer and Skeptic.
//
// FOUR LAYERS OF "ALIVE" BEHAVIOR (system as cooperation, not tension):
//   A — Unified breathing. Every node label opacity pulses 0.7 → 1.0
//       over 3s in the SAME phase. One shared breath, not the triangle
//       view's offset chorus.
//   B — Self radiates outward. Skia stroked ring expands from Self's
//       radius to the perimeter every 4s, opacity fading 0.4 → 0.
//   C — Energy pulses between nodes. Wound → Fixer (red, 2s) → pause 1s
//       → Fixer → Skeptic (amber, 2s) → pause 1s → Skeptic → Wound
//       (blue, 2s) → pause 4s. 12-second loop.
//   D — Node response. When a pulse arrives, the destination label's
//       opacity briefly bumps to 1.0 over ~200ms then settles back into
//       the unified breath.

import React, { useEffect } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import {
  Canvas, Circle, Group, RadialGradient, vec,
} from '@shopify/react-native-skia';
import {
  useSharedValue, withRepeat, withTiming, withSequence, Easing,
  useDerivedValue, useAnimatedStyle, type SharedValue,
} from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { colors, fonts } from '../../constants/theme';
import type { NodeKey } from './InnerMapCanvas';

// Brighter strokes used for label text — same palette as the triangle
// view's MAP_STROKE so the colors don't drift between views.
const COLOR = {
  wound:        '#FF5555',
  fixer:        '#F0C070',
  skeptic:      '#90C8E8',
  self:         '#D4B8E8',
  selfLike:     '#A090C0',
  managers:     '#A8DCC0',
  firefighters: '#F0A050',
};

type Props = {
  width: number;
  height: number;
  onNodeTap?: (k: IntegrationKey) => void;
};

// Integration panel keys — same as NodeKey for the seven parts.
export type IntegrationKey = NodeKey;

// Position keyed by clock-face hour. 0=12 o'clock (top), going clockwise.
//   Wound — 12, Fixer — 2, Managers — 4, Skeptic — 5,
//   Firefighters — 7, Self-Like — 10
const HOUR: Record<Exclude<IntegrationKey, 'self'>, number> = {
  wound: 0,
  fixer: 2,
  manager: 4,
  skeptic: 5,
  firefighter: 7,
  'self-like': 10,
};

const LABEL: Record<IntegrationKey, string> = {
  wound: 'Wound',
  fixer: 'Fixer',
  skeptic: 'Skeptic',
  manager: 'Managers',
  firefighter: 'Firefighters',
  'self-like': 'Self-Like',
  self: 'Self',
};

const COLOR_FOR: Record<IntegrationKey, string> = {
  wound:        COLOR.wound,
  fixer:        COLOR.fixer,
  skeptic:      COLOR.skeptic,
  manager:      COLOR.managers,
  firefighter:  COLOR.firefighters,
  'self-like':  COLOR.selfLike,
  self:         COLOR.self,
};

// Hour-to-radian helper that returns the math-coord angle (0=12 o'clock
// is -π/2). Defined at module scope so it can be reused inside the
// pulse-cycle setup without re-binding cx/cy.
function hourAngle(hour: number): number {
  return (hour / 12) * Math.PI * 2 - Math.PI / 2;
}

export function CircleMapCanvas({ width, height, onNodeTap }: Props) {
  const cx = width / 2;
  const cy = height / 2;
  // Radius: 38% of the smaller canvas dimension, per spec.
  const radius = Math.min(width, height) * 0.38;
  // Slightly larger Self than the previous build; spec calls for a more
  // present centerpiece in the integration view.
  const selfRadius = 46;

  // -------------------------------------------------------------------
  // SHARED VALUES
  // -------------------------------------------------------------------
  // Atmospheric backdrop breath (separate from the unified node breath).
  const ambientBreath = useSharedValue(0.45);
  // Perimeter arc breath — the unified circle outline inhales.
  const arcBreath = useSharedValue(0.4);
  // Self halo breath.
  const selfPulse = useSharedValue(0.6);
  // Traveling amber light orbit (one full revolution per 10s).
  const orbit = useSharedValue(0);

  // LAYER A — single unified breath shared by every node label. All
  // labels read this same value so they breathe in sync. 0.7 → 1.0 / 3s.
  const unifiedBreath = useSharedValue(0.7);

  // LAYER B — Self ring expansion. 0..1 over 4s, repeats forever. The
  // ring's radius and opacity are derived from this single progress
  // value so the visual cost is minimal.
  const selfRingProgress = useSharedValue(0);

  // LAYER C — three traveling pulse circles. Each has its own angle SV
  // so the three pulses can be rendered as independent Skia Circles
  // without juggling a SharedValue<string> color. Only one is visible
  // at a time (controlled by per-pulse opacity SV).
  const woundAng = useSharedValue(hourAngle(HOUR.wound));
  const woundOp  = useSharedValue(0);
  const fixerAng = useSharedValue(hourAngle(HOUR.fixer));
  const fixerOp  = useSharedValue(0);
  const skepticAng = useSharedValue(hourAngle(HOUR.skeptic));
  const skepticOp  = useSharedValue(0);

  // LAYER D — destination flash per node. Added to the unifiedBreath
  // value when computing label opacity, so the receiving node briefly
  // rides above the shared breath then settles back down.
  const woundFlash   = useSharedValue(0);
  const fixerFlash   = useSharedValue(0);
  const skepticFlash = useSharedValue(0);

  // -------------------------------------------------------------------
  // ANIMATION SETUP
  // -------------------------------------------------------------------
  useEffect(() => {
    ambientBreath.value = withRepeat(
      withTiming(0.7, { duration: 4500, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    arcBreath.value = withRepeat(
      withTiming(0.7, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    selfPulse.value = withRepeat(
      withTiming(1.0, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    orbit.value = withRepeat(
      withTiming(1, { duration: 10000, easing: Easing.linear }),
      -1, false,
    );
    // Layer A — unified node breath.
    unifiedBreath.value = withRepeat(
      withTiming(1.0, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    // Layer B — Self ring radiates outward; on each cycle progress
    // resets to 0 (snap) and grows to 1 over 4s. The opacity envelope
    // runs in the derived value, so the snap is invisible.
    selfRingProgress.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.out(Easing.ease) }),
      -1, false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------
  // LAYER C/D — pulse cycle (12s loop). Driven from a JS-side scheduler
  // because the shape (three discrete travel segments + pauses + flash
  // triggers) is awkward to express as a single Reanimated sequence.
  // Each segment kicks off its own withTiming on the relevant angle SV,
  // sets visibility, and (on arrival) flashes the destination label.
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function flash(which: 'wound' | 'fixer' | 'skeptic') {
      const sv = which === 'wound' ? woundFlash
              : which === 'fixer' ? fixerFlash
              : skepticFlash;
      // 0 → 0.5 over 200ms, then back to 0 over 600ms. Bumps the
      // unified breath by up to +0.5 so the destination label briefly
      // hits opacity 1.0+.
      sv.value = withSequence(
        withTiming(0.5, { duration: 200, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 600, easing: Easing.in(Easing.ease) }),
      );
    }

    function travel(
      angSV: SharedValue<number>,
      opSV: SharedValue<number>,
      fromAng: number,
      toAng: number,
      duration: number,
      onArrive: () => void,
    ) {
      angSV.value = fromAng;
      opSV.value = 1;
      angSV.value = withTiming(toAng, { duration, easing: Easing.linear });
      // Fade out as it merges into the destination node, with a tiny
      // overlap so the transition reads as energy being absorbed.
      timers.push(setTimeout(() => {
        if (cancelled) return;
        opSV.value = withTiming(0, { duration: 250, easing: Easing.in(Easing.ease) });
        onArrive();
      }, duration));
    }

    const wA = hourAngle(HOUR.wound);
    const fA = hourAngle(HOUR.fixer);
    const sA = hourAngle(HOUR.skeptic);

    function cycle() {
      if (cancelled) return;
      // Segment 1: WOUND → FIXER (clockwise = angle increases). 0–2s.
      travel(woundAng, woundOp, wA, fA, 2000, () => flash('fixer'));

      // Segment 2: pause 1s. Then FIXER → SKEPTIC. 3–5s.
      timers.push(setTimeout(() => {
        if (cancelled) return;
        travel(fixerAng, fixerOp, fA, sA, 2000, () => flash('skeptic'));
      }, 3000));

      // Segment 3: pause 1s. Then SKEPTIC → WOUND clockwise — wraps
      // around the bottom + left, so we target wA + 2π so the timing
      // path moves through the longer arc without snapping back.
      timers.push(setTimeout(() => {
        if (cancelled) return;
        travel(skepticAng, skepticOp, sA, wA + Math.PI * 2, 2000, () => flash('wound'));
      }, 6000));

      // Pause 4s, then loop.
      timers.push(setTimeout(() => { if (!cancelled) cycle(); }, 12000));
    }
    cycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------
  // DERIVED VALUES (Skia paint inputs — read on UI thread)
  // -------------------------------------------------------------------
  const ambientOpacity = useDerivedValue(() => ambientBreath.value, [ambientBreath]);
  const arcOpacity     = useDerivedValue(() => arcBreath.value, [arcBreath]);
  const selfHaloOpacity = useDerivedValue(() => selfPulse.value, [selfPulse]);

  const orbitX = useDerivedValue(
    () => cx + radius * Math.cos(orbit.value * Math.PI * 2 - Math.PI / 2),
    [orbit, cx, radius],
  );
  const orbitY = useDerivedValue(
    () => cy + radius * Math.sin(orbit.value * Math.PI * 2 - Math.PI / 2),
    [orbit, cy, radius],
  );

  // Layer B — Self ring radius + opacity. Radius lerps from selfRadius
  // → radius (perimeter); opacity lerps from 0.4 → 0 across the same
  // progress so the ring fades into the perimeter as it arrives.
  const selfRingR = useDerivedValue(
    () => selfRadius + (radius - selfRadius) * selfRingProgress.value,
    [selfRingProgress, radius],
  );
  const selfRingOpacity = useDerivedValue(
    () => 0.4 * (1 - selfRingProgress.value),
    [selfRingProgress],
  );

  // Layer C — pulse positions on the perimeter.
  const woundPulseX = useDerivedValue(() => cx + radius * Math.cos(woundAng.value), [woundAng, cx, radius]);
  const woundPulseY = useDerivedValue(() => cy + radius * Math.sin(woundAng.value), [woundAng, cy, radius]);
  const fixerPulseX = useDerivedValue(() => cx + radius * Math.cos(fixerAng.value), [fixerAng, cx, radius]);
  const fixerPulseY = useDerivedValue(() => cy + radius * Math.sin(fixerAng.value), [fixerAng, cy, radius]);
  const skepticPulseX = useDerivedValue(() => cx + radius * Math.cos(skepticAng.value), [skepticAng, cx, radius]);
  const skepticPulseY = useDerivedValue(() => cy + radius * Math.sin(skepticAng.value), [skepticAng, cy, radius]);

  // -------------------------------------------------------------------
  // LABEL POSITIONING — labels sit JUST INSIDE the perimeter (78% of
  // radius) so the names feel contained within the unified circle
  // rather than floating outside it.
  // -------------------------------------------------------------------
  const LABEL_RADIUS_FACTOR = 0.78;
  function hourPos(hour: number, factor = 1): { x: number; y: number } {
    const a = hourAngle(hour);
    return { x: cx + Math.cos(a) * radius * factor, y: cy + Math.sin(a) * radius * factor };
  }

  // Map per-key flash SV — only the three lit-up parts (wound/fixer/
  // skeptic) get a flash; the others ride the unified breath alone.
  const flashFor: Partial<Record<IntegrationKey, SharedValue<number>>> = {
    wound: woundFlash,
    fixer: fixerFlash,
    skeptic: skepticFlash,
  };

  return (
    <View style={[styles.root, { width, height }]} pointerEvents="box-none">
      <Canvas style={{ width, height }}>
        {/* Atmospheric warm light — emanates from center Self outward. */}
        <Group opacity={ambientOpacity}>
          <Circle cx={cx} cy={cy} r={Math.min(width, height) * 0.55}>
            <RadialGradient
              c={vec(cx, cy)}
              r={Math.min(width, height) * 0.6}
              colors={[
                'rgba(230,180,122,0.18)',
                'rgba(193,170,216,0.14)',
                'rgba(193,170,216,0)',
              ]}
            />
          </Circle>
        </Group>

        {/* Faint perimeter arc — breathes 0.4 → 0.7 / 3s. */}
        <Group opacity={arcOpacity}>
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            color="rgba(255,255,255,0.18)"
            style="stroke"
            strokeWidth={1}
          />
        </Group>

        {/* LAYER B — Self ring expanding outward. One stroked lavender
            ring whose radius lerps from Self's edge to the perimeter
            every 4s, opacity 0.4 → 0 along the way. Heartbeat outward. */}
        <Circle
          cx={cx}
          cy={cy}
          r={selfRingR}
          color="rgba(193,170,216,0.4)"
          style="stroke"
          strokeWidth={1.5}
          opacity={selfRingOpacity}
        />

        {/* Traveling amber light — orbits the perimeter once / 10s. */}
        <Circle cx={orbitX} cy={orbitY} r={10}>
          <RadialGradient
            c={vec(0, 0)}
            r={10}
            colors={['rgba(230,180,122,0.9)', 'rgba(230,180,122,0.35)', 'rgba(230,180,122,0)']}
          />
        </Circle>

        {/* LAYER C — three pulse dots, only one visible at a time.
            Each is a small radial-gradient glow (radius ~6px core +
            soft halo) that travels along the perimeter from one node
            to the next in its color. */}
        <Circle cx={woundPulseX} cy={woundPulseY} r={9} opacity={woundOp}>
          <RadialGradient
            c={vec(0, 0)}
            r={9}
            colors={['rgba(255,85,85,0.95)', 'rgba(255,85,85,0.35)', 'rgba(255,85,85,0)']}
          />
        </Circle>
        <Circle cx={fixerPulseX} cy={fixerPulseY} r={9} opacity={fixerOp}>
          <RadialGradient
            c={vec(0, 0)}
            r={9}
            colors={['rgba(240,192,112,0.95)', 'rgba(240,192,112,0.35)', 'rgba(240,192,112,0)']}
          />
        </Circle>
        <Circle cx={skepticPulseX} cy={skepticPulseY} r={9} opacity={skepticOp}>
          <RadialGradient
            c={vec(0, 0)}
            r={9}
            colors={['rgba(144,200,232,0.95)', 'rgba(144,200,232,0.35)', 'rgba(144,200,232,0)']}
          />
        </Circle>

        {/* Self at center — steady glowing presence. */}
        <Circle cx={cx} cy={cy} r={selfRadius * 1.8} opacity={selfHaloOpacity}>
          <RadialGradient
            c={vec(cx, cy)}
            r={selfRadius * 2}
            colors={[colors.self + 'CC', colors.self + '33', colors.self + '00']}
          />
        </Circle>
        <Circle
          cx={cx}
          cy={cy}
          r={selfRadius}
          color="rgba(193,170,216,0.4)"
          style="stroke"
          strokeWidth={1}
        />
        <Circle cx={cx} cy={cy} r={selfRadius * 0.55} color={colors.self + '40'} style="fill" />
      </Canvas>

      {/* LAYER A + D — node labels share a single unifiedBreath SV so
          they pulse in sync. The wound/fixer/skeptic labels also receive
          a per-node flash SV that briefly bumps their opacity above the
          shared breath when a pulse arrives at them. */}
      {(Object.keys(HOUR) as Array<Exclude<IntegrationKey, 'self'>>).map((k) => {
        const pos = hourPos(HOUR[k], LABEL_RADIUS_FACTOR);
        return (
          <NameLabel
            key={k}
            x={pos.x}
            y={pos.y}
            label={LABEL[k]}
            color={COLOR_FOR[k]}
            onPress={() => onNodeTap?.(k)}
            breath={unifiedBreath}
            flash={flashFor[k]}
          />
        );
      })}
      {/* Self at center is also tappable. */}
      <NameLabel
        x={cx}
        y={cy}
        label={LABEL.self}
        color={COLOR_FOR.self}
        onPress={() => onNodeTap?.('self')}
        center
        breath={unifiedBreath}
      />
    </View>
  );
}

function NameLabel({
  x, y, label, color, onPress, center, breath, flash,
}: {
  x: number; y: number; label: string; color: string;
  onPress?: () => void; center?: boolean;
  breath: SharedValue<number>;
  flash?: SharedValue<number>;
}) {
  const W = 120;            // tap-target width
  const H = 44;             // tap-target height (≥44 per HIG)
  // Opacity = unified breath + (optional) flash bump, clamped to 1.0.
  const animatedStyle = useAnimatedStyle(() => {
    const base = breath.value;
    const bump = flash ? flash.value : 0;
    const v = base + bump;
    return { opacity: v > 1 ? 1 : v };
  });
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityLabel={`${label} — open integration panel`}
      style={[
        styles.label,
        { left: x - W / 2, top: y - H / 2, width: W, height: H },
      ]}
    >
      <Animated.Text
        allowFontScaling={false}
        style={[
          styles.labelText,
          { color },
          center ? styles.labelTextCenter : null,
          animatedStyle,
        ]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  label: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    letterSpacing: 0.3,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 1 },
  },
  labelTextCenter: { fontSize: 17 },
});
