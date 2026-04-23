// Bipolar spectrum bar — a gradient track with a marker showing where the user
// currently sits. `value` is 0..1, where 0 = left pole, 1 = right pole.
// Used for "Outside-In → Inside-Out" and "Fragmented → Flowing".

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';

type Props = {
  leftLabel: string;
  rightLabel: string;
  caption?: string;
  value: number | null | undefined;
  leftColor?: string;
  rightColor?: string;
};

export function SpectrumBar({ leftLabel, rightLabel, caption, value, leftColor, rightColor }: Props) {
  const hasData = value != null && !Number.isNaN(value);
  const v = Math.max(0, Math.min(1, hasData ? Number(value) : 0.5));
  const lc = leftColor || colors.wound;
  const rc = rightColor || colors.self;

  return (
    <View style={styles.root}>
      <View style={styles.labels}>
        <Text style={[styles.label, { color: lc }]}>{leftLabel}</Text>
        <Text style={[styles.label, { color: rc, textAlign: 'right' }]}>{rightLabel}</Text>
      </View>
      <View style={styles.track}>
        {/* Soft gradient feel via three stacked blocks */}
        <View style={[styles.trackSegment, { backgroundColor: lc + '30' }]} />
        <View style={[styles.trackSegment, { backgroundColor: 'rgba(255,255,255,0.03)' }]} />
        <View style={[styles.trackSegment, { backgroundColor: rc + '30' }]} />
        {hasData ? (
          <View
            style={[
              styles.marker,
              { left: `${v * 100}%`, backgroundColor: colors.cream, shadowColor: colors.cream },
            ]}
          />
        ) : (
          <View style={styles.markerDimOverlay}>
            <Text style={styles.markerDimText}>not enough signal yet</Text>
          </View>
        )}
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: spacing.md },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 1.1, flex: 1, textTransform: 'uppercase' },
  track: {
    height: 8,
    borderRadius: radii.sm,
    flexDirection: 'row',
    overflow: 'visible',
    position: 'relative',
  },
  trackSegment: { flex: 1, height: 8 },
  marker: {
    position: 'absolute',
    top: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  markerDimOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDimText: {
    color: colors.creamFaint,
    fontSize: 10,
    fontStyle: 'italic',
    letterSpacing: 0.5,
  },
  caption: { color: colors.creamDim, fontSize: 12, fontStyle: 'italic', marginTop: 8, lineHeight: 18 },
});
