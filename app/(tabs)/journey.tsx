// Journey tab — shows how you're changing across sessions. Active energies, language
// patterns, spectrums, and timeline. Shell only; charts (Victory Native) land later.

import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';

export default function JourneyScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Journey</Text>
        <Text style={styles.sub}>How you're changing across sessions</Text>
      </View>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Most active energies, language patterns, spectrum bars, and your timeline
          will live here. All sections are visible from the first session — they just
          start empty and fill in over time.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  title: { color: colors.amber, fontSize: 22, fontWeight: '500', letterSpacing: 0.3 },
  sub: { color: colors.creamFaint, fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  placeholderText: { color: colors.creamDim, fontSize: 14, lineHeight: 22, textAlign: 'center', fontStyle: 'italic' },
});
