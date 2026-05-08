// Per-slide Skia illustration for the relationship-mode intro carousel.
// Six static cosmologies that mirror the existing main-app onboarding
// aesthetic — deep dark sky, soft starfield, glowing amber orbs.
//
// Static on purpose. Animated Skia has been a fragile path on this
// project (see the SafetyCapacitySafe / SurvivalModeSafe pattern in
// GuideNodeVisual.tsx); the intro slides are a one-shot moment, the
// motion comes from the typewriter on the body text + the
// page-to-page carousel transition, not from the visuals themselves.

import React, { useMemo } from 'react';
import {
  Canvas, Circle, Group, Path, RadialGradient, Skia, vec,
} from '@shopify/react-native-skia';

type Props = { slide: number; size?: number };

export function RelationshipIntroVisual({ slide, size = 220 }: Props) {
  const W = size;
  const H = size;
  if (!W || !H || isNaN(W) || isNaN(H) || W <= 0 || H <= 0) return null;
  const cx = W / 2;
  const cy = H / 2;

  // Pre-baked starfield. Deterministic offsets (seeded layout) so every
  // slide shares the same starscape and the carousel feels like one
  // continuous sky. Generated once via useMemo — Skia primitives are
  // cheap once the props are stable.
  const stars = useMemo(() => {
    const seed = [
      [0.08, 0.12, 0.6], [0.22, 0.04, 0.4], [0.41, 0.18, 0.5], [0.58, 0.07, 0.7], [0.74, 0.14, 0.5],
      [0.89, 0.05, 0.6], [0.13, 0.32, 0.5], [0.31, 0.27, 0.7], [0.49, 0.34, 0.4], [0.66, 0.31, 0.5],
      [0.81, 0.39, 0.6], [0.05, 0.52, 0.4], [0.20, 0.59, 0.7], [0.36, 0.55, 0.5], [0.55, 0.62, 0.4],
      [0.72, 0.55, 0.6], [0.91, 0.61, 0.5], [0.11, 0.74, 0.5], [0.27, 0.83, 0.6], [0.43, 0.78, 0.4],
      [0.59, 0.86, 0.5], [0.75, 0.79, 0.6], [0.92, 0.86, 0.4], [0.18, 0.94, 0.5], [0.46, 0.93, 0.6],
      [0.65, 0.96, 0.4], [0.85, 0.96, 0.5],
    ] as const;
    return seed.map(([fx, fy, op]) => ({
      x: fx * W,
      y: fy * H,
      r: op > 0.55 ? 1.1 : 0.7,
      opacity: 0.18 + op * 0.18,
    }));
  }, [W, H]);

  return (
    <Canvas style={{ width: W, height: H }}>
      {/* Starfield — same across all six slides for sky continuity. */}
      <Group>
        {stars.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={s.r} color={`rgba(242, 236, 226, ${s.opacity})`} />
        ))}
      </Group>

      {slide === 1 ? <SlideTwoOrbsApproaching W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 2 ? <SlideThreeSpaces W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 3 ? <SlideObserver W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 4 ? <SlideThreshold W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 5 ? <SlideHorizon W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 6 ? <SlideTwoOrbsTogether W={W} H={H} cx={cx} cy={cy} /> : null}
    </Canvas>
  );
}

// =============================================================================
// Per-slide compositions. Each is a stateless functional Skia subtree
// that takes the canvas geometry as plain numbers and emits primitives.
// All glow is static — RadialGradient on a larger transparent circle
// behind a smaller solid one.
// =============================================================================

const AMBER_CORE   = '#E6B47A';
const AMBER_BRIGHT = '#F0C890';
const AMBER_GLOW   = 'rgba(230,180,122,0.55)';
const AMBER_FAINT  = 'rgba(230,180,122,0.18)';
const CREAM        = '#F2ECE2';

// One reusable orb primitive — a soft glow halo (radial gradient) plus
// a brighter solid core. Caller controls position, size, brightness.
function GlowOrb({
  cx, cy, r, dim,
}: { cx: number; cy: number; r: number; dim?: boolean }) {
  // Halo extends ~2.4× the core radius. The radial gradient fades from
  // amber at center to fully transparent at the halo edge so the orb
  // feels embedded in the sky rather than pasted onto it.
  const haloR = r * 2.4;
  const coreColor = dim ? AMBER_CORE : AMBER_BRIGHT;
  const haloOuter = dim ? 'rgba(230,180,122,0.0)' : 'rgba(230,180,122,0.0)';
  const haloInner = dim ? 'rgba(230,180,122,0.18)' : AMBER_GLOW;
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={haloR}>
        <RadialGradient
          c={vec(cx, cy)}
          r={haloR}
          colors={[haloInner, haloOuter]}
        />
      </Circle>
      <Circle cx={cx} cy={cy} r={r} color={coreColor} opacity={dim ? 0.7 : 1} />
    </Group>
  );
}

// SLIDE 1 — Two glowing orbs slowly approaching, not touching.
//   Equal-brightness orbs offset from center, with a faint connecting
//   thread between them suggesting the relationship-in-formation.
function SlideTwoOrbsApproaching({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const r = W * 0.07;
  const sep = W * 0.16;
  const lx = cx - sep;
  const rx = cx + sep;
  const linePath = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(lx + r, cy);
    p.lineTo(rx - r, cy);
    return p;
  }, [lx, rx, r, cy]);
  return (
    <Group>
      <Path path={linePath} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      <GlowOrb cx={lx} cy={cy} r={r} />
      <GlowOrb cx={rx} cy={cy} r={r} />
    </Group>
  );
}

// SLIDE 2 — Two private outer orbs + one brighter shared middle space.
//   The outer pair is dimmed to read as private; the middle space is a
//   larger softer glow representing the shared zone.
function SlideThreeSpaces({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const r = W * 0.06;
  const sideOffset = W * 0.28;
  const middleR = W * 0.10;
  return (
    <Group>
      {/* Middle shared space — bigger, softer. Halo dominates over the core. */}
      <Circle cx={cx} cy={cy} r={middleR * 2.2}>
        <RadialGradient
          c={vec(cx, cy)}
          r={middleR * 2.2}
          colors={['rgba(230,180,122,0.35)', 'rgba(230,180,122,0.0)']}
        />
      </Circle>
      <Circle cx={cx} cy={cy} r={middleR * 0.8} color={AMBER_BRIGHT} opacity={0.85} />
      {/* Two private outer orbs, dimmed. */}
      <GlowOrb cx={cx - sideOffset} cy={cy} r={r} dim />
      <GlowOrb cx={cx + sideOffset} cy={cy} r={r} dim />
    </Group>
  );
}

// SLIDE 3 — Central observing presence with light gently flowing
//   between two distant orbs. The observer is a concentric-ring "eye";
//   the two orbs sit at the canvas edges and a single curved thread
//   passes through the observer suggesting the AI's view across both.
function SlideObserver({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const orbR = W * 0.05;
  const eyeR = W * 0.06;
  const lx = cx - W * 0.34;
  const rx = cx + W * 0.34;
  const threadPath = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(lx + orbR, cy);
    p.cubicTo(cx - eyeR * 1.5, cy - H * 0.05, cx + eyeR * 1.5, cy + H * 0.05, rx - orbR, cy);
    return p;
  }, [lx, rx, orbR, cx, cy, eyeR, H]);
  return (
    <Group>
      <Path path={threadPath} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      <GlowOrb cx={lx} cy={cy} r={orbR} dim />
      <GlowOrb cx={rx} cy={cy} r={orbR} dim />
      {/* Observer eye — concentric rings with a bright pupil. */}
      <Circle cx={cx} cy={cy} r={eyeR * 2.4}>
        <RadialGradient
          c={vec(cx, cy)}
          r={eyeR * 2.4}
          colors={[AMBER_GLOW, 'rgba(230,180,122,0.0)']}
        />
      </Circle>
      <Circle cx={cx} cy={cy} r={eyeR * 1.4} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      <Circle cx={cx} cy={cy} r={eyeR} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      <Circle cx={cx} cy={cy} r={eyeR * 0.4} color={CREAM} />
    </Group>
  );
}

// SLIDE 4 — A glowing vertical threshold between two spaces, with a
//   small key element. Two faint orbs flank the gate; the gate itself
//   is a tall slim glow column with a horizontal cross-bar near the
//   center suggesting a key-shaped opening.
function SlideThreshold({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const orbR = W * 0.05;
  const lx = cx - W * 0.30;
  const rx = cx + W * 0.30;
  const gateW = W * 0.04;
  const gateH = H * 0.42;
  const keyBow = useMemo(() => {
    const p = Skia.Path.Make();
    // A small ring (the key bow) sitting just above center on the gate.
    p.addCircle(cx, cy - H * 0.06, W * 0.022);
    return p;
  }, [cx, cy, W, H]);
  return (
    <Group>
      <GlowOrb cx={lx} cy={cy} r={orbR} dim />
      <GlowOrb cx={rx} cy={cy} r={orbR} dim />
      {/* Gate halo (broad soft glow). */}
      <Circle cx={cx} cy={cy} r={W * 0.18}>
        <RadialGradient
          c={vec(cx, cy)}
          r={W * 0.18}
          colors={['rgba(230,180,122,0.22)', 'rgba(230,180,122,0.0)']}
        />
      </Circle>
      {/* Gate column — solid amber, tall + slim. */}
      <Group>
        <Circle cx={cx} cy={cy - gateH / 2} r={gateW / 2} color={AMBER_BRIGHT} opacity={0.9} />
        <Circle cx={cx} cy={cy + gateH / 2} r={gateW / 2} color={AMBER_BRIGHT} opacity={0.9} />
        <Path
          path={(() => {
            const p = Skia.Path.Make();
            p.moveTo(cx - gateW / 2, cy - gateH / 2);
            p.lineTo(cx + gateW / 2, cy - gateH / 2);
            p.lineTo(cx + gateW / 2, cy + gateH / 2);
            p.lineTo(cx - gateW / 2, cy + gateH / 2);
            p.close();
            return p;
          })()}
          color={AMBER_BRIGHT}
          opacity={0.9}
        />
      </Group>
      {/* Key bow + bit. */}
      <Path path={keyBow} color={CREAM} style="stroke" strokeWidth={1.5} />
      <Path
        path={(() => {
          const p = Skia.Path.Make();
          p.moveTo(cx, cy - H * 0.04);
          p.lineTo(cx, cy + H * 0.06);
          p.moveTo(cx, cy + H * 0.04);
          p.lineTo(cx + W * 0.018, cy + H * 0.04);
          p.moveTo(cx, cy + H * 0.06);
          p.lineTo(cx + W * 0.025, cy + H * 0.06);
          return p;
        })()}
        color={CREAM}
        style="stroke"
        strokeWidth={1.2}
      />
    </Group>
  );
}

// SLIDE 5 — Steady, grounding visual. A horizon line with a single
//   quiet orb above it. The horizon is a soft amber gradient strip
//   spanning the canvas. Calm and stable.
function SlideHorizon({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const orbR = W * 0.07;
  const orbY = cy - H * 0.05;
  const horizonY = cy + H * 0.18;
  return (
    <Group>
      {/* Horizon — a soft linear glow band across the canvas. */}
      <Path
        path={(() => {
          const p = Skia.Path.Make();
          p.moveTo(W * 0.12, horizonY);
          p.lineTo(W * 0.88, horizonY);
          return p;
        })()}
        color={AMBER_GLOW}
        style="stroke"
        strokeWidth={1.4}
      />
      <Path
        path={(() => {
          const p = Skia.Path.Make();
          p.moveTo(W * 0.22, horizonY + 6);
          p.lineTo(W * 0.78, horizonY + 6);
          return p;
        })()}
        color={AMBER_FAINT}
        style="stroke"
        strokeWidth={1}
      />
      {/* Single orb above the horizon. */}
      <GlowOrb cx={cx} cy={orbY} r={orbR} />
    </Group>
  );
}

// SLIDE 6 — Two orbs held together in a soft shared light. Completes
//   the visual arc from slide 1 (orbs separate) through slide 6 (orbs
//   joined). The two cores almost touch at center; a single broad halo
//   embraces both.
function SlideTwoOrbsTogether({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const r = W * 0.075;
  const overlap = r * 0.95;
  const lx = cx - overlap;
  const rx = cx + overlap;
  const haloR = W * 0.22;
  return (
    <Group>
      {/* One shared halo embracing both orbs — defines them as a couple. */}
      <Circle cx={cx} cy={cy} r={haloR}>
        <RadialGradient
          c={vec(cx, cy)}
          r={haloR}
          colors={['rgba(230,180,122,0.45)', 'rgba(230,180,122,0.0)']}
        />
      </Circle>
      {/* Two cores, touching but distinct — relationship as union, not
          fusion. Slight color split (amber vs amber-bright) so they
          read as two presences rather than one blurred shape. */}
      <Circle cx={lx} cy={cy} r={r} color={AMBER_CORE} opacity={0.95} />
      <Circle cx={rx} cy={cy} r={r} color={AMBER_BRIGHT} opacity={0.95} />
    </Group>
  );
}
