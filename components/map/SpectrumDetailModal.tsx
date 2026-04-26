// Bottom-sheet explainer panel for one of the THREE spectrum bars:
//   1. Outside-In  → Inside-Out   (perspective)
//   2. Blended     → Self-Led      (position when parts activate)
//   3. Fragmented  → Flowing       (system integration)
//
// All "score" language has been removed app-wide. The bar shows a position
// only — never a number, never a percentage. Sections speak about "the
// current reading" / "what the spectrum is picking up" / "how it moves".

import React from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radii, spacing } from '../../constants/theme';

export type SpectrumKey = 'outsideIn' | 'blendedSelfLed' | 'fragmented';

type Props = {
  visible: boolean;
  spectrum: SpectrumKey | null;
  /** 0..1 — same scale as SpectrumBar. Null hides the marker. Never shown
   *  as a number anywhere; only used to position the marker. */
  value?: number | null;
  /** clinicalPatterns from /api/journey — one of:
   *    outsideInKeywords / insideOutKeywords
   *    blendedKeywords   / selfLedKeywords
   *    fragmentedKeywords / flowingKeywords
   *  Each is an array of phrases the spectrum is currently picking up. */
  clinicalPatterns?: any;
  onClose: () => void;
};

export function SpectrumDetailModal({
  visible, spectrum, value, clinicalPatterns, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  if (!spectrum) return null;
  const copy =
    spectrum === 'outsideIn'      ? OUTSIDE_IN :
    spectrum === 'blendedSelfLed' ? BLENDED_SELF_LED :
    FRAGMENTED;

  // Indicator keyword arrays — left is the side the reading moves AWAY from,
  // right is the side it moves TOWARD. Names match the journey payload shape.
  const leftKeyName  = copy.leftKeysField;
  const rightKeyName = copy.rightKeysField;
  const leftKeys: string[]  = Array.isArray(clinicalPatterns?.[leftKeyName])  ? clinicalPatterns[leftKeyName]  : [];
  const rightKeys: string[] = Array.isArray(clinicalPatterns?.[rightKeyName]) ? clinicalPatterns[rightKeyName] : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{copy.title}</Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Position bar — pole labels above, the bar with a marker below.
              No number is ever shown to the user. The marker's horizontal
              position IS the entire readout. */}
          <View style={styles.barRow}>
            <Text style={styles.barLabelLeft}>{copy.leftLabel}</Text>
            <Text style={styles.barLabelRight}>{copy.rightLabel}</Text>
          </View>
          <View style={styles.barWrap}>
            <View style={styles.barTrack} />
            {typeof value === 'number' ? (
              <View
                style={[
                  styles.barMarker,
                  { left: `${Math.max(0, Math.min(1, value)) * 100}%` },
                ]}
              />
            ) : (
              <Text style={styles.barNoData}>not enough signal yet</Text>
            )}
          </View>

          {/* Per-spectrum sections — ORDER and HEADINGS come from the copy
              object so each spectrum can have a different structure (the
              Blended → Self-Led panel adds a "Three levels of unblending"
              section the others don't have). */}
          {copy.sections.map((s, i) => (
            <View key={i}>
              <Text style={styles.sectionLabel}>{s.label.toUpperCase()}</Text>
              {s.paragraphs.map((p, j) => (
                <Text key={j} style={styles.paragraph}>{p}</Text>
              ))}
            </View>
          ))}

          {/* "What the spectrum is picking up" — keyword indicators */}
          <Text style={styles.sectionLabel}>WHAT THE SPECTRUM IS PICKING UP</Text>
          {leftKeys.length === 0 && rightKeys.length === 0 ? (
            <Text style={styles.empty}>
              More conversations will reveal the specific language patterns the spectrum is reading.
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

          {/* How it moves — closing note */}
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
// COPY — three spectrum panels. Sections are an ordered list so the Blended
// → Self-Led panel can add its "Three levels of unblending" section without
// the others needing to carry it.
// ============================================================================
type SpectrumCopy = {
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftKeysField: string;
  rightKeysField: string;
  leftIndicatorsHeading: string;
  rightIndicatorsHeading: string;
  leftPlaceholders: string[];
  rightPlaceholders: string[];
  sections: { label: string; paragraphs: string[] }[];
  howItMoves: string;
};

const OUTSIDE_IN: SpectrumCopy = {
  title: 'Outside-In → Inside-Out',
  leftLabel: 'Outside-In',
  rightLabel: 'Inside-Out',
  leftKeysField: 'outsideInKeywords',
  rightKeysField: 'insideOutKeywords',
  leftIndicatorsHeading: 'Outside-In indicators',
  rightIndicatorsHeading: 'Inside-Out indicators',
  leftPlaceholders: [
    "if they would just…",
    "when things settle down…",
    "once I achieve…",
  ],
  rightPlaceholders: [
    "I notice in myself…",
    "something in me…",
    "I'm starting to see that…",
  ],
  sections: [
    {
      label: 'What this tracks',
      paragraphs: [
        "This tracks how your protective parts are orienting to the world. Are they still looking outside for what can only be found within?",
        "Toward Outside-In suggests your parts are still largely focused outward — believing that external things (other people changing, circumstances improving, achievements) will resolve what's happening inside.",
        "Toward Inside-Out suggests a conceptual shift is happening — your parts are beginning to recognize that the resources exist internally. This is understanding, not healing — but understanding is where healing begins.",
      ],
    },
  ],
  howItMoves:
    "This shifts as your understanding deepens — as you begin to genuinely recognize that what you're looking for outside cannot be found there. It often moves through conversation and insight before the system catches up experientially.",
};

const BLENDED_SELF_LED: SpectrumCopy = {
  title: 'Blended → Self-Led',
  leftLabel: 'Blended',
  rightLabel: 'Self-Led',
  leftKeysField: 'blendedKeywords',
  rightKeysField: 'selfLedKeywords',
  leftIndicatorsHeading: 'Blended indicators',
  rightIndicatorsHeading: 'Self-Led indicators',
  leftPlaceholders: [
    "I am furious",
    "I'm just so anxious",
    "this is who I am",
    "I always do this",
  ],
  rightPlaceholders: [
    "a part of me feels…",
    "something in me is…",
    "I notice…",
    "I can stay with this",
    "my chest softened",
  ],
  sections: [
    {
      label: 'What this measures',
      paragraphs: [
        "This tracks something different from the other two spectrums. Outside-In measures how your protectors see the world. Fragmented → Flowing measures how integrated your whole system is. This one measures something more specific: when a part activates, are you IT — or are you WITH it?",
      ],
    },
    {
      label: 'Toward the Blended side',
      paragraphs: [
        "When parts activate, they take you over. You become the fixer, become the skeptic, become the wound. There's no space between you and the part — you ARE the part for as long as it's running. This isn't a failure. It's how the system runs by default before any inner work has happened.",
      ],
    },
    {
      label: 'Toward the Self-Led side',
      paragraphs: [
        "When parts activate, there's a 'you' that can notice them. You can say 'a part of me is feeling this' rather than 'I am this.' Not detachment — closer to companionship. The part is still there. You're just not lost in it anymore.",
      ],
    },
    {
      label: 'Three levels of unblending',
      paragraphs: [
        "Unblending isn't one thing. It happens on three levels, and they don't always arrive together.",
        "Thought — you can name the part. \"A part of me is anxious.\" The words are right, the framework applies. This is real but it's the most surface layer.",
        "Feeling — you sense yourself with the part rather than in it. There's a felt difference. You can stay with what's there without being taken over by it.",
        "Sensation — your body reflects the shift. Chest softens. Breath deepens. The grip lets go. The part itself feels less heavy, less urgent. Something has actually moved.",
        "All three are unblending. One level alone is partial. Two levels is a real shift. All three together is the genuine arrival. Don't try to make this happen — chasing it creates another performance. Real unblending arrives when a part is genuinely received.",
      ],
    },
  ],
  howItMoves:
    "This shifts through repeated experience of unblending — usually first with smaller parts before bigger ones. Reading about the difference helps. Actually living it is the real teacher. Self energy is what allows unblending, so this spectrum and Fragmented → Flowing tend to influence each other over time.",
};

const FRAGMENTED: SpectrumCopy = {
  title: 'Fragmented → Flowing',
  leftLabel: 'Fragmented',
  rightLabel: 'Flowing',
  leftKeysField: 'fragmentedKeywords',
  rightKeysField: 'flowingKeywords',
  leftIndicatorsHeading: 'Fragmented indicators',
  rightIndicatorsHeading: 'Flowing indicators',
  leftPlaceholders: [
    "intense blending language",
    "parts in conflict",
    "no Self access detected",
  ],
  rightPlaceholders: [
    "moments of Self energy",
    "genuine curiosity without agenda",
    "I feel okay with this",
    "unblending language",
  ],
  sections: [
    {
      label: 'What this tracks',
      paragraphs: [
        "This tracks your actual system health — how much Self energy is present, how well your parts are working together, whether genuine healing movement is happening.",
        "Unlike the Outside-In spectrum, this one doesn't shift through understanding alone. It shifts through actual healing — moments of genuine unblending, parts feeling truly heard, Self energy emerging, burdens being released.",
        "Toward Fragmented doesn't mean you're doing something wrong. It means the system is still working hard to manage the wound. That's where most people are when they begin.",
      ],
    },
  ],
  howItMoves:
    "This shifts slowly and genuinely — it cannot be manufactured. What moves it: staying with difficult feelings rather than managing them, parts feeling truly received, moments when the system relaxes on its own. Trust the process.",
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
  title: { color: colors.amber, fontFamily: fonts.serifBold, fontSize: 24, letterSpacing: 0.3 },
  close: { padding: 6 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

  // Position bar — visual only, no number is ever rendered.
  barRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  barLabelLeft:  { color: colors.creamDim, fontSize: 11, letterSpacing: 1.5 },
  barLabelRight: { color: colors.creamDim, fontSize: 11, letterSpacing: 1.5, textAlign: 'right' },
  barWrap: {
    marginTop: 8, marginBottom: spacing.md,
    height: 18,
    justifyContent: 'center',
  },
  barTrack: {
    height: 4,
    backgroundColor: 'rgba(230,180,122,0.25)',
    borderRadius: 2,
  },
  barMarker: {
    position: 'absolute',
    top: 2,
    width: 14, height: 14, borderRadius: 7,
    marginLeft: -7,
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  barNoData: {
    position: 'absolute', right: 0, top: 1,
    color: colors.creamFaint, fontSize: 11, fontStyle: 'italic',
  },

  sectionLabel: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 2,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  paragraph: {
    color: colors.cream, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 24, marginBottom: spacing.sm,
  },
  empty: {
    color: colors.creamFaint, fontFamily: fonts.serifItalic,
    fontSize: 14, lineHeight: 22, paddingVertical: spacing.sm,
  },
  keywordHeading: {
    fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 1.5,
    textTransform: 'uppercase', marginBottom: 6,
  },
  keywordLine: {
    fontFamily: fonts.sans,
    fontSize: 14, lineHeight: 22,
    paddingLeft: 4,
  },
});
