// Horizontal bar chart of "most active energies" — one row per detected
// part, with label, count, and a colored bar sized proportionally to the
// max count. Underneath each row a one-line description grounds the
// reader in what that part means.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../../constants/theme';
import { PART_COLOR, PART_DISPLAY } from '../../utils/markers';

export type Energy = { part: string; count: number };

const PART_DESCRIPTION: Record<string, string> = {
  fixer: 'The part that pushes to prove worth.',
  skeptic: 'The part that has learned not to try.',
  wound: 'The core belief at the center.',
  manager: 'Proactive routines that keep things steady.',
  firefighter: 'Reactive moves that reach for relief.',
  'self-like': 'The part that holds it all together.',
  self: 'The calm presence underneath everything.',
  compromised: 'The part that holds it all together.',
};

export function EnergiesBar({ energies }: { energies: Energy[] }) {
  if (!energies || energies.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          The energies most active in your conversations will appear here as we talk.
          Each conversation adds signal — after a few sessions a clear shape emerges.
        </Text>
      </View>
    );
  }
  const max = Math.max(...energies.map((e) => e.count), 1);
  return (
    <View>
      {energies.map((e) => {
        const color = PART_COLOR[e.part] || colors.amber;
        const display = PART_DISPLAY[e.part] || e.part.toUpperCase();
        const pct = Math.max(0.04, e.count / max);
        const desc = PART_DESCRIPTION[e.part];
        return (
          <View key={e.part} style={styles.energyBlock}>
            <View style={styles.row}>
              <Text style={[styles.label, { color }]}>{display.toUpperCase()}</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
              </View>
              <Text style={styles.count}>{e.count}</Text>
            </View>
            {desc ? <Text style={styles.desc}>{desc}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  energyBlock: { marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  desc: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    marginLeft: 88 + spacing.sm,
  },
  label: {
    width: 88,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  track: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radii.sm,
    overflow: 'hidden',
    marginHorizontal: spacing.sm,
  },
  fill: { height: 8, borderRadius: radii.sm },
  count: { width: 28, textAlign: 'right', color: colors.creamFaint, fontSize: 12, fontWeight: '600' },

  empty: {
    padding: spacing.md,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  emptyText: { color: colors.creamFaint, fontSize: 13, lineHeight: 20, fontStyle: 'italic' },
});
