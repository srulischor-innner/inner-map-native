// WarmRadialBackground — static warm radial depth behind the Chat tab.
//
// Redesign (June 2026): replaces the flat black background with a very
// subtle warmth that pools slightly above center and fades to true black at
// the edges, giving the home screen depth without drawing attention.
//
// EXTREMELY subtle by design — if a gradient is consciously noticeable, it's
// too strong. Tune CENTER toward/away from black to taste. Static (no
// animation), pointerEvents none, sits behind all content (absolute fill).
// Skia is already a project dependency (used across the map + guide visuals).

import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, Rect, RadialGradient, vec } from '@shopify/react-native-skia';

// Center: a barely-warm near-black. Edge: true black. Keep CENTER close to
// #000 — a couple of points of warm lift is all the depth this needs.
const CENTER = '#15110D';
const EDGE = '#000000';

export function WarmRadialBackground() {
  const { width, height } = useWindowDimensions();
  // Pool the warmth a little above the vertical middle so it sits behind the
  // greeting + center ring rather than the keyboard area.
  const cx = width / 2;
  const cy = height * 0.42;
  const r = Math.max(width, height) * 0.78;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient c={vec(cx, cy)} r={r} colors={[CENTER, EDGE]} />
        </Rect>
      </Canvas>
    </View>
  );
}
