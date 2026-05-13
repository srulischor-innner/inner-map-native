// "Share something with your partner" input — sits at the bottom of
// the shared space. Lets a user post a contribution manually,
// independent of any AI nudge in the private chat.
//
// Collapsed: a single button "Share something with [partner]".
// Expanded: multi-line input + Share + Cancel.

import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';

const CONTRIB_MAX_CHARS = 500;

export function PartnerContributionInput({
  relationshipId,
  partnerName,
  onContributed,
}: {
  relationshipId: string;
  partnerName: string | null;
  /** Fires after a successful share so the parent can refresh the
   *  thread. */
  onContributed: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const cancel = useCallback(() => {
    if (sending) return;
    setExpanded(false);
    setText('');
  }, [sending]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    Haptics.selectionAsync().catch(() => {});
    const result = await api.contributeToSharedSpace(relationshipId, trimmed);
    setSending(false);
    if ('error' in result) {
      Alert.alert(
        "Couldn't share",
        result.message || result.error || 'Try again in a moment.',
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setExpanded(false);
    setText('');
    onContributed();
  }, [text, sending, relationshipId, onContributed]);

  if (!expanded) {
    return (
      <View style={styles.collapsed}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setExpanded(true);
          }}
          style={styles.collapsedBtn}
          accessibilityLabel={`Share something with ${partnerName || 'your partner'}`}
        >
          <Ionicons name="add-circle-outline" size={16} color={colors.amber} style={styles.collapsedIcon} />
          <Text style={styles.collapsedText}>
            Share something with {partnerName || 'your partner'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.expandedWrap}
    >
      <View style={styles.expanded}>
        <TextInput
          value={text}
          onChangeText={(s) => setText(s.slice(0, CONTRIB_MAX_CHARS))}
          editable={!sending}
          multiline
          placeholder="What do you want to share with your partner?"
          placeholderTextColor={colors.creamFaint}
          selectionColor={colors.amber}
          style={styles.input}
          autoFocus
        />
        <View style={styles.row}>
          <Text style={styles.count}>
            {text.length} / {CONTRIB_MAX_CHARS}
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={cancel}
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
              accessibilityLabel="Share"
            >
              {sending ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text style={styles.btnPrimaryText}>SHARE</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  collapsedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 0.75,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.04)',
    alignSelf: 'center',
  },
  collapsedIcon: { marginRight: 8 },
  collapsedText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.3,
  },

  expandedWrap: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: colors.background,
  },
  expanded: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  input: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 90,
    maxHeight: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(230, 180, 122, 0.25)',
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  count: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 999,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
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
  btnPrimary: { backgroundColor: colors.amber },
  btnPrimaryText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  btnDim: { opacity: 0.5 },
});
