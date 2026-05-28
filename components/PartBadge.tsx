// Small pill that quietly marks the unblending moment in chat —
// "oh, that's the fixer talking" — without pulling the user out of
// the conversation. Renders below the assistant bubble in BOTH
// Explore and Process modes when the server's CHAT_META marker
// reports detectedPart != "unknown". Pill color matches the part's
// node color on the Map so the in-chat moment feels connected to
// the map's "part lights up" treatment.
//
// Design notes (build 13 polish):
//   - PART NAME ONLY — "Fixer", "Wound", "Skeptic". Capitalized,
//     not all-caps. No framing words ("sounds like…"); the pill IS
//     the framing.
//   - Informational, not interactive. No onPress.
//   - Gentle fade-in (~350ms) so the pill arrives rather than pops —
//     keeps the conversation feeling unhurried. Each new detected
//     part gets its own fresh fade by keying the animation off the
//     part identifier; remounting on each detection resets opacity.
//   - 13 — small but readable. The prior 9pt + uppercase was too
//     quiet to read at a glance.

import React, { useEffect } from 'react';
import { Text, StyleSheet, Animated, Easing } from 'react-native';
import { PART_COLOR, PART_DISPLAY } from '../utils/markers';

export function PartBadge({ part, label }: { part?: string | null; label?: string | null }) {
  if (!part || part === 'unknown') return null;
  const color = PART_COLOR[part] || '#E6B47A';
  const display = (label && label.trim()) || PART_DISPLAY[part] || part;

  // Fresh fade-in per detection. The dependency on `part` ensures
  // that when the AI's reply lands on a different part than the
  // previous one, the pill animates in again rather than just
  // swapping its text mid-display.
  const opacity = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 350,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [part, opacity]);

  return (
    <Animated.View
      style={[
        styles.badge,
        { borderColor: color, backgroundColor: color + '1F', opacity },
      ]}
      accessible
      accessibilityLabel={`Part detected: ${display}`}
    >
      <Text style={[styles.text, { color }]}>{display}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // alignSelf:flex-start keeps the pill snug to the bubble's left
  // edge rather than stretching across the row. marginTop opens a
  // quiet gap below the bubble text so the pill reads as a
  // standalone label, not a continuation of the message.
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 0.5,
    marginTop: 8,
  },
  text: {
    // 13pt is "small but glanceable" — readable without commanding
    // attention. Letter-spacing 0.3 keeps the optical density easy
    // without the marching-letters feel of the old uppercase form.
    fontSize: 13,
    letterSpacing: 0.3,
    fontWeight: '600',
  },
});
