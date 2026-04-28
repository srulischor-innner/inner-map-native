// Per-slide Skia illustration. Every Guide slide has its own unique visual —
// no two slides share the same drawing. The design language mirrors the map
// (glowing circles, triangle legs, diamond, atmospheric glows, dashed rings)
// but each concept is composed differently so the slide carries meaning
// through its shape, not just its caption.
//
// Animated visuals use Reanimated shared values + useDerivedValue so Skia
// paints read them on the UI thread (no React re-renders per frame).

import React, { useEffect } from 'react';
import {
  Canvas, Circle, Group, Path, RadialGradient, LinearGradient, Skia, Line, Rect, DashPathEffect, vec,
} from '@shopify/react-native-skia';
import {
  useSharedValue, withRepeat, withTiming, withSequence, withDelay,
  Easing, useDerivedValue,
} from 'react-native-reanimated';
import { colors } from '../../constants/theme';
import type { NodeVisualKind } from '../../utils/guideContent';

type Props = { kind: NodeVisualKind; size?: number };

export function GuideNodeVisual({ kind, size = 140 }: Props) {
  const W = size;
  const H = size;
  const cx = W / 2;
  const cy = H / 2;

  return (
    <Canvas style={{ width: W, height: H }}>
      {kind === 'intro'                ? <IntroRings cx={cx} cy={cy} W={W} /> : null}
      {kind === 'everyone'             ? <EveryoneRing cx={cx} cy={cy} W={W} /> : null}
      {kind === 'wound'                ? <WoundBreathing cx={cx} cy={cy} W={W} /> : null}
      {kind === 'woundLayers'          ? <WoundLayers cx={cx} cy={cy} W={W} /> : null}
      {kind === 'fixer'                ? <FixerUpward cx={cx} cy={cy} W={W} H={H} /> : null}
      {kind === 'skeptic'              ? <SkepticWeighted cx={cx} cy={cy} W={W} H={H} /> : null}
      {kind === 'tension'              ? <MiniTriangle W={W} H={H} /> : null}
      {kind === 'selfLike'             ? <SelfLikeVisual cx={cx} cy={cy} W={W} /> : null}
      {kind === 'managersFirefighters' ? <MgrFFPair W={W} H={H} /> : null}
      {kind === 'self'                 ? <SelfSteady cx={cx} cy={cy} W={W} /> : null}
      {kind === 'fullmap'              ? <MiniFullMap W={W} H={H} /> : null}
      {kind === 'seed'                 ? <Seed W={W} H={H} /> : null}
      {kind === 'responsibility'       ? <Responsibility W={W} H={H} /> : null}
      {kind === 'unblending'           ? <Unblending cx={cx} cy={cy} W={W} /> : null}
      {kind === 'release'              ? <Release cx={cx} cy={cy} W={W} /> : null}
      {kind === 'newCreation'          ? <NewCreation W={W} H={H} /> : null}
      {kind === 'mapDrawing'           ? <MapDrawing W={W} H={H} /> : null}
      {kind === 'chatBubble'           ? <ChatBubbleListening W={W} H={H} /> : null}
      {kind === 'nodeDetect'           ? <NodeDetect cx={cx} cy={cy} W={W} /> : null}
      {kind === 'privacy'              ? <PrivacyLock cx={cx} cy={cy} W={W} H={H} /> : null}
      {kind === 'readyToBegin'         ? <ReadyToBegin W={W} H={H} /> : null}
      {kind === 'windowOfTolerance'    ? <WindowOfTolerance W={W} H={H} /> : null}
      {kind === 'buildingCapacity'     ? <BuildingCapacity W={W} H={H} /> : null}
      {kind === 'twoTracks'            ? <TwoTracks W={W} H={H} /> : null}
      {kind === 'energyMoves'          ? <EnergyMoves W={W} H={H} /> : null}
      {kind === 'survivalMode'         ? <SurvivalMode W={W} H={H} /> : null}
      {kind === 'groundBuilding'       ? <GroundBuilding W={W} H={H} /> : null}
      {kind === 'triangleToCircle'     ? <TriangleToCircle W={W} H={H} /> : null}
      {/* 'noVisual' renders nothing inside the canvas. GuideSlide skips
          the Canvas wrapper entirely for this kind so a tiny placeholder
          spacer is shown instead — see GuideSlide.tsx. */}
    </Canvas>
  );
}

// =============================================================================
// CLOSING — triangle slowly morphs into a unified circle.
// Three colored nodes (wound red, fixer amber, skeptic blue) start at the
// triangle's vertices and migrate into positions on a single circle. As
// they move, their hard edges soften and their colors blend where they
// meet. Self at the center brightens last and steadiest. The whole loop
// is ~7s — slow on purpose. Felt sense over content.
// =============================================================================
function TriangleToCircle({ W, H }: { W: number; H: number }) {
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) * 0.32;

  // Single 0..1 progress that drives the morph. We hold at full circle
  // briefly before re-running so the arrival is felt, not blurred past.
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.cubic) }),
        withTiming(1, { duration: 1500 }), // hold at the circle
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.cubic) }),
      ),
      -1, false,
    );
  }, [p]);

  // Triangle anchor positions (0=top, then bottom-right, bottom-left going
  // clockwise to match the map's triangle).
  const triTop = { x: cx,                  y: cy - R };
  const triBR  = { x: cx + R * Math.sin(Math.PI * 2 / 3), y: cy - R * Math.cos(Math.PI * 2 / 3) };
  const triBL  = { x: cx - R * Math.sin(Math.PI * 2 / 3), y: cy - R * Math.cos(Math.PI * 2 / 3) };
  // Circle anchor positions — same three angles but with progress shifting
  // them onto a more even ring (still 0/120/240).
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

  // The three node positions interpolate from triangle to circle. In this
  // design the angles are already evenly spaced for both shapes, so the
  // morph is mostly a softening of the connecting lines + a brightening
  // of self — but we still drive the radii so they breathe slightly.
  const woundX = useDerivedValue(() => lerp(triTop.x, cx + R * Math.cos(-Math.PI / 2),       p.value), [p]);
  const woundY = useDerivedValue(() => lerp(triTop.y, cy + R * Math.sin(-Math.PI / 2),       p.value), [p]);
  const fixerX = useDerivedValue(() => lerp(triBR.x,  cx + R * Math.cos(Math.PI / 6),        p.value), [p]);
  const fixerY = useDerivedValue(() => lerp(triBR.y,  cy + R * Math.sin(Math.PI / 6),        p.value), [p]);
  const skepX  = useDerivedValue(() => lerp(triBL.x,  cx + R * Math.cos(Math.PI - Math.PI / 6), p.value), [p]);
  const skepY  = useDerivedValue(() => lerp(triBL.y,  cy + R * Math.sin(Math.PI - Math.PI / 6), p.value), [p]);

  // Triangle leg opacity fades to 0 as the unified circle ring fades in.
  const legOpacity   = useDerivedValue(() => 0.45 * (1 - p.value), [p]);
  const ringOpacity  = useDerivedValue(() => 0.35 * p.value, [p]);
  // Self brightens last + steadiest — only really lights up after the
  // morph is mostly complete.
  const selfOpacity  = useDerivedValue(() => 0.2 + 0.7 * Math.max(0, p.value - 0.4) / 0.6, [p]);
  const selfHaloR    = useDerivedValue(() => R * (0.18 + 0.05 * p.value), [p]);
  // Node radii grow gently as they soften — softening communicated via
  // a glowing halo rather than a hard outline.
  const nodeR        = useDerivedValue(() => R * (0.13 + 0.04 * p.value), [p]);
  const nodeHaloR    = useDerivedValue(() => R * (0.22 + 0.10 * p.value), [p]);

  return (
    <Group>
      {/* Triangle legs — fade out as the circle takes over. Three explicit
          lines connecting the (animated) node positions. */}
      <Line p1={vec(triTop.x, triTop.y)} p2={vec(triBR.x, triBR.y)} color={'#E6B47A'} strokeWidth={1} opacity={legOpacity} />
      <Line p1={vec(triBR.x, triBR.y)}   p2={vec(triBL.x, triBL.y)} color={'#E6B47A'} strokeWidth={1} opacity={legOpacity} />
      <Line p1={vec(triBL.x, triBL.y)}   p2={vec(triTop.x, triTop.y)} color={'#E6B47A'} strokeWidth={1} opacity={legOpacity} />

      {/* Unified perimeter circle — fades in as the triangle dissolves. */}
      <Circle cx={cx} cy={cy} r={R} color={'rgba(255,255,255,0.5)'} style={'stroke'} strokeWidth={0.8} opacity={ringOpacity} />

      {/* Wound — red */}
      <Circle cx={woundX} cy={woundY} r={nodeHaloR} opacity={0.45}>
        <RadialGradient c={vec(triTop.x, triTop.y)} r={R * 0.32} colors={['#FF555588', '#FF555500']} />
      </Circle>
      <Circle cx={woundX} cy={woundY} r={nodeR} color={'#FF5555'} opacity={0.95} />

      {/* Fixer — amber */}
      <Circle cx={fixerX} cy={fixerY} r={nodeHaloR} opacity={0.45}>
        <RadialGradient c={vec(triBR.x, triBR.y)} r={R * 0.32} colors={['#F0C07088', '#F0C07000']} />
      </Circle>
      <Circle cx={fixerX} cy={fixerY} r={nodeR} color={'#F0C070'} opacity={0.95} />

      {/* Skeptic — blue */}
      <Circle cx={skepX} cy={skepY} r={nodeHaloR} opacity={0.45}>
        <RadialGradient c={vec(triBL.x, triBL.y)} r={R * 0.32} colors={['#90C8E888', '#90C8E800']} />
      </Circle>
      <Circle cx={skepX} cy={skepY} r={nodeR} color={'#90C8E8'} opacity={0.95} />

      {/* Self at center — brightens last and steadiest. */}
      <Circle cx={cx} cy={cy} r={selfHaloR} opacity={selfOpacity}>
        <RadialGradient c={vec(cx, cy)} r={R * 0.3} colors={[colors.self + 'CC', colors.self + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={R * 0.06} color={colors.self} opacity={selfOpacity} />
    </Group>
  );
}

// =============================================================================
// 1. INTRO — expanding amber glow rings radiating outward from center
// =============================================================================
function IntroRings({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  // Three rings that EXPAND outward and fade as they go, then restart — a
  // classic "seeing widens" feel. We run one shared 0..1 progress and
  // derive three staggered phases so the rings ripple one after another.
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.out(Easing.ease) }), -1, false);
  }, [p]);
  // Three rings with phase offsets 0.0 / 0.33 / 0.66 — when one finishes,
  // the next is already half-way out.
  const r1 = useDerivedValue(() => W * (0.08 + 0.38 * ((p.value + 0.0) % 1)), [p, W]);
  const r2 = useDerivedValue(() => W * (0.08 + 0.38 * ((p.value + 0.33) % 1)), [p, W]);
  const r3 = useDerivedValue(() => W * (0.08 + 0.38 * ((p.value + 0.66) % 1)), [p, W]);
  const o1 = useDerivedValue(() => 0.7 * (1 - ((p.value + 0.0) % 1)), [p]);
  const o2 = useDerivedValue(() => 0.7 * (1 - ((p.value + 0.33) % 1)), [p]);
  const o3 = useDerivedValue(() => 0.7 * (1 - ((p.value + 0.66) % 1)), [p]);
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r1} color={colors.amber} style="stroke" strokeWidth={1} opacity={o1} />
      <Circle cx={cx} cy={cy} r={r2} color={colors.amber} style="stroke" strokeWidth={1.2} opacity={o2} />
      <Circle cx={cx} cy={cy} r={r3} color={colors.amber} style="stroke" strokeWidth={1.4} opacity={o3} />
      {/* Steady core at center — the thing emitting the ripples */}
      <Circle cx={cx} cy={cy} r={W * 0.08}>
        <RadialGradient c={vec(cx, cy)} r={W * 0.1} colors={[colors.amber + 'CC', colors.amber + '22']} />
      </Circle>
    </Group>
  );
}

// =============================================================================
// 2. EVERYONE — ten dim circles in a ring, one faint center. All the same.
// =============================================================================
function EveryoneRing({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const count = 10;
  const ringR = W * 0.35;
  const dotR = W * 0.055;
  // A sweeping wave of light travels around the ring. `phase` is 0..1 and
  // represents which dot is "lit" right now. Each dot's opacity is computed
  // from its distance to phase so neighbors glow a little too — a soft
  // trailing halo rather than a hard spotlight.
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1, false);
  }, [phase]);

  return (
    <EveryoneDots cx={cx} cy={cy} W={W} count={count} ringR={ringR} dotR={dotR} phase={phase} />
  );
}

function EveryoneDots({
  cx, cy, W, count, ringR, dotR, phase,
}: {
  cx: number; cy: number; W: number; count: number; ringR: number; dotR: number;
  phase: ReturnType<typeof useSharedValue<number>>;
}) {
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(t) * ringR;
    const y = cy + Math.sin(t) * ringR;
    items.push(
      <EveryoneDot key={i} x={x} y={y} dotR={dotR} index={i} count={count} phase={phase} />,
    );
  }
  return (
    <Group>
      {items}
      {/* Faint red core — the shared wound everyone carries hidden inside. */}
      <Circle cx={cx} cy={cy} r={W * 0.06} color={colors.wound} style="stroke" strokeWidth={1} opacity={0.4} />
    </Group>
  );
}

function EveryoneDot({
  x, y, dotR, index, count, phase,
}: {
  x: number; y: number; dotR: number; index: number; count: number;
  phase: ReturnType<typeof useSharedValue<number>>;
}) {
  // Each dot's "lit-ness" — 1 when the wave is exactly on it, fading with
  // distance on either side. Wrapped 0..1 so the wave loops seamlessly.
  // We pull the raw 0..1 lit value out separately so we can drive both
  // the group opacity (the soft amber halo) AND the inner fill alpha,
  // giving each lit dot a noticeably warmer center as the wave passes.
  const lit = useDerivedValue(() => {
    const normalized = index / count;
    let d = Math.abs((phase.value - normalized + 1) % 1);
    if (d > 0.5) d = 1 - d;
    return Math.max(0, 1 - d * 3.5);
  }, [phase, index, count]);
  // Group opacity fades the whole dot up/down with the wave.
  const groupOp = useDerivedValue(() => 0.4 + 0.6 * lit.value, [lit]);
  // Inner fill alpha is much more dramatic — dots far from the wave are
  // a faint amber outline, the lit dot is a glowing amber core.
  const fillOp = useDerivedValue(() => 0.15 + 0.85 * lit.value, [lit]);
  return (
    <Group opacity={groupOp}>
      {/* Soft amber halo. The radial gradient brightens at the dot's center
          and fades to transparent — reads as warm light, not a flat circle. */}
      <Circle cx={x} cy={y} r={dotR * 1.9} opacity={0.55}>
        <RadialGradient c={vec(x, y)} r={dotR * 2} colors={['#E6B47AAA', '#E6B47A00']} />
      </Circle>
      {/* Amber fill — opacity drives "is this dot lit right now?". */}
      <Circle cx={x} cy={y} r={dotR} color="#E6B47A" opacity={fillOp} />
      {/* Steady amber outline so unlit dots still read as part of the ring. */}
      <Circle cx={x} cy={y} r={dotR} color="#E6B47A" style="stroke" strokeWidth={1.2} opacity={0.6} />
    </Group>
  );
}

// =============================================================================
// 3. WOUND — single red circle, slow breathing pulse
// =============================================================================
function WoundBreathing({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  // More dramatic breath — the inhale brightens and swells further so the
  // wound reads as a living thing rather than a static icon.
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.2, { duration: 3400, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [pulse]);
  const r = W * 0.28;
  const haloOpacity = useDerivedValue(() => 0.35 + 0.55 * Math.min(1, pulse.value), [pulse]);
  const haloR = useDerivedValue(() => r * (1.9 + 0.25 * (pulse.value - 0.55)), [pulse]);
  const coreR = useDerivedValue(() => r * (0.45 + 0.12 * (pulse.value - 0.55)), [pulse]);
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={haloR} opacity={haloOpacity}>
        <RadialGradient c={vec(cx, cy)} r={r * 2.2} colors={[colors.wound + 'CC', colors.wound + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={colors.wound} style="stroke" strokeWidth={3} />
      <Circle cx={cx} cy={cy} r={coreR} color={colors.wound + '55'} style="fill" />
    </Group>
  );
}

// =============================================================================
// 4. WOUND LAYERS — wound circle with two distinct visible rings:
//    outer thin ring (the story layer) + inner radial gradient (the feeling)
// =============================================================================
function WoundLayers({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const inner = W * 0.18;
  const outer = W * 0.34;
  // Two rhythms — the inner "feeling" layer breathes faster than the outer
  // "story" layer. Watching them drift in and out of phase reads as two
  // distinct processes running in the same system.
  const innerP = useSharedValue(0.5);
  const outerP = useSharedValue(0.5);
  useEffect(() => {
    innerP.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }), -1, true);
    outerP.value = withRepeat(withTiming(1, { duration: 4600, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [innerP, outerP]);
  const innerOpacity = useDerivedValue(() => 0.45 + 0.45 * innerP.value, [innerP]);
  const outerOpacity = useDerivedValue(() => 0.3 + 0.5 * outerP.value, [outerP]);
  return (
    <Group>
      {/* Outer story ring — slower, dashed "narrative" layer. */}
      <Group opacity={outerOpacity}>
        <Circle cx={cx} cy={cy} r={outer} color={colors.wound} style="stroke" strokeWidth={1.2}>
          <DashPathEffect intervals={[5, 5]} />
        </Circle>
      </Group>
      {/* Inner felt layer — faster, solid gradient glow filling inward. */}
      <Group opacity={innerOpacity}>
        <Circle cx={cx} cy={cy} r={inner * 1.9}>
          <RadialGradient c={vec(cx, cy)} r={inner * 2}
            colors={[colors.wound + 'CC', colors.wound + '33', colors.wound + '00']} />
        </Circle>
      </Group>
      <Circle cx={cx} cy={cy} r={inner} color={colors.wound} style="stroke" strokeWidth={2.5} />
    </Group>
  );
}

// =============================================================================
// 5. FIXER — amber circle with three short upward lines above it
// =============================================================================
function FixerUpward({ cx, cy, W, H }: { cx: number; cy: number; W: number; H: number }) {
  const r = W * 0.24;
  const baseY = cy + H * 0.12;
  const lineStartY = baseY - r - 4;          // where lines emerge from the circle
  const lineTravel = H * 0.25;                // how far they rise before fading
  // Three staggered shared values — each line's progress 0..1 runs
  // continuously on its own phase so they feel like rising energy, not
  // a synchronized heartbeat.
  const p0 = useSharedValue(0);
  const p1 = useSharedValue(0.33);
  const p2 = useSharedValue(0.66);
  useEffect(() => {
    p0.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear }), -1, false);
    p1.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear }), -1, false);
    p2.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear }), -1, false);
  }, [p0, p1, p2]);
  const xs = [cx - W * 0.12, cx, cx + W * 0.12];
  const phases = [p0, p1, p2];
  return (
    <Group>
      <Circle cx={cx} cy={baseY} r={r * 1.9} opacity={0.6}>
        <RadialGradient c={vec(cx, baseY)} r={r * 2} colors={[colors.fixer + 'AA', colors.fixer + '00']} />
      </Circle>
      <Circle cx={cx} cy={baseY} r={r} color={colors.fixer} style="stroke" strokeWidth={3} />
      <Circle cx={cx} cy={baseY} r={r * 0.5} color={colors.fixer + '33'} style="fill" />
      {xs.map((x, i) => (
        <RisingLine
          key={i}
          x={x}
          startY={lineStartY}
          travel={lineTravel}
          phase={phases[i]}
        />
      ))}
    </Group>
  );
}

function RisingLine({
  x, startY, travel, phase,
}: {
  x: number; startY: number; travel: number;
  phase: ReturnType<typeof useSharedValue<number>>;
}) {
  // Each line is short (travel/3) but its top edge rides up with phase from
  // startY → startY - travel, fading opacity as it nears the top.
  const len = travel / 3;
  const top = useDerivedValue(() => startY - travel * phase.value, [phase, startY, travel]);
  const bottom = useDerivedValue(() => Math.min(startY, top.value + len), [top, startY, len]);
  const p1 = useDerivedValue(() => vec(x, bottom.value), [bottom, x]);
  const p2 = useDerivedValue(() => vec(x, top.value), [top, x]);
  const opacity = useDerivedValue(() => {
    // Bell curve: 0 at either end, peaks around 0.5.
    const t = phase.value;
    return Math.max(0, Math.min(1, 1 - Math.abs(t - 0.5) * 2));
  }, [phase]);
  return (
    <Line p1={p1} p2={p2} color={colors.fixer} strokeWidth={2.5} style="stroke" opacity={opacity} />
  );
}

// =============================================================================
// 6. SKEPTIC — blue circle with a heavy horizontal line below it
// =============================================================================
function SkepticWeighted({ cx, cy, W, H }: { cx: number; cy: number; W: number; H: number }) {
  const r = W * 0.24;
  const cy2 = cy - H * 0.08;
  const restY = cy + H * 0.3;
  const sinkMax = H * 0.05;
  const lineLen = W * 0.55;
  // Weight bar slowly sinks further down, then resets — gravity pulling.
  const sink = useSharedValue(0);
  useEffect(() => {
    sink.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 600,  easing: Easing.out(Easing.ease) }),
      ),
      -1, false,
    );
  }, [sink]);
  const y = useDerivedValue(() => restY + sinkMax * sink.value, [sink, restY, sinkMax]);
  const p1 = useDerivedValue(() => vec(cx - lineLen / 2, y.value), [y, cx, lineLen]);
  const p2 = useDerivedValue(() => vec(cx + lineLen / 2, y.value), [y, cx, lineLen]);
  return (
    <Group>
      <Circle cx={cx} cy={cy2} r={r * 1.9} opacity={0.55}>
        <RadialGradient c={vec(cx, cy2)} r={r * 2} colors={[colors.skeptic + 'AA', colors.skeptic + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy2} r={r} color={colors.skeptic} style="stroke" strokeWidth={3} />
      <Circle cx={cx} cy={cy2} r={r * 0.5} color={colors.skeptic + '33'} style="fill" />
      <Line p1={p1} p2={p2} color={colors.skeptic} strokeWidth={3} style="stroke" />
    </Group>
  );
}

// =============================================================================
// 7. TENSION — mini triangle with atmospheric glow
// =============================================================================
function MiniTriangle({ W, H }: { W: number; H: number }) {
  const apex = { x: W / 2, y: H * 0.18 };
  const left = { x: W * 0.14, y: H * 0.82 };
  const right = { x: W * 0.86, y: H * 0.82 };
  const nodeR = W * 0.1;
  const atmY = (left.y + right.y) / 2 - H * 0.08;

  // The atmospheric glow shifts horizontally — leaning toward Fixer (right),
  // then toward Skeptic (left) — as the "tension" rocks back and forth.
  // Oscillates -1..+1 over a 5s cycle.
  const lean = useSharedValue(0);
  useEffect(() => {
    lean.value = withRepeat(
      withSequence(
        withTiming(1,  { duration: 2500, easing: Easing.inOut(Easing.ease) }),
        withTiming(-1, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1, false,
    );
  }, [lean]);
  const atmCx = useDerivedValue(() => W / 2 + (W * 0.18) * lean.value, [lean, W]);
  const atmCenter = useDerivedValue(() => vec(atmCx.value, atmY), [atmCx, atmY]);
  return (
    <Group>
      <Group opacity={0.55}>
        <Circle cx={atmCx} cy={atmY} r={W * 0.36}>
          <RadialGradient c={atmCenter} r={W * 0.42}
            colors={['rgba(177,156,217,0.55)', 'rgba(177,156,217,0)']} />
        </Circle>
      </Group>
      <Line p1={vec(apex.x, apex.y)} p2={vec(left.x, left.y)}   color="#6a6a9a" strokeWidth={1.4} style="stroke" />
      <Line p1={vec(apex.x, apex.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1.4} style="stroke" />
      <Line p1={vec(left.x, left.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1.4} style="stroke" />
      <MiniNode cx={apex.x}  cy={apex.y}  r={nodeR} color={colors.wound} />
      <MiniNode cx={right.x} cy={right.y} r={nodeR} color={colors.fixer} />
      <MiniNode cx={left.x}  cy={left.y}  r={nodeR} color={colors.skeptic} />
    </Group>
  );
}

// =============================================================================
// 8. SELF-LIKE — lavender diamond, dimmer than Self, in the middle ground
// =============================================================================
function SelfLikeVisual({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const size = W * 0.26;
  const p = Skia.Path.Make();
  p.moveTo(cx, cy - size);
  p.lineTo(cx + size, cy);
  p.lineTo(cx, cy + size);
  p.lineTo(cx - size, cy);
  p.close();
  // Rotate ±6° back and forth — "something trying to orient itself".
  const rot = useSharedValue(-0.1);
  useEffect(() => {
    rot.value = withRepeat(
      withTiming(0.1, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [rot]);
  const transform = useDerivedValue(
    () => [{ translateX: cx }, { translateY: cy }, { rotate: rot.value }, { translateX: -cx }, { translateY: -cy }],
    [rot, cx, cy],
  );
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={size * 1.6} opacity={0.45}>
        <RadialGradient c={vec(cx, cy)} r={size * 1.8} colors={[colors.selfLike + '88', colors.selfLike + '00']} />
      </Circle>
      <Group transform={transform}>
        <Path path={p} color={colors.selfLike + '33'} style="fill" />
        <Path path={p} color={colors.selfLike} style="stroke" strokeWidth={2.5} />
      </Group>
    </Group>
  );
}

// =============================================================================
// 9. MANAGERS & FIREFIGHTERS — two dashed circles, each with 2-3 small dots
// =============================================================================
function MgrFFPair({ W, H }: { W: number; H: number }) {
  const r = W * 0.19;
  const leftCx = W * 0.28;
  const rightCx = W * 0.72;
  const cy = H / 2;
  const managerDots = [
    { x: leftCx - r * 0.35, y: cy - r * 0.25 },
    { x: leftCx + r * 0.3,  y: cy + r * 0.15 },
    { x: leftCx,            y: cy + r * 0.45 },
  ];
  const ffDots = [
    { x: rightCx + r * 0.35, y: cy - r * 0.25 },
    { x: rightCx - r * 0.3,  y: cy + r * 0.15 },
    { x: rightCx,            y: cy + r * 0.45 },
  ];
  // Shared cycle 0..1; each dot's opacity is a bump centered at its own
  // slot in the cycle so they appear, glow, and fade in sequence — parts
  // being identified one by one.
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(withTiming(1, { duration: 3500, easing: Easing.linear }), -1, false);
  }, [phase]);
  return (
    <Group>
      <DashedRingAnimated cx={leftCx}  cy={cy} r={r} color={colors.managers}     dots={managerDots} phase={phase} offset={0} />
      <DashedRingAnimated cx={rightCx} cy={cy} r={r} color={colors.firefighters} dots={ffDots}      phase={phase} offset={0.5} />
    </Group>
  );
}

function DashedRingAnimated({
  cx, cy, r, color, dots, phase, offset,
}: {
  cx: number; cy: number; r: number; color: string;
  dots: { x: number; y: number }[];
  phase: ReturnType<typeof useSharedValue<number>>;
  offset: number;
}) {
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r} opacity={0.35}>
        <RadialGradient c={vec(cx, cy)} r={r * 1.7} colors={[color + '77', color + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={2}>
        <DashPathEffect intervals={[6, 3]} />
      </Circle>
      {dots.map((d, i) => (
        <SequentialDot key={i} x={d.x} y={d.y} color={color} index={i} count={dots.length} phase={phase} offset={offset} />
      ))}
    </Group>
  );
}

function SequentialDot({
  x, y, color, index, count, phase, offset,
}: {
  x: number; y: number; color: string; index: number; count: number;
  phase: ReturnType<typeof useSharedValue<number>>;
  offset: number;
}) {
  // Slot width. Each dot gets a 1/(count+1) window, and neighbouring dots
  // overlap slightly so the sequence feels continuous rather than clicky.
  const opacity = useDerivedValue(() => {
    const slot = 1 / (count + 1);
    const myCenter = slot * (index + 0.5);
    const t = (phase.value + offset) % 1;
    let d = Math.abs(t - myCenter);
    if (d > 0.5) d = 1 - d;
    // Bell curve: brightest at center of my slot, fades to 0 outside it.
    return Math.max(0, 1 - d * (count + 2));
  }, [phase, offset, index, count]);
  return <Circle cx={x} cy={y} r={2.8} color={color} style="fill" opacity={opacity} />;
}

// =============================================================================
// 10. SELF — purple, largest, steady, NO pulse. The stillness is the point.
// =============================================================================
function SelfSteady({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const r = W * 0.32;
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r * 2.2} opacity={0.6}>
        <RadialGradient c={vec(cx, cy)} r={r * 2.3} colors={[colors.self + 'CC', colors.self + '33', colors.self + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={colors.self} style="stroke" strokeWidth={3} />
      <Circle cx={cx} cy={cy} r={r * 0.55} color={colors.self + '33'} style="fill" />
    </Group>
  );
}

// =============================================================================
// 11. FULL MAP — compact rendering of everything breathing together
// =============================================================================
function MiniFullMap({ W, H }: { W: number; H: number }) {
  const apex = { x: W / 2, y: H * 0.14 };
  const right = { x: W * 0.82, y: H * 0.68 };
  const left = { x: W * 0.18, y: H * 0.68 };
  const center = { x: W / 2, y: H * 0.52 };
  const mgr = { x: W * 0.08, y: H * 0.4 };
  const ff = { x: W * 0.92, y: H * 0.4 };
  const diamond = { x: W / 2, y: H * 0.86, s: W * 0.06 };
  const atmY = (left.y + right.y) / 2 - H * 0.05;
  const nodeR = W * 0.07;

  // Per-node breath phases at different rates. Every node feels alive but
  // each on its own rhythm — the whole system interconnected, not in
  // lockstep. Atmosphere and triangle-line shimmer use their own cycles.
  const pWound  = useSharedValue(0.5);
  const pFixer  = useSharedValue(0.5);
  const pSkep   = useSharedValue(0.5);
  const pSelf   = useSharedValue(0.5);
  const pAtm    = useSharedValue(0);
  const pShim   = useSharedValue(0);
  useEffect(() => {
    pWound.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.ease) }), -1, true);
    pFixer.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }), -1, true);
    pSkep.value  = withRepeat(withTiming(1, { duration: 3800, easing: Easing.inOut(Easing.ease) }), -1, true);
    pSelf.value  = withRepeat(withTiming(1, { duration: 4600, easing: Easing.inOut(Easing.ease) }), -1, true);
    pAtm.value   = withRepeat(withTiming(1, { duration: 5200, easing: Easing.inOut(Easing.ease) }), -1, true);
    pShim.value  = withRepeat(withTiming(1, { duration: 3000, easing: Easing.linear }), -1, true);
  }, [pWound, pFixer, pSkep, pSelf, pAtm, pShim]);
  const atmOpacity  = useDerivedValue(() => 0.25 + 0.3 * pAtm.value, [pAtm]);
  const lineOpacity = useDerivedValue(() => 0.5 + 0.3 * pShim.value, [pShim]);
  return (
    <Group>
      <Group opacity={atmOpacity}>
        <Circle cx={W / 2} cy={atmY} r={W * 0.4}>
          <RadialGradient c={vec(W / 2, atmY)} r={W * 0.44} colors={['rgba(177,156,217,0.45)', 'rgba(177,156,217,0)']} />
        </Circle>
      </Group>
      <Group opacity={lineOpacity}>
        <Line p1={vec(apex.x, apex.y)} p2={vec(left.x, left.y)}   color="#8a8abc" strokeWidth={1} style="stroke" />
        <Line p1={vec(apex.x, apex.y)} p2={vec(right.x, right.y)} color="#8a8abc" strokeWidth={1} style="stroke" />
        <Line p1={vec(left.x, left.y)} p2={vec(right.x, right.y)} color="#8a8abc" strokeWidth={1} style="stroke" />
      </Group>
      <DashedRingWithDots cx={mgr.x} cy={mgr.y} r={nodeR * 1.2} color={colors.managers} />
      <DashedRingWithDots cx={ff.x}  cy={ff.y}  r={nodeR * 1.2} color={colors.firefighters} />
      <BreathingNode cx={center.x} cy={center.y} r={nodeR * 1.2} color={colors.self}    phase={pSelf} />
      <BreathingNode cx={apex.x}   cy={apex.y}   r={nodeR}       color={colors.wound}   phase={pWound} />
      <BreathingNode cx={right.x}  cy={right.y}  r={nodeR}       color={colors.fixer}   phase={pFixer} />
      <BreathingNode cx={left.x}   cy={left.y}   r={nodeR}       color={colors.skeptic} phase={pSkep} />
      <MiniDiamond cx={diamond.x} cy={diamond.y} size={diamond.s} />
    </Group>
  );
}

function BreathingNode({
  cx, cy, r, color, phase,
}: {
  cx: number; cy: number; r: number; color: string;
  phase: ReturnType<typeof useSharedValue<number>>;
}) {
  // Radius and halo opacity gently oscillate with the phase — all while
  // the core stroke stays put, so the node reads as "alive" not "squashing".
  const haloOpacity = useDerivedValue(() => 0.45 + 0.35 * phase.value, [phase]);
  const haloR = useDerivedValue(() => r * (1.8 + 0.3 * phase.value), [phase, r]);
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={haloR} opacity={haloOpacity}>
        <RadialGradient c={vec(cx, cy)} r={r * 2} colors={[color + 'AA', color + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={2.5} />
      <Circle cx={cx} cy={cy} r={r * 0.5} color={color + '33'} style="fill" />
    </Group>
  );
}

// =============================================================================
// 12. SEED — small circle bottom-center, thin line growing upward from it
// =============================================================================
function Seed({ W, H }: { W: number; H: number }) {
  const cx = W / 2;
  const seedCy = H * 0.8;
  const seedR = W * 0.06;
  // Line grows 0 → 1 upward from the seed, loops forever.
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2600, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 400 }),
      ),
      -1, false,
    );
  }, [grow]);
  const lineLen = H * 0.55;
  const topY = useDerivedValue(() => seedCy - seedR - lineLen * grow.value, [grow, seedCy, seedR, lineLen]);
  const p2 = useDerivedValue(() => vec(cx, topY.value), [cx, topY]);
  return (
    <Group>
      {/* Seed glow */}
      <Circle cx={cx} cy={seedCy} r={seedR * 1.8} opacity={0.6}>
        <RadialGradient c={vec(cx, seedCy)} r={seedR * 2} colors={[colors.amber + 'AA', colors.amber + '00']} />
      </Circle>
      <Circle cx={cx} cy={seedCy} r={seedR} color={colors.amber} style="stroke" strokeWidth={2} />
      {/* Growing stem */}
      <Line p1={vec(cx, seedCy - seedR)} p2={p2} color={colors.amber} strokeWidth={1.5} style="stroke" opacity={0.85} />
    </Group>
  );
}

// =============================================================================
// 13. RESPONSIBILITY — outside-in arrow fades as inside-out arrow brightens
// =============================================================================
function Responsibility({ W, H }: { W: number; H: number }) {
  const cy = H / 2;
  // Arrow 1: pointing RIGHT (external causes pushing in). Reads as old pattern.
  // Arrow 2: pointing LEFT-into-center from the right side (inside-out). Reads as shift.
  // We oscillate their opacities out-of-phase so one fades as the other brightens.
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [phase]);
  const outOpacity = useDerivedValue(() => 1 - phase.value, [phase]);
  const inOpacity  = useDerivedValue(() => 0.15 + 0.85 * phase.value, [phase]);

  // Outside-in arrow — horizontal shaft left→right, head at right tip.
  const outArrow = Skia.Path.Make();
  outArrow.moveTo(W * 0.12, cy - H * 0.12);
  outArrow.lineTo(W * 0.58, cy - H * 0.12);
  outArrow.moveTo(W * 0.52, cy - H * 0.12 - 6);
  outArrow.lineTo(W * 0.58, cy - H * 0.12);
  outArrow.lineTo(W * 0.52, cy - H * 0.12 + 6);

  // Inside-out arrow — reversed, right→left pointing into the self center
  const inArrow = Skia.Path.Make();
  inArrow.moveTo(W * 0.88, cy + H * 0.12);
  inArrow.lineTo(W * 0.42, cy + H * 0.12);
  inArrow.moveTo(W * 0.48, cy + H * 0.12 - 6);
  inArrow.lineTo(W * 0.42, cy + H * 0.12);
  inArrow.lineTo(W * 0.48, cy + H * 0.12 + 6);

  return (
    <Group>
      <Group opacity={outOpacity}>
        <Path path={outArrow} color={colors.creamDim} strokeWidth={2} style="stroke" />
      </Group>
      <Group opacity={inOpacity}>
        <Path path={inArrow} color={colors.amber} strokeWidth={2.5} style="stroke" />
      </Group>
    </Group>
  );
}

// =============================================================================
// 14. UNBLENDING — two overlapping circles that drift apart and back
// =============================================================================
function Unblending({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const r = W * 0.18;
  const spread = useSharedValue(0);
  useEffect(() => {
    spread.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [spread]);
  // Drift 0..maxGap apart horizontally. maxGap is a fraction of the radius so
  // the two circles always overlap or kiss at minimum — reads as "distinct but
  // related" rather than "separated forever".
  const maxGap = W * 0.18;
  const leftCx  = useDerivedValue(() => cx - maxGap * spread.value, [cx, spread]);
  const rightCx = useDerivedValue(() => cx + maxGap * spread.value, [cx, spread]);
  return (
    <Group>
      <Circle cx={leftCx}  cy={cy} r={r * 1.7} opacity={0.35}>
        <RadialGradient c={vec(cx - maxGap, cy)} r={r * 1.8}
          colors={[colors.self + '88', colors.self + '00']} />
      </Circle>
      <Circle cx={leftCx}  cy={cy} r={r} color={colors.self} style="stroke" strokeWidth={2.5} />
      <Circle cx={rightCx} cy={cy} r={r * 1.7} opacity={0.35}>
        <RadialGradient c={vec(cx + maxGap, cy)} r={r * 1.8}
          colors={[colors.wound + '88', colors.wound + '00']} />
      </Circle>
      <Circle cx={rightCx} cy={cy} r={r} color={colors.wound} style="stroke" strokeWidth={2.5} />
    </Group>
  );
}

// =============================================================================
// 15. RELEASE — wound circle with outer glow expanding outward and fading
// =============================================================================
function Release({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2200, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 0 }),
      ),
      -1, false,
    );
  }, [progress]);
  const coreR = W * 0.2;
  // Ring grows from coreR → coreR*2.5; opacity fades 0.7 → 0.
  const ringR = useDerivedValue(() => coreR * (1 + 1.5 * progress.value), [coreR, progress]);
  const ringOpacity = useDerivedValue(() => 0.7 * (1 - progress.value), [progress]);
  return (
    <Group>
      {/* Persistent core — the wound itself remains */}
      <Circle cx={cx} cy={cy} r={coreR * 1.8} opacity={0.45}>
        <RadialGradient c={vec(cx, cy)} r={coreR * 2} colors={[colors.wound + '99', colors.wound + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={coreR} color={colors.wound} style="stroke" strokeWidth={2.5} />
      <Circle cx={cx} cy={cy} r={coreR * 0.5} color={colors.wound + '33'} style="fill" />
      {/* Expanding-and-fading outer ring — "the tension dissolves" */}
      <Circle cx={cx} cy={cy} r={ringR} color={colors.wound} style="stroke" strokeWidth={1.5} opacity={ringOpacity} />
    </Group>
  );
}

// =============================================================================
// 16. NEW CREATION — full mini map with a golden glow emanating from Self
// =============================================================================
function NewCreation({ W, H }: { W: number; H: number }) {
  const apex = { x: W / 2, y: H * 0.14 };
  const right = { x: W * 0.82, y: H * 0.68 };
  const left = { x: W * 0.18, y: H * 0.68 };
  const center = { x: W / 2, y: H * 0.52 };
  const mgr = { x: W * 0.08, y: H * 0.4 };
  const ff = { x: W * 0.92, y: H * 0.4 };
  const diamond = { x: W / 2, y: H * 0.86, s: W * 0.06 };
  const nodeR = W * 0.07;

  // Golden radiance from Self — brightens and fades slowly so the "something
  // new emanating" reads unmistakably from that node.
  const glow = useSharedValue(0.55);
  useEffect(() => {
    glow.value = withRepeat(withTiming(1, { duration: 3800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [glow]);
  const radianceOpacity = useDerivedValue(() => glow.value, [glow]);
  return (
    <Group>
      {/* Golden radiance at Self — the "something new" */}
      <Group opacity={radianceOpacity}>
        <Circle cx={center.x} cy={center.y} r={W * 0.48}>
          <RadialGradient c={vec(center.x, center.y)} r={W * 0.52}
            colors={[colors.amberLight + 'AA', colors.amberLight + '22', colors.amberLight + '00']} />
        </Circle>
      </Group>
      {/* Structural lines */}
      <Line p1={vec(apex.x, apex.y)} p2={vec(left.x, left.y)}   color="#6a6a9a" strokeWidth={1} style="stroke" />
      <Line p1={vec(apex.x, apex.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1} style="stroke" />
      <Line p1={vec(left.x, left.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1} style="stroke" />
      <DashedRingWithDots cx={mgr.x} cy={mgr.y} r={nodeR * 1.2} color={colors.managers} />
      <DashedRingWithDots cx={ff.x}  cy={ff.y}  r={nodeR * 1.2} color={colors.firefighters} />
      {/* Self at center — drawn atop the radiance */}
      <Circle cx={center.x} cy={center.y} r={nodeR * 1.4} color={colors.self} style="stroke" strokeWidth={2.5} />
      <Circle cx={center.x} cy={center.y} r={nodeR * 0.7} color={colors.self + '55'} style="fill" />
      <MiniNode cx={apex.x}   cy={apex.y}   r={nodeR} color={colors.wound} />
      <MiniNode cx={right.x}  cy={right.y}  r={nodeR} color={colors.fixer} />
      <MiniNode cx={left.x}   cy={left.y}   r={nodeR} color={colors.skeptic} />
      <MiniDiamond cx={diamond.x} cy={diamond.y} size={diamond.s} />
    </Group>
  );
}

// =============================================================================
// Shared primitives
// =============================================================================
function MiniNode({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r * 1.9} opacity={0.65}>
        <RadialGradient c={vec(cx, cy)} r={r * 2} colors={[color + 'AA', color + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={2.5} />
      <Circle cx={cx} cy={cy} r={r * 0.5} color={color + '33'} style="fill" />
    </Group>
  );
}

function MiniDiamond({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const p = Skia.Path.Make();
  p.moveTo(cx, cy - size);
  p.lineTo(cx + size, cy);
  p.lineTo(cx, cy + size);
  p.lineTo(cx - size, cy);
  p.close();
  return (
    <Group>
      <Path path={p} color={colors.selfLike + '33'} style="fill" />
      <Path path={p} color={colors.selfLike} style="stroke" strokeWidth={2} />
    </Group>
  );
}

function DashedRingWithDots({
  cx, cy, r, color, dots,
}: {
  cx: number; cy: number; r: number; color: string; dots?: { x: number; y: number }[];
}) {
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r} opacity={0.35}>
        <RadialGradient c={vec(cx, cy)} r={r * 1.7} colors={[color + '77', color + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={2}>
        <DashPathEffect intervals={[6, 3]} />
      </Circle>
      {dots?.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y} r={2.5} color={color} style="fill" />
      ))}
    </Group>
  );
}

// ============================================================================
// === ONBOARDING-ORIENTED VISUALS ============================================
// New kinds added to power the onboarding flow + the Guide tab's WELCOME
// section. Each one tells a small story about a single concept.
// ============================================================================

// 1. MAP DRAWING — triangle legs draw themselves left→right one at a time,
//    then the three core nodes bloom in sequence. Restarts every ~5s.
function MapDrawing({ W, H }: { W: number; H: number }) {
  const apex  = { x: W / 2,    y: H * 0.18 };
  const right = { x: W * 0.86, y: H * 0.82 };
  const left  = { x: W * 0.14, y: H * 0.82 };
  const nodeR = W * 0.1;
  // Single 0..1 progress drives every stage so the loop stays in lockstep.
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 700 }), // hold full state
        withTiming(0, { duration: 600 }),  // fade back to start
      ),
      -1, false,
    );
  }, [p]);
  // Helper — fade-in opacity that ramps from 0 to 1 across [start..end] of p.
  const fade = (start: number, end: number) => useDerivedValue(() => {
    const v = p.value;
    if (v <= start) return 0;
    if (v >= end) return 1;
    return (v - start) / (end - start);
  }, [p]);
  const oLine1 = fade(0.00, 0.18); // wound → fixer
  const oLine2 = fade(0.18, 0.36); // fixer → skeptic
  const oLine3 = fade(0.36, 0.54); // skeptic → wound
  const oWound = fade(0.55, 0.70);
  const oFixer = fade(0.70, 0.85);
  const oSkep  = fade(0.85, 1.00);
  return (
    <Group>
      <Group opacity={oLine1}>
        <Line p1={vec(apex.x, apex.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1.5} style="stroke" />
      </Group>
      <Group opacity={oLine2}>
        <Line p1={vec(right.x, right.y)} p2={vec(left.x, left.y)} color="#6a6a9a" strokeWidth={1.5} style="stroke" />
      </Group>
      <Group opacity={oLine3}>
        <Line p1={vec(left.x, left.y)} p2={vec(apex.x, apex.y)} color="#6a6a9a" strokeWidth={1.5} style="stroke" />
      </Group>
      {/* No whitespace between <Group> and its child — JSX preserves any
          inline space as a text node, which Skia's reconciler rejects with
          "Text nodes are not supported yet at skGroup" and the slide goes
          blank. Padded the variable names instead of the JSX. */}
      <Group opacity={oWound}><MiniNode cx={apex.x}  cy={apex.y}  r={nodeR} color={colors.wound} /></Group>
      <Group opacity={oFixer}><MiniNode cx={right.x} cy={right.y} r={nodeR} color={colors.fixer} /></Group>
      <Group opacity={oSkep}><MiniNode cx={left.x}   cy={left.y}  r={nodeR} color={colors.skeptic} /></Group>
    </Group>
  );
}

// 2. CHAT BUBBLE LISTENING — a rounded chat-bubble silhouette with the
//    Inner Map triangle breathing softly inside it. The map listening.
function ChatBubbleListening({ W, H }: { W: number; H: number }) {
  // Bubble geometry — a rounded rect with a small left-bottom tail.
  const bubble = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const left = W * 0.12;
    const right = W * 0.88;
    const top = H * 0.18;
    const bottom = H * 0.78;
    const r = 14;
    path.moveTo(left + r, top);
    path.lineTo(right - r, top);
    path.quadTo(right, top, right, top + r);
    path.lineTo(right, bottom - r);
    path.quadTo(right, bottom, right - r, bottom);
    path.lineTo(left + r + 18, bottom);
    // Tail
    path.lineTo(left + 8, bottom + 12);
    path.lineTo(left + r + 4, bottom);
    path.lineTo(left + r, bottom);
    path.quadTo(left, bottom, left, bottom - r);
    path.lineTo(left, top + r);
    path.quadTo(left, top, left + r, top);
    path.close();
    return path;
  }, [W, H]);

  // Triangle inside the bubble breathes opacity 0.4 → 1.0.
  const breath = useSharedValue(0.4);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [breath]);
  const triOpacity = useDerivedValue(() => breath.value, [breath]);

  // Tiny equilateral triangle centered in the bubble.
  const triPath = Skia.Path.Make();
  const tx = W / 2;
  const ty = H * 0.46;
  const ts = W * 0.11;
  triPath.moveTo(tx, ty - ts);
  triPath.lineTo(tx + ts, ty + ts);
  triPath.lineTo(tx - ts, ty + ts);
  triPath.close();

  return (
    <Group>
      <Path path={bubble} color={'rgba(230,180,122,0.06)'} style="fill" />
      <Path path={bubble} color={colors.amberDim} strokeWidth={1.5} style="stroke" />
      <Group opacity={triOpacity}>
        <Path path={triPath} color={colors.amber} strokeWidth={2} style="stroke" />
        <Path path={triPath} color={colors.amber + '33'} style="fill" />
      </Group>
    </Group>
  );
}

// 3. NODE DETECT — a single node fades in, a ripple expands outward and
//    fades to nothing, the node fades out. Loop. The "we noticed something"
//    cycle of part detection.
function NodeDetect({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const baseR = W * 0.16;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }),
      -1, false,
    );
  }, [p]);
  // Node opacity: 0 → 1 over first 25%, hold, fade 75%→100% to 0.
  const nodeOpacity = useDerivedValue(() => {
    const v = p.value;
    if (v < 0.25) return v / 0.25;
    if (v > 0.75) return Math.max(0, 1 - (v - 0.75) / 0.25);
    return 1;
  }, [p]);
  // Ripple kicks off at 30% and rides to 90%, growing + fading.
  const rippleProgress = useDerivedValue(() => {
    const v = p.value;
    if (v < 0.3) return 0;
    if (v > 0.9) return 1;
    return (v - 0.3) / 0.6;
  }, [p]);
  const rippleR = useDerivedValue(() => baseR * (1 + 1.5 * rippleProgress.value), [rippleProgress, baseR]);
  const rippleOpacity = useDerivedValue(() => 0.7 * (1 - rippleProgress.value), [rippleProgress]);
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={rippleR} color={colors.fixer} style="stroke" strokeWidth={2} opacity={rippleOpacity} />
      <Group opacity={nodeOpacity}>
        <Circle cx={cx} cy={cy} r={baseR * 1.9} opacity={0.6}>
          <RadialGradient c={vec(cx, cy)} r={baseR * 2} colors={[colors.fixer + 'AA', colors.fixer + '00']} />
        </Circle>
        <Circle cx={cx} cy={cy} r={baseR} color={colors.fixer} style="stroke" strokeWidth={3} />
        <Circle cx={cx} cy={cy} r={baseR * 0.5} color={colors.fixer + '33'} style="fill" />
      </Group>
    </Group>
  );
}

// 4. PRIVACY LOCK — concentric amber rings around a small lock glyph.
//    The whole thing breathes gently. Calm and reassuring.
function PrivacyLock({ cx, cy, W, H }: { cx: number; cy: number; W: number; H: number }) {
  const breath = useSharedValue(0.55);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 3600, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [breath]);
  const haloOpacity = useDerivedValue(() => 0.3 + 0.4 * breath.value, [breath]);
  const ringOpacity = useDerivedValue(() => 0.45 + 0.4 * breath.value, [breath]);

  // Lock glyph — body rectangle + shackle arc. Built as a Skia Path.
  const bodyW = W * 0.18;
  const bodyH = H * 0.16;
  const bodyTop = cy - bodyH * 0.1;
  const lockBody = Skia.Path.Make();
  const bx = cx - bodyW / 2;
  const by = bodyTop;
  const r = 4;
  lockBody.moveTo(bx + r, by);
  lockBody.lineTo(bx + bodyW - r, by);
  lockBody.quadTo(bx + bodyW, by, bx + bodyW, by + r);
  lockBody.lineTo(bx + bodyW, by + bodyH - r);
  lockBody.quadTo(bx + bodyW, by + bodyH, bx + bodyW - r, by + bodyH);
  lockBody.lineTo(bx + r, by + bodyH);
  lockBody.quadTo(bx, by + bodyH, bx, by + bodyH - r);
  lockBody.lineTo(bx, by + r);
  lockBody.quadTo(bx, by, bx + r, by);
  lockBody.close();

  // Shackle — half-circle arc above the body.
  const shackleR = bodyW * 0.32;
  const shackle = Skia.Path.Make();
  shackle.addArc(
    {
      x: cx - shackleR,
      y: bodyTop - shackleR * 1.3,
      width: shackleR * 2,
      height: shackleR * 2,
    },
    180, 180,
  );
  return (
    <Group>
      {/* Outer breathing halo */}
      <Group opacity={haloOpacity}>
        <Circle cx={cx} cy={cy} r={W * 0.42}>
          <RadialGradient c={vec(cx, cy)} r={W * 0.46} colors={[colors.amber + 'AA', colors.amber + '00']} />
        </Circle>
      </Group>
      {/* Two concentric amber rings */}
      <Circle cx={cx} cy={cy} r={W * 0.34} color={colors.amber} style="stroke" strokeWidth={0.8} opacity={0.25} />
      <Group opacity={ringOpacity}>
        <Circle cx={cx} cy={cy} r={W * 0.22} color={colors.amber} style="stroke" strokeWidth={1.5} />
      </Group>
      {/* Lock glyph — body filled dim, stroked bright */}
      <Path path={lockBody} color={colors.amber + '22'} style="fill" />
      <Path path={lockBody} color={colors.amber} strokeWidth={2} style="stroke" />
      <Path path={shackle} color={colors.amber} strokeWidth={2} style="stroke" />
      {/* Tiny keyhole dot in the body */}
      <Circle cx={cx} cy={bodyTop + bodyH * 0.5} r={1.5} color={colors.amber} style="fill" />
    </Group>
  );
}

// 5. READY TO BEGIN — full mini map; nodes fade in over the first 2.5s,
//    then Self at center brightens last and brightest, holding steady. The
//    rest keeps gently breathing — Self lands on stillness.
function ReadyToBegin({ W, H }: { W: number; H: number }) {
  const apex   = { x: W / 2,    y: H * 0.14 };
  const right  = { x: W * 0.82, y: H * 0.68 };
  const left   = { x: W * 0.18, y: H * 0.68 };
  const center = { x: W / 2,    y: H * 0.52 };
  const mgr    = { x: W * 0.08, y: H * 0.4 };
  const ff     = { x: W * 0.92, y: H * 0.4 };
  const diamond = { x: W / 2, y: H * 0.86, s: W * 0.06 };
  const atmY = (left.y + right.y) / 2 - H * 0.05;
  const nodeR = W * 0.07;

  // One-shot intro that doesn't repeat — the map "lands" and stays.
  const intro = useSharedValue(0);
  // Self brightening — starts a beat after intro completes, climbs and HOLDS.
  const selfBright = useSharedValue(0);
  useEffect(() => {
    intro.value = withTiming(1, { duration: 2500, easing: Easing.out(Easing.ease) });
    selfBright.value = withDelay(2300, withTiming(1, { duration: 1700, easing: Easing.out(Easing.ease) }));
  }, [intro, selfBright]);

  // Gentle ongoing breath for the non-Self nodes so the scene doesn't
  // freeze. Self stays still — that's the contrast that lands.
  const breath = useSharedValue(0.4);
  useEffect(() => {
    breath.value = withRepeat(withTiming(0.7, { duration: 4000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [breath]);
  const haloBreath = useDerivedValue(() => breath.value, [breath]);

  // Per-node fade-in opacities derived from intro.
  const oWound  = useDerivedValue(() => Math.min(1, Math.max(0, (intro.value - 0.0) / 0.25)), [intro]);
  const oFixer  = useDerivedValue(() => Math.min(1, Math.max(0, (intro.value - 0.2) / 0.25)), [intro]);
  const oSkep   = useDerivedValue(() => Math.min(1, Math.max(0, (intro.value - 0.4) / 0.25)), [intro]);
  const oRings  = useDerivedValue(() => Math.min(1, Math.max(0, (intro.value - 0.55) / 0.25)), [intro]);
  const oDiam   = useDerivedValue(() => Math.min(1, Math.max(0, (intro.value - 0.7) / 0.25)), [intro]);
  // Self always renders but its halo intensity ramps via selfBright.
  const selfHalo = useDerivedValue(() => 0.35 + 0.55 * selfBright.value, [selfBright]);

  return (
    <Group>
      {/* Atmospheric purple, subtle and steady — the vessel */}
      <Circle cx={W / 2} cy={atmY} r={W * 0.4} opacity={0.4}>
        <RadialGradient c={vec(W / 2, atmY)} r={W * 0.44}
          colors={['rgba(177,156,217,0.45)', 'rgba(177,156,217,0)']} />
      </Circle>
      {/* Triangle legs — stay subtle, dim grey */}
      <Group opacity={oRings}>
        <Line p1={vec(apex.x, apex.y)} p2={vec(left.x, left.y)}   color="#6a6a9a" strokeWidth={1} style="stroke" />
        <Line p1={vec(apex.x, apex.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1} style="stroke" />
        <Line p1={vec(left.x, left.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1} style="stroke" />
      </Group>
      {/* Side rings */}
      <Group opacity={oRings}>
        <DashedRingWithDots cx={mgr.x} cy={mgr.y} r={nodeR * 1.2} color={colors.managers} />
        <DashedRingWithDots cx={ff.x}  cy={ff.y}  r={nodeR * 1.2} color={colors.firefighters} />
      </Group>
      {/* Triangle nodes — staggered fade-in, gently breathing afterward */}
      <Group opacity={oWound}><BreathingNode cx={apex.x}  cy={apex.y}  r={nodeR} color={colors.wound}   phase={haloBreath} /></Group>
      <Group opacity={oFixer}><BreathingNode cx={right.x} cy={right.y} r={nodeR} color={colors.fixer}   phase={haloBreath} /></Group>
      <Group opacity={oSkep}><BreathingNode cx={left.x}   cy={left.y}  r={nodeR} color={colors.skeptic} phase={haloBreath} /></Group>
      <Group opacity={oDiam}><MiniDiamond cx={diamond.x} cy={diamond.y} size={diamond.s} /></Group>
      {/* SELF — brightens last and HOLDS steady. The stillness is the ending. */}
      <Circle cx={center.x} cy={center.y} r={nodeR * 2.4} opacity={selfHalo}>
        <RadialGradient c={vec(center.x, center.y)} r={nodeR * 2.6}
          colors={[colors.self + 'CC', colors.self + '33', colors.self + '00']} />
      </Circle>
      <Circle cx={center.x} cy={center.y} r={nodeR * 1.3} color={colors.self} style="stroke" strokeWidth={2.5} />
      <Circle cx={center.x} cy={center.y} r={nodeR * 0.7} color={colors.self + '55'} style="fill" />
    </Group>
  );
}


// ============================================================================
// === "WHAT HOLDS YOU" VISUALS — opens the HEALING pill in the Guide tab.
// Two animated visuals + a noVisual placeholder for the closing text-only
// slide. Per the latest spec — replaces the prior 5-visual implementation.
// ============================================================================

// 1. WINDOW OF TOLERANCE — a horizontal band centered on the canvas.
//    Inside the band: contained amber glow, gently breathing. Above and
//    below: amber bleeds outward and dissipates (suggesting flooding
//    beyond the boundary). The band slowly WIDENS over 4s, then
//    contracts and repeats — "the window getting wider over time".
function WindowOfTolerance({ W, H }: { W: number; H: number }) {
  const heightShared = useSharedValue(60);
  useEffect(() => {
    heightShared.value = withRepeat(
      withTiming(90, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [heightShared]);

  const breath = useSharedValue(0.5);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.7, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [breath]);
  const insideOpacity = useDerivedValue(() => breath.value, [breath]);

  const bandW = Math.min(W * 0.85, 180);
  const bandX = (W - bandW) / 2;
  const cy = H / 2;
  const bandPath = useDerivedValue(() => {
    const h = heightShared.value;
    const top = cy - h / 2;
    const r = h / 4;
    const path = Skia.Path.Make();
    path.addRRect({ rect: { x: bandX, y: top, width: bandW, height: h }, rx: r, ry: r });
    return path;
  }, [heightShared, cy, bandX, bandW]);
  const aboveCy = useDerivedValue(() => cy - heightShared.value / 2 - 18, [heightShared, cy]);
  const belowCy = useDerivedValue(() => cy + heightShared.value / 2 + 18, [heightShared, cy]);
  const aboveCenter = useDerivedValue(() => vec(W / 2, aboveCy.value), [aboveCy]);
  const belowCenter = useDerivedValue(() => vec(W / 2, belowCy.value), [belowCy]);
  return (
    <Group>
      <Circle cx={W / 2} cy={aboveCy} r={W * 0.45} opacity={0.35}>
        <RadialGradient c={aboveCenter} r={W * 0.5}
          colors={[colors.amber + 'AA', colors.amber + '00']} />
      </Circle>
      <Circle cx={W / 2} cy={belowCy} r={W * 0.45} opacity={0.35}>
        <RadialGradient c={belowCenter} r={W * 0.5}
          colors={[colors.amber + 'AA', colors.amber + '00']} />
      </Circle>
      <Group opacity={insideOpacity}>
        <Path path={bandPath} color="rgba(230,180,122,0.6)" style="fill" />
      </Group>
      <Path path={bandPath} color="rgba(230,180,122,0.4)" style="stroke" strokeWidth={1} />
    </Group>
  );
}

// 2. BUILDING CAPACITY — same window band, sits in the upper portion.
//    Below it, six small light points appear ONE AT A TIME from bottom
//    upward. After all six are lit, the band rises by ~20px, showing
//    capacity increasing. 6s cycle, then snap reset.
function BuildingCapacity({ W, H }: { W: number; H: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 5500, easing: Easing.linear }),
        withTiming(0, { duration: 500 }),
      ),
      -1, false,
    );
  }, [p]);

  const bandW = Math.min(W * 0.78, 170);
  const bandX = (W - bandW) / 2;
  const bandH = 60;
  const bandTop = useDerivedValue(() => {
    const v = p.value;
    const baseTop = H * 0.18;
    const lift = v > 0.78 ? Math.min(20, (v - 0.78) * 90) : 0;
    return baseTop - lift;
  }, [p, H]);
  const bandPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    path.addRRect({ rect: { x: bandX, y: bandTop.value, width: bandW, height: bandH }, rx: 14, ry: 14 });
    return path;
  }, [bandTop, bandX, bandW]);
  const insideBreath = useSharedValue(0.5);
  useEffect(() => {
    insideBreath.value = withRepeat(
      withTiming(0.7, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [insideBreath]);
  const insideOpacity = useDerivedValue(() => insideBreath.value, [insideBreath]);

  const baseTopY = H * 0.55;
  const baseBottomY = H * 0.92;
  const dotXs = [0.16, 0.30, 0.44, 0.56, 0.70, 0.84];
  const dotY = (i: number) => baseTopY + ((dotXs.length - 1 - i) / (dotXs.length - 1)) * (baseBottomY - baseTopY);
  const baseOpacity = useDerivedValue(() => Math.min(1, p.value * 0.4 + 0.05), [p]);
  return (
    <Group>
      <Group opacity={baseOpacity}>
        <Circle cx={W / 2} cy={baseBottomY} r={W * 0.45}>
          <RadialGradient c={vec(W / 2, baseBottomY)} r={W * 0.5}
            colors={[colors.amber + '55', colors.amber + '00']} />
        </Circle>
      </Group>
      {dotXs.map((fx, i) => (
        <BuildingCapacityDot
          key={i}
          cx={W * fx}
          cy={dotY(i)}
          phase={p}
          myStart={i / dotXs.length}
        />
      ))}
      <Group opacity={insideOpacity}>
        <Path path={bandPath} color="rgba(230,180,122,0.6)" style="fill" />
      </Group>
      <Path path={bandPath} color="rgba(230,180,122,0.4)" style="stroke" strokeWidth={1} />
    </Group>
  );
}

function BuildingCapacityDot({
  cx, cy, phase, myStart,
}: {
  cx: number; cy: number;
  phase: ReturnType<typeof useSharedValue<number>>;
  myStart: number;
}) {
  const slotEnd = myStart + 0.11;
  const opacity = useDerivedValue(() => {
    const v = phase.value;
    if (v < myStart) return 0;
    if (v < slotEnd) return ((v - myStart) / (slotEnd - myStart)) * 0.85;
    return 0.85;
  }, [phase, myStart, slotEnd]);
  return (
    <Group opacity={opacity}>
      <Circle cx={cx} cy={cy} r={10} opacity={0.45}>
        <RadialGradient c={vec(cx, cy)} r={12} colors={[colors.amber + 'AA', colors.amber + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={6} color={colors.amber} style="fill" />
    </Group>
  );
}

// SURVIVAL MODE — the triangle with all three nodes lit + pulsing in their
// colors, atmospheric glow heightened, lines pulsing. Holds for ~3s in the
// activated state, then dims and settles for ~2s, then re-activates. The
// felt sense is "alert and protective, then standing down once it feels
// safer." Loops continuously.
function SurvivalMode({ W, H }: { W: number; H: number }) {
  // 0 = settled, 1 = full activation. Cycle: ramp up 600ms → hold 2400ms →
  // settle 800ms → rest 1200ms → repeat.
  const activation = useSharedValue(0);
  // A slightly-faster pulse layered on top of the activation envelope so
  // the lit state still reads as urgent, not just bright.
  const pulse = useSharedValue(0);
  useEffect(() => {
    activation.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 600, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 2400 }),
        withTiming(0.25, { duration: 800, easing: Easing.in(Easing.ease) }),
        withTiming(0.25, { duration: 1200 }),
      ),
      -1, false,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [activation, pulse]);

  // Triangle anchors (same proportions as the small map illustration).
  const cx = W / 2;
  const cy = H * 0.55;
  const R = Math.min(W, H) * 0.34;
  const woundP   = { x: cx,                              y: cy - R };
  const fixerP   = { x: cx + R * Math.sin(Math.PI * 2 / 3), y: cy - R * Math.cos(Math.PI * 2 / 3) };
  const skepticP = { x: cx - R * Math.sin(Math.PI * 2 / 3), y: cy - R * Math.cos(Math.PI * 2 / 3) };

  // Triangle leg path — solid stroked path so we can pulse opacity together.
  const legPath = (() => {
    const p = Skia.Path.Make();
    p.moveTo(woundP.x, woundP.y);
    p.lineTo(fixerP.x, fixerP.y);
    p.lineTo(skepticP.x, skepticP.y);
    p.close();
    return p;
  })();

  // Atmospheric glow opacity — ramps with activation, oscillates with pulse.
  const atmosphereOpacity = useDerivedValue(
    () => 0.15 + activation.value * (0.45 + 0.15 * pulse.value),
    [activation, pulse],
  );
  // Per-node halo radius scales with activation so the lit state reads BIG.
  const nodeRadius = useDerivedValue(
    () => 14 + activation.value * (8 + 2 * pulse.value),
    [activation, pulse],
  );
  const haloRadius = useDerivedValue(
    () => 22 + activation.value * (16 + 4 * pulse.value),
    [activation, pulse],
  );
  const lineOpacity = useDerivedValue(
    () => 0.25 + activation.value * (0.55 + 0.15 * pulse.value),
    [activation, pulse],
  );
  // Subtle stroke-width pulse on the triangle legs so the lit state reads
  // as activation, not just brightness.
  const lineWidth = useDerivedValue(
    () => 1.5 + activation.value * (1 + 0.6 * pulse.value),
    [activation, pulse],
  );

  return (
    <Group>
      {/* Atmospheric glow centered between Fixer and Skeptic — brighter
          than usual when activated. Reads as the system contracted. */}
      <Group opacity={atmosphereOpacity}>
        <Circle cx={cx} cy={cy + R * 0.05} r={R * 0.95}>
          <RadialGradient
            c={vec(cx, cy + R * 0.05)}
            r={R * 1.0}
            colors={[
              'rgba(224, 110, 100, 0.55)',
              'rgba(177, 156, 217, 0.30)',
              'rgba(177, 156, 217, 0)',
            ]}
          />
        </Circle>
      </Group>

      {/* Triangle legs — pulse in opacity + width when activated. */}
      <Path path={legPath} color="rgba(255,255,255,0.9)" style="stroke"
            strokeWidth={lineWidth} opacity={lineOpacity} />

      {/* Three lit nodes. Each is a halo + a solid colored circle.
          Halo radius scales with activation; the solid core stays the
          same color (wound red / fixer amber / skeptic blue). */}
      <SurvivalNode cx={woundP.x}   cy={woundP.y}   color="#E05050" haloR={haloRadius} coreR={nodeRadius} />
      <SurvivalNode cx={fixerP.x}   cy={fixerP.y}   color="#F0C070" haloR={haloRadius} coreR={nodeRadius} />
      <SurvivalNode cx={skepticP.x} cy={skepticP.y} color="#90C8E8" haloR={haloRadius} coreR={nodeRadius} />
    </Group>
  );
}

function SurvivalNode({
  cx, cy, color, haloR, coreR,
}: {
  cx: number; cy: number; color: string;
  haloR: ReturnType<typeof useDerivedValue<number>>;
  coreR: ReturnType<typeof useDerivedValue<number>>;
}) {
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={haloR}>
        <RadialGradient c={vec(cx, cy)} r={28}
          colors={[color + 'BB', color + '33', color + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={coreR} color={color} style="fill" opacity={0.85} />
      <Circle cx={cx} cy={cy} r={coreR} color={color} style="stroke" strokeWidth={1.5} />
    </Group>
  );
}

// GROUND BUILDING — dim canvas warms as life elements (warm amber dots)
// appear from the bottom upward. Once enough have accumulated, a vertical
// wave of light flows upward through the canvas — the felt sense of
// energy moving freely once there's enough ground beneath it. Continuous
// loop: dots build → canvas warms → wave flows → soft reset.
function GroundBuilding({ W, H }: { W: number; H: number }) {
  // build: 0 → 1 over 4.5s as dots accumulate.
  // wave:  0 → 1 once build > 0.65, drives the upward light current.
  // reset: 0.5s soft fade back to start, then loop.
  const build = useSharedValue(0);
  const wave = useSharedValue(0);
  useEffect(() => {
    build.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 4500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1500 }),
        withTiming(0, { duration: 500, easing: Easing.in(Easing.ease) }),
      ),
      -1, false,
    );
    // Wave ticks continuously and is masked to invisibility while build
    // is below the gating threshold inside the derived opacity.
    wave.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.linear }),
      -1, false,
    );
  }, [build, wave]);

  // Background warm tint — empty canvas brightens as the ground builds.
  const warmthOpacity = useDerivedValue(() => 0.05 + build.value * 0.35, [build]);

  // Rising current of light — only visible after ~0.45 ground built so
  // the visual feels EARNED, not gratuitous.
  const waveOpacity = useDerivedValue(() => {
    const gate = Math.max(0, (build.value - 0.45) / 0.55);   // 0 below 0.45, 1 at 1.0
    const flicker = 0.6 + 0.4 * Math.sin(wave.value * Math.PI * 2);
    return gate * 0.55 * flicker;
  }, [build, wave]);
  const waveY = useDerivedValue(
    () => H * (1 - wave.value) - H * 0.05,
    [wave, H],
  );
  const waveCenter = useDerivedValue(
    () => vec(W / 2, H * (1 - wave.value) - H * 0.05),
    [wave, W, H],
  );

  // 9 ground dots arranged in a slightly randomized cluster across the
  // bottom 60% of the canvas. Each appears in turn — dot i lights up at
  // build-progress >= i / N.
  const dots: Array<{ fx: number; fy: number }> = [
    { fx: 0.18, fy: 0.92 }, { fx: 0.42, fy: 0.95 }, { fx: 0.66, fy: 0.93 },
    { fx: 0.30, fy: 0.82 }, { fx: 0.55, fy: 0.84 }, { fx: 0.78, fy: 0.80 },
    { fx: 0.22, fy: 0.70 }, { fx: 0.50, fy: 0.68 }, { fx: 0.74, fy: 0.66 },
  ];

  return (
    <Group>
      {/* Background warm tint — radial gradient anchored at the bottom
          center so the warmth feels like it rises from the ground. */}
      <Group opacity={warmthOpacity}>
        <Circle cx={W / 2} cy={H * 0.95} r={W * 0.85}>
          <RadialGradient
            c={vec(W / 2, H * 0.95)}
            r={W * 0.95}
            colors={[colors.amber + '55', colors.amber + '22', colors.amber + '00']}
          />
        </Circle>
      </Group>

      {/* Rising current — a soft horizontal band of light moves upward
          once enough ground has been built. */}
      <Group opacity={waveOpacity}>
        <Circle cx={W / 2} cy={waveY} r={W * 0.55}>
          <RadialGradient
            c={waveCenter}
            r={W * 0.6}
            colors={[colors.amber + 'AA', colors.amber + '22', colors.amber + '00']}
          />
        </Circle>
      </Group>

      {/* Ground dots — appear in turn from bottom upward. */}
      {dots.map((d, i) => (
        <GroundDot
          key={i}
          cx={W * d.fx}
          cy={H * d.fy}
          phase={build}
          myStart={i / dots.length}
        />
      ))}
    </Group>
  );
}

function GroundDot({
  cx, cy, phase, myStart,
}: {
  cx: number; cy: number;
  phase: ReturnType<typeof useSharedValue<number>>;
  myStart: number;
}) {
  const slotEnd = myStart + 0.10;
  const opacity = useDerivedValue(() => {
    const v = phase.value;
    if (v < myStart) return 0;
    if (v < slotEnd) return ((v - myStart) / (slotEnd - myStart)) * 0.9;
    return 0.9;
  }, [phase, myStart, slotEnd]);
  return (
    <Group opacity={opacity}>
      <Circle cx={cx} cy={cy} r={10} opacity={0.5}>
        <RadialGradient c={vec(cx, cy)} r={12} colors={[colors.amber + 'AA', colors.amber + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={5} color={colors.amber} style="fill" />
    </Group>
  );
}

// 3. TWO TRACKS — two vertical lines (inner work + outer life) start as
//    near-nothing at the bottom center and grow upward over 2.5s. They
//    start 4px apart and fan to ~20px apart at the top — finding their
//    own paths while moving in the same direction. Stroke width grows
//    1.5 → 3 with the height. A soft glow blooms at each line's tip as
//    it reaches full height. After full height the lines breathe gently
//    (opacity 0.7 ↔ 1.0 / 2s). Full cycle: 5s, then reset and repeat.
function TwoTracks({ W, H }: { W: number; H: number }) {
  // Single 0..1 progress drives growth, then holds, then resets. Cycle
  // is 5s total — 2.5s grow + 2.5s hold-and-breathe — looped forever.
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2500, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 2500 }), // hold full height while breath plays
        withTiming(0, { duration: 0 }),    // snap reset
      ),
      -1, false,
    );
  }, [grow]);

  // Subtle breath while held — multiplies the line opacity.
  const breath = useSharedValue(0.85);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1.0, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [breath]);

  // Geometry — both lines start at the bottom center and walk upward.
  // Line 1 (inner work, amber) sits slightly LEFT of center, line 2
  // (outer life, cream) slightly RIGHT. The X positions interpolate
  // outward as the lines grow taller — they fan apart as they rise.
  const cx = W / 2;
  const baseY = H * 0.92;          // both lines emerge from here
  const fullTop = H * 0.10;        // both lines reach this Y at full growth
  const baseGap = 2;               // half-gap at the bottom (4px apart total)
  const topGap = 10;               // half-gap at the top (20px apart total)

  // Helper — derived current top Y for a given grow progress.
  const innerTopY = useDerivedValue(() => baseY - (baseY - fullTop) * grow.value, [grow, baseY, fullTop]);

  // Each line is a Skia path that starts at the base and ends at the
  // current animated top. Width animates with progress.
  const strokeWidthAnimated = useDerivedValue(() => 1.5 + 1.5 * grow.value, [grow]);
  const lineOpacity = useDerivedValue(() => 0.7 + 0.3 * (breath.value * grow.value), [breath, grow]);
  // Glow at the tip blooms in the last 30% of the growth.
  const tipGlowOpacity = useDerivedValue(() => Math.max(0, (grow.value - 0.7) / 0.3), [grow]);

  // Inner-work line — amber. X drifts from cx-baseGap at base to cx-topGap at top.
  const innerP1 = useDerivedValue(() => vec(cx - baseGap, baseY), [cx, baseY]);
  const innerP2 = useDerivedValue(() => {
    const xAtTop = cx - (baseGap + (topGap - baseGap) * grow.value);
    return vec(xAtTop, innerTopY.value);
  }, [grow, cx, baseGap, topGap, innerTopY]);
  const innerTipCx = useDerivedValue(() => cx - (baseGap + (topGap - baseGap) * grow.value), [grow, cx, baseGap, topGap]);
  const innerTipCenter = useDerivedValue(() => vec(innerTipCx.value, innerTopY.value), [innerTipCx, innerTopY]);

  // Outer-life line — cream/soft white. Mirror geometry on the right.
  const outerP1 = useDerivedValue(() => vec(cx + baseGap, baseY), [cx, baseY]);
  const outerP2 = useDerivedValue(() => {
    const xAtTop = cx + (baseGap + (topGap - baseGap) * grow.value);
    return vec(xAtTop, innerTopY.value);
  }, [grow, cx, baseGap, topGap, innerTopY]);
  const outerTipCx = useDerivedValue(() => cx + (baseGap + (topGap - baseGap) * grow.value), [grow, cx, baseGap, topGap]);
  const outerTipCenter = useDerivedValue(() => vec(outerTipCx.value, innerTopY.value), [outerTipCx, innerTopY]);

  return (
    <Group>
      {/* Inner work — amber, slightly left of center */}
      <Group opacity={lineOpacity}>
        <Line p1={innerP1} p2={innerP2} color="#E6B47A" strokeWidth={strokeWidthAnimated} style="stroke" />
      </Group>
      {/* Tip glow — amber */}
      <Circle cx={innerTipCx} cy={innerTopY} r={W * 0.08} opacity={tipGlowOpacity}>
        <RadialGradient c={innerTipCenter} r={W * 0.1} colors={['#E6B47AAA', '#E6B47A00']} />
      </Circle>

      {/* Outer life — cream, slightly right of center */}
      <Group opacity={lineOpacity}>
        <Line p1={outerP1} p2={outerP2} color="rgba(240,237,232,0.85)" strokeWidth={strokeWidthAnimated} style="stroke" />
      </Group>
      {/* Tip glow — soft cream */}
      <Circle cx={outerTipCx} cy={innerTopY} r={W * 0.08} opacity={tipGlowOpacity}>
        <RadialGradient c={outerTipCenter} r={W * 0.1}
          colors={['rgba(240,237,232,0.7)', 'rgba(240,237,232,0)']} />
      </Circle>
    </Group>
  );
}

// 4. ENERGY MOVES — a soft amber wave of light enters from the left,
//    travels across the canvas, and fades out as it exits. Steady and
//    inevitable — passing through, not stuck. The wave brightens
//    slightly at the canvas midpoint then softens as it exits.
//
//    Implementation: a Skia Rect spanning the full canvas, painted
//    with a horizontal LinearGradient whose stop positions slide
//    across with the animated phase. The gradient is transparent →
//    amber → transparent, so the lit "band" appears wherever the
//    middle stop is anchored at any given frame. Behind it, a faint
//    static amber glow at the center suggests the contained space
//    the energy is moving through.
function EnergyMoves({ W, H }: { W: number; H: number }) {
  // 0..1 phase loops continuously over 3s — the position of the
  // wave's center as a fraction of canvas width plus a half-band lead-in.
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.linear }),
      -1, false,
    );
  }, [phase]);

  // The wave is a 40-px-tall band at vertical center.
  const bandTop = H / 2 - 20;
  const bandH = 40;

  // Linear gradient endpoints anchored to the canvas. We paint the
  // gradient transparent → amber → transparent and slide the AMBER
  // STOP POSITION across via the `positions` array. The stops control
  // where each color sits along the start→end vector.
  // Phase mapping: at phase=0, the amber peak is just left of x=0
  // (off-canvas); at phase=1, it's just right of x=W (off-canvas).
  const start = vec(0, 0);
  const end = vec(W, 0);
  // Center of the bright peak in normalized coords (slightly outside
  // [0,1] at boundaries so the wave smoothly enters and exits).
  const peak = useDerivedValue(() => -0.2 + 1.4 * phase.value, [phase]);

  // The amber peak gets a touch brighter as it crosses the midpoint.
  // Distance from 0.5 → opacity multiplier 1.0 at center, 0.6 at edges.
  const amberOpacity = useDerivedValue(() => {
    const d = Math.abs(phase.value - 0.5);
    return Math.max(0.6, 1.0 - d * 0.8);
  }, [phase]);
  const amberMidColor = useDerivedValue(() => {
    const a = Math.round(Math.min(255, amberOpacity.value * 0.6 * 255));
    const hex = a.toString(16).padStart(2, '0');
    return `#E6B47A${hex}`;
  }, [amberOpacity]);

  // Three-stop gradient: transparent at the leading edge, amber at
  // the peak, transparent at the trailing edge. The peak itself
  // moves via the positions array.
  const colors = useDerivedValue(
    () => ['#E6B47A00', amberMidColor.value, '#E6B47A00'],
    [amberMidColor],
  );
  const positions = useDerivedValue(() => {
    const p = peak.value;
    const halfBand = 0.18; // half-width of the lit zone, in normalized space
    return [Math.max(0, p - halfBand), p, Math.min(1, p + halfBand)];
  }, [peak]);

  return (
    <Group>
      {/* Faint static glow at the center — the contained space the
          energy is moving through. */}
      <Circle cx={W / 2} cy={H / 2} r={W * 0.32} opacity={0.5}>
        <RadialGradient
          c={vec(W / 2, H / 2)}
          r={W * 0.36}
          colors={['rgba(230,180,122,0.18)', 'rgba(230,180,122,0)']}
        />
      </Circle>
      {/* The traveling wave band. The Rect covers the whole band area;
          the LinearGradient does the actual work, sliding the bright
          peak across via animated stop positions. */}
      <Rect x={0} y={bandTop} width={W} height={bandH}>
        <LinearGradient start={start} end={end} colors={colors} positions={positions} />
      </Rect>
    </Group>
  );
}
