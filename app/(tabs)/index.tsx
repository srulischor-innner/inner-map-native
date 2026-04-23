// Chat tab — default route. Shell for now; the real chat UI (message bubbles,
// streaming word-by-word reveal, part detection badge, mic input, TTS playback)
// lands in Step 4 of the build order.

import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';

export default function ChatScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Inner Map</Text>
        <Text style={styles.sub}>Chat</Text>
      </View>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          The conversation screen lives here.{'\n'}
          Messages, streaming replies, mic input, and part detection land in Step 4.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  title: { color: colors.amber, fontSize: 22, fontWeight: '500', letterSpacing: 0.3 },
  sub: { color: colors.creamFaint, fontSize: 12, letterSpacing: 1.2, marginTop: 2 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  placeholderText: {
    color: colors.creamDim,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
