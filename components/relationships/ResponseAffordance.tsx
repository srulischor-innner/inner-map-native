// Response affordance — the row of multiple-choice buttons + Other
// that lives below every AI message in the shared space.
//
// Behavior:
//   - Renders one button per option. The "Other" button (always
//     last, value === 'other') expands into <OtherResponseInput>
//     inline rather than submitting immediately.
//   - On option tap: call api.respondInSharedSpace with optionId.
//   - Once submitted, the parent SharedDialogueView refreshes and
//     this affordance is replaced by the user's selected-option
//     display (handled in SharedMessageCard).

import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';
import { api, SharedMessageOption } from '../../services/api';
import { OtherResponseInput } from './OtherResponseInput';

export function ResponseAffordance({
  relationshipId,
  messageId,
  options,
  onResponded,
}: {
  relationshipId: string;
  messageId: string;
  options: SharedMessageOption[];
  /** Called after a successful submit so the parent can refresh
   *  the shared thread + collapse this affordance. */
  onResponded: () => void;
}) {
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [otherExpanded, setOtherExpanded] = useState(false);

  const pickOption = useCallback(async (option: SharedMessageOption) => {
    if (pendingOptionId) return;
    if (option.value === 'other') {
      Haptics.selectionAsync().catch(() => {});
      setOtherExpanded(true);
      return;
    }
    setPendingOptionId(option.id);
    Haptics.selectionAsync().catch(() => {});
    const result = await api.respondInSharedSpace(relationshipId, messageId, {
      optionId: option.id,
    });
    setPendingOptionId(null);
    if ('error' in result) {
      Alert.alert(
        "Couldn't submit",
        result.message || result.error || 'Try again in a moment.',
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onResponded();
  }, [pendingOptionId, relationshipId, messageId, onResponded]);

  if (otherExpanded) {
    return (
      <OtherResponseInput
        relationshipId={relationshipId}
        messageId={messageId}
        onSubmitted={() => {
          setOtherExpanded(false);
          onResponded();
        }}
        onCancel={() => setOtherExpanded(false)}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      {options.map((opt) => {
        const isOther = opt.value === 'other';
        const isPending = pendingOptionId === opt.id;
        return (
          <Pressable
            key={opt.id}
            onPress={() => pickOption(opt)}
            disabled={!!pendingOptionId}
            style={[
              styles.btn,
              isOther && styles.btnOther,
              isPending && styles.btnDim,
            ]}
            accessibilityLabel={`Select: ${opt.label}`}
          >
            {isPending ? (
              <ActivityIndicator color={colors.amber} size="small" />
            ) : (
              <Text style={[styles.btnText, isOther && styles.btnOtherText]}>
                {opt.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
  },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.4)',
    backgroundColor: 'rgba(230, 180, 122, 0.06)',
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // "Other" gets a subtly different treatment so it reads as the
  // escape hatch — slightly dimmer border, italic text.
  btnOther: {
    borderColor: 'rgba(230, 180, 122, 0.25)',
    backgroundColor: 'transparent',
  },
  btnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  btnOtherText: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  btnDim: { opacity: 0.5 },
});
