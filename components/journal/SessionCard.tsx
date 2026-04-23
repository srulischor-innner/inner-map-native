// One row in the Journal list. Tap opens the full transcript modal. Cards carry a
// subtle amber hint + map-updated indicator so users can pick out meaningful
// sessions at a glance.

import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';

export type SessionSummary = {
  id: string;
  date?: string;
  time?: string;
  preview?: string;
  title?: string;
  hasMap?: boolean;
  messageCount?: number;
};

export function SessionCard({
  session,
  onPress,
}: {
  session: SessionSummary;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}>
        <Text style={styles.date}>{formatDate(session.date)}</Text>
        {session.time ? <Text style={styles.time}>{session.time}</Text> : null}
      </View>
      {session.title ? (
        <Text style={styles.title} numberOfLines={1}>{session.title}</Text>
      ) : null}
      {session.preview ? (
        <Text style={styles.preview} numberOfLines={2}>"{session.preview}"</Text>
      ) : null}
      <View style={styles.meta}>
        <Text style={styles.metaText}>{session.messageCount || 0} messages</Text>
        {session.hasMap ? (
          <Text style={[styles.metaText, { color: colors.amber }]}>· map updated</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${months[mi]} ${parseInt(d, 10)}, ${y}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.backgroundCard,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { borderColor: colors.amberDim, backgroundColor: colors.backgroundSecondary },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  date: { color: colors.amber, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  time: { color: colors.creamFaint, fontSize: 12 },
  title: { color: colors.cream, fontSize: 15, fontWeight: '500', marginTop: 4 },
  preview: { color: colors.creamDim, fontSize: 13, fontStyle: 'italic', marginTop: 6, lineHeight: 18 },
  meta: { flexDirection: 'row', gap: 6, marginTop: 10 },
  metaText: { color: colors.creamFaint, fontSize: 11 },
});
