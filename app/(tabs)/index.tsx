// Chat screen — the core conversation surface of Inner Map on mobile. Mirrors the web
// app's behavior end-to-end:
//   1. On mount, fetch the first-session status plus the current map state — to decide
//      the session phase (1-3) and which of the TWO CONSTANT openers to place. No
//      greeting is fetched; see "THE OPENING BUBBLE IS A CONSTANT" below.
//   2. User sends a message → stream the response from /api/chat and reveal it word
//      by word, pushing to both `history` (for next /api/chat body) and `messages`
//      (the on-screen list).
//   3. Parse CHAT_META mid-stream so the part-detection badge lands the instant the
//      marker arrives rather than waiting for the full reply.
//   4. Auto-scroll to bottom on every new message; dismiss keyboard when the user
//      swipes the messages list.
//   5. Persist transcripts via /api/sessions so the web-app session list still
//      includes conversations the user had in the native app.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  // KeyboardAvoidingView removed — keyboard avoidance is centralized in
  // utils/useKeyboardInset (Android resizes via the OS, iOS lifts
  // manually). See the useKeyboardInset() call below.
  Platform,
  Pressable,
  StyleSheet,
  Keyboard,
  Animated,
  Easing,
  Text,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { useRouter, useFocusEffect } from 'expo-router';

import { api, ChatMessage } from '../../services/api';
import type { BudgetRefusal } from '../../services/api';
import { getTopUpProduct, purchase } from '../../services/purchases';
import { parseChatMeta, parseAttentionStatePayload, stripMarkers, stripMarkersForDisplay, hasStarterMapComplete, holdBackBoundary } from '../../utils/markers';
import { setAttentionState, setNoticedPart, resetAttentionState, useAttentionState } from '../../utils/attentionState';
import { refreshInboxStatus } from '../../services/messagesInbox';
import { emitBeliefChanged } from '../../utils/beliefEvents';
// (Polish round 7) clearMapVoiceHistory removed alongside the
// services/mapVoiceHistory module — Map Voice is now turn-based
// and carries no client-side conversation history. The two
// session-boundary spots that used to call it are now no-ops.
const clearMapVoiceHistory = () => {};
// The ChatModeToggle COMPONENT is no longer rendered — it switched between two
// transcripts and there is one. Its ChatMode type survives as the wire vocabulary
// the server still speaks; see wireModeFor. The component file is left in place
// rather than deleted, because the four-prompt step decides its fate.
import type { ChatMode } from '../../components/ChatModeToggle';
import { PartConfidenceIndicator, PartConfidence } from '../../components/PartConfidenceIndicator';
import { colors, spacing } from '../../constants/theme';
import { AttentionIndicator } from '../../components/AttentionIndicator';
import { pulseMapTab } from '../../utils/mapPulse';
import { activatePartOnMap, ActivatablePart } from '../../utils/mapActivation';
import { subscribeRateLimitNotice } from '../../utils/rateLimitNotice';
import { consumePendingChatMessage } from '../../utils/pendingChatMessage';
import { consumePendingSessionResume } from '../../utils/pendingSessionResume';
import { MigrationModal, shouldShowMigrationModal, shouldShowGraceNudge } from '../../components/auth/MigrationModal';
import { markGraceNudgeShown } from '../../services/onboarding';
import {
  startStream as startTTSStream, appendStreamText as appendTTSStream,
  finishStream as finishTTSStream, cancelStream as cancelTTSStream,
  playMessageNow as playTTSNow,
} from '../../utils/ttsStream';
import { useKeyboardInset } from '../../utils/useKeyboardInset';
import { AudioToggle } from '../../components/AudioToggle';
import { CHAT_READ_ALOUD_ENABLED } from '../../constants/features';
import { useExperienceLevel } from '../../services/experienceLevel';
import { optimisticMarkUnseen } from '../../services/mapSeen';
import { setChatSessionActive } from '../../services/chatActivity';

import { MessageBubble, ChatMsg } from '../../components/MessageBubble';
import { SessionSummaryModal, SessionSummary, DeepenedPart } from '../../components/session/SessionSummaryModal';
import { TypingIndicator } from '../../components/TypingIndicator';
import { ChatInput } from '../../components/ChatInput';
import { WorkingModeControl, type WorkingMode } from '../../components/WorkingModeControl';
import { ConversationStarters } from '../../components/ConversationStarters';
import { EndSessionButton } from '../../components/EndSessionButton';
import { CrisisResourcesCard } from '../../components/safety/CrisisResourcesCard';
import { BudgetRefusalSheet } from '../../components/billing/BudgetRefusalSheet';
import { WarmRadialBackground } from '../../components/WarmRadialBackground';

// First-session orientation message (polish round 4, Part 3). Shown
// as the opening AI bubble for users whose firstSessionCompletedAt is
// still null. Once the user sends their first message the server's
// FIRST_SESSION_PROMPT takes over and the AI's generated replies
// continue the first-session work. After completion this is never
// shown again: STANDARD_OPENER below takes its place, on both threads,
// at every launch and every boundary. Those two constants are the whole
// opener set — see the block directly under this one.
const ORIENTATION_MESSAGE =
  "Welcome. Quick orientation:\n\n" +
  // FOUR MODES, in the person's words, never ours. The example sentences are
  // the load-bearing part: naming that modes exist teaches nothing, but showing
  // someone the actual words that work is what turns "there are modes" into
  // "I can ask". Two of these three are real sentences from real transcripts.
  "There are a few ways we can work. You can put something down and be heard. " +
  "We can stay with a feeling. We can look at the pattern underneath it. Or we " +
  "can take a belief apart and see whether it's actually true.\n\n" +
  "You don't have to choose now — I'll ask. And you can change it whenever: " +
  "\"can we slow down\", \"I just want to talk\", \"why does this keep happening\" " +
  "all work. Say it however it comes out. I'll follow.\n\n" +
  "I'll be more directive at first while we build your starter map. What we " +
  "build in this session is a rough sketch — it'll become sharper and more " +
  "accurate as we go. If something I name doesn't fit, say so. 'That's not " +
  "quite it' or 'It's more like X' is the most useful thing you can share.\n\n" +
  "Would you like to begin?";

// ===== THE OPENING BUBBLE IS A CONSTANT =====
// Founder decision, August 2026: the dynamic session-opening greeting is
// GONE. Not gated, not capped, not made safe — removed. Every non-first-ever
// user gets the string below, byte-identical, on BOTH threads, every launch
// and after every boundary.
//
// What this replaces: a server-generated callback off /api/returning-greeting
// ("picking up with someone who knows you"), a "Last time we explored X"
// template interpolating a part name, and a same-session variant for the
// window after [STARTER_MAP_COMPLETE]. Each of those asserted something about
// the user's history — a prior sitting, a date, a session count, a part named
// last time — and each assertion was a fabrication risk that five rounds of
// machinery (a length cap, structural JSON-leak guards, tense-separated refs,
// a counted opener gate, a first-session handoff) existed only to contain.
// With no dynamic input there is nothing to contain: no model call, no fetch,
// no payload, no cohort that can be told about a session that did not happen.
//
// THE INVARIANT, and it is the whole point: the opener has exactly two
// possible values and both are compile-time constants in this file.
//
//   ORIENTATION_MESSAGE — first-ever session (firstSessionPending === true)
//   STANDARD_OPENER     — everyone else, both threads, always
//
// Present tense is load-bearing, not styling. Do not add "last time", "when
// we spoke", "since you were here", a date, or a session count. Do not
// reintroduce a fetch here: if a future opener needs to be contextual, that is
// a product decision to be taken deliberately, and the guards that were
// deleted alongside this change (capGreeting, capPartLabel, the opener gate)
// would all have to come back with it. Leaving a hook for it "just in case" is
// how the machinery grew the first time.
//
// This string is the one 163 Explore sessions already opened on. It is the
// codified generic that every ladder in the old design fell through to, so it
// is not new copy — it is the rung that was always true.
const STANDARD_OPENER =
  "What's on your mind today?\n\n" +
  // THE INVITATION, placement 2 of 4. Measured before anything told people they
  // could ask: requests to work differently ran at 0.04% of 5,489 turns, and one
  // person asked anyway. That is ignorance, not absence — so the app says it.
  // The other three placements are the control's own label, the sheet's
  // footnote, and the end of the first reply.
  // STYLE, not mode. The second line of the opening turn already asks how they
  // want to be met; this one was gesturing at the same thing in vaguer words.
  // It names the three dials instead, and says the change persists.
  "You can ask for shorter, slower, or less explaining any time — I'll keep it that way.";

// THE ONLY OPENER SELECTOR IN THIS FILE. Four call sites place an opening
// bubble — boot (Process), the Explore seed effect, the End Session reset and
// the resume-lock break — and all four go through here, so the two threads
// cannot disagree about who this user is, and there is exactly ONE place to
// read to prove the opener is a constant. Its entire input is one tri-state
// boolean. It touches no ref, no state, no payload and no clock. `undefined`
// (status still settling) resolves to the standard opener, which is only
// reachable from the two boundary resets — boot and the seed effect both wait
// for the flag — and those two only happen to a user who has already been
// through a session.
function openerFor(firstSessionPending: boolean | undefined): string {
  return firstSessionPending === true ? ORIENTATION_MESSAGE : STANDARD_OPENER;
}

export default function ChatScreen() {
  // Persistent session id for this app launch (a fresh one per "session" like the web app).
  const sessionIdRef = useRef<string>(uuidv4());
  const scrollRef = useRef<ScrollView | null>(null);
  // Auto-scroll engagement gate (beta fix, July 2026): until the user has
  // actually participated in the conversation (sent text/voice, tapped a
  // starter, or resumed a session that already contains their turns), the
  // view must REST AT THE TOP — the opening greeting reads top-down. The
  // ScrollView's onContentSizeChange={scrollToBottom} otherwise fires on
  // the greeting bubble's first render and, when the greeting is taller
  // than the viewport, lands the user at its bottom.
  const hasEngagedRef = useRef(false);

  // ===== PER-MODE CONVERSATION THREADS =====
  // Process and Explore each maintain an independent thread within
  // the session. Switching modes pauses one and resumes the other;
  // both reset at end-of-session. They share map state and session
  // summaries underneath — those live on the server, keyed by
  // sessionId, not per-mode.
  //
  //   *Messages = on-screen list (may include a streaming bubble
  //               whose text grows word by word).
  //   *HistoryRef = wire-format history sent in each chat request.
  //                 Pushed to as turns finish.
  //
  // Helpers below pick the right pair via chatModeRef so callers
  // never have to remember which thread they're in. Streaming
  // turns capture the target thread at start so a mid-stream mode
  // switch never strands a reply in the wrong thread.
  // ONE THREAD. Until 2026-09-01 there were two — a Process transcript and an
  // Explore transcript, each with its own bubble list and its own wire history,
  // swapped by a top-of-screen toggle. Four working modes cannot sit on a
  // two-thread split, and the split had already produced a screen showing two
  // different mode vocabularies at once. Mode is now a STYLE OF REPLY, not a
  // different conversation, so there is one transcript and one history.
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const historyRef = useRef<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  // Mode for /api/chat — onboarding for brand-new users, ongoing once any core node is filled.
  const [mode, setMode] = useState<'onboarding' | 'ongoing'>('onboarding');
  const [sending, setSending] = useState(false);
  // Starter chips are STATIC. They used to be the third field off the
  // /api/returning-greeting completion ("grounded in the last session's
  // themes"), which made them a boundary claim in chip form — three of them,
  // rendered directly under the opening bubble. With the greeting gone the
  // chips go with it: ConversationStarters owns FALLBACK_STARTERS, which are
  // generic, present-tense and assert nothing, and passing no `starters` prop
  // is what selects them. Do not add a list here — that source is one file
  // over and a second copy is how two call sites drift.
  // Session-level audio mute/unmute. Default OFF — user opts in each session
  // by tapping the speaker icon in the chat header. When ON, every new AI
  // reply auto-plays via the streaming TTS pipeline. When the user mutes,
  // the in-flight stream cancels immediately. No per-message control.
  // Chat mode — Process (gentle holding) vs Explore (active
  // map-building, the default). The server uses this to pick
  // between HOLDING_SPACE_PROMPT and MAPPING_PROMPT.
  //
  // PR-Map-Visibility: default flipped from 'process' to 'explore'.
  // Rationale: the new mapping-acknowledgment loop (the
  // [ADDED_TO_MAP: …] pill + conversational ack) only fires in
  // Explore mode; landing users in Process by default hides the
  // map-building behavior the rest of the surface advertises.
  // The toggle is still visible; users can switch to Process any
  // time. Session-end reset (below in continueAfterSummaryRef)
  // re-initializes to 'explore' too — every fresh session starts
  // in the mode most likely to surface real map content.
  const [chatMode, setChatMode] = useState<ChatMode>('explore');

  // FOUR-MODE STATE (dev, step 1 of the build). workingMode is what the person
  // chose and what the labelled control above the input displays. chatMode is
  // the legacy two-thread axis that still drives which transcript renders and
  // which prompt the server picks.
  //
  // They are separate on purpose and only for now. The end state is ONE chat
  // with four prompts, at which point the two-thread split and chatMode both
  // go away and workingMode is the only axis. Collapsing the threads is a
  // real refactor — resume locks, per-thread seeding, End Session reset — and
  // doing it in the same step as the control would make a UI change and a
  // state-machine change indistinguishable if something broke.
  //
  // Light is the default, per founder ruling. First-session routing is
  // untouched: FIRST_SESSION_PROMPT still overrides mode entirely server-side.
  // DEFAULT IS "Understanding it" (founder ruling 2026-09-01, after using it).
  // Mapping is what the app is. Someone who wants lighter has a visible control
  // at the top of the screen and a line telling them they can just say so.
  const [workingMode, setWorkingMode] = useState<WorkingMode>('explore');
  // Mirrored into a ref for the same reason chatModeRef had one: a turn that
  // starts now must read the mode as it is now, not through a stale closure.
  const workingModeRef = useRef<WorkingMode>('explore');
  useEffect(() => { workingModeRef.current = workingMode; }, [workingMode]);

  // THE BRIDGE IS GONE FROM THE STATE MACHINE. workingMode is the only axis the
  // app reasons about; nothing branches on chatMode any more.
  //
  // What survives is a TRANSPORT DETAIL, and only at the single point where the
  // request is built: the server still speaks 'process' | 'explore', because the
  // four prompts do not exist yet — that is the next step. Translating once, at
  // the wire, is not a second source of truth. Sending 'differentiation' today
  // would silently fall through to the Process prompt on the server, which is
  // the kind of quiet mis-routing that is worse than an explicit map.
  //
  // Delete this function when the four prompts land and send workingMode raw.
  // THE COLLAPSE IS GONE. workingMode now goes to the server verbatim, because
  // the four prompts exist there and promptForMode understands all four names.
  // It was mapped before for a specific reason: sending "differentiation" to a
  // server that only knew process|explore fell through to Process SILENTLY, and
  // a quiet mis-route is worse than an explicit map.
  //
  // Safe for everyone else: with the four-mode flag off — which is everyone —
  // the server still resolves light and differentiation to holdingSpace exactly
  // as it did before, and smoke-four-mode-flag.js asserts that.
  function wireModeFor(w: WorkingMode): ChatMode {
    return w as unknown as ChatMode;
  }
  // chatModeRef mirrors chatMode so the thread helpers below can
  // resolve the active thread synchronously from any callback,
  // without relying on stale closures over the chatMode state.
  const chatModeRef = useRef<ChatMode>(chatMode);
  useEffect(() => { chatModeRef.current = chatMode; }, [chatMode]);

  // "The Explore thread has its opening bubble." Kept, and NOT part of the
  // greeting machinery: it is the synchronous guard against double-seeding.
  // setMessages is async, so the length check in the seed effect can
  // still read stale on a re-run that happens before the state commits (the
  // firstSessionPending flip is exactly such a re-run).
  //
  // It is only ever set TRUE, never re-armed, because every place that empties
  // the Explore thread REFILLS it on the same lines: both boundary resets seed
  // both threads by hand, and the resume consumer hydrates the transcript
  // instead of seeding. Nothing can leave this true over an empty thread, so
  // there is no state to re-arm.
  const greetedRef = useRef<boolean>(false);
  // Resume mode-lock (conversation continuation). Set when a past session
  // is reopened via pendingSessionResume; holds the locked mode. Non-null
  // also tells the boot effect to skip its opening greeting (we hydrate the
  // transcript instead) and tells handleModeChange that switching modes
  // must mint a FRESH conversation rather than let the other thread save
  // into — and clobber — the reopened row (both threads share sessionIdRef).
  const resumeLockedModeRef = useRef<ChatMode | null>(null);

  // threadFor() is gone with the second thread. It existed to lock a streaming
  // turn onto the transcript it started in, so that a mid-stream mode switch
  // could not redirect a reply into the other one. With a single transcript
  // there is no wrong destination, and every call site now writes straight to
  // `setMessages` / `historyRef`.
  //
  // The `messages` / `historyRef` shorthands are gone for the same
  // reason: there is no inactive thread to distinguish them from.
  const threadFor = () => ({ setMessages, historyRef });

  // Live part-confidence indicator state (Explore mode only). Updated
  // when MAP_UPDATE markers fire on the assistant stream. Auto-clears
  // a few seconds after a 'confirmed' fires so the indicator returns
  // to its hidden state, ready for the next detection.
  const [livePart, setLivePart] = useState<string | null>(null);
  const [liveConfidence, setLiveConfidence] = useState<PartConfidence | null>(null);
  const livePartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One-shot guard for the end-of-session NOTICED gathering ask. Flips
  // true on the first End Session tap (whether or not items existed) so
  // the second tap always proceeds to the summary; reset on session reset.
  const gatheredNoticedRef = useRef(false);
  // STOP control (build 14). abortStreamRef holds the streamChat abort fn
  // for the in-flight turn; stopTurnRef holds a closure that aborts AND
  // finalizes the partial reply (keeping the prose generated so far). Both
  // are set inside runAssistantTurn once the stream starts and nulled when
  // the turn ends. The composer shows a Stop button while `sending`.
  const abortStreamRef = useRef<null | (() => void)>(null);
  const stopTurnRef = useRef<null | (() => void)>(null);
  const stopStreaming = useCallback(() => {
    stopTurnRef.current?.();
  }, []);
  // Drives the centerSlot swap: AttentionIndicator triangle during
  // generation, part-confidence ring otherwise — in both chat modes.
  const attentionState = useAttentionState();
  const isGenerating =
    attentionState === 'thinking' || attentionState === 'streaming' || attentionState === 'detected';
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioEnabledRef = useRef(audioEnabled);
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);

  // Transient inline notice for the daily TTS cap. When /api/speak
  // returns 429, services/api.ts fires a rate-limit notice on the
  // shared bus; we render a brief amber-bordered banner above the
  // input area and auto-dismiss after ~5 seconds. Chat-side 429s
  // are handled separately as a card inline in the conversation
  // flow (StreamCallbacks.onRateLimit path).
  const [speakNoticeText, setSpeakNoticeText] = useState<string | null>(null);
  // Crisis enforcement (June 2026). When the server gates a turn
  // (crisis_detected on the /api/chat response), exploration STOPS: the
  // composer is blocked, the crisis resources surface, and the only action
  // is "I understand" → api.acknowledgeCrisis() which clears the server
  // gate and reopens the composer. Detection is unconditional server-side,
  // so if crisis content reappears after acknowledging, the gate re-fires.
  const [crisisGated, setCrisisGated] = useState(false);
  const [crisisAcking, setCrisisAcking] = useState(false);
  // Budget cap (payments 3f). The server-authored refusal for the turn it
  // just refused; non-null means the sheet is up. Every string rendered
  // comes off this object verbatim — the client authors none of that copy.
  //
  // CRISIS PRECEDENCE. The server never sends both for one turn (crisis is
  // decided before any budget check), but the client must not be the place
  // that breaks the invariant either, so the two states are ordered here as
  // well as on the server:
  //   • onCrisis clears any refusal — a safety surface is never covered by
  //     a billing sheet.
  //   • onBudgetExhausted is a no-op once crisis fired for this turn
  //     (crisisFired, captured per-turn inside runAssistantTurn) and the
  //     sheet's `visible` is additionally gated on !crisisGated, so a stale
  //     refusal can't surface on top of the gate.
  const [budgetRefusal, setBudgetRefusal] = useState<BudgetRefusal | null>(null);
  // Mirror of the state above, readable from inside the top-up handler after it
  // has awaited a multi-second store round trip. "Not now" stays live during
  // that wait by design, so the sheet may be gone by the time we resolve — and
  // the captured `budgetRefusal` closure would still say otherwise.
  const budgetRefusalRef = useRef<BudgetRefusal | null>(null);
  useEffect(() => { budgetRefusalRef.current = budgetRefusal; }, [budgetRefusal]);
  // Store round-trip state. TWO things, doing two different jobs:
  //   • topUpBusyRef — the SYNCHRONOUS re-entrancy guard. setState is async,
  //     so only a ref can block a second tap landing in the same tick.
  //   • topUpBusy    — the RENDERED state. The ref alone changed nothing on
  //     screen, so the button sat fully styled and fully tappable through a
  //     multi-second cold-SDK round trip while repeat taps were swallowed in
  //     silence. This is what puts the sheet's primary button into its
  //     spinner/disabled state; the sheet stays up because StoreKit's own UI
  //     is presented in front of it.
  // Both are cleared in handleBudgetTopUp's finally, on every path.
  const topUpBusyRef = useRef(false);
  const [topUpBusy, setTopUpBusy] = useState(false);
  // The sheet can be dismissed — and this screen torn down — while the
  // purchase is still in flight, so the finally block below must not setState
  // into an unmounted tree.
  // Re-armed on mount (not just cleared on unmount) so a remount — Fast
  // Refresh, or a future StrictMode double-invoke — can't leave it latched
  // false and silently swallow every later setState.
  const topUpMountedRef = useRef(true);
  useEffect(() => {
    topUpMountedRef.current = true;
    return () => { topUpMountedRef.current = false; };
  }, []);
  useEffect(() => {
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeRateLimitNotice((notice) => {
      if (notice.endpoint !== 'speak') return;
      setSpeakNoticeText(notice.message);
      if (dismissTimer) clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => setSpeakNoticeText(null), 5000);
    });
    return () => {
      unsub();
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, []);
  // Latest messages snapshot accessible from the toggle handler without
  // hitting React's stale-closure trap. Updated on every render — cheap.
  // Always points at the ACTIVE thread's messages, since the audio
  // toggle is a per-active-thread concern.
  const messagesRef = useRef<ChatMsg[]>([]);
  useEffect(() => { messagesRef.current = messages; });
  function toggleAudio() {
    const wasOn = audioEnabledRef.current;
    console.log('[tts] toggleAudio fired —', wasOn ? 'ON→OFF' : 'OFF→ON', '(prev audioEnabledRef=' + wasOn + ')');
    if (wasOn) {
      cancelTTSStream();
      setAudioEnabled(false);
      console.log('[tts] toggleAudio done — audioEnabledRef now=false');
      return;
    }
    // Flipping from OFF→ON. Set the ref synchronously so the next AI
    // turn's `streamingTTSStarted` capture sees the new value even if
    // the user sends a message before React's re-render lands.
    audioEnabledRef.current = true;
    setAudioEnabled(true);
    console.log('[tts] toggleAudio done — audioEnabledRef now=true (synchronous)');
    // SELECTION RULE — play the last AI message that arrived BEFORE
    // the user's most recent turn. Anything the AI says AFTER the
    // user's last message is either (a) currently streaming and will
    // get picked up by the live TTS path on its own, or (b) already
    // played out as part of a previous turn. We never want to replay
    // the very latest AI bubble when the user has already moved on
    // — that would feel like it's lecturing them after the fact.
    const list = messagesRef.current;

    // Find the index of the user's most recent message.
    let lastUserIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') { lastUserIdx = i; break; }
    }

    // Find the target AI message:
    //   - If the user has spoken at least once, scan BACKWARD from
    //     just before the last user message and pick the most recent
    //     finished assistant bubble before it.
    //   - If no user message yet (fresh session, only the AI's
    //     greeting is on screen), DO NOT auto-play. The opening
    //     greeting is meant to land as quietly-displayed text — audio
    //     should only kick in once the user has actually engaged the
    //     conversation, so the app doesn't talk at them on launch
    //     before they've decided whether they're ready for it.
    const targetAI = (() => {
      // No user message yet → skip auto-play of the greeting entirely.
      // Subsequent AI replies will pick up audio through the
      // streamingTTSStarted capture in runAssistantTurn — the toggle
      // is now ON, the next turn will hear it.
      if (lastUserIdx === -1) return null;
      const startIdx = lastUserIdx - 1;
      for (let i = startIdx; i >= 0; i--) {
        const m = list[i];
        if (m.role === 'assistant' && !m.streaming && m.text && m.text.trim()) return m;
      }
      return null;
    })();
    console.log(
      '[tts] toggleAudio enable — lastUserIdx=', lastUserIdx,
      'target=', targetAI ? `id=${targetAI.id.slice(0, 8)} chars=${targetAI.text.length}` : '(none)',
    );
    if (targetAI) {
      // Belt-and-braces: hard-stop anything currently playing or
      // queued before kicking off the toggle-on replay. playTTSNow
      // already calls cancelStream() internally, but doing it here
      // too means there's no observable window where two audio
      // streams could overlap (toggle on vs streamingTTSStarted from
      // a prior turn).
      cancelTTSStream();
      playTTSNow(targetAI.id, targetAI.text).catch((e) =>
        console.warn('[tts] playMessageNow threw:', (e as Error)?.message),
      );
    }
    // Subsequent AI replies will auto-play through the existing
    // streamingTTSStarted capture in onSendText / onSendVoice — no
    // additional wiring needed.
  }
  // Experience level — drives which voice mode the AI uses on the server.
  // Synced from AsyncStorage; updates immediately when changed in settings.
  const experienceLevel = useExperienceLevel();
  // End-session transition. When the user commits, we fade the messages out
  // then cross-fade a centered "Your map has been updated." overlay in for a
  // beat, then fade that out and reload the fresh session. Done with RN
  // Animated because we're driving straight View opacities.
  const [endingTransition, setEndingTransition] = useState(false);
  const messagesOpacity = useRef(new Animated.Value(1)).current;
  const transitionOpacity = useRef(new Animated.Value(0)).current;
  // Session summary screen — opens when the user confirms End Session.
  // `summary` is null while the fetch is in flight (modal shows loader);
  // gets the structured 3-part object once /api/session-summary resolves.
  // `summaryFailed` flips true on transport / 500 so the modal can show
  // the warm fallback line. The "Begin New Session" tap is what actually
  // resets the chat — the summary screen blocks reset until then.
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  // "What deepened this session" — parts that gained facets (consent-gated
  // enrichment). Fetched at session end, rendered quietly in the summary modal.
  const [deepened, setDeepened] = useState<DeepenedPart[]>([]);

  // First-session state. Tri-state:
  //   undefined  — initial / loading from /api/first-session-status
  //   true       — server says firstSessionCompletedAt is null → show
  //                "Building your starter map" banner, route through
  //                FIRST_SESSION_PROMPT, listen for [STARTER_MAP_COMPLETE]
  //   false      — server says first session is done → regular UI,
  //                regular prompt routing
  // The router is also stashed here because it's used by the
  // "View my starter map" CTA on the completion bubble.
  const [firstSessionPending, setFirstSessionPending] = useState<boolean | undefined>(undefined);
  const router = useRouter();
  // NOTE: there is no second effect fetching this. /api/first-session-status
  // used to be called TWICE at boot — here, wrapped in a retry that could
  // never fire, and again inside the boot Promise.all with no resilience at
  // all. The un-retried copy was the one that decided whether the server's
  // Explore callback was published or discarded, so the resilience sat on the
  // call whose answer mattered least. Both are now the single retrying call in
  // the boot effect below, which also owns setFirstSessionPending.

  // Build 11 — soft migration prompt for existing anonymous testers.
  // Probe /api/auth/identities once on mount; if empty AND the user
  // hasn't made a sign-in choice yet, surface MigrationModal. The
  // probe is fire-and-forget — a transport failure leaves the modal
  // closed so we don't trap an offline user behind it.
  const [migrationVisible, setMigrationVisible] = useState(false);
  // Phase 2c — when the prompt is the gentle grace-window reminder (vs the
  // Build-10 migration prompt) we force the modal soft so it never escalates
  // or traps a user who already chose anonymous.
  const [nudgeForceSoft, setNudgeForceSoft] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // First: the Build-10 migration prompt (unresolved sign-in choice).
        if (await shouldShowMigrationModal()) {
          if (!cancelled) { setNudgeForceSoft(false); setMigrationVisible(true); }
          return;
        }
        // Else: the gentle grace-window nudge for already-anonymous users.
        if (await shouldShowGraceNudge()) {
          if (!cancelled) {
            setNudgeForceSoft(true);
            setMigrationVisible(true);
            // Stamp the throttle the moment we decide to show it.
            await markGraceNudgeShown();
          }
        }
      } catch { /* probe failure → no modal */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Wired to the "View my starter map" button on the completion bubble.
  // Just a tab nav — the Map tab's own mount logic refreshes its data
  // when it becomes the active route.
  const handleViewStarterMap = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    router.push('/map');
  }, [router]);
  // Held continuation that runs the actual reset when the user dismisses
  // the summary modal. Captured inside the EndSession onEnd handler so
  // it has access to the closure (snapshots of cancelTTSStream / etc).
  const continueAfterSummaryRef = useRef<(() => Promise<void>) | null>(null);
  // Safe-area top inset + top-bar chrome height — used as keyboardVerticalOffset
  // so the KeyboardAvoidingView pushes the input bar exactly above the keyboard
  // without leaving a gap or going too far.
  const insets = useSafeAreaInsets();

  // Tab-level cleanup — stop any playing clip, cancel any in-flight
  // streaming-TTS queue, flip audio mode off, and reset the ambient
  // attention indicator to 'quiet' when the chat screen unmounts. None
  // of those should leak across tab switches.
  useEffect(() => () => {
    cancelTTSStream();
    resetAttentionState();
  }, []);

  // Map-voice conversation history is held at module scope so it
  // persists across tab nav within a session. We clear it whenever the
  // chat sessionId changes — a fresh chat session means the map voice
  // should also start clean. Fires on initial mount AND every time
  // sessionIdRef.current changes after end-session below.
  const sessionIdSeed = sessionIdRef.current;
  useEffect(() => {
    clearMapVoiceHistory();
  }, [sessionIdSeed]);

  // ===== BOOT =====
  // Two fetches, both of which the OPENER no longer depends on:
  //
  //   getFirstSessionStatus — decides ORIENTATION_MESSAGE vs STANDARD_OPENER,
  //     and drives the "Building your starter map" banner + the CTA.
  //   getLatestMap          — onboarding-vs-ongoing prompt routing only.
  //
  // The third call that used to sit here (getReturningGreeting) is gone, and
  // with it the whole readiness apparatus: there is no async value the opener
  // waits on any more, so there is no gate to hold, nothing to sequence, and
  // no window in which a mode toggle can seed from a half-filled ref.
  //
  // WHAT IS STILL LOAD-BEARING, and it never depended on the greeting: this
  // effect owns `typing`. setTyping(true) runs synchronously at the top;
  // setTyping(false) sits at the BOTTOM of an async body, behind an await. A
  // throw anywhere between the two — and everything after the await is
  // unpoliced `any` off the wire — leaves the spinner running forever with an
  // empty thread behind it. That is a blank-launch path with no greeting in
  // it, so the .catch/.finally below STAYS. setTyping(false) is a
  // set-to-constant and therefore idempotent: on a normal boot the finally is
  // a no-op.
  useEffect(() => {
    setTyping(true);
    (async () => {
      let map: any = null;
      // First-session status is fetched alongside the map so the opening
      // bubble can be the orientation message without a second round-trip or
      // a flash of the wrong copy.
      let firstStatus: { completedAt: string | null; ok: boolean } = { completedAt: null, ok: false };
      try {
        [map, firstStatus] = await Promise.all([
          api.getLatestMap(),
          // ONE attempt, deliberately. This sits inside the Promise.all that
          // gates the whole opening screen — setTyping(false) and the Process
          // opener both wait on it — so anything serial in here is added
          // directly to a blank app. The retry that used to be here (25s +
          // 1200ms + 25s) doubled the worst case to ~51s to buy a second shot
          // at an answer whose failure direction is the mild one (see below).
          // As a single call it is bounded by the same 25s apiFetch timeout as
          // the fetch beside it, so it can never be the long pole.
          api.getFirstSessionStatus(),
        ]);
      } catch (err) {
        console.warn('[chat] boot fetch failed:', (err as Error)?.message);
      }
      // ===== "IS THIS PERSON NEW?" — AND WHAT TO DO WHEN WE CANNOT TELL =====
      // `completedAt == null` is an ANSWER only when firstStatus.ok is true.
      // On a failure it is a placeholder, and the two wrong answers are not
      // symmetric:
      //
      //   Wrong TRUE (returning user treated as new) — an orientation they do
      //   not need. Everything on screen is still TRUE; it is redundant and
      //   mildly condescending, and it is repaired by the next launch.
      //
      //   Wrong FALSE (first-ever user treated as returning) — they are routed
      //   past the orientation entirely, so their first-ever session opens with
      //   no explanation of what the two modes are or what is about to happen,
      //   and a first-ever session cannot be re-run.
      //
      // ON TRANSPORT FAILURE WE FAIL TOWARD FIRST-EVER. (The stakes here are
      // lower than they were — with a constant opener, "returning" no longer
      // unlocks a callback that could assert a session that never happened —
      // but the orientation is still the thing a genuinely new user must not
      // be denied, so the direction stands.)
      //
      // A map-content fallback was tried here — infer "returning" from the
      // presence of parts rows when the status endpoint is unreachable — and it
      // is DELETED, not weakened, because the predicate cannot hold:
      // prompts/firstSession.js requires >=2 MAP_UPDATE/ADDED_TO_MAP entries
      // BEFORE [STARTER_MAP_COMPLETE] may be emitted, so parts rows exist
      // through the back half of EVERY first session. "Parts from a finished
      // session" and "parts from the first session I am still inside" are the
      // same payload. Mid-first-session relaunch + a status failure therefore
      // read as RETURNING: the "Building your starter map" banner never
      // renders, while the server still routes the turn through
      // FIRST_SESSION_PROMPT (firstSessionCompletedAt is null) — so the model
      // runs orientation with the orientation hidden. There is one authority on
      // whether a first session has ever completed, it is this endpoint, and
      // when it does not answer we take the mild wrong answer.
      const isFirstSession = firstStatus?.completedAt == null;
      if (firstStatus?.ok !== true) {
        console.warn('[chat] first-session status unresolved — showing orientation (fail-toward-first-ever)');
      }
      // PUBLISHED IMMEDIATELY, with nothing between it and the catch above that
      // could throw. The Explore seed effect's one remaining guard is
      // `firstSessionPending === undefined`, so this write is the only thing
      // standing between a mode toggle and an empty Explore thread. Keep it
      // here, at the top, ahead of all the map/mode derivation below.
      setFirstSessionPending(isFirstSession);

      const md = map?.mapData || map || {};
      // Onboarding-vs-ongoing decision: "any core node filled" means
      // the user has clinically meaningful map content somewhere in the
      // system. Two storage paths can deposit it independently:
      //
      //   1. Legacy flat-shape on the session's mapData blob — populated
      //      when MAP_READY fires. mapData.{wound|fixer|skeptic} are
      //      short strings. This is the only path the original check
      //      knew about.
      //
      //   2. Parts table — populated by the new MAPPING prompt's
      //      MAP_UPDATE markers. A confirmed wound lands here even when
      //      MAP_READY never fires (e.g. the AI maps the wound through
      //      the bridge-to-wound move without ever consolidating into
      //      the legacy flat shape). The wound row has a non-empty
      //      corePhrase OR a markerFields.belief.value entry; same
      //      shape for fixer.pattern and skeptic.pattern.
      //
      // Falling back to onboarding when only path #2 is populated was
      // routing returning users into the onboarding prompt and silently
      // disabling Explore-mode features (the prompt selector picks
      // HOLDING_SPACE in onboarding mode regardless of chatMode). Now
      // either path counts.
      const partsArr: any[] = Array.isArray(map?.parts) ? map.parts : [];
      const partsFilled = partsArr.some((p) => {
        if (!p || !p.category) return false;
        const cat = String(p.category).toLowerCase();
        if (cat !== 'wound' && cat !== 'fixer' && cat !== 'skeptic') return false;
        if (typeof p.corePhrase === 'string' && p.corePhrase.trim()) return true;
        // markerFields shape: { [field]: { value, confidence, ts } }
        const mf = p.markerFields && typeof p.markerFields === 'object' ? p.markerFields : {};
        for (const v of Object.values(mf)) {
          const val = (v as any)?.value;
          if (typeof val === 'string' && val.trim()) return true;
        }
        return false;
      });
      const flatFilled = ['wound', 'fixer', 'skeptic'].some((k) => !!md?.[k]);
      const anyCoreFilled = flatFilled || partsFilled;
      const chosenMode = anyCoreFilled ? 'ongoing' : 'onboarding';
      console.log(
        '[mode]', chosenMode,
        'anyCoreFilled:', anyCoreFilled,
        '(flat:', flatFilled, 'parts:', partsFilled + ')',
        'mapData:', JSON.stringify(md).slice(0, 200),
      );
      setMode(chosenMode);

      // Seed ONLY the Process thread here. This is NOT the landing thread:
      // THE ONLY SEED PATH AT BOOT. There used to be two — this one filled the
      // Process thread by hand while an effect filled Explore — and keeping two
      // mechanisms honest across four session boundaries is what produced the
      // blank-screen bugs the comments below and in the End Session reset
      // describe. One transcript, seeded here, and the seed effect that used to
      // fill the other one is gone.
      const finalGreeting = openerFor(isFirstSession);
      // Skip the opener if a session resume already hydrated the transcript
      // (cold-start race: the resume focus-effect can land mid-boot). The
      // lock ref is set synchronously by the resume consumer.
      if (!resumeLockedModeRef.current) {
        greetedRef.current = true;
        addAssistantMessage(finalGreeting);
        historyRef.current.push({ role: 'assistant', content: finalGreeting });
      }
      setTyping(false);

    })()
      .catch((err) => {
        // Nothing above is ALLOWED to throw, but "allowed" is not "cannot" —
        // `map` is typed `any` at the api.ts boundary and this effect owns the
        // whole opening screen. A silent throw here costs the launch: no
        // opener on either thread and a typing spinner that never clears.
        console.warn('[chat] boot effect threw:', (err as Error)?.message);
      })
      .finally(() => {
        // BACKSTOP for the spinner, not the happy path. This is the surviving
        // half of the old boot-hold work and it does NOT depend on the
        // greeting: setTyping(false) sits behind an await, so without this a
        // throw in the sync derivation leaves the app spinning forever.
        setTyping(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== PENDING CHAT MESSAGE CONSUMER =====
  // Cross-tab handoff for "Establish your belief" in PartFolderModal:
  // the button arms a prefilled chat message + target mode via
  // utils/pendingChatMessage, then routes here. Round 9 fix —
  // previously we consumed inside the mount effect, but Expo Router
  // tabs stay mounted, so warm navigation (Map → Chat) never re-fired
  // the consumer and the prefill sat unused. useFocusEffect fires on
  // EVERY tab focus, cold and warm.
  //
  // chatModeRef is updated synchronously alongside setChatMode so
  // handleSend reads the correct mode the moment it runs, instead of
  // waiting for the chatModeRef-sync effect to commit on the next
  // render. setTimeout(0) defers the actual send by one tick so React
  // commits the chatMode UI flip before the prefill bubble lands —
  // the user briefly sees the right mode toggle active, then their
  // message appears.
  useFocusEffect(
    React.useCallback(() => {
      const pending = consumePendingChatMessage();
      if (pending && pending.text) {
        chatModeRef.current = pending.mode;
        setChatMode(pending.mode);
        setTimeout(() => { handleSend(pending.text); }, 0);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // ===== PENDING SESSION RESUME CONSUMER =====
  // Cross-tab handoff for "Continue this conversation" (SessionDetailModal,
  // gated by SESSION_RESUME_ENABLED). Hydrates the matching thread with the
  // past transcript, points sessionIdRef at the reopened row so subsequent
  // turns APPEND to it, and LOCKS the session to its saved mode (see
  // handleModeChange). Mirrors the partner-chat resume hydration, but for a
  // specific user-chosen past session. Like the pending-message consumer it
  // runs on EVERY focus so warm navigation (Journey → Chat) fires it too.
  useFocusEffect(
    React.useCallback(() => {
      const resume = consumePendingSessionResume();
      // LENGTH, not just shape. SessionDetailModal.handleContinue strips markers,
      // trims and filters empties before arming this, so a session whose stored
      // rows were all markers/whitespace arms an EMPTY array — which is a valid
      // array and passed this guard. What followed was the blank screen: both
      // threads cleared below, the Explore latch set true, resumeLockedModeRef
      // set (which suppresses boot's opener), and then nothing hydrated. Both
      // threads empty for the whole session, escapable only by toggling mode.
      // Bailing here leaves boot to place the constant opener as usual.
      // EVERY COHORT GETS A BUBBLE — that is the invariant this whole revert is
      // built on, and an empty resume payload was the one path out of it.
      if (!resume || !resume.sessionId || !Array.isArray(resume.messages) || resume.messages.length === 0) return;
      const mode: ChatMode = resume.mode === 'process' ? 'process' : 'explore';
      // Clear the transcript so a boot greeting or prior content can't bleed
      // into the reopened conversation, then hydrate it from the saved rows.
      setMessages([]);
      historyRef.current = [];
      greetedRef.current = true; // we hydrate instead of seeding an opener

      const bubbles: ChatMsg[] = [];
      const wire: ChatMessage[] = [];
      for (const m of resume.messages) {
        const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant';
        const text = (m.content || '').trim();
        if (!text) continue;
        bubbles.push({ id: uuidv4(), role, text });
        wire.push({ role, content: text });
      }
      const t = threadFor();
      t.setMessages(bubbles);
      t.historyRef.current = wire;
      // A resumed session that already contains the user's own turns is an
      // engaged conversation — landing at the bottom (most recent) is right.
      if (bubbles.some((b) => b.role === 'user')) hasEngagedRef.current = true;

      sessionIdRef.current = resume.sessionId;
      resumeLockedModeRef.current = mode;   // lock + suppress boot greeting
      chatModeRef.current = mode;
      setChatMode(mode);
      setMode('ongoing');                   // a resumed session is never onboarding
      setTimeout(() => scrollToBottom(), 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // ===== EXPLORE OPENING BUBBLE =====
  // Seeds the Explore thread once per session. Runs when chatMode IS explore AND
  // the explore thread is empty AND we haven't already seeded this session.
  //
  // Explore is the DEFAULT landing mode, so on a normal launch this is not a
  // "user switched" path: chatMode is already 'explore' at mount, the effect
  // runs, bails on the undefined-flag guard, and re-runs to seed the moment boot
  // publishes firstSessionPending. The toggle-into-Explore case is the same
  // effect on a later render — it is only reachable when the user has switched
  // to Process and back before the flag ever landed.
  //
  // TWO CONSTANTS, ONE FLAG. There is no ladder here any more — no server
  // callback, no recent-part template, no same-session variant, no generic
  // last resort. Explore and Process place the SAME string for the same
  // cohort, chosen by the same `firstSessionPending`, so the two threads
  // cannot disagree about who this user is.
  //
  // The old readiness gate (bootGreetingReady) is gone with the fetch it
  // sequenced. The `firstSessionPending === undefined` guard below is what is
  // left of the wait, and it is a different thing: it stops a fast toggle from
  // showing a returning-user opener to someone who turns out to be first-ever.
  // Returning early WITHOUT latching means the effect re-runs and seeds once
  // the status lands.
  useEffect(() => {
    // BLANK-SCREEN BACKSTOP, not the seed path. Boot seeds the transcript and
    // the resume consumer hydrates it; this only fires if neither did, which is
    // the one failure a person actually feels — a chat with nothing in it and
    // no way back. It cannot double-seed: both other paths set greetedRef
    // synchronously before they write.
    if (greetedRef.current) return;
    if (messages.length > 0) return;
    if (firstSessionPending === undefined) return;
    greetedRef.current = true;
    const opener = openerFor(firstSessionPending);
    console.log(
      `[chat] BACKSTOP seeded the transcript — boot and resume both left it empty (${firstSessionPending === true ? 'first-session orientation' : 'standard'} opener)`,
    );
    const id = uuidv4();
    setMessages((prev) => [...prev, { id, role: 'assistant', text: opener }]);
    historyRef.current.push({ role: 'assistant', content: opener });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstSessionPending, messages.length]);

  // Manual keyboard-height lift — replaces the prior KeyboardAvoidingView
  // approach (build 13 Android-keyboard fix). KAV's behavior='height'
  // mode is unreliable on Android: on real devices + emulators (verified
  // 1080x2400 Android emulator, version code 10+) the input bar stayed
  // hidden behind the system keyboard. Partner chat already uses this
  // same manual pattern successfully on both platforms — porting it
  // here gives us:
  //   - iOS: keyboardWillShow fires BEFORE the animation, kbHeight
  //     lift starts on the same frame the keyboard begins rising →
  //     no perceptible gap.
  //   - Android: keyboardDidShow fires after the keyboard is fully
  //     up (Android doesn't emit Will events). The lift happens in
  //     a single instant, no visible lag.
  //   - endCoordinates.height includes the iOS suggestion bar when
  //     visible, so the input clears that too (which the old KAV
  //     keyboardVerticalOffset tuning never did reliably).
  // scrollToEnd on show is kept inside the same effect — without it,
  // the ScrollView keeps its contentOffset and the last 1-2 messages
  // slide under the now-smaller view area.
  // Keyboard avoidance — centralized in utils/useKeyboardInset. kbHeight is
  // the live keyboard height on BOTH platforms: Android's adjustResize is a
  // no-op under edge-to-edge, so we lift the dock manually exactly as on iOS
  // (applied as paddingBottom on the bottom dock below). onShow scrolls the
  // thread to the latest message — engagement-gated: tapping the input to
  // type BEFORE participating must not bottom-scroll past the greeting
  // (that would re-create the greeting-scrolled-away bug at the exact
  // moment of engagement).
  const kbHeight = useKeyboardInset({
    onShow: () => {
      if (!hasEngagedRef.current) return;
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    },
  });

  // ===== MESSAGE HELPERS =====
  // Both helpers target the ACTIVE thread via chatModeRef. Callers
  // that need to target a specific thread (e.g. boot seeding the
  // Process thread before any chatMode state has settled) should use
  // the mode-suffixed variants (addAssistantMessageToProcess, etc.).
  function addAssistantMessage(text: string, meta?: { detectedPart?: string; partLabel?: string | null }): string {
    const id = uuidv4();
    const t = threadFor();
    t.setMessages((prev) => [
      ...prev,
      {
        id,
        role: 'assistant',
        text,
        detectedPart: meta?.detectedPart,
        partLabel: meta?.partLabel,
      },
    ]);
    scrollToBottom();
    return id;
  }

  // The mode-targeted variant is gone. It existed to guarantee a message landed
  // in the Process thread specifically, which is not a thing that can be true
  // any more — boot and the end-session reset both use addAssistantMessage
  // above, because there is only one place a message can land.

  function addUserMessage(text: string) {
    hasEngagedRef.current = true;
    const t = threadFor();
    t.setMessages((prev) => [...prev, { id: uuidv4(), role: 'user', text }]);
    scrollToBottom();
  }

  // User-driven mode switch (the ChatModeToggle). Normally just flips the
  // active thread. But if a RESUMED session is active it's locked to its
  // original mode — both threads share sessionIdRef, so letting the other
  // thread save would clobber the reopened row. Switching away therefore
  // CONCLUDES the resumed conversation and starts a fresh one under a new
  // id, so nothing bleeds between them. (Programmatic mode sets — resume,
  // pending-message, end-session — call setChatMode directly and bypass
  // this on purpose.)
  // CHANGING MODE NO LONGER TOUCHES THE CONVERSATION. This is the single most
  // important consequence of collapsing the threads, and it is a deliberate
  // reversal.
  //
  // What this function used to do: if you were in a RESUMED session and picked
  // the other mode, it concluded that conversation — new session id,
  // hasEngaged reset, both transcripts wiped and reseeded with the opener. That
  // was correct when a mode WAS a conversation: the two threads held different
  // material and carrying a resumed transcript across meant writing turns into
  // a row that belonged to the other one.
  //
  // With one transcript, mode is a style of reply. Wiping the screen because
  // someone asked to be spoken to differently is precisely the failure this
  // refactor exists to prevent: a person mid-session taps "Sitting with it" and
  // their conversation disappears. So the mode change now changes the mode and
  // nothing else — same session id, same transcript, same scroll position.
  //
  // resumeLockedModeRef survives ONLY as the boot-seed suppressor (see the boot
  // effect); it no longer gates anything about mode.
  function handleModeChange(nextMode: ChatMode) {
    chatModeRef.current = nextMode;
    setChatMode(nextMode);
  }

  /** Append a user voice-note message IMMEDIATELY (showing "Transcribing…"
   *  underneath the waveform), then transcribe asynchronously. When the
   *  transcript resolves we update the bubble in place AND push the text
   *  into the chat history so the AI can reply. Empty transcript → bubble
   *  remains in the list but no AI turn is triggered. */
  async function handleSendVoice({ uri, durationSec }: { uri: string; durationSec: number }) {
    // Hard-interrupt any in-flight TTS playback — same rule as
    // handleSend (USER-initiated interrupt). See cancelTTSStream
    // comment in handleSend above.
    cancelTTSStream();
    // Lock the voice note to the thread the user is currently in —
    // a mid-transcribe mode switch shouldn't relocate the bubble.
    const turnMode = wireModeFor(workingModeRef.current);
    const turnThread = threadFor();
    const bubbleId = uuidv4();
    hasEngagedRef.current = true;
    turnThread.setMessages((prev) => [
      ...prev,
      {
        id: bubbleId,
        role: 'user',
        text: '', // the bubble body is the voice UI; text stays empty until transcript lands
        voice: { uri, durationSec, transcript: null },
      },
    ]);
    forceResumeAutoScroll();
    scrollToBottom();
    // Kick transcription. /api/transcribe is Whisper-backed; iOS records
    // .m4a from expo-audio's HIGH_QUALITY preset. 30s hard cap so a
    // backgrounded app or stalled connection never leaves the bubble
    // stuck on its loading state forever — the bubble flips to an
    // empty transcript (renders as 'nothing heard') and the user can
    // long-press to retry.
    const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
    let transcript = '';
    try {
      const t = await Promise.race([
        api.transcribe(uri, mime, durationSec),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('transcribe timeout (30s)')), 30000),
        ),
      ]);
      transcript = (t || '').trim();
    } catch (err) {
      console.warn('[chat] voice transcribe failed:', (err as Error)?.message);
    }
    // Update the bubble in place — transcript becomes a real string (possibly
    // empty-string, which the bubble renders as "(nothing heard)").
    // Update IN the captured turnMode's thread so a mode switch
    // mid-transcribe doesn't redirect the bubble.
    turnThread.setMessages((prev) =>
      prev.map((m) =>
        m.id === bubbleId && m.voice
          ? { ...m, text: transcript, voice: { ...m.voice, transcript } }
          : m,
      ),
    );
    if (transcript) {
      turnThread.historyRef.current.push({ role: 'user', content: transcript });
      runAssistantTurn(turnMode);
    }
  }

  // ===== AUTO-SCROLL: PAUSE-ON-TOUCH + PAUSE-WHEN-SCROLLED-AWAY =====
  // Build-13 alignment: Partner chat had a felt-but-not-explicit
  // "pause auto-scroll while user is touching" behavior. Ports that
  // behavior to the main chat tab so both surfaces behave identically:
  //   - default: stream → scroll-to-bottom follows the latest text
  //   - finger on screen: scroll-to-bottom is a no-op, text stays put
  //   - user scrolled up to read: also a no-op until they scroll back
  //   - user sends a new turn: force-resume (we follow our own send
  //     even if they were reading further up)
  // Mirror of the same block in RelationshipChat — kept in lockstep.
  const AUTOSCROLL_BOTTOM_THRESHOLD_PX = 60;
  const userTouchingRef = useRef(false);
  const userScrolledAwayRef = useRef(false);
  const onScrollViewTouchStart = useCallback(() => {
    userTouchingRef.current = true;
  }, []);
  const onScrollViewTouchEnd = useCallback(() => {
    userTouchingRef.current = false;
  }, []);
  const onScrollViewScroll = useCallback((e: any) => {
    const ne = e?.nativeEvent;
    if (!ne) return;
    const lm = ne.layoutMeasurement;
    const co = ne.contentOffset;
    const cs = ne.contentSize;
    if (!lm || !co || !cs) return;
    const distFromBottom = cs.height - (co.y + lm.height);
    userScrolledAwayRef.current = distFromBottom > AUTOSCROLL_BOTTOM_THRESHOLD_PX;
  }, []);
  const forceResumeAutoScroll = useCallback(() => {
    userTouchingRef.current = false;
    userScrolledAwayRef.current = false;
  }, []);

  function scrollToBottom() {
    if (!hasEngagedRef.current) return;        // pre-engagement: greeting rests at top
    if (userTouchingRef.current) return;       // pause while finger is down
    if (userScrolledAwayRef.current) return;   // pause while reading higher up
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  // ===== SEND =====
  // runAssistantTurn handles the streaming AI reply ONLY — the caller is
  // responsible for having already added the user's bubble and pushed their
  // message to historyRef. This split lets the voice-note path share the
  // exact same streaming + reveal logic without duplicating it.
  //
  // turnMode arg locks the streaming reply to the thread the turn was
  // started in. A mid-stream mode switch can no longer redirect the
  // bubble or push the assistant turn into the wrong history.
  const runAssistantTurn = useCallback(
    async (turnMode: ChatMode) => {
      if (sending) return;
      setSending(true);
      setTyping(true);
      // Lock the target thread for this whole turn — every setMessages
      // and history push below targets THIS thread, regardless of what
      // chatMode the user is on by the time deltas arrive.
      const turnThread = threadFor();
      // Attention indicator: user just sent → flip to the fast-pulse
      // 'thinking' state so the user sees the system has received and
      // is processing.
      setAttentionState('thinking');

      // Create the streaming assistant bubble up front; its `text` grows as deltas arrive.
      const streamId = uuidv4();
      let target = '';             // cleaned accumulated text (markers stripped)
      let rawAccum = '';           // raw accumulated text (includes possible CHAT_META)
      let detectedPart: string | null = null;
      let partLabel: string | null = null;
      let partFired = false;
      // Per-turn guard: when an [ADDED_TO_MAP: <name>] marker first
      // lands in the streamed text, flip the bottom-tab Map dot
      // optimistically — without waiting for the next 30s poll or
      // tab focus. Set to true on the first match so we don't re-
      // broadcast on every subsequent delta of the same turn.
      let addedToMapFired = false;
      // Per-turn crisis latch. The server decides crisis BEFORE it checks the
      // budget, so the two can't both fire for one turn — this makes that
      // ordering true on the client too: once a crisis frame lands for this
      // turn, a budget refusal arriving behind it (a retried transport, a
      // JSON fallback racing the stream) is dropped rather than allowed to
      // throw a billing sheet over the safety surface.
      let crisisFired = false;

      // Build 14 — real streaming replaced the 45ms/word reveal theater.
      // The bubble renders each delta as it arrives; pacing comes from
      // the model's actual token cadence now, not a client timer.
      function updateBubble(text: string, streaming: boolean, extra?: Record<string, unknown>) {
        turnThread.setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId
              ? {
                  ...m,
                  text,
                  streaming,
                  detectedPart: detectedPart || m.detectedPart,
                  partLabel: partLabel ?? m.partLabel,
                  ...(extra || {}),
                }
              : m,
          ),
        );
        scrollToBottom();
      }

      // Push an empty streaming bubble into the list now.
      turnThread.setMessages((prev) => [
        ...prev,
        { id: streamId, role: 'assistant', text: '', streaming: true },
      ]);

      // If session-wide audio mode is on, start the streaming TTS path
      // BEFORE the first delta arrives. Each onDelta will feed the
      // controller; onDone will flush. Capture the mute toggle at start
      // so a mid-stream flip doesn't half-start things — the toggle's
      // own cancelTTSStream call still kills any in-flight playback.
      const streamingTTSStarted = audioEnabledRef.current;
      console.log('[tts] runAssistantTurn audioCheck — audioEnabledRef=' + audioEnabledRef.current + ' streamingTTSStarted=' + streamingTTSStarted + (streamingTTSStarted ? ' (chain WILL start)' : ' (chain will NOT start — audio toggle is OFF)'));
      if (streamingTTSStarted) {
        startTTSStream(streamId).catch(() => {});
      }

      // Finalize the assistant turn — shared by the normal stream end
      // (onDone) and the user-initiated STOP. `finalRaw` is the text to
      // keep; `stopped` flags a user interrupt (the reply may be cut off
      // mid-marker). Idempotent via turnFinished so a stop landing in the
      // same tick as onDone can't double-finalize.
      let turnFinished = false;
      function finishTurn(finalRaw: string, stopped: boolean) {
        if (turnFinished) return;
        turnFinished = true;
        abortStreamRef.current = null;
        stopTurnRef.current = null;

        // On a STOP the text can end mid-marker (or before the end-of-reply
        // markers). Cut at the hold-back boundary so neither the kept prose
        // NOR the saved history carries a partial-marker fragment; complete
        // markers before the cut are still stripped normally. A normal end
        // has whole markers, so no cut needed.
        const safeRaw = stopped ? finalRaw.slice(0, holdBackBoundary(finalRaw)) : finalRaw;
        rawAccum = finalRaw;
        target = stripMarkersForDisplay(stopped ? safeRaw : finalRaw);
        const cleanText = stripMarkers(safeRaw);

        // Stopped before any prose arrived → drop the empty assistant
        // bubble, keep the user's message, reset. (Mirrors onError rollback.)
        if (stopped && !cleanText.trim()) {
          turnThread.setMessages((prev) => prev.filter((m) => m.id !== streamId));
          if (streamingTTSStarted) finishTTSStream();
          setSending(false);
          setTyping(false);
          setAttentionState('idle');
          return;
        }

        // Marker-detection log + map-tab pulse — only on a completed reply.
        // A stopped reply's structural markers are end-of-reply and were cut
        // off, and the server skips persistence on the client abort, so we
        // do NOT pulse "map updated" for a stopped turn (nothing persisted).
        if (!stopped) {
          const mapUpdateMatches = (finalRaw.match(/\[MAP_UPDATE:[\s\S]*?\]/g) || []);
          const mapReadyMatches = (finalRaw.match(/\[MAP_READY:[\s\S]*?\]/g) || []);
          const partUpdateMatches = (finalRaw.match(/PART_UPDATE:[^\n]+/g) || []);
          if (mapUpdateMatches.length || mapReadyMatches.length || partUpdateMatches.length) {
            console.log(
              '[marker] reply contained markers — MAP_UPDATE×%d MAP_READY×%d PART_UPDATE×%d',
              mapUpdateMatches.length, mapReadyMatches.length, partUpdateMatches.length,
            );
            pulseMapTab();
          }
        }

        // STARTER_MAP_COMPLETE is an end-of-reply signal → never present on
        // a stopped (truncated) reply.
        const starterMapDone = !stopped && hasStarterMapComplete(finalRaw);
        updateBubble(target, false, starterMapDone ? { starterMapComplete: true } : undefined);
        if (starterMapDone) {
          // A BARE FLIP, again. This used to route through completeFirstSession
          // — a one-shot handoff that shut the opener gate, published the flip
          // inside it and refetched the map for a same-session part label. All
          // of that existed because the Explore opener read two boot-captured
          // refs that were null for a first-ever user, so the flip alone would
          // have latched them onto the generic constant. There are no refs now:
          // the opener is a constant either way, and the only thing this flip
          // changes is which of the two constants a LATER Explore seed picks,
          // plus the banner and the CTA. Nothing to sequence, nothing to
          // refresh, no echo of the marker that can fabricate a boundary.
          setFirstSessionPending(false);
          console.log('[first-session] STARTER_MAP_COMPLETE — banner cleared, CTA on');
        }

        // History gets the FULLY-stripped text (no markers, no fragments).
        turnThread.historyRef.current.push({ role: 'assistant', content: cleanText });
        api.saveSession({
          id: sessionIdRef.current,
          messages: turnThread.historyRef.current,
          chatMode: turnMode,
        });
        if (streamingTTSStarted) finishTTSStream();
        if (!stopped) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setSending(false);
        setTyping(false);
        setAttentionState('idle');
      }

      try {
        const abortStream = await api.streamChat(
          {
            messages: turnThread.historyRef.current,
            mode,
            sessionId: sessionIdRef.current,
            experienceLevel,
            chatMode: turnMode,
          },
          {
            onDelta: (delta) => {
              rawAccum += delta;
              // Build 14 — TAIL HOLD-BACK. Markers now arrive split across
              // real deltas ("CHAT_ME" … "TA:{…}"), and the strip functions
              // only remove COMPLETE markers — so the displayed text is cut
              // at holdBackBoundary, which withholds any trailing text that
              // could still grow into a marker (line-anchored prefixes +
              // the bracketed [ADDED_TO_MAP form) until it's confirmed
              // marker (stripped/pill) or confirmed prose (released).
              // In __DEV__ the boundary is skipped along with the strip
              // (stripMarkersForDisplay pass-through) so devs see raw
              // markers stream in for live debugging.
              target = stripMarkersForDisplay(
                __DEV__ ? rawAccum : rawAccum.slice(0, holdBackBoundary(rawAccum)),
              );
              if (typing) setTyping(false);
              updateBubble(target, true);
              // First delta means the AI has actually started replying;
              // flip attention indicator from fast 'thinking' pulse to
              // bright steady 'streaming' breath. setAttentionState is
              // idempotent on equal values, safe to call every delta.
              setAttentionState('streaming');
              // Fire part detection ONCE the moment CHAT_META parses successfully.
              // Live part-confidence indicator (Explore mode). Parse
              // MAP_UPDATE markers as they appear in the stream — pick
              // the LAST one we haven't already shown. Match
              // confidence: partial → ring 50%; confirmed → ring 100%
              // + brief pulse + auto-fade. Process mode hides the
              // indicator entirely so this still runs but the JSX
              // gating below means the user never sees the change.
              try {
                const re = /MAP_UPDATE:\s*(\{[^}]+\})/g;
                let m: RegExpExecArray | null;
                let last: { part: string; confidence: PartConfidence } | null = null;
                while ((m = re.exec(rawAccum)) !== null) {
                  try {
                    const data = JSON.parse(m[1]);
                    const partName = typeof data.part === 'string' ? data.part : null;
                    const conf = data.confidence === 'partial' || data.confidence === 'confirmed'
                      ? (data.confidence as PartConfidence) : null;
                    if (partName && conf) last = { part: partName, confidence: conf };
                  } catch {}
                }
                if (last && (last.part !== livePart || last.confidence !== liveConfidence)) {
                  setLivePart(last.part);
                  setLiveConfidence(last.confidence);
                  // Auto-clear after 'confirmed' so the next detection
                  // can fade in cleanly.
                  if (livePartTimerRef.current) clearTimeout(livePartTimerRef.current);
                  if (last.confidence === 'confirmed') {
                    livePartTimerRef.current = setTimeout(() => {
                      setLivePart(null);
                      setLiveConfidence(null);
                    }, 2400);
                  }
                }
              } catch {}
              // Live Map-tab dot flip — fires the moment the first
              // complete [ADDED_TO_MAP: <name>] marker lands in the
              // accumulated raw text. The pill renders for the user
              // a few words later (via stripMarkersForDisplay in dev
              // / actual stripping in prod), and we want the dot to
              // light up at the same beat — within ~1s of the pill
              // appearing, not on the next 30s poll. Guarded by
              // addedToMapFired so we don't broadcast every delta.
              if (!addedToMapFired && /\[ADDED_TO_MAP:\s*[^\]]+\]/.test(rawAccum)) {
                addedToMapFired = true;
                optimisticMarkUnseen();
              }
              if (!partFired) {
                const meta = parseChatMeta(rawAccum);
                if (meta?.detectedPart && meta.detectedPart !== 'unknown') {
                  partFired = true;
                  detectedPart = meta.detectedPart;
                  partLabel = meta.partLabel ?? null;
                  // Brief 'detected' flash on the indicator — auto-reverts
                  // to 'streaming' inside AttentionIndicator after 1500ms.
                  setAttentionState('detected');
                  Haptics.selectionAsync().catch(() => {});
                  // Signal the top tab bar to pulse the MAP label — a gentle
                  // "your map just updated" cue that doesn't interrupt chat.
                  pulseMapTab();
                  // Light up the matching node on the Map tab — drives the
                  // ripple + connection-line glow in InnerMapCanvas. Maps
                  // any incoming category names to the canvas's NodeKey set.
                  const partActivationMap: Record<string, ActivatablePart> = {
                    wound: 'wound', fixer: 'fixer', skeptic: 'skeptic', self: 'self',
                    'self-like': 'self-like', compromised: 'self-like',
                    manager: 'manager', firefighter: 'firefighter',
                  };
                  const activatable = partActivationMap[detectedPart];
                  // For manager/firefighter activations, propagate the
                  // specific part label (e.g. "perfectionist") so the
                  // Map tab can show WHICH manager/firefighter just
                  // activated rather than just lighting the generic
                  // ring. Triangle nodes (wound/fixer/skeptic/self) get
                  // null since there's only one of each.
                  if (activatable) activatePartOnMap(activatable, partLabel || null);
                }
              }
              // Update the ambient attention indicator if the AI emitted a
              // new ATTENTION_STATE marker. The parser returns the LAST
              // value in the accumulated text so a later state overrides
              // an earlier one within the same turn (e.g. AI moved from
              // "noticing" → "listening" once it asked permission).
              const attn = parseAttentionStatePayload(rawAccum);
              if (attn) {
                setAttentionState(attn.state);
                // Only the 'noticing' state carries a part name. setAttentionState
                // already clears the part when transitioning out of noticing,
                // so this only writes a non-null value when state is 'noticing'.
                if (attn.state === 'noticing') setNoticedPart(attn.part);
                console.log('[attention]', attn.state, attn.part || '');
              }
              // Stream new cleaned text into the TTS controller. It will
              // chunk on sentence boundaries (≥80 chars per chunk) and
              // queue audio so playback begins shortly after the first
              // sentence finishes streaming, instead of after the full
              // reply lands. ALWAYS pass through stripMarkers AND the
              // hold-back boundary (even in dev) — a partial trailing
              // marker would otherwise be spoken aloud as "MAP_UPDATE
              // colon brace…" before its closing bytes arrive.
              if (streamingTTSStarted) {
                appendTTSStream(stripMarkers(rawAccum.slice(0, holdBackBoundary(rawAccum))));
              }
            },
            onDone: (full) => {
              // `full` is the server's canonical final text (the done
              // frame's cleaned reply — or, on a crisis/crisis_replace
              // frame, the deterministic referral, which REPLACES any
              // partial model text already shown). Complete text → whole
              // markers; finishTurn(stopped=false) strips them normally.
              finishTurn(full || rawAccum, false);
            },
            // THEY ASKED FOR DIFFERENT WORK AND THE SERVER OBEYED. All this
            // does is move the label at the top so the state is visible if they
            // look. Nothing is announced in the thread, and the transcript is
            // untouched — from their side they asked for something and got it.
            //
            // Guarded to the four known modes: an unrecognised value from the
            // wire must not put the control into a state it has no label for.
            onModeSwitch: (mode) => {
              const known: WorkingMode[] = ['light', 'process', 'explore', 'differentiation'];
              if (!known.includes(mode as WorkingMode)) return;
              workingModeRef.current = mode as WorkingMode;
              setWorkingMode(mode as WorkingMode);
              chatModeRef.current = wireModeFor(mode as WorkingMode);
              setChatMode(wireModeFor(mode as WorkingMode));
            },
            onMessageIds: (ids) => {
              // Round 9 RAG — stamp serverMessageId onto the most
              // recent user bubble (matched by being the last user
              // message before the streaming AI bubble) and onto the
              // streaming AI bubble itself (matched by streamId).
              // Enables the long-press "Mark as key moment" handler.
              turnThread.setMessages((prev) => {
                let lastUserIdx = -1;
                for (let i = prev.length - 1; i >= 0; i--) {
                  if (prev[i]?.role === 'user') { lastUserIdx = i; break; }
                }
                return prev.map((m, i) => {
                  if (m.id === streamId) return { ...m, serverMessageId: ids.ai };
                  if (i === lastUserIdx) return { ...m, serverMessageId: ids.user };
                  return m;
                });
              });
            },
            onSavedBeliefs: (records) => {
              // Phase 2 (polish round 8) — render one belief-saved
              // confirmation card per record, inline in this thread.
              // The card lands BELOW the assistant bubble that
              // triggered the save (onDone has already fired by this
              // point in the JSON-response path, so the order is
              // assistant bubble → 1+ cards).
              if (!records || records.length === 0) return;
              for (const r of records) {
                const cardId = uuidv4();
                turnThread.setMessages((prev) => [
                  ...prev,
                  {
                    id: cardId,
                    role: 'assistant',
                    text: '',
                    savedBelief: {
                      partId: r.part_id,
                      partName: r.part_name,
                      belief: r.belief,
                    },
                  },
                ]);
              }
              scrollToBottom();
              // Push the change to belief-dependent surfaces — the Map
              // tab's Self-like mic stays mounted across tab switches,
              // so without this its locked state goes stale until an
              // app restart (its belief check only ran on mount).
              emitBeliefChanged();
            },
            onRateLimit: (info) => {
              // Daily chat cap. Replace the streaming bubble with a
              // styled rate-limit card carrying the server-prepared
              // message. No retry pill — retrying within the window
              // would just hit the same 429.
              console.log('[chat] rate-limited:', info.message);
              abortStreamRef.current = null;
              stopTurnRef.current = null;
              setAttentionState('idle');
              turnThread.setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId
                    ? {
                        ...m,
                        text: info.message,
                        streaming: false,
                        rateLimited: true,
                        errorRetryText: null,
                      }
                    : m,
                ),
              );
              // Drop the empty assistant placeholder from history so
              // a future successful send doesn't carry it forward.
              turnThread.historyRef.current = turnThread.historyRef.current.filter(
                (h) => !(h.role === 'assistant' && h.content === ''),
              );
              setSending(false);
              setTyping(false);
            },
            // Budget cap — the server refused this turn before generating
            // anything, so there is no reply to show: drop the empty
            // streaming placeholder and open the server-authored refusal
            // sheet. Deliberately NOT the generic send-error path — the
            // refusal is a normal, explained state with its own action, not
            // a failure, and it must never render as "something went wrong"
            // with a retry pill that would just be refused again.
            onBudgetExhausted: (refusal) => {
              if (crisisFired) {
                // Crisis already owns this turn (see the crisisFired latch).
                console.log('[chat] budget refusal suppressed — crisis owns this turn');
                return;
              }
              console.log('[chat] budget exhausted — showing refusal sheet');
              abortStreamRef.current = null;
              stopTurnRef.current = null;
              setAttentionState('idle');
              // Remove the empty assistant placeholder from the thread — an
              // errorless empty bubble would otherwise sit under the user's
              // message for the life of the session.
              turnThread.setMessages((prev) => prev.filter((m) => m.id !== streamId));
              turnThread.historyRef.current = turnThread.historyRef.current.filter(
                (h) => !(h.role === 'assistant' && h.content === ''),
              );
              setSending(false);
              setTyping(false);
              setBudgetRefusal(refusal);
            },
            onError: (err) => {
              console.warn('[chat] stream error:', err);
              abortStreamRef.current = null;
              stopTurnRef.current = null;
              setAttentionState('idle');
              turnThread.setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId
                    ? {
                        ...m,
                        text: 'Something went wrong on my end — take a breath, and try again when you’re ready.',
                        streaming: false,
                        // Carries the original user input so the bubble's RETRY
                        // pill can re-submit without the user retyping. We
                        // pull the most recent user turn out of THIS thread's
                        // history.
                        errorRetryText: (() => {
                          const h = turnThread.historyRef.current;
                          for (let i = h.length - 1; i >= 0; i--) {
                            if (h[i].role === 'user') return h[i].content;
                          }
                          return null;
                        })(),
                      }
                    : m,
                ),
              );
              // Roll the failed assistant turn out of THIS thread's history
              // so a retry doesn't include a stale empty assistant message.
              turnThread.historyRef.current = turnThread.historyRef.current.filter(
                (h) => !(h.role === 'assistant' && h.content === ''),
              );
              setSending(false);
              setTyping(false);
            },
            // Crisis enforcement — the server gated this turn. The referral
            // already rendered as the AI bubble via onDone; now lock the
            // surface into the gated state (composer blocked + resources +
            // acknowledge action below the dock).
            onCrisis: () => {
              console.log('[chat] crisis_detected — entering gated state');
              crisisFired = true;
              abortStreamRef.current = null;
              stopTurnRef.current = null;
              setAttentionState('idle');
              setSending(false);
              setTyping(false);
              // Crisis outranks budget: tear down any refusal sheet that is
              // (or is about to be) up so nothing covers the resources card.
              setBudgetRefusal(null);
              setCrisisGated(true);
            },
          },
        );
        // Capture the abort fn (streamChat resolves with it as soon as the
        // request is in flight, before any delta) and wire the per-turn
        // STOP handler the composer's Stop button calls. abortStream()
        // halts the XHR; finishTurn(rawAccum, true) keeps the partial prose
        // and finalizes (strip + save) without waiting for onDone (which
        // won't fire after an abort).
        abortStreamRef.current = abortStream;
        stopTurnRef.current = () => {
          cancelTTSStream();
          try { abortStream(); } catch {}
          finishTurn(rawAccum, true);
        };
      } catch (e) {
        console.warn('[chat] send threw:', (e as Error).message);
        abortStreamRef.current = null;
        stopTurnRef.current = null;
        setSending(false);
        setTyping(false);
      }
    },
    [sending, mode, typing, experienceLevel],
  );

  // Thin wrapper used by the text-send path: push bubble + history, then run
  // the assistant turn. The voice-note path in handleSendVoice does the same
  // two steps itself before calling runAssistantTurn directly.
  const handleSend = useCallback(
    async (text: string) => {
      if (sending || !text.trim()) return;
      // Crisis gate — while gated, exploration is stopped. The composer is
      // already disabled, but guard here too so no programmatic send path
      // (conversation starters, retry) can slip a turn past the gate.
      if (crisisGated) return;
      // Hard-interrupt any in-flight TTS playback from the prior turn.
      // Build-13 bug: if audio was still reading aloud the previous AI
      // response when the user sent again, the chain kept draining and
      // overlapped the new turn. cancelTTSStream bumps the watchToken,
      // tears down the active player, and clears the queue — the next
      // assistant turn's startTTSStream then begins a fresh chain.
      // No overlap-bug regression: the old "first half only" cancel
      // that broke audio fired from startStream (AI-initiated); this
      // one fires from handleSend (USER-initiated), which is exactly
      // when interrupt is the desired behavior.
      cancelTTSStream();
      const turnMode = wireModeFor(workingModeRef.current);
      const t = threadFor();
      const id = uuidv4();
      hasEngagedRef.current = true;
      t.setMessages((prev) => [...prev, { id, role: 'user', text }]);
      // User-initiated turn — even if they were scrolled up reading
      // earlier turns, sending implies they want to follow this new
      // exchange through.
      forceResumeAutoScroll();
      scrollToBottom();
      t.historyRef.current.push({ role: 'user', content: text });
      // Mark the chat session as live so the Map tab icon renders its
      // subtle "alive" pulse (services/chatActivity). Idempotent — fires
      // on every send but the service no-ops if the state matches. The
      // pulse is killed in the session-end / reset paths and on
      // component unmount below.
      setChatSessionActive(true);
      runAssistantTurn(turnMode);
    },
    [sending, crisisGated, runAssistantTurn],
  );

  // Acknowledge the crisis referral → clear the server gate + reopen the
  // composer. If the server clear fails we still drop the local lock so the
  // user is never trapped; the server re-gates on the next crisis input
  // regardless (detection is unconditional).
  const handleAcknowledgeCrisis = useCallback(async () => {
    if (crisisAcking) return;
    setCrisisAcking(true);
    try { await api.acknowledgeCrisis(); }
    catch (e) { console.warn('[chat] acknowledgeCrisis threw:', (e as Error)?.message); }
    setCrisisAcking(false);
    setCrisisGated(false);
  }, [crisisAcking]);

  // Budget refusal → store. primaryAction.action is 'topup', so this routes
  // to the RevenueCat purchase flow for the usage top-up. services/purchases
  // never throws, so every outcome is a value:
  //   • ok        → close the sheet (the server credits the pool from the
  //                 purchase webhook; nothing is claimed here about what
  //                 that grants — the client has no authority on that).
  //   • cancelled → silent, sheet stays up. Backing out of StoreKit is not
  //                 an error and must not produce a message.
  //   • failed    → surface the store's own reason; the sheet stays up so
  //                 the action is still reachable.
  const handleBudgetTopUp = useCallback(async () => {
    if (topUpBusyRef.current) return;
    topUpBusyRef.current = true;
    setTopUpBusy(true);
    try {
      const product = await getTopUpProduct();
      // "Not now" stays tappable while this spins (deliberately — the user must
      // always be able to leave), and a cold SDK can take seconds. So by the
      // time we land here the sheet may be gone: alerting then would fire over
      // whatever the user moved on to. Silence is the right outcome — they
      // withdrew from the purchase.
      if (!topUpMountedRef.current || !budgetRefusalRef.current) return;
      if (!product) {
        Alert.alert('Not available right now', 'Please try again in a moment.');
        return;
      }
      const result = await purchase(product);
      if (result.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setBudgetRefusal(null);
        return;
      }
      if (result.cancelled) return;
      if (!topUpMountedRef.current || !budgetRefusalRef.current) return;
      Alert.alert('Purchase didn’t complete', result.message || 'Please try again in a moment.');
    } finally {
      // Every path lands here — ok, cancelled, failed, and throw — so the
      // button can never be left stuck spinning with no way back.
      topUpBusyRef.current = false;
      if (topUpMountedRef.current) setTopUpBusy(false);
    }
  }, []);

  // Unmount cleanup: clear the chat-active pulse so a stranded "true"
  // doesn't leak past the chat tab's lifetime. Doesn't cancel an
  // in-flight turn — that's the user's intent if they navigate away.
  useEffect(() => () => { setChatSessionActive(false); }, []);

  // ===== RENDER =====
  // Retry handler — removes the failed assistant bubble (in the active
  // thread, since that's what the user is looking at when they tap
  // RETRY), then re-submits the original user text. Wired into
  // MessageBubble's onRetry prop.
  const handleRetry = useCallback((text: string) => {
    setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.errorRetryText)));
    handleSend(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Round 9 RAG — long-press handler shared by every bubble. The
  // bubble itself shows the ActionSheet / Alert; this callback
  // handles the API + state flip. We mark the message optimistically
  // (isKeyMoment=true) before the round-trip, then roll back if the
  // call fails — same pattern as map-seen / etc. The toast on
  // success is a lightweight Alert so we don't ship a new toast
  // surface for one feature.
  const handleFlagKeyMoment = useCallback((messageId: string) => {
    // One transcript to search now, so one setter. This used to apply to both
    // thread lists because a flagged message could be in either.
    const flipFlag = (next: boolean) => {
      const apply = (msgs: ChatMsg[]) => msgs.map((m) =>
        m.serverMessageId === messageId ? { ...m, isKeyMoment: next } : m
      );
      setMessages((prev) => apply(prev));
    };
    flipFlag(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    (async () => {
      const ok = await api.flagKeyMoment(messageId);
      if (!ok) {
        flipFlag(false);
        console.warn('[chat] flagKeyMoment failed, rolling back', messageId.slice(0, 8));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bubbleList = useMemo( // eslint-disable-next-line react-hooks/exhaustive-deps
    () => messages.map((m) => (
      <MessageBubble
        key={m.id}
        msg={m}
        onRetry={handleRetry}
        onViewStarterMap={handleViewStarterMap}
        onFlagKeyMoment={handleFlagKeyMoment}
        // Home-screen redesign: the opening greeting (the sole assistant
        // bubble before any user turn) renders with more presence as the
        // screen's anchor. Reverts to normal the moment the conversation
        // grows. Presentation-only — derived from the existing thread, not
        // new state.
        isOpening={messages.length === 1 && m.role === 'assistant'}
      />
    )),
    [messages],
  );

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* Home-screen redesign — subtle warm radial depth behind everything
          (slightly warmer toward center, true black at the edges). Static,
          pointerEvents none, sits behind all content. Replaces the flat
          black background. */}
      <WarmRadialBackground />
      {/* Build 11 — soft migration prompt for existing anonymous testers.
          Mounts as a Modal so it overlays the entire chat tab without
          affecting any layout below. The probe in the boot effect
          above decides whether to make it visible. */}
      <MigrationModal
        visible={migrationVisible}
        forceSoft={nudgeForceSoft}
        onResolved={() => setMigrationVisible(false)}
      />
      {/* Tiny ambient attention indicator pinned to the top-right of the
          chat tab — sits BELOW the global tab bar (which is rendered by the
          parent _layout). Low-visibility on purpose; reflects the AI's
          processing state without competing with the conversation. */}
      {/* Chat read-aloud hidden for v1 (CHAT_READ_ALOUD_ENABLED in
          constants/features.ts). The session audio toggle is the ONLY
          entry point; with the whole strip gone, audioEnabled stays false
          and the streaming-TTS chain never starts — so chat never parks
          the audio session in playback mode. Flip the flag to restore the
          toggle + auto-play. (Map Voice is a separate system, unaffected.) */}
      {CHAT_READ_ALOUD_ENABLED ? (
        <View style={styles.headerStrip}>
          {/* Session audio mute/unmute. Default OFF. Tap to flip. When ON,
              every new AI reply auto-plays via the streaming TTS pipeline.
              When OFF, audio is silent and any in-flight playback stops
              immediately. No per-message control. */}
          <AudioToggle enabled={audioEnabled} onToggle={toggleAudio} />
        </View>
      ) : null}
      {/* Mode toggle — Process (gentle holding) vs Explore (active
          map-building). The mode-active indicator (Process triangle
          or Explore confidence ring) lives in the center of the bar
          via centerSlot — moved here from the top-right header so
          the active-mode glyph sits at the visual midpoint between
          the two pills. Selection drives which system prompt the
          server uses on /api/chat. Reset to 'process' on every new
          session. */}
      {/* First-session ambient banner. Renders only while
          firstSessionPending===true (i.e. the server's
          firstSessionCompletedAt is still null). Disappears the
          moment [STARTER_MAP_COMPLETE] lands in a reply (see onDone
          in runAssistantTurn) or when the next chat-tab mount polls
          /api/first-session-status and gets a non-null value back.
          Visual: thin italic pill in dim amber — ambient, not heavy
          header. */}
      {firstSessionPending === true ? (
        <View style={styles.firstSessionBanner} pointerEvents="none">
          <Text style={styles.firstSessionBannerText}>
            Building your starter map
          </Text>
        </View>
      ) : null}
      {/* THE TWO-PILL MODE TOGGLE IS GONE. It switched between two transcripts,
          and there is one. Leaving it would also have left the screen showing
          two different mode vocabularies at once — Explore/Process at the top
          and the four working modes above the input — where two of the four
          labels described behaviour no prompt implements.

          What the toggle also HOSTED has to survive it: the ambient indicator
          that occupies its centre. The split there is temporal, not modal — the
          AttentionIndicator triangle owns the slot during generation, the
          part-confidence ring owns it the rest of the time — and neither ever
          depended on which mode was active. So the bar stays, minus the pills. */}
      {/* MODE LIVES AT THE TOP (founder ruling 2026-09-01). It is a STATE, not
          an action: it says what is happening right now, and a state belongs
          where you look to find out, not where your thumb rests to act. It
          was above the input for one build; using it made the case. */}
      {firstSessionPending === true ? null : (
        <WorkingModeControl
          mode={workingMode}
          disabled={sending}
          onChange={(next) => {
            // Changing how we work does not touch the conversation, the session
            // id, or the scroll position — see handleModeChange. The ref is set
            // synchronously so a turn started in the same tick reads the new mode.
            workingModeRef.current = next;
            setWorkingMode(next);
            handleModeChange(wireModeFor(next));
          }}
        />
      )}
      <View style={styles.indicatorBar}>
        {isGenerating ? (
          <AttentionIndicator />
        ) : (
          <PartConfidenceIndicator part={livePart} confidence={liveConfidence} />
        )}
      </View>
      {/* KeyboardAvoidingView replaced with a manual kbHeight lift
          (build 13 Android-keyboard fix). The KAV with behavior='height'
          left the input bar hidden behind the system keyboard on Android
          real-device + emulator. See the kbHeight useEffect above —
          keyboardWillShow/Show drives a state value we apply as
          paddingBottom on the bottom dock, lifting input + EndSession
          button together. Works identically on both platforms because
          endCoordinates.height includes any iOS suggestion-bar height. */}
      <View style={styles.flex}>
        <Animated.View style={[styles.flex, { opacity: messagesOpacity }]}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            // Build-13 polish: pause auto-scroll on touch + when
            // scrolled away from the bottom. Mirrors RelationshipChat
            // so both surfaces feel identical mid-stream. See
            // scrollToBottom() above for the guard logic.
            onTouchStart={onScrollViewTouchStart}
            onTouchEnd={onScrollViewTouchEnd}
            onTouchCancel={onScrollViewTouchEnd}
            onScroll={onScrollViewScroll}
            scrollEventThrottle={16}
            // Force a re-flow on bubble height finalization (build-13
            // polish for the rare mid-word clipping reports — see
            // matching comment in RelationshipChat.tsx).
            onContentSizeChange={scrollToBottom}
            onScrollBeginDrag={() => Keyboard.dismiss()}
          >
            {/* The "Explore mode — building your map" micro-label was
                removed in polish round 4 — it pushed chat content
                further down the screen and was redundant: the active
                ChatModeToggle pill already shows the mode, and the
                first-session banner already says "building your map". */}
            {bubbleList}
            {typing ? <TypingIndicator /> : null}
            {/* Starter chips appear only before the user has said anything in
                the active thread. They disappear the moment the first user
                turn is added. Each thread tracks its own user-turn count, so
                switching modes shows the chips again on the new thread until
                the user has spoken there too. */}
            {messages.length > 0 && historyRef.current.every((m) => m.role !== 'user') ? (
              <ConversationStarters onPick={handleSend} />
            ) : null}
          </ScrollView>
        </Animated.View>

        {/* The legacy "Your map has been updated." overlay was replaced
            by the SessionSummaryModal below — it now carries the entire
            end-of-session moment (haptic + structured 3-part summary). */}
        {/* Bottom dock — wraps the input bar + end-session pill in a
            single container so we can lift them off the home indicator
            (insets.bottom + 10) AND above the keyboard when it's open.
            When the keyboard is up:
              • iOS — kbHeight already includes the home-indicator area, so
                bare kbHeight is exact. Do NOT add insets here (would double-pad).
              • Android — under edgeToEdgeEnabled the keyboardDidShow height
                lands ~one nav-bar short on Samsung One UI (the input sits behind
                the GIF/settings/mic toolbar strip), so we add insets.bottom to
                clear it. This mirrors the journal modal, which gets that same
                nav-bar inset for free from its <SafeAreaView edges={['bottom']}>.
                insets.bottom is read at the top level (a stable nav-bar constant),
                not sampled mid-keyboard where it can collapse to 0. */}
        <View style={{ paddingBottom: kbHeight > 0 ? kbHeight + (Platform.OS === 'android' ? insets.bottom : 0) : insets.bottom + 10 }}>
        {/* Inline notice for the daily TTS cap. Shows for ~5s when
            /api/speak returns 429, then auto-dismisses. Sits just
            above the input bar so it never covers a message in the
            thread. Text reply still streams normally — only audio
            playback is what got rate-limited. */}
        {speakNoticeText ? (
          <View style={styles.speakNoticeWrap} pointerEvents="none">
            <View style={styles.speakNotice}>
              <Text style={styles.speakNoticeText} numberOfLines={2}>{speakNoticeText}</Text>
            </View>
          </View>
        ) : null}
        {/* Crisis gate — replaces the composer while gated. The referral has
            already rendered as the AI bubble above; this surfaces the
            tappable resources + the only way forward: acknowledge, which
            clears the server gate and reopens the composer. Exploration is
            genuinely stopped (composer not rendered) — not just discouraged. */}
        {crisisGated ? (
          <ScrollView
            style={styles.crisisGateWrap}
            contentContainerStyle={styles.crisisGateContent}
            showsVerticalScrollIndicator={false}
          >
            <CrisisResourcesCard
              header="LET'S PAUSE HERE"
              lede="What you shared matters. This space isn't the right place to be with something this heavy — please reach out to one of these now."
            />
            <Pressable
              onPress={handleAcknowledgeCrisis}
              disabled={crisisAcking}
              style={[styles.crisisAckBtn, crisisAcking && { opacity: 0.6 }]}
              accessibilityLabel="I understand — continue"
            >
              <Text style={styles.crisisAckText}>
                {crisisAcking ? 'One moment…' : 'I understand — continue'}
              </Text>
            </Pressable>
          </ScrollView>
        ) : (
          <>
            {/* THE ALWAYS-AVAILABLE CONTROL. Above the input, labelled with the
                current state, so it teaches that modes exist to someone who
                never opens onboarding. Hidden during the first session: that
                arc is server-routed through FIRST_SESSION_PROMPT regardless of
                mode, so offering a choice there would be offering one that
                does nothing. */}
            <ChatInput
              disabled={sending}
              streaming={sending}
              onStop={stopStreaming}
              onSend={handleSend}
              onSendVoice={handleSendVoice}
            />
          </>
        )}
        {/* End session: only appears once a real back-and-forth has happened.
            On commit, flush the transcript to /api/summary + /api/sessions so
            the reflection + title land in the Journal tab immediately. */}
        <EndSessionButton
          // Visible once the session has actually started — i.e. the user
          // has sent at least one message in EITHER thread. Either thread
          // counts because the End Session pill is global; we don't want
          // a long Process conversation to be hidden just because the
          // user happens to be looking at an empty Explore thread.
          // One transcript, so one check. The old OR existed only because a
          // long conversation in one thread had to keep the button visible
          // while the user was looking at the empty other one.
          visible={historyRef.current.some((m) => m.role === 'user') && !endingTransition}
          onEnd={async () => {
            // === END-OF-SESSION NOTICED GATHERING (one-shot) ===
            // Before any ending transition: if the AI parked NOTICED
            // observations this session (parts it saw but never found a
            // seam to offer), the server returns ONE consolidated warm
            // closing ask and marks the items asked. We render it as a
            // normal assistant bubble and DON'T end yet — the user
            // answers in-chat (consents fire MAP_UPDATE through the
            // regular send path), then taps End Session again, which now
            // finds nothing pending and proceeds to the summary. The ref
            // guarantees we never block ending twice, even on errors.
            if (!gatheredNoticedRef.current) {
              gatheredNoticedRef.current = true;
              try {
                const gMode = chatModeRef.current;
                const gThread = threadFor();
                const g = await api.gatherNoticed(
                  sessionIdRef.current,
                  gThread.historyRef.current.slice(),
                  gMode,
                );
                if (g.needed && g.text && g.text.trim()) {
                  const ask = g.text.trim();
                  addAssistantMessage(ask);
                  gThread.historyRef.current.push({ role: 'assistant', content: ask });
                  return; // defer ending — next End tap proceeds to summary
                }
              } catch {}
            }
            // === END SESSION TRANSITION ===
            // 1) Fade messages out (400ms — per latest spec, slightly faster
            //    than before so the summary screen lands quickly).
            // 2) Open the SessionSummaryModal in its loading state.
            // 3) Kick the structured-summary fetch + the session save in
            //    parallel. The modal stays in loading until the summary
            //    object lands (or fails); the user is never forced to wait
            //    on the save itself.
            // 4) The "Begin New Session" button on the modal triggers the
            //    actual reset (continueAfterSummaryRef.current).
            //
            // Whichever thread the user is currently in is the one
            // summarized + saved. The other thread's messages reset
            // unsaved at session-end (per spec: "Both reset at end of
            // session"). The map state and parts data persist on the
            // server underneath both threads regardless.
            setEndingTransition(true);
            const turnMode = wireModeFor(workingModeRef.current);
            const turnThread = threadFor();
            const transcriptForSave = turnThread.historyRef.current.slice();
            const sessionIdForSave = sessionIdRef.current;
            Animated.timing(messagesOpacity, {
              toValue: 0, duration: 400,
              easing: Easing.inOut(Easing.ease), useNativeDriver: true,
            }).start();

            // Reset summary state and open the modal in loading mode.
            setSummary(null);
            setSummaryFailed(false);
            setDeepened([]);
            setSummaryVisible(true);

            // Fire the structured-summary call. The server picks the
            // PROCESS or EXPLORE summary prompt based on turnMode.
            // Persists the result onto the session row; we still call
            // saveSession so the messages array is stored.
            (async () => {
              // "What deepened this session" recap — parallel, quiet, non-blocking.
              api.getEnrichmentSummary(sessionIdForSave).then(setDeepened).catch(() => setDeepened([]));
              const sum = await api.getSessionSummary(transcriptForSave, sessionIdForSave, turnMode);
              if (sum) {
                setSummary({
                  exploredText: sum.exploredText,
                  mapShowingText: sum.mapShowingText,
                  somethingToTryText: sum.somethingToTryText,
                });
                if (sum.fallback) setSummaryFailed(true);
              } else {
                setSummaryFailed(true);
              }
            })().catch(() => setSummaryFailed(true));

            // Save in parallel — fire-and-forget. Tagged with the
            // mode the user ENDED in, so the Journey tab's session
            // chip reflects that.
            api.saveSession({ id: sessionIdForSave, messages: transcriptForSave, chatMode: turnMode })
              .catch(() => {});

            // Stage the actual reset behind the summary screen's continue
            // button. Captures the snapshots above so the continuation
            // doesn't fight a stale historyRef.
            continueAfterSummaryRef.current = async () => {
              cancelTTSStream();
              setAudioEnabled(false);
              resetAttentionState();
              // Session ended — clear the chat-active pulse on the Map
              // tab icon. Next user send re-arms it.
              setChatSessionActive(false);
              setLivePart(null); setLiveConfidence(null);
              if (livePartTimerRef.current) { clearTimeout(livePartTimerRef.current); livePartTimerRef.current = null; }
              gatheredNoticedRef.current = false; // re-arm gathering for the next session
              // Inbox badge refresh — a just-ended session may have left
              // parked NOTICED items that the next sweep will bundle.
              refreshInboxStatus(true).catch(() => {});
              clearMapVoiceHistory();           // start map voice fresh next session
              hasEngagedRef.current = false;     // fresh conversation → greeting rests at top
              resumeLockedModeRef.current = null; // ending clears any resume mode-lock
              sessionIdRef.current = uuidv4();
              // THE genuine session boundary in this app, and the site where the
              // stale-callback bug was worst: the old sequence published the
              // mode flip and the thread clears, then AWAITED a fresh
              // /api/returning-greeting. The await always yielded, the seed
              // effect ran inside it and latched onto the BOOT-TIME callback,
              // and the line after the await wrote the fresh one into a ref
              // nothing read again. A user ended a session about their father,
              // tapped Continue, and Explore opened by calling back to the
              // session BEFORE it. The opener gate was built to close that.
              // There is nothing left to close: no fetch, no await, no yield,
              // no ref.
              //
              // BOTH THREADS ARE SEEDED HERE, BY HAND. This used to clear the
              // Explore thread and let its seed effect refill it — which worked
              // only by accident. The effect deps are [chatMode,
              // firstSessionPending], and the gate hold count used to be a third
              // one: it flipped 0→1→0 across every boundary, and THAT is what
              // re-ran the effect. Delete the gate and a session that ENDED in
              // Explore re-sets chatMode to the value it already had, nothing in
              // the deps changes, and the effect never fires: an empty Explore
              // thread for the whole next session. Seeding both threads directly
              // needs no dep churn to be correct, and it is what the invariant
              // says anyway — the same constant, on both threads, for this
              // cohort. Keep it synchronous: an await between the reset and
              // these assignments is the exact shape the gate existed to police.
              const greeting = openerFor(firstSessionPending);
              greetedRef.current = true; // seeded on this line, not by the backstop
              // The new session opens in the DEFAULT working mode, which is
              // Light — not Explore. Ending a session and starting another
              // should not silently put someone into active mapping.
              setWorkingMode('explore');
              setChatMode('explore');
              chatModeRef.current = 'explore';
              setMessages([{ id: uuidv4(), role: 'assistant', text: greeting }]);
              historyRef.current = [{ role: 'assistant', content: greeting }];
              scrollToBottom();
              // Reveal messages again behind the dismissing summary modal.
              Animated.timing(messagesOpacity, {
                toValue: 1, duration: 500, useNativeDriver: true,
              }).start(() => setEndingTransition(false));
            };
          }}
        />
        </View>
      </View>

      <SessionSummaryModal
        visible={summaryVisible}
        summary={summary}
        failed={summaryFailed}
        deepened={deepened}
        messages={messages.map((m) => ({ role: m.role, text: m.text }))}
        onContinue={async () => {
          // Hide the modal first so the dismiss animation overlaps with
          // the messages-fade-back-in. Then run the captured continuation
          // which performs the actual session reset + greeting fetch.
          setSummaryVisible(false);
          const cont = continueAfterSummaryRef.current;
          continueAfterSummaryRef.current = null;
          if (cont) await cont();
        }}
      />

      {/* Budget cap. `visible` is gated on !crisisGated as the last line of
          the crisis-precedence defence — the per-turn latch in
          runAssistantTurn already suppresses a late refusal, and this makes
          a refusal that was already on screen when a gate engaged impossible
          to leave hanging over the resources card. */}
      <BudgetRefusalSheet
        visible={!!budgetRefusal && !crisisGated}
        refusal={budgetRefusal}
        onDismiss={() => setBudgetRefusal(null)}
        onTopUp={handleBudgetTopUp}
        busy={topUpBusy}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  // polish round 4: paddingTop trimmed (spacing.md → spacing.xs) so
  // the AI opening message + starter pills sit higher on the screen.
  // Horizontal + bottom padding keep spacing.md.
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  // First-session ambient banner. Thin centered strip in dim amber
  // with italic Cormorant text — feels like an ambient indicator,
  // not a heavy header. Renders only while firstSessionPending===true;
  // disappears on [STARTER_MAP_COMPLETE] or when the next mount sees
  // a non-null firstSessionCompletedAt from the server.
  // Replaces the removed ChatModeToggle bar. Same vertical metrics and the
  // same hairline divider, so the transcript below does not shift when the
  // pills came out.
  indicatorBar: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 3,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(230,180,122,0.1)",
  },
  firstSessionBanner: {
    alignSelf: 'center',
    // Round 5 — margins trimmed to 0/2 + paddingVertical 3 so the
    // banner adds the minimum possible vertical footprint when
    // shown. When it's NOT shown (firstSessionPending !== true,
    // which is the common case post-migration) it doesn't render
    // at all.
    marginTop: 0,
    marginBottom: 2,
    paddingHorizontal: 14,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(230,180,122,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.25)',
  },
  firstSessionBannerText: {
    color: colors.amber,
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 12,
    letterSpacing: 0.4,
  },
  // Holds the audio mute toggle on the left. Round 4 took it from
  // 48 → 34; round 5 (build 8 feedback) trims further to 24 because
  // the band still pushed the AI opening message below the
  // viewport's first paint on small iPhones. AudioToggle's own
  // 44x44 tap target is unchanged — it just visually centers across
  // the now-shorter strip; touches in the overlap area still hit
  // because RN doesn't clip children. The icon is 22px, comfortably
  // centered in 24px.
  headerStrip: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  transition: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  transitionText: {
    color: colors.amberDim,
    fontStyle: 'italic',
    fontSize: 17,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  // Transient inline notice — daily TTS cap. Sits between message
  // list and ChatInput so it doesn't cover thread content; auto
  // dismisses after ~5s (timer in the subscriber effect).
  speakNoticeWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: 8,
    alignItems: 'center',
  },
  speakNotice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(20,19,26,0.92)',
    borderColor: 'rgba(230,180,122,0.45)',
    borderWidth: 0.5,
    borderRadius: 14,
    maxWidth: '92%',
  },
  speakNoticeText: {
    color: colors.cream,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  // Crisis gate — replaces the composer while gated.
  crisisGateWrap: {
    maxHeight: 380,
    paddingHorizontal: spacing.md,
  },
  crisisGateContent: {
    paddingBottom: spacing.md,
  },
  crisisAckBtn: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: 28,
    backgroundColor: colors.amber,
    minWidth: 240,
    alignItems: 'center',
  },
  crisisAckText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
