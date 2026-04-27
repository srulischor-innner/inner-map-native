// Single global audio toggle for the chat tab. Instagram-style mute /
// unmute model — one icon, two states, one tap to flip.
//
// The toggle is the ONLY audio control. There are no per-message
// speaker icons. When unmuted, every new AI reply auto-plays via the
// existing ttsStream pipeline. When muted, audio is silent and any
// in-flight playback is cancelled immediately.
//
// State is owned by the chat screen (a single boolean) and reset to
// false on session end. We don't persist it across sessions — the user
// re-opts-in each time.

import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const ICON_SIZE = 22;
const TAP_SIZE = 44;

const AMBER_ON  = '#E6B47A';
const DIM_OFF   = 'rgba(240,237,232,0.4)';

export function AudioToggle({
  enabled, onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onToggle();
      }}
      style={styles.tap}
      hitSlop={6}
      accessibilityLabel={enabled ? 'Mute audio for this session' : 'Unmute audio for this session'}
    >
      <View style={styles.iconWrap}>
        <Ionicons
          // volume-medium: speaker silhouette + waves; volume-mute: same
          // silhouette with a slash. Lucide's Volume2 / VolumeX equivalent.
          name={enabled ? 'volume-medium' : 'volume-mute'}
          size={ICON_SIZE}
          color={enabled ? AMBER_ON : DIM_OFF}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tap: {
    width: TAP_SIZE, height: TAP_SIZE,
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
});
