// Relationship intro carousel — Phase 5.
//
// Six cinematic slides each partner reads independently before the
// relationship chat opens. Visual style mirrors the main-app's
// first-launch onboarding (cinematic typography, typewriter on body,
// amber-on-deep-dark cosmologies above each slide).
//
// First-viewing typewriter is gated by an AsyncStorage flag scoped to
// THIS relationshipId — re-entries (after the user backs out and
// returns) render the body text instantly so the visit doesn't feel
// like reading the brochure for the second time.
//
// Slide 6's "I understand and accept" calls
// api.acceptRelationshipIntro(relationshipId). On success the screen
// pops back to /relationships, where the tab's state machine
// re-fetches and either shows the still-pending state (if the
// partner hasn't read theirs yet) or transitions to active.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  Linking,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, fonts, spacing } from '../../../constants/theme';
import { TypewriterText } from '../../../components/guide/TypewriterText';
import { GuideDots } from '../../../components/guide/GuideDots';
import { RelationshipIntroVisual } from '../../../components/relationships/RelationshipIntroVisual';
import { api } from '../../../services/api';

// AsyncStorage key — flips to '1' the first time the user reaches the
// last slide of THIS relationship's intro. Per-relationship so a user
// who somehow ends up in a second relationship in a future build still
// gets the cinematic experience there. Subsequent re-entries render
// the same slides instantly.
const introSeenKey = (id: string) => `relationships.introSeen:${id}`;

// Slide content — single source of truth. The visuals live in
// RelationshipIntroVisual and are indexed by 1-based slide number to
// match the spec's slide-numbering vocabulary.
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

export default function RelationshipIntroScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const relationshipId = String(id || '').trim();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [index, setIndex] = useState(0);
  const [animateBody, setAnimateBody] = useState<'unknown' | 'animate' | 'instant'>('unknown');
  const [accepting, setAccepting] = useState(false);
  const listRef = useRef<FlatList>(null);

  // Read the per-relationship "introSeen" flag. Same three-state
  // pattern as the Guide tab's first-launch gate so a returning user
  // never sees a flash of plain text before/after the gate flips.
  useEffect(() => {
    if (!relationshipId) {
      setAnimateBody('instant');
      return;
    }
    AsyncStorage.getItem(introSeenKey(relationshipId))
      .then((v) => setAnimateBody(v ? 'instant' : 'animate'))
      .catch(() => setAnimateBody('instant'));
  }, [relationshipId]);

  // Mark the flag the moment the user reaches the last slide. After
  // that, even if they pop back and re-enter, body renders instantly.
  useEffect(() => {
    if (!relationshipId) return;
    if (index === SLIDES.length - 1 && animateBody === 'animate') {
      AsyncStorage.setItem(introSeenKey(relationshipId), '1').catch(() => {});
    }
  }, [index, animateBody, relationshipId]);

  const onScroll = useCallback(
    (e: any) => {
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / width);
      if (i !== index) setIndex(i);
    },
    [index, width],
  );

  const goToSlide = useCallback(
    (i: number) => {
      Haptics.selectionAsync().catch(() => {});
      listRef.current?.scrollToIndex({ index: i, animated: true });
      setIndex(i);
    },
    [],
  );

  const onAccept = useCallback(async () => {
    if (!relationshipId || accepting) return;
    setAccepting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const result = await api.acceptRelationshipIntro(relationshipId);
    setAccepting(false);
    if ('error' in result) {
      Alert.alert(
        'Could not save your acceptance',
        result.message || 'Please try again in a moment.',
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace('/relationships');
  }, [relationshipId, accepting, router]);

  // Hold rendering until the gate resolves to avoid a flash of
  // already-typed body text before the typewriter would have started.
  if (animateBody === 'unknown') {
    return <SafeAreaView style={styles.root} edges={['top', 'bottom']} />;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Lightweight header — back chevron only. No title; the cinematic
          slides carry their own. */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.creamDim} />
        </Pressable>
        <View style={styles.backBtn} />
      </View>

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
            accepting={accepting}
            onAccept={onAccept}
          />
        )}
      />

      <View style={styles.foot}>
        <GuideDots count={SLIDES.length} active={index} onTap={goToSlide} />
      </View>
    </SafeAreaView>
  );
}

// =============================================================================
// One slide. Visual on top, cinematic title, body that types in on first
// view (instant on re-entry). Slide 5 renders the safety contacts as
// tappable tel:/sms: links. Slide 6 includes the accept button below
// the body.
// =============================================================================
function IntroSlide({
  data, slideNumber, width, isActive, animateBody, isLast, accepting, onAccept,
}: {
  data: { title: string; body: string; accent?: 'safety' };
  slideNumber: number;
  width: number;
  isActive: boolean;
  animateBody: boolean;
  isLast: boolean;
  accepting: boolean;
  onAccept: () => void;
}) {
  // One-shot typewriter trigger per mount — same pattern as GuideSlide's
  // hasTriggered. Lazy initializer fires for slide 0 on first paint;
  // post-mount effect picks up siblings as they become active.
  const [hasTriggered, setHasTriggered] = useState(() => animateBody && isActive);
  useEffect(() => {
    if (animateBody && isActive && !hasTriggered) setHasTriggered(true);
  }, [animateBody, isActive, hasTriggered]);

  const visualSize = useMemo(() => Math.min(width * 0.6, 280), [width]);
  const showTypewriter = animateBody && hasTriggered;
  // Off-screen siblings render an empty Text placeholder until they
  // become active, so the user doesn't see finished body text flash
  // by during the page transition right before the typewriter fires.
  const showEmptyPlaceholder = animateBody && !hasTriggered;

  // Slide 5 — the safety slide — gets the body split out so the
  // hotline number + SMS shortcode become tappable tel:/sms: links.
  // The rest of the body is rendered as plain TypewriterText.
  if (data.accent === 'safety') {
    return (
      <View style={[styles.slide, { width }]}>
        <View style={[styles.visualWrap, { width: visualSize, height: visualSize }]}>
          <RelationshipIntroVisual slide={slideNumber} size={visualSize} />
        </View>
        <Text style={styles.title}>{data.title}</Text>
        <View style={styles.body}>
          {/* Lead paragraph. Typewriter on first view; static otherwise. */}
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
          {/* Crisis links — always rendered statically so they're
              tappable from the moment they're on screen. */}
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
          onPress={onAccept}
          disabled={accepting}
          style={[styles.acceptBtn, accepting && styles.acceptBtnDim]}
          accessibilityLabel="I understand and accept"
        >
          {accepting ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.acceptBtnText}>I UNDERSTAND AND ACCEPT</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

// =============================================================================
// Styles — match the cinematic onboarding rhythm: title 44pt
// CormorantGaramond_600SemiBold, body 18pt DMSans SemiBold, generous
// vertical breathing room, dark amber-accented palette.
// =============================================================================
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

  // Cinematic typography — same scale as the main-app onboarding's
  // titleCinematic + paraCinematic.
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

  // Slide 5 safety links — two stacked rows, both tappable.
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

  // Slide 6 — accept CTA.
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
