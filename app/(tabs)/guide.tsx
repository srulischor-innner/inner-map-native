// Guide tab — three pill-navigated sections:
//   • The Map   — 11 swipeable slides introducing the framework
//   • Healing   — 5 swipeable slides on the three stages + "creating something new"
//   • Using It  — scrollable cards (4 feature cards + 5 principles)
//
// FlatLists with pagingEnabled give the horizontal swipe with clean snap-to-page.
// A "Begin your map →" CTA appears at the bottom of each section and jumps to Chat.

import React, { useMemo, useRef, useState, useCallback } from 'react';
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

import { colors, radii, spacing } from '../../constants/theme';
import {
  MAP_SLIDES,
  HEALING_SLIDES,
  USING_FEATURES,
  USING_PRINCIPLES,
  GuideFeature,
} from '../../utils/guideContent';
import { GuideSlide } from '../../components/guide/GuideSlide';
import { GuideDots } from '../../components/guide/GuideDots';

type SectionId = 'map' | 'healing' | 'using';

export default function GuideScreen() {
  const [section, setSection] = useState<SectionId>('map');

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Guide</Text>
      </View>
      <View style={styles.pillsRow}>
        {([
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
      </View>

      {section === 'map' ? (
        <SlideSection slides={MAP_SLIDES} />
      ) : section === 'healing' ? (
        <SlideSection slides={HEALING_SLIDES} />
      ) : (
        <UsingSection />
      )}
    </SafeAreaView>
  );
}

// ====================================================================================
// SLIDE SECTION — horizontal FlatList with pagingEnabled + progress dots + Begin CTA
// ====================================================================================
function SlideSection({ slides }: { slides: typeof MAP_SLIDES }) {
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
        renderItem={({ item }) => <GuideSlide data={item} width={width} />}
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

  // pills
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
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
