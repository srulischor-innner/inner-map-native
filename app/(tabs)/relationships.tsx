// Relationships tab — Phase 4 state machine.
//
// Five rendered states, derived from /api/relationships:
//
//   loading                  → fetching the user's relationships
//   none                     → no relationships → invite-or-paste UI
//   pending-no-partner       → user is the inviter, partner hasn't
//                              accepted yet → show invite link big +
//                              copy/share affordance
//   pending-intros           → both partners bound, one or both still
//                              haven't completed the intro → waiting
//                              state with a "Read the intro" CTA
//                              when the calling user is the one we're
//                              waiting on
//   active                   → both intros done → three sub-view
//                              stubs (chat / shared / map). Phase 5
//                              owns the intro screens; Phase 6 owns
//                              the real sub-view content.
//
// Resume-after-onboarding flow:
//
//   When a user lands here for the first time, the screen also looks
//   for a staged invite code in AsyncStorage under
//   PENDING_INVITE_CODE_KEY (set by app/connect/[code].tsx on a
//   first-launch deep-link tap before onboarding was complete). If
//   found AND the user has no relationship yet, the tab automatically
//   calls acceptRelationshipInvite(code) and clears the key on
//   success. This closes the deep-link → onboarding → tab loop without
//   requiring the user to re-tap the link.

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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { PENDING_INVITE_CODE_KEY } from '../connect/[code]';
import { RelationshipChat } from '../../components/relationships/RelationshipChat';
import { SharedFeed } from '../../components/relationships/SharedFeed';
import { RelationshipMap } from '../../components/relationships/RelationshipMap';
import { RelationshipIntroCarousel } from '../../components/relationships/RelationshipIntroCarousel';

// AsyncStorage flag — flips to '1' the first time the user reaches the
// last slide of the informational intro (tab-level). Subsequent visits
// to the Partner tab skip the carousel and go straight to the connect
// screen / state machine. Per-install, not per-relationship — distinct
// from the per-pairing 'relationships.introSeen:<id>' key used by the
// commitment-mode carousel after pairing.
const TAB_INTRO_SEEN_KEY = 'relationships.tabIntroSeen';

// One row of /api/relationships, mirrored from the api.ts wrapper. Kept
// inline rather than imported so the screen is self-documenting on the
// shape it expects.
type Relationship = {
  id: string;
  inviterUserId: string;
  inviteeUserId: string | null;
  inviteCode: string | null;
  status: 'pending' | 'active' | 'paused';
  inviterAcceptedIntro: number;
  inviteeAcceptedIntro: number;
  link: string | null;
  myRole: 'inviter' | 'invitee';
  partnerId: string | null;
  partnerName: string | null;
  myIntroDone: boolean;
  partnerIntroDone: boolean;
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
  // resumeAttempted prevents the deep-link-resume effect from re-running
  // after the user has already been routed through it once during this
  // mount. Without this, refresh() can trigger a second attempt that
  // hits "invite-already-claimed" instead of the success path.
  const [resumeAttempted, setResumeAttempted] = useState(false);

  // First-time tab-intro gate. Three-state pattern (same as the
  // typewriter gate elsewhere) so the screen holds a blank canvas
  // briefly while AsyncStorage resolves rather than flashing the
  // connect screen and *then* swapping in the carousel.
  //
  //   'unknown' → AsyncStorage read still pending; render loader
  //   'unseen'  → flag absent → render the informational carousel
  //   'seen'    → flag present → fall through to the state machine
  const [tabIntro, setTabIntro] = useState<'unknown' | 'unseen' | 'seen'>('unknown');

  useEffect(() => {
    AsyncStorage.getItem(TAB_INTRO_SEEN_KEY)
      .then((v) => setTabIntro(v ? 'seen' : 'unseen'))
      .catch(() => setTabIntro('seen'));
  }, []);

  // GET STARTED handler — last-slide button in the informational
  // carousel. Flip the flag, advance to the state machine. The
  // carousel also stamps the same key internally on its own
  // last-slide-reached effect, but we set it here too so the parent
  // state stays in lockstep with what's on disk.
  const onTabIntroDone = useCallback(async () => {
    try { await AsyncStorage.setItem(TAB_INTRO_SEEN_KEY, '1'); } catch {}
    setTabIntro('seen');
  }, []);

  // Review-mode intro re-open — driven by the floating ℹ︎ button
  // rendered in the top-right of the screen. Lets the user revisit
  // the six framing slides at any time without disturbing whichever
  // sub-state (connect / pending / active) they were on. On dismiss
  // (last-slide GOT IT or back chevron), state flips back and the
  // underlying screen re-renders unchanged.
  const [reviewIntroOpen, setReviewIntroOpen] = useState(false);
  const closeReview = useCallback(() => setReviewIntroOpen(false), []);
  const openReview = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setReviewIntroOpen(true);
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

  // Resume-after-onboarding consumer. Runs once per mount AFTER the
  // initial /api/relationships fetch has resolved into a 'none' phase.
  // If a code is staged AND we have no relationship, we accept it and
  // refresh. Any other phase means the user already has a relationship
  // (active or pending), so the staged code is stale — clear it.
  useEffect(() => {
    if (phase.kind === 'loading' || resumeAttempted) return;
    let cancelled = false;
    (async () => {
      try {
        const stagedCode = await AsyncStorage.getItem(PENDING_INVITE_CODE_KEY);
        if (!stagedCode) return;
        if (cancelled) return;
        if (phase.kind !== 'none') {
          // User already has something — staged code is stale, drop it
          // silently to avoid a misleading error toast on next load.
          console.log(`[relationships] dropping stale staged code (current phase=${phase.kind})`);
          await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY).catch(() => {});
          setResumeAttempted(true);
          return;
        }
        console.log(`[relationships] resuming staged invite code=${stagedCode}`);
        setResumeAttempted(true);
        setBusy(true);
        const result = await api.acceptRelationshipInvite(stagedCode);
        if (cancelled) return;
        if ('error' in result) {
          console.warn(`[relationships] resume failed: ${result.error} ${result.message || ''}`);
          // Don't clear the staged code on transport/server errors that
          // might recover on retry. Cancel-permanent reasons (the
          // invite is gone) get cleared so we don't loop on every
          // mount.
          const permanent = [
            'invite-not-found',
            'invite-already-used',
            'invite-already-claimed',
            'cannot-accept-own-invite',
            'already-in-relationship',
          ].includes(result.error);
          if (permanent) {
            await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY).catch(() => {});
          }
          setBusy(false);
          // Surface the result so the user knows their tap landed.
          // Friendly error mapping mirrors connect/[code].tsx.
          const message = (
            result.error === 'invite-not-found'        ? "We couldn't find this invite. Ask your partner to share a fresh link." :
            result.error === 'invite-already-claimed'  ? "Someone has already accepted this invite." :
            result.error === 'cannot-accept-own-invite' ? "This is your own invite — share it with your partner instead." :
            result.error === 'already-in-relationship' ? "You already have an active relationship." :
            "Couldn't complete the connection. Please try the link again."
          );
          Alert.alert('Hmm, that didn\'t work', message);
          return;
        }
        // Success — clear the staged code, refresh the screen.
        await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY).catch(() => {});
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await refresh();
        setBusy(false);
      } catch (e) {
        console.warn('[relationships] resume threw:', (e as Error)?.message);
        setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [phase.kind, resumeAttempted, refresh]);

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
    const code = pasteCode.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    Haptics.selectionAsync().catch(() => {});
    const result = await api.acceptRelationshipInvite(code);
    setBusy(false);
    if ('error' in result) {
      const msg = (
        result.error === 'invite-not-found'         ? "No invite matches that code. Double-check and try again." :
        result.error === 'invite-already-claimed'   ? "This invite has already been used." :
        result.error === 'cannot-accept-own-invite' ? "That's your own invite code — share it with your partner instead." :
        result.error === 'already-in-relationship'  ? "You already have an active relationship." :
        "Couldn't accept that code. Try again."
      );
      Alert.alert("Hmm, that didn't work", msg);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setPasteCode('');
    await refresh();
  }, [pasteCode, refresh]);

  const onShareLink = useCallback(async (link: string) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      await Share.share({
        message: `I'd like us to explore our relationship together on Inner Map. Tap to connect: ${link}`,
        url: Platform.OS === 'ios' ? link : undefined,
      });
    } catch (e) {
      console.warn('[relationships] share failed:', (e as Error)?.message);
    }
  }, []);

  // Note: a dedicated Copy button is intentionally omitted in this build —
  // the iOS / Android Share sheet already exposes Copy as one of its
  // options, and the link itself is rendered as `selectable` Text so a
  // user can long-press to copy directly. Adding expo-clipboard would
  // require a dependency bump that this phase doesn't need.

  // ---- Render branches ----

  // First-time tab-intro gate. We render the carousel BEFORE running
  // the relationship state machine — a brand-new user sees the six
  // cinematic slides on their very first tap into the Partner tab,
  // and only after GET STARTED do they see the connect screen.
  // Subsequent visits skip directly to the state machine.
  if (tabIntro === 'unknown') {
    return (
      <SafeAreaView style={styles.root} edges={[]}>
        <CenteredLoader />
      </SafeAreaView>
    );
  }
  if (tabIntro === 'unseen') {
    return (
      <SafeAreaView style={styles.root} edges={[]}>
        <RelationshipIntroCarousel
          mode="informational"
          onComplete={onTabIntroDone}
        />
      </SafeAreaView>
    );
  }

  // Review-mode short-circuit. While the user has the ℹ︎ panel open
  // we replace the entire tab content with the carousel; the back
  // chevron + GOT IT button both call closeReview() which flips
  // back to whatever sub-state was underneath.
  if (reviewIntroOpen) {
    return (
      <SafeAreaView style={styles.root} edges={[]}>
        <RelationshipIntroCarousel
          mode="review"
          onComplete={closeReview}
          showBackButton
          onBack={closeReview}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* Floating ℹ︎ — re-opens the framing carousel from anywhere
          on the Partner tab (connect screen, pending states, all
          three active sub-views). Absolute-positioned so it stays
          in the same screen-corner regardless of which sub-state
          is currently rendered below. */}
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
          onPasteCodeChange={setPasteCode}
          onCreateInvite={onCreateInvite}
          onPasteAccept={onPasteAccept}
        />
      ) : phase.kind === 'pending-no-partner' ? (
        <PendingNoPartnerView
          rel={phase.rel}
          onShare={onShareLink}
          onRefresh={refresh}
        />
      ) : phase.kind === 'pending-intros' ? (
        <PendingIntrosView rel={phase.rel} onRefresh={refresh} onReadIntro={onReadIntro} />
      ) : (
        <ActiveView rel={phase.rel} />
      )}
    </SafeAreaView>
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
  const canPaste = pasteCode.trim().length >= 6 && !busy;
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.h1}>Connect with your partner</Text>
      <Text style={styles.lede}>
        Inner Map can hold a private space for the two of you. You'll each have your own
        chat, and the parts you both approve appear in a shared view.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Send an invite</Text>
        <Text style={styles.cardBody}>
          Generate a link to share with your partner. They'll tap it on their phone, set
          up Inner Map, and you'll be paired.
        </Text>
        <Pressable
          onPress={onCreateInvite}
          style={[styles.btnPrimary, busy && styles.btnDim]}
          disabled={busy}
          accessibilityLabel="Generate invite link"
        >
          {busy ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.btnPrimaryText}>GENERATE INVITE LINK</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.divider}>— or —</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Have a code from your partner?</Text>
        <Text style={styles.cardBody}>
          Paste the 8-character code from the link they sent.
        </Text>
        <TextInput
          value={pasteCode}
          onChangeText={(s) => onPasteCodeChange(s.toUpperCase())}
          placeholder="ABCD1234"
          placeholderTextColor={colors.creamFaint}
          style={styles.codeInput}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          editable={!busy}
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
  );
}

function PendingNoPartnerView({
  rel, onShare, onRefresh,
}: {
  rel: Relationship;
  onShare: (link: string) => void;
  onRefresh: () => void;
}) {
  const link = rel.link || '';
  const code = rel.inviteCode || '';
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.h1}>Waiting for your partner</Text>
      <Text style={styles.lede}>
        Send them this link. They'll tap it on their phone and we'll pair you up.
      </Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your invite link</Text>
        <View style={styles.codeBox}>
          {/* selectable Text — long-press copies on iOS/Android without
              requiring expo-clipboard as a dep. */}
          <Text style={styles.codeBoxText} selectable numberOfLines={2}>{link}</Text>
        </View>
        <Pressable onPress={() => onShare(link)} style={styles.btnPrimary} accessibilityLabel="Share invite link">
          <Ionicons name="share-outline" size={16} color={colors.background} style={{ marginRight: 8 }} />
          <Text style={styles.btnPrimaryText}>SHARE LINK</Text>
        </Pressable>
        <Text style={styles.codeHint}>
          Or share the code: <Text style={styles.codeStrong}>{code}</Text>
        </Text>
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

  codeInput: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 18,
    letterSpacing: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.2)',
    marginBottom: spacing.md,
  },
  codeBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.md,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.18)',
  },
  codeBoxText: { color: colors.cream, fontFamily: fonts.sans, fontSize: 13 },
  codeHint: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  codeStrong: { color: colors.amber, fontFamily: fonts.sansBold, letterSpacing: 2 },

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
});
