// Per-slide Skia illustration for the relationship-mode intro
// carousel. Six themed cosmologies, each with a subtle Reanimated
// motion — Skia primitives consume Reanimated shared/derived values
// directly (the runtime auto-wires the bridge when both libs are
// present), so the visuals breathe without any JS-thread render
// loop.
//
// Motion is intentionally restrained — slow opacity/scale waves, no
// hard transitions. The point is that the visuals feel alive next
// to the static title + body text, not that they grab attention.
//
// Slide order mirrors RelationshipIntroCarousel.SLIDES (1-based):
//   1  Entering this together         — two orbs approaching, breathing
//   2  Your space stays yours         — two private orbs + shared middle pulse
//   3  The map view                   — two side-by-side mini-constellations, twinkling
//   4  What the AI sees and does      — observer eye between two orbs, iris breathing
//   5  If something doesn't feel safe — horizon line + single orb, soft shimmer
//   6  Entering together              — two orbs joined under a shared halo, halo breathing

import React, { useEffect, useMemo } from 'react';
import {
  Canvas, Circle, Group, Path, RadialGradient, Skia, vec,
} from '@shopify/react-native-skia';
import {
  useSharedValue, useDerivedValue,
  withRepeat, withTiming, Easing,
} from 'react-native-reanimated';

type Props = { slide: number; size?: number };

export function RelationshipIntroVisual({ slide, size = 220 }: Props) {
  const W = size;
  const H = size;
  if (!W || !H || isNaN(W) || isNaN(H) || W <= 0 || H <= 0) return null;
  const cx = W / 2;
  const cy = H / 2;

  // Pre-baked starfield. Deterministic offsets (seeded layout) so every
  // slide shares the same starscape and the carousel feels like one
  // continuous sky. Memoized once — Skia primitives are cheap once the
  // props are stable.
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

      {slide === 1 ? <SlideOrbsApproaching W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 2 ? <SlideThreeSpaces W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 3 ? <SlideMapView W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 4 ? <SlideObserver W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 5 ? <SlideHorizon W={W} H={H} cx={cx} cy={cy} /> : null}
      {slide === 6 ? <SlideOrbsJoined W={W} H={H} cx={cx} cy={cy} /> : null}
    </Canvas>
  );
}

// =============================================================================
// Per-slide compositions. Each is a stateless functional Skia subtree
// that takes the canvas geometry as plain numbers and emits
// primitives. Animation is driven by a per-slide useSharedValue cycled
// via withRepeat → fed into Skia via useDerivedValue. Skia's primitive
// props accept reanimated values directly, so no useFrameCallback / JS
// re-render loop is needed.
// =============================================================================

const AMBER_CORE   = '#E6B47A';
const AMBER_BRIGHT = '#F0C890';
const AMBER_GLOW   = 'rgba(230,180,122,0.55)';
const AMBER_FAINT  = 'rgba(230,180,122,0.18)';
const CREAM        = '#F2ECE2';

// SLIDE 1 — Entering this together.
//   Two equal orbs gently breathing in unison. Their cores stay put
//   but the halo radii expand/contract together to suggest a paired
//   presence finding rhythm.
function SlideOrbsApproaching({ W, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const r = W * 0.07;
  const sep = W * 0.18;
  const lx = cx - sep;
  const rx = cx + sep;

  // Single breathing value — both orbs share it so they pulse together.
  // Range 0..1; ease in-out so the peak and trough are soft.
  const breathe = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
      -1, true,
    );
  }, [breathe]);
  // Halo radius oscillates ±15% around its base. Opacity follows the
  // same wave so the halo brightens as it expands.
  const haloR = useDerivedValue(() => r * 2.4 * (0.9 + breathe.value * 0.3));
  const haloOpacity = useDerivedValue(() => 0.35 + breathe.value * 0.25);

  // Faint connecting thread between the orbs — always-on, communicates
  // the "two figures coming into orbit" idea without requiring motion.
  const linePath = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(lx + r, cy);
    p.lineTo(rx - r, cy);
    return p;
  }, [lx, rx, r, cy]);

  return (
    <Group>
      <Path path={linePath} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      {/* Left orb halo + core. */}
      <Circle cx={lx} cy={cy} r={haloR} opacity={haloOpacity}>
        <RadialGradient
          c={vec(lx, cy)}
          r={r * 3}
          colors={[AMBER_GLOW, 'rgba(230,180,122,0)']}
        />
      </Circle>
      <Circle cx={lx} cy={cy} r={r} color={AMBER_BRIGHT} />
      {/* Right orb halo + core. */}
      <Circle cx={rx} cy={cy} r={haloR} opacity={haloOpacity}>
        <RadialGradient
          c={vec(rx, cy)}
          r={r * 3}
          colors={[AMBER_GLOW, 'rgba(230,180,122,0)']}
        />
      </Circle>
      <Circle cx={rx} cy={cy} r={r} color={AMBER_BRIGHT} />
    </Group>
  );
}

// SLIDE 2 — Your space stays yours.
//   Two outer private orbs (dimmer) + a brighter shared middle space.
//   Outer orbs pulse independently (slightly offset phase) — each
//   partner breathing on their own. Shared middle space glows on
//   only when both outer orbs are bright — emerges from agreement.
function SlideThreeSpaces({ W, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const r = W * 0.06;
  const sideOffset = W * 0.28;
  const middleR = W * 0.10;

  // Two independent breathing values — slightly different periods so
  // their peaks drift in and out of phase, like two breaths almost
  // syncing.
  const lBreath = useSharedValue(0);
  const rBreath = useSharedValue(0);
  useEffect(() => {
    lBreath.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      -1, true,
    );
    rBreath.value = withRepeat(
      withTiming(1, { duration: 3100, easing: Easing.inOut(Easing.sin) }),
      -1, true,
    );
  }, [lBreath, rBreath]);

  const lOpacity = useDerivedValue(() => 0.55 + lBreath.value * 0.35);
  const rOpacity = useDerivedValue(() => 0.55 + rBreath.value * 0.35);
  // Shared middle space glows brightest when BOTH outer orbs are
  // bright — the visual analog of "agreement." Range ~0.25..0.7.
  const middleOpacity = useDerivedValue(
    () => 0.25 + (lBreath.value * rBreath.value) * 0.55,
  );
  const middleHaloR = useDerivedValue(
    () => middleR * 2.2 * (0.95 + lBreath.value * rBreath.value * 0.15),
  );

  return (
    <Group>
      {/* Middle shared space — halo + soft core. Both pulse with the
          product of the two outer breaths. */}
      <Circle cx={cx} cy={cy} r={middleHaloR} opacity={middleOpacity}>
        <RadialGradient
          c={vec(cx, cy)}
          r={middleR * 2.5}
          colors={['rgba(230,180,122,0.45)', 'rgba(230,180,122,0)']}
        />
      </Circle>
      <Circle cx={cx} cy={cy} r={middleR * 0.7} color={AMBER_BRIGHT} opacity={middleOpacity} />

      {/* Two private outer orbs. */}
      <Circle cx={cx - sideOffset} cy={cy} r={r * 1.8} opacity={lOpacity}>
        <RadialGradient
          c={vec(cx - sideOffset, cy)}
          r={r * 2.4}
          colors={[AMBER_GLOW, 'rgba(230,180,122,0)']}
        />
      </Circle>
      <Circle cx={cx - sideOffset} cy={cy} r={r} color={AMBER_CORE} />

      <Circle cx={cx + sideOffset} cy={cy} r={r * 1.8} opacity={rOpacity}>
        <RadialGradient
          c={vec(cx + sideOffset, cy)}
          r={r * 2.4}
          colors={[AMBER_GLOW, 'rgba(230,180,122,0)']}
        />
      </Circle>
      <Circle cx={cx + sideOffset} cy={cy} r={r} color={AMBER_CORE} />
    </Group>
  );
}

// SLIDE 3 — The map view.
//   Two side-by-side mini-constellations — each a small set of
//   connected stars suggesting a structural "map" of someone's
//   inner parts. Stars twinkle on independent phases.
function SlideMapView({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  // Each constellation is a small array of relative positions. Two
  // copies — one on each side, offset horizontally. The connecting
  // paths trace through the stars in order.
  const leftCx = cx - W * 0.22;
  const rightCx = cx + W * 0.22;
  const scale = W * 0.12;
  const constellation: Array<[number, number]> = [
    [0,    -0.8],
    [0.7,  -0.2],
    [0.4,   0.6],
    [-0.5,  0.4],
    [-0.6, -0.4],
  ];

  // Build the path connecting the constellation stars in order.
  const leftPath = useMemo(() => {
    const p = Skia.Path.Make();
    constellation.forEach(([dx, dy], i) => {
      const x = leftCx + dx * scale;
      const y = cy + dy * scale;
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    });
    p.close();
    return p;
  }, [leftCx, cy, scale]);
  const rightPath = useMemo(() => {
    const p = Skia.Path.Make();
    constellation.forEach(([dx, dy], i) => {
      const x = rightCx + dx * scale;
      const y = cy + dy * scale;
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    });
    p.close();
    return p;
  }, [rightCx, cy, scale]);

  // Twinkle value drives the brightness of all stars. The phase
  // offset between left and right is achieved by squaring vs.
  // (1 - value) — a cheap trick that keeps both within [0,1] but
  // out of phase.
  const twinkle = useSharedValue(0);
  useEffect(() => {
    twinkle.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1, true,
    );
  }, [twinkle]);
  const leftStarOpacity = useDerivedValue(() => 0.55 + twinkle.value * 0.35);
  const rightStarOpacity = useDerivedValue(() => 0.55 + (1 - twinkle.value) * 0.35);
  const linkOpacity = useDerivedValue(() => 0.25 + twinkle.value * 0.15);

  return (
    <Group>
      {/* Faint connecting strokes — these are the "structure" of each
          map. Low opacity so the stars dominate. */}
      <Path path={leftPath} color={AMBER_GLOW} style="stroke" strokeWidth={0.8} opacity={linkOpacity} />
      <Path path={rightPath} color={AMBER_GLOW} style="stroke" strokeWidth={0.8} opacity={linkOpacity} />

      {/* Left constellation stars. */}
      {constellation.map(([dx, dy], i) => {
        const x = leftCx + dx * scale;
        const y = cy + dy * scale;
        return (
          <Group key={`l-${i}`}>
            <Circle cx={x} cy={y} r={3.2} color={AMBER_BRIGHT} opacity={leftStarOpacity} />
            <Circle cx={x} cy={y} r={6} opacity={leftStarOpacity}>
              <RadialGradient
                c={vec(x, y)}
                r={6}
                colors={[AMBER_GLOW, 'rgba(230,180,122,0)']}
              />
            </Circle>
          </Group>
        );
      })}

      {/* Right constellation stars — same structure, opposite phase. */}
      {constellation.map(([dx, dy], i) => {
        const x = rightCx + dx * scale;
        const y = cy + dy * scale;
        return (
          <Group key={`r-${i}`}>
            <Circle cx={x} cy={y} r={3.2} color={AMBER_BRIGHT} opacity={rightStarOpacity} />
            <Circle cx={x} cy={y} r={6} opacity={rightStarOpacity}>
              <RadialGradient
                c={vec(x, y)}
                r={6}
                colors={[AMBER_GLOW, 'rgba(230,180,122,0)']}
              />
            </Circle>
          </Group>
        );
      })}
    </Group>
  );
}

// SLIDE 4 — What the AI sees and does.
//   Central observing presence (concentric-ring "eye") flanked by two
//   distant private orbs. A single curved thread passes through the
//   observer suggesting it sees across both. The iris dilates/contracts
//   slowly — the AI's "noticing."
function SlideObserver({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const orbR = W * 0.05;
  const eyeR = W * 0.06;
  const lx = cx - W * 0.32;
  const rx = cx + W * 0.32;

  // Iris breathing — pupil radius oscillates ~0.3..0.5 × eyeR.
  const iris = useSharedValue(0);
  useEffect(() => {
    iris.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
      -1, true,
    );
  }, [iris]);
  const pupilR = useDerivedValue(() => eyeR * (0.32 + iris.value * 0.22));
  const haloOpacity = useDerivedValue(() => 0.4 + iris.value * 0.3);

  const threadPath = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(lx + orbR, cy);
    p.cubicTo(cx - eyeR * 1.5, cy - H * 0.05, cx + eyeR * 1.5, cy + H * 0.05, rx - orbR, cy);
    return p;
  }, [lx, rx, orbR, cx, cy, eyeR, H]);

  return (
    <Group>
      <Path path={threadPath} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      {/* Two flanking orbs — dim, communicate the private spaces. */}
      <Circle cx={lx} cy={cy} r={orbR * 2} opacity={0.4}>
        <RadialGradient c={vec(lx, cy)} r={orbR * 2.4} colors={[AMBER_GLOW, 'rgba(230,180,122,0)']} />
      </Circle>
      <Circle cx={lx} cy={cy} r={orbR} color={AMBER_CORE} opacity={0.75} />
      <Circle cx={rx} cy={cy} r={orbR * 2} opacity={0.4}>
        <RadialGradient c={vec(rx, cy)} r={orbR * 2.4} colors={[AMBER_GLOW, 'rgba(230,180,122,0)']} />
      </Circle>
      <Circle cx={rx} cy={cy} r={orbR} color={AMBER_CORE} opacity={0.75} />

      {/* Observer eye — animated halo + concentric rings + breathing pupil. */}
      <Circle cx={cx} cy={cy} r={eyeR * 2.4} opacity={haloOpacity}>
        <RadialGradient c={vec(cx, cy)} r={eyeR * 2.4} colors={[AMBER_GLOW, 'rgba(230,180,122,0)']} />
      </Circle>
      <Circle cx={cx} cy={cy} r={eyeR * 1.4} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      <Circle cx={cx} cy={cy} r={eyeR} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      <Circle cx={cx} cy={cy} r={pupilR} color={CREAM} />
    </Group>
  );
}

// SLIDE 5 — If something doesn't feel safe.
//   A single quiet orb above a horizon line. Calm and stable. The
//   horizon shimmers very faintly (low-amplitude opacity wave) so
//   the slide doesn't feel dead, but never alarms.
function SlideHorizon({ W, H, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const orbR = W * 0.07;
  const orbY = cy - H * 0.05;
  const horizonY = cy + H * 0.18;

  // Horizon shimmer — very low amplitude (0.4..0.65). Slow period.
  const shimmer = useSharedValue(0);
  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 3600, easing: Easing.inOut(Easing.sin) }),
      -1, true,
    );
  }, [shimmer]);
  const horizonOpacity = useDerivedValue(() => 0.4 + shimmer.value * 0.25);
  const orbHaloOpacity = useDerivedValue(() => 0.5 + shimmer.value * 0.2);

  const horizonPath = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(W * 0.12, horizonY);
    p.lineTo(W * 0.88, horizonY);
    return p;
  }, [W, horizonY]);
  const horizonGhost = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(W * 0.22, horizonY + 6);
    p.lineTo(W * 0.78, horizonY + 6);
    return p;
  }, [W, horizonY]);

  return (
    <Group>
      <Path path={horizonPath} color={AMBER_GLOW} style="stroke" strokeWidth={1.4} opacity={horizonOpacity} />
      <Path path={horizonGhost} color={AMBER_FAINT} style="stroke" strokeWidth={1} />
      {/* Single orb above the horizon. */}
      <Circle cx={cx} cy={orbY} r={orbR * 2.4} opacity={orbHaloOpacity}>
        <RadialGradient c={vec(cx, orbY)} r={orbR * 2.6} colors={[AMBER_GLOW, 'rgba(230,180,122,0)']} />
      </Circle>
      <Circle cx={cx} cy={orbY} r={orbR} color={AMBER_BRIGHT} />
    </Group>
  );
}

// SLIDE 6 — Entering together.
//   Two orbs sharing a single embracing halo — completes the visual
//   arc from slide 1 (orbs separate, two halos) through slide 6
//   (orbs joined, one halo). The shared halo pulses softly — the
//   couple's "shared breath."
function SlideOrbsJoined({ W, cx, cy }: { W: number; H: number; cx: number; cy: number }) {
  const r = W * 0.075;
  const overlap = r * 0.95;
  const lx = cx - overlap;
  const rx = cx + overlap;
  const haloR = W * 0.22;

  const breathe = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
      -1, true,
    );
  }, [breathe]);
  const haloOpacity = useDerivedValue(() => 0.55 + breathe.value * 0.35);
  const haloRadius = useDerivedValue(() => haloR * (0.92 + breathe.value * 0.18));

  return (
    <Group>
      {/* One shared halo embracing both orbs — defines them as a couple. */}
      <Circle cx={cx} cy={cy} r={haloRadius} opacity={haloOpacity}>
        <RadialGradient
          c={vec(cx, cy)}
          r={haloR * 1.2}
          colors={['rgba(230,180,122,0.55)', 'rgba(230,180,122,0)']}
        />
      </Circle>
      {/* Two cores, touching but distinct — relationship as union, not
          fusion. Slight color split so they read as two presences
          rather than one blurred shape. */}
      <Circle cx={lx} cy={cy} r={r} color={AMBER_CORE} opacity={0.95} />
      <Circle cx={rx} cy={cy} r={r} color={AMBER_BRIGHT} opacity={0.95} />
    </Group>
  );
}
