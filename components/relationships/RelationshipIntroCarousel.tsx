// Six-slide cinematic intro carousel — used in two places in the
// app, each with its own button copy and gating semantics:
//
//   mode='informational'
//     Played the very first time the user taps the Partner tab,
//     before they've created or accepted any invite. Last slide
//     button reads "GET STARTED" — no API call, just calls
//     onComplete() so the parent can flip an AsyncStorage flag and
//     fall through to the connect screen.
//
//   mode='commitment'
//     Played AFTER both partners have accepted an invite — the
//     "ready to begin?" moment that gates the active relationship.
//     Last slide button reads "I UNDERSTAND AND ACCEPT" and
//     onComplete() fires api.acceptRelationshipIntro to flip the
//     server-side intro flag.
//
// Both modes share the exact same six slides + visuals + cinematic
// typography. Typewriter on first viewing is gated by an
// AsyncStorage key the parent provides (per-relationship for the
// commitment route; a single fixed key for the informational tab
// flow).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, Linking, StyleSheet,
  useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, fonts, spacing } from '../../constants/theme';
import { TypewriterText } from '../guide/TypewriterText';
import { GuideDots } from '../guide/GuideDots';
import { RelationshipIntroVisual } from './RelationshipIntroVisual';

// Slide content — single source of truth. Visuals live in
// RelationshipIntroVisual and are indexed by 1-based slide number.
const SLIDES: { title: string; body: string; accent?: 'safety' }[] = [
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
    title: "If something doesn't feel safe",
    body:
      "This space is for couples doing mutual healing work. If you're experiencing physical " +
      "violence, threats, coercion, or fear in your relationship, please reach out to professional " +
      "support. National Domestic Violence Hotline: 1-800-799-7233. Text START to 88788. " +
      "You're not alone.",
    accent: 'safety',
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
  introSeenKey,
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
  /** AsyncStorage key gating the first-view typewriter. Per-
   *  relationship for the commitment route (keys keep the cinematic
   *  experience local to each pairing); a single fixed key for the
   *  informational tab flow (one playthrough per install). */
  introSeenKey: string;
  /** When true, render a back chevron in the header. The route-
   *  based commitment screen uses this; the in-tab informational
   *  embed doesn't (the user can't go anywhere meaningful — the
   *  tab itself IS the back). */
  showBackButton?: boolean;
  onBack?: () => void;
}) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [animateBody, setAnimateBody] = useState<'unknown' | 'animate' | 'instant'>('unknown');
  const listRef = useRef<FlatList>(null);

  // Three-state typewriter gate — same pattern as Guide tab + the
  // existing per-relationship intro screen. Holds rendering at a
  // blank canvas until the AsyncStorage read settles so a returning
  // user doesn't flash through plain text before the gate flips.
  useEffect(() => {
    if (!introSeenKey) {
      setAnimateBody('instant');
      return;
    }
    AsyncStorage.getItem(introSeenKey)
      .then((v) => setAnimateBody(v ? 'instant' : 'animate'))
      .catch(() => setAnimateBody('instant'));
  }, [introSeenKey]);

  // Mark the flag the moment the user first reaches the last slide.
  // After that, even pop-and-return renders body text instantly.
  useEffect(() => {
    if (!introSeenKey) return;
    if (index === SLIDES.length - 1 && animateBody === 'animate') {
      AsyncStorage.setItem(introSeenKey, '1').catch(() => {});
    }
  }, [index, animateBody, introSeenKey]);

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

  if (animateBody === 'unknown') {
    return <View style={styles.root} />;
  }

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
            isActive={i === index}
            animateBody={animateBody === 'animate'}
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
// One slide. Visual on top, cinematic title, body that types in on
// first view (instant on re-entry). Slide 5 renders the safety
// contacts as tappable tel:/sms: links. Slide 6 includes the
// completion button — copy depends on mode.
// =============================================================================
function IntroSlide({
  data, slideNumber, width, isActive, animateBody, isLast, mode, accepting, onComplete,
}: {
  data: { title: string; body: string; accent?: 'safety' };
  slideNumber: number;
  width: number;
  isActive: boolean;
  animateBody: boolean;
  isLast: boolean;
  mode: Mode;
  accepting: boolean;
  onComplete: () => void;
}) {
  const [hasTriggered, setHasTriggered] = useState(() => animateBody && isActive);
  useEffect(() => {
    if (animateBody && isActive && !hasTriggered) setHasTriggered(true);
  }, [animateBody, isActive, hasTriggered]);

  const visualSize = useMemo(() => Math.min(width * 0.6, 280), [width]);
  const showTypewriter = animateBody && hasTriggered;
  const showEmptyPlaceholder = animateBody && !hasTriggered;

  const buttonLabel = mode === 'commitment' ? 'I UNDERSTAND AND ACCEPT' : 'GET STARTED';
  const a11yLabel   = mode === 'commitment' ? 'I understand and accept' : 'Get started';

  if (data.accent === 'safety') {
    return (
      <View style={[styles.slide, { width }]}>
        <View style={[styles.visualWrap, { width: visualSize, height: visualSize }]}>
          <RelationshipIntroVisual slide={slideNumber} size={visualSize} />
        </View>
        <Text style={styles.title}>{data.title}</Text>
        <View style={styles.body}>
          {showTypewriter ? (
            <TypewriterText
              text="This space is for couples doing mutual healing work. If you're experiencing physical violence, threats, coercion, or fear in your relationship, please reach out to professional support."
              style={styles.bodyText}
            />
          ) : showEmptyPlaceholder ? (
            <Text style={styles.bodyText}>{''}</Text>
          ) : (
            <Text style={styles.bodyText}>
              This space is for couples doing mutual healing work. If you're experiencing physical violence, threats, coercion, or fear in your relationship, please reach out to professional support.
            </Text>
          )}
          <View style={styles.safetyLinks}>
            <Pressable
              onPress={() => Linking.openURL('tel:18007997233').catch(() => {})}
              style={styles.safetyRow}
              hitSlop={6}
              accessibilityLabel="Call National Domestic Violence Hotline"
            >
              <Ionicons name="call-outline" size={16} color={colors.amber} style={styles.safetyIcon} />
              <Text style={styles.safetyLabel}>
                National Domestic Violence Hotline:{' '}
                <Text style={styles.safetyNum}>1-800-799-7233</Text>
              </Text>
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL('sms:88788?body=START').catch(() => {})}
              style={styles.safetyRow}
              hitSlop={6}
              accessibilityLabel="Text START to 88788"
            >
              <Ionicons name="chatbox-outline" size={16} color={colors.amber} style={styles.safetyIcon} />
              <Text style={styles.safetyLabel}>
                Text <Text style={styles.safetyNum}>START</Text> to{' '}
                <Text style={styles.safetyNum}>88788</Text>
              </Text>
            </Pressable>
          </View>
          <Text style={styles.bodyText}>You're not alone.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.slide, { width }]}>
      <View style={[styles.visualWrap, { width: visualSize, height: visualSize }]}>
        <RelationshipIntroVisual slide={slideNumber} size={visualSize} />
      </View>
      <Text style={styles.title}>{data.title}</Text>
      <View style={styles.body}>
        {showTypewriter ? (
          <TypewriterText text={data.body} style={styles.bodyText} />
        ) : showEmptyPlaceholder ? (
          <Text style={styles.bodyText}>{''}</Text>
        ) : (
          <Text style={styles.bodyText}>{data.body}</Text>
        )}
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
  safetyLinks: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  safetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  safetyIcon: { marginRight: 8 },
  safetyLabel: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  safetyNum: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    textDecorationLine: 'underline',
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
