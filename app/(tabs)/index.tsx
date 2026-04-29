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
  KeyboardAvoidingView,
  Platform,
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

import { api, ChatMessage } from '../../services/api';
import { parseChatMeta, parseAttentionStatePayload, stripMarkers } from '../../utils/markers';
import { setAttentionState, setNoticedPart, resetAttentionState } from '../../utils/attentionState';
import { clearMapVoiceHistory } from '../../services/mapVoiceHistory';
import { ChatModeToggle, ChatModeIndicator, ChatMode } from '../../components/ChatModeToggle';
import { colors, spacing } from '../../constants/theme';
import { AttentionIndicator } from '../../components/AttentionIndicator';
import { pulseMapTab } from '../../utils/mapPulse';
import { activatePartOnMap, ActivatablePart } from '../../utils/mapActivation';
import { consumeSelfMode } from '../../utils/selfMode';
import {
  startStream as startTTSStream, appendStreamText as appendTTSStream,
  finishStream as finishTTSStream, cancelStream as cancelTTSStream,
  playMessageNow as playTTSNow,
} from '../../utils/ttsStream';
import { AudioToggle } from '../../components/AudioToggle';
import { useExperienceLevel } from '../../services/experienceLevel';

import { MessageBubble, ChatMsg } from '../../components/MessageBubble';
import { SessionSummaryModal, SessionSummary } from '../../components/session/SessionSummaryModal';
import { TypingIndicator } from '../../components/TypingIndicator';
import { ChatInput } from '../../components/ChatInput';
import { ConversationStarters } from '../../components/ConversationStarters';
import { EndSessionButton } from '../../components/EndSessionButton';

// ms/word reveal cadence — matches the web app's `perWordMs: 45`.
const PER_WORD_MS = 45;
// Default friendly greeting if the /api/returning-greeting endpoint doesn't respond.
const FALLBACK_GREETING = "Something went quiet on my end — but I'm here. What's on your mind?";

export default function ChatScreen() {
  // Persistent session id for this app launch (a fresh one per "session" like the web app).
  const sessionIdRef = useRef<string>(uuidv4());
  const scrollRef = useRef<ScrollView | null>(null);

  // On-screen list (may include a streaming bubble whose text grows word by word).
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  // Wire-format history sent in each chat request. We push turns here after they finish.
  const historyRef = useRef<ChatMessage[]>([]);
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
  // Chat mode — Process (default, gentle holding) vs Explore
  // (active map-building). The server uses this to pick between
  // HOLDING_SPACE_PROMPT and MAPPING_PROMPT. Reset to 'process' on
  // every new session.
  const [chatMode, setChatMode] = useState<ChatMode>('process');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioEnabledRef = useRef(audioEnabled);
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);
  // Latest messages snapshot accessible from the toggle handler without
  // hitting React's stale-closure trap. Updated on every render — cheap.
  const messagesRef = useRef<ChatMsg[]>([]);
  useEffect(() => { messagesRef.current = messages; });
  function toggleAudio() {
    const wasOn = audioEnabledRef.current;
    console.log('[audio] toggle:', wasOn ? 'ON→OFF' : 'OFF→ON');
    if (wasOn) {
      cancelTTSStream();
      setAudioEnabled(false);
      return;
    }
    // Flipping from OFF→ON. Set the ref synchronously so the next AI
    // turn's `streamingTTSStarted` capture sees the new value even if
    // the user sends a message before React's re-render lands.
    audioEnabledRef.current = true;
    setAudioEnabled(true);
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
    //     greeting is on screen), play the most recent finished AI
    //     bubble in the list.
    const targetAI = (() => {
      const startIdx = lastUserIdx > 0 ? lastUserIdx - 1 : list.length - 1;
      for (let i = startIdx; i >= 0; i--) {
        const m = list[i];
        if (m.role === 'assistant' && !m.streaming && m.text && m.text.trim()) return m;
      }
      return null;
    })();
    console.log(
      '[audio] enable — lastUserIdx=', lastUserIdx,
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
        console.warn('[audio] playMessageNow threw:', (e as Error)?.message),
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
      try {
        [greetingRes, map] = await Promise.all([
          api.getReturningGreeting(),
          api.getLatestMap(),
        ]);
      } catch (err) {
        console.warn('[chat] boot fetch failed:', (err as Error)?.message);
      }

      const md = map?.mapData || map || {};
      const anyCoreFilled = ['wound', 'fixer', 'skeptic'].some((k) => !!md?.[k]);
      const chosenMode = anyCoreFilled ? 'ongoing' : 'onboarding';
      console.log('[mode]', chosenMode, 'anyCoreFilled:', anyCoreFilled, 'mapData:', JSON.stringify(md).slice(0, 300));
      setMode(chosenMode);

      if (greetingRes.suggestions.length > 0) setStarters(greetingRes.suggestions);

      const finalGreeting = (greetingRes.greeting && greetingRes.greeting.trim()) || FALLBACK_GREETING;
      addAssistantMessage(finalGreeting);
      historyRef.current.push({ role: 'assistant', content: finalGreeting });
      setTyping(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the keyboard opens, snap the scroll to the latest message so the user
  // sees what they're responding to. iOS emits keyboardWillShow before it's
  // done animating; Android only fires keyboardDidShow. We handle both.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvt, () => {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => sub.remove();
  }, []);

  // ===== MESSAGE HELPERS =====
  function addAssistantMessage(text: string, meta?: { detectedPart?: string; partLabel?: string | null }): string {
    const id = uuidv4();
    setMessages((prev) => [
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

  function addUserMessage(text: string) {
    setMessages((prev) => [...prev, { id: uuidv4(), role: 'user', text }]);
    scrollToBottom();
  }

  /** Append a user voice-note message IMMEDIATELY (showing "Transcribing…"
   *  underneath the waveform), then transcribe asynchronously. When the
   *  transcript resolves we update the bubble in place AND push the text
   *  into the chat history so the AI can reply. Empty transcript → bubble
   *  remains in the list but no AI turn is triggered. */
  async function handleSendVoice({ uri, durationSec }: { uri: string; durationSec: number }) {
    const bubbleId = uuidv4();
    setMessages((prev) => [
      ...prev,
      {
        id: bubbleId,
        role: 'user',
        text: '', // the bubble body is the voice UI; text stays empty until transcript lands
        voice: { uri, durationSec, transcript: null },
      },
    ]);
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
    setMessages((prev) =>
      prev.map((m) =>
        m.id === bubbleId && m.voice
          ? { ...m, text: transcript, voice: { ...m.voice, transcript } }
          : m,
      ),
    );
    if (transcript) {
      historyRef.current.push({ role: 'user', content: transcript });
      runAssistantTurn();
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  // ===== SEND =====
  // runAssistantTurn handles the streaming AI reply ONLY — the caller is
  // responsible for having already added the user's bubble and pushed their
  // message to historyRef. This split lets the voice-note path share the
  // exact same streaming + reveal logic without duplicating it.
  const runAssistantTurn = useCallback(
    async () => {
      if (sending) return;
      setSending(true);
      setTyping(true);
      // Attention indicator: user just sent → flip to the fast-pulse
      // 'thinking' state so the user sees the system has received and
      // is processing.
      setAttentionState('thinking');

      // Create the streaming assistant bubble up front; its `text` grows as deltas arrive.
      const streamId = uuidv4();
      let revealed = 0;            // number of chars currently displayed
      let target = '';             // cleaned accumulated text (markers stripped)
      let rawAccum = '';           // raw accumulated text (includes possible CHAT_META)
      let detectedPart: string | null = null;
      let partLabel: string | null = null;
      let partFired = false;
      let revealTimer: any = null;

      // Word-by-word reveal: advance `revealed` toward target.length, one word at a time.
      function tickReveal() {
        if (revealed >= target.length) { revealTimer = null; return; }
        let i = revealed;
        while (i < target.length && /\s/.test(target[i])) i++;
        while (i < target.length && !/\s/.test(target[i])) i++;
        revealed = i;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId
              ? {
                  ...m,
                  text: target.slice(0, revealed),
                  streaming: revealed < target.length || !streamDone,
                  detectedPart: detectedPart || m.detectedPart,
                  partLabel: partLabel ?? m.partLabel,
                }
              : m,
          ),
        );
        scrollToBottom();
        revealTimer = setTimeout(tickReveal, PER_WORD_MS);
      }

      let streamDone = false;

      // Push an empty streaming bubble into the list now.
      setMessages((prev) => [
        ...prev,
        { id: streamId, role: 'assistant', text: '', streaming: true },
      ]);

      // If session-wide audio mode is on, start the streaming TTS path
      // BEFORE the first delta arrives. Each onDelta will feed the
      // controller; onDone will flush. Capture the mute toggle at start
      // so a mid-stream flip doesn't half-start things — the toggle's
      // own cancelTTSStream call still kills any in-flight playback.
      const streamingTTSStarted = audioEnabledRef.current;
      console.log('[audio] stream starting, audioEnabledRef:', audioEnabledRef.current, 'streamingTTSStarted:', streamingTTSStarted);
      if (streamingTTSStarted) {
        startTTSStream(streamId).catch(() => {});
      }

      try {
        await api.streamChat(
          {
            messages: historyRef.current,
            mode,
            sessionId: sessionIdRef.current,
            selfMode,
            experienceLevel,
            chatMode,
          },
          {
            onDelta: (delta) => {
              rawAccum += delta;
              target = stripMarkers(rawAccum);
              if (typing) setTyping(false);
              if (!revealTimer) revealTimer = setTimeout(tickReveal, PER_WORD_MS);
              // First delta means the AI has actually started replying;
              // flip attention indicator from fast 'thinking' pulse to
              // bright steady 'streaming' breath. setAttentionState is
              // idempotent on equal values, safe to call every delta.
              setAttentionState('streaming');
              // Fire part detection ONCE the moment CHAT_META parses successfully.
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
                  if (activatable) activatePartOnMap(activatable);
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
              // reply lands.
              if (streamingTTSStarted) appendTTSStream(target);
            },
            onDone: (full) => {
              rawAccum = full || rawAccum;
              target = stripMarkers(rawAccum);
              streamDone = true;
              // Diagnostic — confirms whether the AI actually emitted any
              // map / part markers in this turn. If you see "no markers"
              // here while the chat text says a part was detected, the
              // model emitted CHAT_META but skipped MAP_UPDATE — that's a
              // prompt-side issue, not a transport one.
              const mapUpdateMatches = (rawAccum.match(/\[MAP_UPDATE:[\s\S]*?\]/g) || []);
              const mapReadyMatches = (rawAccum.match(/\[MAP_READY:[\s\S]*?\]/g) || []);
              const partUpdateMatches = (rawAccum.match(/PART_UPDATE:[^\n]+/g) || []);
              if (mapUpdateMatches.length || mapReadyMatches.length || partUpdateMatches.length) {
                console.log(
                  '[marker] reply contained markers — MAP_UPDATE×%d MAP_READY×%d PART_UPDATE×%d',
                  mapUpdateMatches.length, mapReadyMatches.length, partUpdateMatches.length,
                );
                // Pulse the map tab — the server has already persisted the
                // marker into mapData (see persistMarkersForSession on the
                // server side); the pulse signals the user to look.
                pulseMapTab();
              } else {
                console.log('[marker] reply contained no map/part markers');
              }
              if (!revealTimer) {
                // Flush synchronously — no pending reveal loop running.
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamId
                      ? { ...m, text: target, streaming: false, detectedPart: detectedPart || m.detectedPart, partLabel: partLabel ?? m.partLabel }
                      : m,
                  ),
                );
              }
              historyRef.current.push({ role: 'assistant', content: target });
              // Persist the growing transcript so the web app's session list stays in sync.
              api.saveSession({
                id: sessionIdRef.current,
                messages: historyRef.current,
              });
              // If we started a streaming TTS for this reply, flush the
              // tail of the buffer so the final partial sentence is also
              // queued. Queue drains on its own. If audio was muted at
              // start (or got muted mid-stream), we never started — and
              // the user's mute tap already called cancelTTSStream().
              if (streamingTTSStarted) {
                finishTTSStream();
              }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              setSending(false);
              setTyping(false);
              // Stream complete — drop attention indicator back to idle.
              setAttentionState('idle');
            },
            onError: (err) => {
              console.warn('[chat] stream error:', err);
              streamDone = true;
              setAttentionState('idle');
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId
                    ? {
                        ...m,
                        text: 'Something went wrong on my end — take a breath, and try again when you’re ready.',
                        streaming: false,
                        // Carries the original user input so the bubble's RETRY
                        // pill can re-submit without the user retyping. We
                        // pull the most recent user turn out of history.
                        errorRetryText: (() => {
                          for (let i = historyRef.current.length - 1; i >= 0; i--) {
                            if (historyRef.current[i].role === 'user') {
                              return historyRef.current[i].content;
                            }
                          }
                          return null;
                        })(),
                      }
                    : m,
                ),
              );
              // Roll the failed assistant turn out of history so a retry
              // doesn't include a stale empty assistant message in context.
              historyRef.current = historyRef.current.filter(
                (h) => !(h.role === 'assistant' && h.content === ''),
              );
              setSending(false);
              setTyping(false);
            },
          },
        );
      } catch (e) {
        console.warn('[chat] send threw:', (e as Error).message);
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
      addUserMessage(text);
      historyRef.current.push({ role: 'user', content: text });
      runAssistantTurn();
    },
    [sending, runAssistantTurn],
  );

  // ===== RENDER =====
  // Retry handler — removes the failed assistant bubble, then re-submits
  // the original user text. Wired into MessageBubble's onRetry prop.
  const handleRetry = useCallback((text: string) => {
    setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.errorRetryText)));
    handleSend(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bubbleList = useMemo( // eslint-disable-next-line react-hooks/exhaustive-deps
    () => messages.map((m) => <MessageBubble key={m.id} msg={m} onRetry={handleRetry} />),
    [messages],
  );

  return (
    <SafeAreaView style={styles.root} edges={[]}>
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
        <AttentionIndicator />
      </View>
      {/* Mode toggle — Process (gentle holding) vs Explore (active
          map-building). Selection drives which system prompt the
          server uses on /api/chat. Subtle below-strip placement so
          it's always available but never competing with the
          conversation. Reset to 'process' on every new session. */}
      <ChatModeToggle mode={chatMode} onChange={setChatMode} />
      {/* Keyboard avoidance. `keyboardVerticalOffset` must equal the height of
          anything above this KeyboardAvoidingView on the screen: the iOS safe-
          area top inset + the hamburger row (34) + the tab row (40) + the
          ~22px attention strip. Without this the keyboard covers the input
          bar on iPhone. `behavior: padding` shrinks the KAV by the keyboard
          height, pushing ScrollView + ChatInput up together. */}
      {/* keyboardVerticalOffset reduced by ~44px to absorb the height
          of the new ChatModeToggle bar that sits between the
          attention strip and the KAV. The previous offset assumed the
          KAV started right under the attention strip; with the toggle
          in between, the same offset value pushed content too far up
          and produced a visible gap between the input and the
          keyboard. Smaller offset → less upward padding → input sits
          flush above the keyboard. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={
          Platform.OS === 'ios'
            ? insets.top + 34 /* hamburger */ + 40 /* tabs */ + 48 /* attention */ - 44 /* toggle */ - 25 /* gap-close */
            : 0
        }
      >
        <Animated.View style={[styles.flex, { opacity: messagesOpacity }]}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => Keyboard.dismiss()}
          >
            <ChatModeIndicator mode={chatMode} />
            {bubbleList}
            {typing ? <TypingIndicator /> : null}
            {/* Starter chips appear only before the user has said anything. They
                disappear the moment the first user turn is added. */}
            {messages.length > 0 && historyRef.current.every((m) => m.role !== 'user') ? (
              <ConversationStarters onPick={handleSend} starters={starters} />
            ) : null}
          </ScrollView>
        </Animated.View>

        {/* The legacy "Your map has been updated." overlay was replaced
            by the SessionSummaryModal below — it now carries the entire
            end-of-session moment (haptic + structured 3-part summary). */}
        {/* Bottom dock — wraps the input bar + end-session pill in a
            single container so we can lift them off the home indicator
            (insets.bottom + 10). The previous +20 read as too high; a
            smaller gap puts the input visually closer to the bottom
            without sitting on the home bar. */}
        <View style={{ paddingBottom: insets.bottom + 10 }}>
        <ChatInput
          disabled={sending}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
        />
        {/* End session: only appears once a real back-and-forth has happened.
            On commit, flush the transcript to /api/summary + /api/sessions so
            the reflection + title land in the Journal tab immediately. */}
        <EndSessionButton
          // Visible once the session has actually started — i.e. the user
          // has sent at least one message and the AI is responding/has
          // responded. Before that first turn there's nothing to save, and
          // forcing a 3-message threshold was arbitrary.
          visible={historyRef.current.filter((m) => m.role === 'user').length >= 1 && !endingTransition}
          onEnd={async () => {
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
            setEndingTransition(true);
            const transcriptForSave = historyRef.current.slice();
            const sessionIdForSave = sessionIdRef.current;
            Animated.timing(messagesOpacity, {
              toValue: 0, duration: 400,
              easing: Easing.inOut(Easing.ease), useNativeDriver: true,
            }).start();

            // Reset summary state and open the modal in loading mode.
            setSummary(null);
            setSummaryFailed(false);
            setSummaryVisible(true);

            // Fire the structured-summary call. The server persists the
            // result onto the session row; we still call saveSession so
            // the messages array is stored.
            (async () => {
              const sum = await api.getSessionSummary(transcriptForSave, sessionIdForSave);
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

            // Save in parallel — fire-and-forget.
            api.saveSession({ id: sessionIdForSave, messages: transcriptForSave })
              .catch(() => {});

            // Stage the actual reset behind the summary screen's continue
            // button. Captures the snapshots above so the continuation
            // doesn't fight a stale historyRef.
            continueAfterSummaryRef.current = async () => {
              cancelTTSStream();
              setAudioEnabled(false);
              resetAttentionState();
              setSelfMode(false);
              setChatMode('process');           // new session always starts gentle
              clearMapVoiceHistory();           // start map voice fresh next session
              historyRef.current = [];
              setMessages([]);
              sessionIdRef.current = uuidv4();
              const next = await api.getReturningGreeting();
              const greeting = (next.greeting && next.greeting.trim()) || FALLBACK_GREETING;
              if (next.suggestions.length) setStarters(next.suggestions);
              addAssistantMessage(greeting);
              historyRef.current.push({ role: 'assistant', content: greeting });
              // Reveal messages again behind the dismissing summary modal.
              Animated.timing(messagesOpacity, {
                toValue: 1, duration: 500, useNativeDriver: true,
              }).start(() => setEndingTransition(false));
            };
          }}
        />
        </View>
      </KeyboardAvoidingView>

      <SessionSummaryModal
        visible={summaryVisible}
        summary={summary}
        failed={summaryFailed}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.md },
  // Holds the audio mute toggle on the left and the attention indicator
  // on the right. 48px tall to host both 48x48 tap targets.
  headerStrip: {
    height: 48,
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
});
