// Collapsible "YOUR PROGRESS" strip at the bottom of the Map tab.
// Collapsed: a single-line header the user can tap to expand.
// Expanded: three spectrum bars (each with a "?" info button), in this
// fixed order from top to bottom:
//   1. Outside-In → Inside-Out  (perspective — conceptual)
//   2. Blended → Self-Led        (position — relational, real-time)
//   3. Fragmented → Flowing      (integration — experiential)
// They measure DIFFERENT things and move at different rates. Read each
// independently. The detail panel (? button) explains each one.

import React, { useState } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../../constants/theme';
import { SpectrumBar } from '../journey/SpectrumBar';
import { SpectrumDetailModal, SpectrumKey } from './SpectrumDetailModal';

export function ProgressStrip({
  outsideInScore,
  fragmentedScore,
  blendedSelfLedScore,
  clinicalPatterns,
}: {
  outsideInScore?: number | null;
  fragmentedScore?: number | null;
  blendedSelfLedScore?: number | null;
  clinicalPatterns?: any;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailFor, setDetailFor] = useState<SpectrumKey | null>(null);

  const openDetail = (k: SpectrumKey) => {
    Haptics.selectionAsync().catch(() => {});
    setDetailFor(k);
  };

  // Position lookup for whichever spectrum's panel is open. Kept as a
  // small map so the order in this file matches the order on screen.
  const valueFor = (k: SpectrumKey | null): number | null => {
    if (k === 'outsideIn')    return outsideInScore ?? null;
    if (k === 'blendedSelfLed') return blendedSelfLedScore ?? null;
    if (k === 'fragmented')   return fragmentedScore ?? null;
    return null;
  };

  return (
    <View style={[styles.root, expanded && styles.rootExpanded]}>
      <Pressable
        onPress={() => { Haptics.selectionAsync().catch(() => {}); setExpanded((e) => !e); }}
        style={styles.header}
      >
        <Text style={styles.headerText}>YOUR PROGRESS</Text>
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-up'}
          size={14}
          color={colors.creamFaint}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <SpectrumRow onInfo={() => openDetail('outsideIn')}>
            <SpectrumBar
              leftLabel="Outside-In"
              rightLabel="Inside-Out"
              leftColor={colors.wound}
              rightColor={colors.self}
              value={outsideInScore ?? null}
              caption="How your protective parts orient to the world."
            />
          </SpectrumRow>
          <SpectrumRow onInfo={() => openDetail('blendedSelfLed')}>
            <SpectrumBar
              leftLabel="Blended"
              rightLabel="Self-Led"
              leftColor={colors.firefighters}
              rightColor={colors.self}
              value={blendedSelfLedScore ?? null}
              caption="When parts activate, are you it — or with it?"
            />
          </SpectrumRow>
          <SpectrumRow onInfo={() => openDetail('fragmented')}>
            <SpectrumBar
              leftLabel="Fragmented"
              rightLabel="Flowing"
              leftColor={colors.firefighters}
              rightColor={colors.self}
              value={fragmentedScore ?? null}
              caption="How your whole system is actually running."
            />
          </SpectrumRow>
        </View>
      ) : null}

      <SpectrumDetailModal
        visible={!!detailFor}
        spectrum={detailFor}
        value={valueFor(detailFor)}
        clinicalPatterns={clinicalPatterns}
        onClose={() => setDetailFor(null)}
      />
    </View>
  );
}

/** Row wrapper adding the small "?" info button to the right of a SpectrumBar. */
function SpectrumRow({
  children, onInfo,
}: {
  children: React.ReactNode;
  onInfo: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>{children}</View>
      <Pressable
        onPress={onInfo}
        hitSlop={10}
        style={styles.infoBtn}
        accessibilityLabel="More about this spectrum"
      >
        <Text style={styles.infoText}>?</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: 'rgba(15,14,20,0.95)',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
  },
  rootExpanded: {
    paddingBottom: spacing.md,
  },
  header: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerText: {
    color: colors.creamFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  body: { paddingTop: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.sm,
  },
  // Small 20px amber-ringed "?" button — matches the "?" affordance used
  // elsewhere in the app so it reads as "tap for detail".
  infoBtn: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1, borderColor: colors.amberDim,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(230,180,122,0.06)',
  },
  infoText: {
    color: colors.amber, fontSize: 11, fontWeight: '700',
    lineHeight: 13,
  },
});
