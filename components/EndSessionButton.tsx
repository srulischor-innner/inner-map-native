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
  // Mirror of `charging` in a ref so the Animated.start completion
  // callback can read the current value WITHOUT closing over the
  // stale `charging=false` from when down() first ran. The previous
  // version checked `finished && charging` in the callback and that
  // stale-closure check made the long-press never commit.
  const chargingRef = useRef(false);
  const fill = useRef(new Animated.Value(0)).current;
  const committedRef = useRef(false);

  function down() {
    if (committedRef.current) return;
    chargingRef.current = true;
    setCharging(true);
    fill.setValue(0);
    Haptics.selectionAsync().catch(() => {});
    Animated.timing(fill, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      // `finished` is true only when the animation ran to completion
      // without being interrupted by up()'s reverse animation.
      if (finished && chargingRef.current) {
        committedRef.current = true;
        chargingRef.current = false;
        setCharging(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onEnd();
        setTimeout(() => { committedRef.current = false; fill.setValue(0); }, 1200);
      }
    });
  }
  function up() {
    if (!chargingRef.current) return;
    chargingRef.current = false;
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
