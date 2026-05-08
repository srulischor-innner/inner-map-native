// Shared feed sub-view.
//
// Top of the feed: any pending proposals awaiting the calling user's
// approval — whether scope='this-partner' (this user is the source)
// or scope='both-partners' (could be from either chat). Each proposal
// renders as a card with Approve / Reject buttons. Approving runs
// the server-side promotion if the scope's threshold is met; the
// returned `promoted` flag tells us whether the proposal jumped to a
// shared item or is still waiting on the other partner.
//
// Below pending proposals: the published shared-tab feed —
// chronological-newest-first list of approved insights, each carrying
// its own reactions, comments, and three prompt-chip shortcuts that
// open the partner's private chat with a prefilled question.
//
// All state is local to this component. Every approve/reject/react/
// comment refreshes the feed via api.listRelationshipShared, which
// the parent state-machine doesn't know about — the Shared and Chat
// sub-views share only the prefill hand-off.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { RelationshipMapPinned } from './RelationshipMap';

const COMMENT_CAP = 500;

type Reaction = { id: string; userId: string; reaction: string; createdAt: string; side: 'inviter' | 'invitee' };
type Comment  = { id: string; userId: string; content: string; createdAt: string; side: 'inviter' | 'invitee' };

type SharedItem = {
  id: string; type: string; content: string; publishedAt: string;
  reactions: Reaction[]; comments: Comment[];
};

type Proposal = {
  id: string; type: string; content: string;
  scope: 'this-partner' | 'both-partners';
  sourceSide: 'inviter' | 'invitee';
  youAreSource: boolean;
  createdAt: string;
};

type FeedData = {
  sharedItems: SharedItem[];
  myPendingProposals: Proposal[];
  meta: { mySide: 'inviter' | 'invitee' };
};

const REACTION_OPTIONS: Array<{ key: 'resonates' | 'unsure' | 'doesnt-fit'; label: string }> = [
  { key: 'resonates', label: 'This resonates' },
  { key: 'unsure', label: 'Not sure' },
  { key: 'doesnt-fit', label: "Doesn't fit" },
];

const PROMPT_CHIPS: Array<{ label: string; build: (item: SharedItem) => string }> = [
  { label: 'Tell me more', build: (item) => `Tell me more about this: "${item.content}"` },
  { label: 'How does this connect to us?', build: (item) => `How does this connect to us? Re: "${item.content}"` },
  { label: 'I want to explore this', build: (item) => `I want to explore this with you: "${item.content}"` },
];

export function SharedFeed({
  relationshipId,
  partnerName,
  onPromptChip,
}: {
  relationshipId: string;
  partnerName: string | null;
  /** Fired when the user taps one of the three prompt chips on a
   *  shared item. The parent flips the segmented control to chat
   *  and seeds the chat input with the prefilled prompt. */
  onPromptChip: (prefill: string) => void;
}) {
  const [data, setData] = useState<FeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const next = await api.listRelationshipShared(relationshipId);
    if (next) setData(next);
    setRefreshing(false);
    setLoading(false);
  }, [relationshipId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Approval / rejection — both refresh the feed afterward so
  // promotion-to-shared or removal-from-queue lands without a manual
  // pull. Errors surface as user-facing alerts.
  const onApprove = useCallback(async (p: Proposal) => {
    Haptics.selectionAsync().catch(() => {});
    const r = await api.approveRelationshipProposal(relationshipId, p.id);
    if ('error' in r) {
      Alert.alert('Could not approve', r.message || 'Try again in a moment.');
      return;
    }
    if (r.promoted) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    refresh();
  }, [relationshipId, refresh]);

  const onReject = useCallback(async (p: Proposal) => {
    Haptics.selectionAsync().catch(() => {});
    Alert.alert(
      'Reject this insight?',
      'It won\'t appear in the shared space. Your partner won\'t be told you rejected it; the proposal just won\'t promote.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            const r = await api.rejectRelationshipProposal(relationshipId, p.id);
            if ('error' in r) {
              Alert.alert('Could not reject', r.message || 'Try again in a moment.');
              return;
            }
            refresh();
          },
        },
      ],
    );
  }, [relationshipId, refresh]);

  const onReact = useCallback(async (item: SharedItem, key: 'resonates' | 'unsure' | 'doesnt-fit') => {
    Haptics.selectionAsync().catch(() => {});
    // Optimistic local toggle: if the user already has this reaction,
    // remove it; otherwise replace.
    const myUserId = data?.meta?.mySide === 'inviter'
      ? item.reactions.find((r) => r.side === 'inviter')?.userId
      : item.reactions.find((r) => r.side === 'invitee')?.userId;
    const mineExisting = item.reactions.find(
      (r) => (data?.meta?.mySide === r.side),
    );
    const next = mineExisting && mineExisting.reaction === key ? null : key;
    const r = await api.reactToSharedItem(relationshipId, item.id, next);
    if ('error' in r) {
      Alert.alert('Could not save reaction', r.message || 'Try again in a moment.');
      return;
    }
    refresh();
  }, [relationshipId, refresh, data]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.amber} />
      </View>
    );
  }

  const items   = data?.sharedItems   ?? [];
  const pending = data?.myPendingProposals ?? [];
  const mySide  = data?.meta?.mySide ?? 'inviter';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Pinned compact map at the top — same source data as the
            Map sub-view, mounted independently so this component
            doesn't depend on the parent passing it down. The pinned
            variant fetches /api/relationships/:id/map on mount and
            holds a fixed-height placeholder until the response
            lands so the feed below doesn't jump. */}
        <RelationshipMapPinned
          relationshipId={relationshipId}
          partnerName={partnerName}
        />

        {pending.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Awaiting your approval</Text>
            {pending.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                partnerName={partnerName}
                onApprove={() => onApprove(p)}
                onReject={() => onReject(p)}
              />
            ))}
          </View>
        ) : null}

        {items.length === 0 && pending.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              As you and {partnerName || 'your partner'} explore the relationship in your private chats,
              insights you both approve will appear here.
            </Text>
          </View>
        ) : null}

        {items.length > 0 ? (
          <View style={styles.section}>
            {pending.length > 0 ? (
              <Text style={styles.sectionLabel}>Shared insights</Text>
            ) : null}
            {items.map((item) => (
              <SharedItemCard
                key={item.id}
                item={item}
                mySide={mySide}
                partnerName={partnerName}
                relationshipId={relationshipId}
                onReact={(k) => onReact(item, k)}
                onPromptChip={onPromptChip}
                onCommentSent={refresh}
              />
            ))}
          </View>
        ) : null}

        {refreshing ? (
          <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
            <ActivityIndicator color={colors.amber} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// =============================================================================
// One pending proposal card.
// =============================================================================
function ProposalCard({
  proposal, partnerName, onApprove, onReject,
}: {
  proposal: Proposal;
  partnerName: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const sourceLabel = proposal.youAreSource
    ? 'From your private chat'
    : `From ${partnerName || "your partner"}'s private chat`;
  const scopeLabel = proposal.scope === 'both-partners'
    ? `About both of you — both partners need to approve`
    : `About you specifically — your approval brings this into the shared space`;
  return (
    <View style={styles.proposalCard}>
      <Text style={styles.proposalSource}>{sourceLabel}</Text>
      <Text style={styles.proposalContent}>{proposal.content}</Text>
      <Text style={styles.proposalScope}>{scopeLabel}</Text>
      <View style={styles.proposalActions}>
        <Pressable onPress={onApprove} style={styles.approveBtn} accessibilityLabel="Approve">
          <Ionicons name="checkmark" size={18} color={colors.background} style={{ marginRight: 6 }} />
          <Text style={styles.approveBtnText}>APPROVE</Text>
        </Pressable>
        <Pressable onPress={onReject} style={styles.rejectBtn} accessibilityLabel="Reject">
          <Text style={styles.rejectBtnText}>REJECT</Text>
        </Pressable>
      </View>
    </View>
  );
}

// =============================================================================
// One published shared-item card — content, reactions, prompt chips,
// comments, comment composer.
// =============================================================================
function SharedItemCard({
  item, mySide, partnerName, relationshipId, onReact, onPromptChip, onCommentSent,
}: {
  item: SharedItem;
  mySide: 'inviter' | 'invitee';
  partnerName: string | null;
  relationshipId: string;
  onReact: (k: 'resonates' | 'unsure' | 'doesnt-fit') => void;
  onPromptChip: (prefill: string) => void;
  onCommentSent: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const myReaction = item.reactions.find((r) => r.side === mySide)?.reaction || null;
  const partnerReaction = item.reactions.find((r) => r.side !== mySide)?.reaction || null;

  const sendComment = useCallback(async () => {
    const t = draft.trim();
    if (!t || sending) return;
    setSending(true);
    const r = await api.commentOnSharedItem(relationshipId, item.id, t);
    setSending(false);
    if ('error' in r) {
      Alert.alert(
        'Could not save comment',
        r.error === 'comment-too-long' ? 'Comments are capped at 500 characters.' : (r.message || 'Try again.'),
      );
      return;
    }
    setDraft('');
    onCommentSent();
  }, [draft, sending, relationshipId, item.id, onCommentSent]);

  return (
    <View style={styles.itemCard}>
      <Text style={styles.itemType}>{item.type.replace(/-/g, ' ').toUpperCase()}</Text>
      <Text style={styles.itemContent}>{item.content}</Text>

      {/* Reaction row — three options, the user's current selection
          highlighted. Tapping the same key clears it; tapping another
          replaces. Partner's reaction shows as a small italic line
          under the row when present. */}
      <View style={styles.reactionRow}>
        {REACTION_OPTIONS.map((opt) => {
          const active = myReaction === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => onReact(opt.key)}
              style={[styles.reactionBtn, active && styles.reactionBtnActive]}
              accessibilityLabel={opt.label}
            >
              <Text style={[styles.reactionText, active && styles.reactionTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {partnerReaction ? (
        <Text style={styles.partnerReactionLine}>
          {partnerName || 'Your partner'}: {labelForReaction(partnerReaction)}
        </Text>
      ) : null}

      {/* Prompt chips — three shortcuts that hand the prefilled prompt
          back to the parent, which flips the segmented control to chat
          and seeds the input. */}
      <View style={styles.chipRow}>
        {PROMPT_CHIPS.map((chip, i) => (
          <Pressable
            key={i}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onPromptChip(chip.build(item));
            }}
            style={styles.chip}
            accessibilityLabel={chip.label}
          >
            <Text style={styles.chipText}>{chip.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Comments thread — both partners' comments, oldest first. */}
      {item.comments.length > 0 ? (
        <View style={styles.commentsBlock}>
          {item.comments.map((c) => (
            <View key={c.id} style={styles.commentRow}>
              <Text style={styles.commentAuthor}>
                {c.side === mySide ? 'You' : (partnerName || 'Your partner')}
              </Text>
              <Text style={styles.commentContent}>{c.content}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Composer — capped at 500 chars to mirror the server cap.
          Cap is informational; the server enforces it too and a
          400 response surfaces a friendly Alert. */}
      <View style={styles.composerRow}>
        <TextInput
          value={draft}
          onChangeText={(s) => setDraft(s.slice(0, COMMENT_CAP))}
          placeholder="Add a comment…"
          placeholderTextColor={colors.creamFaint}
          style={styles.composerInput}
          editable={!sending}
          multiline
          maxLength={COMMENT_CAP}
          selectionColor={colors.amber}
        />
        <Pressable
          onPress={sendComment}
          disabled={!draft.trim() || sending}
          style={[styles.composerBtn, (!draft.trim() || sending) && styles.composerBtnDim]}
          accessibilityLabel="Post comment"
        >
          {sending ? (
            <ActivityIndicator color={colors.background} size="small" />
          ) : (
            <Ionicons name="arrow-up" size={16} color={colors.background} />
          )}
        </Pressable>
      </View>
      {draft.length > 0 ? (
        <Text style={styles.composerCount}>{draft.length} / {COMMENT_CAP}</Text>
      ) : null}
    </View>
  );
}

function labelForReaction(r: string): string {
  if (r === 'resonates')  return 'this resonates';
  if (r === 'unsure')     return 'not sure';
  if (r === 'doesnt-fit') return "doesn't fit";
  return r;
}

// =============================================================================
// Styles
// =============================================================================
const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.lg },
  sectionLabel: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },

  emptyState: { paddingVertical: spacing.xxl, alignItems: 'center' },
  emptyTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },

  // Pending proposal card
  proposalCard: {
    backgroundColor: 'rgba(28,25,21,0.7)',
    borderColor: colors.amber,
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  proposalSource: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  proposalContent: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  proposalScope: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  proposalActions: { flexDirection: 'row', gap: spacing.sm },
  approveBtn: {
    backgroundColor: colors.amber,
    paddingVertical: 10, paddingHorizontal: spacing.lg,
    borderRadius: 22,
    flexDirection: 'row', alignItems: 'center',
  },
  approveBtnText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  rejectBtn: {
    paddingVertical: 10, paddingHorizontal: spacing.lg,
    borderRadius: 22,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  rejectBtnText: {
    color: colors.creamDim,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.5,
  },

  // Published shared-item card
  itemCard: {
    backgroundColor: 'rgba(28,25,21,0.5)',
    borderColor: 'rgba(230,180,122,0.18)',
    borderWidth: 0.5,
    borderRadius: 14,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  itemType: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  itemContent: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: spacing.md,
  },

  reactionRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  reactionBtn: {
    paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 0.5, borderColor: 'rgba(230,180,122,0.25)',
    backgroundColor: 'transparent',
  },
  reactionBtnActive: {
    backgroundColor: 'rgba(230,180,122,0.15)',
    borderColor: colors.amber,
  },
  reactionText: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  reactionTextActive: { color: colors.amber, fontFamily: fonts.sansBold },
  partnerReactionLine: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 11,
    marginTop: 4,
    marginBottom: spacing.sm,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 0.5, borderColor: 'rgba(230,180,122,0.3)',
    backgroundColor: 'rgba(230,180,122,0.05)',
  },
  chipText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.3,
  },

  commentsBlock: {
    paddingTop: spacing.sm,
    borderTopWidth: 0.5, borderTopColor: 'rgba(230,180,122,0.1)',
    marginBottom: spacing.sm,
  },
  commentRow: { paddingVertical: 6 },
  commentAuthor: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  commentContent: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
  },

  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: spacing.sm,
  },
  composerInput: {
    flex: 1,
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 38,
    maxHeight: 120,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.18)',
  },
  composerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  composerBtnDim: { opacity: 0.4 },
  composerCount: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 10,
    textAlign: 'right',
    marginTop: 4,
  },
});
