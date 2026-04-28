// Three stat cards at the top of the Journey tab: total conversations,
// total user messages shared, and the date the journey began. Each card
// is dark-bg, rounded, with a large Cormorant number and a small amber
// uppercase label.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radii, spacing } from '../../constants/theme';

type Props = {
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string | null;
};

export function StatCards({ totalSessions, totalMessages, firstSessionDate }: Props) {
  const journeyBegan = firstSessionDate ? formatJourneyDate(firstSessionDate) : '—';
  return (
    <View style={styles.row}>
      <Card value={String(totalSessions || 0)} label="CONVERSATIONS" />
      <Card value={String(totalMessages || 0)} label="MESSAGES SHARED" />
      <Card value={journeyBegan} label="JOURNEY BEGAN" />
    </View>
  );
}

function Card({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.card}>
      <Text
        style={[styles.value, value.length >= 6 && styles.valueShort]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function formatJourneyDate(iso: string): string {
  // Server returns YYYY-MM-DD strings. Format as "Mon YYYY" for a calm
  // milestone-style display in a small card.
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  card: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radii.md,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 88,
  },
  value: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  valueShort: { fontSize: 20, lineHeight: 24 },     // dates / multi-char values
  label: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 9,
    letterSpacing: 1.4,
    textAlign: 'center',
    marginTop: 6,
  },
});
