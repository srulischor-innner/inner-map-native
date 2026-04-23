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
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { api, ChatMessage } from '../../services/api';
import { parseChatMeta, stripMarkers } from '../../utils/markers';
import { colors, spacing } from '../../constants/theme';

import { MessageBubble, ChatMsg } from '../../components/MessageBubble';
import { TypingIndicator } from '../../components/TypingIndicator';
import { ChatInput } from '../../components/ChatInput';
import { PhaseIndicator } from '../../components/PhaseIndicator';

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
  const [phase, setPhase] = useState<1 | 2 | 3>(1);
  const [sending, setSending] = useState(false);

  // ===== BOOT: returning greeting + map state =====
  useEffect(() => {
    (async () => {
      const [greeting, map] = await Promise.all([
        api.getReturningGreeting(),
        api.getLatestMap(),
      ]);
      // Derive phase from map completeness — mirrors the web app's rough heuristic:
      //   1 = no core filled, 2 = some core filled, 3 = wound+fixer+skeptic+self-like all present
      const md = map?.mapData || map || {};
      const coreFilled = ['wound', 'fixer', 'skeptic'].filter((k) => !!md?.[k]).length;
      if (coreFilled === 0) setPhase(1);
      else if (coreFilled < 3) setPhase(2);
      else setPhase(3);

      const opener = (greeting && greeting.trim()) || FALLBACK_GREETING;
      addAssistantMessage(opener);
      historyRef.current.push({ role: 'assistant', content: opener });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== MESSAGE HELPERS =====
  function addAssistantMessage(text: string, meta?: { detectedPart?: string; partLabel?: string | null }) {
    setMessages((prev) => [
      ...prev,
      {
        id: uuidv4(),
        role: 'assistant',
        text,
        detectedPart: meta?.detectedPart,
        partLabel: meta?.partLabel,
      },
    ]);
    scrollToBottom();
  }

  function addUserMessage(text: string) {
    setMessages((prev) => [...prev, { id: uuidv4(), role: 'user', text }]);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  // ===== SEND =====
  const handleSend = useCallback(
    async (text: string) => {
      if (sending || !text.trim()) return;
      setSending(true);
      addUserMessage(text);
      historyRef.current.push({ role: 'user', content: text });
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
            mode: phase >= 2 ? 'ongoing' : 'onboarding',
            sessionId: sessionIdRef.current,
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
    [sending, phase, typing],
  );

  // ===== RENDER =====
  const bubbleList = useMemo(
    () => messages.map((m) => <MessageBubble key={m.id} msg={m} />),
    [messages],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <PhaseIndicator phase={phase} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 4 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => Keyboard.dismiss()}
        >
          {bubbleList}
          {typing ? <TypingIndicator /> : null}
          {messages.length === 0 ? (
            <Text style={styles.empty}>Warming up…</Text>
          ) : null}
        </ScrollView>
        <ChatInput disabled={sending} onSend={handleSend} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.md },
  empty: { color: colors.creamFaint, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.xl },
});
