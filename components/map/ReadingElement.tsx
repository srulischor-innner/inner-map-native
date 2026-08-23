// ============================================================================
// THE READING ELEMENT — Map tab (cycle 3, founder ruling 2026-08-21k).
//
// REUSES THE SELF-LIKE PATTERN, deliberately. This is not a card, not an inbox
// item, not a banner. It is an element that sits on the map and does not click
// — stating plainly what unlocks it — until the map qualifies, at which point
// it becomes clickable. Becoming clickable is most of the message.
//
// No counters. No percentages. No progress bar. No "3 of 5". The person is
// never shown a distance to travel.
//
// THREE THINGS GATE IT, and the device decides none of them:
//   1. eligibility  — wound belief + both poles + 3 filled protectors, computed
//                     server-side (GET /api/reading returns it).
//   2. deliveryGate — the product-level hold: no reading reaches ANY user until
//                     one real PART_NAMED capture has fired somewhere. Until
//                     then this element renders locked even for a qualifying
//                     map, because the whole THEIR-NAMES chain has only ever
//                     run on a backfilled row.
//   3. the server   — an old server (no /api/reading) returns null and the
//                     element renders NOTHING at all, so a client that ships
//                     ahead of its server is silent rather than broken.
//
// GENERATION takes 50–60 seconds. The waiting state is the element itself:
// it breathes, and a single line advances on its own timing — never looping,
// holding on the last line so a slow generation never reads as a stuck timer.
// Leaving the screen is safe: the row is already 'generating' server-side and
// the reading finishes whether or not anyone watches.
// ============================================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';
import { api } from '../../services/api';
import {
  READING_LOCKED_TITLE, READING_LOCKED_BODY,
  READING_UNLOCKED_TITLE, READING_UNLOCKED_BODY,
  READING_WAITING_LINES,
} from '../../utils/readingCopy';

type Phase = 'hidden' | 'locked' | 'ready' | 'generating' | 'has-reading';

export function ReadingElement({ onOpen }: { onOpen: (body: string, createdAt?: string) => void }) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [body, setBody] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined);
  const [lineIdx, setLineIdx] = useState(0);
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
    if (r.exists && r.status === 'ready' && r.body) {
      setBody(r.body);
      setCreatedAt(r.createdAt);
      setPhase('has-reading');
      return;
    }
    if (r.exists && r.status === 'generating') { setPhase('generating'); return; }
    // The delivery gate outranks eligibility: a qualifying map still reads
    // locked until one live capture has happened somewhere.
    const gateReady = r.deliveryGate ? r.deliveryGate.ready : false;
    const eligible = r.eligibility ? r.eligibility.eligible : false;
    setPhase(eligible && gateReady ? 'ready' : 'locked');
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
  }, [refresh, breath]);

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
    if (phase === 'has-reading' && body) {
      Haptics.selectionAsync().catch(() => {});
      onOpen(body, createdAt);
      return;
    }
    if (phase !== 'ready') return;   // locked taps do nothing but explain
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPhase('generating');
    const r = await api.generateReading();
    if (!alive.current) return;
    if (!r || r.eligible === false) { await refresh(); return; }
  }, [phase, body, createdAt, onOpen, refresh]);

  if (phase === 'hidden') return null;

  const locked = phase === 'locked';
  const generating = phase === 'generating';
  const title = locked ? READING_LOCKED_TITLE
    : generating ? READING_WAITING_LINES[lineIdx]?.text ?? READING_WAITING_LINES[0].text
    : READING_UNLOCKED_TITLE;
  const sub = locked ? READING_LOCKED_BODY : generating ? null : READING_UNLOCKED_BODY;

  const Inner = (
    <View style={[styles.card, locked && styles.cardLocked]}>
      <View style={styles.row}>
        <Text style={[styles.title, locked && styles.titleLocked]}>{title}</Text>
        {generating ? <ActivityIndicator size="small" color="rgba(230,180,122,0.5)" /> : null}
      </View>
      {sub ? <Text style={[styles.body, locked && styles.bodyLocked]}>{sub}</Text> : null}
    </View>
  );

  if (generating) {
    return <Animated.View style={breathStyle} accessibilityLabel="Writing your reading">{Inner}</Animated.View>;
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole={locked ? undefined : 'button'}
      accessibilityLabel={locked ? READING_LOCKED_TITLE : READING_UNLOCKED_TITLE}
      style={({ pressed }) => [pressed && !locked ? styles.pressed : null]}
    >
      {Inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(230,180,122,0.28)',
    backgroundColor: 'rgba(230,180,122,0.05)',
  },
  cardLocked: {
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: 'rgba(230,180,122,0.92)', fontSize: 15, letterSpacing: 0.2, flexShrink: 1 },
  titleLocked: { color: 'rgba(255,255,255,0.42)' },
  body: { color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 19, marginTop: 6 },
  bodyLocked: { color: 'rgba(255,255,255,0.34)' },
  pressed: { opacity: 0.7 },
});
