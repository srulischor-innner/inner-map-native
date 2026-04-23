// Conversation starter chips shown below the opening greeting when there's
// no user-turn yet. Picked from the same starter bank the web app uses so
// new users have somewhere to begin.

import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radii, spacing } from '../constants/theme';

const STARTERS: string[] = [
  "Something's been on my mind lately",
  "A pattern keeps showing up",
  "I don't know what I'm feeling",
  "I need to process something",
  "Just want to be heard",
];

export function ConversationStarters({ onPick }: { onPick: (text: string) => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>Or try one of these</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {STARTERS.map((s) => (
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
  wrap: { marginTop: spacing.sm, marginBottom: spacing.xs },
  hint: {
    color: colors.creamFaint,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 8,
    marginLeft: 2,
  },
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
