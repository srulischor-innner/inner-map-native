// Onboarding flow — a single screen with several phases behind one full-screen layout:
//   1. welcome — 6 swipeable intro slides (title, patterns, map, sketch, companion,
//      not-therapy, begin)
//   2. privacy — first-launch plain-language summary of what Inner Map stores
//   3. age     — the 18+ gate. Its own phase, and it sits AHEAD of terms
//                (2026-08 reorder — see the AgeGateScreen header for why).
//   4. terms   — plain-language disclaimer with a checkbox and "I understand" CTA
//   5. intake  — 4-step form: name / about / goals / free-text. Each step has its
//      own "Continue" button; slide 2+ have a "skip" link to respect the user.
//
// On completion of each phase we mark the corresponding flag in AsyncStorage so a
// restart mid-flow resumes where the user left off. When the final flag lands we
// router.replace('/') to the main tabs.

import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet,
  Keyboard, Platform, FlatList, useWindowDimensions,
} from 'react-native';
import { useKeyboardInset } from '../utils/useKeyboardInset';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, fonts, radii, spacing } from '../constants/theme';
import { PARTNER_ENABLED } from '../constants/features';
import {
  markIntroSeen, markTermsAccepted, markIntakeComplete,
  markPrivacyNoticeSeen, hasSeenPrivacyNotice, markTermsSyncPending,
  markAgeGateBlocked, clearAgeGateBlocked, markAgeGateRetryUsed,
  isAgeGateBlocked, isAgeGateRetryUsed, markAgeSyncPending,
} from '../services/onboarding';
import { api } from '../services/api';
import {
  evaluateDob, localToday, parseBox, MINIMUM_AGE,
  type DobInput, type AgeGateStatus,
} from '../utils/ageGate';
import { GuideSlide } from '../components/guide/GuideSlide';
import { GuideDots } from '../components/guide/GuideDots';
import { WELCOME_SLIDES } from '../utils/guideContent';

// Same key used to gate the Guide tab's Welcome section so it never
// re-runs the cinematic experience as static reference. Set the moment
// the user taps B E G I N on the last onboarding slide.
const HAS_SEEN_WELCOME_KEY = 'hasSeenWelcome';

// Canonical, legally-binding documents (hosted). Onboarding's privacy/terms
// copy is a plain-language summary; these links always reach the full live
// versions via the shared helper. Acceptance ("I have read and agree…")
// references these.
import {
  PRIVACY_POLICY_URL as PRIVACY_URL,
  TERMS_OF_SERVICE_URL as TERMS_URL,
  openLegalDoc,
} from '../utils/legalDocs';
import {
  ExperienceLevel, LEVEL_OPTIONS, setExperienceLevel, setChoseHardPlace,
} from '../services/experienceLevel';
import { SupportResourcesScreen } from '../components/safety/SupportResourcesScreen';

// Onboarding phases (full self-explorer flow):
//   welcome → privacy → age → terms → intake → experience → (resources?|notTherapy)
//
// Invitee flow (deep-link via a partner invite, shortened path):
//   privacy → age → terms → /relationships
//
// The 'privacy' phase is the first-launch privacy notice — a warm
// summary of what Inner Map stores, what it never does, and the
// user's data rights. Inserted between Welcome (warm intro to what
// Inner Map is) and the 18+ gate. Persists the privacyNoticeSeen flag
// on dismissal so re-entries skip it.
//
// ============================================================================
// WHY 'age' SITS WHERE IT SITS — the 2026-08 reorder
// ============================================================================
// The gate used to live inside IntakeFlow step 1, i.e. one phase AFTER terms.
// api.acceptTerms() fires from the terms phase, so by the time a minor was
// declined the server already held termsAccepted + termsAcceptedAt against
// that user id. The live Terms of Service say that if we learn an account
// belongs to someone under 18 we close it and delete the associated data —
// and THE GATE IS THE MOMENT OF LEARNING. Either something deletes those
// rows, or nothing is ever written. Founder ruling: nothing is ever written.
// Hence this order, and hence NO deletion call anywhere on this path.
//
// AFTER 'privacy', NOT BEFORE IT. Two orders were available —
// welcome → AGE → privacy → terms, or welcome → privacy → AGE → terms — and
// the second was chosen:
//
//   • The boundary that actually mattered to the ruling is the one between
//     the gate and TERMS, because terms is the first phase in this file that
//     writes anything to a server. Welcome and privacy write only
//     device-local flags (hasSeenWelcome, privacyNoticeSeen) and make no
//     network call at all, so moving the gate ahead of them buys nothing and
//     costs something.
//   • What it costs: the privacy notice is the screen that explains what
//     Inner Map does with personal data. A date of birth IS personal data,
//     however briefly it is held. Asking for one before we have said a word
//     about our data handling inverts the thing the notice exists to do — and
//     the reassurance printed directly under the date field ("we don't store
//     your date of birth") reads as a bare assertion from a stranger unless
//     the notice has already been shown.
//   • Welcome stays first because being declined by an app that has not yet
//     told you what it is, is a worse experience for no gain.
type Phase = 'welcome' | 'privacy' | 'age' | 'terms' | 'intake' | 'experience' | 'resources' | 'notTherapy';

// PR B note: this key was previously written by app/connect/[code].tsx
// when a brand-new user tapped a partner-invite universal link before
// completing onboarding. The deep-link route + its writer were deleted
// in PR B (text-based code sharing has no link to intercept). The
// onboarding flow still reads the key so that any user mid-onboarding
// at the moment of the PR B deploy who has a stashed key still gets
// the shortened invitee path. For all new users post-PR-B the key
// will always be null and the invitee branch in this file is dead.
// Once the cohort of mid-flight users has aged out we can remove this
// constant + the isInvitee branch entirely.
const PENDING_INVITE_CODE_KEY = 'relationships.pendingInviteCode';

export default function OnboardingScreen() {
  const [phase, setPhase] = useState<Phase>('welcome');
  // isInvitee — flips true on mount when AsyncStorage has a staged
  // invite code (set by app/connect/[code].tsx). Drives the shortened
  // onboarding path: privacy notice → terms → /relationships, skipping
  // intake / experience / resources / notTherapy. The relationship
  // intro slides (Phase 5) live in the relationships tab itself, so
  // the invitee lands there with their staged code in hand and the
  // tab's resume-after-onboarding effect picks it up automatically.
  //
  // Self-explorers who didn't come in through a deep link follow the
  // full path unchanged (welcome → privacy → terms → intake → …).
  const [isInvitee, setIsInvitee] = useState<boolean | null>(null);
  // privacyNoticeAlreadySeen — resolved once on mount. If true, the
  // privacy phase is skipped from both flows (the user already
  // acknowledged it in a prior incomplete onboarding attempt and we
  // don't want to nag them with it again). Null while the AsyncStorage
  // read is in flight; we hold rendering until it settles so we don't
  // flash through the wrong initial phase.
  const [privacyAlreadySeen, setPrivacyAlreadySeen] = useState<boolean | null>(null);
  // ageBlocked / ageRetryUsed — the 18+ gate's device-local state, resolved
  // once on mount alongside the other two reads. `ageBlocked` true means this
  // device gave a date of birth under 18 at some point; the block screen
  // replaces the ENTIRE flow (including the invitee path) and there is no way
  // past it. Null while the read is in flight, for the same
  // don't-flash-the-wrong-phase reason as the other two.
  const [ageBlocked, setAgeBlocked] = useState<boolean | null>(null);
  const [ageRetryUsed, setAgeRetryUsed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // PARTNER_ENABLED gate (v1 launch): with the Partner tab hidden, the
    // shortened invitee path (→ /relationships) must not fire even for a
    // user with a legacy stashed invite code — they'd land on an
    // unreachable screen. They take the full self-explorer flow instead.
    AsyncStorage.getItem(PENDING_INVITE_CODE_KEY)
      .then((v) => setIsInvitee(PARTNER_ENABLED && !!v))
      .catch(() => setIsInvitee(false));
    hasSeenPrivacyNotice()
      .then(setPrivacyAlreadySeen)
      .catch(() => setPrivacyAlreadySeen(false));
    // The block must survive backgrounding, force-quit and app updates — the
    // flag is the only thing standing between a declined minor and simply
    // relaunching into the flow.
    //
    // TIMEOUT-CAPPED, FALLING OPEN INTO THE FLOW. Both helpers swallow a THROW,
    // but neither can swallow a STALL, and the render below HOLDS on
    // `ageBlocked === null` — so an unresolved read would leave a blank
    // SafeAreaView on screen forever. That matters more now that the boot gate
    // in app/_layout.tsx fails CLOSED and sends unknown-state devices here.
    //
    // The two directions compose deliberately: boot won't let an unknown device
    // rest in the tabs, and this screen won't let one sit on a blank frame. It
    // falls through to the FLOW, not to the app — which means the user reaches
    // the 'age' phase and meets the LIVE gate, the one that actually evaluates
    // a date. A minor is declined there exactly as before; an adult passes.
    // Since the reorder that phase sits ahead of terms, so falling through here
    // cannot land anyone downstream of the gate.
    // First answer wins — whichever of the read and the cap settles first. The
    // late one is dropped rather than applied, so this can never fight the two
    // other writers of this state (the intake gate's onAgeBlocked, and the
    // correction offer's setAgeBlocked(false)).
    let ageReadSettled = false;
    const settleAgeRead = (b: boolean) => {
      if (ageReadSettled) return;
      ageReadSettled = true;
      setAgeBlocked(b);
    };
    const ageReadCap = setTimeout(() => settleAgeRead(false), 3000);
    isAgeGateBlocked()
      .then((b) => { clearTimeout(ageReadCap); settleAgeRead(b); })
      .catch(() => { clearTimeout(ageReadCap); settleAgeRead(false); });
    isAgeGateRetryUsed()
      .then(setAgeRetryUsed)
      .catch(() => setAgeRetryUsed(false));
    return () => clearTimeout(ageReadCap);
  }, []);

  // Full-path completion (self-explorer): mark intake complete + route
  // to chat tab. The relationship intro slides + chat live behind the
  // PARTNER tab; users who go through the full flow can opt into them
  // later.
  async function finishAndEnterApp() {
    await markIntakeComplete();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace('/');
  }

  // Invitee shortcut — terms-only path. Mark intro+intake all complete
  // (no welcome slides shown, no intake collected, no experience-level
  // pick, no resources/notTherapy moment), then route to /relationships
  // where the resume-after-onboarding consumer will accept the staged
  // invite and surface the relationship intro slides.
  async function finishAsInvitee() {
    try { await markIntroSeen(); } catch {}
    try { await markIntakeComplete(); } catch {}
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.replace('/relationships');
  }

  // Hold rendering until both async reads settle. Otherwise a brand-new
  // invitee would flash through one frame of the welcome slide before
  // the invitee effect resolved, OR the privacy notice would
  // momentarily double-fire while privacyAlreadySeen resolved.
  if (isInvitee === null || privacyAlreadySeen === null || ageBlocked === null) {
    return <SafeAreaView style={styles.root} edges={['top', 'bottom']} />;
  }

  // 18+ GATE — HARD BLOCK. Checked FIRST, ahead of the invitee shortcut and
  // every phase, so there is no path of any kind around it: no account setup,
  // no chat, no session, no intake write. See AgeBlockedScreen for what this
  // does and does not guarantee.
  if (ageBlocked) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <AgeBlockedScreen
          canCorrect={!ageRetryUsed}
          onCorrect={async () => {
            // The SINGLE correction offer, for genuine typos. Consumed by the
            // tap, not by the outcome — so this cannot become an unlimited
            // guess-until-it-works loop. The blocked flag deliberately STAYS
            // set until a passing date clears it, which means a force-quit
            // here relaunches to this screen with the offer spent.
            await markAgeGateRetryUsed();
            setAgeRetryUsed(true);
            setAgeBlocked(false);
            // Back to the GATE, which is now its own phase ahead of terms —
            // not into intake, which since the reorder sits downstream of an
            // acceptance the corrected user has not made yet.
            setPhase('age');
          }}
        />
      </SafeAreaView>
    );
  }

  // INVITEE PATH — privacy notice (if not already seen) → terms →
  // /relationships. Bypasses every other onboarding phase. We piggy-
  // back on the same Phase state machine the self-explorer path uses;
  // we just initialize phase to 'privacy' (or skip straight to 'terms'
  // when the user has already seen the privacy notice) on the first
  // render where isInvitee=true.
  if (isInvitee) {
    // ⚠️ 18+ GATE — THIS PATH IS NOW GATED TOO (2026-08 reorder).
    // It previously ran privacy → terms → /relationships and never touched
    // intake, which is where the gate used to live — so an invitee was not
    // age-gated at all, and the gap was left documented rather than fixed
    // because PARTNER_ENABLED is false and the branch is provably dead
    // (isInvitee is `PARTNER_ENABLED && !!code`). The reorder makes the gate
    // a phase rather than an intake step, so giving this path the same gate
    // is now a two-line change with no new ruling required, and it has been
    // made: privacy → age → terms → /relationships.
    //
    // THE RESUME SHAPE IS THE POINT. `inviteePhase` is what lets a user who
    // closed the app mid-onboarding skip a screen they already finished, and
    // it is therefore the single most likely place to accidentally re-enter
    // the flow DOWNSTREAM of the gate. It cannot: 'terms' is reachable here
    // only when `phase` is already 'terms', and the only writer of that value
    // anywhere in this file is AgeGateScreen's onPass.
    const inviteePhase: 'privacy' | 'age' | 'terms' =
      phase === 'terms' ? 'terms'
        : phase === 'age' ? 'age'
          : (privacyAlreadySeen ? 'age' : 'privacy');
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {inviteePhase === 'privacy' ? (
          <PrivacyNoticeScreen
            onAcknowledge={async () => {
              await markPrivacyNoticeSeen();
              setPhase('age');
            }}
          />
        ) : inviteePhase === 'age' ? (
          <AgeGateScreen
            onPass={() => setPhase('terms')}
            onBlocked={() => setAgeBlocked(true)}
          />
        ) : (
          <TermsScreen
            onAccept={async () => {
              // ACCEPT-TERMS CALL SITE 1 of 2 (the invitee / resume-shaped
              // path). Reachable only when `phase === 'terms'`, and the only
              // assignment of that value in this file is AgeGateScreen's
              // onPass — so this POST cannot fire for anyone who has not
              // passed the gate.
              //
              // SERVER FIRST, then the local gate (2026-07-30). The server row
              // is the audit trail; writing the local flag first meant an
              // offline acceptance diverged permanently — local said yes, the
              // server was never told, and nothing ever reconciled. The result
              // is no longer discarded: a failed POST marks the sync pending so
              // the boot reconciliation retries it.
              const synced = await api.acceptTerms();
              if (!synced) {
                console.warn('[terms] accept POST failed — marking sync pending for boot retry');
                await markTermsSyncPending();
              }
              await markTermsAccepted();
              await finishAsInvitee();
            }}
          />
        )}
      </SafeAreaView>
    );
  }

  // SELF-EXPLORER PATH — full original flow with the privacy notice
  // inserted between welcome and terms. If the user already saw the
  // privacy notice in a prior incomplete attempt, the 'privacy' phase
  // is short-circuited to advance straight to terms.
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {phase === 'welcome' ? (
        <WelcomeSlides
          onDone={async () => {
            // Set hasSeenWelcome the moment the user finishes the
            // cinematic onboarding experience. From this point on
            // every visit to the Guide tab's Welcome section renders
            // the same slides as static reference material — no
            // typewriter, standard typography. Best-effort; an
            // AsyncStorage failure here just means the Guide tab
            // would briefly render in the cinematic style on the
            // user's first visit, which isn't catastrophic.
            try { await AsyncStorage.setItem(HAS_SEEN_WELCOME_KEY, '1'); } catch {}
            await markIntroSeen();
            // Jump straight to the GATE if the privacy notice was
            // already acknowledged in a prior pass (dev-reset of
            // welcome+terms+intake but not privacy, mid-onboarding
            // close + relaunch, etc). Otherwise route through the
            // notice. Either way the next stop is 'age', never 'terms'
            // — this skip used to land on 'terms' directly, which
            // after the reorder would be a way past the gate.
            setPhase(privacyAlreadySeen ? 'age' : 'privacy');
          }}
        />
      ) : phase === 'privacy' ? (
        <PrivacyNoticeScreen
          onAcknowledge={async () => {
            await markPrivacyNoticeSeen();
            setPhase('age');
          }}
        />
      ) : phase === 'age' ? (
        // THE 18+ GATE. Its own phase, ahead of terms. Nothing downstream of
        // here renders until onPass fires, and onPass is the only thing in
        // this file that ever sets phase to 'terms'.
        <AgeGateScreen
          onPass={() => setPhase('terms')}
          onBlocked={() => setAgeBlocked(true)}
        />
      ) : phase === 'terms' ? (
        <TermsScreen
          onAccept={async () => {
            // ACCEPT-TERMS CALL SITE 2 of 2 (the main path). Same gating as
            // site 1: this branch requires `phase === 'terms'`, which only
            // AgeGateScreen's onPass ever sets.
            //
            // Same contract as the invitee path above: server first, result
            // honoured, local gate last, pending marker on failure.
            const synced = await api.acceptTerms();
            if (!synced) {
              console.warn('[terms] accept POST failed — marking sync pending for boot retry');
              await markTermsSyncPending();
            }
            await markTermsAccepted();
            setPhase('intake');
          }}
        />
      ) : phase === 'intake' ? (
        <IntakeFlow onDone={() => setPhase('experience')} />
      ) : phase === 'experience' ? (
        <ExperienceLevelStep
          onPick={(lvl, isHard) => {
            // ADVANCE FIRST, PERSIST AFTER. CONTINUE must never be gated on a
            // storage write: AsyncStorage stalls are an observed failure here
            // (see the 3s boot-read timeout in app/_layout.tsx), and an awaited
            // write would freeze this step with no feedback. The 4th option
            // ("I'm in a hard place right now") routes to the resources screen
            // before the not-therapy moment; every other option goes straight
            // on. Same phases, same order, in the same tick as the tap.
            if (isHard) setPhase('resources');
            else setPhase('notTherapy');
            // The 4th option sets level to 'curious' so the AI uses the
            // most-scaffolded voice. Both helpers update their in-memory copy
            // and notify listeners synchronously, so the level sent on the next
            // /api/chat request is correct regardless of when the disk write
            // lands; only the write is deferred, and both already swallow their
            // own storage errors.
            setExperienceLevel(isHard ? 'curious' : lvl).catch(() => {});
            // Local-only marker (never sent to the server) so the Settings
            // picker and the Settings EXPERIENCE LEVEL row can later show THIS
            // option instead of the 'curious' label the level actually stores.
            // Invisible here: the flow above is unchanged.
            setChoseHardPlace(isHard).catch(() => {});
          }}
        />
      ) : phase === 'resources' ? (
        <SupportResourcesScreen onContinue={() => setPhase('notTherapy')} />
      ) : (
        <NotTherapyScreen onContinue={finishAndEnterApp} />
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// PRIVACY NOTICE — first-launch warm summary of Inner Map's data handling.
// Lands between Welcome slides and Terms (or, for invitees, between app
// open and Terms). One screen, four short paragraphs, single "Got it →"
// primary CTA. Static rendering — no typewriter, matches Welcome's
// post-onboarding static style. Persists privacyNoticeSeen on
// acknowledgement so subsequent app launches skip the screen.
//
// Visual style matches the Welcome slides: cream serif title, sans body,
// amber primary button. Deliberately calm — this is NOT legalese; the
// in-app /privacy screen + the public hosted policy carry the full
// detail. This is the friendly summary the user reads BEFORE sharing
// anything personal.
// ============================================================================
function PrivacyNoticeScreen({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.privacyNoticeRoot} showsVerticalScrollIndicator={false}>
      <View style={{ flex: 1 }} />
      <Text style={styles.privacyNoticeTitle}>Your privacy</Text>
      <Text style={styles.privacyNoticeLede}>
        Before you start, here's the short version.
      </Text>
      <Text style={styles.privacyNoticeBody}>
        You choose what the AI sees. Share a journal entry to help it
        understand you, or mark it private — private entries stay
        encrypted on your phone, and we genuinely can't read them.
      </Text>
      <Text style={styles.privacyNoticeBody}>
        Your chats and your map live on our server so you can pick up
        where you left off. We never sell your data, never run ads, and
        the AI providers we use (Anthropic and OpenAI) don't train their
        models on your conversations.
      </Text>
      <Text style={styles.privacyNoticeBody}>
        From Settings, you can export everything we have on you or
        delete your account permanently. Anytime.
      </Text>
      <Text style={[styles.privacyNoticeBody, styles.privacyNoticeClose]}>
        Inner work is yours. You decide what to share and what to keep private.
      </Text>
      <Text style={styles.privacyNoticeLinks}>
        Read the full{' '}
        <Text style={styles.privacyNoticeLink} onPress={() => openLegalDoc(PRIVACY_URL)}>
          Privacy Policy
        </Text>
        {' '}and{' '}
        <Text style={styles.privacyNoticeLink} onPress={() => openLegalDoc(TERMS_URL)}>
          Terms of Service
        </Text>
        .
      </Text>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onAcknowledge();
        }}
        style={[styles.beginBtn, { alignSelf: 'center', marginTop: spacing.xl }]}
        accessibilityLabel="Got it"
      >
        <Text style={styles.beginText}>GOT  IT  →</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
    </ScrollView>
  );
}

// ============================================================================
// 1. WELCOME SLIDES — same data + visuals as the Guide tab's WELCOME pill,
// pulled from utils/guideContent.ts so the two never drift. The onboarding
// flow adds a "B E G I N" button + disclaimer below the last slide.
// ============================================================================
function WelcomeSlides({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  const atLast = index === WELCOME_SLIDES.length - 1;

  return (
    <View style={styles.flex}>
      <FlatList
        ref={listRef}
        data={WELCOME_SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          if (i !== index) setIndex(i);
        }}
        scrollEventThrottle={16}
        renderItem={({ item, index: i }) => (
          <GuideSlide
            data={item}
            width={width}
            // First-launch cinematic experience: typewriter on each
            // slide as it becomes active, bigger/bolder typography
            // throughout. Both flags are owned by the onboarding
            // route and live nowhere else.
            animateBody
            cinematic
            isActive={i === index}
          />
        )}
      />
      <View style={styles.welcomeFoot}>
        <GuideDots
          count={WELCOME_SLIDES.length}
          active={index}
          onTap={(i) => { listRef.current?.scrollToIndex({ index: i, animated: true }); }}
        />
        {/* Advance affordance (beta fix, July 2026): testers didn't know the
            deck swipes — dots read as status, not instruction. One persistent
            button in a constant position: NEXT advances a slide; on the last
            slide it becomes BEGIN. No skip — everyone sees every slide.
            Swipe and dot-taps still work. */}
        <Pressable
          onPress={atLast
            ? onDone
            : () => listRef.current?.scrollToIndex({ index: index + 1, animated: true })}
          style={[styles.beginBtn, { marginTop: spacing.md }]}
          accessibilityLabel={atLast ? 'Begin' : 'Next slide'}
        >
          <Text style={styles.beginText}>{atLast ? 'B E G I N' : 'N E X T   →'}</Text>
        </Pressable>
        {atLast ? (
          <Text style={styles.disclaimer}>
            Inner Map is a self-reflection tool, not a substitute for professional
            mental health support.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ============================================================================
// 2. TERMS
// ============================================================================
function TermsScreen({ onAccept }: { onAccept: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <ScrollView contentContainerStyle={styles.termsRoot} showsVerticalScrollIndicator={false}>
      <Text style={styles.termsTitle}>Before you begin</Text>
      <Text style={styles.termsLead}>
        Inner Map is a self-reflection tool. It is not therapy, not medical advice, and
        not a crisis service.
      </Text>
      <Text style={styles.termsHeading}>By continuing you understand that:</Text>
      {[
        'Inner Map does not provide professional mental health treatment',
        'The AI is not a licensed therapist or medical professional',
        'Nothing shared here should be treated as clinical advice or diagnosis',
        'If you are in crisis or need immediate support, please contact a mental health professional or crisis service',
        'You use this app at your own discretion',
      ].map((bullet, i) => (
        <View key={i} style={styles.termsBullet}>
          <Text style={styles.termsDot}>•</Text>
          <Text style={styles.termsBulletText}>{bullet}</Text>
        </View>
      ))}
      <Text style={styles.termsPrivacy}>
        Your conversations are private and stored securely. We do not sell your data
        or share it with third parties.
      </Text>

      <Text style={styles.termsDocLinks}>
        Read the full{' '}
        <Text style={styles.termsDocLink} onPress={() => openLegalDoc(TERMS_URL)}>
          Terms of Service
        </Text>
        {' '}and{' '}
        <Text style={styles.termsDocLink} onPress={() => openLegalDoc(PRIVACY_URL)}>
          Privacy Policy
        </Text>
        .
      </Text>

      <Pressable
        onPress={() => { Haptics.selectionAsync().catch(() => {}); setChecked((c) => !c); }}
        style={styles.termsCheck}
      >
        <View style={[styles.checkbox, checked && styles.checkboxOn]}>
          {checked ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <Text style={styles.termsCheckLabel}>
          I have read and agree to the Terms of Service and Privacy Policy.
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          if (!checked) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onAccept();
        }}
        style={[styles.beginBtn, !checked && styles.beginBtnDisabled]}
        disabled={!checked}
      >
        <Text style={[styles.beginText, !checked && { opacity: 0.4 }]}>I  UNDERSTAND  —  CONTINUE</Text>
      </Pressable>
    </ScrollView>
  );
}

// ============================================================================
// 3. INTAKE — four steps
// ============================================================================
type IntakeState = {
  name: string;
  gender: string;
  relationship: string;
  profession: string;
  goals: string[];
  goalsOther: string;
  freeText: string;
};

function IntakeFlow({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<IntakeState>({
    name: '', gender: '', relationship: '', profession: '',
    goals: [], goalsOther: '', freeText: '',
  });
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // NO DATE OF BIRTH HERE, AND NONE MAY BE ADDED (2026-08 reorder).
  // The 18+ gate used to be the second half of step 1. It is now its own
  // phase — AgeGateScreen — two phases upstream, ahead of terms. There is
  // exactly one age question in this flow and it is not in this component;
  // adding a second one here would re-create the "two age questions, one of
  // them optional" confusion the gate was built to remove, and would put a
  // date of birth back inside the component that owns the /api/intake
  // payload. The step count is unchanged: step 1 is the name, as it was
  // before the gate ever landed here, so there is no dangling index.

  // Keyboard avoidance — centralized in utils/useKeyboardInset. This
  // intake is a non-modal screen whose steps are each in a ScrollView,
  // so on Android the OS resize (softwareKeyboardLayoutMode:'resize')
  // lifts + scrolls the focused input/CTA into view (inset stays 0); on
  // iOS the inset is the live keyboard height, applied below.
  const kbHeight = useKeyboardInset();

  async function submit() {
    await api.postIntake({
      name: state.name,
      gender: state.gender,
      relationship: state.relationship,
      profession: state.profession,
      goals: state.goals,
      goalsOther: state.goalsOther,
      freeText: state.freeText,
    });
    onDone();
  }

  return (
    <View style={[styles.flex, { paddingBottom: kbHeight }]}>
      <View style={styles.stepDots}>
        {[1, 2, 3, 4].map((n) => (
          <View key={n} style={[styles.stepDot, n === step && styles.stepDotActive, n < step && styles.stepDotDone]} />
        ))}
      </View>

      {/* STEP 1 — the name, and only the name. The date of birth that briefly
          shared this step moved out to the 'age' phase in the 2026-08 reorder;
          by the time anyone reaches intake they have already passed the gate
          AND accepted terms. */}
      {step === 1 ? (
        <StepWrap title="Let's start with you" subtitle="What should I call you?">
          <Field label="Your name">
            <TextInput
              value={state.name}
              onChangeText={(t) => setState((s) => ({ ...s, name: t }))}
              placeholder="First name is fine"
              placeholderTextColor={colors.creamFaint}
              style={styles.input}
              selectionColor={colors.amber}
              autoFocus
            />
          </Field>
          <CTA
            onPress={() => setStep(2)}
            disabled={!state.name.trim()}
            label="CONTINUE"
          />
        </StepWrap>
      ) : null}

      {/* STEP 2 — the optional "Age" TextInput that used to head this step is
          GONE (2026-08). It gated nothing, sat under "Everything here is
          optional", and sent age:null whenever it didn't parse. The 18+ gate
          replaces it — two age questions in one flow would be both confusing
          and, given the step heading, misleading about which one matters. The
          server no longer accepts the field. */}
      {step === 2 ? (
        <StepWrap title="A little about you" subtitle="Everything here is optional.">
          <Field label="Gender">
            <ChipRow
              items={['Woman', 'Man', 'Non-binary', 'Prefer not to say']}
              value={state.gender}
              onChange={(v) => setState((s) => ({ ...s, gender: v }))}
            />
          </Field>
          <Field label="Relationship">
            <ChipRow
              items={['Single', 'Dating', 'Partnered', 'Married', 'Separated', 'Other']}
              value={state.relationship}
              onChange={(v) => setState((s) => ({ ...s, relationship: v }))}
            />
          </Field>
          <Field label="What do you do">
            <TextInput
              value={state.profession}
              onChangeText={(t) => setState((s) => ({ ...s, profession: t }))}
              placeholder="Your work, role, or life focus"
              placeholderTextColor={colors.creamFaint}
              style={styles.input}
              selectionColor={colors.amber}
            />
          </Field>
          <CTA onPress={() => setStep(3)} label="CONTINUE" />
          <SkipLink onPress={() => setStep(3)} />
        </StepWrap>
      ) : null}

      {step === 3 ? (
        <StepWrap title="What brings you here?" subtitle="Pick any that feel true.">
          <MultiChips
            items={[
              'Understand myself better',
              'Work through a pattern',
              'Process something specific',
              'Have a space between therapy sessions',
              'Curious about parts work',
              'Something else',
            ]}
            values={state.goals}
            onToggle={(v) => {
              setState((s) => {
                const has = s.goals.includes(v);
                return { ...s, goals: has ? s.goals.filter((g) => g !== v) : [...s.goals, v] };
              });
            }}
          />
          {state.goals.includes('Something else') ? (
            <TextInput
              value={state.goalsOther}
              onChangeText={(t) => setState((s) => ({ ...s, goalsOther: t }))}
              placeholder="What's alive for you?"
              placeholderTextColor={colors.creamFaint}
              style={[styles.input, { marginTop: spacing.sm }]}
              multiline
              selectionColor={colors.amber}
            />
          ) : null}
          <CTA onPress={() => setStep(4)} label="CONTINUE" />
          <SkipLink onPress={() => setStep(4)} />
        </StepWrap>
      ) : null}

      {step === 4 ? (
        <StepWrap
          title="Is there anything else"
          subtitle="you'd want me to know before we start?"
        >
          <TextInput
            value={state.freeText}
            onChangeText={(t) => setState((s) => ({ ...s, freeText: t }))}
            placeholder="Take your time — say as much or as little as you want."
            placeholderTextColor={colors.creamFaint}
            style={[styles.input, { minHeight: 140, textAlignVertical: 'top' }]}
            multiline
            selectionColor={colors.amber}
          />
          <CTA onPress={submit} label="B E G I N" />
          <SkipLink onPress={submit} label="Skip" />
        </StepWrap>
      ) : null}
    </View>
  );
}

// ============================================================================
// THE 18+ GATE — its own onboarding phase, sitting between the privacy notice
// and the terms screen.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ ⚖️  FOR COUNSEL — OPEN QUESTION, NOT RESOLVED HERE                        │
// │                                                                          │
// │ This screen collects a date of birth BEFORE terms acceptance. That       │
// │ ORDER is new (2026-08) and is a deliberate founder decision that has     │
// │ NOT yet been reviewed by counsel — the founder is taking the sequencing  │
// │ question to his attorney. It is flagged here, at the collection point,   │
// │ rather than in a commit message, so that whoever reviews this file sees  │
// │ it where the collection actually happens.                                │
// │                                                                          │
// │ WHAT DID NOT CHANGE: the date is still derived and discarded. It lives   │
// │ in component state, is reduced by evaluateDob() to one of four status    │
// │ strings, and dies with this component. Nothing durable ever holds it.    │
// │ The only things that persist for a user who PASSES are age18Confirmed,   │
// │ the attestation timestamp and the policy version — the last two stamped  │
// │ server-side. See utils/ageGate.ts for the storage contract and the live  │
// │ Privacy Policy line it enforces.                                         │
// │                                                                          │
// │ WHAT CHANGED, AND WHY: the gate used to be intake step 1, one phase      │
// │ AFTER terms, so api.acceptTerms() had already written termsAccepted +    │
// │ termsAcceptedAt against the user id of anyone we then declined. The      │
// │ live Terms of Service commit us to closing the account and deleting the  │
// │ associated data if we LEARN a user is under 18 — and this gate is the    │
// │ moment of learning. The founder's ruling was to move the gate rather     │
// │ than to add a deletion: nothing is written about a declined minor, so    │
// │ the clause stays dormant and no DELETE fires. That ruling is what put a  │
// │ date-of-birth question ahead of terms acceptance, which is the point     │
// │ counsel is being asked about.                                            │
// └──────────────────────────────────────────────────────────────────────────┘
//
// The component owns the date, the evaluation, and both outcomes. The parent
// only supplies the two exits:
//   onPass    → advance to 'terms'. THE ONLY WRITER of phase 'terms' in this
//               file, which is what makes both api.acceptTerms() call sites
//               unreachable without a passing evaluation, by construction.
//   onBlocked → render AgeBlockedScreen in place of the whole flow.
// ============================================================================
function AgeGateScreen({
  onPass, onBlocked,
}: {
  onPass: () => void;
  onBlocked: () => void;
}) {
  // DATE OF BIRTH — LOCAL COMPONENT STATE ONLY, AND IT MUST STAY THAT WAY.
  //
  // Deliberately not lifted into the parent and deliberately nowhere near
  // IntakeState (the /api/intake payload shape): the date of birth must never
  // be in a payload, a storage write, or a log line. It lives here, is reduced
  // to a boolean by evaluateDob, and dies with the component. The live Privacy
  // Policy commits to "We do NOT collect dates of birth (only age confirmation
  // that you're 18+)" — putting these three strings anywhere durable makes
  // that false.
  const [dobRaw, setDobRaw] = useState({ month: '', day: '', year: '' });

  // Keyboard avoidance — same treatment as the intake steps, since this screen
  // is three number inputs and a CTA.
  const kbHeight = useKeyboardInset();

  // Evaluated fresh on every render rather than memoised, so a session left
  // open across local midnight re-derives against the new day. `localToday()`
  // reads the DEVICE'S calendar — see utils/ageGate for why the comparison is
  // local rather than UTC, and why someone whose 18th birthday is TODAY passes.
  const dob: DobInput = {
    year: parseBox(dobRaw.year),
    month: parseBox(dobRaw.month),
    day: parseBox(dobRaw.day),
  };
  const dobStatus: AgeGateStatus = evaluateDob(dob, localToday());

  // The gate. Only reachable from a CONTINUE that is disabled unless the date
  // is a complete, real, plausible, past one — so 'incomplete' and 'invalid'
  // can never arrive here, and a TYPO can therefore never trip the block or
  // spend the correction offer.
  async function continueFromGate() {
    if (dobStatus === 'under') {
      // HARD BLOCK. Persist FIRST, render second: a force-quit at the sight of
      // the block screen must still leave the device blocked.
      //
      // Nothing else happens on this branch — no request, no intake write, no
      // analytics event, no local record of the date, the age, or the attempt.
      // Since the reorder this is also true of everything UPSTREAM: welcome
      // and privacy write device-local flags only, so a declined minor reaches
      // this line without a single network call having been made ON THEIR
      // BEHALF BY THE FLOW. (Boot-time work that predates the flow — token
      // bootstrap for an already-signed-in user id — is a separate matter and
      // is described honestly on the block screen's header.)
      //
      // The founder ruling is explicit: they are someone we just declined to
      // serve, and collecting their birthdate at that moment is the one thing
      // we actively must not do. Derive, block, discard. `dobRaw` is unmounted
      // with this component moments from now and is the only copy that ever
      // existed.
      await markAgeGateBlocked();
      onBlocked();
      return;
    }
    if (dobStatus !== 'ok') return; // unreachable; the CTA is disabled

    // A corrected date that passes clears the block. No-op on the common path
    // where nothing was ever set.
    await clearAgeGateBlocked();

    // Record the attestation. NOT awaited before advancing, unlike the terms
    // accept — there is no local gate flag whose ordering depends on it, and a
    // stalled request would freeze the flow with no spinner to explain it. The
    // audit trail is still guaranteed: a failed POST marks the sync pending
    // and the boot reconciliation in app/_layout.tsx re-POSTs it, exactly as
    // it does for terms. The BOOLEAN is all that is sent; the timestamp and
    // policy version are stamped server-side.
    api.confirmAge18()
      .then((ok) => {
        if (!ok) {
          console.warn('[age-gate] confirm POST failed — marking sync pending for boot retry');
          return markAgeSyncPending();
        }
      })
      .catch(() => markAgeSyncPending());

    onPass();
  }

  return (
    <View style={[styles.flex, { paddingBottom: kbHeight }]}>
      <StepWrap
        title="One quick thing"
        subtitle="Inner Map is for adults. When were you born?"
      >
        <Field label="Date of birth">
          <DateOfBirthInput
            value={dobRaw}
            onChange={setDobRaw}
            invalid={dobStatus === 'invalid'}
          />
          {/* Says exactly what we do with it, because it is exactly what we
              do with it. The Privacy Policy makes the same promise in the
              same words; this is where the user actually sees it. */}
          <Text style={styles.dobNote}>
            Inner Map is for adults {MINIMUM_AGE} and over. We use this only to
            confirm that you are — we don't store your date of birth.
          </Text>
          {dobStatus === 'invalid' ? (
            <Text style={styles.dobHint}>
              That doesn't look like a date — have another look?
            </Text>
          ) : null}
        </Field>
        <CTA
          onPress={continueFromGate}
          disabled={dobStatus === 'incomplete' || dobStatus === 'invalid'}
          label="CONTINUE"
        />
      </StepWrap>
    </View>
  );
}

// ---------- date of birth ----------
// THREE PLAIN NUMBER BOXES, NOT A PICKER — a deliberate choice.
//
// package.json has no date-picker dependency (no
// @react-native-community/datetimepicker, no expo equivalent), and adding a
// native module means a new dev/EAS build. utils/legalDocs.ts already declines
// expo-web-browser for exactly that reason, so this follows the house
// precedent: no new dependency for a one-screen need.
//
// A spinner picker would also be the wrong control here even if it were free.
// Reaching a year ~20-100 scrolls back is slow, and the iOS wheel defaults to
// TODAY, i.e. it opens pre-set to an answer that fails the gate. Three boxes
// are one keystroke each, typed at the speed the user already knows their own
// birthday.
//
// Each box carries its OWN visible label rather than relying on MM/DD/YYYY
// order, so the well-known ambiguity between US and everywhere-else date order
// cannot silently swap month and day. A 05/11 mix-up is at worst a few days of
// error, but it can flip the answer for someone within days of turning 18 —
// and the labels cost nothing.
function DateOfBirthInput({
  value, onChange, invalid,
}: {
  value: { month: string; day: string; year: string };
  onChange: (v: { month: string; day: string; year: string }) => void;
  invalid: boolean;
}) {
  const dayRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  // Digits only. Stripping non-digits here (rather than trusting
  // keyboardType) matters because number-pad is a hint, not a guarantee:
  // hardware keyboards, some IMEs and paste all deliver letters.
  const setPart = (
    part: 'month' | 'day' | 'year',
    raw: string,
    max: number,
    next?: React.RefObject<TextInput | null>,
  ) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, max);
    onChange({ ...value, [part]: digits });
    // Auto-advance only when the box is unambiguously finished. "1" could
    // still become "12", so we wait for the second digit; jumping early
    // would strand anyone born in January through September.
    if (digits.length === max && next?.current) next.current.focus();
  };

  return (
    <View style={styles.dobRow}>
      <View style={styles.dobCell}>
        <Text style={styles.dobCellLabel}>MONTH</Text>
        <TextInput
          value={value.month}
          onChangeText={(t) => setPart('month', t, 2, dayRef)}
          keyboardType="number-pad"
          maxLength={2}
          placeholder="MM"
          placeholderTextColor={colors.creamFaint}
          style={[styles.input, styles.dobInput, invalid && styles.dobInputInvalid]}
          selectionColor={colors.amber}
          accessibilityLabel="Birth month"
        />
      </View>
      <View style={styles.dobCell}>
        <Text style={styles.dobCellLabel}>DAY</Text>
        <TextInput
          ref={dayRef}
          value={value.day}
          onChangeText={(t) => setPart('day', t, 2, yearRef)}
          keyboardType="number-pad"
          maxLength={2}
          placeholder="DD"
          placeholderTextColor={colors.creamFaint}
          style={[styles.input, styles.dobInput, invalid && styles.dobInputInvalid]}
          selectionColor={colors.amber}
          accessibilityLabel="Birth day"
        />
      </View>
      <View style={[styles.dobCell, styles.dobCellYear]}>
        <Text style={styles.dobCellLabel}>YEAR</Text>
        <TextInput
          ref={yearRef}
          value={value.year}
          onChangeText={(t) => setPart('year', t, 4)}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="YYYY"
          placeholderTextColor={colors.creamFaint}
          style={[styles.input, styles.dobInput, invalid && styles.dobInputInvalid]}
          selectionColor={colors.amber}
          accessibilityLabel="Birth year"
        />
      </View>
    </View>
  );
}

// ============================================================================
// 18+ BLOCK SCREEN
//
// Shown when the entered date of birth belongs to someone under 18. It is the
// end of the flow: there is no account, no chat, no session, no intake row,
// and no route past this screen.
//
// FOUR THINGS THIS SCREEN DELIBERATELY DOES NOT DO:
//
//  1. NO CRISIS RESOURCES. No hotline, no /support-resources link, no pointer
//     of any kind, and no crisis language — not one line. Explicit founder
//     ruling with a stated reason: counsel is mid-analysis on the
//     crisis-adjacent surfaces and may direct changes. The screen is trivial
//     to extend once that lands. Do not add one here first.
//
//  2. NO SHAME, AND IT IS NOT AN ERROR. Cream on the app's own background,
//     serif title, the same rhythm as NotTherapyScreen. Nothing red, no icon,
//     no "denied" / "not permitted" / "you may not". They answered a question
//     honestly and the answer is that we can't serve them yet. That is a fact
//     about Inner Map, not a verdict on them, and the copy says so.
//
//  3. NO NEW DATA — AND IT IS NOW BROADER THAN IT WAS, BUT STILL NOT
//     ABSOLUTE. Read this before quoting any of it into an assessment.
//
//     TRUE of the block itself: the date of birth is never stored, sent or
//     logged (it is component state, reduced to a boolean and discarded); the
//     'under' branch makes no request, records no age, and fires no analytics
//     event; and after the block, boot makes no request at all — the blocked
//     branch in app/_layout.tsx returns before token bootstrap, terms
//     reconciliation, age reconciliation and RevenueCat identify, and the
//     tabs never mount. The only thing written on this path is a device-local
//     "declined" flag.
//
//     NEWLY TRUE OF THE FLOW (2026-08 reorder). THE GATE NOW RUNS BEFORE THE
//     TERMS SCREEN, so api.acceptTerms() has NOT fired when this screen
//     renders and NO termsAccepted / termsAcceptedAt row exists for a declined
//     minor. That was the entire purpose of the reorder: the live Terms of
//     Service promise to close the account and delete the data if we learn a
//     user is under 18, this gate is the moment of learning, and the founder
//     chose "never write it" over "write it and then delete it". Every phase
//     upstream of the gate — welcome and the privacy notice — writes only
//     device-local flags and makes no network call, so nothing the FLOW does
//     on behalf of a declined minor reaches the server at all.
//
//     STILL NOT TRUE, and this is the part that must not be over-read: this
//     screen does not promise that no row of any kind exists. The sign-in
//     screen runs AHEAD of onboarding on a fresh install, so a user who
//     signed in first already has an auth_identities row carrying their email
//     and a user id minted for them, and boot's deferred token bootstrap may
//     have run against that id before the flow ever started. None of that is
//     about their age, none of it is created by the gate, and none of it is
//     removed here — no deletion call is made from this path, by ruling.
//
//     So the honest statement is now: nothing about the person's AGE OR BIRTH
//     DATE exists anywhere; the flow wrote nothing to the server about them,
//     including no terms acceptance; and rows created before onboarding
//     began, if they signed in, still exist and are untouched.
//
//  4. NO CLEVERNESS ABOUT RE-ENTRY. One correction offer for a genuine typo,
//     then it is final. Re-entering with a different date after a reinstall is
//     trivially possible, and that is FINE: misrepresentation shifting
//     liability is the entire mechanism the gate creates. What the UI must not
//     do is INVITE it — so the correction offer is worded as "if you typed it
//     wrong", never as "try a different date", and it appears exactly once.
// ============================================================================
function AgeBlockedScreen({
  canCorrect, onCorrect,
}: {
  canCorrect: boolean;
  onCorrect: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.ageBlockRoot} showsVerticalScrollIndicator={false}>
      <View style={{ flex: 1 }} />
      <Text style={styles.ageBlockTitle}>Not just yet</Text>
      <Text style={styles.ageBlockBody}>
        Inner Map is built for adults, and we're not able to offer it to you yet.
      </Text>
      {/* This line replaced "Nothing you entered has been saved." — which was
          FALSE when terms were accepted one phase BEFORE the gate. The claim
          below is narrow and exactly true: the date of birth is reduced to a
          boolean in component state and never written, never sent, never
          logged (utils/ageGate.ts header; the endpoint 400s on any date-shaped
          key). It is a statement about what was never collected, so it stays
          true no matter how anything else is later ruled. */}
      <Text style={styles.ageBlockBody}>
        Your date of birth wasn't stored and never left this device. We used it
        to answer that one question, and then it was gone.
      </Text>
      {/* ADDED WITH THE 2026-08 REORDER, and scoped to exactly what the reorder
          made provable — no further.
            "before the terms"  — the phase machine puts 'age' ahead of 'terms'
                                  and AgeGateScreen's onPass is the only writer
                                  of phase 'terms', so acceptTerms() cannot have
                                  fired for anyone reading this.
            "sent nothing to us" — the 'under' branch makes no api call and no
                                  analytics call, and every upstream phase
                                  writes device-local flags only.
          What it deliberately does NOT say: that no account exists, that no
          record of any kind exists, or that anything has been deleted. A user
          who signed in before onboarding has an auth_identities row, and this
          screen removes nothing. Do not broaden this sentence without being
          able to point at the code that makes the broader claim true. */}
      <Text style={styles.ageBlockBody}>
        We ask this before the terms, so you never agreed to anything — and
        answering it sent nothing to us.
      </Text>
      <Text style={styles.ageBlockClose}>
        Thank you for answering honestly.
      </Text>
      {canCorrect ? (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onCorrect();
          }}
          style={styles.ageBlockCorrect}
          accessibilityLabel="Correct my date of birth"
        >
          <Text style={styles.ageBlockCorrectText}>
            If you typed your date of birth wrong, correct it
          </Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }} />
    </ScrollView>
  );
}

// ---------- intake sub-components ----------
function StepWrap({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.stepWrap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>{title}</Text>
      {subtitle ? <Text style={styles.stepSubtitle}>{subtitle}</Text> : null}
      {children}
    </ScrollView>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}
function ChipRow({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {items.map((it) => {
        const on = value === it;
        return (
          <Pressable
            key={it}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(on ? '' : it); }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{it}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function MultiChips({ items, values, onToggle }: { items: string[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {items.map((it) => {
        const on = values.includes(it);
        return (
          <Pressable
            key={it}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onToggle(it); }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{it}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function CTA({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => { if (disabled) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}
      style={[styles.beginBtn, { marginTop: spacing.lg }, disabled && styles.beginBtnDisabled]}
      disabled={disabled}
    >
      <Text style={[styles.beginText, disabled && { opacity: 0.4 }]}>{label}</Text>
    </Pressable>
  );
}
function SkipLink({ onPress, label = 'Skip this' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} style={{ alignSelf: 'center', padding: 10, marginTop: 6 }}>
      <Text style={{ color: colors.creamFaint, fontSize: 12, letterSpacing: 0.5 }}>{label}</Text>
    </Pressable>
  );
}

// ============================================================================
// 4. EXPERIENCE LEVEL — single-select question, sits between intake and chat
// ============================================================================
function ExperienceLevelStep({
  onPick,
}: {
  onPick: (lvl: ExperienceLevel, isHard: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ScrollView contentContainerStyle={styles.expStepRoot} showsVerticalScrollIndicator={false}>
      <Text style={styles.expStepTitle}>Where are you in your journey?</Text>
      <Text style={styles.expStepBody}>
        This work meets you where you are. Let us know what feels closest to true
        for you right now — we'll adjust the experience to match. You can change
        this anytime in settings.
      </Text>

      {LEVEL_OPTIONS.map((opt) => {
        const isSelected = selected === opt.level;
        return (
          <Pressable
            key={opt.level}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setSelected(opt.level);
            }}
            style={[styles.expOption, isSelected && styles.expOptionSelected]}
          >
            <Text style={[styles.expOptionTitle, isSelected && styles.expOptionTitleSelected]}>
              {opt.title}
            </Text>
            <Text style={styles.expOptionSubtitle}>{opt.subtitle}</Text>
          </Pressable>
        );
      })}

      <Pressable
        onPress={() => {
          if (!selected) return;
          const opt = LEVEL_OPTIONS.find((o) => o.level === selected);
          if (!opt) return;
          const isHard = opt.level === 'hard';
          // The "hard place" option maps to curious AND triggers the resources screen.
          const lvl: ExperienceLevel = isHard ? 'curious' : (opt.level as ExperienceLevel);
          onPick(lvl, isHard);
        }}
        disabled={!selected}
        style={[styles.expContinueBtn, !selected && styles.expContinueBtnDisabled]}
      >
        <Text style={styles.expContinueText}>CONTINUE</Text>
      </Pressable>
    </ScrollView>
  );
}

// ============================================================================
// 5. RESOURCES — shown only when the user picked "I'm in a hard place".
// Real-world support pointers; does NOT block them from using the app.
//
// The screen itself now lives in components/safety/SupportResourcesScreen —
// moved out verbatim (copy, styles and CTA label unchanged) so that Settings
// can reach the SAME screen via /support-resources instead of restating the
// copy. Onboarding renders it exactly where it always did, with the same
// continue behaviour; only the file it lives in changed.
// ============================================================================

// ============================================================================
// 6. NOT-THERAPY — final moment before entering the app. A single quiet
// screen that names what Inner Map is and is not, in warm prose rather
// than legal disclaimer language. Shown for every experience level so
// the message lands once cleanly instead of being buried in fine print.
// ============================================================================
function NotTherapyScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.notTherapyRoot} showsVerticalScrollIndicator={false}>
      <View style={{ flex: 1 }} />
      <Text style={styles.notTherapyTitle}>One important thing</Text>
      <Text style={styles.notTherapyBody}>
        Inner Map is a companion for your inner journey — not a replacement
        for therapy or professional support. If you're going through
        something difficult, please have a real person in your life who can
        hold it with you. This works best alongside that support, not
        instead of it.
      </Text>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onContinue();
        }}
        style={[styles.beginBtn, { marginTop: spacing.xl, alignSelf: 'center' }]}
        accessibilityLabel="I understand"
      >
        <Text style={styles.beginText}>I  UNDERSTAND</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
    </ScrollView>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // welcome slides
  welcomeSlide: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  welcomeTitle: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 36, letterSpacing: 0.5,
    textAlign: 'center', marginBottom: spacing.md,
  },
  welcomeBody: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 24, textAlign: 'center', maxWidth: 400,
  },
  welcomeFoot: { paddingVertical: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },

  // terms
  termsRoot: { padding: spacing.xl, paddingBottom: spacing.xxl },
  termsTitle: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 30, marginBottom: spacing.md,
  },
  termsLead: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 22, marginBottom: spacing.lg,
  },
  termsHeading: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 2, marginBottom: spacing.sm,
  },
  termsBullet: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  termsDot: { color: colors.amber, fontSize: 14 },
  termsBulletText: { flex: 1, color: colors.cream, fontSize: 14, lineHeight: 22 },
  termsPrivacy: { color: colors.creamFaint, fontSize: 12, fontStyle: 'italic', marginTop: spacing.md, marginBottom: spacing.md, lineHeight: 18 },
  termsDocLinks: { color: colors.cream, fontSize: 14, lineHeight: 22, marginBottom: spacing.lg },
  termsDocLink: { color: colors.amber, fontFamily: fonts.sansBold, textDecorationLine: 'underline' },
  termsCheck: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.xl },
  checkbox: {
    width: 22, height: 22, borderRadius: 5,
    borderColor: colors.amberDim, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  checkmark: { color: colors.background, fontWeight: '700' },
  termsCheckLabel: { color: colors.cream, fontSize: 14, flex: 1, lineHeight: 20 },

  // intake
  stepDots: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingTop: spacing.sm },
  stepDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(230,180,122,0.2)' },
  stepDotActive: { backgroundColor: colors.amber, transform: [{ scale: 1.2 }] },
  stepDotDone: { backgroundColor: 'rgba(230,180,122,0.5)' },
  stepWrap: { padding: spacing.xl, paddingBottom: spacing.xxl },
  stepTitle: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 28, marginBottom: 8,
  },
  stepSubtitle: {
    color: colors.creamDim, fontFamily: fonts.serifItalic,
    fontSize: 15, marginBottom: spacing.lg,
  },
  field: { marginBottom: spacing.lg },
  fieldLabel: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 2, marginBottom: spacing.sm,
  },
  input: {
    color: colors.cream, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: colors.backgroundCard, borderRadius: radii.md,
    borderColor: colors.border, borderWidth: 1,
  },

  // Date of birth — three boxes on one row. Month and day are equal width;
  // the year takes 1.4 so "YYYY" isn't cramped against the two-digit boxes.
  dobRow: { flexDirection: 'row', gap: 10 },
  dobCell: { flex: 1 },
  dobCellYear: { flex: 1.4 },
  dobCellLabel: {
    color: colors.creamFaint, fontFamily: fonts.sans,
    fontSize: 10, letterSpacing: 1.5, marginBottom: 6,
  },
  dobInput: { textAlign: 'center', letterSpacing: 2 },
  // Invalid = a typo (Feb 30, a future date, year 1200). Amber, the app's own
  // attention colour — NOT red. Nothing here is a failure state; the user is
  // mid-sentence and we're pointing at a slip.
  dobInputInvalid: { borderColor: colors.amberDim },
  dobNote: {
    color: colors.creamFaint, fontFamily: fonts.sans,
    fontSize: 12, lineHeight: 18, marginTop: spacing.sm,
  },
  dobHint: {
    color: colors.amber, fontFamily: fonts.sans,
    fontSize: 12, lineHeight: 18, marginTop: 6,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.amberDim,
    backgroundColor: 'transparent',
  },
  chipOn: { backgroundColor: colors.amberFaint, borderColor: colors.amber },
  chipText: { color: colors.creamDim, fontSize: 13 },
  chipTextOn: { color: colors.amber, fontWeight: '600' },

  // begin button (shared)
  beginBtn: {
    alignSelf: 'center',
    borderWidth: 1.5, borderColor: colors.amber, borderRadius: radii.pill,
    paddingHorizontal: 40, paddingVertical: 14,
    shadowColor: colors.amber,
    shadowOpacity: Platform.OS === 'ios' ? 0.35 : 0,
    shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
    marginTop: spacing.lg,
  },
  beginBtnDisabled: { borderColor: colors.border, shadowOpacity: 0 },
  beginText: { color: colors.amber, fontSize: 12, fontWeight: '600', letterSpacing: 2 },
  disclaimer: {
    color: colors.creamFaint, fontSize: 11, fontStyle: 'italic', textAlign: 'center',
    marginTop: spacing.md, maxWidth: 320,
  },

  // Experience-level step. (The resources screen shared this block until it
  // was extracted to components/safety/SupportResourcesScreen, which carries
  // its own copy of the five values it used so both render identically.)
  expStepRoot: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxWidth: 600, alignSelf: 'center', width: '100%',
  },
  expStepTitle: {
    color: colors.cream, fontFamily: fonts.serifBold,
    fontSize: 28, letterSpacing: 0.3, marginBottom: spacing.md,
  },
  expStepBody: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 15, lineHeight: 23, marginBottom: spacing.lg,
  },
  expOption: {
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  expOptionSelected: {
    borderColor: colors.amber,
    backgroundColor: 'rgba(230,180,122,0.08)',
  },
  expOptionTitle: {
    color: colors.cream, fontFamily: fonts.sansBold,
    fontSize: 15, marginBottom: 4,
  },
  expOptionTitleSelected: { color: colors.amber },
  expOptionSubtitle: {
    color: colors.creamDim, fontFamily: fonts.sans,
    fontSize: 13, lineHeight: 19,
  },
  expContinueBtn: {
    alignSelf: 'center',
    paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5, borderColor: colors.amber,
    marginTop: spacing.lg,
    shadowColor: colors.amber, shadowOpacity: 0.35,
    shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
  },
  expContinueBtnDisabled: { borderColor: colors.border, shadowOpacity: 0 },
  expContinueText: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 12, letterSpacing: 2,
  },
  // (resCard / resCardLabel / resCardText moved with the resources screen to
  // components/safety/SupportResourcesScreen — nothing here used them.)

  // Not-therapy moment — vertically centered, generous breathing room,
  // single warm paragraph. Uses the shared beginBtn for the CTA so the
  // button language matches the rest of the onboarding flow.
  notTherapyRoot: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  notTherapyTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  notTherapyBody: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  // 18+ block screen — deliberately a sibling of notTherapy, not of any error
  // state. Same centered rhythm, same serif title, same generous vertical
  // padding, same cream-on-background palette. There is no red anywhere in
  // this block and no red should ever be added to it: this is a quiet closing
  // note, not a rejection notice.
  ageBlockRoot: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  ageBlockTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  ageBlockBody: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'center',
    letterSpacing: 0.2,
    marginBottom: spacing.md,
  },
  // Closing beat in the same italic serif the privacy notice uses for its
  // final line, so the screen ends warmly rather than trailing off.
  ageBlockClose: {
    color: colors.amber,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  // The single correction offer. Understated on purpose — a quiet underlined
  // line, not the amber pill CTA the rest of onboarding uses. The pill would
  // read as "the way forward" and invite a second guess; this reads as what it
  // is, a way to fix a typo.
  ageBlockCorrect: { alignSelf: 'center', padding: 12, marginTop: spacing.xl },
  ageBlockCorrectText: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },

  // Privacy notice — sibling of notTherapy in rhythm + typography
  // (centered, vertically padded, generous breathing). Body
  // paragraphs are slightly tighter and left-justified so the four
  // short statements read like a list rather than four centered
  // declarations.
  privacyNoticeRoot: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  privacyNoticeTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 32,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  privacyNoticeLede: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  privacyNoticeBody: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: spacing.md,
    letterSpacing: 0.1,
  },
  // Final "Inner work is private work…" line gets a slight italic
  // serif treatment so it lands as the closing beat rather than as
  // a fourth bullet.
  privacyNoticeClose: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    color: colors.amber,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  privacyNoticeLinks: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  privacyNoticeLink: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    textDecorationLine: 'underline',
  },
});
