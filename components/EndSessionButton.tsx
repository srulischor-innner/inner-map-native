// "End session" button — subtle amber pill that appears below the chat input
// once a conversation is underway. Matches the web app's long-press-to-confirm
// pattern: tap-and-hold 1s to actually end, otherwise cancels cleanly.

import React, { useRef, useState } from 'react';
import { Pressable, View, Text, Animated, StyleSheet, Easing } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radii, spacing } from '../constants/theme';

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
      >
        {/* Progress fill while holding */}
        <Animated.View
          style={[
            styles.fill,
            {
              opacity: 0.25,
              transform: [{ scaleX: fill }],
            },
          ]}
        />
        <Text style={styles.text}>End session</Text>
      </Pressable>
      <Text style={styles.hint}>Hold to end</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 4 },
  btn: {
    paddingHorizontal: 22,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.amberDim,
    overflow: 'hidden',
    position: 'relative',
  },
  btnCharging: { borderColor: colors.amber },
  fill: {
    position: 'absolute',
    left: 0, top: 0, right: 0, bottom: 0,
    backgroundColor: colors.amber,
    transformOrigin: 'left',
  },
  text: { color: colors.amber, fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  hint: {
    color: colors.creamFaint,
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 2,
    fontStyle: 'italic',
  },
});
