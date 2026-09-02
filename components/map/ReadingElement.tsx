// ============================================================================
// THE READING ELEMENT — Map tab.
//
// FOLLOWS THE SELF-LIKE MIC PATTERN EXACTLY (founder ruling 2026-08-27). Not a
// card, not a banner. A glyph with a label under it, sitting on the map: dim
// and cream when locked, amber and lit when open — the same grammar as the
// mic row a thumb's width below it, so people learn ONE pattern rather than
// two. Becoming lit is most of the message.
//
// It replaced a bordered, tinted card that was three faults at once: oversized,
// sitting over the wound (the most loaded thing on the map), and never naming
// itself — its title stated an unlock condition, so a person could look at it
// and still not know a reading existed.
//
// TAPPABLE WHILE LOCKED. Exactly like the Self-like mic: the lock is a
// DESIGNED state, not unbuilt software, and it explains itself when touched.
// Inert means it does not produce a reading — never that it ignores you. (An
// element that visibly does nothing when tapped also reads as broken UI under
// App Store Guideline 2.1, the same reasoning that rewrote the mic's copy.)
//
// TWO THINGS GATE IT, and the device decides neither:
//   1. eligibility  — wound belief + both poles + 3 filled protectors, computed
//                     server-side (GET /api/reading returns it, in full).
//   2. the server   — an old server (no /api/reading) returns null and the
//                     element renders NOTHING at all, so a client that ships
//                     ahead of its server is silent rather than broken.
//
// A third gate used to sit above both: a product-level hold that kept the
// reading shut for EVERY user until one real PART_NAMED capture had fired
// somewhere. It was removed on 2026-08-27 — it had never once opened, so it
// could not tell an untested capture path from a broken one while holding a
// finished feature shut. Delivery rests on eligibility alone now.
//
// THE LOCKED CARD SPEAKS FROM THIS MAP, not from the rulebook. It leads with
// what a reading is (the person has never seen one) and then names which
// pieces are on their map and which are not — see utils/readingCopy.ts.
//
// GENERATION takes 50–60 seconds. The waiting state is the element itself: it
// breathes, and a single line advances on its own timing — never looping,
// holding on the last line so a slow generation never reads as a stuck timer.
// Leaving the screen is safe: the row is already 'generating' server-side and
// the reading finishes whether or not anyone watches.
//
// WHEN IT FAILS (founder ruling 2026-08-23) the element SAYS so and offers a
// retry. It used to do neither: an errored row fell past both status checks
// below and re-rendered as 'ready', so the same tap started the same failing
// generation with nothing ever named. Two failures reach this state — a
// generation that threw (status 'error'), and one nothing will ever finish
// because the worker died with the process (`stale`, which the SERVER judges;
// a device with a wrong clock must not get a vote on it).
// ============================================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { api } from '../../services/api';
import { colors, fonts, spacing } from '../../constants/theme';
import {
  READING_LABEL, READING_LEAD, readingWaitingLine, type ReadingEligibility,
  READING_LOCKED_TITLE,
  READING_UNLOCKED_TITLE, READING_UNLOCKED_SUB,
  READING_UPDATE_AVAILABLE_SUB,
  READING_WAITING_LINES, READING_GOT_IT,
  READING_ERROR_TITLE, READING_ERROR_BODY, READING_ERROR_ACTION,
} from '../../utils/readingCopy';

type Phase = 'hidden' | 'locked' | 'ready' | 'generating' | 'has-reading' | 'error';

export function ReadingElement(
  { onOpen, refreshKey = 0 }:
  {
    onOpen: (body: string, createdAt: string | undefined, newMaterialSince: number) => void;
    /** Bumped by the screen after a regeneration is requested, so the element
     *  re-reads its own state instead of waiting for the next focus. */
    refreshKey?: number;
  },
) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [newMaterial, setNewMaterial] = useState(0);
  const [body, setBody] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined);
  const [lineIdx, setLineIdx] = useState(0);
  // The gate as the SERVER described it, kept so the locked card can speak
  // about this map rather than about the rule. Never recomputed on device.
  const [eligibility, setEligibility] = useState<ReadingEligibility | null>(null);
  const [explaining, setExplaining] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const breath = useSharedValue(0.55);
  const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  const refresh = useCallback(async () => {
    const r = await api.getReading();
    if (!alive.current) return;
    // An old server, or any failure: render nothing rather than guess.
    if (!r) { setPhase('hidden'); return; }
    if (r.eligibility) setEligibility(r.eligibility);
    if (r.exists && r.status === 'ready' && r.body) {
      setBody(r.body);
      setCreatedAt(r.createdAt);
      // >0 means the map has gained something since this reading was written.
      // An older server that does not send the field reads as 0 — no offer,
      // never a guess.
      setNewMaterial(typeof r.newMaterialSince === 'number' ? r.newMaterialSince : 0);
      setPhase('has-reading');
      return;
    }
    // Both failure shapes, read from the server's own verdict.
    if (r.exists && (r.status === 'error' || (r.status === 'generating' && r.stale))) {
      setPhase('error');
      return;
    }
    if (r.exists && r.status === 'generating') { setPhase('generating'); return; }
    // Eligibility alone decides now. The product-level live-capture gate that
    // used to outrank it was removed server-side (2026-08-27); an older server
    // that still sends deliveryGate is simply ignored, never re-honoured.
    const eligible = r.eligibility ? r.eligibility.eligible : false;
    setPhase(eligible ? 'ready' : 'locked');
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
      if (lineRef.current) clearTimeout(lineRef.current);
      cancelAnimation(breath);
    };
  }, [refresh, breath, refreshKey]);

  // Breathing + the self-advancing line, both only while generating.
  useEffect(() => {
    if (phase !== 'generating') return;
    breath.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true);
    const advance = (i: number) => {
      if (!alive.current) return;
      setLineIdx(i);
      const hold = READING_WAITING_LINES[i]?.holdMs ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(hold) || i >= READING_WAITING_LINES.length - 1) return;  // hold, never loop
      lineRef.current = setTimeout(() => advance(i + 1), hold);
    };
    advance(0);
    const poll = () => {
      pollRef.current = setTimeout(async () => {
        if (!alive.current) return;
        await refresh();
        if (alive.current) poll();
      }, 5000);
    };
    poll();
    return () => {
      if (lineRef.current) clearTimeout(lineRef.current);
      if (pollRef.current) clearTimeout(pollRef.current);
      cancelAnimation(breath);
      breath.value = 0.55;
    };
  }, [phase, refresh, breath]);

  const onPress = useCallback(async () => {
    // Locked: explain. This is the Self-like mic's behaviour exactly — the
    // tap is answered, it just does not produce a reading.
    if (phase === 'locked') {
      Haptics.selectionAsync().catch(() => {});
      setExplaining(true);
      return;
    }
    if (phase === 'has-reading' && body) {
      Haptics.selectionAsync().catch(() => {});
      onOpen(body, createdAt, newMaterial);
      return;
    }
    if (phase !== 'ready' && phase !== 'error') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setLineIdx(0);
    setPhase('generating');
    const r = await api.generateReading();
    if (!alive.current) return;
    // A null answer is the request itself failing (offline, timeout, 500).
    // Saying so is the whole point of this state — dropping back to the
    // offer would be the silent re-offer we just removed.
    if (!r) { setPhase('error'); return; }
    if (r.eligible === false) { await refresh(); return; }
  }, [phase, body, createdAt, onOpen, refresh]);

  if (phase === 'hidden') return null;

  const locked = phase === 'locked';
  const generating = phase === 'generating';
  const failed = phase === 'error';

  // The line under the label. Locked says nothing here — the whole point of
  // the small element is that it does not explain itself in place; it names
  // itself and holds the explanation behind a tap.
  const sub = generating
    ? READING_WAITING_LINES[lineIdx]?.text ?? READING_WAITING_LINES[0].text
    : failed ? READING_ERROR_TITLE
    : locked ? null
    // PLACEMENT A: the element ANNOUNCES that the map has moved. The action
    // lives in the sheet (see ReadingModal), so the strip keeps one tap target
    // and the offer lands after you have read what you already have.
    : (phase === 'has-reading' && newMaterial > 0) ? READING_UPDATE_AVAILABLE_SUB
    : phase === 'has-reading' ? null
    : READING_UNLOCKED_SUB;

  const a11y = locked
    ? `${READING_LOCKED_TITLE} — locked. Tap to hear what it needs.`
    : failed ? `${READING_ERROR_TITLE}. ${READING_ERROR_ACTION}`
    : generating ? 'Writing your reading'
    : READING_UNLOCKED_TITLE;

  const Inner = (
    <View style={styles.wrap}>
      <Text style={[styles.glyph, locked && styles.glyphLocked, failed && styles.glyphFailed]}>◎</Text>
      <View style={styles.labelRow}>
        <Text style={[styles.label, locked && styles.labelLocked, failed && styles.labelFailed]}>
          {READING_LABEL}
        </Text>
        {generating ? <ActivityIndicator size="small" color={colors.amber} /> : null}
      </View>
      {sub ? (
        <Text style={[styles.sub, failed && styles.subFailed]} numberOfLines={2}>{sub}</Text>
      ) : null}
      {failed ? <Text style={styles.retry}>{READING_ERROR_ACTION}</Text> : null}
    </View>
  );

  return (
    <>
      {generating ? (
        <Animated.View style={[styles.col, breathStyle]} accessibilityLabel={a11y}>{Inner}</Animated.View>
      ) : (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={a11y}
          style={({ pressed }) => [styles.col, locked && styles.colLocked, pressed && styles.pressed]}
        >
          {Inner}
        </Pressable>
      )}

      {/* The locked explanation. Same card the Self-like mic lock uses —
          centred, serif, one GOT IT — because it is the same kind of moment
          and should not feel like a different app. Copy leads with what a
          reading IS and then names what THIS map is missing. */}
      <Modal
        visible={explaining}
        transparent
        animationType="fade"
        onRequestClose={() => setExplaining(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setExplaining(false)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>{READING_LOCKED_TITLE}</Text>
            <Text style={styles.cardBody}>{READING_LEAD}</Text>
            <Text style={[styles.cardBody, styles.cardBodyLast]}>{readingWaitingLine(eligibility)}</Text>
            <Pressable onPress={() => setExplaining(false)} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>{READING_GOT_IT}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Visual grammar borrowed wholesale from MapVoiceBar's mic column: glyph over
// an uppercase tracked label, amber when live, creamFaint at 0.4 opacity when
// locked. It takes the mic's LABEL treatment rather than its 60px circle — a
// mic-sized button here would repeat the size problem this element was
// rebuilt to fix.
const styles = StyleSheet.create({
  col: { alignItems: 'center', paddingVertical: 6 },
  colLocked: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  wrap: { alignItems: 'center' },
  glyph: {
    color: colors.amber,
    fontSize: 13,
    marginBottom: 4,
    letterSpacing: 0.5,
    textShadowColor: colors.amber,
    textShadowRadius: 10,
  },
  glyphLocked: { color: colors.creamFaint, textShadowRadius: 0 },
  glyphFailed: { color: colors.cream, textShadowRadius: 0 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  labelLocked: { color: colors.creamFaint },
  labelFailed: { color: colors.cream },
  sub: {
    color: 'rgba(240,237,232,0.55)',
    fontFamily: fonts.serif,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  subFailed: { color: 'rgba(240,237,232,0.7)' },
  retry: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginTop: 6,
  },

  // ---- the explanation card (mirrors MapVoiceBar's lock card) ----
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#0e0e1a',
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.25)',
  },
  cardTitle: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    lineHeight: 28,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  cardBody: {
    color: colors.cream,
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  cardBodyLast: { marginBottom: spacing.sm },
  gotItBtn: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  gotItText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.6,
  },
});
