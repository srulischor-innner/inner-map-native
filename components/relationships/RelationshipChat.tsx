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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, KeyboardAvoidingView,
  Platform, StyleSheet, ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { v4 as uuidv4 } from 'uuid';

import { colors, fonts, spacing } from '../../constants/theme';
import { api, ChatMessage } from '../../services/api';
import { MessageBubble, ChatMsg } from '../MessageBubble';
import { stripMarkers, stripMarkersForDisplay } from '../../utils/markers';

// ms/word reveal cadence — matches the main chat tab so a reply that
// arrives in one chunk still reads like it's being spoken.
const PER_WORD_MS = 45;

export function RelationshipChat({
  relationshipId,
  partnerName,
  prefill,
  onPrefillConsumed,
}: {
  relationshipId: string;
  partnerName: string | null;
  /** Optional prefilled draft from a Shared-feed prompt chip ("Tell me
   *  more about this", etc). When set, the input is seeded with this
   *  text and onPrefillConsumed fires once the local state mirrors it
   *  so the parent can clear the prefill prop. */
  prefill?: string | null;
  onPrefillConsumed?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  // historyRef tracks the wire-format conversation we send to /api/chat.
  // Live turns are pushed here as they complete; the bubble list
  // (`messages`) is presentational and drives the UI render.
  const historyRef = useRef<ChatMessage[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);

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

  // Apply an incoming prefill from the Shared feed once. The effect
  // also calls onPrefillConsumed so the parent can clear its prop and
  // future chips can deliver fresh prefills.
  useEffect(() => {
    if (!prefill) return;
    setText(prefill);
    onPrefillConsumed?.();
    // No auto-send — the user reads + edits + decides to send.
  }, [prefill, onPrefillConsumed]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const handleSend = useCallback(async () => {
    const t = text.trim();
    if (!t || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // Optimistic user bubble.
    const userId = uuidv4();
    const userBubble: ChatMsg = { id: userId, role: 'user', text: t };
    setMessages((prev) => [...prev, userBubble]);
    historyRef.current.push({ role: 'user', content: t });
    setText('');
    scrollToBottom();

    // Streaming assistant bubble — text grows word-by-word as the
    // reveal loop ticks. The same pattern as the main chat tab.
    const streamId = uuidv4();
    setMessages((prev) => [...prev, { id: streamId, role: 'assistant', text: '', streaming: true }]);
    setSending(true);

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
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
                      errorRetryText: t,
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
  }, [text, sending, relationshipId, scrollToBottom]);

  const handleRetry = useCallback((retryText: string) => {
    // Drop the failed assistant bubble + its retry shadow, then re-send.
    setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.errorRetryText)));
    setText(retryText);
    setTimeout(() => { handleSend(); }, 0);
  }, [handleSend]);

  const bubbleList = useMemo(
    () => messages.map((m) => <MessageBubble key={m.id} msg={m} onRetry={handleRetry} />),
    [messages, handleRetry],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 60 : 0}
    >
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

      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.inputWrap}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Share what feels true…`}
            placeholderTextColor={colors.creamFaint}
            style={styles.input}
            multiline
            editable={!sending}
            selectionColor={colors.amber}
            onSubmitEditing={handleSend}
          />
        </View>
        <Pressable
          onPress={handleSend}
          disabled={!text.trim() || sending}
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDim]}
          accessibilityLabel="Send"
        >
          <Ionicons name="arrow-up" size={20} color={colors.background} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.md, paddingBottom: spacing.lg },
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
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: 14,
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  inputWrap: { flex: 1 },
  input: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.2)',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDim: { opacity: 0.4 },
});
