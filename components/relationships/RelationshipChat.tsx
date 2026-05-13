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
  View, Text, ScrollView, KeyboardAvoidingView,
  Platform, StyleSheet, ActivityIndicator, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { v4 as uuidv4 } from 'uuid';

import { colors, fonts, spacing } from '../../constants/theme';
import { api, ChatMessage } from '../../services/api';
import { MessageBubble, ChatMsg } from '../MessageBubble';
import { stripMarkers, stripMarkersForDisplay } from '../../utils/markers';
import { ChatInput } from '../ChatInput';
import { AudioToggle } from '../AudioToggle';
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

  // Initial history fetch — load all of THIS partner's prior turns.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await api.listRelationshipMessages(relationshipId);
      if (cancelled) return;
      // Server returns newest-first; we want oldest-first for display.
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

  const scrollToBottom = useCallback(() => {
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
    // ChatInput owns its own text state and clears itself on send; we
    // just push the bubble + run the turn.
    scrollToBottom();
    runAssistantTurn();
  }, [sending, runAssistantTurn, scrollToBottom]);

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
      runAssistantTurn();
    }
  }, [sending, runAssistantTurn, scrollToBottom]);

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

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 60 : 0}
    >
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
          onScrollBeginDrag={() => Keyboard.dismiss()}
        >
          {messages.length === 0 ? (
            <Text style={styles.emptyHint}>
              Your private space about you and {partnerName || 'your partner'}. Anything you write
              here stays between you and the AI — your partner only sees what you both choose to
              share.
            </Text>
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
          fix. onSendVoice handles transcription via /api/transcribe;
          onSend handles the text path. The "Share what feels true…"
          placeholder inside ChatInput already matches the previous
          inline-bar placeholder. */}
      <View style={{ paddingBottom: Math.max(insets.bottom, 6) }}>
        <ChatInput
          disabled={sending}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
        />
      </View>
    </KeyboardAvoidingView>
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
