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
import { parseChatMeta, stripMarkers } from '../../utils/markers';
import { colors, spacing } from '../../constants/theme';
import { pulseMapTab } from '../../utils/mapPulse';
import { consumeSelfMode } from '../../utils/selfMode';
import { prefetchTTS, clearTTSCache } from '../../utils/ttsCache';

import { MessageBubble, ChatMsg } from '../../components/MessageBubble';
import { TypingIndicator } from '../../components/TypingIndicator';
import { ChatInput } from '../../components/ChatInput';
import { ConversationStarters } from '../../components/ConversationStarters';
import { EndSessionButton } from '../../components/EndSessionButton';

// ms/word reveal cadence — matches the web app's `perWordMs: 45`.
const PER_WORD_MS = 45;
// Default friendly greeting if the /api/returning-greeting endpoint doesn't respond.
const FALLBACK_GREETING = "Hey — I'm glad you're here. What's alive for you right now?";

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
  // End-session transition. When the user commits, we fade the messages out
  // then cross-fade a centered "Your map has been updated." overlay in for a
  // beat, then fade that out and reload the fresh session. Done with RN
  // Animated because we're driving straight View opacities.
  const [endingTransition, setEndingTransition] = useState(false);
  const messagesOpacity = useRef(new Animated.Value(1)).current;
  const transitionOpacity = useRef(new Animated.Value(0)).current;
  // Safe-area top inset + top-bar chrome height — used as keyboardVerticalOffset
  // so the KeyboardAvoidingView pushes the input bar exactly above the keyboard
  // without leaving a gap or going too far.
  const insets = useSafeAreaInsets();

  // ===== BOOT: returning greeting + map state =====
  // Instead of inserting a placeholder bubble that then gets swapped (which
  // read as a glitch), we show the typing indicator immediately and insert
  // the greeting bubble only once — when the real text is ready.
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
      const openerId = addAssistantMessage(finalGreeting);
      historyRef.current.push({ role: 'assistant', content: finalGreeting });
      setTyping(false);
      // Warm TTS cache for the greeting so the speaker icon is instant.
      prefetchTTS(openerId, finalGreeting);
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
    // .m4a from expo-audio's HIGH_QUALITY preset.
    const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
    let transcript = '';
    try {
      const t = await api.transcribe(uri, mime);
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

      try {
        await api.streamChat(
          {
            messages: historyRef.current,
            mode,
            sessionId: sessionIdRef.current,
            selfMode,
          },
          {
            onDelta: (delta) => {
              rawAccum += delta;
              target = stripMarkers(rawAccum);
              if (typing) setTyping(false);
              if (!revealTimer) revealTimer = setTimeout(tickReveal, PER_WORD_MS);
              // Fire part detection ONCE the moment CHAT_META parses successfully.
              if (!partFired) {
                const meta = parseChatMeta(rawAccum);
                if (meta?.detectedPart && meta.detectedPart !== 'unknown') {
                  partFired = true;
                  detectedPart = meta.detectedPart;
                  partLabel = meta.partLabel ?? null;
                  Haptics.selectionAsync().catch(() => {});
                  // Signal the top tab bar to pulse the MAP label — a gentle
                  // "your map just updated" cue that doesn't interrupt chat.
                  pulseMapTab();
                }
              }
            },
            onDone: (full) => {
              rawAccum = full || rawAccum;
              target = stripMarkers(rawAccum);
              streamDone = true;
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
              // Warm the TTS cache so tapping the speaker on this bubble
              // plays instantly instead of waiting on /api/speak. Keyed by
              // the streaming bubble's id (same one MessageBubble uses).
              prefetchTTS(streamId, target);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              setSending(false);
              setTyping(false);
            },
            onError: (err) => {
              console.warn('[chat] stream error:', err);
              streamDone = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId
                    ? {
                        ...m,
                        text: 'Something went wrong on my end — take a breath, and try again when you’re ready.',
                        streaming: false,
                      }
                    : m,
                ),
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
    [sending, mode, typing, selfMode],
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
  const bubbleList = useMemo(
    () => messages.map((m) => <MessageBubble key={m.id} msg={m} />),
    [messages],
  );

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* "Hey [Name]" row removed — the greeting itself is personal enough. */}
      {/* Keyboard avoidance. `keyboardVerticalOffset` must equal the height of
          anything above this KeyboardAvoidingView on the screen: the iOS safe-
          area top inset + the hamburger row (34) + the tab row (40). Without
          this the keyboard covers the input bar on iPhone. `behavior: padding`
          shrinks the KAV by the keyboard height, pushing ScrollView + ChatInput
          up together. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={
          Platform.OS === 'ios'
            ? insets.top + 34 /* hamburger row */ + 40 /* tabs */
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
            {bubbleList}
            {typing ? <TypingIndicator /> : null}
            {/* Starter chips appear only before the user has said anything. They
                disappear the moment the first user turn is added. */}
            {messages.length > 0 && historyRef.current.every((m) => m.role !== 'user') ? (
              <ConversationStarters onPick={handleSend} starters={starters} />
            ) : null}
          </ScrollView>
        </Animated.View>

        {/* End-session overlay — only rendered while the transition is
            active. Absolute-positioned so it sits on top of the messages
            layer without affecting the keyboard-avoiding layout. */}
        {endingTransition ? (
          <Animated.View pointerEvents="none" style={[styles.transition, { opacity: transitionOpacity }]}>
            <Text style={styles.transitionText}>Your map has been updated.</Text>
          </Animated.View>
        ) : null}
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
            // 1) Fade messages out (500ms)
            // 2) Soft success haptic as the "Your map has been updated." overlay
            //    fades in
            // 3) Hold 2s
            // 4) Fade overlay out (500ms) while we reset + fetch fresh greeting
            setEndingTransition(true);
            Animated.timing(messagesOpacity, {
              toValue: 0, duration: 500,
              easing: Easing.inOut(Easing.ease), useNativeDriver: true,
            }).start();

            // Kick save/summary in parallel with the fade — no reason to block.
            const saveWork = (async () => {
              try {
                await fetch(api.baseUrl + '/api/summary', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ messages: historyRef.current, sessionId: sessionIdRef.current }),
                }).catch(() => {});
                await api.saveSession({ id: sessionIdRef.current, messages: historyRef.current });
              } catch {}
            })();

            await new Promise((r) => setTimeout(r, 500));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            Animated.timing(transitionOpacity, {
              toValue: 1, duration: 350, useNativeDriver: true,
            }).start();

            await new Promise((r) => setTimeout(r, 2000));
            await saveWork;

            // Reset session while overlay still covers the screen. Self mode
            // is session-scoped — the next session starts in normal mode.
            // TTS cache is also session-scoped; drop it so the new session's
            // first bubble doesn't accidentally play audio from the old one
            // if the new bubble happens to get the same (uuid-unlikely) id.
            clearTTSCache();
            setSelfMode(false);
            historyRef.current = [];
            setMessages([]);
            sessionIdRef.current = uuidv4();
            const next = await api.getReturningGreeting();
            const greeting = (next.greeting && next.greeting.trim()) || FALLBACK_GREETING;
            if (next.suggestions.length) setStarters(next.suggestions);
            const newOpenerId = addAssistantMessage(greeting);
            historyRef.current.push({ role: 'assistant', content: greeting });
            prefetchTTS(newOpenerId, greeting);

            // Crossfade back to messages.
            Animated.parallel([
              Animated.timing(transitionOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
              Animated.timing(messagesOpacity,   { toValue: 1, duration: 500, useNativeDriver: true }),
            ]).start(() => setEndingTransition(false));
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.md },
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
