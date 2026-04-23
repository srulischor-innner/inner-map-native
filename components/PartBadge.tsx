// Small pill that labels which inner part Claude detected in this reply. Renders only
// when a valid detectedPart is passed. Color comes from the part palette so the badge
// visually matches the corresponding node on the Map tab.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PART_COLOR, PART_DISPLAY } from '../utils/markers';

export function PartBadge({ part, label }: { part?: string | null; label?: string | null }) {
  if (!part || part === 'unknown') return null;
  const color = PART_COLOR[part] || '#E6B47A';
  const display = (label && label.trim()) || PART_DISPLAY[part] || part.toUpperCase();
  return (
    <View
      style={[
        styles.badge,
        { borderColor: color, backgroundColor: color + '20' },
      ]}
    >
      <Text style={[styles.text, { color }]}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 0.5,
    marginTop: 6,
  },
  text: {
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
});
