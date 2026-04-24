// Conversation starter chips shown below the opening greeting when there's
// no user-turn yet. Starters come from /api/returning-greeting (contextual
// to last session) with a generic fallback for first-time users.
//
// Layout: vertical stack so every suggestion is visible at a glance —
// horizontal scroll hid later options behind a gesture users didn't know
// to make.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radii, spacing } from '../constants/theme';

const FALLBACK_STARTERS: string[] = [
  "Something's been on my mind lately",
  "A pattern keeps showing up",
  "I don't know what I'm feeling",
];

export function ConversationStarters({
  onPick,
  starters,
}: {
  onPick: (text: string) => void;
  starters?: string[] | null;
}) {
  const items = starters && starters.length > 0 ? starters : FALLBACK_STARTERS;
  return (
    <View style={styles.wrap}>
      {items.map((s) => (
        <Pressable
          key={s}
          style={styles.chip}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onPick(s);
          }}
        >
          <Text style={styles.chipText}>{s}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'column',
    gap: 8,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: 0,
  },
  chip: {
    // Full-width left-aligned chips stack cleanly below the greeting, so
    // every suggestion is visible without a swipe gesture.
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.amberDim,
    backgroundColor: 'rgba(230,180,122,0.06)',
  },
  chipText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
});
