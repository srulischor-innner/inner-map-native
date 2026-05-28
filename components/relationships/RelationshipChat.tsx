// Private relationship chat sub-view.
//
// Connects to /api/chat with chatMode='relationship' and the
// relationshipId in the body. The server (Phase 3 wiring) handles:
//   • assembleRelationshipContext — partner-context preamble
//   • persistRelationshipTurn      — relationship_messages writes
//   • persistRelationshipMarkers   — RELATIONSHIP_UPDATE / SHARED_PROPOSAL
//   • persistMapMarkersToPartsForUser — bidirectional MAP_UPDATE flow
//
// History is read on mount via api.listRelationshipMessages — only
// THIS partner's messages, never the other partner's. The other side
// is visible to the AI through the server-side preamble but never to
// the calling partner directly.
//
// Reuses the main app's MessageBubble component so bubble visuals,
// markdown rendering, and word-reveal cadence match the rest of the
// app exactly.
//
// PR A polish:
//  - Press-and-hold voice notes: the same <ChatInput> component the
//    main chat tab uses powers our bottom bar, so /api/transcribe
//    drives transcription with the same rate-limit + auth machinery.
//  - Session-level audio toggle: <AudioToggle> in the chat header
//    flips streaming TTS playback on/off. When ON, every new AI
//    reply auto-plays via utils/ttsStream — the same single sequential
//    FIFO chain the main chat tab uses, so the volume-to-1.0 fix and
//    every other ttsStream behaviour applies automatically here.
//    Default OFF; resets to OFF on unmount.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView,
  Platform, StyleSheet, ActivityIndicator, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { v4 as uuidv4 } from 'uuid';

import { colors, fonts, spacing } from '../../constants/theme';
import { api, ChatMessage, RelationshipSession } from '../../services/api';
import { MessageBubble, ChatMsg } from '../MessageBubble';
import { stripMarkers, stripMarkersForDisplay } from '../../utils/markers';
import { ChatInput } from '../ChatInput';
import { AudioToggle } from '../AudioToggle';
import { ConversationStarters } from '../ConversationStarters';
import { EndSessionButton } from '../EndSessionButton';
import { RelationshipSessionSummaryModal } from './RelationshipSessionSummaryModal';

// Opening AI message rendered when the partner chat history is empty
// — gives the user a starting point so they're not staring at a blank
// surface. Parallel to the main Chat tab's returning-greeting opener.
// Built with a {{partner}} placeholder so the same string handles
// "your partner" and a named partner uniformly at render time.
const OPENING_TEMPLATE =
  "What's been on your mind about you and {{partner}}?";

// Partner-chat-specific starter pills shown below the opening. Each
// is a short user-voice opener — distinct from the main chat tab's
// "Something's been on my mind lately" starters because the
// relationship surface invites different conversational entry points.
const RELATIONSHIP_STARTERS: string[] = [
  'Something has been weighing on me',
  'I noticed myself shutting down recently',
  'Want to think through something that happened',
  'Just want to talk through something on my mind',
];
import {
  startStream as startTTSStream, appendStreamText as appendTTSStream,
  finishStream as finishTTSStream, cancelStream as cancelTTSStream,
  playMessageNow as playTTSNow,
} from '../../utils/ttsStream';

// ms/word reveal cadence — matches the main chat tab so a reply that
// arrives in one chunk still reads like it's being spoken.
const PER_WORD_MS = 45;

export function RelationshipChat({
  relationshipId,
  partnerName,
}: {
  relationshipId: string;
  partnerName: string | null;
  // PR C: prefill / onPrefillConsumed removed. The old shared-feed
  // "prompt chip" workflow no longer exists — the new shared-space
  // dialogue model uses structured multiple-choice options instead
  // of seeding the private chat with a pre-filled draft.
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  // historyRef tracks the wire-format conversation we send to /api/chat.
  // Live turns are pushed here as they complete; the bubble list
  // (`messages`) is presentational and drives the UI render.
  const historyRef = useRef<ChatMessage[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);

  // ===== SESSION STATE =====
  // Server-side relationship_sessions row that brackets this partner
  // chat. Auto-opened on mount (resume-or-fresh, 60min staleness),
  // closed by tap-and-hold of the EndSessionButton, then a summary +
  // 1-3 practices land in the RelationshipSessionSummaryModal.
  // sessionIdRef mirrors the id for the End handler so a mid-session
  // re-render doesn't lose the reference. userSentInSessionRef drives
  // EndSessionButton.visible (only show after a real back-and-forth).
  const [activeSession, setActiveSession] = useState<RelationshipSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const userSentInSessionRef = useRef(false);
  const [, setSessionTick] = useState(0); // forces EndSessionButton re-eval after first user send

  // Summary modal state — open in loading mode the moment the user
  // commits End; populated when api.endRelationshipSession resolves.
  // Failed = transport/500 OR endpoint returned no session row.
  const [summarySession, setSummarySession] = useState<RelationshipSession | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [endingTransition, setEndingTransition] = useState(false);

  // ===== AUDIO TOGGLE =====
  // Session-level audio mute/unmute. Default OFF — user opts in each
  // visit by tapping the speaker icon in the chat header. When ON, every
  // new AI reply auto-plays via utils/ttsStream (the same sequential
  // FIFO chain main chat uses). audioEnabledRef mirrors the state so
  // the streaming loop can capture the latest value without going
  // through React's stale-closure trap. Reset to OFF on unmount so an
  // audio session never leaks across screens.
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioEnabledRef = useRef(audioEnabled);
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);

  // Latest messages snapshot for the toggle handler — avoids stale
  // closures when toggleAudio decides which past AI bubble to replay.
  const messagesRef = useRef<ChatMsg[]>([]);
  useEffect(() => { messagesRef.current = messages; });

  // Combined mount flow: start (or resume) the session FIRST, then
  // load only THIS session's messages. Replaces the prior two-effect
  // pattern which loaded ALL of the user's relationship_messages and
  // then started the session in parallel — the result was that on
  // every entry to Partner chat, the live view contained every
  // historical message ever sent in this relationship (build-13 bug
  // report).
  //
  // Order matters:
  //   1. /sessions/start returns the active session id (resumed if
  //      <60min idle, fresh otherwise). The server has already
  //      auto-ended any stale open session + fired its summary.
  //   2. /messages?sessionId=<id> scopes to JUST that session's
  //      turns. A freshly-minted session returns zero rows → opener
  //      message + starter pills render, just like main Chat after
  //      "Begin New Session".
  //   3. If the start endpoint fails (rare — network blip), we fall
  //      back to loading all messages so the user isn't staring at
  //      a blank screen with their conversation history seemingly
  //      gone. End Session disables itself in this branch since
  //      there's nothing bracketed to close.
  //
  // Legacy messages (sessionId IS NULL from before sessions shipped)
  // are EXCLUDED from this view by the server's sessionId filter.
  // They surface in the hamburger as per-day "Partner chat" entries.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const startResult = await api.startRelationshipSession(relationshipId);
      if (cancelled) return;
      let sessionIdForFetch: string | null = null;
      if (startResult?.session) {
        setActiveSession(startResult.session);
        sessionIdRef.current = startResult.session.id;
        sessionIdForFetch = startResult.session.id;
      } else {
        console.warn('[rel-chat] session start returned null — falling back to unscoped load');
      }
      const rows = await api.listRelationshipMessages(relationshipId, sessionIdForFetch);
      if (cancelled) return;
      // Server returns newest-first; reverse for display (oldest-first).
      const ordered = rows.slice().reverse();
      const bubbles: ChatMsg[] = ordered.map((r) => ({
        id: r.id, role: r.role, text: r.content,
      }));
      const wire: ChatMessage[] = ordered.map((r) => ({ role: r.role, content: r.content }));
      setMessages(bubbles);
      historyRef.current = wire;
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    })();
    return () => { cancelled = true; };
  }, [relationshipId]);

  // Cleanup TTS on unmount — leaving the Partner chat must NOT leave
  // an in-flight TTS chain playing. The module-level cancelStream
  // resets the queue + bumps watchToken so any pending chain step
  // short-circuits.
  useEffect(() => () => { cancelTTSStream(); }, []);

  // (PR C — the old prefill path from the Shared feed was retired.
  // ChatInput's prefillText/onPrefillConsumed props are still
  // available for future callers but are not wired here.)

  // ===== AUTO-SCROLL: PAUSE-ON-TOUCH + PAUSE-WHEN-SCROLLED-AWAY =====
  // Streaming AI replies append new text mid-render; we want the view
  // to follow the latest line by default so the user sees the reply
  // unfold without scrolling manually. BUT — if the user puts a
  // finger on the screen mid-stream (to read something they want to
  // dwell on, or to scroll up to re-read earlier turns), pin the
  // scroll position so text doesn't yank away.
  //
  // Two refs cover the two pause conditions:
  //   userTouchingRef     — true between onTouchStart and onTouchEnd.
  //                         Pauses for the duration of the active
  //                         finger contact (the common case: user
  //                         touches mid-stream to read).
  //   userScrolledAwayRef — true while the user is scrolled more than
  //                         AUTOSCROLL_BOTTOM_THRESHOLD_PX from the
  //                         bottom. Pauses persistently until they
  //                         scroll back down — covers the case where
  //                         they touched, scrolled up, then released
  //                         their finger but are still reading higher
  //                         up.
  //
  // Resume points (auto):
  //   - User scrolls back to bottom (userScrolledAwayRef clears via
  //     onScroll) AND lifts their finger (userTouchingRef clears).
  //   - A new turn starts (handleSend / handleSendVoice resets both
  //     refs unconditionally — the user sending implies they want to
  //     follow their new turn through).
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
  // Manual override — fires from handleSend / handleSendVoice when
  // the user's own turn starts, so we follow our own message even if
  // the user happened to be scrolled up reading earlier turns.
  const forceResumeAutoScroll = useCallback(() => {
    userTouchingRef.current = false;
    userScrolledAwayRef.current = false;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (userTouchingRef.current) return;       // pause while finger is down
    if (userScrolledAwayRef.current) return;   // pause while reading higher up
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  // Toggle session audio. Mirrors the main chat tab's logic:
  //   OFF → ON: enable, then play the most recent finished AI bubble
  //     BEFORE the user's last message (if any). No user message yet
  //     means we don't auto-play the opening — subsequent AI replies
  //     will pick up audio through the streamingTTSStarted capture in
  //     the streaming loop below.
  //   ON → OFF: cancel any in-flight playback immediately.
  const toggleAudio = useCallback(() => {
    const wasOn = audioEnabledRef.current;
    if (wasOn) {
      cancelTTSStream();
      setAudioEnabled(false);
      return;
    }
    audioEnabledRef.current = true;
    setAudioEnabled(true);
    const list = messagesRef.current;
    let lastUserIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return; // no user msg yet → wait for next AI reply
    const target = (() => {
      for (let i = lastUserIdx - 1; i >= 0; i--) {
        const m = list[i];
        if (m.role === 'assistant' && !m.streaming && m.text && m.text.trim()) return m;
      }
      return null;
    })();
    if (target) {
      // Belt-and-braces: cancelTTSStream right before kicking off the
      // toggle-on replay so there's no observable window where two
      // streams could overlap. playTTSNow also calls cancelStream
      // internally — this is defense-in-depth.
      cancelTTSStream();
      playTTSNow(target.id, target.text).catch((e) =>
        console.warn('[rel-chat-tts] playMessageNow threw:', (e as Error)?.message),
      );
    }
  }, []);

  // ===== STREAMING ASSISTANT TURN =====
  // Runs the AI streaming reply for a turn whose user bubble + history
  // entry have ALREADY been pushed by the caller. Same shape as the
  // main chat tab's runAssistantTurn — split out so the text-send path
  // and the voice-note path share the streaming + reveal logic.
  const runAssistantTurn = useCallback(async () => {
    if (sending) return;
    setSending(true);

    // Streaming assistant bubble — text grows word-by-word as the
    // reveal loop ticks.
    const streamId = uuidv4();
    setMessages((prev) => [...prev, { id: streamId, role: 'assistant', text: '', streaming: true }]);

    let revealed = 0;
    let target = '';
    let rawAccum = '';
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    let streamDone = false;

    const tickReveal = () => {
      if (revealed >= target.length) {
        revealTimer = null;
        if (streamDone) {
          setMessages((prev) =>
            prev.map((m) => (m.id === streamId ? { ...m, text: target, streaming: false } : m)),
          );
        }
        return;
      }
      let i = revealed;
      while (i < target.length && /\s/.test(target[i])) i++;
      while (i < target.length && !/\s/.test(target[i])) i++;
      revealed = i;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamId
            ? { ...m, text: target.slice(0, revealed), streaming: revealed < target.length || !streamDone }
            : m,
        ),
      );
      scrollToBottom();
      revealTimer = setTimeout(tickReveal, PER_WORD_MS);
    };

    // Capture the audio-toggle state at turn-start so a mid-stream
    // flip doesn't half-start things. The toggle's own cancelTTSStream
    // call still kills any in-flight playback regardless.
    const streamingTTSStarted = audioEnabledRef.current;
    if (streamingTTSStarted) {
      startTTSStream(streamId).catch(() => {});
    }

    try {
      await api.streamChat(
        {
          messages: historyRef.current,
          mode: 'ongoing',
          sessionId: relationshipId,    // server uses this for log correlation only in relationship mode
          chatMode: 'relationship',
          relationshipId,
        },
        {
          onDelta: (delta) => {
            rawAccum += delta;
            target = stripMarkersForDisplay(rawAccum);
            if (!revealTimer) revealTimer = setTimeout(tickReveal, PER_WORD_MS);
            // Stream cleaned text into TTS. Always pass through
            // stripMarkers (NOT the dev-display pass-through) so the
            // model never speaks "MAP_UPDATE colon brace" out loud.
            if (streamingTTSStarted) appendTTSStream(stripMarkers(rawAccum));
          },
          onDone: (full) => {
            rawAccum = full || rawAccum;
            target = stripMarkersForDisplay(rawAccum);
            const cleanText = stripMarkers(rawAccum);
            streamDone = true;
            if (!revealTimer) {
              setMessages((prev) =>
                prev.map((m) => (m.id === streamId ? { ...m, text: target, streaming: false } : m)),
              );
            }
            // History keeps the cleaned version (markers stripped) so
            // they're never echoed back to the model on the next turn.
            historyRef.current.push({ role: 'assistant', content: cleanText });
            // Flush the TTS tail so the final partial sentence is also
            // queued for playback.
            if (streamingTTSStarted) finishTTSStream();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setSending(false);
          },
          onRateLimit: (info) => {
            // Same daily-chat cap that gates the main chat tab.
            // Render the server-prepared message as a rate-limit
            // card via the MessageBubble.rateLimited variant; no
            // retry pill since retrying would just hit the same
            // 429. The text reply still streams in the main chat
            // tab too — limit is global per userId, not per tab.
            console.log('[rel-chat] rate-limited:', info.message);
            streamDone = true;
            setMessages((prev) =>
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
            historyRef.current = historyRef.current.filter(
              (m) => !(m.role === 'assistant' && m.content === ''),
            );
            setSending(false);
          },
          onError: (err) => {
            console.warn('[rel-chat] stream error:', err);
            streamDone = true;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? {
                      ...m,
                      text: "Something went wrong on my end — try again in a moment.",
                      streaming: false,
                      errorRetryText: (() => {
                        const h = historyRef.current;
                        for (let i = h.length - 1; i >= 0; i--) {
                          if (h[i].role === 'user') return h[i].content;
                        }
                        return null;
                      })(),
                    }
                  : m,
              ),
            );
            // Roll the failed turn out of the history so a retry doesn't
            // include a stale empty assistant entry.
            historyRef.current = historyRef.current.filter(
              (m) => !(m.role === 'assistant' && m.content === ''),
            );
            setSending(false);
          },
        },
      );
    } catch (e) {
      console.warn('[rel-chat] send threw:', (e as Error)?.message);
      setSending(false);
    }
  }, [sending, relationshipId, scrollToBottom]);

  // Text-send path: push the user bubble + history entry, then run the
  // assistant turn. Used by ChatInput's onSend and by the retry pill.
  const handleSend = useCallback((textToSend: string) => {
    const t = textToSend.trim();
    if (!t || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const userId = uuidv4();
    setMessages((prev) => [...prev, { id: userId, role: 'user', text: t }]);
    historyRef.current.push({ role: 'user', content: t });
    // Mark this session as "back-and-forth started" so EndSessionButton
    // reveals itself. Forcing a re-render via setSessionTick is the
    // simplest way to pull the ref check through React — a ref change
    // alone wouldn't re-evaluate the button's `visible` prop.
    if (!userSentInSessionRef.current) {
      userSentInSessionRef.current = true;
      setSessionTick((n) => n + 1);
    }
    // Force-resume auto-scroll on user-initiated turn. They might have
    // been scrolled up reading earlier turns; sending implies they
    // want to follow the new exchange through.
    forceResumeAutoScroll();
    // ChatInput owns its own text state and clears itself on send; we
    // just push the bubble + run the turn.
    scrollToBottom();
    runAssistantTurn();
  }, [sending, runAssistantTurn, scrollToBottom, forceResumeAutoScroll]);

  // Voice-note path. Identical contract to the main chat tab's
  // handleSendVoice: ChatInput hands us a recorded file URI; we drop a
  // voice-note bubble immediately, transcribe via /api/transcribe with
  // a 30s hard cap, then push the transcript through the same
  // streaming reply path as a text send. Rate-limit + auth + cost
  // logging machinery applies automatically since the endpoint is
  // shared with the main chat tab.
  const handleSendVoice = useCallback(async ({ uri, durationSec }: { uri: string; durationSec: number }) => {
    if (sending) return;
    const bubbleId = uuidv4();
    setMessages((prev) => [
      ...prev,
      { id: bubbleId, role: 'user', text: '', voice: { uri, durationSec, transcript: null } },
    ]);
    forceResumeAutoScroll();
    scrollToBottom();
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
      console.warn('[rel-chat] voice transcribe failed:', (err as Error)?.message);
    }
    // Update the bubble in place. Empty transcript → bubble stays
    // ("nothing heard"), no AI turn triggered.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === bubbleId && m.voice
          ? { ...m, text: transcript, voice: { ...m.voice, transcript } }
          : m,
      ),
    );
    if (transcript) {
      historyRef.current.push({ role: 'user', content: transcript });
      if (!userSentInSessionRef.current) {
        userSentInSessionRef.current = true;
        setSessionTick((n) => n + 1);
      }
      runAssistantTurn();
    }
  }, [sending, runAssistantTurn, scrollToBottom, forceResumeAutoScroll]);

  const handleRetry = useCallback((retryText: string) => {
    // Drop the failed assistant bubble + its retry shadow, then re-send.
    setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.errorRetryText)));
    handleSend(retryText);
  }, [handleSend]);

  const bubbleList = useMemo(
    () => messages.map((m) => (
      <MessageBubble
        key={m.id}
        msg={m}
        onRetry={handleRetry}
        // PR C: pass relationshipId + partnerName so MessageBubble
        // renders [SHARE_SUGGEST: …] markers as SharePromptCards
        // inline. Without these props the marker is preserved in
        // the bubble text but no card renders — desired behavior
        // for the main chat tab; here we want the cards.
        relationshipId={relationshipId}
        partnerName={partnerName}
      />
    )),
    [messages, handleRetry, relationshipId, partnerName],
  );

  // Partner-display name resolved once per render. The opening message
  // uses "your partner" as a friendly fallback when the partner's
  // display name isn't yet on the relationship row (e.g. accepted but
  // no name set).
  const partnerDisplay = partnerName || 'your partner';
  const openingText = OPENING_TEMPLATE.replace('{{partner}}', partnerDisplay);

  // Manual keyboard-height lift. The previous KeyboardAvoidingView
  // tuning (keyboardVerticalOffset = insets.top + 60) consistently
  // left the input bar under the iOS keyboard's autocomplete
  // suggestion bar on real devices. Same fix the Ask modal got in
  // polish round 1 (commit 41cb4bc): listen for keyboardWillShow /
  // keyboardWillHide on iOS (keyboardDidShow/Hide on Android — those
  // are the only events Android emits) and pull the keyboard height
  // directly from the event payload. We apply that height as
  // paddingBottom on the input wrapper so the bar lifts in lockstep
  // with the keyboard's own animation and clears the suggestion bar
  // automatically (the height OS reports includes the suggestion
  // strip when it's visible).
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
      // Build 11 bug fix — the kbHeight padding lifts the INPUT BAR
      // above the keyboard, but the ScrollView keeps its contentOffset.
      // Without an explicit scrollToEnd, the last 1–2 messages slide
      // under the (now-smaller) ScrollView's bottom edge and get
      // clipped behind the input bar / hidden above the keyboard.
      // Same pattern the main chat tab uses (app/(tabs)/index.tsx ~570).
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  return (
    <View style={styles.flex}>
      {/* Header strip — hosts the session audio mute/unmute toggle.
          Default OFF; tapping enables auto-play for every new AI
          reply via utils/ttsStream. Tapping again kills any in-flight
          playback immediately. No per-message controls (matches main
          chat tab behavior). */}
      <View style={styles.headerStrip}>
        <AudioToggle enabled={audioEnabled} onToggle={toggleAudio} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.amber} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          // Auto-scroll pause-on-touch wiring (build 13 polish):
          //   - onTouchStart/End drive userTouchingRef so scrollToBottom
          //     becomes a no-op while finger is down.
          //   - onScroll drives userScrolledAwayRef so scrollToBottom
          //     also no-ops while the user has scrolled up to read.
          //   - scrollEventThrottle=16 (~60 FPS) keeps the distance-
          //     from-bottom check responsive without overspending
          //     bridge messages during inertial scroll.
          onTouchStart={onScrollViewTouchStart}
          onTouchEnd={onScrollViewTouchEnd}
          onTouchCancel={onScrollViewTouchEnd}
          onScroll={onScrollViewScroll}
          scrollEventThrottle={16}
          // Force a re-flow + scroll when bubble heights finalize.
          // Build-13 polish: occasional message clipping reports
          // ("text cuts off mid-word but TTS reads the full
          // sentence") trace to a streaming/layout race where the
          // ScrollView measures content height before the final
          // streamed tokens land. onContentSizeChange fires on
          // every content-size delta — including the final
          // measurement after the streaming bubble settles — so
          // hitting scrollToBottom() here triggers a fresh layout
          // pass that surfaces any clipped tail. Guarded by
          // userTouching/scrolledAway refs above, so passive
          // re-flow doesn't yank the view from a user mid-read.
          onContentSizeChange={scrollToBottom}
          onScrollBeginDrag={() => Keyboard.dismiss()}
        >
          {/* First-visit opening. Renders only when the partner chat
              has no prior turns. The opening AI message goes through
              MessageBubble (same typeface + styling as a real reply
              so the user doesn't read it as a separate kind of UI).
              The privacy hint below it is the existing italic empty-
              state copy, kept as quieter secondary text. Starter
              prompt pills sit beneath both. */}
          {messages.length === 0 ? (
            <>
              <MessageBubble
                msg={{ id: 'partner-chat-opening', role: 'assistant', text: openingText }}
              />
              <Text style={styles.emptyHint}>
                Your private space about you and {partnerDisplay}. Anything you write
                here stays between you and the AI — your partner only sees what you both choose to
                share.
              </Text>
              <ConversationStarters
                onPick={handleSend}
                starters={RELATIONSHIP_STARTERS}
              />
            </>
          ) : null}
          {bubbleList}
          {sending ? (
            <Text style={styles.typingHint}>thinking…</Text>
          ) : null}
        </ScrollView>
      )}

      {/* ChatInput — same component the main chat tab uses, so we
          inherit press-and-hold voice notes, the recording pill
          overlay, the min-duration guard, and the input clearing
          fix. The wrapper's paddingBottom lifts the bar above the
          keyboard (kbHeight) plus the safe-area home-indicator gap
          (insets.bottom) when the keyboard is hidden. When the
          keyboard is up, kbHeight already covers the home-indicator
          area so we don't double-pad.
          End-session pill sits beneath the input, mirroring the
          main chat tab's dock layout — visible once the user has
          sent at least one message in the active session AND the
          server returned a session id (otherwise End would be a
          no-op). Hidden during the ending transition so the user
          can't tap twice. */}
      <View style={{ paddingBottom: kbHeight > 0 ? kbHeight : Math.max(insets.bottom, 6) }}>
        <ChatInput
          disabled={sending}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
        />
        <EndSessionButton
          visible={
            !!sessionIdRef.current &&
            userSentInSessionRef.current &&
            !endingTransition
          }
          onEnd={async () => {
            const sid = sessionIdRef.current;
            if (!sid) return;
            // 1) Block re-entry + open the summary modal in loading mode.
            setEndingTransition(true);
            setSummarySession(null);
            setSummaryFailed(false);
            setSummaryVisible(true);
            // 2) Fire the end-session call. Server closes the
            //    session row, runs the summary prompt inline (one
            //    Anthropic call), persists summary + practicesJson,
            //    and returns the populated row. Typical 2-5s.
            try {
              const result = await api.endRelationshipSession(sid);
              if (result?.session) {
                setSummarySession(result.session);
              } else {
                setSummaryFailed(true);
              }
            } catch (e) {
              console.warn('[rel-chat] end-session threw:', (e as Error)?.message);
              setSummaryFailed(true);
            }
          }}
        />
      </View>

      {/* End-of-session summary modal — full-screen slide-up with
          the AI-generated recap + practice cards. onContinue fires
          when the user taps "Begin New Session"; we close the modal,
          reset the local chat state, and open a fresh session. */}
      <RelationshipSessionSummaryModal
        visible={summaryVisible}
        session={summarySession}
        failed={summaryFailed}
        relationshipId={relationshipId}
        partnerName={partnerName}
        onContinue={async () => {
          // Close the modal first so the dismiss animation overlaps
          // with the chat reset.
          setSummaryVisible(false);
          setSummarySession(null);
          setSummaryFailed(false);
          // Reset local chat state — messages cleared, history wiped,
          // session refs nulled. Note: the SERVER's
          // relationship_messages table is NOT cleared (sessions are
          // a bracketing concept; the history persists across them).
          // We just clear the LOCAL view so the new session starts
          // visually fresh. The opening message + starter pills
          // re-render via messages.length === 0.
          cancelTTSStream();
          setAudioEnabled(false);
          setMessages([]);
          historyRef.current = [];
          userSentInSessionRef.current = false;
          sessionIdRef.current = null;
          setActiveSession(null);
          setEndingTransition(false);
          // Mint a fresh session. Same resume-or-fresh endpoint as
          // mount; staleness window means we'll always get a new
          // session row here since we just closed the previous one.
          const result = await api.startRelationshipSession(relationshipId);
          if (result?.session) {
            setActiveSession(result.session);
            sessionIdRef.current = result.session.id;
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.md, paddingBottom: spacing.lg },
  // Slim header strip — hosts the audio toggle. Mirrors the main
  // chat tab's headerStrip height + alignment so the speaker icon
  // sits in a familiar place. Left-aligned because the Partner tab's
  // floating ℹ︎ button lives in the top-right of the parent screen.
  headerStrip: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.sm,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    borderBottomWidth: 0.5,
  },
  emptyHint: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  typingHint: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
  },
});
