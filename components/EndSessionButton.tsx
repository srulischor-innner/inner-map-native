// "end session" — subtle text-only affordance at the very bottom of the
// chat. No border, no pill, no fill — just dim amber text that reads as
// a quiet opt-out rather than a call to action. Hold-to-confirm is kept
// (1s press-and-hold) so it can't be triggered accidentally.

import React, { useRef, useState } from 'react';
import { Pressable, View, Text, Animated, StyleSheet, Easing } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/theme';

const HOLD_MS = 1000;

export function EndSessionButton({ onEnd, visible }: { onEnd: () => void; visible: boolean }) {
  const [charging, setCharging] = useState(false);
  const opacity = useRef(new Animated.Value(0.5)).current;
  const committedRef = useRef(false);

  function down() {
    if (committedRef.current) return;
    setCharging(true);
    Haptics.selectionAsync().catch(() => {});
    Animated.timing(opacity, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && charging) {
        committedRef.current = true;
        setCharging(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onEnd();
        setTimeout(() => { committedRef.current = false; opacity.setValue(0.5); }, 1200);
      }
    });
  }
  function up() {
    if (!charging) return;
    setCharging(false);
    Animated.timing(opacity, { toValue: 0.5, duration: 200, useNativeDriver: true }).start();
  }

  if (!visible) return null;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPressIn={down}
        onPressOut={up}
        accessibilityLabel="End session (hold)"
        hitSlop={10}
      >
        <Animated.Text style={[styles.text, { opacity }]}>end session</Animated.Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 4 },
  text: {
    color: colors.amberDim,
    fontSize: 11,
    letterSpacing: 1.2,
    fontStyle: 'italic',
  },
});
