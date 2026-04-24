// Conversation starter chips shown below the opening greeting when there's
// no user-turn yet. Starters are passed in from the caller — the server's
// /api/returning-greeting now returns 3 contextual suggestions grounded in
// the last session so the chips land on what's actually alive for the user.
// Falls back to a generic bank if the server couldn't produce any.

import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radii, spacing } from '../constants/theme';

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // No "Or try one of these" label — chips just sit naturally below the
  // greeting.
  wrap: { marginTop: spacing.sm, marginBottom: spacing.xs },
  row: { paddingRight: spacing.md, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.amberDim,
    backgroundColor: 'rgba(230,180,122,0.06)',
  },
  chipText: { color: colors.cream, fontSize: 13 },
});
