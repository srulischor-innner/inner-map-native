// Clinical language patterns — for each category returned by /api/journey, show
// the category label + note and the detected phrases as wrapping chips. Each
// chip's color tint matches the category.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';

type CategoryKey = string;
type Category = {
  label: string;
  note: string;
  color: string; // 'red' | 'amber' | 'blue' | ...
  phrases: { phrase: string; count: number }[];
};
type Patterns = Record<CategoryKey, Category>;

const CATEGORY_COLOR: Record<string, string> = {
  red: colors.wound,
  amber: colors.fixer,
  blue: colors.skeptic,
  green: colors.managers,
  orange: colors.firefighters,
  purple: colors.selfLike,
  lavender: colors.self,
};

export function LanguageChips({ patterns }: { patterns: Patterns | null | undefined }) {
  const entries = Object.entries(patterns || {});
  const hasAny = entries.some(([, c]) => c.phrases && c.phrases.length > 0);

  if (!entries.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          As you talk, Inner Map listens for specific language patterns and groups them
          by what they reveal. Categories will appear here when we have enough signal.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {entries.map(([key, cat]) => {
        const color = CATEGORY_COLOR[cat.color] || colors.amber;
        return (
          <View key={key} style={styles.block}>
            <Text style={[styles.label, { color }]}>{cat.label.toUpperCase()}</Text>
            <Text style={styles.note}>{cat.note}</Text>
            <View style={styles.chipRow}>
              {cat.phrases.length === 0 ? (
                <Text style={styles.chipEmpty}>No phrases detected yet</Text>
              ) : (
                cat.phrases.map((p, i) => (
                  <View
                    key={i}
                    style={[styles.chip, { borderColor: color, backgroundColor: color + '18' }]}
                  >
                    <Text style={[styles.chipText, { color }]}>{p.phrase}</Text>
                    {p.count > 1 ? (
                      <Text style={[styles.chipCount, { color: color + '99' }]}>×{p.count}</Text>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          </View>
        );
      })}
      {!hasAny ? null : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.md },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginBottom: 4 },
  note: { color: colors.creamDim, fontSize: 12, fontStyle: 'italic', lineHeight: 18, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 0.5,
  },
  chipText: { fontSize: 12, fontWeight: '500' },
  chipCount: { fontSize: 10, marginLeft: 4 },
  chipEmpty: { color: colors.creamFaint, fontSize: 12, fontStyle: 'italic' },
  empty: {
    padding: spacing.md,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  emptyText: { color: colors.creamFaint, fontSize: 13, lineHeight: 20, fontStyle: 'italic' },
});
