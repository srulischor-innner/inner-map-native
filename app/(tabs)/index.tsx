// Chat screen — the core conversation surface of Inner Map on mobile. Mirrors the web
// app's behavior end-to-end:
//   1. On mount, fetch the returning greeting (or show a warm first-open line) plus
//      the current map state to decide the session phase (1-3).
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
  // KeyboardAvoidingView removed in the build-13 Android-keyboard fix
  // (commit on this PR). The manual kbHeight pattern replaces it on
  // both platforms — see the keyboardWill/DidShow useEffect.
  Platform,
  Pressable,
  StyleSheet,
  Keyboard,
  Animated,
  Easing,
  Text,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { useRouter, useFocusEffect } from 'expo-router';

import { api, ChatMessage } from '../../services/api';
import { parseChatMeta, parseAttentionStatePayload, stripMarkers, stripMarkersForDisplay, hasStarterMapComplete, holdBackBoundary } from '../../utils/markers';
import { setAttentionState, setNoticedPart, resetAttentionState, useAttentionState } from '../../utils/attentionState';
import { refreshInboxStatus } from '../../services/messagesInbox';
import { emitBeliefChanged } from '../../utils/beliefEvents';
// (Polish round 7) clearMapVoiceHistory removed alongside the
// services/mapVoiceHistory module — Map Voice is now turn-based
// and carries no client-side conversation history. The two
// session-boundary spots that used to call it are now no-ops.
const clearMapVoiceHistory = () => {};
import { ChatModeToggle, ChatMode } from '../../components/ChatModeToggle';
import { PartConfidenceIndicator, PartConfidence } from '../../components/PartConfidenceIndicator';
import { colors, spacing } from '../../constants/theme';
import { AttentionIndicator } from '../../components/AttentionIndicator';
import { pulseMapTab } from '../../utils/mapPulse';
import { activatePartOnMap, ActivatablePart } from '../../utils/mapActivation';
import { subscribeRateLimitNotice } from '../../utils/rateLimitNotice';
import { consumeSelfMode } from '../../utils/selfMode';
import { consumePendingChatMessage } from '../../utils/pendingChatMessage';
import { MigrationModal, shouldShowMigrationModal, shouldShowGraceNudge } from '../../components/auth/MigrationModal';
import { markGraceNudgeShown } from '../../services/onboarding';
import {
  startStream as startTTSStream, appendStreamText as appendTTSStream,
  finishStream as finishTTSStream, cancelStream as cancelTTSStream,
  playMessageNow as playTTSNow,
} from '../../utils/ttsStream';
import { AudioToggle } from '../../components/AudioToggle';
import { useExperienceLevel } from '../../services/experienceLevel';
import { optimisticMarkUnseen } from '../../services/mapSeen';
import { setChatSessionActive } from '../../services/chatActivity';

import { MessageBubble, ChatMsg } from '../../components/MessageBubble';
import { SessionSummaryModal, SessionSummary } from '../../components/session/SessionSummaryModal';
import { TypingIndicator } from '../../components/TypingIndicator';
import { ChatInput } from '../../components/ChatInput';
import { ConversationStarters } from '../../components/ConversationStarters';
import { EndSessionButton } from '../../components/EndSessionButton';
import { CrisisResourcesCard } from '../../components/safety/CrisisResourcesCard';
import { WarmRadialBackground } from '../../components/WarmRadialBackground';

// Default friendly greeting if the /api/returning-greeting endpoint doesn't respond.
const FALLBACK_GREETING = "Something went quiet on my end — but I'm here. What's on your mind?";

// First-session orientation message (polish round 4, Part 3). Shown
// as the opening AI bubble for users whose firstSessionCompletedAt is
// still null — replaces the old hardcoded "I'm here to help you
// explore…" welcome. Once the user sends their first message the
// server's FIRST_SESSION_PROMPT takes over and the AI's generated
// replies continue the first-session work. After completion this is
// never shown again (the returning greeting takes its place).
const ORIENTATION_MESSAGE =
  "Welcome. Quick orientation:\n\n" +
  "Two modes up top. Explore is for active inner work — naming patterns, " +
  "identifying parts. Process is for being heard, working through something, " +
  "or just talking it out. Both build your map; Process just doesn't make " +
  "that the focus.\n\n" +
  "I'll be more directive at first while we build your starter map. What we " +
  "build in this session is a rough sketch — it'll become sharper and more " +
  "accurate as we go. If something I name doesn't fit, say so. 'That's not " +
  "quite it' or 'It's more like X' is the most useful thing you can share.\n\n" +
  "Would you like to begin?";

export default function ChatScreen() {
  // Persistent session id for this app launch (a fresh one per "session" like the web app).
  const sessionIdRef = useRef<string>(uuidv4());
  const scrollRef = useRef<ScrollView | null>(null);

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
  const [processMessages, setProcessMessages] = useState<ChatMsg[]>([]);
  const [exploreMessages, setExploreMessages] = useState<ChatMsg[]>([]);
  const processHistoryRef = useRef<ChatMessage[]>([]);
  const exploreHistoryRef = useRef<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  // Mode for /api/chat — onboarding for brand-new users, ongoing once any core node is filled.
  const [mode, setMode] = useState<'onboarding' | 'ongoing'>('onboarding');
  const [sending, setSending] = useState(false);
  // Contextual conversation starters returned by /api/returning-greeting —
  // grounded in the last session so the chips land on what's actually alive.
  const [starters, setStarters] = useState<string[]>([]);
  // Self mode — one-shot flag set when the user taps "Enter Self mode" on
  // the map's Self folder. Consumed on mount; every /api/chat request while
  // this is true carries selfMode:true so the server prepends the Self-mode
  // system prompt addendum. Cleared when the session ends.
  const [selfMode, setSelfMode] = useState(false);
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
  // chatModeRef mirrors chatMode so the thread helpers below can
  // resolve the active thread synchronously from any callback,
  // without relying on stale closures over the chatMode state.
  const chatModeRef = useRef<ChatMode>(chatMode);
  useEffect(() => { chatModeRef.current = chatMode; }, [chatMode]);

  // Most-recent-detected part name. Populated from /api/parts at
  // boot; used by the Explore opening greeting to reference the
  // last thing the user explored. null on first-ever-session
  // (parts table empty for this user).
  const mostRecentPartRef = useRef<string | null>(null);
  // Once true, the Explore thread has been seeded with its
  // opening greeting for this session. Reset on end-session.
  const exploreGreetedRef = useRef<boolean>(false);

  // ===== THREAD HELPERS =====
  // Resolve the (messages, setMessages, historyRef) triple for a
  // specific mode. Used by streaming turns to lock onto a target
  // thread at start so a mid-stream mode switch can't redirect a
  // reply to the wrong thread.
  function threadFor(modeKey: ChatMode) {
    if (modeKey === 'process') {
      return {
        messages: processMessages,
        setMessages: setProcessMessages,
        historyRef: processHistoryRef,
      };
    }
    return {
      messages: exploreMessages,
      setMessages: setExploreMessages,
      historyRef: exploreHistoryRef,
    };
  }
  // Active thread shorthands — read by the render layer + by
  // callbacks that should always target whatever thread the user
  // is currently looking at (e.g. error retry button cleanup).
  const activeMessages = chatMode === 'process' ? processMessages : exploreMessages;
  const setActiveMessages = chatMode === 'process' ? setProcessMessages : setExploreMessages;
  const activeHistoryRef = chatMode === 'process' ? processHistoryRef : exploreHistoryRef;

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
  useEffect(() => { messagesRef.current = activeMessages; });
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
  useEffect(() => {
    let cancelled = false;
    api.getFirstSessionStatus()
      .then(({ completedAt }) => {
        if (!cancelled) setFirstSessionPending(completedAt === null);
      })
      .catch(() => { if (!cancelled) setFirstSessionPending(false); });
    return () => { cancelled = true; };
  }, []);

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

  // ===== BOOT: returning greeting + map state =====
  // Instead of inserting a placeholder bubble that then gets swapped (which
  // read as a glitch), we show the typing indicator immediately and insert
  // the greeting bubble only once — when the real text is ready.
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

  useEffect(() => {
    // Consume the one-shot Self-mode flag if the user just tapped "Enter
    // Self mode" on the map. Runs once on mount — subsequent tab visits
    // don't re-enter Self mode unless the user explicitly opts back in.
    const sm = consumeSelfMode();
    if (sm) {
      console.log('[chat] Self mode engaged for this session');
      setSelfMode(true);
    }
    setTyping(true);
    (async () => {
      let greetingRes: { greeting: string | null; suggestions: string[] } = { greeting: null, suggestions: [] };
      let map: any = null;
      // First-session status is fetched alongside the greeting + map
      // so the opening bubble can be the orientation message (Part 3)
      // without a second round-trip or a flash of the wrong copy.
      let firstStatus: { completedAt: string | null } = { completedAt: null };
      try {
        [greetingRes, map, firstStatus] = await Promise.all([
          api.getReturningGreeting(),
          api.getLatestMap(),
          api.getFirstSessionStatus(),
        ]);
      } catch (err) {
        console.warn('[chat] boot fetch failed:', (err as Error)?.message);
      }
      const isFirstSession = firstStatus?.completedAt == null;

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

      // Pull the most-recently-detected part name out of the map
      // payload (parts are sorted lastDetected DESC by the server).
      // Used later by the Explore opening greeting to reference what
      // the user explored last time.
      try {
        const parts = Array.isArray(map?.parts) ? map.parts : [];
        const top = parts.find((p: any) => p && (p.name || p.category));
        const label = top ? (String(top.name || '').trim() || String(top.category || '').trim()) : '';
        mostRecentPartRef.current = label || null;
        console.log(`[chat] boot — mostRecentPart=${mostRecentPartRef.current || '(none)'}`);
      } catch (e) {
        mostRecentPartRef.current = null;
      }

      if (greetingRes.suggestions.length > 0) setStarters(greetingRes.suggestions);

      // Seed ONLY the Process thread on boot. Process is the default
      // landing mode; the Explore thread stays empty until the user
      // first switches to Explore (see the chatMode change effect
      // below), at which point its own opener is injected.
      //
      // First-session users get the orientation message as the
      // opening bubble on BOTH threads — whichever mode they land on
      // or switch to, the first AI message is the orientation. After
      // they send anything the server's FIRST_SESSION_PROMPT takes
      // over and generates the real first-session work.
      const finalGreeting = isFirstSession
        ? ORIENTATION_MESSAGE
        : ((greetingRes.greeting && greetingRes.greeting.trim()) || FALLBACK_GREETING);
      addAssistantMessageToProcess(finalGreeting);
      processHistoryRef.current.push({ role: 'assistant', content: finalGreeting });
      setTyping(false);

    })();
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

  // ===== EXPLORE OPENING GREETING =====
  // Seeds the Explore thread the first time the user switches into it
  // during this session. First-ever session (no parts detected yet) →
  // generic opener; otherwise reference the most recently explored
  // part by name. Only runs when chatMode flips TO explore AND the
  // explore thread is empty AND we haven't already greeted this session.
  useEffect(() => {
    if (chatMode !== 'explore') return;
    if (exploreGreetedRef.current) return;
    if (exploreMessages.length > 0) return;
    // Wait for the first-session status to resolve before seeding —
    // a first-session user must get the orientation message, not the
    // regular explore opener. Returning early WITHOUT flipping
    // exploreGreetedRef means the effect re-runs (and seeds) once
    // firstSessionPending lands.
    if (firstSessionPending === undefined) return;
    exploreGreetedRef.current = true;
    const recent = mostRecentPartRef.current;
    // First-session users get the orientation message (Part 3) —
    // overrides both the "last time we explored…" and the generic
    // first-ever opener.
    const opener = firstSessionPending === true
      ? ORIENTATION_MESSAGE
      : recent
        ? `Last time we explored ${recent}. What would you like to understand better today?`
        : "I'm here to help you explore what's happening inside. What would you like to understand better about yourself today?";
    console.log(`[chat] seeding Explore thread — ${firstSessionPending ? 'first-session orientation' : recent ? 'subsequent' : 'first'} opener`);
    const id = uuidv4();
    setExploreMessages((prev) => [...prev, { id, role: 'assistant', text: opener }]);
    exploreHistoryRef.current.push({ role: 'assistant', content: opener });
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMode, firstSessionPending]);

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
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // ===== MESSAGE HELPERS =====
  // Both helpers target the ACTIVE thread via chatModeRef. Callers
  // that need to target a specific thread (e.g. boot seeding the
  // Process thread before any chatMode state has settled) should use
  // the mode-suffixed variants (addAssistantMessageToProcess, etc.).
  function addAssistantMessage(text: string, meta?: { detectedPart?: string; partLabel?: string | null }): string {
    const id = uuidv4();
    const t = threadFor(chatModeRef.current);
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

  // Mode-targeted variant — guarantees the message lands in the
  // Process thread regardless of current state. Used by boot, where
  // we always seed Process even though we haven't computed chatMode
  // changes yet, and by the end-session reset path.
  function addAssistantMessageToProcess(text: string): string {
    const id = uuidv4();
    setProcessMessages((prev) => [
      ...prev,
      { id, role: 'assistant', text },
    ]);
    scrollToBottom();
    return id;
  }

  function addUserMessage(text: string) {
    const t = threadFor(chatModeRef.current);
    t.setMessages((prev) => [...prev, { id: uuidv4(), role: 'user', text }]);
    scrollToBottom();
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
    const turnMode = chatModeRef.current;
    const turnThread = threadFor(turnMode);
    const bubbleId = uuidv4();
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
        api.transcribe(uri, mime),
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
      const turnThread = threadFor(turnMode);
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
            selfMode,
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
              abortStreamRef.current = null;
              stopTurnRef.current = null;
              setAttentionState('idle');
              setSending(false);
              setTyping(false);
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
    [sending, mode, typing, selfMode, experienceLevel],
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
      const turnMode = chatModeRef.current;
      const t = threadFor(turnMode);
      const id = uuidv4();
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
    setActiveMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.errorRetryText)));
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
    // Find the bubble in either thread and flip isKeyMoment.
    const flipFlag = (next: boolean) => {
      const apply = (msgs: ChatMsg[]) => msgs.map((m) =>
        m.serverMessageId === messageId ? { ...m, isKeyMoment: next } : m
      );
      setProcessMessages((prev) => apply(prev));
      setExploreMessages((prev) => apply(prev));
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
    () => activeMessages.map((m) => (
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
        isOpening={activeMessages.length === 1 && m.role === 'assistant'}
      />
    )),
    [activeMessages],
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
      <View style={styles.headerStrip}>
        {/* Session audio mute/unmute. Default OFF. Tap to flip. When ON,
            every new AI reply auto-plays via the streaming TTS pipeline.
            When OFF, audio is silent and any in-flight playback stops
            immediately. No per-message control. */}
        <AudioToggle enabled={audioEnabled} onToggle={toggleAudio} />
      </View>
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
      <ChatModeToggle
        mode={chatMode}
        onChange={setChatMode}
        // Both modes share the centerSlot now (previously the ring was
        // Explore-only and Process showed the triangle permanently —
        // which made Process-mode mapping invisible). The split is
        // TEMPORAL, not modal: the AttentionIndicator triangle owns the
        // slot during generation ('thinking' / 'streaming' / 'detected'),
        // and the part-confidence ring owns it the rest of the time, in
        // BOTH modes. The ring's MAP_UPDATE-driven live state was already
        // wired mode-agnostically; it just never rendered in Process.
        centerSlot={
          isGenerating ? (
            <AttentionIndicator />
          ) : (
            <PartConfidenceIndicator part={livePart} confidence={liveConfidence} />
          )
        }
      />
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
            {activeMessages.length > 0 && activeHistoryRef.current.every((m) => m.role !== 'user') ? (
              <ConversationStarters onPick={handleSend} starters={starters} />
            ) : null}
          </ScrollView>
        </Animated.View>

        {/* The legacy "Your map has been updated." overlay was replaced
            by the SessionSummaryModal below — it now carries the entire
            end-of-session moment (haptic + structured 3-part summary). */}
        {/* Bottom dock — wraps the input bar + end-session pill in a
            single container so we can lift them off the home indicator
            (insets.bottom + 10) AND above the keyboard when it's open
            (kbHeight, set by the keyboardWill/DidShow listener above).
            When the keyboard is up, kbHeight already accounts for the
            home-indicator area on iOS, so we don't double-pad. */}
        <View style={{ paddingBottom: kbHeight > 0 ? kbHeight : insets.bottom + 10 }}>
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
          <ChatInput
            disabled={sending}
            streaming={sending}
            onStop={stopStreaming}
            onSend={handleSend}
            onSendVoice={handleSendVoice}
          />
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
          visible={(processHistoryRef.current.some((m) => m.role === 'user') || exploreHistoryRef.current.some((m) => m.role === 'user')) && !endingTransition}
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
                const gThread = threadFor(gMode);
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
            const turnMode = chatModeRef.current;
            const turnThread = threadFor(turnMode);
            const transcriptForSave = turnThread.historyRef.current.slice();
            const sessionIdForSave = sessionIdRef.current;
            Animated.timing(messagesOpacity, {
              toValue: 0, duration: 400,
              easing: Easing.inOut(Easing.ease), useNativeDriver: true,
            }).start();

            // Reset summary state and open the modal in loading mode.
            setSummary(null);
            setSummaryFailed(false);
            setSummaryVisible(true);

            // Fire the structured-summary call. The server picks the
            // PROCESS or EXPLORE summary prompt based on turnMode.
            // Persists the result onto the session row; we still call
            // saveSession so the messages array is stored.
            (async () => {
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
              setSelfMode(false);
              setChatMode('explore');          // new session starts in active map-building mode
              setLivePart(null); setLiveConfidence(null);
              if (livePartTimerRef.current) { clearTimeout(livePartTimerRef.current); livePartTimerRef.current = null; }
              gatheredNoticedRef.current = false; // re-arm gathering for the next session
              // Inbox badge refresh — a just-ended session may have left
              // parked NOTICED items that the next sweep will bundle.
              refreshInboxStatus(true).catch(() => {});
              clearMapVoiceHistory();           // start map voice fresh next session
              // Reset BOTH threads — both arrays + both refs cleared.
              processHistoryRef.current = [];
              exploreHistoryRef.current = [];
              setProcessMessages([]);
              setExploreMessages([]);
              exploreGreetedRef.current = false; // re-arm Explore opener for next session
              sessionIdRef.current = uuidv4();
              const next = await api.getReturningGreeting();
              const greeting = (next.greeting && next.greeting.trim()) || FALLBACK_GREETING;
              if (next.suggestions.length) setStarters(next.suggestions);
              addAssistantMessageToProcess(greeting);
              processHistoryRef.current.push({ role: 'assistant', content: greeting });
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
        messages={activeMessages.map((m) => ({ role: m.role, text: m.text }))}
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
