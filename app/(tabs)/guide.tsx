// Guide tab — three pill-nav sections (The Map / Healing / Using It) with swipeable
// slides. Shell only; slide content + swipe animation land in Step 6.

import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';

export default function GuideScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Guide</Text>
      </View>
      <View style={styles.pills}>
        <View style={[styles.pill, styles.pillActive]}><Text style={styles.pillTextActive}>THE MAP</Text></View>
        <View style={styles.pill}><Text style={styles.pillText}>HEALING</Text></View>
        <View style={styles.pill}><Text style={styles.pillText}>USING IT</Text></View>
      </View>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Guide slides and swipe nav land in Step 6.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, alignItems: 'center' },
  title: { color: colors.amber, fontSize: 22, fontWeight: '500', letterSpacing: 0.3 },
  pills: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: colors.amberDim },
  pillActive: { backgroundColor: colors.amberFaint, borderColor: colors.amber },
  pillText: { color: colors.creamFaint, fontSize: 11, fontWeight: '600', letterSpacing: 1.8 },
  pillTextActive: { color: colors.amber, fontSize: 11, fontWeight: '600', letterSpacing: 1.8 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  placeholderText: { color: colors.creamDim, fontSize: 14, lineHeight: 22, textAlign: 'center', fontStyle: 'italic' },
});
