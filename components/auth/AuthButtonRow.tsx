// Apple / Google / Email button row — shared by the new SignInScreen
// (onboarding entry for Build-11 fresh installs) and the migration
// modal (overlaid on existing Build-10 testers' first launch of B11).
//
// Each button drives the same flow:
//   1. Talk to the native provider SDK (or open the email modal).
//   2. Get back a credential (Apple identityToken / Google idToken /
//      a magic-link token forwarded by the deep-link handler).
//   3. POST to /api/auth/sign-in via api.authSignIn().
//   4. On success, the api method has already setUserId() — the
//      caller's onSuccess callback fires next.
//   5. On failure, onError fires with a string the caller can
//      surface to the user (or just toast generically).
//
// The component intentionally has no opinion about what happens
// after success — the parent decides whether to route to /onboarding,
// dismiss a modal, refresh settings, etc.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Platform,
  Modal, TextInput, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  GoogleSignin, statusCodes,
} from '@react-native-google-signin/google-signin';

import { colors, fonts, spacing, radii } from '../../constants/theme';
import { api } from '../../services/api';

// One-shot Google config — runs the first time any AuthButtonRow
// mounts. Configure is idempotent; subsequent calls are no-ops.
let googleConfigured = false;
function ensureGoogleConfigured() {
  if (googleConfigured) return;
  const extras = (Constants.expoConfig?.extra as any) || {};
  const ids = extras.googleClientIds || {};
  try {
    GoogleSignin.configure({
      // serverClientId — the audience the server's idToken verifier
      // expects. When set, the issued idToken's `aud` claim is the
      // web client id (regardless of which platform the user signed
      // in on). Matches lib/auth/google.js's allowedAudiences list.
      webClientId: ids.web || undefined,
      iosClientId: ids.ios || undefined,
      // No need to pass scopes — the default profile+email is what
      // we want; the verifier only needs sub + email.
    });
    googleConfigured = true;
  } catch (e) {
    console.warn('[auth-buttons] GoogleSignin.configure threw:', (e as Error)?.message);
  }
}

export type AuthSignInResult = {
  userId: string;
  isNewUser: boolean;
  migrated: boolean;
  provider: 'apple' | 'google' | 'email';
};

export function AuthButtonRow({
  onSuccess,
  onError,
  compact = false,
}: {
  /** Fires after the server successfully resolves a user_id. The
   *  caller is responsible for any post-sign-in navigation /
   *  state updates. */
  onSuccess: (result: AuthSignInResult) => void;
  /** Optional error sink — string is safe to display to the user.
   *  Defaults to a small in-component status line. */
  onError?: (message: string) => void;
  /** Compact mode trims padding for use inside a modal. Default
   *  layout is for full-screen onboarding. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<null | 'apple' | 'google' | 'email'>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailSentMsg, setEmailSentMsg] = useState<string | null>(null);

  // Apple Sign-In is iOS-only. expo-apple-authentication's
  // isAvailableAsync returns true on iOS 13+ and false elsewhere.
  // We resolve once on mount and gate the button on the result so
  // Android builds don't render the button at all.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => { if (!cancelled) setAppleAvailable(!!ok); })
      .catch(() => { if (!cancelled) setAppleAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  // One-time Google configure — safe to call multiple times.
  useEffect(() => { ensureGoogleConfigured(); }, []);

  const reportError = useCallback((msg: string) => {
    setStatusMsg(msg);
    if (onError) onError(msg);
  }, [onError]);

  const handleApple = useCallback(async () => {
    if (busy) return;
    setBusy('apple');
    setStatusMsg(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const idToken = credential.identityToken;
      if (!idToken) {
        reportError('Apple didn’t return a sign-in token. Try again.');
        return;
      }
      const out = await api.authSignIn('apple', idToken);
      if (!out) {
        reportError('Couldn’t sign in with Apple right now. Try again in a moment.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSuccess({ ...out, provider: 'apple' });
    } catch (e: any) {
      // ERR_CANCELED is the user backing out of the system sheet —
      // not actually an error; silent dismiss.
      if (e?.code === 'ERR_CANCELED' || e?.code === 'ERR_REQUEST_CANCELED') return;
      console.warn('[auth-buttons] apple sign-in threw:', e?.message);
      reportError('Apple sign-in failed. Try again.');
    } finally {
      setBusy(null);
    }
  }, [busy, onSuccess, reportError]);

  const handleGoogle = useCallback(async () => {
    if (busy) return;
    setBusy('google');
    setStatusMsg(null);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result: any = await GoogleSignin.signIn();
      // SDK shape differs slightly across versions — accept idToken
      // either at the top level (older) or under .data.idToken (v13+).
      const idToken: string | undefined =
        result?.idToken || result?.data?.idToken;
      if (!idToken) {
        reportError('Google didn’t return a sign-in token. Try again.');
        return;
      }
      const out = await api.authSignIn('google', idToken);
      if (!out) {
        reportError('Couldn’t sign in with Google right now. Try again in a moment.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSuccess({ ...out, provider: 'google' });
    } catch (e: any) {
      // Cancel codes vary by SDK / platform; treat all of them as
      // silent dismiss.
      if (
        e?.code === statusCodes.SIGN_IN_CANCELLED ||
        e?.code === 'SIGN_IN_CANCELLED' ||
        e?.code === '-5' /* iOS cancel */
      ) return;
      console.warn('[auth-buttons] google sign-in threw:', e?.message, e?.code);
      reportError('Google sign-in failed. Try again.');
    } finally {
      setBusy(null);
    }
  }, [busy, onSuccess, reportError]);

  const handleEmailOpen = useCallback(() => {
    if (busy) return;
    setStatusMsg(null);
    setEmailSentMsg(null);
    setEmailDraft('');
    setEmailModalOpen(true);
  }, [busy]);

  const handleEmailSubmit = useCallback(async () => {
    const trimmed = emailDraft.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailSentMsg('That doesn’t look like a valid email.');
      return;
    }
    setEmailSubmitting(true);
    try {
      const ok = await api.authRequestEmailMagicLink(trimmed);
      // Anti-enumeration — show success copy regardless. (Server
      // also no-ops silently when the email is malformed beyond
      // our client-side check.)
      if (ok) {
        setEmailSentMsg('Check your email for a sign-in link.');
      } else {
        setEmailSentMsg('We couldn’t send the email. Try again in a moment.');
      }
    } finally {
      setEmailSubmitting(false);
    }
  }, [emailDraft]);

  const btnStyle = compact ? styles.btnCompact : styles.btn;

  return (
    <View style={styles.row}>
      {appleAvailable && Platform.OS === 'ios' ? (
        <Pressable
          onPress={handleApple}
          disabled={!!busy}
          style={({ pressed }) => [
            btnStyle, styles.btnApple,
            pressed && { opacity: 0.85 }, busy === 'apple' && { opacity: 0.7 },
          ]}
          accessibilityLabel="Continue with Apple"
        >
          {busy === 'apple' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={18} color="#fff" style={styles.icon} />
              <Text style={styles.btnAppleText}>Continue with Apple</Text>
            </>
          )}
        </Pressable>
      ) : null}
      <Pressable
        onPress={handleGoogle}
        disabled={!!busy}
        style={({ pressed }) => [
          btnStyle, styles.btnGoogle,
          pressed && { opacity: 0.85 }, busy === 'google' && { opacity: 0.7 },
        ]}
        accessibilityLabel="Continue with Google"
      >
        {busy === 'google' ? (
          <ActivityIndicator color="#1f1f1f" />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color="#1f1f1f" style={styles.icon} />
            <Text style={styles.btnGoogleText}>Continue with Google</Text>
          </>
        )}
      </Pressable>
      <Pressable
        onPress={handleEmailOpen}
        disabled={!!busy}
        style={({ pressed }) => [
          btnStyle, styles.btnEmail,
          pressed && { opacity: 0.85 },
        ]}
        accessibilityLabel="Continue with Email"
      >
        <Ionicons name="mail-outline" size={18} color={colors.cream} style={styles.icon} />
        <Text style={styles.btnEmailText}>Continue with Email</Text>
      </Pressable>
      {statusMsg ? <Text style={styles.statusError}>{statusMsg}</Text> : null}

      {/* Email modal — keeps the entire auth surface inside one
          component; the consumer doesn't need to manage the modal
          state. */}
      <Modal
        visible={emailModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEmailModalOpen(false)}
        statusBarTranslucent
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => { if (!emailSubmitting) setEmailModalOpen(false); }}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Sign in with Email</Text>
            <Text style={styles.modalBody}>
              We’ll send a one-tap sign-in link to this address.
            </Text>
            <TextInput
              value={emailDraft}
              onChangeText={setEmailDraft}
              placeholder="you@example.com"
              placeholderTextColor="rgba(240,237,232,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoFocus
              editable={!emailSubmitting && !emailSentMsg}
              style={styles.modalInput}
            />
            {emailSentMsg ? (
              <Text style={styles.modalConfirm}>{emailSentMsg}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setEmailModalOpen(false)}
                disabled={emailSubmitting}
                style={({ pressed }) => [
                  styles.modalBtn, styles.modalBtnSecondary,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.modalBtnSecondaryText}>
                  {emailSentMsg ? 'Done' : 'Cancel'}
                </Text>
              </Pressable>
              {!emailSentMsg ? (
                <Pressable
                  onPress={handleEmailSubmit}
                  disabled={emailSubmitting || !emailDraft.trim()}
                  style={({ pressed }) => [
                    styles.modalBtn, styles.modalBtnPrimary,
                    pressed && { opacity: 0.85 },
                    (emailSubmitting || !emailDraft.trim()) && { opacity: 0.5 },
                  ]}
                >
                  {emailSubmitting ? (
                    <ActivityIndicator color={colors.background} size="small" />
                  ) : (
                    <Text style={styles.modalBtnPrimaryText}>Send link</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: '100%', alignSelf: 'center', maxWidth: 380 },

  // Default button — full-bleed inside the row. Compact variant tighter.
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    minHeight: 52, paddingHorizontal: 18, marginBottom: 12,
    borderRadius: radii.pill, borderWidth: 1,
  },
  btnCompact: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    minHeight: 44, paddingHorizontal: 16, marginBottom: 10,
    borderRadius: radii.pill, borderWidth: 1,
  },
  icon: { marginRight: 10 },

  // Apple — solid black per Apple HIG.
  btnApple: { backgroundColor: '#000', borderColor: '#000' },
  btnAppleText: { color: '#fff', fontFamily: fonts.sansMedium, fontSize: 15, letterSpacing: 0.2 },

  // Google — white per Google guidance.
  btnGoogle: { backgroundColor: '#fff', borderColor: '#dadce0' },
  btnGoogleText: { color: '#1f1f1f', fontFamily: fonts.sansMedium, fontSize: 15, letterSpacing: 0.2 },

  // Email — outline that matches the dark-mode palette.
  btnEmail: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(230,180,122,0.4)' },
  btnEmailText: { color: colors.cream, fontFamily: fonts.sansMedium, fontSize: 15, letterSpacing: 0.2 },

  statusError: {
    color: '#E05050', fontFamily: fonts.sans, fontSize: 13,
    textAlign: 'center', marginTop: 4, marginBottom: 8,
  },

  // Email modal — centered card, dark-mode palette consistent with
  // the rest of the app's modals.
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  modalCard: {
    width: '100%', maxWidth: 420, backgroundColor: '#0e0e1a',
    borderRadius: 20, padding: spacing.lg,
    borderWidth: 0.5, borderColor: 'rgba(230,180,122,0.25)',
  },
  modalTitle: {
    color: colors.amber, fontFamily: fonts.serifBold,
    fontSize: 20, lineHeight: 26, textAlign: 'center', marginBottom: spacing.sm,
  },
  modalBody: {
    color: colors.cream, fontFamily: fonts.serifItalic, fontSize: 15, lineHeight: 22,
    textAlign: 'center', marginBottom: spacing.md, opacity: 0.85,
  },
  modalInput: {
    color: '#F0EDE8', fontFamily: fonts.sans, fontSize: 16,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: radii.sm, borderWidth: 1,
    borderColor: 'rgba(240,237,232,0.18)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: spacing.md,
  },
  modalConfirm: {
    color: colors.amber, fontFamily: fonts.sansMedium, fontSize: 13,
    textAlign: 'center', marginBottom: spacing.md,
  },
  modalActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 10,
  },
  modalBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, borderWidth: 1,
  },
  modalBtnSecondary: { borderColor: 'rgba(240,237,232,0.2)', backgroundColor: 'rgba(255,255,255,0.02)' },
  modalBtnSecondaryText: { color: colors.creamDim, fontFamily: fonts.sansMedium, fontSize: 13 },
  modalBtnPrimary: { backgroundColor: colors.amber, borderColor: colors.amber },
  modalBtnPrimaryText: { color: colors.background, fontFamily: fonts.sansBold, fontSize: 13, letterSpacing: 0.5 },
});
