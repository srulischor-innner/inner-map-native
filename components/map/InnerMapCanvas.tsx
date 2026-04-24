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
  LinearGradient,
  BlurMask,
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

// Brighter, more vivid stroke colors used ONLY for the drawn map — the
// theme `colors.*` values stay muted for chips/text across the rest of
// the app. These make the nodes pop when the canvas is on-screen.
const MAP_STROKE = {
  wound:        '#FF5555',
  fixer:        '#F0C070',
  skeptic:      '#90C8E8',
  self:         '#D4B8E8',
  selfLike:     '#A090C0',
  managers:     '#A8DCC0',
  firefighters: '#F0A050',
};

// Per-node RGB tuple so we can build alpha-gradient color stops.
const MAP_RGB = {
  wound:        '224,85,85',
  fixer:        '240,192,112',
  skeptic:      '144,200,232',
  self:         '212,184,232',
  selfLike:     '160,144,192',
  managers:     '168,220,192',
  firefighters: '240,160,80',
};

type Props = {
  geom: MapGeometry;
  activePart?: NodeKey | null;           // currently detected — scales this node up
  onNodeTap?: (k: NodeKey) => void;
};

export function InnerMapCanvas({ geom, activePart, onNodeTap }: Props) {
  // ===== SHARED VALUES (Reanimated) =====
  const breath = useSharedValue(0.55);          // triangle-line opacity cycle
  // Shared value for the atmospheric-glow opacity cycle. Named *Breath so it
  // can't collide with `geom.atmosphere` (the ellipse geometry) if someone
  // ever re-adds `atmosphere` to the destructure below.
  const atmosphereBreath = useSharedValue(0.35);
  const subtleScale = useSharedValue(1);         // 1.0 ↔ 1.04 for every node
  const selfScale = useSharedValue(1);           // slightly deeper self pulse
  const woundPulse = useSharedValue(1);          // wound glow pulse

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
    // Triangle-line opacity cycle 0.5 ↔ 0.8 / 4s — 'breathing' of the map.
    breath.value = withRepeat(
      withTiming(0.8, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    // Atmospheric purple glow opacity cycle 0.3 ↔ 0.5 / 6s — adds depth to the
    // center of the triangle without demanding attention.
    atmosphereBreath.value = withRepeat(
      withTiming(0.5, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    // Universal subtle breath — every node scales 1.0 ↔ 1.04 / 5s. Small enough
    // that the animation reads as 'alive' rather than 'pulsing'.
    subtleScale.value = withRepeat(
      withTiming(1.04, { duration: 5000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    // Self gets a slightly deeper breath than the others (1.0 ↔ 1.06 / 5s) —
    // composes on top of subtleScale for a richer center.
    selfScale.value = withRepeat(
      withTiming(1.06, { duration: 5000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    // Wound gets its own slow glow-intensity pulse (1.0 ↔ 1.12 / 4s) so the
    // node at the top of the triangle feels like the heartbeat of the map.
    woundPulse.value = withRepeat(
      withTiming(1.12, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
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

  // Skia-specific derived values (forces re-read on the UI thread).
  // Every node's radius is `base * subtleScale * activeScale`. The subtle
  // breath is shared; activeScale springs to 1.25 when detected; the two
  // multiply so detection still reads clearly over the ambient motion.
  const triangleOpacity = useDerivedValue(() => breath.value, [breath]);
  const atmosphereOpacity = useDerivedValue(() => atmosphereBreath.value, [atmosphereBreath]);
  const selfR = useDerivedValue(
    () => geom.self.r * selfScale.value * scaleSelf.value,
    [geom.self.r, selfScale, scaleSelf],
  );
  const woundR = useDerivedValue(
    () => geom.wound.r * woundPulse.value * scaleWound.value,
    [geom.wound.r, woundPulse, scaleWound],
  );
  const fixerR = useDerivedValue(
    () => geom.fixer.r * subtleScale.value * scaleFixer.value,
    [geom.fixer.r, subtleScale, scaleFixer],
  );
  const skepticR = useDerivedValue(
    () => geom.skeptic.r * subtleScale.value * scaleSkeptic.value,
    [geom.skeptic.r, subtleScale, scaleSkeptic],
  );
  const managersR = useDerivedValue(
    () => geom.managers.r * subtleScale.value * scaleManager.value,
    [geom.managers.r, subtleScale, scaleManager],
  );
  const firefightersR = useDerivedValue(
    () => geom.firefighters.r * subtleScale.value * scaleFirefighter.value,
    [geom.firefighters.r, subtleScale, scaleFirefighter],
  );

  // Now that the shared breath value is named `atmosphereBreath`, this
  // destructure is unambiguous — `atmosphere` refers to the ellipse geometry.
  const { width, height, wound, fixer, skeptic, self, selfLike, managers, firefighters, triangle, atmosphere } = geom;

  return (
    <View style={[styles.root, { width, height }]} pointerEvents="box-none">
      <Canvas style={{ width, height }}>
        {/* Atmospheric glow between Fixer and Skeptic — breathing purple haze.
            Bumped from 0.34 → 0.55 peak alpha + wider radius so the triangle
            reads as a glowing vessel rather than a wireframe. */}
        <Group opacity={atmosphereOpacity}>
          <Circle cx={atmosphere.cx} cy={atmosphere.cy} r={atmosphere.rx * 1.1}>
            <RadialGradient
              c={vec(atmosphere.cx, atmosphere.cy)}
              r={atmosphere.rx * 1.2}
              colors={['rgba(177, 156, 217, 0.55)', 'rgba(177, 156, 217, 0.15)', 'rgba(177, 156, 217, 0)']}
            />
          </Circle>
        </Group>

        {/* Triangle outline — each leg is gradient-stroked from the wound color
            at the top vertex down to the node color at the bottom vertex so the
            backbone reads with depth rather than a flat grey. */}
        <Group opacity={triangleOpacity}>
          {[0, 1, 2].map((i) => {
            const a = triangle[i];
            const b = triangle[i + 1];
            // Map endpoints → which colors to blend. Edge 0 = wound→fixer, edge
            // 1 = fixer→skeptic (bottom), edge 2 = skeptic→wound.
            const endA = i === 0 ? MAP_STROKE.wound   : i === 1 ? MAP_STROKE.fixer   : MAP_STROKE.skeptic;
            const endB = i === 0 ? MAP_STROKE.fixer   : i === 1 ? MAP_STROKE.skeptic : MAP_STROKE.wound;
            return (
              <Line
                key={i}
                p1={vec(a.x, a.y)}
                p2={vec(b.x, b.y)}
                style="stroke"
                strokeWidth={2.5}
              >
                <LinearGradient
                  start={vec(a.x, a.y)}
                  end={vec(b.x, b.y)}
                  colors={[endA + 'AA', endB + 'AA']}
                />
              </Line>
            );
          })}
        </Group>

        {/* MANAGERS — dashed green ring on the left */}
        <DashedRing node={managers} r={managersR} stroke={MAP_STROKE.managers} rgb={MAP_RGB.managers} />

        {/* FIREFIGHTERS — dashed orange ring on the right */}
        <DashedRing node={firefighters} r={firefightersR} stroke={MAP_STROKE.firefighters} rgb={MAP_RGB.firefighters} />

        {/* SELF-LIKE — brighter lavender diamond below Self */}
        <SelfLikeDiamond d={selfLike} stroke={MAP_STROKE.selfLike} rgb={MAP_RGB.selfLike} />

        {/* SELF — breathing lavender circle at center */}
        <GlowCircle cx={self.x} cy={self.y} r={selfR} stroke={MAP_STROKE.self} rgb={MAP_RGB.self} gradientR={self.r * 2.2} strokeWidth={3} />

        {/* WOUND — red circle at top, gently pulsing */}
        <GlowCircle cx={wound.x} cy={wound.y} r={woundR} stroke={MAP_STROKE.wound} rgb={MAP_RGB.wound} gradientR={wound.r * 2.0} strokeWidth={3.5} />

        {/* FIXER — amber circle at bottom-right */}
        <GlowCircle cx={fixer.x} cy={fixer.y} r={fixerR} stroke={MAP_STROKE.fixer} rgb={MAP_RGB.fixer} gradientR={fixer.r * 2.0} strokeWidth={3.5} />

        {/* SKEPTIC — blue circle at bottom-left */}
        <GlowCircle cx={skeptic.x} cy={skeptic.y} r={skepticR} stroke={MAP_STROKE.skeptic} rgb={MAP_RGB.skeptic} gradientR={skeptic.r * 2.0} strokeWidth={3.5} />
      </Canvas>

      {/* ===== TEXT LABELS ===== Rendered as RN <Text> overlays instead of Skia SkText
           so we don't need a font asset loaded. One label per node, centered on the
           node's geometry. pointerEvents=none so they never block the Pressable taps. */}
      <NodeLabel x={wound.x}         y={wound.y}        label="WOUND"        color={MAP_STROKE.wound} />
      <NodeLabel x={fixer.x}         y={fixer.y}        label="FIXER"        color={MAP_STROKE.fixer} />
      <NodeLabel x={skeptic.x}       y={skeptic.y}      label="SKEPTIC"      color={MAP_STROKE.skeptic} />
      <NodeLabel x={self.x}          y={self.y}         label="SELF"         color={MAP_STROKE.self} />
      {/* Side-ring labels sit on the center of their circle — no horizontal
          offset. MANAGERS fits comfortably. FIREFIGHTERS uses a smaller font
          so the longer word never clips on narrow screens. */}
      <NodeLabel x={managers.x}      y={managers.y}     label="MANAGERS"     color={MAP_STROKE.managers}     width={112} />
      <NodeLabel x={firefighters.x}  y={firefighters.y} label="FIREFIGHTERS" color={MAP_STROKE.firefighters} width={112} small />
      <NodeLabel x={selfLike.cx}     y={selfLike.cy + selfLike.size + 18} label="SELF-LIKE" color={MAP_STROKE.selfLike} />

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
// `width` defaults to 90; long labels (FIREFIGHTERS) pass their own.
// `small` flag drops to 8px font so 12-char labels fit without clipping.
function NodeLabel({
  x, y, label, color, width = 90, small,
}: { x: number; y: number; label: string; color: string; width?: number; small?: boolean }) {
  const H = 18;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.label,
        { left: x - width / 2, top: y - H / 2, width, height: H },
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[styles.labelText, { color }, small && styles.labelTextSmall]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

// ---------- Skia drawing sub-components ----------

function GlowCircle({
  cx, cy, r, stroke, rgb, gradientR, strokeWidth,
}: {
  cx: number;
  cy: number;
  r: any;              // number or Skia animated value
  stroke: string;      // brighter hex for the ring
  rgb: string;         // "R,G,B" for rgba() gradient stops
  gradientR: number;
  strokeWidth: number;
}) {
  return (
    <Group>
      {/* Inner radial gradient fill — glows from center outward. Stops at
          0.35 alpha core → 0.10 mid → transparent edge give each node real
          depth rather than a flat ring with a dim core. */}
      <Circle cx={cx} cy={cy} r={gradientR}>
        <RadialGradient
          c={vec(cx, cy)}
          r={gradientR}
          colors={[
            `rgba(${rgb},0.35)`,
            `rgba(${rgb},0.10)`,
            `rgba(${rgb},0)`,
          ]}
        />
      </Circle>
      {/* Bold stroke ring with outer BlurMask — gives the node a soft halo
          that reads as light bleeding outward, not just a painted edge. */}
      <Circle cx={cx} cy={cy} r={r} color={stroke} style="stroke" strokeWidth={strokeWidth}>
        <BlurMask blur={8} style="outer" respectCTM={false} />
      </Circle>
      {/* Crisp on-top stroke so the outer blur doesn't soften the edge away. */}
      <Circle cx={cx} cy={cy} r={r} color={stroke} style="stroke" strokeWidth={strokeWidth} />
    </Group>
  );
}

function DashedRing({ node, r, stroke, rgb }: { node: GeomNode; r: any; stroke: string; rgb: string }) {
  return (
    <Group>
      {/* Inner glow — larger and stronger than before so the side-rings
          don't disappear against the background on darker phones. */}
      <Circle cx={node.x} cy={node.y} r={node.r * 1.4}>
        <RadialGradient
          c={vec(node.x, node.y)}
          r={node.r * 1.8}
          colors={[`rgba(${rgb},0.35)`, `rgba(${rgb},0.10)`, `rgba(${rgb},0)`]}
        />
      </Circle>
      {/* Dashed ring with outer blur halo. */}
      <Circle cx={node.x} cy={node.y} r={r} color={stroke} style="stroke" strokeWidth={3}>
        <BlurMask blur={7} style="outer" respectCTM={false} />
        <DashPathEffect intervals={[8, 4]} />
      </Circle>
      {/* Crisp dashed stroke on top of the blur. */}
      <Circle cx={node.x} cy={node.y} r={r} color={stroke} style="stroke" strokeWidth={3}>
        <DashPathEffect intervals={[8, 4]} />
      </Circle>
    </Group>
  );
}

function SelfLikeDiamond({ d, stroke, rgb }: { d: GeomDiamond; stroke: string; rgb: string }) {
  // Diamond built as a Path — easier than chaining four <Line>s.
  const path = Skia.Path.Make();
  path.moveTo(d.cx, d.cy - d.size);
  path.lineTo(d.cx + d.size, d.cy);
  path.lineTo(d.cx, d.cy + d.size);
  path.lineTo(d.cx - d.size, d.cy);
  path.close();
  return (
    <Group>
      {/* Inner glow behind the diamond */}
      <Circle cx={d.cx} cy={d.cy} r={d.size * 2.2}>
        <RadialGradient
          c={vec(d.cx, d.cy)}
          r={d.size * 2.5}
          colors={[`rgba(${rgb},0.35)`, `rgba(${rgb},0.10)`, `rgba(${rgb},0)`]}
        />
      </Circle>
      {/* Dim fill for the diamond interior */}
      <Path path={path} color={`rgba(${rgb},0.22)`} style="fill" />
      {/* Bold stroke with blur halo */}
      <Path path={path} color={stroke} style="stroke" strokeWidth={3}>
        <BlurMask blur={6} style="outer" respectCTM={false} />
      </Path>
      <Path path={path} color={stroke} style="stroke" strokeWidth={3} />
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
    // Bumped from 9 → 11 and font weight to '800' (extrabold on iOS). Shadow
    // is doubled so the letters stay legible when they cross the ring stroke.
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 },
  },
  labelTextSmall: { fontSize: 9.5, letterSpacing: 1.0 },
});
