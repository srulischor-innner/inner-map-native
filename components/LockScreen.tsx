// Biometric lock screen — shown when the user cancels Face ID or it fails.
// A single amber "Unlock with Face ID" button re-prompts the OS biometric
// dialog. There's no fallback / bypass — the lock is meaningful precisely
// because it can't be skipped without the user's face / passcode.
//
// The triangle icon mirrors the breathing-triangle motif used elsewhere
// (session summary loader, attention indicator) so the lock screen reads
// as part of Inner Map, not a generic system gate.

import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import {
  useSharedValue, withRepeat, withTiming, Easing, useDerivedValue,
} from 'react-native-reanimated';
import { colors, fonts } from '../constants/theme';

type Props = { onUnlock: () => void };

export function LockScreen({ onUnlock }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <BreathingTriangle />
        <Text style={styles.privacyText}>Your inner world is private.</Text>
      </View>
      <View style={styles.footer}>
        <Pressable
          onPress={onUnlock}
          style={styles.btn}
          accessibilityLabel="Unlock with Face ID"
          hitSlop={12}
        >
          <Text style={styles.btnText}>UNLOCK WITH FACE ID</Text>
        </Pressable>
      </View>
    </View>
  );
}

const TRI = 80;
function BreathingTriangle() {
  const breath = useSharedValue(0.45);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.95, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [breath]);
  const op = useDerivedValue(() => breath.value, [breath]);
  const path = (() => {
    const p = Skia.Path.Make();
    const pad = 6;
    p.moveTo(TRI / 2, pad);
    p.lineTo(TRI - pad, TRI - pad);
    p.lineTo(pad, TRI - pad);
    p.close();
    return p;
  })();
  return (
    <Canvas style={{ width: TRI, height: TRI }}>
      <Group opacity={op}>
        <Path path={path} color="#E6B47A" style="stroke" strokeWidth={2.2} />
        <Path path={path} color="#E6B47A33" style="fill" />
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  root: {
    // Absolute-fill so the lock screen overlays the Stack at the root
    // layout level (rendered as a sibling, not inside a flex container).
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: colors.background,
    paddingHorizontal: 32,
    justifyContent: 'space-between',
    paddingVertical: 80,
    zIndex: 1000,
    elevation: 1000,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  privacyText: {
    color: colors.cream,
    fontFamily: fonts.serif,
    fontSize: 20,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  footer: { alignItems: 'center' },
  btn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  btnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 2,
  },
});
