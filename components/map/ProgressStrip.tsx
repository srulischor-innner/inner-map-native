// Collapsible "YOUR PROGRESS" strip at the bottom of the Map tab.
// Collapsed: a single-line header the user can tap to expand.
// Expanded: both spectrum bars, same labels + captions as the Journey tab.
//
// Positioned via the caller (absolute at the bottom of map-view) so the map
// itself keeps its full height regardless of the strip's expansion state.

import React, { useState } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../constants/theme';
import { SpectrumBar } from '../journey/SpectrumBar';

export function ProgressStrip({
  outsideInScore,
  fragmentedScore,
}: {
  outsideInScore?: number | null;
  fragmentedScore?: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.root, expanded && styles.rootExpanded]}>
      <Pressable
        onPress={() => { Haptics.selectionAsync().catch(() => {}); setExpanded((e) => !e); }}
        style={styles.header}
      >
        <Text style={styles.headerText}>YOUR PROGRESS</Text>
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-up'}
          size={14}
          color={colors.creamFaint}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <SpectrumBar
            leftLabel="Outside-In"
            rightLabel="Inside-Out"
            leftColor={colors.wound}
            rightColor={colors.self}
            value={outsideInScore ?? null}
            caption="How your protective parts orient to the world."
          />
          <SpectrumBar
            leftLabel="Fragmented"
            rightLabel="Flowing"
            leftColor={colors.firefighters}
            rightColor={colors.self}
            value={fragmentedScore ?? null}
            caption="How your whole system is actually running."
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: 'rgba(15,14,20,0.95)',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
  },
  rootExpanded: {
    paddingBottom: spacing.md,
  },
  header: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerText: {
    color: colors.creamFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  body: { paddingTop: spacing.sm },
});
