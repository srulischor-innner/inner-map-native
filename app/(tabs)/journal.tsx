// Journal tab — placeholder state until free-form journal entries are
// built out. Sessions used to live here too, but they already appear in
// the hamburger menu's Recent Sessions list — duplicating them in the
// Journal tab created two paths to the same content. The tab now shows
// just the lock header, the "Journal" heading, and a single centered
// italic message so the surface is reserved for the journaling feature
// that's coming next.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, spacing } from '../../constants/theme';

export default function JournalScreen() {
  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* Private header — same lock + caption that lived above the old
          Journal content, kept so the tab still reads as a private space
          rather than a placeholder screen. */}
      <View style={styles.privateRow}>
        <Ionicons name="lock-closed" size={11} color={colors.creamFaint} />
        <Text style={styles.privateText}>Private — only you can see this</Text>
      </View>

      <Text style={styles.heading}>Journal</Text>

      {/* Centered placeholder — reserved space for free-form entries. The
          flex:1 + center alignment lets the message sit visually balanced
          regardless of device height. */}
      <View style={styles.placeholderWrap}>
        <Text style={styles.placeholderText}>
          Your personal journal lives here. A space to write freely —
          reflections, insights, things you want to remember. Coming soon.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // Lock + caption header — same visual language as the old Journal tab.
  privateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  privateText: {
    color: colors.creamFaint,
    fontSize: 11,
    letterSpacing: 0.5,
  },

  heading: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 42,
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: spacing.xl,
  },

  // Reserved-space placeholder for the eventual journaling feature.
  // Cormorant italic, dim cream, generous padding per spec.
  placeholderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl * 2,
  },
  placeholderText: {
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    color: 'rgba(240,237,232,0.35)',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
