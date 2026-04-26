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
  Canvas, Circle, Group, Path, RadialGradient, Skia, Line, DashPathEffect, vec,
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
      {kind === 'twoSides'             ? <TwoSides W={W} H={H} /> : null}
      {kind === 'capacity'             ? <Capacity W={W} H={H} /> : null}
      {kind === 'buildBase'            ? <BuildBase W={W} H={H} /> : null}
      {kind === 'fromSafety'           ? <FromSafety cx={cx} cy={cy} W={W} /> : null}
      {kind === 'inFlow'               ? <InFlow W={W} H={H} /> : null}
    </Canvas>
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
  // Each dot's "lit-ness" = 1 when the wave is exactly on it, fading with
  // distance on either side. Wrapped around 0..1 so the wave loops seamlessly.
  const glow = useDerivedValue(() => {
    const normalized = index / count;
    let d = Math.abs((phase.value - normalized + 1) % 1);
    if (d > 0.5) d = 1 - d;
    const k = Math.max(0, 1 - d * 3.5);
    return 0.35 + 0.65 * k;
  }, [phase, index, count]);
  return (
    <Group opacity={glow}>
      <Circle cx={x} cy={y} r={dotR * 1.6} opacity={0.45}>
        <RadialGradient c={vec(x, y)} r={dotR * 1.8} colors={[colors.creamDim + '88', colors.creamDim + '00']} />
      </Circle>
      <Circle cx={x} cy={y} r={dotR} color={colors.creamDim} style="stroke" strokeWidth={1.2} />
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
// === "WHAT HOLDS YOU" VISUALS — 5 unique animated scenes for the slides ====
// that open the HEALING pill in the Guide tab.
// ============================================================================

// 1. TWO SIDES — left half: a soft wave rising upward (energy surfacing).
//    right half: a steady horizontal ground layer with a contained circle
//    resting on it. Both glow at different rhythms — paired, not opposed.
function TwoSides({ W, H }: { W: number; H: number }) {
  const leftBreath = useSharedValue(0.4);
  const rightBreath = useSharedValue(0.4);
  useEffect(() => {
    leftBreath.value  = withRepeat(withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }), -1, true);
    rightBreath.value = withRepeat(withTiming(1, { duration: 4500, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [leftBreath, rightBreath]);

  // Tiny mote travels up the wave path — "rising" feel.
  const wavePhase = useSharedValue(0);
  useEffect(() => {
    wavePhase.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.linear }), -1, false);
  }, [wavePhase]);

  const leftCx = W * 0.28;
  const rightCx = W * 0.72;
  const baseY = H * 0.7;

  const wavePath = (() => {
    const p = Skia.Path.Make();
    const w = W * 0.32;
    const h = H * 0.4;
    const x0 = leftCx - w / 2;
    p.moveTo(x0, baseY);
    p.cubicTo(x0 + w * 0.25, baseY - h * 0.6, x0 + w * 0.5, baseY - h, x0 + w * 0.75, baseY - h * 0.7);
    p.cubicTo(x0 + w * 0.9, baseY - h * 0.4, x0 + w, baseY - h * 0.3, x0 + w, baseY);
    return p;
  })();

  const leftOpacity  = useDerivedValue(() => 0.45 + 0.5 * leftBreath.value, [leftBreath]);
  const rightOpacity = useDerivedValue(() => 0.45 + 0.4 * rightBreath.value, [rightBreath]);
  const moteY = useDerivedValue(() => baseY - H * 0.35 * wavePhase.value, [wavePhase, baseY]);
  const moteX = useDerivedValue(() => leftCx + Math.sin(wavePhase.value * Math.PI * 2) * W * 0.04, [wavePhase, leftCx]);
  const moteOpacity = useDerivedValue(() => 1 - wavePhase.value, [wavePhase]);

  const amberAA = colors.amber + 'AA';
  const amber22 = colors.amber + '22';
  const amber33 = colors.amber + '33';

  return (
    <Group>
      {/* Left side — "what's rising": a soft wave + a rising mote */}
      <Group opacity={leftOpacity}>
        <Path path={wavePath} color={amberAA} style="stroke" strokeWidth={2} />
        <Path path={wavePath} color={amber22} style="fill" />
      </Group>
      <Circle cx={moteX} cy={moteY} r={3} color={colors.amber} opacity={moteOpacity} />
      {/* Right side — "what's holding": ground + contained resting circle */}
      <Group opacity={rightOpacity}>
        <Line p1={vec(rightCx - W * 0.18, baseY)} p2={vec(rightCx + W * 0.18, baseY)}
              color={colors.amber} strokeWidth={2} style="stroke" />
        <Circle cx={rightCx} cy={baseY - W * 0.1} r={W * 0.09} color={colors.amber} style="stroke" strokeWidth={2} />
        <Circle cx={rightCx} cy={baseY - W * 0.1} r={W * 0.06} color={amber33} style="fill" />
      </Group>
    </Group>
  );
}

// 2. CAPACITY — horizontal threshold line that rises slowly. Below: a
//    contained soft amber glow (everything fits). Above: red flooding
//    outward. As the threshold rises, the red retreats — visual proof
//    that "healing is your capacity getting bigger."
function Capacity({ W, H }: { W: number; H: number }) {
  const rise = useSharedValue(0);
  useEffect(() => {
    rise.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1500 }),
        withTiming(0, { duration: 1500, easing: Easing.in(Easing.ease) }),
      ),
      -1, false,
    );
  }, [rise]);

  const startY = H * 0.78;
  const endY   = H * 0.32;
  const lineY = useDerivedValue(() => startY + (endY - startY) * rise.value, [rise]);
  const p1 = useDerivedValue(() => vec(W * 0.08, lineY.value), [lineY]);
  const p2 = useDerivedValue(() => vec(W * 0.92, lineY.value), [lineY]);

  // Below: contained glow whose center sits halfway between bottom and threshold.
  const belowCy = useDerivedValue(() => (lineY.value + H * 0.92) / 2, [lineY]);
  const belowR  = useDerivedValue(() => Math.max(8, (H * 0.92 - lineY.value) * 0.45), [lineY]);
  const belowCenter = useDerivedValue(() => vec(W / 2, belowCy.value), [belowCy]);

  // Above: red flooding. Intensity decreases as threshold rises.
  const floodR = useDerivedValue(() => Math.max(0, (1 - rise.value) * W * 0.35), [rise]);
  const floodOpacity = useDerivedValue(() => 0.55 * (1 - rise.value), [rise]);

  return (
    <Group>
      <Circle cx={W / 2} cy={H * 0.18} r={floodR} opacity={floodOpacity}>
        <RadialGradient c={vec(W / 2, H * 0.18)} r={W * 0.4}
          colors={[colors.wound + 'CC', colors.wound + '33', colors.wound + '00']} />
      </Circle>
      <Circle cx={W / 2} cy={belowCy} r={belowR} opacity={0.7}>
        <RadialGradient c={belowCenter} r={W * 0.45}
          colors={[colors.amber + 'AA', colors.amber + '22', colors.amber + '00']} />
      </Circle>
      <Line p1={p1} p2={p2} color={colors.cream} strokeWidth={1.5} style="stroke" opacity={0.85} />
    </Group>
  );
}

// 3. BUILD BASE — small light points (sleep, food, people, therapy)
//    appear in sequence at the bottom. The threshold line above them
//    rises as the base fills in.
function BuildBase({ W, H }: { W: number; H: number }) {
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 4000, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 1500 }),
        withTiming(0, { duration: 1000 }),
      ),
      -1, false,
    );
  }, [phase]);

  const baseY = H * 0.82;
  const startThreshold = H * 0.7;
  const endThreshold   = H * 0.42;
  const lineY = useDerivedValue(() => startThreshold + (endThreshold - startThreshold) * phase.value, [phase]);
  const lp1 = useDerivedValue(() => vec(W * 0.1, lineY.value), [lineY]);
  const lp2 = useDerivedValue(() => vec(W * 0.9, lineY.value), [lineY]);

  const dotXs = [0.18, 0.32, 0.46, 0.58, 0.72, 0.86];
  return (
    <Group>
      {dotXs.map((fx, i) => (
        <SequencedBaseLight
          key={i} cx={W * fx} cy={baseY} r={W * 0.025}
          phase={phase} myStart={i / dotXs.length}
        />
      ))}
      <Line p1={lp1} p2={lp2} color={colors.cream} strokeWidth={1.5} style="stroke" opacity={0.7} />
    </Group>
  );
}

function SequencedBaseLight({
  cx, cy, r, phase, myStart,
}: {
  cx: number; cy: number; r: number;
  phase: ReturnType<typeof useSharedValue<number>>;
  myStart: number;
}) {
  const slot = 0.16;
  const opacity = useDerivedValue(() => {
    const v = phase.value;
    if (v < myStart) return 0.1;
    if (v < myStart + slot) return 0.1 + 0.9 * ((v - myStart) / slot);
    return 1;
  }, [phase, myStart]);
  return (
    <Group opacity={opacity}>
      <Circle cx={cx} cy={cy} r={r * 2.4} opacity={0.35}>
        <RadialGradient c={vec(cx, cy)} r={r * 2.6} colors={[colors.amber + 'AA', colors.amber + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={colors.amber} style="fill" />
    </Group>
  );
}

// 4. FROM SAFETY — central circle held by an outer containing structure.
//    Two concentric rings + soft halo + steady inner core. Calm. The
//    geometry is RESTING — only the halo opacity breathes slowly.
function FromSafety({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const breath = useSharedValue(0.55);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 5000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [breath]);
  const haloOpacity = useDerivedValue(() => 0.35 + 0.35 * breath.value, [breath]);
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={W * 0.42} color={colors.amber} style="stroke" strokeWidth={1.2} opacity={0.45} />
      <Circle cx={cx} cy={cy} r={W * 0.32} color={colors.amber} style="stroke" strokeWidth={1.5} opacity={0.55}>
        <DashPathEffect intervals={[6, 5]} />
      </Circle>
      <Group opacity={haloOpacity}>
        <Circle cx={cx} cy={cy} r={W * 0.28}>
          <RadialGradient c={vec(cx, cy)} r={W * 0.32}
            colors={[colors.amber + 'AA', colors.amber + '22', colors.amber + '00']} />
        </Circle>
      </Group>
      <Circle cx={cx} cy={cy} r={W * 0.13} color={colors.amber} style="stroke" strokeWidth={2.5} />
      <Circle cx={cx} cy={cy} r={W * 0.07} color={colors.amber + '66'} style="fill" />
    </Group>
  );
}

// 5. IN FLOW — full picture. Built base, raised threshold, contained
//    center, energy mote rising and being held. The system in flow.
function InFlow({ W, H }: { W: number; H: number }) {
  const baseY = H * 0.84;
  const thresholdY = H * 0.42;
  const centerCy = (baseY + thresholdY) / 2 + H * 0.04;

  const breath = useSharedValue(0.5);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 4500, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [breath]);
  const haloOpacity = useDerivedValue(() => 0.45 + 0.4 * breath.value, [breath]);

  const motePhase = useSharedValue(0);
  useEffect(() => {
    motePhase.value = withRepeat(withTiming(1, { duration: 3500, easing: Easing.linear }), -1, false);
  }, [motePhase]);
  const moteY = useDerivedValue(() => centerCy - (centerCy - thresholdY * 0.9) * motePhase.value, [motePhase]);
  const moteOpacity = useDerivedValue(() => 0.8 * (1 - Math.abs(motePhase.value - 0.4) * 1.5), [motePhase]);

  const dotXs = [0.18, 0.32, 0.46, 0.58, 0.72, 0.86];
  return (
    <Group>
      {dotXs.map((fx, i) => (
        <Group key={i}>
          <Circle cx={W * fx} cy={baseY} r={W * 0.06} opacity={0.35}>
            <RadialGradient c={vec(W * fx, baseY)} r={W * 0.07} colors={[colors.amber + 'AA', colors.amber + '00']} />
          </Circle>
          <Circle cx={W * fx} cy={baseY} r={W * 0.025} color={colors.amber} style="fill" />
        </Group>
      ))}
      <Line p1={vec(W * 0.08, thresholdY)} p2={vec(W * 0.92, thresholdY)}
            color={colors.cream} strokeWidth={1.5} style="stroke" opacity={0.6} />
      <Circle cx={W / 2} cy={centerCy} r={W * 0.27} color={colors.amber} style="stroke" strokeWidth={1.2} opacity={0.4} />
      <Group opacity={haloOpacity}>
        <Circle cx={W / 2} cy={centerCy} r={W * 0.18}>
          <RadialGradient c={vec(W / 2, centerCy)} r={W * 0.22}
            colors={[colors.amber + 'AA', colors.amber + '22', colors.amber + '00']} />
        </Circle>
      </Group>
      <Circle cx={W / 2} cy={centerCy} r={W * 0.1} color={colors.amber} style="stroke" strokeWidth={2.5} />
      <Circle cx={W / 2} cy={centerCy} r={W * 0.05} color={colors.amber + '66'} style="fill" />
      <Circle cx={W / 2} cy={moteY} r={3} color={colors.amber} opacity={moteOpacity} />
    </Group>
  );
}
