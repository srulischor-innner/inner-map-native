// Map tab — Skia-based inner map visualization. Shell only; the real map
// (Wound/Fixer/Skeptic triangle, Self/Self-Like, Managers/Firefighters,
// atmospheric glow, node animations) lands in Step 5 using @shopify/react-native-skia.

import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';

export default function MapScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Inner Map</Text>
        <Text style={styles.sub}>Your map grows with every conversation</Text>
      </View>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          The Skia canvas lands in Step 5 — Wound at top, Fixer &amp; Skeptic at the base,
          Self at center, Managers and Firefighters on the sides.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { alignItems: 'center', paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  title: { color: colors.cream, fontSize: 24, fontWeight: '500' },
  sub: { color: colors.creamFaint, fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  placeholderText: { color: colors.creamDim, fontSize: 14, lineHeight: 22, textAlign: 'center', fontStyle: 'italic' },
});
