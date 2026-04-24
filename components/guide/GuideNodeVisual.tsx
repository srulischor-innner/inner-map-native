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
  useSharedValue, withRepeat, withTiming, withSequence, Easing, useDerivedValue,
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
    </Canvas>
  );
}

// =============================================================================
// 1. INTRO — expanding amber glow rings radiating outward from center
// =============================================================================
function IntroRings({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  // Three concentric rings; outer ones more transparent. A soft breath on
  // opacity makes the whole group feel alive without moving any geometry.
  const breath = useSharedValue(0.85);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 3500, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [breath]);
  const groupOpacity = useDerivedValue(() => breath.value, [breath]);
  return (
    <Group opacity={groupOpacity}>
      <Circle cx={cx} cy={cy} r={W * 0.46} color={colors.amber} style="stroke" strokeWidth={0.8} opacity={0.18} />
      <Circle cx={cx} cy={cy} r={W * 0.34} color={colors.amber} style="stroke" strokeWidth={1.2} opacity={0.35} />
      <Circle cx={cx} cy={cy} r={W * 0.22} color={colors.amber} style="stroke" strokeWidth={1.8} opacity={0.65} />
      <Circle cx={cx} cy={cy} r={W * 0.1}>
        <RadialGradient c={vec(cx, cy)} r={W * 0.12} colors={[colors.amber + 'CC', colors.amber + '22']} />
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
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(t) * ringR;
    const y = cy + Math.sin(t) * ringR;
    items.push(
      <Group key={i}>
        <Circle cx={x} cy={y} r={dotR * 1.6} opacity={0.35}>
          <RadialGradient c={vec(x, y)} r={dotR * 1.8} colors={[colors.creamDim + '88', colors.creamDim + '00']} />
        </Circle>
        <Circle cx={x} cy={y} r={dotR} color={colors.creamDim} style="stroke" strokeWidth={1.2} opacity={0.7} />
      </Group>,
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

// =============================================================================
// 3. WOUND — single red circle, slow breathing pulse
// =============================================================================
function WoundBreathing({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  const pulse = useSharedValue(0.75);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [pulse]);
  const haloOpacity = useDerivedValue(() => 0.55 * pulse.value, [pulse]);
  const r = W * 0.28;
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r * 2.1} opacity={haloOpacity}>
        <RadialGradient c={vec(cx, cy)} r={r * 2.2} colors={[colors.wound + 'CC', colors.wound + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={colors.wound} style="stroke" strokeWidth={3} />
      <Circle cx={cx} cy={cy} r={r * 0.5} color={colors.wound + '44'} style="fill" />
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
  return (
    <Group>
      {/* Outer story ring — thinner, dashed so it reads as the "narrative" layer. */}
      <Circle cx={cx} cy={cy} r={outer} color={colors.wound} style="stroke" strokeWidth={1.2} opacity={0.7}>
        <DashPathEffect intervals={[5, 5]} />
      </Circle>
      {/* Inner felt layer — solid gradient glow filling inward */}
      <Circle cx={cx} cy={cy} r={inner * 1.9} opacity={0.7}>
        <RadialGradient c={vec(cx, cy)} r={inner * 2} colors={[colors.wound + 'CC', colors.wound + '33', colors.wound + '00']} />
      </Circle>
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
  const topY = cy - H * 0.12;
  // Three short arrows stacked above the circle, center line tallest.
  const lineLen = H * 0.14;
  const arrows = [
    { x: cx - W * 0.12, topY: topY + H * 0.05 },
    { x: cx,            topY: topY - H * 0.02 }, // tallest
    { x: cx + W * 0.12, topY: topY + H * 0.05 },
  ];
  return (
    <Group>
      {/* Circle — sits low so the upward lines read as striving above it */}
      <Circle cx={cx} cy={baseY} r={r * 1.9} opacity={0.6}>
        <RadialGradient c={vec(cx, baseY)} r={r * 2} colors={[colors.fixer + 'AA', colors.fixer + '00']} />
      </Circle>
      <Circle cx={cx} cy={baseY} r={r} color={colors.fixer} style="stroke" strokeWidth={3} />
      <Circle cx={cx} cy={baseY} r={r * 0.5} color={colors.fixer + '33'} style="fill" />
      {/* Three upward strokes — forward energy. */}
      {arrows.map((a, i) => (
        <Line
          key={i}
          p1={vec(a.x, baseY - r - 4)}
          p2={vec(a.x, a.topY)}
          color={colors.fixer}
          strokeWidth={2.5}
          style="stroke"
        />
      ))}
    </Group>
  );
}

// =============================================================================
// 6. SKEPTIC — blue circle with a heavy horizontal line below it
// =============================================================================
function SkepticWeighted({ cx, cy, W, H }: { cx: number; cy: number; W: number; H: number }) {
  const r = W * 0.24;
  const cy2 = cy - H * 0.08;
  const lineY = cy + H * 0.3;
  const lineLen = W * 0.55;
  return (
    <Group>
      <Circle cx={cx} cy={cy2} r={r * 1.9} opacity={0.55}>
        <RadialGradient c={vec(cx, cy2)} r={r * 2} colors={[colors.skeptic + 'AA', colors.skeptic + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy2} r={r} color={colors.skeptic} style="stroke" strokeWidth={3} />
      <Circle cx={cx} cy={cy2} r={r * 0.5} color={colors.skeptic + '33'} style="fill" />
      {/* Weighted bar underneath — reads as gravity / restraint */}
      <Line p1={vec(cx - lineLen / 2, lineY)} p2={vec(cx + lineLen / 2, lineY)}
            color={colors.skeptic} strokeWidth={3} style="stroke" />
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

  const breath = useSharedValue(0.3);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.5, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [breath]);
  const atmOpacity = useDerivedValue(() => breath.value, [breath]);
  return (
    <Group>
      <Group opacity={atmOpacity}>
        <Circle cx={W / 2} cy={atmY} r={W * 0.36}>
          <RadialGradient c={vec(W / 2, atmY)} r={W * 0.42}
            colors={['rgba(177,156,217,0.5)', 'rgba(177,156,217,0)']} />
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
  return (
    <Group>
      {/* Dimmer halo — the self-like part is the middle ground, not Self itself. */}
      <Circle cx={cx} cy={cy} r={size * 1.6} opacity={0.45}>
        <RadialGradient c={vec(cx, cy)} r={size * 1.8} colors={[colors.selfLike + '88', colors.selfLike + '00']} />
      </Circle>
      <Path path={p} color={colors.selfLike + '33'} style="fill" />
      <Path path={p} color={colors.selfLike} style="stroke" strokeWidth={2.5} />
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
  // Inner dots — 3 on the manager side, 3 on the firefighter side. Positioned
  // so they sit inside the ring without clustering.
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
  return (
    <Group>
      <DashedRingWithDots cx={leftCx}  cy={cy} r={r} color={colors.managers}     dots={managerDots} />
      <DashedRingWithDots cx={rightCx} cy={cy} r={r} color={colors.firefighters} dots={ffDots} />
    </Group>
  );
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

  const breath = useSharedValue(0.3);
  useEffect(() => {
    breath.value = withRepeat(withTiming(0.45, { duration: 4000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [breath]);
  const atmOpacity = useDerivedValue(() => breath.value, [breath]);
  return (
    <Group>
      <Group opacity={atmOpacity}>
        <Circle cx={W / 2} cy={atmY} r={W * 0.4}>
          <RadialGradient c={vec(W / 2, atmY)} r={W * 0.44} colors={['rgba(177,156,217,0.45)', 'rgba(177,156,217,0)']} />
        </Circle>
      </Group>
      <Line p1={vec(apex.x, apex.y)} p2={vec(left.x, left.y)}   color="#6a6a9a" strokeWidth={1} style="stroke" />
      <Line p1={vec(apex.x, apex.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1} style="stroke" />
      <Line p1={vec(left.x, left.y)} p2={vec(right.x, right.y)} color="#6a6a9a" strokeWidth={1} style="stroke" />
      <DashedRingWithDots cx={mgr.x} cy={mgr.y} r={nodeR * 1.2} color={colors.managers} />
      <DashedRingWithDots cx={ff.x}  cy={ff.y}  r={nodeR * 1.2} color={colors.firefighters} />
      <MiniNode cx={center.x} cy={center.y} r={nodeR * 1.2} color={colors.self} />
      <MiniNode cx={apex.x}   cy={apex.y}   r={nodeR} color={colors.wound} />
      <MiniNode cx={right.x}  cy={right.y}  r={nodeR} color={colors.fixer} />
      <MiniNode cx={left.x}   cy={left.y}   r={nodeR} color={colors.skeptic} />
      <MiniDiamond cx={diamond.x} cy={diamond.y} size={diamond.s} />
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
