// "Language patterns" — characteristic phrases per part, sourced from
// the parts.voice column on the server (populated by user-confirmed
// MAP_UPDATE markers when the AI hears something distinctly part-shaped
// and the user says "yes, that's a phrase I use a lot in this energy").
//
// Server returns languagePatterns as an array of
// { partId, category, name, phrases: string[] } from /api/journey.
// Phrases are most-recent-first. We render up to `perPart` phrases per
// row, each as a soft italic blockquote line under a part header.
// Falls back to a calm placeholder when no voice phrases have been
// confirmed yet.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';
import { PART_COLOR, PART_DISPLAY } from '../../utils/markers';

export type PartVoiceEntry = {
  partId: string;
  category: string;
  name: string;
  phrases: string[];
};

// Keep the type name so callers don't have to update; it's an array now.
export type LanguagePatterns = PartVoiceEntry[];

export function PartPhrases({
  patterns,
  perPart = 3,
}: {
  patterns: LanguagePatterns | null | undefined;
  perPart?: number;
}) {
  const entries = (patterns || []).filter(
    (e) => e && Array.isArray(e.phrases) && e.phrases.length > 0,
  );

  if (!entries.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          As parts surface in conversation, characteristic phrases — the
          actual words each part puts in your mouth — will collect here,
          grouped under each part.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {entries.map((entry) => {
        const cat = (entry.category || '').toLowerCase();
        const color = PART_COLOR[cat] || colors.amber;
        // Prefer the part's specific name (e.g. "the achiever"); fall
        // back to the category display name when the part is unnamed.
        const heading =
          (entry.name && entry.name.trim()) ||
          PART_DISPLAY[cat] ||
          cat.toUpperCase();
        const top = entry.phrases.slice(0, perPart);
        return (
          <View key={entry.partId} style={styles.block}>
            <Text style={[styles.label, { color }]}>
              {heading.toUpperCase()}
            </Text>
            {top.map((phrase, i) => (
              <View
                key={i}
                style={[styles.phraseRow, { borderLeftColor: color }]}
              >
                <Text style={styles.phraseText}>"{phrase}"</Text>
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
