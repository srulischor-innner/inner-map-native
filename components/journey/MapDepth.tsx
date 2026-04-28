// "Your Map" — per-part depth indicator. For each of the seven parts
// we look at the latest mapData blob from /api/journey and compute a
// fraction of expected sections that have content. Renders a small
// colored bar showing depth + an italic excerpt of what was captured.
// Always evolving — never says "complete".

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';

type MapData = {
  // Free-form fields the AI fills in via MAP_UPDATE / MAP_READY.
  wound?: string;
  woundFeeling?: string;
  woundBodyLocation?: string;
  fixer?: string;
  fixerProtects?: string;
  fixerShowsUp?: string;
  skeptic?: string;
  skepticProtects?: string;
  skepticEvidence?: string;
  selfLike?: string;
  selfLikeBuilt?: string;
  selfLikeManages?: string;
  detectedManagers?: any[];
  detectedFirefighters?: any[];
  // Allow other unknown keys — the AI sometimes emits extra ones.
  [k: string]: any;
} | null | undefined;

type PartConfig = {
  key: string;
  name: string;
  color: string;
  // Sections we count for the depth bar. Each is a tuple of dataKey + label.
  sections: { key: string; label: string }[];
  // Excerpt source — first non-empty section's value.
  excerptKeys: string[];
};

const PARTS: PartConfig[] = [
  {
    key: 'wound',
    name: 'Wound',
    color: '#FF5555',
    sections: [
      { key: 'wound', label: 'Core belief' },
      { key: 'woundFeeling', label: 'Feeling layer' },
      { key: 'woundBodyLocation', label: 'Where it lives' },
    ],
    excerptKeys: ['wound', 'woundFeeling'],
  },
  {
    key: 'fixer',
    name: 'Fixer',
    color: '#F0C070',
    sections: [
      { key: 'fixer', label: 'Pattern' },
      { key: 'fixerProtects', label: 'What it protects' },
      { key: 'fixerShowsUp', label: 'How it shows up' },
    ],
    excerptKeys: ['fixer', 'fixerProtects'],
  },
  {
    key: 'skeptic',
    name: 'Skeptic',
    color: '#90C8E8',
    sections: [
      { key: 'skeptic', label: 'Pattern' },
      { key: 'skepticProtects', label: 'What it protects' },
      { key: 'skepticEvidence', label: 'Its evidence' },
    ],
    excerptKeys: ['skeptic', 'skepticProtects'],
  },
  {
    key: 'self-like',
    name: 'Self-Like',
    color: '#A090C0',
    sections: [
      { key: 'selfLike', label: 'What it built' },
      { key: 'selfLikeManages', label: 'How it manages' },
    ],
    excerptKeys: ['selfLike', 'selfLikeBuilt'],
  },
];

export function MapDepth({ mapData }: { mapData: MapData }) {
  const md = mapData || {};
  return (
    <View>
      {PARTS.map((p) => {
        const filled = p.sections.filter((s) => isFilled(md[s.key])).length;
        const total = p.sections.length;
        const excerpt =
          p.excerptKeys.map((k) => (typeof md[k] === 'string' ? md[k] : ''))
                       .find((v) => v && v.trim()) || '';
        const status =
          filled === 0 ? 'Not yet visible' :
          filled === total ? 'Mapped' :
          `${filled} of ${total} sections`;
        return (
          <View key={p.key} style={styles.partRow}>
            <View style={styles.partHeader}>
              <View style={[styles.dot, { backgroundColor: p.color }]} />
              <Text style={styles.partName}>{p.name}</Text>
              <Text style={styles.statusText}>{status}</Text>
            </View>
            <DepthBar filled={filled} total={total} color={p.color} />
            {excerpt ? (
              <Text style={styles.excerpt} numberOfLines={2}>
                {excerpt.trim().slice(0, 140)}
              </Text>
            ) : null}
          </View>
        );
      })}

      {/* Managers + Firefighters — counted, not section-based. */}
      <CountRow
        name="Managers"
        color="#A8DCC0"
        count={Array.isArray(md.detectedManagers) ? md.detectedManagers.length : 0}
      />
      <CountRow
        name="Firefighters"
        color="#F0A050"
        count={Array.isArray(md.detectedFirefighters) ? md.detectedFirefighters.length : 0}
      />
    </View>
  );
}

function isFilled(v: any): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function DepthBar({
  filled, total, color,
}: { filled: number; total: number; color: string }) {
  // Six-pip bar — 1 pip per fraction, hardcoded to 6 pips total for a
  // consistent visual width whether the part has 2 or 3 sections.
  const PIPS = 6;
  const litPips = total === 0 ? 0 : Math.round((filled / total) * PIPS);
  return (
    <View style={styles.barRow}>
      {Array.from({ length: PIPS }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.pip,
            { backgroundColor: i < litPips ? color : 'rgba(255,255,255,0.08)' },
          ]}
        />
      ))}
    </View>
  );
}

function CountRow({
  name, color, count,
}: { name: string; color: string; count: number }) {
  return (
    <View style={styles.partRow}>
      <View style={styles.partHeader}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.partName}>{name}</Text>
        <Text style={styles.statusText}>
          {count === 0 ? 'None identified yet' : `${count} identified`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  partRow: { marginBottom: spacing.md },
  partHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  partName: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.3,
    flex: 1,
  },
  statusText: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  barRow: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: 18,
  },
  pip: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  excerpt: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    lineHeight: 18,
    marginLeft: 18,
    marginTop: 6,
  },
});
