// Six-slide cinematic intro carousel — partner-tab onboarding.
//
// Two modes share the same six slides + visuals + typography. The
// commitment moment (the gated "I UNDERSTAND AND ACCEPT" beat) is
// served by a separate single-page ConsentDocument route — that one
// crosses an explicit consent threshold and reads better as one
// scrollable document than six slides.
//
//   mode='informational'
//     Played the very first time the user taps the Partner tab,
//     before they've created or accepted any invite. Last slide
//     button reads "GET STARTED" — onComplete() flips the parent's
//     AsyncStorage `tabIntroSeen` flag and falls through to the
//     connect screen.
//
//   mode='review'
//     User tapped the floating ℹ︎ button on the Partner tab to
//     revisit the framing. Last slide button reads "GOT IT" and
//     onComplete() dismisses back to whichever sub-view the user
//     was on. No flag flip, no API call.
//
// Slide content is single source of truth in SLIDES below — verbatim
// from the v1.1.0 TestFlight-polish spec. Each slide pairs with a
// themed animated illustration in RelationshipIntroVisual (indexed by
// 1-based slide number). Body text renders instantly on every slide;
// motion lives in the visuals.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';
import { GuideDots } from '../guide/GuideDots';
import { RelationshipIntroVisual } from './RelationshipIntroVisual';

// Slide content — single source of truth. Verbatim from the v1.1.0
// polish spec. Order matters: the visuals in RelationshipIntroVisual
// are indexed 1-based against this array.
const SLIDES: { title: string; body: string }[] = [
  {
    title: 'Entering this together',
    body:
      'Inner Map can hold a private space for you and your partner — one where ' +
      'you each do your own inner work, and what you both choose to share ' +
      'becomes visible to both of you.',
  },
  {
    title: 'Your space stays yours',
    body:
      'You each have a private chat only you can see. Your partner never reads ' +
      'what you write in yours. The shared space is for insights you’ve both ' +
      'agreed to share — nothing crosses from private to shared without your ' +
      'permission.',
  },
  {
    title: 'The map view',
    body:
      'You’ll see a Map view showing both of your individual maps side by ' +
      'side — a structural view of each person’s parts and patterns, so ' +
      'you can see how your dynamics interact. Once you and your partner have both ' +
      'completed this consent, your maps become visible to each other in the ' +
      'shared Map view.',
  },
  {
    title: 'What the AI sees and does',
    body:
      'To help you both, the AI sees both of your private conversations and ' +
      'your individual maps. It uses that as background context — but it ' +
      'never tells either of you what the other has said in private.\n\n' +
      'In your private chats, the AI might notice something significant emerging ' +
      'for you and suggest sharing it with your partner. The decision is always ' +
      'yours.\n\n' +
      'In the shared space, the AI engages freely with what you’ve both ' +
      'chosen to share. As your contributions accumulate, it may notice patterns ' +
      'connecting them and bring them into the conversation. You can respond, ' +
      'push back, or take it deeper using the response options it offers.',
  },
  {
    // Safety slide — phone numbers + tappable tel/sms links removed
    // intentionally. The intent is to point users at professional
    // support without prescribing a specific hotline; mobile OSes
    // already make "domestic violence hotline" a one-tap web search,
    // and editorializing on a single number risks pointing the user
    // at a service that isn't appropriate for their region or
    // situation. Crisis resources are surfaced in Settings.
    title: 'If something doesn’t feel safe',
    body:
      'This space is for couples doing mutual inner work in good faith. If ' +
      'you’re experiencing physical violence, threats, coercion, or fear, ' +
      'please reach out to professional support. Crisis resources are in ' +
      'Settings.',
  },
  {
    title: 'Entering together',
    body:
      'By continuing, you’re confirming you understand how this space works ' +
      'and that you’re entering with your partner in good faith.',
  },
];

type Mode = 'informational' | 'review';

export function RelationshipIntroCarousel({
  mode,
  onComplete,
  showCloseButton = false,
  onClose,
}: {
  mode: Mode;
  /** Fires on last-slide button tap. Synchronous on both modes:
   *  informational flips the parent's tabIntroSeen flag, review
   *  dismisses back to the underlying sub-view. */
  onComplete: () => void;
  /** When true, render an X close button in the header. Used by
   *  review mode so the user can dismiss mid-carousel without
   *  reaching the last slide. Informational mode omits it — the
   *  GET STARTED button on the last slide is the only exit. */
  showCloseButton?: boolean;
  onClose?: () => void;
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

  const handleComplete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onComplete();
  }, [onComplete]);

  return (
    <View style={styles.root}>
      {showCloseButton ? (
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Pressable
            onPress={() => onClose?.()}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={22} color={colors.creamDim} />
          </Pressable>
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
// One slide. Animated visual on top, cinematic title, body in serif so
// it reads like the Welcome slide on the main onboarding (Part 3
// typography unification — the carousel is content-heavy and feels
// like a Guide slide, so the serif body lands consistently). Last
// slide includes the completion button — label depends on mode.
// =============================================================================
function IntroSlide({
  data, slideNumber, width, isLast, mode, onComplete,
}: {
  data: { title: string; body: string };
  slideNumber: number;
  width: number;
  isLast: boolean;
  mode: Mode;
  onComplete: () => void;
}) {
  const visualSize = useMemo(() => Math.min(width * 0.55, 240), [width]);
  const buttonLabel = mode === 'review' ? 'GOT IT' : 'GET STARTED';
  const a11yLabel = mode === 'review' ? 'Got it' : 'Get started';

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
          style={styles.acceptBtn}
          accessibilityLabel={a11yLabel}
        >
          <Text style={styles.acceptBtnText}>{buttonLabel}</Text>
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
  headerSpacer: { width: 44, height: 44 },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

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
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  // Serif body so the carousel matches the Welcome-slide aesthetic
  // applied across Guide slide bodies + chat bubbles in this polish
  // round. Slightly larger size and tighter line-height than the
  // sans variant it replaces — Cormorant reads denser per character.
  body: { width: '100%', maxWidth: 520 },
  bodyText: {
    color: colors.cream,
    fontFamily: fonts.serif,
    fontSize: 19,
    lineHeight: 28,
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
