// "Language patterns" — real user phrases that triggered each part
// detection during conversation. The server returns
// languagePatterns: { part: [{ phrase, sessionId, ts }] } from
// /api/journey; we render up to 3 phrases per detected part as small
// italic blockquote-style lines under each part header. Falls back to
// a calm placeholder when no phrases have been captured yet.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';
import { PART_COLOR, PART_DISPLAY } from '../../utils/markers';

export type PartPhrase = { phrase: string; sessionId?: string; ts?: string | null };
export type LanguagePatterns = Record<string, PartPhrase[]>;

export function PartPhrases({
  patterns,
  perPart = 3,
}: {
  patterns: LanguagePatterns | null | undefined;
  perPart?: number;
}) {
  const entries = Object.entries(patterns || {})
    .filter(([, arr]) => Array.isArray(arr) && arr.length > 0);

  if (!entries.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          As parts surface in conversation, the phrases that trigger each
          one will appear here — your own words, grouped by what they reveal.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {entries.map(([part, phrases]) => {
        const color = PART_COLOR[part] || colors.amber;
        const display = PART_DISPLAY[part] || part.toUpperCase();
        const top = phrases.slice(0, perPart);
        return (
          <View key={part} style={styles.block}>
            <Text style={[styles.label, { color }]}>{display.toUpperCase()}</Text>
            {top.map((p, i) => (
              <View
                key={i}
                style={[styles.phraseRow, { borderLeftColor: color }]}
              >
                <Text style={styles.phraseText}>"{p.phrase}"</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.lg },
  label: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
    marginBottom: 8,
  },
  phraseRow: {
    borderLeftWidth: 2,
    paddingLeft: spacing.md,
    paddingVertical: 4,
    marginBottom: 6,
  },
  phraseText: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 20,
  },
  empty: {
    paddingVertical: spacing.md,
  },
  emptyText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    lineHeight: 20,
  },
});
