// Typing indicator — a small breathing equilateral triangle in Inner Map
// amber. The triangle is the app's logo mark, so showing it pulse while
// the AI formulates a reply reads as "the map is thinking" rather than
// a generic chat ellipsis.
//
// Render path: Skia <Canvas> with a Path stroked in amber, wrapped in a
// <Group> whose opacity is driven by a Reanimated shared value. Shared
// value oscillates 0.4 → 1.0 → 0.4 on a 1.5s cycle (0.75s each direction).

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import {
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  useDerivedValue,
} from 'react-native-reanimated';
import { spacing } from '../constants/theme';

const SIZE = 24;                 // outer bounding box (px)
const COLOR = '#E6B47A';         // amber — matches logo mark

export function TypingIndicator() {
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1.0, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [opacity]);

  const derivedOpacity = useDerivedValue(() => opacity.value, [opacity]);

  // Equilateral triangle pointing up. Uses the full SIZE box: top vertex
  // centered at top edge, bottom edge flat with a little inset so the
  // stroke fits inside the canvas without clipping.
  const path = Skia.Path.Make();
  const pad = 2;
  const top = { x: SIZE / 2, y: pad };
  const bl  = { x: pad,             y: SIZE - pad };
  const br  = { x: SIZE - pad,      y: SIZE - pad };
  path.moveTo(top.x, top.y);
  path.lineTo(br.x, br.y);
  path.lineTo(bl.x, bl.y);
  path.close();

  return (
    <View style={styles.row}>
      <Canvas style={{ width: SIZE, height: SIZE }}>
        <Group opacity={derivedOpacity}>
          <Path path={path} color={COLOR} style="stroke" strokeWidth={2} />
          {/* Subtle filled core so the triangle has presence even at low
              opacity peaks — reads as "lit from within". */}
          <Path path={path} color={COLOR + '33'} style="fill" />
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: spacing.md,
    marginLeft: spacing.md,
    paddingVertical: spacing.xs,
  },
});
