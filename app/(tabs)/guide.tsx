// Guide tab — three pill-navigated sections:
//   • The Map   — 11 swipeable slides introducing the framework
//   • Healing   — 5 swipeable slides on the three stages + "creating something new"
//   • Using It  — scrollable cards (4 feature cards + 5 principles)
//
// FlatLists with pagingEnabled give the horizontal swipe with clean snap-to-page.
// A "Begin your map →" CTA appears at the bottom of each section and jumps to Chat.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, radii, spacing, fonts } from '../../constants/theme';
import {
  WELCOME_SLIDES,
  MAP_SLIDES,
  HEALING_SLIDES,
  USING_FEATURES,
  USING_PRINCIPLES,
  GuideFeature,
} from '../../utils/guideContent';
import { GuideSlide } from '../../components/guide/GuideSlide';
import { GuideDots } from '../../components/guide/GuideDots';
import { GuideAskModal } from '../../components/guide/GuideAskModal';
import { HealingErrorBoundary } from '../../components/guide/HealingErrorBoundary';

type SectionId = 'welcome' | 'map' | 'healing' | 'using';

// AsyncStorage key — flips to '1' the first time the user reaches the
// last Welcome slide, then suppresses the Welcome typewriter animation
// on every subsequent tab visit and app launch.
const HAS_SEEN_WELCOME_KEY = 'hasSeenWelcome';

export default function GuideScreen() {
  // Welcome lands first — it's the orientation framework. Users often only
  // start to grok the framing on the second or third pass after they've
  // had real conversations, so it lives here permanently.
  const [section, setSection] = useState<SectionId>('welcome');
  // Ask modal — opened by the floating chat bubble. Available from any
  // pill so users never have to leave their slide to ask a question.
  const [askOpen, setAskOpen] = useState(false);

  // Three-state animation gate:
  //   'unknown' — we haven't read AsyncStorage yet; render nothing
  //               typewriter-related so the first paint isn't a flash
  //               of plain text immediately replaced by an animation.
  //   'animate' — first launch, run the typewriter on welcome slides.
  //   'instant' — flag is set, every welcome slide renders text instantly.
  const [welcomeAnimGate, setWelcomeAnimGate] = useState<
    'unknown' | 'animate' | 'instant'
  >('unknown');
  useEffect(() => {
    AsyncStorage.getItem(HAS_SEEN_WELCOME_KEY)
      .then((v) => setWelcomeAnimGate(v ? 'instant' : 'animate'))
      .catch(() => setWelcomeAnimGate('instant'));
  }, []);
  const markWelcomeSeen = useCallback(() => {
    setWelcomeAnimGate((prev) => (prev === 'animate' ? 'instant' : prev));
    AsyncStorage.setItem(HAS_SEEN_WELCOME_KEY, '1').catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Guide</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillsScroll}
        contentContainerStyle={styles.pillsRow}
      >
        {([
          ['welcome', 'Welcome'],
          ['map', 'The Map'],
          ['healing', 'Healing'],
          ['using', 'Using It'],
        ] as const).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setSection(id);
            }}
            style={[styles.pill, section === id && styles.pillActive]}
          >
            <Text style={[styles.pillText, section === id && styles.pillTextActive]}>
              {label.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {section === 'welcome' ? (
        // Hold the welcome render until the AsyncStorage read resolves —
        // otherwise a returning user briefly sees the plain-text version
        // before the typewriter would have started, or vice versa.
        welcomeAnimGate === 'unknown' ? (
          <View style={styles.sectionRoot} />
        ) : (
          <SlideSection
            slides={WELCOME_SLIDES}
            animateBody={welcomeAnimGate === 'animate'}
            onReachLastSlide={markWelcomeSeen}
          />
        )
      ) : section === 'map' ? (
        <SlideSection slides={MAP_SLIDES} />
      ) : section === 'healing' ? (
        // Healing tab is currently the most fragile section after the
        // recent visual additions — wrap in an error boundary so a
        // single bad visual can't crash the whole app.
        <HealingErrorBoundary>
          <SlideSection slides={HEALING_SLIDES} />
        </HealingErrorBoundary>
      ) : (
        <UsingSection />
      )}

      {/* Floating Ask bubble — available from every pill. The amber
          italic "Ask" label sits permanently above the button so the
          affordance is always self-explanatory. Bottom: 80 clears the
          tab bar + the slide-section dot indicators. */}
      <View style={styles.askWrap} pointerEvents="box-none">
        <Text style={styles.askLabel}>Ask</Text>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setAskOpen(true);
          }}
          accessibilityLabel="Ask anything about the framework"
          style={styles.askBubble}
          hitSlop={6}
        >
          <Ionicons name="chatbubble-outline" size={22} color="#E6B47A" />
        </Pressable>
      </View>

      <GuideAskModal visible={askOpen} onClose={() => setAskOpen(false)} />
    </SafeAreaView>
  );
}

// ====================================================================================
// SLIDE SECTION — horizontal FlatList with pagingEnabled + progress dots + Begin CTA
// ====================================================================================
function SlideSection({
  slides,
  animateBody = false,
  onReachLastSlide,
}: {
  slides: typeof MAP_SLIDES;
  /** Forwarded to GuideSlide — when true (Welcome on first launch),
   *  body paragraphs animate in via a typewriter as each slide
   *  becomes the active page. */
  animateBody?: boolean;
  /** Called once when the user lands on the last slide. The Welcome
   *  section uses this to flip its hasSeenWelcome AsyncStorage flag. */
  onReachLastSlide?: () => void;
}) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  const router = useRouter();

  const onScroll = useCallback(
    (e: any) => {
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / width);
      if (i !== index) setIndex(i);
    },
    [index, width],
  );

  const goToSlide = (i: number) => {
    listRef.current?.scrollToIndex({ index: i, animated: true });
    setIndex(i);
  };

  const beginMap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push('/');
  };

  const atLast = index === slides.length - 1;

  // Fire onReachLastSlide once when the user first lands on the final
  // slide. Guarded by a ref so a swipe back-and-forth doesn't re-fire
  // it; the parent's handler is also idempotent so this is just a
  // courtesy.
  const reachedLastRef = useRef(false);
  useEffect(() => {
    if (atLast && !reachedLastRef.current) {
      reachedLastRef.current = true;
      onReachLastSlide?.();
    }
  }, [atLast, onReachLastSlide]);

  return (
    <View style={styles.sectionRoot}>
      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item, index: i }) => (
          <GuideSlide
            data={item}
            width={width}
            animateBody={animateBody}
            isActive={i === index}
          />
        )}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={2}
      />
      <View style={styles.foot}>
        <GuideDots count={slides.length} active={index} onTap={goToSlide} />
        {atLast ? (
          <Pressable onPress={beginMap} style={styles.beginBtn} accessibilityLabel="Begin your map">
            <Text style={styles.beginBtnText}>BEGIN YOUR MAP →</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ====================================================================================
// USING IT SECTION — scrollable cards + principles + Begin CTA
// ====================================================================================
function UsingSection() {
  const router = useRouter();
  return (
    <ScrollView
      style={styles.sectionRoot}
      contentContainerStyle={styles.usingContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.usingH2}>The four ways to use Inner Map</Text>
      {USING_FEATURES.map((f, i) => (
        <FeatureCard key={i} feature={f} />
      ))}

      <Text style={[styles.usingH2, { marginTop: spacing.xl }]}>
        Getting the most out of Inner Map
      </Text>
      {USING_PRINCIPLES.map((p, i) => (
        <View key={i} style={[styles.principle, i > 0 && styles.principleDivider]}>
          <Text style={styles.principleText}>{p}</Text>
        </View>
      ))}

      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          router.push('/');
        }}
        style={[styles.beginBtn, { marginTop: spacing.xl, marginBottom: spacing.xl }]}
        accessibilityLabel="Begin your map"
      >
        <Text style={styles.beginBtnText}>BEGIN YOUR MAP →</Text>
      </Pressable>
    </ScrollView>
  );
}

function FeatureCard({ feature }: { feature: GuideFeature }) {
  // Small iconography for each feature. Keeps the visual hierarchy consistent with
  // the amber left-border card style used across the app.
  const iconName: Record<GuideFeature['icon'], keyof typeof Ionicons.glyphMap> = {
    chat: 'chatbubble-ellipses-outline',
    map: 'triangle-outline',
    self: 'ellipse-outline',
    journey: 'trending-up-outline',
  };
  return (
    <View style={styles.card}>
      <Ionicons name={iconName[feature.icon]} size={22} color={colors.amber} style={{ marginBottom: 8 }} />
      <Text style={styles.cardTitle}>{feature.title}</Text>
      {feature.body.map((p, i) => (
        <Text key={i} style={styles.cardBody}>{p}</Text>
      ))}
    </View>
  );
}

// ====================================================================================
// STYLES
// ====================================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { alignItems: 'center', paddingVertical: spacing.sm },
  headerTitle: { color: colors.amber, fontSize: 22, fontWeight: '500', letterSpacing: 0.3 },

  // Floating Ask container — bottom-right, always visible. Holds a
  // permanent italic "Ask" label above the circular button so the
  // affordance is self-explanatory at a glance. bottom: 80 clears
  // both the tab bar and the per-section dot indicators on slides.
  askWrap: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    alignItems: 'center',
    zIndex: 100,
  },
  askLabel: {
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    color: 'rgba(230,180,122,0.8)',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  askBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(230,180,122,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // pills
  // 4 pills (Welcome / The Map / Healing / Using It) — wrapped in a
  // horizontal ScrollView so they fit on narrow phones without truncation.
  pillsScroll: {
    flexGrow: 0,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.amberDim,
  },
  pillActive: { backgroundColor: colors.amberFaint, borderColor: colors.amber },
  pillText: { color: colors.creamFaint, fontSize: 11, fontWeight: '600', letterSpacing: 1.8 },
  pillTextActive: { color: colors.amber },

  // section wrappers
  sectionRoot: { flex: 1 },
  foot: {
    paddingVertical: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    alignItems: 'center',
    gap: 8,
  },

  // begin button
  beginBtn: {
    borderWidth: 1.5,
    borderColor: colors.amber,
    borderRadius: radii.pill,
    paddingHorizontal: 36,
    paddingVertical: 12,
    shadowColor: colors.amber,
    shadowOpacity: Platform.OS === 'ios' ? 0.35 : 0,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  beginBtnText: { color: colors.amber, fontSize: 12, fontWeight: '600', letterSpacing: 2 },

  // using it
  usingContent: { padding: spacing.lg, paddingBottom: spacing.xxl, maxWidth: 640, alignSelf: 'center', width: '100%' },
  usingH2: { color: colors.amber, fontSize: 20, fontWeight: '500', marginBottom: spacing.md, letterSpacing: 0.3 },
  card: {
    backgroundColor: colors.backgroundCard,
    borderLeftColor: colors.amber,
    borderLeftWidth: 2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { color: colors.amber, fontSize: 17, fontWeight: '500', marginBottom: 8 },
  cardBody: { color: colors.cream, fontSize: 14, lineHeight: 22, marginBottom: 8 },
  principle: { paddingVertical: spacing.md },
  principleDivider: { borderTopColor: colors.border, borderTopWidth: 1 },
  principleText: { color: colors.cream, fontSize: 14, lineHeight: 22 },
});
