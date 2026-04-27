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
} from 'react-native-reanimated';
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
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.7, { duration: 4500, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [breath]);
  const ambientOpacity = useDerivedValue(() => breath.value, [breath]);

  // Self breathes very gently in radius — almost imperceptible. The point
  // of the view is stillness; movement here is a whisper, not a pulse.
  const selfRadius = 40;
  const selfHaloOpacity = useDerivedValue(() => 0.45 + 0.2 * breath.value, [breath]);

  // Helper — convert a clock hour to (x,y) on the circle.
  function hourPos(hour: number): { x: number; y: number } {
    // Hour 0 = 12 o'clock = -π/2 in standard math coords.
    const angle = (hour / 12) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
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
            One stroked circle, very low alpha. Replaces the triangle's
            three structural lines. */}
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          color="rgba(255,255,255,0.08)"
          style="stroke"
          strokeWidth={1}
        />

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

      {/* Floating part-name labels around the circle. Rendered as RN <Text>
          overlays so they can use Cormorant Garamond Italic + a soft text
          shadow. Each is tappable via a Pressable wrapping it; 44x44 min. */}
      {(Object.keys(HOUR) as Array<Exclude<IntegrationKey, 'self'>>).map((k) => {
        const pos = hourPos(HOUR[k]);
        return (
          <NameLabel
            key={k}
            x={pos.x}
            y={pos.y}
            label={LABEL[k]}
            color={COLOR_FOR[k]}
            onPress={() => onNodeTap?.(k)}
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
  x, y, label, color, onPress, center,
}: {
  x: number; y: number; label: string; color: string;
  onPress?: () => void; center?: boolean;
}) {
  const W = 120;            // tap-target width
  const H = 44;             // tap-target height (≥44 per HIG)
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
      <Text
        allowFontScaling={false}
        style={[
          styles.labelText,
          { color },
          // Self's label sits on top of its glow; bump font slightly so
          // it reads as the visual centerpiece without crowding.
          center ? styles.labelTextCenter : null,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
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
