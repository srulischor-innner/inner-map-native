// Six-slide cinematic intro carousel — used in two places in the
// app, each with its own button copy:
//
//   mode='informational'
//     Played the very first time the user taps the Partner tab,
//     before they've created or accepted any invite. Last slide
//     button reads "GET STARTED" — no API call, just calls
//     onComplete() so the parent can flip its AsyncStorage flag
//     and fall through to the connect screen.
//
//   mode='commitment'
//     Played AFTER both partners have accepted an invite — the
//     "ready to begin?" moment that gates the active relationship.
//     Last slide button reads "I UNDERSTAND AND ACCEPT" and
//     onComplete() fires api.acceptRelationshipIntro to flip the
//     server-side intro flag.
//
// Both modes share the exact same six slides + visuals + cinematic
// typography. Body text renders instantly on every slide — the
// previous typewriter animation was removed so the cinematic
// reading experience matches a printed page rather than a
// teleprompter.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet,
  useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';
import { GuideDots } from '../guide/GuideDots';
import { RelationshipIntroVisual } from './RelationshipIntroVisual';

// Slide content — single source of truth. Visuals live in
// RelationshipIntroVisual and are indexed by 1-based slide number.
const SLIDES: { title: string; body: string }[] = [
  {
    title: 'Welcome to your relationship space',
    body:
      "A place to explore what's happening between you — gently, honestly, with AI guidance. " +
      "You and your partner will each have a private chat. What you discover together appears " +
      "in a shared space, only when you both choose to share it.",
  },
  {
    title: 'Two spaces, one relationship',
    body:
      "Your private chat is yours alone. Your partner never sees what you write here. " +
      "The shared space is where insights you both approve become visible to both of you. " +
      "Nothing crosses from private to shared without your permission.",
  },
  {
    title: 'What the AI sees',
    body:
      "To help you both, the AI sees both of your private conversations and your individual maps. " +
      "But it never tells either of you what the other has shared. It uses everything it sees to " +
      "surface insights about the relationship — but only with your consent does anything become " +
      "visible to your partner.",
  },
  {
    title: 'Nothing without your permission',
    body:
      "When the AI has an insight that involves you, it shows it to you first. You decide whether " +
      "your partner sees it. For insights about both of you, you both have to confirm before they " +
      "appear in the shared space. This is your relationship — you control what gets explored " +
      "together.",
  },
  {
    // Safety slide — phone numbers + tappable tel/sms links removed
    // intentionally. The intent is to point users at professional
    // support without prescribing a specific hotline; mobile OSes
    // already make "domestic violence hotline" a one-tap web search,
    // and editorializing on a single number risks pointing the user
    // at a service that isn't appropriate for their region or
    // situation.
    title: "If something doesn't feel safe",
    body:
      "This space is for couples doing mutual healing work. If you're experiencing physical " +
      "violence, threats, coercion, or fear in your relationship, please reach out to " +
      "professional support. You're not alone.",
  },
  {
    title: 'Ready to begin?',
    body:
      "By tapping below you're confirming you understand how this space works and you're entering " +
      "with your partner in good faith.",
  },
];

type Mode = 'informational' | 'commitment';

export function RelationshipIntroCarousel({
  mode,
  onComplete,
  accepting = false,
  showBackButton = false,
  onBack,
}: {
  mode: Mode;
  /** Fires on last-slide button tap. In commitment mode the parent
   *  awaits this (and surfaces the spinner via `accepting`). In
   *  informational mode it's synchronous and the parent just flips
   *  a flag + advances. */
  onComplete: () => void | Promise<void>;
  /** Spinner state for the last-slide button. Driven by the parent
   *  while it's awaiting an API call (commitment mode only).  */
  accepting?: boolean;
  /** When true, render a back chevron in the header. The route-
   *  based commitment screen uses this; the in-tab informational
   *  embed doesn't (the user can't go anywhere meaningful — the
   *  tab itself IS the back). */
  showBackButton?: boolean;
  onBack?: () => void;
}) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const onScroll = useCallback(
    (e: any) => {
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / width);
      if (i !== index) setIndex(i);
    },
    [index, width],
  );

  const goToSlide = useCallback((i: number) => {
    Haptics.selectionAsync().catch(() => {});
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  }, []);

  const handleComplete = useCallback(async () => {
    if (accepting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await onComplete();
  }, [accepting, onComplete]);

  return (
    <View style={styles.root}>
      {showBackButton ? (
        <View style={styles.header}>
          <Pressable
            onPress={() => onBack?.()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.creamDim} />
          </Pressable>
          <View style={styles.backBtn} />
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index: i }) => (
          <IntroSlide
            data={item}
            slideNumber={i + 1}
            width={width}
            isLast={i === SLIDES.length - 1}
            mode={mode}
            accepting={accepting}
            onComplete={handleComplete}
          />
        )}
      />

      <View style={styles.foot}>
        <GuideDots count={SLIDES.length} active={index} onTap={goToSlide} />
      </View>
    </View>
  );
}

// =============================================================================
// One slide. Visual on top, cinematic title, body rendered as plain
// static Text. Last slide includes the completion button — copy
// depends on mode.
// =============================================================================
function IntroSlide({
  data, slideNumber, width, isLast, mode, accepting, onComplete,
}: {
  data: { title: string; body: string };
  slideNumber: number;
  width: number;
  isLast: boolean;
  mode: Mode;
  accepting: boolean;
  onComplete: () => void;
}) {
  const visualSize = useMemo(() => Math.min(width * 0.6, 280), [width]);
  const buttonLabel = mode === 'commitment' ? 'I UNDERSTAND AND ACCEPT' : 'GET STARTED';
  const a11yLabel   = mode === 'commitment' ? 'I understand and accept' : 'Get started';

  return (
    <View style={[styles.slide, { width }]}>
      <View style={[styles.visualWrap, { width: visualSize, height: visualSize }]}>
        <RelationshipIntroVisual slide={slideNumber} size={visualSize} />
      </View>
      <Text style={styles.title}>{data.title}</Text>
      <View style={styles.body}>
        <Text style={styles.bodyText}>{data.body}</Text>
      </View>
      {isLast ? (
        <Pressable
          onPress={onComplete}
          disabled={accepting}
          style={[styles.acceptBtn, accepting && styles.acceptBtnDim]}
          accessibilityLabel={a11yLabel}
        >
          {accepting ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.acceptBtnText}>{buttonLabel}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  slide: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  visualWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  body: { width: '100%', maxWidth: 520 },
  bodyText: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 17,
    lineHeight: 26,
    letterSpacing: 0.2,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  acceptBtn: {
    backgroundColor: colors.amber,
    paddingVertical: 16,
    paddingHorizontal: spacing.xl,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    minWidth: 280,
  },
  acceptBtnDim: { opacity: 0.6 },
  acceptBtnText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 1,
  },
  foot: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
