// Skia-rendered inner map — the visual heart of the app.
//
// The canvas sits inside a flex-1 wrapper that measures its own size, then draws
// the triangle, atmospheric glow, and all seven nodes at positions computed by
// mapLayout.ts. Everything is GPU-accelerated through Skia so breathing / pulsing
// animations stay at 60fps even on older devices.
//
// Animations (Reanimated shared values feeding Skia paints):
//   - Triangle opacity oscillates 0.55 ↔ 0.9 over 4s — the "breath" of the map.
//   - Self circle scale oscillates 1.0 ↔ 1.06 — the calm, present center.
//   - Wound radial glow pulses softly when no data yet, steadier once filled.
//
// Tap handling lives OUTSIDE Skia in a sibling <Pressable> overlay because
// react-native-skia doesn't have first-class touch events. Each node gets its
// own absolutely-positioned Pressable sized to the node's hit region.

import React, { useEffect } from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Path,
  RadialGradient,
  Skia,
  Line,
  DashPathEffect,
  vec,
} from '@shopify/react-native-skia';
import {
  useSharedValue,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
  useDerivedValue,
} from 'react-native-reanimated';
import { colors } from '../../constants/theme';
import type { MapGeometry, Node as GeomNode, Diamond as GeomDiamond } from '../../utils/mapLayout';

export type NodeKey = 'wound' | 'fixer' | 'skeptic' | 'self' | 'self-like' | 'manager' | 'firefighter';

type Props = {
  geom: MapGeometry;
  activePart?: NodeKey | null;           // currently detected — scales this node up
  onNodeTap?: (k: NodeKey) => void;
};

export function InnerMapCanvas({ geom, activePart, onNodeTap }: Props) {
  // ===== SHARED VALUES (Reanimated) =====
  const breath = useSharedValue(0.55);
  const selfScale = useSharedValue(1);
  const woundPulse = useSharedValue(1);

  // Per-node "active" scale — springs up to 1.25 when a part is detected in
  // conversation, drops back to 1 when another part fires or after the 8s
  // timeout in map.tsx wipes activePart. The radial-gradient halo on the
  // drawn circle scales with it so the "lighting up" is visible at a glance.
  const scaleWound       = useSharedValue(1);
  const scaleFixer       = useSharedValue(1);
  const scaleSkeptic     = useSharedValue(1);
  const scaleSelf        = useSharedValue(1);
  const scaleSelfLike    = useSharedValue(1);
  const scaleManager     = useSharedValue(1);
  const scaleFirefighter = useSharedValue(1);
  const scaleByKey: Record<NodeKey, ReturnType<typeof useSharedValue<number>>> = {
    'wound':       scaleWound,
    'fixer':       scaleFixer,
    'skeptic':     scaleSkeptic,
    'self':        scaleSelf,
    'self-like':   scaleSelfLike,
    'manager':     scaleManager,
    'firefighter': scaleFirefighter,
  };

  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.9, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    selfScale.value = withRepeat(
      withTiming(1.06, { duration: 5000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    woundPulse.value = withRepeat(
      withTiming(1.12, { duration: 3500, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // React to activePart — spring the matching node up, snap the others back.
  useEffect(() => {
    (Object.keys(scaleByKey) as NodeKey[]).forEach((k) => {
      const target = k === activePart ? 1.25 : 1;
      scaleByKey[k].value = withSpring(target, { damping: 12, stiffness: 110 });
    });
  }, [activePart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Skia-specific derived values (forces re-read on the UI thread)
  const triangleOpacity = useDerivedValue(() => breath.value, [breath]);
  const selfR = useDerivedValue(() => geom.self.r * selfScale.value * scaleSelf.value, [geom.self.r, selfScale, scaleSelf]);
  const woundR = useDerivedValue(() => geom.wound.r * woundPulse.value * scaleWound.value, [geom.wound.r, woundPulse, scaleWound]);
  const fixerR = useDerivedValue(() => geom.fixer.r * scaleFixer.value, [geom.fixer.r, scaleFixer]);
  const skepticR = useDerivedValue(() => geom.skeptic.r * scaleSkeptic.value, [geom.skeptic.r, scaleSkeptic]);
  const managersR = useDerivedValue(() => geom.managers.r * scaleManager.value, [geom.managers.r, scaleManager]);
  const firefightersR = useDerivedValue(() => geom.firefighters.r * scaleFirefighter.value, [geom.firefighters.r, scaleFirefighter]);

  const { width, height, wound, fixer, skeptic, self, selfLike, managers, firefighters, triangle, atmosphere } = geom;

  return (
    <View style={[styles.root, { width, height }]} pointerEvents="box-none">
      <Canvas style={{ width, height }}>
        {/* Atmospheric glow between Fixer and Skeptic — a subtle purple haze */}
        <Group opacity={0.45}>
          <Circle cx={atmosphere.cx} cy={atmosphere.cy} r={atmosphere.rx * 0.9}>
            <RadialGradient
              c={vec(atmosphere.cx, atmosphere.cy)}
              r={atmosphere.rx}
              colors={['rgba(177, 156, 217, 0.28)', 'rgba(177, 156, 217, 0)']}
            />
          </Circle>
        </Group>

        {/* Triangle outline — three lines that breathe together */}
        <Group opacity={triangleOpacity}>
          {[0, 1, 2].map((i) => {
            const a = triangle[i];
            const b = triangle[i + 1];
            return (
              <Line
                key={i}
                p1={vec(a.x, a.y)}
                p2={vec(b.x, b.y)}
                color="#5a5a8a"
                style="stroke"
                strokeWidth={1.5}
              />
            );
          })}
        </Group>

        {/* MANAGERS — dashed green ring on the left */}
        <DashedRing node={managers} r={managersR} color={colors.managers} />

        {/* FIREFIGHTERS — dashed orange ring on the right */}
        <DashedRing node={firefighters} r={firefightersR} color={colors.firefighters} />

        {/* SELF-LIKE — muted lavender diamond below Self */}
        <SelfLikeDiamond d={selfLike} />

        {/* SELF — breathing lavender circle at center */}
        <GlowCircle cx={self.x} cy={self.y} r={selfR} color={colors.self} gradientR={self.r * 2.2} coreR={self.r * 0.55} />

        {/* WOUND — red circle at top, gently pulsing */}
        <GlowCircle cx={wound.x} cy={wound.y} r={woundR} color={colors.wound} gradientR={wound.r * 1.8} coreR={wound.r * 0.5} />

        {/* FIXER — amber circle at bottom-right */}
        <GlowCircle cx={fixer.x} cy={fixer.y} r={fixerR} color={colors.fixer} gradientR={fixer.r * 1.8} coreR={fixer.r * 0.5} />

        {/* SKEPTIC — blue circle at bottom-left */}
        <GlowCircle cx={skeptic.x} cy={skeptic.y} r={skepticR} color={colors.skeptic} gradientR={skeptic.r * 1.8} coreR={skeptic.r * 0.5} />
      </Canvas>

      {/* ===== TEXT LABELS ===== Rendered as RN <Text> overlays instead of Skia SkText
           so we don't need a font asset loaded. One label per node, centered on the
           node's geometry. pointerEvents=none so they never block the Pressable taps. */}
      <NodeLabel x={wound.x}        y={wound.y}        label="WOUND"        color={colors.wound} />
      <NodeLabel x={fixer.x}        y={fixer.y}        label="FIXER"        color={colors.fixer} />
      <NodeLabel x={skeptic.x}      y={skeptic.y}      label="SKEPTIC"      color={colors.skeptic} />
      <NodeLabel x={self.x}         y={self.y}         label="SELF"         color={colors.self} />
      <NodeLabel x={managers.x}     y={managers.y}     label="MANAGERS"     color={colors.managers} />
      <NodeLabel x={firefighters.x} y={firefighters.y} label="FIREFIGHTERS" color={colors.firefighters} />
      <NodeLabel x={selfLike.cx}    y={selfLike.cy + selfLike.size + 16} label="SELF-LIKE" color={colors.selfLike} />

      {/* ===== TAP OVERLAY ===== Absolutely-positioned Pressable per node. Hit region
           is slightly larger than the drawn circle for comfortable tap targets. */}
      <TapTarget node={wound}     kind="wound"       onTap={onNodeTap} label="WOUND" />
      <TapTarget node={fixer}     kind="fixer"       onTap={onNodeTap} label="FIXER" />
      <TapTarget node={skeptic}   kind="skeptic"     onTap={onNodeTap} label="SKEPTIC" />
      <TapTarget node={self}      kind="self"        onTap={onNodeTap} label="SELF" />
      <TapTarget node={managers}  kind="manager"     onTap={onNodeTap} label="MANAGERS" />
      <TapTarget node={firefighters} kind="firefighter" onTap={onNodeTap} label="FIREFIGHTERS" />
      <DiamondTapTarget d={selfLike} kind="self-like" onTap={onNodeTap} label="SELF-LIKE" />
    </View>
  );
}

// Compact label that sits centered on a node. Absolute-positioned and
// non-interactive so it never gets in the way of the Pressable hit zone.
function NodeLabel({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  const W = 90;
  const H = 18;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.label,
        { left: x - W / 2, top: y - H / 2, width: W, height: H },
      ]}
    >
      <Text style={[styles.labelText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ---------- Skia drawing sub-components ----------

function GlowCircle({
  cx, cy, r, color, gradientR, coreR,
}: {
  cx: number;
  cy: number;
  r: any;              // number or Skia animated value
  color: string;
  gradientR: number;
  coreR: number;
}) {
  return (
    <Group>
      {/* Outer soft glow halo */}
      <Circle cx={cx} cy={cy} r={gradientR} opacity={0.65}>
        <RadialGradient
          c={vec(cx, cy)}
          r={gradientR}
          colors={[color + 'AA', color + '00']}
        />
      </Circle>
      {/* Solid stroke outline */}
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={2.5} />
      {/* Dim inner core fill for depth */}
      <Circle cx={cx} cy={cy} r={coreR} color={color + '33'} style="fill" />
    </Group>
  );
}

function DashedRing({ node, r, color }: { node: GeomNode; r: any; color: string }) {
  return (
    <Group>
      <Circle cx={node.x} cy={node.y} r={node.r} opacity={0.35}>
        <RadialGradient
          c={vec(node.x, node.y)}
          r={node.r * 1.8}
          colors={[color + '55', color + '00']}
        />
      </Circle>
      <Circle cx={node.x} cy={node.y} r={r} color={color} style="stroke" strokeWidth={2.5}>
        <DashPathEffect intervals={[8, 4]} />
      </Circle>
    </Group>
  );
}

function SelfLikeDiamond({ d }: { d: GeomDiamond }) {
  // Diamond built as a Path — easier than chaining four <Line>s.
  const path = Skia.Path.Make();
  path.moveTo(d.cx, d.cy - d.size);
  path.lineTo(d.cx + d.size, d.cy);
  path.lineTo(d.cx, d.cy + d.size);
  path.lineTo(d.cx - d.size, d.cy);
  path.close();
  return (
    <Group>
      <Path path={path} color={colors.selfLike + '33'} style="fill" />
      <Path path={path} color={colors.selfLike} style="stroke" strokeWidth={2} />
    </Group>
  );
}

// ---------- Tap targets (sibling Pressables) ----------

function TapTarget({
  node, kind, onTap, label,
}: {
  node: GeomNode;
  kind: NodeKey;
  onTap?: (k: NodeKey) => void;
  label: string;
}) {
  const hit = node.r * 1.2;
  return (
    <Pressable
      onPress={() => onTap?.(kind)}
      accessibilityLabel={label}
      style={[
        styles.tap,
        { left: node.x - hit, top: node.y - hit, width: hit * 2, height: hit * 2 },
      ]}
      hitSlop={8}
    />
  );
}

function DiamondTapTarget({
  d, kind, onTap, label,
}: {
  d: GeomDiamond;
  kind: NodeKey;
  onTap?: (k: NodeKey) => void;
  label: string;
}) {
  const hit = d.size * 1.4;
  return (
    <Pressable
      onPress={() => onTap?.(kind)}
      accessibilityLabel={label}
      style={[styles.tap, { left: d.cx - hit, top: d.cy - hit, width: hit * 2, height: hit * 2 }]}
      hitSlop={8}
    />
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  tap: { position: 'absolute', borderRadius: 999 },
  label: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.3,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 3,
  },
});
