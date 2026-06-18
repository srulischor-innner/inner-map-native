// "Added to where you live" pill — rendered inline in chat bubbles when
// the AI emits an [ADDED_TO_MIDDLE: <label>] marker (the Self-like
// "where you live" collection). Like MapPill, it communicates "I just
// filed this for you" as a visible UI element rather than only prose.
// Tapping it routes to the Map tab, where the item lives in the
// Self-like folder's "Where You Live" section.
//
// Visual style mirrors MapPill but in the Self-like purple (so the pill
// reads as belonging to that folder, not the amber map-pin language).
// Same Ionicons icon system as the rest of the app; "home-outline"
// reads literally as "where you live".

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, fonts } from '../../constants/theme';

export function MiddlePill({ name }: { name: string }) {
  const router = useRouter();
  const onPress = () => {
    Haptics.selectionAsync().catch(() => {});
    // Routes to the Map tab; the item is in the Self-like folder's
    // "Where You Live" section. Mirrors MapPill — no deep-link to the
    // specific item yet (the folder system doesn't support highlighting
    // an individual entry).
    router.push('/map');
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`Added to where you live: ${name}. Tap to view`}
      style={styles.wrap}
    >
      <View style={styles.pill}>
        <Ionicons
          name="home-outline"
          size={13}
          color={colors.selfLike}
          style={styles.icon}
        />
        <Text style={styles.label} numberOfLines={2}>
          <Text style={styles.labelDim}>Added to where you live: </Text>
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Outer wrap absorbs taps + adds vertical breathing room so the pill
  // doesn't crash into neighboring prose lines.
  wrap: {
    alignSelf: 'flex-start',
    marginVertical: 6,
  },
  // The pill itself — Self-like-purple border, subtle purple wash,
  // rounded. Reads as a status badge tied to the Self-like folder.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(138, 122, 170, 0.45)',
    backgroundColor: 'rgba(138, 122, 170, 0.10)',
    maxWidth: '92%',
  },
  icon: { marginRight: 7 },
  label: {
    color: colors.selfLike,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  // "Added to where you live:" prefix is dimmer than the label so the
  // eye lands on the item, not the boilerplate prefix.
  labelDim: {
    color: 'rgba(138, 122, 170, 0.75)',
    fontFamily: fonts.sans,
  },
});
