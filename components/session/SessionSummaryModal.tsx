// End-of-session summary screen.
//
// Slides up after the user confirms End Session, replacing the prior
// "Your map has been updated." overlay. Shows the summary fetched from
// /api/session-summary while a breathing-triangle loader fills in the wait:
// since 2026-11-09 the idle summary v2 — what we talked about, what landed,
// what went on the map, their own words — and for an older summary its
// first two sections. No "something to try" in either (utils/
// sessionSummary.ts says what shows, in what order, under which heading).
// Only one button: "Begin New Session" — tapping it fires the parent's
// onContinue which performs the actual reset.
//
// If the fetch returns null OR a soft fallback (empty fields), we show
// a single warm fallback line and still let the user continue. The
// modal NEVER blocks the user from moving on.

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import {
  useSharedValue, withRepeat, withTiming, Easing, useDerivedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { buildSessionExport, shareSessionText, confirmSessionShare, ExportMessage } from '../../utils/sessionExport';
import { summarySections, quotePhrase, type SessionSummaryShape, type SummarySection } from '../../utils/sessionSummary';

// The line shown when the summary could not be made: the fetch failed, or it
// came back empty — which includes a session that ended in a crisis hold.
// M2 (ruling 2026-11-05, "invented memory"): the second sentence claims a map
// write on every fallback, whether or not anything was written — and under M2
// nothing is written unless the person tapped a card. The audit's fix
// (other-surfaces-audit.md, SessionSummaryModal.tsx:203-204): keep the first
// sentence, drop the map claim.
const FALLBACK = 'This session has been saved to your journal.';

/** Whatever /api/session-summary returned (utils/sessionSummary.ts). */
export type SessionSummary = SessionSummaryShape;

// One part that gained facets this session (consent-gated enrichment). Fed from
// GET /api/sessions/:id/enrichment-summary.
export type DeepenedPart = {
  category: string;
  name: string;
  facets: Array<{ field: string; value: string }>;
};

type Props = {
  visible: boolean;
  /** null while loading, or after fetch completes. The parent passes the
   *  fetched summary in once /api/session-summary resolves. */
  summary: SessionSummary | null;
  /** Set true if the fetch failed entirely (transport / 500). The screen
   *  shows a warm fallback line in place of the three sections. */
  failed?: boolean;
  /** Marker-stripped transcript for the share-export action. Optional —
   *  if absent the share button still works but only includes the summary. */
  messages?: ExportMessage[];
  /** Parts that gained new facets this session (consent-gated enrichment).
   *  Rendered as a single quiet "what deepened" recap — NOT the inbox. */
  deepened?: DeepenedPart[];
  /** Fires when the user taps "Begin New Session". */
  onContinue: () => void;
};

export function SessionSummaryModal({ visible, summary, failed, messages, deepened, onContinue }: Props) {
  const insets = useSafeAreaInsets();
  // Soft success haptic the moment the modal becomes visible — this is
  // the "the session landed" felt-sense the spec calls for. Fires once
  // per visible→true transition.
  useEffect(() => {
    if (!visible) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [visible]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Word-by-word reveal, same cadence as the chat tab (PER_WORD_MS = 45).
  // The summary endpoint returns JSON in one shot, but the modal animates the
  // text in, paragraph after paragraph in the order the sections show them,
  // so the person sees the reflection 'land' rather than appearing all at
  // once. Triangles + 'reflecting…' indicator stay visible until the FIRST
  // word is revealed. Only non-empty paragraphs are in the list, so the
  // reveal never waits on an empty one.
  const PER_WORD_MS = 45;
  const sections: SummarySection[] = summarySections(summary);
  const pieces: string[] = sections.flatMap((s) => s.paragraphs);
  const [revealed, setRevealed] = useState<string[]>([]);
  useEffect(() => {
    if (!summary) {
      setRevealed([]);
      return;
    }
    const targets = summarySections(summary).flatMap((s) => s.paragraphs);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pieceIdx = 0;
    let charIdx = 0;
    const next: string[] = targets.map(() => '');
    function step() {
      if (cancelled) return;
      if (pieceIdx >= targets.length) {
        setRevealed([...next]);
        return;
      }
      const target = targets[pieceIdx];
      // Advance one word: skip whitespace, run to next whitespace.
      let i = charIdx;
      while (i < target.length && /\s/.test(target[i])) i++;
      while (i < target.length && !/\s/.test(target[i])) i++;
      charIdx = i;
      next[pieceIdx] = target.slice(0, charIdx);
      setRevealed([...next]);
      if (charIdx >= target.length) { pieceIdx++; charIdx = 0; }
      timer = setTimeout(step, PER_WORD_MS);
    }
    timer = setTimeout(step, PER_WORD_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  const hasContent = pieces.length > 0;
  // Show the breathing-triangle "reflecting…" loader UNTIL either:
  //   - the network call failed (failed prop), OR
  //   - the first word of the first non-empty section has been revealed.
  // This matches the spec's "modal opens immediately → triangle while
  // waiting → words begin appearing one by one".
  const firstWordRevealed = revealed.some((r) => r.length > 0);
  const isLoading = !failed && !firstWordRevealed;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={() => { /* no-op — user must tap continue */ }}
      statusBarTranslucent
    >
      <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {/* Share button — top right of the modal. Tapping opens the OS
            share sheet with a plain-text export of the session. */}
        <Pressable
          onPress={async () => {
            Haptics.selectionAsync().catch(() => {});
            // The confirm names what is included before anything leaves the
            // device (founder ruling 2026-08-21k). 'Just the reflection' is a
            // real option, not a softener.
            const choice = await confirmSessionShare((messages || []).length > 0);
            if (choice === 'cancel') return;
            const text = buildSessionExport({
              summary,
              messages: messages || [],
              includeTranscript: choice === 'everything',
            });
            shareSessionText(text);
          }}
          hitSlop={12}
          style={[styles.shareBtn, { top: insets.top + 16 }]}
          accessibilityLabel="Share this session"
        >
          <Ionicons name="share-outline" size={20} color="rgba(230,180,122,0.6)" />
        </Pressable>
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Session reflection</Text>
          <Text style={styles.dateText}>{today}</Text>

          {isLoading ? (
            <View style={styles.loaderWrap}>
              <BreathingTriangle />
              <Text style={styles.loaderText}>reflecting on what came up…</Text>
            </View>
          ) : null}

          {summary && hasContent ? (
            <>
              {(() => {
                // Each section takes its paragraphs' revealed text, in order.
                let at = 0;
                return sections.map((s) => {
                  const shown = s.paragraphs.map(() => revealed[at++] || '');
                  return <Section key={s.key} label={s.label} paragraphs={shown} quoted={s.quoted} />;
                });
              })()}
            </>
          ) : null}

          {deepened && deepened.length > 0 ? (
            <DeepenedBlock deepened={deepened} />
          ) : null}

          {(failed || (summary && !hasContent)) ? (
            <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.md }}>
              <Text style={styles.fallbackText}>
                {FALLBACK}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={onContinue}
            style={styles.continueBtn}
            accessibilityLabel="Begin a new session"
            hitSlop={10}
          >
            <Text style={styles.continueText}>BEGIN NEW SESSION</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// One labeled summary section — amber uppercase label + cream body text +
// hairline divider underneath. Matches the existing Journey/Folder section
// grammar so the screen feels native to the app, not bolted-on.
// ============================================================================
function Section({ label, paragraphs, quoted }: { label: string | null; paragraphs: string[]; quoted?: boolean }) {
  // Nothing revealed yet in this section: nothing at all, not even its heading.
  const shown = paragraphs.map((p) => p.trim()).filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <View style={styles.section}>
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
      {shown.map((p, i) => (
        <Text key={i} style={[quoted ? styles.sectionQuote : styles.sectionText, i > 0 && styles.sectionNext]}>
          {quoted ? quotePhrase(p) : p}
        </Text>
      ))}
      <View style={styles.divider} />
    </View>
  );
}

// ============================================================================
// "What deepened this session" — the parts that gained new facets while the
// user was present with them (consent-gated enrichment). One quiet recap; the
// map's "new since last visit" markers are the passive channel, this the active
// one. No action needed — consent was given at the in-session handshake.
// ============================================================================
const FACET_LABEL: Record<string, string> = {
  trigger: 'trigger', body: 'body', situation: 'situation', example: 'example', voice: 'phrase',
  manner: 'way of speaking', worldview: 'worldview', story: 'story', memory: 'memory',
};
function DeepenedBlock({ deepened }: { deepened: DeepenedPart[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>WHAT WAS ADDED</Text>
      <Text style={styles.deepenedIntro}>
        Parts you were present with have something new written down. Open
        your map to see — or prune — what was added.
      </Text>
      {deepened.map((p) => (
        <View key={p.category + p.name} style={styles.deepenedPart}>
          <Text style={styles.deepenedPartName}>{p.name}</Text>
          {p.facets.map((f, i) => (
            <Text key={i} style={styles.deepenedFacet}>
              <Text style={styles.deepenedFacetKind}>new {FACET_LABEL[f.field] || f.field}</Text>
              {`  ·  ${f.value}`}
            </Text>
          ))}
        </View>
      ))}
      <View style={styles.divider} />
    </View>
  );
}

// ============================================================================
// Breathing-triangle loader. Same equilateral path the typing indicator and
// AttentionIndicator use; opacity oscillates to read as a quiet inhale/exhale.
// ============================================================================
const TRI_SIZE = 32;
function BreathingTriangle() {
  const breath = useSharedValue(0.4);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.95, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, [breath]);
  const op = useDerivedValue(() => breath.value, [breath]);

  const triPath = (() => {
    const p = Skia.Path.Make();
    const pad = 4;
    p.moveTo(TRI_SIZE / 2, pad);
    p.lineTo(TRI_SIZE - pad, TRI_SIZE - pad);
    p.lineTo(pad, TRI_SIZE - pad);
    p.close();
    return p;
  })();

  return (
    <Canvas style={{ width: TRI_SIZE, height: TRI_SIZE }}>
      <Group opacity={op}>
        <Path path={triPath} color="#E6B47A" style="stroke" strokeWidth={1.8} />
        <Path path={triPath} color="#E6B47A33" style="fill" />
      </Group>
    </Canvas>
  );
}

// ============================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  shareBtn: {
    position: 'absolute',
    right: 18,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },

  body: { padding: spacing.lg, paddingBottom: spacing.xxl },

  title: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  dateText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: spacing.xl,
    letterSpacing: 0.3,
  },

  loaderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  loaderText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    marginTop: 12,
    letterSpacing: 0.3,
  },

  section: { marginTop: spacing.lg },
  sectionLabel: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
  },
  sectionText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
  // A second paragraph in one section (whatLanded under whatWeTalkedAbout),
  // and each of their phrases after the first.
  sectionNext: { marginTop: 10 },
  // Their own words: italic, in quotation marks.
  sectionQuote: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    lineHeight: 23,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
  },

  deepenedIntro: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  deepenedPart: { marginTop: spacing.sm },
  deepenedPartName: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  deepenedFacet: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  deepenedFacetKind: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.5,
  },

  fallbackText: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
  },

  footer: {
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  continueBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  continueText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 2,
  },
});
