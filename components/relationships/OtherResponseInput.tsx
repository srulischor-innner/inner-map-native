// Inline expandable input for the "Other" response option on an AI
// message in the shared space. Capped at 280 chars (a tweet's worth)
// to discourage essays and keep the dialogue readable.
//
// Behavior:
//   - User types their custom response.
//   - On Submit: server runs moderation. Toxic text returns a
//     redirect message — we surface that inline, let the user edit
//     and retry. Borderline text persists but is flagged for the
//     AI's next tick.
//   - On Cancel: collapses back to the button row (parent re-renders
//     the response affordance).
//   - The submit is async — show a spinner; disable inputs while
//     in-flight.

import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';

const OTHER_MAX_CHARS = 280;

export function OtherResponseInput({
  relationshipId,
  messageId,
  onSubmitted,
  onCancel,
}: {
  relationshipId: string;
  messageId: string;
  /** Called after a successful submit so the parent can refresh
   *  the shared thread. */
  onSubmitted: () => void;
  /** Called when the user dismisses without submitting. */
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [redirect, setRedirect] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setRedirect(null);
    Haptics.selectionAsync().catch(() => {});
    const result = await api.respondInSharedSpace(relationshipId, messageId, {
      otherText: trimmed,
    });
    setSending(false);
    if ('error' in result) {
      // Toxic-text rejection comes back as error='moderation-rejected'
      // with a redirect string. Show it inline rather than alerting —
      // the user is going to edit the text and retry, and a modal
      // alert would interrupt the flow.
      if (result.error === 'moderation-rejected') {
        setRedirect(result.redirect || 'That response didn\'t land — try rephrasing what you yourself notice or feel.');
        return;
      }
      setRedirect(result.message || `Couldn't submit: ${result.error}`);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onSubmitted();
  }, [text, sending, relationshipId, messageId, onSubmitted]);

  return (
    <View style={styles.wrap}>
      <TextInput
        value={text}
        onChangeText={(s) => {
          setText(s.slice(0, OTHER_MAX_CHARS));
          if (redirect) setRedirect(null);
        }}
        editable={!sending}
        multiline
        placeholder="Add your own response, ask a question, or clarify…"
        placeholderTextColor={colors.creamFaint}
        selectionColor={colors.amber}
        style={styles.input}
        autoFocus
      />
      <View style={styles.row}>
        <Text style={styles.count}>
          {text.length} / {OTHER_MAX_CHARS}
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={onCancel}
            disabled={sending}
            style={[styles.btn, styles.btnGhost]}
            accessibilityLabel="Cancel"
          >
            <Text style={styles.btnGhostText}>CANCEL</Text>
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={sending || !text.trim()}
            style={[styles.btn, styles.btnPrimary, (sending || !text.trim()) && styles.btnDim]}
            accessibilityLabel="Submit response"
          >
            {sending ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.btnPrimaryText}>SUBMIT</Text>
            )}
          </Pressable>
        </View>
      </View>
      {redirect ? (
        <View style={styles.redirect}>
          <Text style={styles.redirectText}>{redirect}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(230, 180, 122, 0.2)',
  },
  input: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 70,
    maxHeight: 160,
    paddingVertical: 6,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  count: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  btnGhost: {
    borderWidth: 0.75,
    borderColor: 'rgba(230, 180, 122, 0.3)',
  },
  btnGhostText: {
    color: colors.creamDim,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  btnPrimary: {
    backgroundColor: colors.amber,
  },
  btnPrimaryText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  btnDim: { opacity: 0.5 },
  redirect: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    backgroundColor: 'rgba(212, 114, 106, 0.08)',
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: 'rgba(212, 114, 106, 0.35)',
  },
  redirectText: {
    color: '#E89890',
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
  },
});
