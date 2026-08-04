// Ambient usage indicator for the Journey tab. Appears only once the period's
// measured-cost pool crosses 80% (tier warn80 / warn95 / exhausted); below that
// it renders NOTHING at all.
//
// Deliberately NOT a stat card. The StatCards above it are square tiles with a
// large Cormorant number — in this app a big serif number means "a milestone you
// accumulated". Usage is system state, not an achievement, so this is a full-width
// hairline-ruled strip in small DM Sans with no number of any kind.
//
// NO COUNTS, EVER. The server meters CENTS, not messages or conversations, and a
// turn's real cost spans ~7×. Any "N left" phrasing would be a volume claim the
// server cannot honour. Proportion only — and the proportion lives in the bar,
// never in text.

import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';

import { colors, fonts, spacing } from '../../constants/theme';
import type { BillingStatus } from '../../services/api';

type Props = {
  /** null while unknown (not yet loaded, or the status read failed). */
  status: BillingStatus | null;
  style?: StyleProp<ViewStyle>;
};

/** Tiers that surface the strip. 'ok' — and an unknown/absent tier — stay silent. */
const VISIBLE_TIERS = ['warn80', 'warn95', 'exhausted'];

export function UsageStrip({ status, style }: Props) {
  // `budget` is null on the server's 200 catch-all ({state:'none', budget:null}).
  // Unknown is never rendered as "spent" — bail out quietly.
  const budget = status?.budget ?? null;
  if (!budget || !VISIBLE_TIERS.includes(budget.tier)) return null;

  const fill = fillFraction(budget.spentCents, budget.allowanceCents, budget.tier);

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.headline}>{headline(budget.tier)}</Text>

      {/* Decorative — it carries the proportion, and there is no number to read. */}
      <View
        style={styles.track}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        <View style={[styles.fill, { width: `${fill * 100}%` }]} />
      </View>

      <Text style={styles.reset}>{resetSentence(budget.periodEnd)}</Text>
    </View>
  );
}

/** The one line of text that states the condition.
 *
 *  'exhausted' is not a louder warning — it is a DIFFERENT FACT. At that tier
 *  the bar is full and chat is being refused outright, and the refusal sheet
 *  the user just came from says "You've reached this month's usage limit."
 *  Telling them here that "most" is spent contradicts the sheet and reads as a
 *  balance they don't have. One word apart from the warning copy, so the
 *  escalation still reads as the same voice.
 *
 *  Both strings state a CONDITION, never a quantity — the server meters cents,
 *  so no count, no percentage, no "left". See the header note. */
function headline(tier: string): string {
  return tier === 'exhausted'
    ? "This month's usage is spent."
    : "Most of this month's usage is spent.";
}

/** spent / allowance, clamped to 0..1. A zero (or non-finite) allowance can't be
 *  divided into, so fall back to the tier's own floor — we already know we're at
 *  or past 80%. */
function fillFraction(spentCents: number, allowanceCents: number, tier: string): number {
  const tierFloor = tier === 'exhausted' ? 1 : tier === 'warn95' ? 0.95 : 0.8;
  if (!Number.isFinite(allowanceCents) || allowanceCents <= 0) return tierFloor;
  if (!Number.isFinite(spentCents)) return tierFloor;
  const raw = spentCents / allowanceCents;
  if (!Number.isFinite(raw)) return tierFloor;
  return Math.min(1, Math.max(0, raw));
}

/** Mirrors the server's budgetResetSentence() byte for byte — same two strings,
 *  same en-US month/day in UTC. Do not invent a third variant. */
function resetSentence(periodEnd: string | null): string {
  const fallback = 'It resets at the start of your next month.';
  if (!periodEnd) return fallback;
  try {
    const d = new Date(periodEnd);
    if (isNaN(d.getTime())) return fallback;
    const when = d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    return `It resets on ${when}.`;
  } catch {
    return fallback;
  }
}

const styles = StyleSheet.create({
  // Hairline rule ABOVE — no card fill, no enclosing border. Nothing here may
  // read as a fourth tile.
  container: {
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  headline: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginVertical: spacing.sm,
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.amber,
  },
  reset: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 16,
  },
});
