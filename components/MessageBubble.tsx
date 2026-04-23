// One chat bubble — user or assistant. Assistant bubbles carry an optional PartBadge
// (the detected part) below the text. A trailing blinking caret appears while the
// message is still streaming so the user sees progress before all words arrive.

import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../constants/theme';
import { PartBadge } from './PartBadge';

export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  detectedPart?: string | null;
  partLabel?: string | null;
  streaming?: boolean;
};

export function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
        <Text style={styles.text}>
          {msg.text}
          {msg.streaming ? <StreamCaret /> : null}
        </Text>
        {!isUser && msg.detectedPart ? (
          <PartBadge part={msg.detectedPart} label={msg.partLabel} />
        ) : null}
      </View>
    </View>
  );
}

// Soft blinking amber caret shown at the tail of a streaming assistant message.
function StreamCaret() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={[styles.caret, { opacity }]}>▍</Animated.Text>;
}

const styles = StyleSheet.create({
  row: { marginBottom: spacing.sm, flexDirection: 'row' },
  rowUser: { justifyContent: 'flex-end', paddingLeft: 40 },
  rowAssistant: { justifyContent: 'flex-start', paddingRight: 40 },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.md,
    maxWidth: '100%',
  },
  assistant: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderLeftWidth: 2,
    borderLeftColor: colors.borderAmber,
    borderTopLeftRadius: 2,
  },
  user: {
    backgroundColor: 'rgba(230,180,122,0.12)',
    borderWidth: 0.5,
    borderColor: colors.borderAmber,
    borderBottomRightRadius: 2,
  },
  text: { color: colors.cream, fontSize: 15, lineHeight: 22 },
  caret: { color: colors.amber, fontSize: 14 },
});
