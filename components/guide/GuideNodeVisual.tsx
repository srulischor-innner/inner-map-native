// Small Skia canvas that renders a single node or mini-layout for a Guide slide.
// Picks the right illustration by `kind` from guideContent.ts. Kept compact so each
// slide gets an unambiguous, color-matched visual without duplicating the
// full-map layout code.

import React from 'react';
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
      {kind === 'ambient' ? <Ambient cx={cx} cy={cy} W={W} /> : null}
      {kind === 'wound' ? <SingleGlow cx={cx} cy={cy} r={W * 0.28} color={colors.wound} /> : null}
      {kind === 'woundSoft' ? <PulsingGlow cx={cx} cy={cy} r={W * 0.3} color={colors.wound} /> : null}
      {kind === 'fixer' ? <SingleGlow cx={cx} cy={cy} r={W * 0.28} color={colors.fixer} /> : null}
      {kind === 'skeptic' ? <SingleGlow cx={cx} cy={cy} r={W * 0.28} color={colors.skeptic} /> : null}
      {kind === 'self' ? <SelfGlow cx={cx} cy={cy} r={W * 0.3} /> : null}
      {kind === 'selfLike' ? <SelfLikeDiamond cx={cx} cy={cy} size={W * 0.3} /> : null}
      {kind === 'triangle' ? <MiniTriangle W={W} H={H} /> : null}
      {kind === 'managersFirefighters' ? <MgrFFPair W={W} H={H} /> : null}
      {kind === 'fullmap' ? <MiniFullMap W={W} H={H} /> : null}
    </Canvas>
  );
}

// ---------- primitives ----------

function Ambient({ cx, cy, W }: { cx: number; cy: number; W: number }) {
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={W * 0.45} opacity={0.55}>
        <RadialGradient c={vec(cx, cy)} r={W * 0.5} colors={[colors.amber + '88', colors.amber + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={W * 0.12} color={colors.amber} style="stroke" strokeWidth={2} />
    </Group>
  );
}

function SingleGlow({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r * 1.9} opacity={0.7}>
        <RadialGradient c={vec(cx, cy)} r={r * 2} colors={[color + 'AA', color + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={2.5} />
      <Circle cx={cx} cy={cy} r={r * 0.55} color={color + '33'} style="fill" />
    </Group>
  );
}

function PulsingGlow({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  // A slightly larger halo radius gives the "speaking through the body" feel.
  return <SingleGlow cx={cx} cy={cy} r={r} color={color} />;
}

function SelfGlow({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r * 2} opacity={0.55}>
        <RadialGradient c={vec(cx, cy)} r={r * 2.1} colors={[colors.self + 'CC', colors.self + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={colors.self} style="stroke" strokeWidth={2.5} />
    </Group>
  );
}

function SelfLikeDiamond({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const p = Skia.Path.Make();
  p.moveTo(cx, cy - size);
  p.lineTo(cx + size, cy);
  p.lineTo(cx, cy + size);
  p.lineTo(cx - size, cy);
  p.close();
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={size * 1.4} opacity={0.5}>
        <RadialGradient c={vec(cx, cy)} r={size * 1.6} colors={[colors.selfLike + 'AA', colors.selfLike + '00']} />
      </Circle>
      <Path path={p} color={colors.selfLike + '33'} style="fill" />
      <Path path={p} color={colors.selfLike} style="stroke" strokeWidth={2} />
    </Group>
  );
}

function MiniTriangle({ W, H }: { W: number; H: number }) {
  const apex = { x: W / 2, y: H * 0.18 };
  const left = { x: W * 0.14, y: H * 0.82 };
  const right = { x: W * 0.86, y: H * 0.82 };
  const nodeR = W * 0.1;
  const atmY = (left.y + right.y) / 2 - H * 0.08;
  return (
    <Group>
      {/* atmosphere */}
      <Circle cx={W / 2} cy={atmY} r={W * 0.34} opacity={0.4}>
        <RadialGradient c={vec(W / 2, atmY)} r={W * 0.4} colors={['rgba(177,156,217,0.35)', 'rgba(177,156,217,0)']} />
      </Circle>
      {/* triangle lines */}
      <Line p1={vec(apex.x, apex.y)} p2={vec(left.x, left.y)} color="#5a5a8a" strokeWidth={1.2} style="stroke" />
      <Line p1={vec(apex.x, apex.y)} p2={vec(right.x, right.y)} color="#5a5a8a" strokeWidth={1.2} style="stroke" />
      <Line p1={vec(left.x, left.y)} p2={vec(right.x, right.y)} color="#5a5a8a" strokeWidth={1.2} style="stroke" />
      {/* three nodes */}
      <SingleGlow cx={apex.x}  cy={apex.y}  r={nodeR} color={colors.wound} />
      <SingleGlow cx={right.x} cy={right.y} r={nodeR} color={colors.fixer} />
      <SingleGlow cx={left.x}  cy={left.y}  r={nodeR} color={colors.skeptic} />
    </Group>
  );
}

function MgrFFPair({ W, H }: { W: number; H: number }) {
  const r = W * 0.2;
  const leftCx = W * 0.28;
  const rightCx = W * 0.72;
  const cy = H / 2;
  return (
    <Group>
      <DashedRing cx={leftCx}  cy={cy} r={r} color={colors.managers} />
      <DashedRing cx={rightCx} cy={cy} r={r} color={colors.firefighters} />
    </Group>
  );
}

function DashedRing({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r} opacity={0.35}>
        <RadialGradient c={vec(cx, cy)} r={r * 1.6} colors={[color + '66', color + '00']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={color} style="stroke" strokeWidth={2}>
        <DashPathEffect intervals={[6, 3]} />
      </Circle>
    </Group>
  );
}

function MiniFullMap({ W, H }: { W: number; H: number }) {
  // A compact rendering of the whole map — triangle + sides + center + bottom diamond.
  const apex = { x: W / 2, y: H * 0.14 };
  const right = { x: W * 0.82, y: H * 0.68 };
  const left = { x: W * 0.18, y: H * 0.68 };
  const center = { x: W / 2, y: H * 0.52 };
  const mgr = { x: W * 0.08, y: H * 0.4 };
  const ff = { x: W * 0.92, y: H * 0.4 };
  const diamond = { x: W / 2, y: H * 0.86, s: W * 0.06 };
  const atmY = (left.y + right.y) / 2 - H * 0.05;
  const nodeR = W * 0.07;

  return (
    <Group>
      {/* atmosphere */}
      <Circle cx={W / 2} cy={atmY} r={W * 0.38} opacity={0.35}>
        <RadialGradient c={vec(W / 2, atmY)} r={W * 0.42} colors={['rgba(177,156,217,0.3)', 'rgba(177,156,217,0)']} />
      </Circle>
      {/* lines */}
      <Line p1={vec(apex.x, apex.y)} p2={vec(left.x, left.y)}   color="#5a5a8a" strokeWidth={1} style="stroke" />
      <Line p1={vec(apex.x, apex.y)} p2={vec(right.x, right.y)} color="#5a5a8a" strokeWidth={1} style="stroke" />
      <Line p1={vec(left.x, left.y)} p2={vec(right.x, right.y)} color="#5a5a8a" strokeWidth={1} style="stroke" />
      {/* side rings */}
      <DashedRing cx={mgr.x} cy={mgr.y} r={nodeR * 1.2} color={colors.managers} />
      <DashedRing cx={ff.x}  cy={ff.y}  r={nodeR * 1.2} color={colors.firefighters} />
      {/* self */}
      <SelfGlow cx={center.x} cy={center.y} r={nodeR * 1.3} />
      {/* triangle vertices */}
      <SingleGlow cx={apex.x}  cy={apex.y}  r={nodeR} color={colors.wound} />
      <SingleGlow cx={right.x} cy={right.y} r={nodeR} color={colors.fixer} />
      <SingleGlow cx={left.x}  cy={left.y}  r={nodeR} color={colors.skeptic} />
      {/* diamond */}
      <SelfLikeDiamond cx={diamond.x} cy={diamond.y} size={diamond.s} />
    </Group>
  );
}
