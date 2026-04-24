// Geometry helpers for the inner map. Keeps all coordinate math in one file so the
// layout can be tuned in isolation from the drawing components.
//
// We treat the canvas as a flex-1 container and compute positions from its measured
// width + height. Proportions follow the web app's 390x650 mobile viewBox so the
// visual identity ports over: Wound at top-center, Fixer bottom-right, Skeptic
// bottom-left, Self near-center, Self-Like bottom-center, Managers/Firefighters on
// the far left/right.

export type MapGeometry = {
  width: number;
  height: number;
  wound: Node;
  fixer: Node;
  skeptic: Node;
  self: Node;
  selfLike: Diamond;
  managers: Node;
  firefighters: Node;
  triangle: [Point, Point, Point, Point]; // closed polyline
  atmosphere: Ellipse;
};

export type Point = { x: number; y: number };
export type Node = { x: number; y: number; r: number };
export type Diamond = { cx: number; cy: number; size: number };
export type Ellipse = { cx: number; cy: number; rx: number; ry: number };

export function computeMapGeometry(width: number, height: number): MapGeometry {
  // Proportional placement so the map breathes naturally across devices:
  // - Wound sits high (top 14%) for primacy.
  // - Fixer / Skeptic sit at bottom ~82%, hugging the bottom corners but indented
  //   so full rings stay inside the viewport even on narrow iPhones.
  // - Self is slightly below the visual center for better optical balance.
  // - Managers / Firefighters float on the sides, below the Wound and above the
  //   bottom nodes so tapping them doesn't collide with the triangle.
  const cx = width / 2;
  const woundCy = height * 0.15;
  const bottomY = height * 0.78;
  const sideY  = height * 0.44;

  // All radii bumped ~20% so the map feels substantial. Side-rings pushed
  // slightly further in (x: 52 -> 62) to give the larger circles clearance
  // from the edge on narrow iPhones.
  const wound: Node     = { x: cx,            y: woundCy,          r: 54 };
  const fixer: Node     = { x: width - 74,    y: bottomY,          r: 46 };
  const skeptic: Node   = { x: 74,            y: bottomY,          r: 46 };
  const self: Node      = { x: cx,            y: height * 0.55,    r: 36 };
  // Self-Like diamond. Previously at 0.86 which put it right where the
  // bottom-center mic FAB lives (bottom:52 + ~88px of button+pill stack).
  // Pulled up to 0.80 — moves the diamond ~35-45px up on a typical iPhone
  // map canvas, leaving clear air between the diamond's top edge and the
  // mic button's status pill so they never touch regardless of device size.
  const selfLike: Diamond = { cx: cx,         cy: height * 0.80,   size: 22 };
  const managers: Node   = { x: 62,           y: sideY,            r: 52 };
  const firefighters: Node = { x: width - 62, y: sideY,            r: 52 };

  const triangle: [Point, Point, Point, Point] = [
    { x: wound.x, y: wound.y },
    { x: fixer.x, y: fixer.y },
    { x: skeptic.x, y: skeptic.y },
    { x: wound.x, y: wound.y },
  ];

  // Atmospheric glow between Fixer and Skeptic — a soft purple haze below Self.
  const atmosphere: Ellipse = {
    cx: cx,
    cy: (fixer.y + skeptic.y) / 2 - 20,
    rx: width * 0.38,
    ry: height * 0.08,
  };

  return { width, height, wound, fixer, skeptic, self, selfLike, managers, firefighters, triangle, atmosphere };
}
