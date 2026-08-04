// Conversation starter chips shown below the opening bubble when there's
// no user-turn yet.
//
// FALLBACK_STARTERS is now the ONLY source for the main Chat tab: the chips
// used to be the third field off /api/returning-greeting's model completion,
// "grounded in the last session's themes", which made them a boundary claim
// in chip form. That greeting is gone and so is the chip plumbing — the Chat
// tab passes no `starters` prop, which selects the list below. These three
// are deliberately present-tense and assert nothing about a prior sitting.
//
// The `starters` prop survives for RelationshipChat, whose RELATIONSHIP_STARTERS
// is its own hardcoded constant list. It is not a hook for model output; do
// not wire a fetch to it.
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
    // Redesign (June 2026): center the chips + drop them lower with more
    // air, so the opening composition isn't top-heavy (greeting up top,
    // chips beneath with breathing room). Shape stays rounded (distinct
    // from the squared mode pills + the circular center ring).
    alignItems: 'center',
    gap: 10,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: 0,
  },
  chip: {
    // Rounded pill shape — matches the web app's soft-bubble style rather
    // than the boxy rectangle the previous pass produced.
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.4)',
    backgroundColor: 'rgba(230,180,122,0.08)',
    // Centered (was flex-start) so each chip hugs its own text, centered
    // in the column rather than left-aligned.
    alignSelf: 'center',
  },
  // v1.1.0 typography (round 2): starter pills are conversational
  // content on a chat surface, not UI affordances — they sit
  // alongside the AI's opening bubble and should read in the same
  // typeface. Cormorant Garamond at the same parameters as the
  // chat bubble text below so a starter and an AI bubble feel like
  // continuous voice. Pill geometry (border, padding, tap target)
  // unchanged.
  chipText: {
    color: '#F0EDE8',
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 24,
  },
});
