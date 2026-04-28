// Integration ("Tikun") view of the inner map. Circle layout — all
// nodes equidistant on a single circle, Self at the absolute center.
//
// Visual identity is intentionally different from the triangle view:
//   - No containing borders or stroke circles. Each part is its NAME
//     only — floating italic text in its color, softly glowing.
//   - A faint white connecting arc around the perimeter — a unified
//     circle, not the triangle's structural lines.
//   - Self: a steady, larger glowing presence at center. No pulse.
//   - The atmospheric purple-amber glow softens and spreads evenly
//     instead of pooling between Fixer and Skeptic.
//
// The whole canvas reads quieter, more spacious, more still — what the
// system looks like when healing has happened. Tap any name to open
// the integration panel for that part.

import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  Canvas, Circle, Group, RadialGradient, vec,
} from '@shopify/react-native-skia';
import {
  useSharedValue, withRepeat, withTiming, Easing, useDerivedValue,
  useAnimatedStyle,
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
// Per spec:
//   Wound        — 12 (top)
//   Fixer        — 2  (upper right)
//   Managers     — 4  (right)
//   Skeptic      — 5  (lower right)
//   Firefighters — 7  (lower left)
//   Self-Like    — 10 (left)
const HOUR: Record<Exclude<IntegrationKey, 'self'>, number> = {
  wound: 0,
  fixer: 2,
  manager: 4,
  skeptic: 5,
  firefighter: 7,
  'self-like': 10,
};

// Friendly text label for each tappable position.
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

export function CircleMapCanvas({ width, height, onNodeTap }: Props) {
  const cx = width / 2;
  const cy = height / 2;
  // Radius: 38% of the smaller canvas dimension, per spec.
  const radius = Math.min(width, height) * 0.38;

  // Soft warm light pulses gently from Self outward — the atmospheric
  // quality of the integration view. Slower than the triangle's
  // breath; reads as stillness, not motion.
  const breath = useSharedValue(0.45);
  // Circle-arc breath — the unified perimeter slowly inhales (0.4 → 0.7
  // over 3s) so the boundary feels alive rather than drawn-on.
  const arcBreath = useSharedValue(0.4);
  // Self pulse — slower, deeper than the rest. 0.6 → 1.0 over 4s. Reads
  // as the steady center of the integrated system.
  const selfPulse = useSharedValue(0.6);
  // Traveling-light orbit — 0..1 over 10s, one full revolution. A single
  // warm amber dot drifts around the perimeter as a sign that the system
  // is in motion even at rest.
  const orbit = useSharedValue(0);
  useEffect(() => {
    breath.value = withRepeat(
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
  }, [breath, arcBreath, selfPulse, orbit]);
  const ambientOpacity = useDerivedValue(() => breath.value, [breath]);
  const arcOpacity = useDerivedValue(() => arcBreath.value, [arcBreath]);
  const selfHaloOpacity = useDerivedValue(() => selfPulse.value, [selfPulse]);
  // Slightly larger Self than the previous build; spec calls for a more
  // present centerpiece in the integration view.
  const selfRadius = 46;

  // Traveling-light position derived from orbit progress.
  const orbitX = useDerivedValue(
    () => cx + radius * Math.cos(orbit.value * Math.PI * 2 - Math.PI / 2),
    [orbit, cx, radius],
  );
  const orbitY = useDerivedValue(
    () => cy + radius * Math.sin(orbit.value * Math.PI * 2 - Math.PI / 2),
    [orbit, cy, radius],
  );

  // Helper — convert a clock hour to (x,y) on the circle. Labels sit JUST
  // INSIDE the perimeter (78% of radius) so the names feel contained
  // within the unified circle rather than floating outside it.
  const LABEL_RADIUS_FACTOR = 0.78;
  function hourPos(hour: number, factor = 1): { x: number; y: number } {
    // Hour 0 = 12 o'clock = -π/2 in standard math coords.
    const angle = (hour / 12) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * radius * factor, y: cy + Math.sin(angle) * radius * factor };
  }

  return (
    <View style={[styles.root, { width, height }]} pointerEvents="box-none">
      <Canvas style={{ width, height }}>
        {/* Atmospheric warm light — emanates from center Self outward, evenly.
            Replaces the triangle view's purple haze pooled between Fixer
            and Skeptic. Reads as the contained system at rest. */}
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

        {/* Faint perimeter arc — a unified circle binding all positions.
            Opacity breathes 0.4 → 0.7 over 3s so the boundary feels alive,
            not drawn-on. Replaces the triangle's three structural lines. */}
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

        {/* Traveling amber light — a tiny radial-gradient dot orbits the
            perimeter once every 10s. Subtle: reads as light moving along
            the edge of something alive, not a UI indicator. */}
        <Circle cx={orbitX} cy={orbitY} r={10}>
          <RadialGradient
            c={vec(0, 0)}
            r={10}
            colors={['rgba(230,180,122,0.9)', 'rgba(230,180,122,0.35)', 'rgba(230,180,122,0)']}
          />
        </Circle>

        {/* Self at center — a steady glowing presence. Larger than the
            triangle view's Self. Soft halo + a thin lavender ring; no
            pulse, no animation other than the very subtle ambient breath. */}
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

      {/* Floating part-name labels JUST INSIDE the perimeter (78% radius).
          Each label gently pulses 0.6 → 0.9 in its own color over 2.5s,
          offset by 0.4s per node so they don't all pulse together — the
          ring reads as a chorus, not a metronome. */}
      {(Object.keys(HOUR) as Array<Exclude<IntegrationKey, 'self'>>).map((k, i) => {
        const pos = hourPos(HOUR[k], LABEL_RADIUS_FACTOR);
        return (
          <NameLabel
            key={k}
            x={pos.x}
            y={pos.y}
            label={LABEL[k]}
            color={COLOR_FOR[k]}
            onPress={() => onNodeTap?.(k)}
            phaseOffsetMs={i * 400}
          />
        );
      })}
      {/* Self at center is also tappable — opens its own integration panel */}
      <NameLabel
        x={cx}
        y={cy}
        label={LABEL.self}
        color={COLOR_FOR.self}
        onPress={() => onNodeTap?.('self')}
        center
      />
    </View>
  );
}

function NameLabel({
  x, y, label, color, onPress, center, phaseOffsetMs = 0,
}: {
  x: number; y: number; label: string; color: string;
  onPress?: () => void; center?: boolean; phaseOffsetMs?: number;
}) {
  const W = 120;            // tap-target width
  const H = 44;             // tap-target height (≥44 per HIG)
  // Per-label opacity pulse 0.6 ↔ 0.9 / 2.5s, started after a per-node
  // phaseOffsetMs delay so the ring of names doesn't beat in unison.
  const pulse = useSharedValue(0.6);
  useEffect(() => {
    const t = setTimeout(() => {
      pulse.value = withRepeat(
        withTiming(0.9, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
        -1, true,
      );
    }, phaseOffsetMs);
    return () => clearTimeout(t);
  }, [pulse, phaseOffsetMs]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
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
          // Self's label sits on top of its glow; bump font slightly so
          // it reads as the visual centerpiece without crowding.
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
