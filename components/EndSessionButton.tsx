// "end session" — small amber pill at the bottom of the chat. Visible
// enough that a user notices it naturally, quiet enough that it doesn't
// compete with the input. Hold-to-confirm (1s press) stays so it can't
// be triggered accidentally.

import React, { useRef, useState } from 'react';
import { Pressable, View, Text, Animated, StyleSheet, Easing } from 'react-native';
import * as Haptics from 'expo-haptics';

const HOLD_MS = 1000;

export function EndSessionButton({ onEnd, visible }: { onEnd: () => void; visible: boolean }) {
  const [charging, setCharging] = useState(false);
  const fill = useRef(new Animated.Value(0)).current;
  const committedRef = useRef(false);

  function down() {
    if (committedRef.current) return;
    setCharging(true);
    fill.setValue(0);
    Haptics.selectionAsync().catch(() => {});
    Animated.timing(fill, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && charging) {
        committedRef.current = true;
        setCharging(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onEnd();
        setTimeout(() => { committedRef.current = false; fill.setValue(0); }, 1200);
      }
    });
  }
  function up() {
    if (!charging) return;
    setCharging(false);
    Animated.timing(fill, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  }

  if (!visible) return null;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPressIn={down}
        onPressOut={up}
        style={[styles.btn, charging && styles.btnCharging]}
        accessibilityLabel="End session (hold)"
        hitSlop={10}
      >
        {/* Hold-progress fill — sweeps left-to-right as the user holds */}
        <Animated.View
          style={[
            styles.fill,
            { opacity: 0.22, transform: [{ scaleX: fill }] },
          ]}
        />
        <Text style={styles.text}>end session</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 4 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    // Subtle pill so the affordance is readable against the dark background
    // without shouting. 70% amber text + 40% amber border hit the "visible
    // but not prominent" balance from the spec.
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.4)',
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  btnCharging: { borderColor: 'rgba(230,180,122,0.9)' },
  fill: {
    position: 'absolute',
    left: 0, top: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(230,180,122,1)',
    transformOrigin: 'left',
  },
  text: {
    color: 'rgba(230,180,122,0.7)',
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
