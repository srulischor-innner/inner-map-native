// Journey tab — how you're changing across sessions. Cleaner design pass:
// no top metrics row, larger amber section headers with generous vertical
// rhythm, softer spectrum presentation, subtle chip styling.
//
// Data source: /api/journey (server aggregates from SQLite). Every section
// still has a warm empty state so the page is useful from session one.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import type { BillingStatus } from '../../services/api';
import { getUserId } from '../../services/user';
import { EnergiesBar, Energy } from '../../components/journey/EnergiesBar';
import { SpectrumBar } from '../../components/journey/SpectrumBar';
import { PathTimeline, PathItem } from '../../components/journey/PathTimeline';
import { SessionDetailModal } from '../../components/session/SessionDetailModal';
import { StatCards } from '../../components/journey/StatCards';
import { UsageStrip } from '../../components/journey/UsageStrip';
import { MapDepth } from '../../components/journey/MapDepth';
import { PartPhrases, LanguagePatterns } from '../../components/journey/PartPhrases';

type JourneyData = {
  totalSessions: number;
  totalMessages: number;          // user messages across all sessions
  firstSessionDate: string | null;
  firstMapDate: string | null;
  mostActiveParts: Energy[];
  clinicalPatterns: any;
  languagePatterns?: LanguagePatterns;
  mapData?: any;                  // legacy session blob — no longer drives YOUR MAP (see parts[] / MapDepth)
  sessions: PathItem[];
  // Reading positions on each spectrum (0..1). DB columns keep their legacy
  // "...Score" suffix; the UI never says "score" anywhere.
  outsideInScore?: number | null;
  fragmentedScore?: number | null;
  blendedSelfLedScore?: number | null;
  // Per-spectrum provenance — true only when a real SPECTRUM_UPDATE earned
  // the reading. Gates the dot so a thin-data session shows no confident read.
  spectrumEarned?: { outsideIn?: boolean; fragmented?: boolean; blendedSelfLed?: boolean } | null;
};

export default function JourneyScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<JourneyData | null>(null);
  // "Your map" reads the parts table (same source as the Map tab + /api/parts),
  // NOT the legacy session mapData blob — that blob is now {partFindings:[...]}
  // and MapDepth's old flat-key reads counted zero → "Not yet visible" on a
  // full map. Repointed to parts[] (June 2026 fix).
  const [parts, setParts] = useState<any[]>([]);
  // Feeds the ambient UsageStrip below the stat cards. null = unknown (not yet
  // loaded, or the status read failed) — the strip renders nothing for null.
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // 'idle' before first response, 'loaded' after response (even null), 'error'
  // after a thrown / failed fetch. Drives the empty + error overlays below.
  const [loadStatus, setLoadStatus] = useState<'idle' | 'loaded' | 'error'>('idle');

  // Unmount guard. This tab's fetch can outlive the screen, and load() is
  // shared by mount, focus, pull-to-refresh and the retry button, so the guard
  // lives with the fetch rather than in any one caller's cleanup.
  // Re-armed on mount (not just cleared on unmount) so a remount — Fast
  // Refresh, or a future StrictMode double-invoke — can't leave it latched
  // false and silently swallow every later setState.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // One-flight coalescing. A focus event that lands while a RefreshControl
  // fetch is still open JOINS that fetch instead of starting a second one —
  // otherwise two responses race and the older one can overwrite the newer.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const load = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const p = (async () => {
      try {
        const userId = await getUserId();
        console.log('[journey] fetching /api/journey for userId=', userId.slice(0, 8));
        // Billing status rides along with the existing load/refresh cycle — no
        // second polling loop. getBillingStatus() swallows its own failures and
        // resolves null, so it can never fail the journey fetch.
        const [res, ps, bill] = await Promise.all([
          api.getJourney(),
          api.getParts(),
          api.getBillingStatus(),
        ]);
        console.log(
          '[journey] response: sessions=', res?.sessions?.length ?? 0,
          'totalMessages=', res?.totalMessages,
          'firstMapDate=', res?.firstMapDate,
          'parts=', Array.isArray(ps) ? ps.length : 0,
        );
        // Bail before any setState if the screen went away mid-flight.
        if (!mountedRef.current) return;
        if (res) setData(res as JourneyData);
        if (Array.isArray(ps)) setParts(ps);
        setBilling(bill);
        setLoadStatus('loaded');
      } catch (e) {
        console.warn('[journey] load failed:', (e as Error)?.message);
        if (mountedRef.current) setLoadStatus('error');
      }
    })();
    inFlightRef.current = p;
    // Release the slot however p settles. An async IIFE always returns a
    // promise, so this handler can never run before the assignment above.
    p.then(
      () => { inFlightRef.current = null; },
      () => { inFlightRef.current = null; },
    );
    return p;
  }, []);

  // LOAD-TIME read — defensive baseline for the case where this tab is
  // mounted without gaining focus.
  useEffect(() => { load(); }, [load]);

  // FOCUS re-read. A top-up completes on a screen PUSHED over this tab, so
  // Journey never unmounts and the UsageStrip below kept rendering the
  // pre-top-up billing state after the user came back. Re-reading on focus
  // rides the existing load() cycle — same single request set, no second
  // polling loop — and coalesces with any in-flight pull-to-refresh.
  useFocusEffect(
    useCallback(() => { load(); }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { if (mountedRef.current) setRefreshing(false); }
  };

  // Show the layout (with zero-state stat cards) even before any data
  // lands, so the page never looks "empty". The error state is still
  // distinct since the network call actually failed.
  if (loadStatus === 'error') {
    return (
      <SafeAreaView style={styles.root} edges={[]}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Journey data is loading — try refreshing in a moment.</Text>
          <Pressable
            onPress={() => { setLoadStatus('idle'); load(); }}
            hitSlop={10}
            style={styles.retryBtn}
            accessibilityLabel="Retry loading journey"
          >
            <Text style={styles.retryText}>RETRY</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.amber} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Quiet intro */}
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Your Journey</Text>
          <Text style={styles.introSub}>How you're changing across sessions.</Text>
        </View>

        {/* Stat cards — conversations / messages shared / journey began */}
        <StatCards
          totalSessions={data?.totalSessions || 0}
          totalMessages={data?.totalMessages || 0}
          firstSessionDate={data?.firstSessionDate || null}
        />

        {/* Ambient usage state — silent below 80% of the period's pool. It must
            read as attached to the stats block, so it pulls itself back up
            through StatCards' own marginBottom (spacing.xl) to sit spacing.sm
            under the cards, then restores that spacing.xl beneath itself. The
            offset lives on the strip (not on a wrapper) so a null render leaves
            the layout byte-identical to before. */}
        <UsageStrip status={billing} style={styles.usageStrip} />

        <Section title="Your map">
          <MapDepth parts={parts} />
        </Section>

        <Section title="Most active parts">
          <EnergiesBar energies={data?.mostActiveParts || []} />
        </Section>

        <Section title="Language patterns">
          <PartPhrases patterns={data?.languagePatterns || null} perPart={3} />
        </Section>

        <Section title="The spectrums">
          {/* Three spectrums — read independently. Order matches the Map
              tab's YOUR PROGRESS strip (perspective → position → integration). */}
          <SpectrumBar
            leftLabel="Outside-In"
            rightLabel="Inside-Out"
            leftColor={colors.wound}
            rightColor={colors.self}
            value={data?.spectrumEarned?.outsideIn ? (data?.outsideInScore ?? null) : null}
            caption="How your protective parts orient to the world — a conceptual shift."
          />
          <View style={{ height: spacing.md }} />
          <SpectrumBar
            leftLabel="Blended"
            rightLabel="Self-Led"
            leftColor={colors.firefighters}
            rightColor={colors.self}
            value={data?.spectrumEarned?.blendedSelfLed ? (data?.blendedSelfLedScore ?? null) : null}
            caption="When parts activate, are you it — or with it? A relational shift."
          />
          <View style={{ height: spacing.md }} />
          <SpectrumBar
            leftLabel="Fragmented"
            rightLabel="Flowing"
            leftColor={colors.firefighters}
            rightColor={colors.self}
            value={data?.spectrumEarned?.fragmented ? (data?.fragmentedScore ?? null) : null}
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

  // Usage strip — collapses StatCards' 32pt bottom gap to 8pt so the strip
  // reads as part of the stats block, then re-opens the 32pt before "Your map".
  usageStrip: {
    marginTop: -(spacing.xl - spacing.sm),
    marginBottom: spacing.xl,
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

  // Empty + error state styling
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centeredScroll: { flexGrow: 1, justifyContent: 'center' },
  emptyText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'center',
    letterSpacing: 0.3,
    opacity: 0.85,
  },
  retryBtn: {
    marginTop: 18,
    paddingHorizontal: 22, paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(230,180,122,0.45)',
  },
  retryText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
  },
});
