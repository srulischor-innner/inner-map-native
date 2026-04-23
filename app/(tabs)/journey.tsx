// Journey tab — a single scroll that surfaces four things:
//   1. Most Active Energies — which parts dominate the conversation history
//   2. Language Pattern Categories — clinical pattern chips across sessions
//   3. Two Spectrums — Outside-In → Inside-Out and Fragmented → Flowing
//   4. Your Path — reverse-chronological timeline of sessions
//
// Data source: /api/journey (server aggregates from SQLite). Every section has a
// warm empty state so the page is useful from session one.

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { EnergiesBar, Energy } from '../../components/journey/EnergiesBar';
import { LanguageChips } from '../../components/journey/LanguageChips';
import { SpectrumBar } from '../../components/journey/SpectrumBar';
import { PathTimeline, PathItem } from '../../components/journey/PathTimeline';

type JourneyData = {
  totalSessions: number;
  totalMessages: number;
  firstMapDate: string | null;
  mostActiveParts: Energy[];
  clinicalPatterns: any;
  sessions: PathItem[];
  // The server doesn't currently return spectrum scores aggregated — we look at the
  // most recent session's stored outsideInScore / fragmentedScore if we pull it here.
  // For v1 we just show the spectrums as "not enough signal yet" unless we can derive
  // a value. A follow-up can extend /api/journey to include an aggregate.
  outsideInScore?: number | null;
  fragmentedScore?: number | null;
};

export default function JourneyScreen() {
  const [data, setData] = useState<JourneyData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await api.getJourney();
    if (res) setData(res as JourneyData);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const totalSessions = data?.totalSessions ?? 0;
  const totalMessages = data?.totalMessages ?? 0;

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Journey</Text>
        <Text style={styles.sub}>How you're changing across sessions</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.amber} />
        }
      >
        {/* Summary row — sessions + messages count */}
        <View style={styles.summaryRow}>
          <SummaryStat label="SESSIONS" value={totalSessions} />
          <SummaryStat label="MESSAGES" value={totalMessages} />
          {data?.firstMapDate ? (
            <SummaryStat label="MAP SINCE" value={data.firstMapDate.slice(5)} />
          ) : (
            <SummaryStat label="MAP SINCE" value="—" />
          )}
        </View>

        <Section title="Most active energies">
          <EnergiesBar energies={data?.mostActiveParts || []} />
        </Section>

        <Section title="Language patterns">
          <LanguageChips patterns={data?.clinicalPatterns} />
        </Section>

        <Section title="The spectrums">
          <SpectrumBar
            leftLabel="Outside-In"
            rightLabel="Inside-Out"
            leftColor={colors.wound}
            rightColor={colors.self}
            value={data?.outsideInScore ?? null}
            caption="How your protective parts are orienting to the world — a conceptual shift."
          />
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
          <PathTimeline items={data?.sessions || []} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryValue}>{String(value)}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderBottomColor: colors.border, borderBottomWidth: 1,
  },
  title: { color: colors.amber, fontSize: 22, fontWeight: '500', letterSpacing: 0.3 },
  sub: { color: colors.creamFaint, fontSize: 12, fontStyle: 'italic', marginTop: 2 },

  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  summaryStat: {
    flex: 1,
    padding: spacing.sm,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryValue: { color: colors.cream, fontSize: 20, fontWeight: '500' },
  summaryLabel: { color: colors.creamFaint, fontSize: 10, letterSpacing: 1.2, marginTop: 2 },

  section: { marginBottom: spacing.xl },
  sectionTitle: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginBottom: spacing.sm,
  },
});
