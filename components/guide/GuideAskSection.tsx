// Guide tab → "Ask" pill. Educational chat that explains the Inner Map
// framework. Backed by the dedicated /api/guide-chat endpoint, which uses
// a separate system prompt and does NOT detect parts, fire markers, save
// sessions, or update the user's map. Pure teaching mode.
//
// Visual differences from the regular Chat tab:
//   - AI messages render with an amber left-border (blockquote style)
//     rather than a full bordered bubble
//   - No part badges, attention indicator, or audio mode toggle
//   - No mic button — text-only input
//   - Conversation starter chips appear below the opening message until
//     the first user turn fires
//
// History is held in component state. The component owns no persistence —
// switching pills resets the conversation, which is the spec'd behavior
// for an educational sandbox.

import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api, ChatMessage } from '../../services/api';

const OPENING_MESSAGE =
  "Curious about something you read? Ask me anything — about the framework, how it works, what any of it means. There are no wrong questions here. We can stay simple or go as deep as you want.";

const STARTER_QUESTIONS: string[] = [
  'What is a part?',
  'How is this different from therapy?',
  'What is the wound?',
  'What does healing actually look like?',
  "What's the difference between Self and the self-like part?",
];

type Turn = { id: string; role: 'user' | 'assistant'; text: string };

export function GuideAskSection() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const idRef = useRef(0);
  function nextId() { idRef.current += 1; return 'g' + idRef.current; }

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    Haptics.selectionAsync().catch(() => {});
    const userTurn: Turn = { id: nextId(), role: 'user', text: trimmed };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    setInput('');
    setLoading(true);
    // Build the messages array passed to /api/guide-chat. Note: we do NOT
    // include the local opening message — it's a UI affordance only, not
    // a real assistant turn. The model sees only real user/assistant pairs.
    const apiMessages: ChatMessage[] = nextTurns.map((t) => ({
      role: t.role,
      content: t.text,
    }));
    const reply = await api.askGuide(apiMessages);
    setLoading(false);
    if (!reply) {
      const errorTurn: Turn = {
        id: nextId(),
        role: 'assistant',
        text: "I couldn't reach the framework guide just now — try again in a moment?",
      };
      setTurns((cur) => [...cur, errorTurn]);
      return;
    }
    const aiTurn: Turn = { id: nextId(), role: 'assistant', text: reply };
    setTurns((cur) => [...cur, aiTurn]);
    // Scroll to the bottom on the next frame so the new bubble lands in view.
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }, [turns, loading]);

  const showStarters = turns.length === 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      style={styles.root}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Opening message — always at the top, styled like an AI bubble. */}
        <AIBubble text={OPENING_MESSAGE} opening />

        {showStarters ? (
          <View style={styles.starters}>
            {STARTER_QUESTIONS.map((q) => (
              <Pressable
                key={q}
                onPress={() => send(q)}
                style={styles.chip}
                accessibilityLabel={`Ask: ${q}`}
              >
                <Text style={styles.chipText}>{q}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {turns.map((t) =>
          t.role === 'user' ? (
            <UserBubble key={t.id} text={t.text} />
          ) : (
            <AIBubble key={t.id} text={t.text} />
          ),
        )}

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.amber} size="small" />
            <Text style={styles.loadingText}>thinking…</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Input bar — text only, no mic. */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask anything about the framework..."
          placeholderTextColor={colors.creamFaint}
          editable={!loading}
          multiline
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <Pressable
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          accessibilityLabel="Send question"
        >
          <Ionicons
            name="arrow-up"
            size={20}
            color={!input.trim() || loading ? colors.creamFaint : colors.background}
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ============================================================================
// AI bubble — amber left-border treatment (blockquote feel) per the spec.
// `opening=true` styles the very first message in Cormorant Garamond with
// a slightly stronger amber tint so it reads as a warm welcome.
// ============================================================================
function AIBubble({ text, opening }: { text: string; opening?: boolean }) {
  return (
    <View style={styles.aiBubble}>
      <Text style={[styles.aiText, opening && styles.aiTextOpening]}>{text}</Text>
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userBubble}>
      <Text style={styles.userText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },

  // AI bubble — left-border amber blockquote style. Distinct from the
  // regular Chat tab's full-bordered amber bubble so the Ask tab feels
  // more like a reference and less like a session.
  aiBubble: {
    borderLeftWidth: 2.5,
    borderLeftColor: colors.amber,
    paddingLeft: spacing.md,
    paddingVertical: 4,
    alignSelf: 'stretch',
  },
  aiText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
  },
  aiTextOpening: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 28,
    color: '#E8D8B8',           // warm amber-tinted cream
  },

  // User bubble — same as regular Chat tab.
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(230,180,122,0.12)',
    borderColor: 'rgba(230,180,122,0.4)',
    borderWidth: 0.5,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '85%',
  },
  userText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },

  // Conversation starter chips — same grammar as ConversationStarters.
  starters: {
    flexDirection: 'column',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.4)',
    backgroundColor: 'rgba(230,180,122,0.08)',
    alignSelf: 'flex-start',
  },
  chipText: {
    color: '#F0EDE8',
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: spacing.md + 2,
    paddingVertical: 4,
  },
  loadingText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    letterSpacing: 0.3,
  },

  // Input bar — text only, no mic.
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(230,180,122,0.2)',
  },
});
