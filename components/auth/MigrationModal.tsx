// MigrationModal — soft / aggressive prompt for existing anonymous
// users upgrading to Build 11.
//
// The first launch of B11 on a B10 device opens with hasSeenIntro=true
// (the user already finished the welcome carousel) + signInChoiceMade=false
// (no auth choice was ever recorded). The boot in app/(tabs)/index.tsx
// (or wherever this is mounted) calls /api/auth/identities; if it
// returns an empty array, this modal opens.
//
// Soft variant (≤5 dismissals AND ≤7 days since first seen):
//   - "Remind me later" is enabled
//   - Backdrop tap also dismisses
//
// Aggressive variant (>5 dismissals OR >7 days):
//   - "Remind me later" is replaced by "Continue anonymously and accept
//     I might lose my data" (explicit confirm)
//   - Backdrop tap is disabled
//
// The modal owns the dismissCount bookkeeping; the parent only decides
// whether to show it and gets notified when the user resolves the
// choice (either by signing in or by explicit anonymous opt-out).

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, spacing, radii } from '../../constants/theme';
import { AuthButtonRow, AuthSignInResult } from './AuthButtonRow';
import {
  incrementMigrationDismissCount,
  getMigrationDismissState,
  markSignInChoiceMade,
} from '../../services/onboarding';

const SOFT_LIMIT_DISMISSALS = 5;
const SOFT_LIMIT_DAYS = 7;

export function MigrationModal({
  visible,
  onResolved,
}: {
  visible: boolean;
  /** Fires when the user resolves the choice — either by signing in
   *  (linked=true) or by explicitly opting into anonymous mode
   *  (linked=false). The parent should NOT re-open the modal after
   *  this fires; the choice is sticky for the session via the
   *  signInChoiceMade flag. */
  onResolved: (linked: boolean) => void;
}) {
  const [aggressive, setAggressive] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const { dismissCount, firstSeenAt } = await getMigrationDismissState();
      if (cancelled) return;
      const days =
        firstSeenAt ? (Date.now() - firstSeenAt) / (1000 * 60 * 60 * 24) : 0;
      const isAggressive =
        dismissCount >= SOFT_LIMIT_DISMISSALS || days >= SOFT_LIMIT_DAYS;
      setAggressive(isAggressive);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const handleSuccess = useCallback(async (_result: AuthSignInResult) => {
    await markSignInChoiceMade();
    onResolved(true);
  }, [onResolved]);

  const handleSoftDismiss = useCallback(async () => {
    // Track for the soft→aggressive escalation logic.
    await incrementMigrationDismissCount();
    onResolved(false);
  }, [onResolved]);

  const handleAggressiveContinue = useCallback(() => {
    Alert.alert(
      'Continue anonymously?',
      'Your map, journal, and history will only exist on this device. ' +
      'If you lose your phone, switch devices, or delete the app, everything will be permanently lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue anonymously', style: 'destructive',
          onPress: async () => {
            // Aggressive opt-out: mark the choice permanent so the
            // modal never re-opens. The user can still link an
            // identity later from settings.
            await markSignInChoiceMade();
            onResolved(false);
          },
        },
      ],
      { cancelable: true },
    );
  }, [onResolved]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => { /* prevent back-button dismiss; user must choose */ }}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <Ionicons name="cloud-upload-outline" size={28} color={colors.amber} />
          </View>
          <Text style={styles.title}>Save your map.</Text>
          <Text style={styles.body}>
            You've been using Inner Map anonymously. Add a sign-in option so you
            don't lose your data if you switch devices or lose this phone.
          </Text>

          <View style={styles.buttonsWrap}>
            <AuthButtonRow onSuccess={handleSuccess} compact />
          </View>

          {aggressive ? (
            <Pressable
              onPress={handleAggressiveContinue}
              hitSlop={8}
              style={styles.dismissBtn}
              accessibilityLabel="Continue anonymously and accept I might lose my data"
            >
              <Text style={styles.dismissText}>
                Continue anonymously and accept I might lose my data
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleSoftDismiss}
              hitSlop={8}
              style={styles.dismissBtn}
              accessibilityLabel="Remind me later"
            >
              <Text style={styles.dismissText}>Remind me later</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%', maxWidth: 440, backgroundColor: '#0e0e1a',
    borderRadius: 22, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl,
    borderWidth: 0.5, borderColor: 'rgba(230,180,122,0.3)',
  },
  iconRow: { alignItems: 'center', marginBottom: spacing.sm },
  title: {
    color: colors.amber, fontFamily: fonts.serifBold,
    fontSize: 24, lineHeight: 30, textAlign: 'center', marginBottom: spacing.sm,
  },
  body: {
    color: colors.cream, fontFamily: fonts.serifItalic,
    fontSize: 15, lineHeight: 23, textAlign: 'center',
    marginBottom: spacing.lg, opacity: 0.88,
  },
  buttonsWrap: { width: '100%', alignItems: 'center', marginBottom: spacing.md },
  dismissBtn: { paddingVertical: spacing.sm, alignSelf: 'center' },
  dismissText: {
    color: colors.creamFaint, fontFamily: fonts.sans, fontSize: 12,
    letterSpacing: 0.3, textDecorationLine: 'underline', opacity: 0.75,
    textAlign: 'center',
  },
});

// Hook the migration modal needs from the chat-tab mount so the parent
// can decide whether to show it. Returns:
//   - shouldShow: true when the user is anonymous AND hasn't made an
//     explicit auth choice yet (hasMadeChoice false). Falls back to
//     false on any transport / storage hiccup so the modal never
//     traps a user who's offline.
import { api } from '../../services/api';
import { getOnboardingState } from '../../services/onboarding';
export async function shouldShowMigrationModal(): Promise<boolean> {
  try {
    const state = await getOnboardingState();
    if (state.signInChoiceMade) return false;
    // Only existing Build-10 users (onboarded but no auth choice).
    // Fresh installs go through /sign-in instead — they'd have
    // hasSeenIntro=false at this point.
    if (!state.hasSeenIntro) return false;
    const { identities } = await api.authListIdentities();
    return identities.length === 0;
  } catch (e) {
    console.warn('[migration-modal] shouldShow probe threw:', (e as Error)?.message);
    return false;
  }
}
