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
  withSequence,
  withDelay,
  Easing,
  useDerivedValue,
} from 'react-native-reanimated';
import { colors, fonts } from '../../constants/theme';
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
  /** Specific name of the currently-active part. Only set for
   *  manager / firefighter activations (e.g. "perfectionist"). When
   *  present, the matching ring renders this name in place of the
   *  static MANAGERS / FIREFIGHTERS label so the user can see WHICH
   *  protector just activated. Triangle nodes ignore this. */
  activeLabel?: string | null;
  /** Total managers in the user's parts table. Drives the small
   *  count badge that sits at the top-right corner of the managers
   *  ring whenever count > 1. Lets the map stay clean while telling
   *  the user "you have N managers — tap to see them all." */
  managerCount?: number;
  /** Same as managerCount, for the firefighters ring. */
  firefighterCount?: number;
  onNodeTap?: (k: NodeKey) => void;
};

export function InnerMapCanvas({
  geom, activePart, activeLabel, managerCount = 0, firefighterCount = 0, onNodeTap,
}: Props) {
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

  // Per-leg pulse intensities. 0 = dim (normal breath), 1 = fully lit in the
  // matched part's color. Envelope per the spec: brighten 300ms → hold 500ms
  // → fade 800ms. We drive all three legs from shared values so the Skia
  // paints can react without a React re-render.
  const legWoundFixer   = useSharedValue(0);  // Wound ↔ Fixer edge
  const legWoundSkeptic = useSharedValue(0);  // Wound ↔ Skeptic edge
  const legFixerSkeptic = useSharedValue(0);  // Fixer ↔ Skeptic (bottom) edge

  // Ripple state. rippleCx/cy lock to the activated node; rippleRadius and
  // rippleAlpha drive the expanding circle. When a new part activates we
  // reset and play the ripple once.
  const rippleCx = useSharedValue(0);
  const rippleCy = useSharedValue(0);
  const rippleBaseR = useSharedValue(0);       // starting radius (= node.r)
  const rippleProgress = useSharedValue(0);    // 0→1 over 600ms
  const rippleColor = useSharedValue('rgba(255,255,255,0)');

  // React to activePart — spring the matching node up, snap the others back.
  useEffect(() => {
    (Object.keys(scaleByKey) as NodeKey[]).forEach((k) => {
      const target = k === activePart ? 1.25 : 1;
      scaleByKey[k].value = withSpring(target, { damping: 12, stiffness: 110 });
    });

    if (!activePart) return;

    // Envelope used by every leg highlight — ramp up, hold, fade back.
    const pulseEnvelope = () => withSequence(
      withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) }),
      withDelay(500, withTiming(0, { duration: 800, easing: Easing.in(Easing.ease) })),
    );

    // Which legs should light up for this part? Wound→Fixer when Fixer
    // activates, Wound→Skeptic when Skeptic activates, all three (purple)
    // when Self activates. Other nodes don't light any leg.
    if (activePart === 'fixer') {
      legWoundFixer.value = pulseEnvelope();
    } else if (activePart === 'skeptic') {
      legWoundSkeptic.value = pulseEnvelope();
    } else if (activePart === 'self') {
      legWoundFixer.value   = pulseEnvelope();
      legWoundSkeptic.value = pulseEnvelope();
      legFixerSkeptic.value = pulseEnvelope();
    }

    // Trigger the ripple from the activated node's center. Use the brighter
    // MAP_STROKE palette so the ripple color matches the glow palette.
    const nodeCenter = (() => {
      switch (activePart) {
        case 'wound':       return { x: geom.wound.x,       y: geom.wound.y,       r: geom.wound.r,       color: MAP_STROKE.wound };
        case 'fixer':       return { x: geom.fixer.x,       y: geom.fixer.y,       r: geom.fixer.r,       color: MAP_STROKE.fixer };
        case 'skeptic':     return { x: geom.skeptic.x,     y: geom.skeptic.y,     r: geom.skeptic.r,     color: MAP_STROKE.skeptic };
        case 'self':        return { x: geom.self.x,        y: geom.self.y,        r: geom.self.r,        color: MAP_STROKE.self };
        case 'self-like':   return { x: geom.selfLike.cx,   y: geom.selfLike.cy,   r: geom.selfLike.size, color: MAP_STROKE.selfLike };
        case 'manager':     return { x: geom.managers.x,    y: geom.managers.y,    r: geom.managers.r,    color: MAP_STROKE.managers };
        case 'firefighter': return { x: geom.firefighters.x, y: geom.firefighters.y, r: geom.firefighters.r, color: MAP_STROKE.firefighters };
        default: return null;
      }
    })();
    if (nodeCenter) {
      rippleCx.value = nodeCenter.x;
      rippleCy.value = nodeCenter.y;
      rippleBaseR.value = nodeCenter.r;
      rippleColor.value = nodeCenter.color;
      rippleProgress.value = 0;
      rippleProgress.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.ease) });
    }
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

  // Ripple derived values.
  // Radius grows from nodeR → 2×nodeR over the 0→1 progress.
  // Alpha drops from 0.6 → 0 across the same span.
  const rippleR = useDerivedValue(
    () => rippleBaseR.value * (1 + rippleProgress.value),
    [rippleBaseR, rippleProgress],
  );
  const rippleOpacity = useDerivedValue(
    () => 0.6 * (1 - rippleProgress.value),
    [rippleProgress],
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
            backbone reads with depth rather than a flat grey. Legs also pulse
            lit when a part is detected: Wound↔Fixer brightens when Fixer
            activates, Wound↔Skeptic when Skeptic, all three when Self. */}
        <Group opacity={triangleOpacity}>
          <TriangleLeg
            a={triangle[0]} b={triangle[1]}
            baseA={MAP_STROKE.wound + 'AA'} baseB={MAP_STROKE.fixer + 'AA'}
            pulse={legWoundFixer} pulseColor="#F0C070"
          />
          <TriangleLeg
            a={triangle[1]} b={triangle[2]}
            baseA={MAP_STROKE.fixer + 'AA'} baseB={MAP_STROKE.skeptic + 'AA'}
            pulse={legFixerSkeptic} pulseColor="#D4B8E8"
          />
          <TriangleLeg
            a={triangle[2]} b={triangle[3]}
            baseA={MAP_STROKE.skeptic + 'AA'} baseB={MAP_STROKE.wound + 'AA'}
            pulse={legWoundSkeptic} pulseColor="#90C8E8"
          />
        </Group>

        {/* RIPPLE — expanding circle from an activated node. Drawn BEFORE the
            nodes so it feels like the node pushes the ripple outward. Color
            is driven by the shared value set when activePart changes. */}
        <Circle
          cx={rippleCx}
          cy={rippleCy}
          r={rippleR}
          color={rippleColor}
          style="stroke"
          strokeWidth={2.5}
          opacity={rippleOpacity}
        />


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
          so the longer word never clips on narrow screens.
          When a SPECIFIC manager / firefighter has just activated, the
          ring's label switches to that part's name (uppercased to match
          the typographic register) so the user can see WHICH one fired.
          Otherwise the generic MANAGERS / FIREFIGHTERS label stays. */}
      {(() => {
        const managersActive = activePart === 'manager' && !!activeLabel;
        const text = managersActive ? activeLabel!.toUpperCase() : 'MANAGERS';
        const long = text.length >= 12;
        return (
          <NodeLabel
            x={managers.x} y={managers.y}
            label={text}
            color={MAP_STROKE.managers}
            width={Math.max(112, text.length * 8)}
            small={long}
          />
        );
      })()}
      {(() => {
        const ffActive = activePart === 'firefighter' && !!activeLabel;
        const text = ffActive ? activeLabel!.toUpperCase() : 'FIREFIGHTERS';
        return (
          <NodeLabel
            x={firefighters.x} y={firefighters.y}
            label={text}
            color={MAP_STROKE.firefighters}
            width={Math.max(112, text.length * 8)}
            small
          />
        );
      })()}
      <NodeLabel x={selfLike.cx}     y={selfLike.cy + selfLike.size + 18} label="SELF-LIKE" color={MAP_STROKE.selfLike} />

      {/* COUNT BADGES — small "N" pill at the top-right of each side
          ring when the user has more than one manager / firefighter.
          Hidden while that ring is showing an active part name (the
          name is enough signal in that moment). Tapping the ring
          itself opens the full folder; the badge is purely a count
          indicator and shares the underlying TapTarget hit zone. */}
      {managerCount > 1 && !(activePart === 'manager' && !!activeLabel) ? (
        <CountBadge
          x={managers.x + managers.r * 0.72}
          y={managers.y - managers.r * 0.72}
          count={managerCount}
          color={MAP_STROKE.managers}
        />
      ) : null}
      {firefighterCount > 1 && !(activePart === 'firefighter' && !!activeLabel) ? (
        <CountBadge
          x={firefighters.x + firefighters.r * 0.72}
          y={firefighters.y - firefighters.r * 0.72}
          count={firefighterCount}
          color={MAP_STROKE.firefighters}
        />
      ) : null}

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

// Small "N" pill positioned at the top-right shoulder of a side-ring
// node. Pure visual indicator — the parent <TapTarget> covers the
// whole ring including this corner, so tapping the badge opens the
// folder just like tapping the ring itself. pointerEvents='none' so
// the badge never shadows the tap layer.
function CountBadge({
  x, y, count, color,
}: { x: number; y: number; count: number; color: string }) {
  const SIZE = 22;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.countBadge,
        {
          left: x - SIZE / 2,
          top: y - SIZE / 2,
          width: SIZE,
          height: SIZE,
          borderColor: color,
        },
      ]}
    >
      <Text allowFontScaling={false} style={[styles.countBadgeText, { color }]} numberOfLines={1}>
        {count > 99 ? '99+' : String(count)}
      </Text>
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

// A single triangle leg rendered as two stacked lines: the base gradient
// stroke (always visible) plus a pulse overlay whose opacity is driven by a
// shared value. When a connected part is detected in conversation the pulse
// ramps up over 300ms, holds 500ms, then fades over 800ms — done via
// withSequence in the parent. The pulse color + stroke width are a bit
// stronger than the base so the leg reads as "lit" during the hold phase.
function TriangleLeg({
  a, b, baseA, baseB, pulse, pulseColor,
}: {
  a: { x: number; y: number };
  b: { x: number; y: number };
  baseA: string;
  baseB: string;
  pulse: ReturnType<typeof useSharedValue<number>>;
  pulseColor: string;
}) {
  const overlayOpacity = useDerivedValue(() => pulse.value, [pulse]);
  return (
    <Group>
      <Line p1={vec(a.x, a.y)} p2={vec(b.x, b.y)} style="stroke" strokeWidth={2.5}>
        <LinearGradient
          start={vec(a.x, a.y)}
          end={vec(b.x, b.y)}
          colors={[baseA, baseB]}
        />
      </Line>
      {/* Bright pulse overlay — only visible during the highlight envelope. */}
      <Line
        p1={vec(a.x, a.y)}
        p2={vec(b.x, b.y)}
        color={pulseColor}
        style="stroke"
        strokeWidth={3.5}
        opacity={overlayOpacity}
      />
    </Group>
  );
}

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
    // Serif (Cormorant Garamond SemiBold) — adds elegance to the node
    // labels so the map reads as considered typography rather than UI chrome.
    // Shadow keeps the letters legible where they cross the ring stroke.
    fontFamily: fonts.serifBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 },
  },
  labelTextSmall: { fontSize: 10.5, letterSpacing: 0.8 },
  countBadge: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1.2,
    backgroundColor: 'rgba(20,19,26,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    // Soft shadow for depth so the badge reads as floating above the
    // ring rather than painted on it.
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  countBadgeText: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
});
