// Brief landing/welcome screen shown on every cold open AFTER the
// biometric gate clears, BEFORE the chat tab takes over. The intent is
// the "arrival moment" — warm, intentional, sets the tone — and gives
// the returning-greeting fetch a free 1.5s to complete in the
// background so the chat tab opens with the greeting already loaded.

import React, { useEffect } from 'react';
import { Image, StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue, withTiming, useAnimatedStyle, Easing,
} from 'react-native-reanimated';

const TAGLINES = [
  'A quiet space just for you.',
  "Understand what's happening inside you.",
  'Your inner world, made visible.',
  'The map gets clearer the longer you look.',
];

type Props = { onReady: () => void };

export function LandingScreen({ onReady }: Props) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    // Fade in over 600ms, then signal the parent after a 1500ms hold
    // so the screen lands as a full breath rather than a flash.
    opacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.ease) });
    const t = setTimeout(() => onReady(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // Rotate tagline by day of week so a returning user doesn't see the
  // exact same line every cold launch.
  const tagline = TAGLINES[new Date().getDay() % TAGLINES.length];

  return (
    <Animated.View style={[styles.root, animStyle]}>
      <Image
        source={require('../assets/icon.png')}
        style={styles.icon}
        resizeMode="contain"
      />
      <Text style={styles.title}>Inner Map</Text>
      <Text style={styles.tagline}>{tagline}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  icon: {
    width: 100,
    height: 100,
    marginBottom: 32,
    opacity: 0.95,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 36,
    color: '#F0EDE8',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  tagline: {
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 16,
    color: 'rgba(230,180,122,0.7)',
    textAlign: 'center',
    lineHeight: 24,
  },
});
