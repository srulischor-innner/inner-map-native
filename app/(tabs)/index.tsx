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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { api, ChatMessage } from '../../services/api';
import { parseChatMeta, stripMarkers } from '../../utils/markers';
import { colors, spacing } from '../../constants/theme';

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
  // Name pulled from intake for the 'Hey [Name]' line — null when unknown.
  const [userName, setUserName] = useState<string | null>(null);
  // Safe-area top inset + top-bar chrome height — used as keyboardVerticalOffset
  // so the KeyboardAvoidingView pushes the input bar exactly above the keyboard
  // without leaving a gap or going too far.
  const insets = useSafeAreaInsets();

  // ===== BOOT: returning greeting + map state =====
  useEffect(() => {
    (async () => {
      // Drop the fallback greeting immediately so the screen NEVER sits empty
      // while we wait on the network. If a real returning greeting arrives, we
      // swap the first bubble's text to the personalized version.
      const openerId = addAssistantMessage(FALLBACK_GREETING);
      historyRef.current.push({ role: 'assistant', content: FALLBACK_GREETING });

      let greeting: string | null = null;
      let map: any = null;
      let intake: any = null;
      try {
        [greeting, map, intake] = await Promise.all([
          api.getReturningGreeting(),
          api.getLatestMap(),
          api.getIntake(),
        ]);
      } catch (err) {
        console.warn('[chat] boot fetch failed:', (err as Error)?.message);
      }

      // Drive /api/chat mode from map completeness — if the user has any core
      // node filled we're past first-session territory.
      const md = map?.mapData || map || {};
      const anyCoreFilled = ['wound', 'fixer', 'skeptic'].some((k) => !!md?.[k]);
      setMode(anyCoreFilled ? 'ongoing' : 'onboarding');

      // Pull the first name if intake is complete — shown as "Hey [Name]" below
      // the top tabs. If absent we render nothing.
      if (intake?.name && typeof intake.name === 'string' && intake.name.trim()) {
        setUserName(intake.name.trim().split(/\s+/)[0]);
      }

      // Upgrade the fallback greeting if the server returned a personalized one.
      if (greeting && greeting.trim() && greeting.trim() !== FALLBACK_GREETING) {
        setMessages((prev) =>
          prev.map((m) => (m.id === openerId ? { ...m, text: greeting!.trim() } : m)),
        );
        // Replace the first history entry too so chat context uses the real opener.
        if (historyRef.current[0]?.role === 'assistant') {
          historyRef.current[0] = { role: 'assistant', content: greeting.trim() };
        }
      }
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
            mode,
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
    [sending, mode, typing],
  );

  // ===== RENDER =====
  const bubbleList = useMemo(
    () => messages.map((m) => <MessageBubble key={m.id} msg={m} />),
    [messages],
  );

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* Personal greeting line below the top tabs. Only rendered when we have
          a real name from intake — intentionally blank otherwise so there's no
          "Hey friend" placeholder feel. */}
      {userName ? (
        <View style={styles.heyRow}>
          <Text style={styles.heyText}>Hey {userName}</Text>
        </View>
      ) : null}
      {/* Keyboard avoidance. `keyboardVerticalOffset` must equal the height of
          anything above this KeyboardAvoidingView on the screen: the iOS safe-
          area top inset + the hamburger row (34) + the tab row (40) + the
          optional 'Hey Name' row (~26). Without this the keyboard covers the
          input bar on iPhone. `behavior: padding` shrinks the KAV by the
          keyboard height, pushing our ScrollView + ChatInput up together. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={
          Platform.OS === 'ios'
            ? insets.top + 34 /* hamburger row */ + 40 /* tabs */ + (userName ? 26 : 0)
            : 0
        }
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
          {/* Starter chips appear only before the user has said anything. They
              disappear the moment the first user turn is added. */}
          {messages.length > 0 && historyRef.current.every((m) => m.role !== 'user') ? (
            <ConversationStarters onPick={handleSend} />
          ) : null}
          {messages.length === 0 ? (
            <Text style={styles.empty}>Warming up…</Text>
          ) : null}
        </ScrollView>
        <ChatInput disabled={sending} onSend={handleSend} />
        {/* End session: only appears once a real back-and-forth has happened.
            On commit, flush the transcript to /api/summary + /api/sessions so
            the reflection + title land in the Journal tab immediately. */}
        <EndSessionButton
          visible={historyRef.current.filter((m) => m.role === 'user').length >= 2}
          onEnd={async () => {
            try {
              // Kick the summary build; the server handles the async part.
              await fetch(api.baseUrl + '/api/summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: historyRef.current, sessionId: sessionIdRef.current }),
              }).catch(() => {});
              await api.saveSession({ id: sessionIdRef.current, messages: historyRef.current });
            } catch {}
            // Start a fresh session on the same screen.
            historyRef.current = [];
            setMessages([]);
            sessionIdRef.current = uuidv4();
            // Re-fetch the greeting for the new session.
            const greeting = (await api.getReturningGreeting()) || FALLBACK_GREETING;
            addAssistantMessage(greeting);
            historyRef.current.push({ role: 'assistant', content: greeting });
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
  empty: { color: colors.creamFaint, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.xl },
  heyRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  heyText: {
    color: colors.amberDim,        // dim amber per spec
    fontSize: 12,
    letterSpacing: 0.3,
    fontStyle: 'italic',
  },
});
