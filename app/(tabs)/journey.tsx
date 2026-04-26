// Journey tab — how you're changing across sessions. Cleaner design pass:
// no top metrics row, larger amber section headers with generous vertical
// rhythm, softer spectrum presentation, subtle chip styling.
//
// Data source: /api/journey (server aggregates from SQLite). Every section
// still has a warm empty state so the page is useful from session one.

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { getUserId } from '../../services/user';
import { EnergiesBar, Energy } from '../../components/journey/EnergiesBar';
import { LanguageChips } from '../../components/journey/LanguageChips';
import { SpectrumBar } from '../../components/journey/SpectrumBar';
import { PathTimeline, PathItem } from '../../components/journey/PathTimeline';
import { SessionDetailModal } from '../../components/session/SessionDetailModal';

type JourneyData = {
  totalSessions: number;
  totalMessages: number;
  firstMapDate: string | null;
  mostActiveParts: Energy[];
  clinicalPatterns: any;
  sessions: PathItem[];
  // Reading positions on each spectrum (0..1). DB columns keep their legacy
  // "...Score" suffix; the UI never says "score" anywhere.
  outsideInScore?: number | null;
  fragmentedScore?: number | null;
  blendedSelfLedScore?: number | null;
};

export default function JourneyScreen() {
  const [data, setData] = useState<JourneyData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Print the exact userId we're fetching sessions under so a mismatch
    // between the native UUID and any web account is visible immediately.
    const userId = await getUserId();
    console.log('[journey] fetching /api/journey for userId=', userId.slice(0, 8));
    const res = await api.getJourney();
    console.log(
      '[journey] response: sessions=', res?.sessions?.length ?? 0,
      'totalMessages=', res?.totalMessages,
      'firstMapDate=', res?.firstMapDate,
    );
    if (res) setData(res as JourneyData);
  }, []);
  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.amber} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Minimal intro — quiet instead of metric-y */}
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Your Journey</Text>
          <Text style={styles.introSub}>How you're changing across sessions.</Text>
        </View>

        <Section title="Most active energies">
          <EnergiesBar energies={data?.mostActiveParts || []} />
        </Section>

        <Section title="Language patterns">
          <LanguageChips patterns={data?.clinicalPatterns} />
        </Section>

        <Section title="The spectrums">
          {/* Three spectrums — read independently. Order matches the Map
              tab's YOUR PROGRESS strip (perspective → position → integration). */}
          <SpectrumBar
            leftLabel="Outside-In"
            rightLabel="Inside-Out"
            leftColor={colors.wound}
            rightColor={colors.self}
            value={data?.outsideInScore ?? null}
            caption="How your protective parts orient to the world — a conceptual shift."
          />
          <View style={{ height: spacing.md }} />
          <SpectrumBar
            leftLabel="Blended"
            rightLabel="Self-Led"
            leftColor={colors.firefighters}
            rightColor={colors.self}
            value={data?.blendedSelfLedScore ?? null}
            caption="When parts activate, are you it — or with it? A relational shift."
          />
          <View style={{ height: spacing.md }} />
          <SpectrumBar
            leftLabel="Fragmented"
            rightLabel="Flowing"
            leftColor={colors.firefighters}
            rightColor={colors.self}
            value={data?.fragmentedScore ?? null}
            caption="How your whole system is actually running — an experiential shift."
          />
        </Section>

        <Section title="Your path">
          <PathTimeline
            items={data?.sessions || []}
            onItemPress={(id) => setSelectedSessionId(id)}
          />
        </Section>
      </ScrollView>

      <SessionDetailModal
        visible={!!selectedSessionId}
        sessionId={selectedSessionId}
        onClose={() => setSelectedSessionId(null)}
      />
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.sectionDivider} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },

  // Top — no metric cards, just a warm two-line intro
  intro: { alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.xl },
  introTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    letterSpacing: 0.4,
  },
  introSub: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    marginTop: 4,
    letterSpacing: 0.2,
  },

  // Section — amber uppercase header in DM Sans SemiBold, subtle divider.
  section: { marginBottom: spacing.xxl },
  sectionTitle: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 10,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
});
