// Two-triangle Skia visual for the Relationship Map sub-view.
//
// Each partner's triangle: Wound (top), Fixer (bottom-right),
// Skeptic (bottom-left), Self-Like (center). Same node-color palette
// as the main app's InnerMapCanvas so the visual landscape is
// consistent across tabs.
//
// Empty-state nodes (text === null) render dim and small, with the
// node-color barely visible — they read as "not yet identified."
// Confirmed nodes render at full strength with a soft glow halo.
// The four-pointed triangle outline is dim until at least one node
// has content, then steps up to its category color.
//
// Shared-wound state — when sharedWound.active is true, both wound
// circles render as a uniform amber and a glowing connecting line
// links them across the canvas. The two partners' wound nodes
// otherwise stay in the standard wound red.
//
// Static visuals (no animated Skia primitives) — same fragility
// trade-off the existing GuideNodeVisual + RelationshipIntroVisual
// make. The motion comes from React-side state changes
// (re-renders on data refresh).

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Canvas, Circle, Group, Path, RadialGradient, Skia, vec,
} from '@shopify/react-native-skia';

import { colors, fonts, spacing } from '../../constants/theme';

export type NodeData = { text: string | null; confirmed: boolean };
export type PartnerParts = {
  wound: NodeData;
  fixer: NodeData;
  skeptic: NodeData;
  selfLike: NodeData;
};

type Variant = 'full' | 'compact';

type Props = {
  myParts: PartnerParts;
  partnerParts: PartnerParts;
  myLabel: string;
  partnerLabel: string;
  sharedWoundActive?: boolean;
  variant?: Variant;
  /** Override the canvas width. Defaults are tuned for `full` (sub-view)
   *  vs `compact` (pinned at top of Shared feed). */
  width?: number;
};

// Per-node palette — mirrors constants/theme.ts and the Map tab.
const COLORS = {
  wound:    '#E05050',
  fixer:    '#E6B47A',
  skeptic:  '#86BDDC',
  selfLike: '#8A7AAA',
};
const SHARED_WOUND = '#E6B47A'; // both wounds glow amber when shared
const DIM_OUTLINE  = 'rgba(242, 236, 226, 0.16)';

export function RelationshipMapVisual({
  myParts, partnerParts, myLabel, partnerLabel,
  sharedWoundActive = false,
  variant = 'full',
  width,
}: Props) {
  const isCompact = variant === 'compact';
  const W = width ?? (isCompact ? 320 : 360);
  const H = isCompact ? 140 : 220;
  if (!W || !H || W <= 0 || H <= 0) return null;

  // Two triangles laid horizontally with a small gutter between them.
  // Each occupies ~45% of the canvas width.
  const triW = W * 0.45;
  const gutter = W * 0.10;
  const leftCenterX  = (W - gutter) / 2 - triW / 2 + W * 0.025;
  const rightCenterX = (W + gutter) / 2 + triW / 2 - W * 0.025;

  // Slight vertical breathing room top + bottom.
  const triH = H * 0.78;
  const triTopY    = H * 0.10;
  const triBottomY = triTopY + triH;
  const woundY = triTopY;
  const baseY  = triBottomY;
  const selfY  = triTopY + triH * 0.55;

  // Use compact node sizing when small.
  const r        = isCompact ? 7   : 11;
  const rGlowMul = 2.4;

  // Build node positions for each triangle.
  function nodes(centerX: number) {
    return {
      wound:    { cx: centerX,                  cy: woundY },
      fixer:    { cx: centerX + triW * 0.40,    cy: baseY },
      skeptic:  { cx: centerX - triW * 0.40,    cy: baseY },
      selfLike: { cx: centerX,                  cy: selfY },
    };
  }
  const leftNodes  = nodes(leftCenterX);
  const rightNodes = nodes(rightCenterX);

  // Triangle outline path. Dimmed when the user has no confirmed
  // protector data yet; full color once any node has content.
  function outlinePath(n: ReturnType<typeof nodes>) {
    const p = Skia.Path.Make();
    p.moveTo(n.wound.cx,   n.wound.cy);
    p.lineTo(n.fixer.cx,   n.fixer.cy);
    p.lineTo(n.skeptic.cx, n.skeptic.cy);
    p.close();
    return p;
  }
  const leftOutline  = useMemo(() => outlinePath(leftNodes),  [leftNodes.wound.cx, leftNodes.wound.cy]);
  const rightOutline = useMemo(() => outlinePath(rightNodes), [rightNodes.wound.cx, rightNodes.wound.cy]);

  // The shared-wound connector — a gentle horizontal arc between the
  // two wound nodes when active. Same amber, broader stroke for
  // visibility against the deep-dark background.
  const sharedConnector = useMemo(() => {
    if (!sharedWoundActive) return null;
    const p = Skia.Path.Make();
    p.moveTo(leftNodes.wound.cx + r, leftNodes.wound.cy);
    // Slight upward arc so it reads as a bridge, not a line.
    p.cubicTo(
      W * 0.50, leftNodes.wound.cy - 18,
      W * 0.50, rightNodes.wound.cy - 18,
      rightNodes.wound.cx - r, rightNodes.wound.cy,
    );
    return p;
  }, [sharedWoundActive, leftNodes.wound.cx, leftNodes.wound.cy, rightNodes.wound.cx, rightNodes.wound.cy, r, W]);

  function woundColorFor(node: NodeData): string {
    if (sharedWoundActive) return SHARED_WOUND;
    return COLORS.wound;
  }
  function nodeColor(category: keyof typeof COLORS, node: NodeData): string {
    if (category === 'wound') return woundColorFor(node);
    return COLORS[category];
  }
  function nodeOpacity(node: NodeData): number {
    if (!node.text) return 0.20;     // empty — barely visible
    if (!node.confirmed) return 0.55; // partial — present but soft
    return 1.0;                        // confirmed — full strength
  }

  // For triangle outline, color matches the wound (or amber on shared).
  // Outline visible only when at least one node has content.
  function outlineColor(parts: PartnerParts): string {
    const anyContent = !!(parts.wound.text || parts.fixer.text || parts.skeptic.text || parts.selfLike.text);
    if (!anyContent) return DIM_OUTLINE;
    return sharedWoundActive ? 'rgba(230,180,122,0.35)' : 'rgba(242, 236, 226, 0.30)';
  }

  // One triangle's worth of Skia primitives — outline + four nodes.
  function renderTriangle(parts: PartnerParts, n: ReturnType<typeof nodes>, outline: ReturnType<typeof Skia.Path.Make>) {
    return (
      <Group>
        <Path path={outline} color={outlineColor(parts)} style="stroke" strokeWidth={isCompact ? 0.8 : 1} />
        {(['skeptic', 'fixer', 'wound', 'selfLike'] as const).map((cat) => {
          const node = parts[cat];
          const pos  = n[cat];
          const baseColor = nodeColor(cat, node);
          const op = nodeOpacity(node);
          if (!node.text) {
            // Empty placeholder — small dim circle, no halo.
            return (
              <Circle
                key={cat}
                cx={pos.cx}
                cy={pos.cy}
                r={r * 0.6}
                color={baseColor}
                opacity={op}
              />
            );
          }
          return (
            <Group key={cat}>
              <Circle cx={pos.cx} cy={pos.cy} r={r * rGlowMul}>
                <RadialGradient
                  c={vec(pos.cx, pos.cy)}
                  r={r * rGlowMul}
                  colors={[
                    `${baseColor}${node.confirmed ? '88' : '55'}`,
                    `${baseColor}00`,
                  ]}
                />
              </Circle>
              <Circle cx={pos.cx} cy={pos.cy} r={r} color={baseColor} opacity={op} />
            </Group>
          );
        })}
      </Group>
    );
  }

  return (
    <View>
      <Canvas style={{ width: W, height: H }}>
        {sharedConnector ? (
          <Group>
            <Path
              path={sharedConnector}
              color={`${SHARED_WOUND}55`}
              style="stroke"
              strokeWidth={isCompact ? 1.5 : 2.4}
            />
            <Path
              path={sharedConnector}
              color={`${SHARED_WOUND}AA`}
              style="stroke"
              strokeWidth={isCompact ? 0.8 : 1.2}
            />
          </Group>
        ) : null}
        {renderTriangle(myParts,      leftNodes,  leftOutline)}
        {renderTriangle(partnerParts, rightNodes, rightOutline)}
      </Canvas>
      {/* Labels under each triangle. */}
      <View style={[styles.labelRow, isCompact && styles.labelRowCompact]}>
        <Text style={[styles.label, isCompact && styles.labelCompact]} numberOfLines={1}>
          {myLabel}
        </Text>
        <Text style={[styles.label, isCompact && styles.labelCompact]} numberOfLines={1}>
          {partnerLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.lg,
    marginTop: 6,
  },
  labelRowCompact: {
    paddingHorizontal: spacing.md,
    marginTop: 4,
  },
  label: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    letterSpacing: 0.3,
    textAlign: 'center',
    flex: 1,
  },
  labelCompact: {
    fontSize: 11,
  },
});
