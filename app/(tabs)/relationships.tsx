// Relationships tab — Phase 4 state machine.
//
// Five rendered states, derived from /api/relationships:
//
//   loading                  → fetching the user's relationships
//   none                     → no relationships → invite-or-paste UI
//                              (NoRelationshipView)
//   pending-no-partner       → user is the inviter, partner hasn't
//                              accepted yet → show 6-char code big +
//                              text-only share affordance
//   pending-intros           → both partners bound, one or both still
//                              haven't completed the intro → waiting
//                              state with a "Read the intro" CTA
//                              when the calling user is the one we're
//                              waiting on
//   active                   → both intros done → three sub-views
//                              (chat / shared / map)
//
// PR B: the pre-pairing informational carousel was removed entirely.
// The first Partner-tab visit now goes straight to NoRelationshipView,
// which has its own brief lede setting expectations for the upcoming
// consent moment. The floating ℹ button still re-opens the consent
// content, but now in review mode of the new ConsentDocument single
// scrollable page (not the prior 6-slide carousel).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Share,
  Alert,
  Platform,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { RelationshipChat } from '../../components/relationships/RelationshipChat';
import { SharedFeed } from '../../components/relationships/SharedFeed';
import { RelationshipMap } from '../../components/relationships/RelationshipMap';
import { ConsentDocument } from '../../components/relationships/ConsentDocument';

// Safe alphabet for the 6-char invite codes (PR B). Mirrors the server
// constant in prompts/relationships logic (server.js INVITE_CODE_ALPHABET).
// Used by the paste-code TextInput to filter out characters the server
// would reject anyway, so users don't see "invalid-code-format" errors
// from typos that could be silently corrected at input time.
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 6;
function sanitizeInviteInput(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => INVITE_CODE_ALPHABET.indexOf(c) !== -1)
    .join('')
    .slice(0, INVITE_CODE_LENGTH);
}

// One row of /api/relationships, mirrored from the api.ts wrapper. Kept
// inline rather than imported so the screen is self-documenting on the
// shape it expects.
type Relationship = {
  id: string;
  inviterUserId: string;
  inviteeUserId: string | null;
  inviteCode: string | null;
  // PR B: invite expiry timestamp. Set on pending rows where the
  // invite hasn't been consumed yet; null on accepted relationships
  // and on pre-PR-B rows. The pending-no-partner screen can show
  // "expires in N days" copy if it wants to use this.
  inviteExpiresAt?: string | null;
  inviteUsedAt?: string | null;
  status: 'pending' | 'active' | 'paused';
  inviterAcceptedIntro: number;
  inviteeAcceptedIntro: number;
  myRole: 'inviter' | 'invitee';
  partnerId: string | null;
  partnerName: string | null;
  myIntroDone: boolean;
  partnerIntroDone: boolean;
  // Partner-departure (PR 2b). Set when the OTHER partner deleted
  // their account. Native renders a one-time modal asking whether to
  // keep the relationship (read-only) or close it.
  partnerDeparted?: 0 | 1;
  departedAt?: string | null;
  partnerNoticeShown?: 0 | 1;
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'pending-no-partner'; rel: Relationship }
  | { kind: 'pending-intros'; rel: Relationship }
  | { kind: 'active'; rel: Relationship };

function classify(rels: Relationship[]): Phase {
  if (!rels || rels.length === 0) return { kind: 'none' };
  // v1: at most one active relationship per user, but PENDING rows can
  // stack. Prefer the active one; otherwise show the most recent
  // pending row.
  const active = rels.find((r) => r.status === 'active');
  if (active) return { kind: 'active', rel: active };
  const pending = rels.find((r) => r.status === 'pending');
  if (!pending) return { kind: 'none' };
  if (!pending.inviteeUserId) return { kind: 'pending-no-partner', rel: pending };
  return { kind: 'pending-intros', rel: pending };
}

export default function RelationshipsScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [pasteCode, setPasteCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Review-mode consent re-open — driven by the floating ℹ︎ button
  // in the top-right corner. Lets the user revisit the consent
  // document any time without disturbing whichever sub-state they
  // were on. On dismiss (GOT IT button), state flips back and the
  // underlying screen re-renders unchanged.
  //
  // PR B: this used to open the 6-slide RelationshipIntroCarousel.
  // Now opens the new single-page ConsentDocument component in its
  // 'review' mode.
  const [reviewOpen, setReviewOpen] = useState(false);
  const closeReview = useCallback(() => setReviewOpen(false), []);
  const openReview = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setReviewOpen(true);
  }, []);

  // Navigate to the per-partner intro carousel (Phase 5).
  // /relationships/intro/[id] is a route file under app/, so a normal
  // expo-router push routes there. The intro screen calls
  // acceptRelationshipIntro on accept and replaces back here, where
  // the state machine refreshes into pending-intros (waiting on the
  // other partner) or active.
  const onReadIntro = useCallback((relationshipId: string) => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/relationships/intro/${encodeURIComponent(relationshipId)}` as any);
  }, [router]);

  const refresh = useCallback(async () => {
    const rels = (await api.listRelationships()) as Relationship[];
    setPhase(classify(rels));
  }, []);

  // Initial load.
  useEffect(() => {
    refresh().catch((e) => {
      console.warn('[relationships] load failed:', (e as Error)?.message);
      setPhase({ kind: 'none' });
    });
  }, [refresh]);

  // (PR B removed the deep-link resume effect entirely. Pre-PR-B,
  // tapping a partner invite URL stashed the code in AsyncStorage
  // under PENDING_INVITE_CODE_KEY and this effect picked it up after
  // onboarding. The code-only sharing flow has no deep links, so
  // there's nothing to resume — the user types the code into the
  // paste field instead. Any stale staged code from a pre-PR-B
  // install is cleaned up by a one-shot effect in app/_layout.tsx
  // or simply ignored: the key is no longer read by anyone.)

  // ---- Action handlers ----

  const onCreateInvite = useCallback(async () => {
    setBusy(true);
    Haptics.selectionAsync().catch(() => {});
    const result = await api.createRelationshipInvite();
    setBusy(false);
    if ('error' in result) {
      const msg = result.error === 'already-in-relationship'
        ? "You already have an active relationship in Inner Map."
        : "Couldn't create an invite right now. Try again in a moment.";
      Alert.alert('Could not create invite', msg);
      return;
    }
    await refresh();
  }, [refresh]);

  const onPasteAccept = useCallback(async () => {
    // Sanitizer already enforces safe alphabet + 6-char cap on input,
    // but trim() guards against trailing whitespace from paste.
    const code = sanitizeInviteInput(pasteCode);
    if (code.length !== INVITE_CODE_LENGTH) {
      Alert.alert(
        "Hmm, that didn't work",
        `Codes are exactly ${INVITE_CODE_LENGTH} characters. Double-check the code your partner sent.`,
      );
      return;
    }
    setBusy(true);
    Haptics.selectionAsync().catch(() => {});
    const result = await api.acceptRelationshipInvite(code);
    setBusy(false);
    if ('error' in result) {
      // PR B added explicit invite-expired and invalid-code-format
      // states; the older invite-not-found / invite-already-claimed
      // / cannot-accept-own-invite / already-in-relationship are
      // preserved. rate-limit-exceeded is mapped explicitly so the
      // user sees the actionable message rather than a generic one.
      const msg = (
        result.error === 'invite-not-found'         ? "No invite matches that code. Double-check and try again." :
        result.error === 'invite-expired'           ? "That code has expired. Ask your partner to generate a new one." :
        result.error === 'invite-already-used'      ? "That code has already been used. Ask your partner for a new one." :
        result.error === 'invite-already-claimed'   ? "This invite has already been accepted by someone else." :
        result.error === 'cannot-accept-own-invite' ? "That's your own code — share it with your partner instead." :
        result.error === 'invalid-code-format'      ? `Codes are exactly ${INVITE_CODE_LENGTH} characters from the safe alphabet (no O/0/I/1/L).` :
        result.error === 'already-in-relationship'  ? "You already have an active relationship." :
        result.error === 'rate-limit-exceeded'      ? (result.message || "Too many invalid codes. Please double-check and try again later.") :
        "Couldn't accept that code. Try again."
      );
      Alert.alert("Hmm, that didn't work", msg);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setPasteCode('');
    await refresh();
  }, [pasteCode, refresh]);

  // PR B: code-only sharing. Plain-text message with the code
  // embedded — no URL, no deep link. Recipient pastes the code into
  // their own Partner-tab paste field. No `url` argument to Share.share
  // (which would attach a clickable link on iOS); the message body
  // is the entire payload.
  const onShareCode = useCallback(async (code: string) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      await Share.share({
        message:
          "Let's explore our relationship on Inner Map. Download the app, then enter this code: " + code,
      });
    } catch (e) {
      console.warn('[relationships] share failed:', (e as Error)?.message);
    }
  }, []);

  // ---- Render branches ----

  // PR B: the pre-pairing informational carousel is gone. The first
  // Partner-tab visit goes straight to NoRelationshipView, which
  // carries its own brief lede setting expectations for the consent
  // moment that follows pairing.

  // Review-mode short-circuit — the floating ℹ button below opens
  // the consent document any time. While the document is open we
  // replace the entire tab content; the GOT IT button calls
  // closeReview() which flips back to whatever sub-state was
  // underneath.
  if (reviewOpen) {
    return (
      <SafeAreaView style={styles.root} edges={[]}>
        <ConsentDocument
          mode="review"
          onDismiss={closeReview}
          showBackButton
          onBack={closeReview}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* Floating ℹ — opens the consent document in review mode from
          anywhere on the Partner tab (connect screen, pending states,
          all three active sub-views). Absolute-positioned so it stays
          in the same screen-corner regardless of which sub-state is
          currently rendered below. */}
      <Pressable
        onPress={openReview}
        hitSlop={10}
        style={styles.infoBtn}
        accessibilityLabel="About this space"
      >
        <Ionicons name="information-circle-outline" size={22} color={colors.amber} />
      </Pressable>
      {phase.kind === 'loading' ? (
        <CenteredLoader />
      ) : phase.kind === 'none' ? (
        <NoRelationshipView
          busy={busy}
          pasteCode={pasteCode}
          onPasteCodeChange={(s) => setPasteCode(sanitizeInviteInput(s))}
          onCreateInvite={onCreateInvite}
          onPasteAccept={onPasteAccept}
        />
      ) : phase.kind === 'pending-no-partner' ? (
        <PendingNoPartnerView
          rel={phase.rel}
          onShareCode={onShareCode}
          onRefresh={refresh}
        />
      ) : phase.kind === 'pending-intros' ? (
        <PendingIntrosView rel={phase.rel} onRefresh={refresh} onReadIntro={onReadIntro} />
      ) : (
        <ActiveView rel={phase.rel} />
      )}

      {/* Partner-departure one-time notice. Fires when ANY relationship
          in the user's list has partnerDeparted=1 + partnerNoticeShown=0.
          The modal action either acknowledges-and-keeps (read-only
          relationship) or fully leaves. Mounting is always-on so the
          modal can appear in any sub-state (none / pending / active). */}
      <PartnerDepartureNoticeModal onChange={refresh} />
    </SafeAreaView>
  );
}

// =============================================================================
// PartnerDepartureNoticeModal — one-time modal shown to the remaining
// partner after the other partner deletes their account. Driven by
// /api/relationships' partnerDeparted + partnerNoticeShown columns.
//
// Polls listRelationships on mount; if any returned row has
// partnerDeparted=1 && partnerNoticeShown=0, renders the modal.
// "Keep" → POST dismiss-departure-notice (sets shown=1).
// "Close" → POST leave (this user departs too → server-side cascade).
// =============================================================================
function PartnerDepartureNoticeModal({ onChange }: { onChange: () => void }) {
  const [pending, setPending] = useState<Relationship | null>(null);
  const [busy, setBusy] = useState<'idle' | 'keeping' | 'closing'>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rels = (await api.listRelationships()) as Relationship[];
        if (cancelled) return;
        const stale = rels.find(
          (r) => r.partnerDeparted === 1 && r.partnerNoticeShown === 0,
        );
        if (stale) setPending(stale);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  if (!pending) return null;

  async function keep() {
    if (busy !== 'idle' || !pending) return;
    setBusy('keeping');
    Haptics.selectionAsync().catch(() => {});
    const result = await api.dismissPartnerDepartureNotice(pending.id);
    setBusy('idle');
    if (!result.ok) {
      Alert.alert("Couldn't update", result.error || 'Try again.');
      return;
    }
    setPending(null);
    onChange();
  }

  async function close() {
    if (busy !== 'idle' || !pending) return;
    setBusy('closing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const result = await api.leaveRelationship(pending.id);
    setBusy('idle');
    if (!result.ok) {
      Alert.alert("Couldn't close", result.error || 'Try again.');
      return;
    }
    setPending(null);
    onChange();
  }

  const partnerName = pending.partnerName || 'Your partner';
  const dateStr = (() => {
    if (!pending.departedAt) return '';
    try { return new Date(pending.departedAt).toLocaleDateString(); }
    catch { return ''; }
  })();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={keep}>
      <View style={styles.departureBackdrop}>
        <View style={styles.departureCard}>
          <Text style={styles.departureTitle}>
            {partnerName} left Inner Map
          </Text>
          <Text style={styles.departureBody}>
            {partnerName} deleted their account{dateStr ? ` on ${dateStr}` : ''}.
            The shared work you did together is preserved here. You can
            continue to view it, or close this relationship from your side.
          </Text>
          <Pressable
            onPress={keep}
            disabled={busy !== 'idle'}
            style={[styles.departurePrimary, busy === 'keeping' && styles.departureBtnDim]}
          >
            {busy === 'keeping' ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.departurePrimaryText}>KEEP RELATIONSHIP (READ-ONLY)</Text>
            )}
          </Pressable>
          <Pressable
            onPress={close}
            disabled={busy !== 'idle'}
            style={[styles.departureSecondary, busy === 'closing' && styles.departureBtnDim]}
          >
            {busy === 'closing' ? (
              <ActivityIndicator color={colors.amber} />
            ) : (
              <Text style={styles.departureSecondaryText}>CLOSE RELATIONSHIP</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// =============================================================================
// Branch components — kept inline so the state machine reads as a single file.
// =============================================================================

function CenteredLoader() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.amber} />
    </View>
  );
}

function NoRelationshipView({
  busy, pasteCode, onPasteCodeChange, onCreateInvite, onPasteAccept,
}: {
  busy: boolean;
  pasteCode: string;
  onPasteCodeChange: (s: string) => void;
  onCreateInvite: () => void;
  onPasteAccept: () => void;
}) {
  const canPaste = pasteCode.length === INVITE_CODE_LENGTH && !busy;
  // The paste-code field sits near the bottom of the scroll list; on
  // smaller iPhones the soft keyboard can sit over the input + the
  // CONNECT button. KeyboardAvoidingView lifts the form above the
  // keyboard — same pattern the main chat tab uses, but without a
  // sticky-header offset because this screen has none above it (the
  // tab bar lives in the parent and isn't pushed when the keyboard
  // opens).
  return (
    <KeyboardAvoidingView
      style={styles.kav}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h1}>Connect with your partner</Text>
      {/* PR B: lede now sets expectations for the consent moment that
          lands after pairing. The earlier lede ended at the
          private-vs-shared framing; the new closing sentence flags
          that "a short consent" is coming before the shared space
          opens, so the consent screen doesn't feel like an
          interruption when it arrives. */}
      <Text style={styles.lede}>
        Inner Map can hold a private space for the two of you. You'll each have your own
        chat, and what you both choose to share appears in a shared view. After you're
        connected, you'll each review a short consent before the shared space opens.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Send an invite</Text>
        <Text style={styles.cardBody}>
          Generate a code to share with your partner. Send it to them in a text or
          message — when they enter it in their app, you'll be paired.
        </Text>
        <Pressable
          onPress={onCreateInvite}
          style={[styles.btnPrimary, busy && styles.btnDim]}
          disabled={busy}
          accessibilityLabel="Generate code"
        >
          {busy ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.btnPrimaryText}>GENERATE CODE</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.divider}>— or —</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Have a code from your partner?</Text>
        <Text style={styles.cardBody}>
          Enter the 6-character code your partner sent you.
        </Text>
        <TextInput
          value={pasteCode}
          // Sanitizer in the parent enforces uppercase + safe alphabet
          // + 6-char cap on every keystroke. The onChangeText callback
          // receives raw user input (paste / IME insertion / typed)
          // and the parent runs it through sanitizeInviteInput before
          // re-rendering this with the new value.
          onChangeText={onPasteCodeChange}
          placeholder="A7B9XK"
          placeholderTextColor={colors.creamFaint}
          style={styles.codeInput}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={INVITE_CODE_LENGTH}
          editable={!busy}
          // Belt-and-braces — keyboard hint for numeric+letter ranges
          // is platform-dependent; ascii-capable is the closest
          // universal hint to "uppercase letters + digits, no
          // punctuation or accents". Sanitizer still strips anything
          // outside the safe alphabet.
          keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'default'}
        />
        <Pressable
          onPress={onPasteAccept}
          style={[styles.btnSecondary, !canPaste && styles.btnDim]}
          disabled={!canPaste}
          accessibilityLabel="Accept invite code"
        >
          <Text style={styles.btnSecondaryText}>CONNECT</Text>
        </Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PendingNoPartnerView({
  rel, onShareCode, onRefresh,
}: {
  rel: Relationship;
  onShareCode: (code: string) => void;
  onRefresh: () => void;
}) {
  // PR B: the row used to carry both a `link` field and `inviteCode`;
  // the link is gone, the code is the entire payload. Code is rendered
  // large + tappable; a long-press on the displayed code copies via
  // the OS selection menu without needing expo-clipboard.
  const code = rel.inviteCode || '';
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.h1}>Waiting for your partner</Text>
      <Text style={styles.lede}>
        Send them this code. Once they enter it in their app, you'll be paired.
      </Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your invite code</Text>
        <View style={styles.codeBigBox}>
          {/* selectable Text — long-press shows the OS copy menu on
              iOS / Android without requiring expo-clipboard as a dep.
              numberOfLines=1 because a 6-char code with letter-
              spacing easily fits one line, and we don't want it to
              wrap mid-code. */}
          <Text style={styles.codeBigText} selectable numberOfLines={1}>
            {code}
          </Text>
        </View>
        <Pressable
          onPress={() => onShareCode(code)}
          style={styles.btnPrimary}
          accessibilityLabel="Share code"
        >
          <Ionicons name="share-outline" size={16} color={colors.background} style={{ marginRight: 8 }} />
          <Text style={styles.btnPrimaryText}>SHARE CODE</Text>
        </Pressable>
      </View>
      <Pressable onPress={onRefresh} style={styles.refreshRow} accessibilityLabel="Refresh">
        <Ionicons name="refresh" size={14} color={colors.creamFaint} />
        <Text style={styles.refreshText}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}

function PendingIntrosView({
  rel, onRefresh, onReadIntro,
}: {
  rel: Relationship;
  onRefresh: () => void;
  onReadIntro: (relationshipId: string) => void;
}) {
  const partner = rel.partnerName || 'Your partner';
  const waitingOnMe = !rel.myIntroDone;
  const waitingOnThem = rel.myIntroDone && !rel.partnerIntroDone;
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.h1}>Almost there</Text>
      <Text style={styles.lede}>
        You and {partner} are paired. Both of you need to read a short intro before the
        shared space opens.
      </Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <View style={styles.statusRow}>
          <Ionicons
            name={rel.myIntroDone ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={rel.myIntroDone ? colors.amber : colors.creamFaint}
          />
          <Text style={[styles.statusText, rel.myIntroDone && styles.statusTextDone]}>
            You've read the intro
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Ionicons
            name={rel.partnerIntroDone ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={rel.partnerIntroDone ? colors.amber : colors.creamFaint}
          />
          <Text style={[styles.statusText, rel.partnerIntroDone && styles.statusTextDone]}>
            {partner} has read the intro
          </Text>
        </View>
        {waitingOnMe ? (
          <Pressable
            onPress={() => onReadIntro(rel.id)}
            style={[styles.btnPrimary, { marginTop: spacing.lg }]}
            accessibilityLabel="Read the intro"
          >
            <Text style={styles.btnPrimaryText}>READ THE INTRO</Text>
          </Pressable>
        ) : null}
        {waitingOnThem ? (
          <Text style={[styles.cardBody, { marginTop: spacing.md, fontStyle: 'italic' }]}>
            Waiting for {partner} to finish their intro.
          </Text>
        ) : null}
      </View>
      <Pressable onPress={onRefresh} style={styles.refreshRow} accessibilityLabel="Refresh">
        <Ionicons name="refresh" size={14} color={colors.creamFaint} />
        <Text style={styles.refreshText}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}

// =============================================================================
// ACTIVE — three sub-views (chat / shared / map). Chat + Shared are
// fully implemented in this commit; Map remains a stub here and lands
// in Phase 6 commit 2 with the two-triangle visual.
//
// Shared → Chat hand-off: when the user taps a prompt chip on a shared
// item, the chat sub-view receives a prefill string. ActiveView holds
// that prefill in local state and clears it the moment the chat view
// has consumed it (via onPrefillConsumed) so a second chip tap
// delivers a fresh prefill.
// =============================================================================
type SubView = 'chat' | 'shared' | 'map';

function ActiveView({ rel }: { rel: Relationship }) {
  const [view, setView] = useState<SubView>('chat');
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);

  const onPromptChip = useCallback((prefill: string) => {
    setChatPrefill(prefill);
    setView('chat');
  }, []);

  return (
    <View style={styles.activeRoot}>
      <View style={styles.segments}>
        {(['chat', 'shared', 'map'] as SubView[]).map((v) => (
          <Pressable
            key={v}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setView(v);
            }}
            style={[styles.segment, view === v && styles.segmentActive]}
            accessibilityLabel={`Switch to ${v}`}
          >
            <Text style={[styles.segmentText, view === v && styles.segmentTextActive]}>
              {v.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* Both Chat and Shared mount continuously and just hide via
          display:'none' — keeps their state intact (chat scroll
          position, shared feed cache) when the user toggles between
          them. The Map sub-view is a placeholder until Phase 6
          commit 2. */}
      <View style={[styles.subViewRoot, view !== 'chat' && styles.subViewHidden]}>
        <RelationshipChat
          relationshipId={rel.id}
          partnerName={rel.partnerName}
          prefill={chatPrefill}
          onPrefillConsumed={() => setChatPrefill(null)}
        />
      </View>
      <View style={[styles.subViewRoot, view !== 'shared' && styles.subViewHidden]}>
        <SharedFeed
          relationshipId={rel.id}
          partnerName={rel.partnerName}
          onPromptChip={onPromptChip}
        />
      </View>
      <View style={[styles.subViewRoot, view !== 'map' && styles.subViewHidden]}>
        <RelationshipMap
          relationshipId={rel.id}
          partnerName={rel.partnerName}
        />
      </View>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  // KAV wrapper for the connect screen. flex:1 so the inner ScrollView
  // still fills the available area; behavior is set per-platform on
  // the component itself (padding on iOS, height on Android).
  kav: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Floating info button — top-right of the Partner tab content.
  // Sits in the empty space at the right edge of the segments row
  // (active state) or in the top-right corner above the scroll
  // content (connect / pending states). zIndex keeps it above the
  // tab content; the 4px padding gives the icon a comfortable touch
  // target while hitSlop=10 expands the actual hit zone further.
  infoBtn: {
    position: 'absolute',
    top: 6,
    right: 10,
    zIndex: 10,
    padding: 4,
  },

  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  h1: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 28,
    letterSpacing: 0.3,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  lede: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: 'rgba(28,25,21,0.6)',
    borderColor: 'rgba(230,180,122,0.18)',
    borderWidth: 0.5,
    borderRadius: 14,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  cardBody: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  divider: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  btnPrimary: {
    backgroundColor: colors.amber,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 28,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  btnSecondary: {
    borderColor: colors.amber,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 28,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnSecondaryText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  btnDim: { opacity: 0.5 },

  // 6-char invite-code TextInput. Larger font + heavier letter
  // spacing than the previous 8-char input — the field has less
  // content to fill and we want it to read at a glance. Centered
  // text since the field's value is just the code itself, no
  // surrounding language.
  codeInput: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 22,
    letterSpacing: 6,
    textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.2)',
    marginBottom: spacing.md,
  },
  // (Legacy codeBox / codeBoxText / codeHint / codeStrong styles
  // removed in PR B — they belonged to the previous URL-display
  // version of the waiting screen. PR B renders the code itself big
  // via codeBigBox / codeBigText below.)

  // PR B: large-format display of the 6-char invite code on the
  // pending-no-partner screen. Heavy letter-spacing + amber color +
  // bold weight make the code the dominant visual element on the
  // screen, since the user's main action is reading + sharing it.
  codeBigBox: {
    backgroundColor: 'rgba(230,180,122,0.04)',
    borderRadius: 12,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.35)',
    alignItems: 'center',
  },
  codeBigText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 34,
    letterSpacing: 8,
    textAlign: 'center',
    // Leading whitespace on the right balances the letter-spacing
    // visually — without it the last character looks shifted left.
    paddingLeft: 8,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statusText: {
    marginLeft: spacing.sm,
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 14,
  },
  statusTextDone: { color: colors.cream },

  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: 6,
  },
  refreshText: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.5,
  },

  // Active state — Phase 6 territory; light segmented control + a stub body.
  activeRoot: { flex: 1 },
  // Segments row leaves extra right-side padding so the absolute-
  // positioned ℹ︎ button doesn't visually overlap (or steal taps
  // from) the rightmost MAP segment.
  segments: {
    flexDirection: 'row',
    paddingLeft: spacing.lg,
    paddingRight: 36,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomColor: 'rgba(230,180,122,0.1)',
    borderBottomWidth: 0.5,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.2)',
  },
  segmentActive: {
    borderColor: colors.amber,
    backgroundColor: 'rgba(230,180,122,0.08)',
  },
  segmentText: {
    color: colors.creamFaint,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  segmentTextActive: { color: colors.amber },
  // subViewRoot — fills the remaining tab area beneath the segmented
  // control. flex:1 + display='none' on the inactive view keeps both
  // chat + shared continuously mounted (state preserved) without
  // re-creating their tree on every toggle.
  subViewRoot: { flex: 1 },
  subViewHidden: { display: 'none' },
  stubBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  stubHeadline: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  stubSub: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  stubMeta: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 1,
  },

  // Partner-departure modal — fires once when the OTHER partner has
  // deleted their account. Centered card with two buttons.
  departureBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  departureCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#14131A',
    borderColor: 'rgba(230,180,122,0.45)',
    borderWidth: 0.5,
    borderRadius: 16,
    padding: spacing.lg,
  },
  departureTitle: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    lineHeight: 28,
    marginBottom: spacing.md,
  },
  departureBody: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  departurePrimary: {
    backgroundColor: colors.amber,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  departurePrimaryText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  departureSecondary: {
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.45)',
    alignItems: 'center',
  },
  departureSecondaryText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  departureBtnDim: { opacity: 0.6 },
});
