// Journal tab — session history list. Shell only; real list + detail modal lands later.

import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';

export default function JournalScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Journal</Text>
        <Text style={styles.sub}>A quiet space just for you</Text>
      </View>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Your session history will appear here.{'\n'}
          Tap any session to read the full transcript.
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
