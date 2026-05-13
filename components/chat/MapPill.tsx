// "Added to your map" pill — rendered inline in chat bubbles when the
// AI emits an [ADDED_TO_MAP: <name>] marker in Explore mode. The pill
// communicates "I just persisted this to your map" as a visible UI
// element rather than just prose. Tapping it routes to the Map tab.
//
// Visual style: subtle amber-tinted pill, distinct from the chat
// bubble it sits inside. Matches the rest of the app's pill language
// (the "GENERATE CODE" / "READ THE INTRO" button styling, but
// smaller + non-primary).
//
// The map-pin icon comes from @expo/vector-icons (Ionicons "map" /
// "map-outline"). We use Ionicons rather than lucide-react-native
// because the rest of the app's icon system is Ionicons; introducing
// a second icon set would add a dep and visual inconsistency.

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, fonts } from '../../constants/theme';

export function MapPill({ name }: { name: string }) {
  const router = useRouter();
  const onPress = () => {
    Haptics.selectionAsync().catch(() => {});
    // Future: when the map system supports highlighting a specific
    // item, pass the name through as a query/state. For now, just
    // navigate. The destination (Map tab) handles mark-seen on
    // focus via services/mapSeen.ts — the dot in the top tab bar
    // clears the moment this navigation lands.
    router.push('/map');
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`Added to your map: ${name}. Tap to view`}
      style={styles.wrap}
    >
      <View style={styles.pill}>
        <Ionicons
          name="map-outline"
          size={13}
          color={colors.amber}
          style={styles.icon}
        />
        <Text style={styles.label} numberOfLines={2}>
          <Text style={styles.labelDim}>Added to your map: </Text>
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Outer wrap absorbs taps + adds a little vertical breathing room
  // so the pill doesn't crash into neighboring prose lines.
  wrap: {
    alignSelf: 'flex-start',
    marginVertical: 6,
  },
  // The pill itself — amber border, subtle amber wash, rounded.
  // Smaller than primary action buttons; reads as a status badge.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.08)',
    maxWidth: '92%',
  },
  icon: { marginRight: 7 },
  label: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  // "Added to your map:" prefix is dimmer than the descriptive name
  // so the eye lands on the name, not the boilerplate prefix.
  labelDim: {
    color: 'rgba(230, 180, 122, 0.75)',
    fontFamily: fonts.sans,
  },
});
