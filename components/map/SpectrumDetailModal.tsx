// Bottom-sheet explainer panel for one of the two spectrum bars (Outside-In
// ↔ Inside-Out, Fragmented ↔ Flowing). Same visual grammar as the node
// folder modal so the experience feels consistent.
//
// Content is spectrum-specific:
//   - a richer score bar with a position marker
//   - a warm explanation of what the spectrum tracks
//   - "Keywords driving this score" — two tinted lists (indicators against vs
//     with the direction of movement), pulled from /api/journey.clinicalPatterns
//     when available, otherwise a gentle "more data needed" line
//   - "How it moves" — closing note on what actually shifts the score

import React from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../constants/theme';

export type SpectrumKey = 'outsideIn' | 'fragmented';

type Props = {
  visible: boolean;
  spectrum: SpectrumKey | null;
  /** 0..1 — same scale as the existing SpectrumBar rendering. Null hides the marker. */
  value?: number | null;
  /** Optional clinicalPatterns from /api/journey (outsideInKeywords / insideOutKeywords / etc). */
  clinicalPatterns?: any;
  onClose: () => void;
};

export function SpectrumDetailModal({
  visible, spectrum, value, clinicalPatterns, onClose,
}: Props) {
  if (!spectrum) return null;
  const copy = spectrum === 'outsideIn' ? OUTSIDE_IN : FRAGMENTED;

  // Pull indicator keywords out of the journey payload when the server has
  // them. Naming matches the web app's /api/journey shape:
  //   clinicalPatterns.outsideInKeywords    → "outside-in" language
  //   clinicalPatterns.insideOutKeywords    → "inside-out" language
  //   clinicalPatterns.fragmentedKeywords   → "fragmented" language
  //   clinicalPatterns.flowingKeywords      → "flowing" language
  const leftKeys: string[] = Array.isArray(
    clinicalPatterns?.[spectrum === 'outsideIn' ? 'outsideInKeywords' : 'fragmentedKeywords'],
  ) ? clinicalPatterns[spectrum === 'outsideIn' ? 'outsideInKeywords' : 'fragmentedKeywords'] : [];
  const rightKeys: string[] = Array.isArray(
    clinicalPatterns?.[spectrum === 'outsideIn' ? 'insideOutKeywords' : 'flowingKeywords'],
  ) ? clinicalPatterns[spectrum === 'outsideIn' ? 'insideOutKeywords' : 'flowingKeywords'] : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{copy.title}</Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Score bar with position marker */}
          <View style={styles.scoreRow}>
            <Text style={styles.scoreLabelLeft}>{copy.leftLabel}</Text>
            <Text style={styles.scoreLabelRight}>{copy.rightLabel}</Text>
          </View>
          <View style={styles.scoreBarWrap}>
            <View style={styles.scoreBar} />
            {typeof value === 'number' ? (
              <View
                style={[
                  styles.scoreMarker,
                  { left: `${Math.max(0, Math.min(1, value)) * 100}%` },
                ]}
              />
            ) : (
              <Text style={styles.scoreNoData}>no data yet</Text>
            )}
          </View>

          {/* Explanation */}
          <Text style={styles.sectionLabel}>WHAT THIS TRACKS</Text>
          {copy.explanation.map((p, i) => (
            <Text key={i} style={styles.paragraph}>{p}</Text>
          ))}

          {/* Keywords */}
          <Text style={styles.sectionLabel}>KEYWORDS DRIVING THIS SCORE</Text>
          {leftKeys.length === 0 && rightKeys.length === 0 ? (
            <Text style={styles.empty}>
              More conversations will reveal the specific language patterns driving your score.
            </Text>
          ) : (
            <>
              <KeywordList
                heading={copy.leftIndicatorsHeading}
                tint="rgba(224,85,85,0.75)"
                items={leftKeys}
                placeholders={copy.leftPlaceholders}
              />
              <View style={{ height: spacing.md }} />
              <KeywordList
                heading={copy.rightIndicatorsHeading}
                tint="rgba(230,180,122,0.85)"
                items={rightKeys}
                placeholders={copy.rightPlaceholders}
              />
            </>
          )}

          {/* How it moves */}
          <Text style={styles.sectionLabel}>HOW IT MOVES</Text>
          <Text style={styles.paragraph}>{copy.howItMoves}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function KeywordList({
  heading, tint, items, placeholders,
}: {
  heading: string; tint: string; items: string[]; placeholders: string[];
}) {
  // Use placeholders only if no real items — never mix real keywords with
  // example phrases in the same list.
  const source = items.length > 0 ? items : placeholders;
  const isExamples = items.length === 0;
  return (
    <View>
      <Text style={[styles.keywordHeading, { color: tint }]}>{heading}</Text>
      {source.map((s, i) => (
        <Text key={i} style={[styles.keywordLine, { color: tint }]}>
          — {isExamples ? `"${s}"` : s}
        </Text>
      ))}
    </View>
  );
}

// ============================================================================
// COPY — identical to the spec the user approved.
// ============================================================================
const OUTSIDE_IN = {
  title: 'Outside-In → Inside-Out',
  leftLabel: 'Outside-In',
  rightLabel: 'Inside-Out',
  explanation: [
    "This tracks how your protective parts are orienting to the world. Are they still looking outside for what can only be found within?",
    "A lower score suggests your parts are still largely focused outward — believing that external things (other people changing, circumstances improving, achievements) will resolve what's happening inside.",
    "A higher score suggests a conceptual shift is happening — your parts are beginning to recognize that the resources exist internally. This is understanding, not healing — but understanding is where healing begins.",
  ],
  leftIndicatorsHeading: 'Outside-In indicators',
  leftPlaceholders: [
    "if they would just…",
    "when things settle down…",
    "once I achieve…",
  ],
  rightIndicatorsHeading: 'Inside-Out indicators',
  rightPlaceholders: [
    "I notice in myself…",
    "something in me…",
    "I'm starting to see that…",
  ],
  howItMoves:
    "This score shifts as your understanding deepens — as you begin to genuinely recognize that what you're looking for outside cannot be found there. It often moves through conversation and insight before the system catches up experientially.",
};

const FRAGMENTED = {
  title: 'Fragmented → Flowing',
  leftLabel: 'Fragmented',
  rightLabel: 'Flowing',
  explanation: [
    "This tracks your actual system health — how much Self energy is present, how well your parts are working together, whether genuine healing movement is happening.",
    "Unlike the Outside-In spectrum, this one doesn't shift through understanding alone. It shifts through actual healing — moments of genuine unblending, parts feeling truly heard, Self energy emerging, burdens being released.",
    "A lower score doesn't mean you're doing something wrong. It means the system is still working hard to manage the wound. That's where most people are when they begin.",
  ],
  leftIndicatorsHeading: 'Fragmented indicators',
  leftPlaceholders: [
    "intense blending language",
    "parts in conflict",
    "no Self access detected",
  ],
  rightIndicatorsHeading: 'Flowing indicators',
  rightPlaceholders: [
    "moments of Self energy",
    "genuine curiosity without agenda",
    "I feel okay with this",
    "unblending language",
  ],
  howItMoves:
    "This score shifts slowly and genuinely — it cannot be manufactured. What moves it: staying with difficult feelings rather than managing them, parts feeling truly received, moments when the system relaxes on its own. Trust the process.",
};

// ============================================================================
const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    maxHeight: '88%',
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 0.5,
    borderTopColor: colors.borderAmber,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 42, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  title: { color: colors.amber, fontSize: 20, fontWeight: '500', letterSpacing: 0.3 },
  close: { padding: 6 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  scoreLabelLeft:  { color: colors.creamDim, fontSize: 11, letterSpacing: 1.5 },
  scoreLabelRight: { color: colors.creamDim, fontSize: 11, letterSpacing: 1.5, textAlign: 'right' },
  scoreBarWrap: {
    marginTop: 8, marginBottom: spacing.md,
    height: 18,
    justifyContent: 'center',
  },
  scoreBar: {
    height: 4,
    backgroundColor: 'rgba(230,180,122,0.25)',
    borderRadius: 2,
  },
  scoreMarker: {
    position: 'absolute',
    top: 2, // center of 18 minus half of marker height
    width: 14, height: 14, borderRadius: 7,
    marginLeft: -7,
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  scoreNoData: {
    position: 'absolute', right: 0, top: 1,
    color: colors.creamFaint, fontSize: 11, fontStyle: 'italic',
  },

  sectionLabel: {
    color: colors.amber, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.6, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  paragraph: {
    color: colors.cream, fontSize: 14, lineHeight: 22, marginBottom: spacing.sm,
  },
  empty: {
    color: colors.creamFaint, fontSize: 13, lineHeight: 20,
    fontStyle: 'italic', paddingVertical: spacing.sm,
  },
  keywordHeading: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 6,
  },
  keywordLine: {
    fontSize: 14, lineHeight: 22,
    paddingLeft: 4,
  },
});
