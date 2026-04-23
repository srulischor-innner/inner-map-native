// Three-dot phase strip at the top of the chat. Mirrors the web app's progress bar:
//   1 — Getting to know you
//   2 — Closer to your map
//   3 — Map revealed
// `phase` is 1-3. Dots before the active one are dim-lit; dots after are unlit.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../constants/theme';

export function PhaseIndicator({ phase }: { phase: 1 | 2 | 3 }) {
  const labels: Record<1 | 2 | 3, string> = {
    1: 'Getting to know you',
    2: 'Closer to your map',
    3: 'Map revealed',
  };
  return (
    <View style={styles.row}>
      <View style={styles.dots}>
        {([1, 2, 3] as const).map((n) => (
          <View
            key={n}
            style={[
              styles.dot,
              n < phase && styles.dotDim,
              n === phase && styles.dotActive,
            ]}
          />
        ))}
      </View>
      <Text style={styles.label}>{labels[phase]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  dots: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
    backgroundColor: 'rgba(230,180,122,0.15)',
  },
  dotDim: { backgroundColor: 'rgba(230,180,122,0.45)' },
  dotActive: {
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.8,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  label: {
    color: colors.creamFaint,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
