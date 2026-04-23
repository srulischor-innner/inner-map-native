// Vertical timeline — one item per session in reverse-chronological order. Each row
// has a left-side dot + connecting line, date, preview, and an amber "map built"
// indicator if the session produced a map.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';

export type PathItem = {
  id: string;
  date?: string;
  time?: string;
  preview?: string;
  title?: string;
  hasMap?: boolean;
  messageCount?: number;
};

export function PathTimeline({ items }: { items: PathItem[] }) {
  if (!items || items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Your conversations will stack here over time — each one a marker on the path.
        </Text>
      </View>
    );
  }
  return (
    <View>
      {items.map((it, idx) => (
        <View key={it.id} style={styles.row}>
          <View style={styles.rail}>
            <View style={[styles.dot, it.hasMap && styles.dotMap]} />
            {idx < items.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={styles.body}>
            <Text style={styles.date}>
              {formatDate(it.date)}
              {it.time ? <Text style={styles.time}>{' · ' + it.time}</Text> : null}
            </Text>
            {it.title ? <Text style={styles.title}>{it.title}</Text> : null}
            {it.preview ? (
              <Text style={styles.preview} numberOfLines={2}>"{it.preview}"</Text>
            ) : null}
            <View style={styles.meta}>
              <Text style={styles.metaText}>{it.messageCount || 0} messages</Text>
              {it.hasMap ? <Text style={[styles.metaText, { color: colors.amber }]}>· map updated</Text> : null}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  // iso is 'YYYY-MM-DD'. Convert to locale short date without depending on Intl polyfills.
  const [y, m, d] = iso.split('-');
  if (!y) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${months[mi]} ${parseInt(d, 10)}, ${y}`;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  rail: { width: 18, alignItems: 'center' },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 6,
  },
  dotMap: {
    backgroundColor: colors.amber,
    shadowColor: colors.amber, shadowOpacity: 0.8, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
  },
  line: { flex: 1, width: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 2 },
  body: { flex: 1, backgroundColor: colors.backgroundCard, borderRadius: radii.md, padding: spacing.sm },
  date: { color: colors.amber, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  time: { color: colors.creamFaint, fontWeight: '400' },
  title: { color: colors.cream, fontSize: 15, fontWeight: '500', marginTop: 4 },
  preview: { color: colors.creamDim, fontSize: 13, fontStyle: 'italic', marginTop: 4, lineHeight: 18 },
  meta: { flexDirection: 'row', gap: 6, marginTop: 8 },
  metaText: { color: colors.creamFaint, fontSize: 11 },

  empty: {
    padding: spacing.md,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  emptyText: { color: colors.creamFaint, fontSize: 13, lineHeight: 20, fontStyle: 'italic' },
});
