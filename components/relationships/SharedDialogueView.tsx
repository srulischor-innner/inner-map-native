// Shared-space dialogue view — PR C replacement for the old
// SharedFeed (proposal-voting feed). Mounted by the Partner tab's
// ActiveView when the user is on the SHARED sub-view.
//
// Behavior:
//   - Polls GET /api/relationships/:id/shared/messages on mount,
//     on tab focus, and every 15s while focused. Cached locally
//     so a brief network blip doesn't blank the surface.
//   - Renders one SharedMessageCard per row, oldest → newest.
//   - Below the list: <PartnerContributionInput> for ad-hoc shares.
//   - Empty state when the thread is empty: a one-paragraph
//     explainer about how content gets here.
//   - Pull-to-refresh.
//
// Privacy: every message in the thread is visible to both partners
// once it lands here. The shared-space AI is bound by its own prompt
// to never quote private-chat content; the server enforces the
// no-leak rule at the prompt layer.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { colors, fonts, spacing } from '../../constants/theme';
import { api, SharedMessage } from '../../services/api';
import { getUserId } from '../../services/user';
import { SharedMessageCard } from './SharedMessageCard';
import { PartnerContributionInput } from './PartnerContributionInput';
import { RelationshipMapPinned } from './RelationshipMap';
import {
  refreshPartnerSharedSeenStatus,
  subscribePartnerSharedSeen,
  type PartnerSharedSeenStatus,
} from '../../services/partnerSharedSeen';

const POLL_MS = 15 * 1000;

// Format the cooldown's "until" timestamp as a human-friendly
// remaining-time. Used inside the frozen-state banner. Returns
// "less than a minute" for sub-60s windows, "X minutes" otherwise.
function formatRemainingUntil(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'a moment ago';
  const mins = Math.ceil(diffMs / 60_000);
  if (mins <= 1) return 'less than a minute';
  if (mins < 60) return `${mins} minutes`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return `${hrs}h`;
  return `${hrs}h ${rem}m`;
}

export function SharedDialogueView({
  relationshipId,
  partnerName,
}: {
  relationshipId: string;
  partnerName: string | null;
}) {
  const [myUserId, setMyUserId] = useState<string>('');
  const [myAuthor, setMyAuthor] = useState<'partner_a' | 'partner_b' | null>(null);
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // PR 2 — off-purpose cooldown state. When frozenUntil > now, the
  // compose row is disabled and a "paused" banner replaces it.
  const [frozenUntil, setFrozenUntil] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Subscribe to the shared partnerSharedSeen service for freeze
  // updates. The service polls /shared/unread-status on the same
  // cadence as the Partner-tab dot, so SharedDialogueView gets the
  // freeze state without an extra round-trip from this component.
  useEffect(() => {
    const unsub = subscribePartnerSharedSeen((s: PartnerSharedSeenStatus) => {
      if (s.relationshipId !== relationshipId) return;
      const live = !!s.frozenUntil && new Date(s.frozenUntil).getTime() > Date.now();
      setFrozenUntil(live ? s.frozenUntil : null);
    });
    refreshPartnerSharedSeenStatus(relationshipId).catch(() => {});
    return unsub;
  }, [relationshipId]);

  // Resolve the calling user's id on mount — needed by
  // SharedMessageCard to figure out which response is "yours" vs
  // "your partner's".
  useEffect(() => {
    getUserId().then(setMyUserId).catch(() => {});
  }, []);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setRefreshing(true);
    try {
      const result = await api.getSharedMessages(relationshipId);
      if (result) {
        setMessages(result.messages);
        setMyAuthor(result.meta.myAuthor);
      }
    } finally {
      if (!opts?.silent) setRefreshing(false);
      setLoading(false);
    }
  }, [relationshipId]);

  // Mount + tab-focus refresh.
  useFocusEffect(
    useCallback(() => {
      refresh({ silent: true });
      // Start polling on every focus; stop on blur.
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(() => {
        refresh({ silent: true });
      }, POLL_MS);
      return () => {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    }, [refresh]),
  );

  // Auto-scroll to bottom whenever a new message lands (the thread
  // is oldest-first; the freshest content is at the bottom).
  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [messages.length]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.amber} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refresh()}
            tintColor={colors.amber}
          />
        }
      >
        {/* Pinned compact two-triangle map at the top — same as the
            old SharedFeed pinned variant. Gives at-a-glance context
            for the relationship's structural state while the user
            reads the dialogue thread below. */}
        <RelationshipMapPinned
          relationshipId={relationshipId}
          partnerName={partnerName}
        />

        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              As you and {partnerName || 'your partner'} share moments from your
              private chats, the AI will help you explore them together here.
              You can also share directly using the button below.
            </Text>
          </View>
        ) : (
          messages.map((m) => (
            <SharedMessageCard
              key={m.id}
              message={m}
              relationshipId={relationshipId}
              myUserId={myUserId}
              myAuthor={myAuthor || 'partner_a'}
              partnerName={partnerName}
              onResponded={() => refresh({ silent: true })}
            />
          ))
        )}
      </ScrollView>

      {frozenUntil ? (
        // PR 2 — off-purpose cooldown banner. Replaces the compose row
        // while the freeze is active. Reading the thread above stays
        // fully available; only sending is paused. The copy is
        // intentionally non-blaming — the AI redirect did the framing
        // already; this is just the surface telling the user when
        // they can resume.
        <View style={styles.frozenBanner}>
          <Text style={styles.frozenTitle}>This space is paused</Text>
          <Text style={styles.frozenBody}>
            Take a short break — back in {formatRemainingUntil(frozenUntil)}.
            You can still read the thread above.
          </Text>
        </View>
      ) : (
        <PartnerContributionInput
          relationshipId={relationshipId}
          partnerName={partnerName}
          onContributed={() => refresh({ silent: true })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  emptyState: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 20,
    letterSpacing: 0.3,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 380,
  },
  // PR 2 — frozen-state compose-row replacement. Same vertical
  // footprint as PartnerContributionInput so the layout doesn't jump
  // when the cooldown lands or releases. Border-top matches the
  // border the compose row uses to separate from the thread.
  frozenBanner: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  frozenTitle: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  frozenBody: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 360,
  },
});
