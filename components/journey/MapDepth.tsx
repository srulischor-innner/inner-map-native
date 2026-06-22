// "Your Map" — per-part depth indicator. Reads the PARTS TABLE (via
// /api/parts — the same source the Map tab and "Most active energies"
// use), NOT the legacy session `mapData` blob.
//
// Why (June 2026 fix): the session blob is now written as
// {partFindings:[{part,field,value,...}]}, but this component used to read
// legacy FLAT keys (mapData.wound, mapData.fixer, …). Those keys no longer
// exist in the blob, so every part counted zero filled sections and showed
// "Not yet visible" even when the user's map was full. We now count the
// confirmed/filled markerFields on each part row instead — the single
// source of truth the rest of the app already trusts.
//
// For each of the four core parts we compute a fraction of expected
// sections that have content + an italic excerpt of what was captured.
// Managers / Firefighters are counted by category. Always evolving —
// never says "complete".

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '../../constants/theme';

// A part row as returned by /api/parts:
//   { category, name, corePhrase, detectionCount,
//     markerFields: { <field>: { value, confidence, ts } }, ... }
type Part = {
  category?: string;
  name?: string;
  corePhrase?: string | null;
  markerFields?: Record<string, { value?: string; confidence?: string }> | null;
  [k: string]: any;
};

type PartConfig = {
  key: string;          // matches parts.category
  name: string;
  color: string;
  // Sections counted for the depth bar — each is a markerFields field key.
  sections: { field: string; label: string }[];
  // Excerpt source — first non-empty value among these fields (falls back
  // to the part's corePhrase).
  excerptFields: string[];
};

const PARTS: PartConfig[] = [
  {
    key: 'wound',
    name: 'Wound',
    color: '#FF5555',
    sections: [
      { field: 'belief', label: 'Core belief' },
      { field: 'feeling', label: 'Feeling layer' },
      { field: 'body', label: 'Where it lives' },
    ],
    excerptFields: ['belief', 'feeling'],
  },
  {
    key: 'fixer',
    name: 'Fixer',
    color: '#F0C070',
    sections: [
      { field: 'pattern', label: 'Pattern' },
      { field: 'what-it-protects', label: 'What it protects' },
      { field: 'how-it-shows-up', label: 'How it shows up' },
    ],
    excerptFields: ['pattern', 'what-it-protects'],
  },
  {
    key: 'skeptic',
    name: 'Skeptic',
    color: '#90C8E8',
    sections: [
      { field: 'pattern', label: 'Pattern' },
      { field: 'what-it-protects', label: 'What it protects' },
      { field: 'how-it-shows-up', label: 'How it shows up' },
    ],
    excerptFields: ['pattern', 'what-it-protects'],
  },
  {
    key: 'self-like',
    name: 'Self-Like',
    color: '#A090C0',
    sections: [
      { field: 'what-it-built', label: 'What it built' },
      { field: 'agenda', label: 'How it manages' },
    ],
    excerptFields: ['what-it-built', 'agenda'],
  },
];

// Read a markerFields value for a field — non-empty trimmed string or ''.
function fieldValue(part: Part | undefined, field: string): string {
  const mf = part?.markerFields;
  const entry = mf && typeof mf === 'object' ? mf[field] : null;
  const v = entry && typeof entry === 'object' ? entry.value : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

export function MapDepth({ parts }: { parts: Part[] | null | undefined }) {
  const rows = Array.isArray(parts) ? parts : [];
  const catOf = (p: Part) => String(p?.category || '').toLowerCase();
  const findPart = (cat: string) =>
    rows.find((p) => {
      const c = catOf(p);
      // 'compromised' is the legacy alias for the self-like category.
      return c === cat || (cat === 'self-like' && c === 'compromised');
    });

  return (
    <View>
      {PARTS.map((p) => {
        const part = findPart(p.key);
        const filled = p.sections.filter((s) => fieldValue(part, s.field)).length;
        const total = p.sections.length;
        const excerpt =
          p.excerptFields.map((f) => fieldValue(part, f)).find((v) => v) ||
          (typeof part?.corePhrase === 'string' ? part.corePhrase.trim() : '');
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
                {excerpt.slice(0, 140)}
              </Text>
            ) : null}
          </View>
        );
      })}

      {/* Managers + Firefighters — counted from the parts table by category. */}
      <CountRow
        name="Managers"
        color="#A8DCC0"
        count={rows.filter((p) => catOf(p) === 'manager').length}
      />
      <CountRow
        name="Firefighters"
        color="#F0A050"
        count={rows.filter((p) => catOf(p) === 'firefighter').length}
      />
    </View>
  );
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
