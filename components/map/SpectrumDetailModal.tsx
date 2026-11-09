// Bottom-sheet explainer panel for one of the THREE spectrum bars:
//   1. Outside-In  → Inside-Out   (perspective)
//   2. Blended     → You Leading   (position when parts activate;
//      BLENDED_YOU_LEADING, written in its own words since the founder's
//      copy v2, 2026-11-09)
//   3. Fragmented  → Integrated    (system integration)
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
    spectrum === 'blendedSelfLed' ? BLENDED_YOU_LEADING :
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
              <Text style={styles.barNoData}>Nothing to show yet; this fills in as you talk.</Text>
            )}
          </View>

          {/* Per-spectrum sections — ORDER and HEADINGS come from the copy
              object so each spectrum can have a different structure (the
              Blended → You Leading panel adds a "Three levels of unblending"
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
              After a few conversations, the words that keep coming back show here.
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
// → You Leading panel can add its "Three levels of unblending" section without
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
    "when things calm down…",
    "once this changes…",
    "language that places the source of resolution outside",
    "reactions to events without curiosity about what they're showing",
  ],
  rightPlaceholders: [
    "I notice in myself…",
    "something in me is…",
    "I'm starting to see that…",
    "this keeps happening and I wonder what it's showing me",
    "taking responsibility for inner experience regardless of outer circumstances",
  ],
  sections: [
    {
      label: 'What this measures',
      paragraphs: [
        "This isn't about ignoring your outer life. It's about the direction of flow.",
        "Outside-in means external events are driving you — what happens determines how you feel and what you do. Your mood, your sense of worth, your peace — all of it contingent on what's happening around you.",
        "Inside-out means something has shifted. Your inner world is becoming the source, and your outer life is beginning to reflect it. Your relationships, your choices, your way of moving through the world — flowing from within rather than reacting to what's outside.",
        "Your outer life is also worth looking at — not because the answer is out there, but because it's a mirror. The patterns that keep repeating, the situations that keep finding you, the relationships that activate the same feelings — these are showing you something about what's happening inside.",
        "This spectrum tracks that shift. From being driven by what happens — to moving from who you are.",
      ],
    },
    {
      label: 'Toward Outside-In',
      paragraphs: [
        "External events are still largely driving the experience. Worth, peace, and direction feel contingent on circumstances — on other people changing, situations improving, things settling down.",
      ],
    },
    {
      label: 'Toward Inside-Out',
      paragraphs: [
        "A shift is happening. There's growing recognition that what you're looking for can only be found within — and that your outer life is beginning to reflect your inner one rather than dictate it.",
      ],
    },
  ],
  howItMoves:
    "This moves as recognition deepens and gets lived, usually in small ways first, until your outer life begins to reflect the inner shift. There's no order it has to go in.",
};

// "Self-Led" → "You Leading" (CHANGE-LIST-2026-11-08 ruling 5, then the
// founder's copy v2, 2026-11-09, which rewrote the sentences too): the one who
// leads is You, and Self is underneath. Written here in its own words; the
// payload keys (blendedKeywords / selfLedKeywords) are unchanged.
const BLENDED_YOU_LEADING: SpectrumCopy = {
  title: 'Blended → You Leading',
  leftLabel: 'Blended',
  rightLabel: 'You Leading',
  leftKeysField: 'blendedKeywords',
  rightKeysField: 'selfLedKeywords',
  leftIndicatorsHeading: 'Blended indicators',
  rightIndicatorsHeading: 'You Leading indicators',
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
        "This tracks something different from the other two spectrums. Outside-In measures how your protectors see the world. Fragmented → Integrated measures how integrated your whole system is. This one measures something more specific: when a part activates, are you IT — or are you WITH it?",
      ],
    },
    {
      label: 'Toward the Blended side',
      paragraphs: [
        "When a part is loud, it takes you over. There's no space between you and it; for as long as it's running, it feels like you. This isn't a failure. It's how a system runs before anyone has looked at it.",
      ],
    },
    {
      label: 'Toward the You Leading side',
      paragraphs: [
        "When a part is loud, there's a you that can notice it and stay. You can say \"a part of me is feeling this\" rather than \"I am this.\" Not distance; closer to company. The part is still there, at full strength. You're just not lost in it, and you choose where you stand.",
      ],
    },
    {
      label: 'Three levels of unblending',
      paragraphs: [
        "Unblending isn't one thing. It happens on three levels, and they don't always arrive together.",
        "Thought — you can name the part. \"A part of me is anxious.\" The words are right, the framework applies. This is real but it's the most surface layer.",
        "Feeling — you sense yourself with the part rather than in it. There's a felt difference. You can stay with what's there without being taken over by it.",
        "Sensation — your body reflects the shift. Chest softens. Breath deepens. The grip lets go. The part itself feels less heavy, less urgent. Something has actually moved.",
        "All three are real. They don't arrive together, and nobody has to reach all three for this to count. Don't try to make it happen; chasing it becomes another performance. It arrives when a part has been received.",
      ],
    },
  ],
  howItMoves:
    "This moves through repeated experience, usually with smaller parts before bigger ones. Reading about it helps a little; living it is the teacher. It isn't measured by how fluently you talk about parts, but by whether you can stand somewhere while one is loud.",
};

const FRAGMENTED: SpectrumCopy = {
  title: 'Fragmented → Integrated',
  leftLabel: 'Fragmented',
  rightLabel: 'Integrated',
  leftKeysField: 'fragmentedKeywords',
  rightKeysField: 'flowingKeywords',
  leftIndicatorsHeading: 'Fragmented indicators',
  rightIndicatorsHeading: 'Integrated indicators',
  // Founder's copy v2 (2026-11-09). The third was "little getting through
  // from Self" (2026-09-06), and before that "no Self access detected", which
  // was wrong on the framework: Self is always there.
  leftPlaceholders: [
    "a part running the whole conversation",
    "parts in conflict",
    "nothing from you between them",
  ],
  rightPlaceholders: [
    "both sides named in one breath",
    "curiosity without an agenda",
    "I can stay with this",
    "you speaking while a part is loud",
  ],
  sections: [
    {
      label: 'What this tracks',
      paragraphs: [
        // POSITIONING PASS 2026-09-06. Was "your actual system health" and
        // "whether genuine healing movement is happening" — a clinical status
        // readout and a healing-outcome claim, about a person this app cannot
        // assess. Describes what shows up in the conversations instead, which
        // is the only thing the score is actually derived from.
        "This tracks what shows up across your conversations: how your parts relate to each other, whether both sides can be in the room at once, and how much of you is leading rather than brokering.",
        "It doesn't shift through understanding alone. It shifts with what actually shows up as you talk: parts being heard, both sides held at once, you standing somewhere while they're loud.",
        "Toward fragmented doesn't mean you're doing something wrong. It means the sides are still taking turns, each looking out for itself. That's where most people are when they begin.",
      ],
    },
  ],
  howItMoves:
    "This moves slowly and can't be manufactured. What moves it: staying with difficult feelings rather than managing them, parts being received, and you standing between the sides rather than inside one of them. Integrated isn't quieter; it's both sides at full strength, with you leading.",
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
    position: 'absolute', left: 0, right: 0, top: 1,
    textAlign: 'center',
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
