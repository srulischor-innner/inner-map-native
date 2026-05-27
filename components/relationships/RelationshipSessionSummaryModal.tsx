// End-of-session summary screen — partner-chat variant.
//
// Slides up after the user holds the "end session" pill in
// RelationshipChat. Mirrors the main-chat SessionSummaryModal's
// shape (header + reflection + practices) so the surface feels
// native to the app, but swaps in the relationship-specific
// content from the server's RELATIONSHIPS_SESSION_SUMMARY_PROMPT:
//   - One pattern-level "what came up" recap (instead of the 3-part
//     explored/showing/try grammar)
//   - 1-3 "practices for this week" cards
//   - Each practice card has [Send to {partnerName}] and [Forward]
//     buttons:
//        * Send to partner → reuses api.contributeToSharedSpace so the
//          practice text lands in the shared space as a partner
//          contribution.
//        * Forward → opens the OS share sheet via Share.share.
//
// If the fetch returns a soft fallback (empty fields), we still let
// the user continue. The modal never blocks them from moving on.
//
// Parent (RelationshipChat) owns the lifecycle: opens the modal in
// loading state, calls api.endRelationshipSession, then passes the
// resolved RelationshipSession in via the `session` prop. onContinue
// fires when the user taps "Begin New Session" — the parent uses it
// to start a fresh session via api.startRelationshipSession.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, Share, Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import {
  useSharedValue, withRepeat, withTiming, Easing, useDerivedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api, RelationshipSession } from '../../services/api';

type Props = {
  visible: boolean;
  /** null while loading, or after fetch completes. The parent passes
   *  the resolved RelationshipSession in once
   *  api.endRelationshipSession resolves. */
  session: RelationshipSession | null;
  /** Set true if the fetch failed entirely. Modal shows a warm
   *  fallback line in place of the recap + practices. */
  failed?: boolean;
  /** Relationship id — used when the user taps "Send to {partner}" on
   *  a practice card to insert it into the shared space. */
  relationshipId: string;
  /** Partner first name for button labels + copy. Falls back to
   *  "your partner". */
  partnerName: string | null;
  /** Fires when the user taps "Begin New Session". Parent uses it to
   *  reset chat state + start a fresh session. */
  onContinue: () => void;
};

export function RelationshipSessionSummaryModal({
  visible, session, failed, relationshipId, partnerName, onContinue,
}: Props) {
  const insets = useSafeAreaInsets();

  // Soft success haptic the moment the modal becomes visible. Once
  // per visible→true transition.
  useEffect(() => {
    if (!visible) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [visible]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Word-by-word reveal of the summary text — same cadence as the
  // main-chat SessionSummaryModal (PER_WORD_MS = 45). Practices
  // appear after the summary is fully revealed so the recap reads
  // first.
  const PER_WORD_MS = 45;
  const [revealedSummary, setRevealedSummary] = useState('');
  const [practicesVisible, setPracticesVisible] = useState(false);

  useEffect(() => {
    if (!session) {
      setRevealedSummary('');
      setPracticesVisible(false);
      return;
    }
    const target = (session.summary || '').trim();
    if (!target) {
      setRevealedSummary('');
      setPracticesVisible(true); // empty summary → still reveal practices
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let charIdx = 0;
    function step() {
      if (cancelled) return;
      let i = charIdx;
      while (i < target.length && /\s/.test(target[i])) i++;
      while (i < target.length && !/\s/.test(target[i])) i++;
      charIdx = i;
      setRevealedSummary(target.slice(0, charIdx));
      if (charIdx >= target.length) {
        // Reveal practices after a beat so the eye lands.
        timer = setTimeout(() => { if (!cancelled) setPracticesVisible(true); }, 400);
        return;
      }
      timer = setTimeout(step, PER_WORD_MS);
    }
    timer = setTimeout(step, PER_WORD_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [session]);

  const hasSummary = !!session && !!(session.summary || '').trim();
  const hasPractices = !!session && Array.isArray(session.practices) && session.practices.length > 0;
  const hasContent = hasSummary || hasPractices;
  const isLoading = !failed && !session;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={() => { /* no-op — user must tap continue */ }}
      statusBarTranslucent
    >
      <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Session Complete</Text>
          <Text style={styles.dateText}>{today}</Text>

          {isLoading ? (
            <View style={styles.loaderWrap}>
              <BreathingTriangle />
              <Text style={styles.loaderText}>reflecting on what came up…</Text>
            </View>
          ) : null}

          {hasSummary ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>WHAT CAME UP</Text>
              <Text style={styles.sectionText}>{revealedSummary.trim()}</Text>
              <View style={styles.divider} />
            </View>
          ) : null}

          {hasPractices && practicesVisible ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>PRACTICES FOR THIS WEEK</Text>
              {session!.practices.map((p, idx) => (
                <PracticeCard
                  key={idx}
                  text={p}
                  partnerName={partnerName}
                  relationshipId={relationshipId}
                />
              ))}
            </View>
          ) : null}

          {(failed || (session && !hasContent)) ? (
            <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.md }}>
              <Text style={styles.fallbackText}>
                This session has been saved. Your map has been updated.
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
// One practice card — body text + two action buttons.
//
// [Send to {partner}] — inserts the practice text into the shared
// space via api.contributeToSharedSpace. Same path SharePromptCard
// uses, so the partner sees it in the shared-space thread.
//
// [Forward] — opens the OS share sheet via Share.share. Lets the
// user move the practice into iMessage, Notes, etc. — useful when
// the practice is something they want to revisit on their own.
// ============================================================================
function PracticeCard({
  text,
  partnerName,
  relationshipId,
}: {
  text: string;
  partnerName: string | null;
  relationshipId: string;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const sendToPartner = useCallback(async () => {
    if (sending || sent) return;
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const result = await api.contributeToSharedSpace(relationshipId, text);
    setSending(false);
    if ('error' in result) {
      Alert.alert(
        "Couldn't share",
        result.message || result.error || 'Try again in a moment.',
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSent(true);
  }, [relationshipId, text, sending, sent]);

  const forward = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    try {
      await Share.share({ message: text, title: 'Inner Map — Practice' });
    } catch (e) {
      console.warn('[practice-card] share threw:', (e as Error)?.message);
    }
  }, [text]);

  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.body}>{text}</Text>
      <View style={cardStyles.actions}>
        {sent ? (
          <View style={cardStyles.sentPill}>
            <Ionicons name="checkmark-circle" size={14} color={colors.amber} style={{ marginRight: 6 }} />
            <Text style={cardStyles.sentText}>
              Sent to {partnerName || 'your partner'}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={sendToPartner}
            disabled={sending}
            style={[cardStyles.btn, cardStyles.btnPrimary, sending && cardStyles.btnDim]}
            accessibilityLabel={`Send this practice to ${partnerName || 'your partner'}`}
            hitSlop={8}
          >
            {sending ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={cardStyles.btnPrimaryText}>
                SEND TO {(partnerName || 'PARTNER').toUpperCase()}
              </Text>
            )}
          </Pressable>
        )}
        <Pressable
          onPress={forward}
          style={[cardStyles.btn, cardStyles.btnGhost]}
          accessibilityLabel="Forward this practice via the share sheet"
          hitSlop={8}
        >
          <Ionicons name="share-outline" size={14} color={colors.amber} style={{ marginRight: 6 }} />
          <Text style={cardStyles.btnGhostText}>FORWARD</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ============================================================================
// Breathing-triangle loader — identical to the main-chat
// SessionSummaryModal. Kept inline (not pulled into a shared
// component) so future tweaks to this surface don't ripple to the
// main-chat surface.
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
  divider: {
    height: 0.5,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
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

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(230, 180, 122, 0.05)',
    borderColor: 'rgba(230, 180, 122, 0.25)',
    borderWidth: 0.5,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  body: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnPrimary: {
    backgroundColor: colors.amber,
  },
  btnPrimaryText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.4)',
  },
  btnGhostText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  btnDim: { opacity: 0.5 },

  sentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(230, 180, 122, 0.06)',
    borderColor: 'rgba(230, 180, 122, 0.35)',
    borderWidth: 0.5,
    borderRadius: 999,
  },
  sentText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
