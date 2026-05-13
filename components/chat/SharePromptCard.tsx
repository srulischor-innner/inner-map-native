// "Share with your partner" card — rendered inline in
// relationship-mode private chat bubbles when the AI emits a
// [SHARE_SUGGEST: <one-line summary>] marker.
//
// PR C replaces the old proposal-voting workflow. The new flow:
//
//   1. AI in the private chat notices something significant the
//      partner just said about themselves.
//   2. AI emits a SHARE_SUGGEST marker pre-filled with a one-line
//      first-person summary of what would land well in the shared
//      space.
//   3. SharePromptCard renders the suggestion as a tappable card.
//   4. Tap → confirmation modal with the suggestion as an editable
//      pre-filled input. User refines if they want, then confirms.
//   5. Server inserts a shared_messages row of kind=
//      'partner_contribution' and fires an AI tick in the shared
//      space. The shared-space AI may respond with its own message.
//
// After successful share: the card collapses into a small confirmed
// pill ("Shared with [partner]") and is no longer interactive.
// Local state — the share status doesn't survive a chat-tab unmount,
// but the contribution itself is persisted server-side. Re-opening
// the chat shows the original [SHARE_SUGGEST:…] marker again; the
// user can decide to share a second time, edit the wording, or
// ignore — each share is its own opt-in act.

import React, { useCallback, useState } from 'react';
import {
  Pressable, Text, View, StyleSheet, Modal,
  TextInput, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';

const MAX_SHARE_CHARS = 500;

export function SharePromptCard({
  suggestion,
  relationshipId,
  partnerName,
}: {
  /** The one-line suggestion the AI emitted. Pre-fills the modal. */
  suggestion: string;
  /** Relationship id — passed through to api.contributeToSharedSpace
   *  when the user confirms the share. */
  relationshipId: string;
  /** Optional partner first name for the button label
   *  ("Share with Yisroel") + the confirmation modal copy. Falls
   *  back to "your partner" when absent. */
  partnerName: string | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(suggestion);
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const openModal = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    // Reset draft to the current marker text each open — the modal
    // is opt-in editable and we don't want a stale edit from a
    // dismissed prior open.
    setDraft(suggestion);
    setModalOpen(true);
  }, [suggestion]);

  const closeModal = useCallback(() => {
    if (sending) return;
    setModalOpen(false);
  }, [sending]);

  const confirmShare = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      Alert.alert('Nothing to share', 'Please add some content before sharing.');
      return;
    }
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
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
    setModalOpen(false);
    setConfirmed(true);
  }, [draft, relationshipId]);

  if (confirmed) {
    // Post-share pill — small confirmation, no longer tappable.
    return (
      <View style={[styles.wrap, styles.confirmedWrap]}>
        <View style={styles.confirmedPill}>
          <Ionicons name="checkmark-circle" size={14} color={colors.amber} style={styles.confirmedIcon} />
          <Text style={styles.confirmedText}>
            Shared with {partnerName || 'your partner'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={openModal}
        accessibilityLabel={`Share with ${partnerName || 'your partner'}: ${suggestion}. Tap to confirm and edit`}
        style={styles.card}
      >
        <View style={styles.cardHeader}>
          <Ionicons name="paper-plane-outline" size={14} color={colors.amber} style={styles.cardIcon} />
          <Text style={styles.cardHeaderText} numberOfLines={1}>
            Share with {partnerName || 'your partner'}
          </Text>
        </View>
        <Text style={styles.cardBody} numberOfLines={3}>
          “{suggestion}”
        </Text>
        <View style={styles.cardCta}>
          <Text style={styles.cardCtaText}>Tap to edit + share</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.amber} />
        </View>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                Share with {partnerName || 'your partner'}
              </Text>
              <Text style={styles.modalLede}>
                Your partner will see this in the shared space. Edit it
                to feel like your own words — the AI's suggestion is
                just a starting point.
              </Text>
              <TextInput
                value={draft}
                onChangeText={(s) => setDraft(s.slice(0, MAX_SHARE_CHARS))}
                multiline
                editable={!sending}
                placeholder="What you want to share…"
                placeholderTextColor={colors.creamFaint}
                style={styles.modalInput}
                selectionColor={colors.amber}
                autoFocus
              />
              <Text style={styles.modalCount}>
                {draft.length} / {MAX_SHARE_CHARS}
              </Text>
              <View style={styles.modalActions}>
                <Pressable
                  onPress={closeModal}
                  disabled={sending}
                  style={[styles.modalBtn, styles.modalBtnGhost]}
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles.modalBtnGhostText}>CANCEL</Text>
                </Pressable>
                <Pressable
                  onPress={confirmShare}
                  disabled={sending || !draft.trim()}
                  style={[
                    styles.modalBtn, styles.modalBtnPrimary,
                    (!draft.trim() || sending) && styles.modalBtnDim,
                  ]}
                  accessibilityLabel="Share"
                >
                  {sending ? (
                    <ActivityIndicator color={colors.background} />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>SHARE</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', marginVertical: 8 },
  confirmedWrap: { alignSelf: 'flex-start' },

  // Pre-share card — amber-tinted, larger than the in-confirmation pill,
  // tappable.
  card: {
    backgroundColor: 'rgba(230, 180, 122, 0.07)',
    borderColor: 'rgba(230, 180, 122, 0.4)',
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardIcon: { marginRight: 8 },
  cardHeaderText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardBody: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  cardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  cardCtaText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.5,
  },

  // Post-share confirmation pill.
  confirmedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(230, 180, 122, 0.06)',
    borderColor: 'rgba(230, 180, 122, 0.35)',
    borderWidth: 0.5,
    borderRadius: 14,
  },
  confirmedIcon: { marginRight: 6 },
  confirmedText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.3,
  },

  // Modal — confirmation + editable input.
  modalRoot: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.backgroundCard,
    borderColor: 'rgba(230, 180, 122, 0.3)',
    borderWidth: 0.5,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 20,
    letterSpacing: 0.3,
    marginBottom: spacing.sm,
  },
  modalLede: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  modalInput: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 110,
    maxHeight: 220,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.2)',
    textAlignVertical: 'top',
  },
  modalCount: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
    textAlign: 'right',
    marginTop: 6,
    marginBottom: spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  modalBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: 999,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: {
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.4)',
  },
  modalBtnGhostText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1,
  },
  modalBtnPrimary: {
    backgroundColor: colors.amber,
  },
  modalBtnPrimaryText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1,
  },
  modalBtnDim: { opacity: 0.5 },
});
