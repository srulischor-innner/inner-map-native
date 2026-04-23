// Tiny amber progress-dots row. Used at the bottom of each slide section so
// the user always knows where they are in the sequence.

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { colors } from '../../constants/theme';

export function GuideDots({
  count,
  active,
  onTap,
}: {
  count: number;
  active: number;
  onTap?: (i: number) => void;
}) {
  return (
    <View style={styles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <Pressable key={i} onPress={() => onTap?.(i)} hitSlop={6}>
          <View style={[styles.dot, i === active && styles.dotActive]} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingVertical: 10 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(230,180,122,0.22)',
  },
  dotActive: {
    backgroundColor: colors.amber,
    transform: [{ scale: 1.25 }],
    shadowColor: colors.amber,
    shadowOpacity: 0.55,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
});
