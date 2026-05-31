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
  Modal, TextInput, Alert, Keyboard,
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
//
// CRITICAL BUILD-TIME REQUIREMENT (build-13 Android-Google fix):
// `webClientId` is the gating value for Android. Without it, the
// native Google SDK CAN run signIn() (the system picker opens, the
// user picks an account, the call returns) — but the result has
// NO idToken, just a profile blob. The downstream `if (!idToken)`
// branch in handleGoogle reports "Google didn't return a sign-in
// token. Try again." → user is stuck.
//
// The webClientId must be the WEB OAuth client ID from Google Cloud
// Console (NOT the Android client ID). The Android client (with the
// signing-cert SHA-1) still has to exist in GCC for Google to verify
// the app, but it's referenced implicitly via the package + cert
// fingerprint at sign-in time — it's not passed in code.
//
// Sourced from extras.googleClientIds.web, which app.config.js reads
// from EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID at BUILD TIME. For EAS
// production builds the env var must be set via eas.json's
// build.production.env (referencing an EAS secret) — see eas.json
// + scripts/check-production-build.js. Local Expo Go dev reads it
// from .env at the project root.
//
// Diagnostic log below is structured so a future failure of this
// class triages in seconds: search adb logcat for [auth-google-config]
// and the masked client-id lengths immediately reveal whether the
// build was missing the env vars.
let googleConfigured = false;
function ensureGoogleConfigured() {
  if (googleConfigured) return;
  const extras = (Constants.expoConfig?.extra as any) || {};
  const ids = extras.googleClientIds || {};
  // Mask IDs in logs — they're not strictly secret (they ship in
  // client bundles by design) but no reason to dump them in full
  // when length + first 8 chars is enough to triage.
  const mask = (v: string) =>
    v && typeof v === 'string'
      ? `${v.slice(0, 8)}…(len=${v.length})`
      : '(MISSING)';
  console.log(
    `[auth-google-config] platform=${Platform.OS} ` +
    `webClientId=${mask(ids.web)} ` +
    `iosClientId=${mask(ids.ios)} ` +
    `androidClientId=${mask(ids.android)}`,
  );
  // Hard early-warn when the gating value is missing on the
  // platform that needs it. On Android this is the show-stopper;
  // on iOS the SDK still works because expo-apple-authentication
  // is the primary path. Console.error so the log line gets a
  // higher severity tag in adb logcat (easier to spot).
  if (Platform.OS === 'android' && !ids.web) {
    console.error(
      '[auth-google-config] webClientId is MISSING on Android — ' +
      'native Google Sign-In will fail with "no idToken returned". ' +
      'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in eas.json build.production.env ' +
      '(via an EAS secret) and rebuild.',
    );
  }
  try {
    GoogleSignin.configure({
      // webClientId — the Web OAuth client ID from Google Cloud
      // Console. On Android this is what makes the SDK return an
      // idToken (the token's `aud` claim is set to this value).
      // Matches lib/auth/google.js's allowedAudiences list on the
      // server (GOOGLE_OAUTH_CLIENT_ID_WEB).
      webClientId: ids.web || undefined,
      iosClientId: ids.ios || undefined,
      // No scopes passed — the default profile+email is what we
      // want; the server verifier only needs sub + email.
    });
    googleConfigured = true;
    console.log('[auth-google-config] GoogleSignin.configure OK');
  } catch (e) {
    console.warn('[auth-google-config] GoogleSignin.configure THREW:', (e as Error)?.message);
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

  // Build 14 — keyboard handling for the centered email modal. The
  // modal previously had NO keyboard handling at all; on Android, the
  // soft keyboard rose over the centered card and covered the email
  // input. Apply paddingBottom: kbHeight on the backdrop so the
  // centered card bumps upward above the keyboard. Same pattern used
  // elsewhere in the app (Partner chat, Shared compose, SharePromptCard).
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

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

  // Build 11 — log every error surfaced to the user so the toast
  // text + its origin is traceable in Metro/device logs. Source tag
  // distinguishes "client-side hard-coded fallback" from "passed up
  // from a server response."
  const reportError = useCallback((msg: string, source: string) => {
    console.warn(`[auth-buttons] reportError source=${source} msg="${msg}"`);
    setStatusMsg(msg);
    if (onError) onError(msg);
  }, [onError]);

  const handleApple = useCallback(async () => {
    if (busy) return;
    console.log('[auth-buttons] handleApple START');
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
      console.log(
        `[auth-buttons] Apple signInAsync returned — idTokenLen=${idToken?.length || 0} ` +
        `authCodeLen=${credential.authorizationCode?.length || 0} ` +
        `user=${credential.user ? credential.user.slice(0, 8) + '…' : '(none)'} ` +
        `email=${credential.email ? credential.email.slice(0, 3) + '…' : '(none)'}`,
      );
      if (!idToken) {
        reportError('Apple didn’t return a sign-in token. Try again.', 'apple-sdk-no-token');
        return;
      }
      const out = await api.authSignIn('apple', idToken);
      if (!out) {
        // api.authSignIn returned null — the server-side log shows
        // exactly which gate failed. Toast wording stays generic.
        reportError('Couldn’t sign in with Apple right now. Try again in a moment.', 'authSignIn-returned-null');
        return;
      }
      console.log(`[auth-buttons] Apple sign-in SUCCESS userId=${out.userId.slice(0, 8)}…`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSuccess({ ...out, provider: 'apple' });
    } catch (e: any) {
      // ERR_CANCELED is the user backing out of the system sheet —
      // not actually an error; silent dismiss.
      if (e?.code === 'ERR_CANCELED' || e?.code === 'ERR_REQUEST_CANCELED') {
        console.log('[auth-buttons] Apple sign-in user-cancelled');
        return;
      }
      console.warn('[auth-buttons] Apple sign-in threw:', e?.code, e?.message);
      if (e?.stack) console.warn(e.stack);
      reportError('Apple sign-in failed. Try again.', 'apple-sdk-threw');
    } finally {
      setBusy(null);
    }
  }, [busy, onSuccess, reportError]);

  const handleGoogle = useCallback(async () => {
    if (busy) return;
    // Re-emit config diagnostics each attempt so we see the actual
    // values present at the moment the SDK call fires (vs only at
    // first mount). Cheap; idempotent.
    ensureGoogleConfigured();
    console.log('[auth-google-native] signIn attempt — platform=' + Platform.OS);
    setBusy('google');
    setStatusMsg(null);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result: any = await GoogleSignin.signIn();
      // SDK shape differs slightly across versions — accept idToken
      // either at the top level (older) or under .data.idToken (v13+).
      const idToken: string | undefined =
        result?.idToken || result?.data?.idToken;
      const userEmail: string | undefined =
        result?.user?.email || result?.data?.user?.email;
      // Surface BOTH the success-shape AND the failure-shape inputs so
      // the next debug pass doesn't need a separate logging round-trip.
      // hasIdToken is the gating value; if false on Android, root cause
      // is almost always webClientId — see [auth-google-config] above.
      const resultKeys = result && typeof result === 'object'
        ? Object.keys(result).slice(0, 10).join(',')
        : '(non-object)';
      const dataKeys = result?.data && typeof result.data === 'object'
        ? Object.keys(result.data).slice(0, 10).join(',')
        : '(no data)';
      console.log(
        `[auth-google-native] signIn result: hasIdToken=${!!idToken} ` +
        `idTokenLen=${idToken?.length || 0} ` +
        `shape=${result?.data ? 'v13+' : 'v12-'} ` +
        `topKeys=[${resultKeys}] dataKeys=[${dataKeys}] ` +
        `email=${userEmail ? userEmail.slice(0, 3) + '…' : '(none)'}`,
      );
      if (!idToken) {
        console.error(
          '[auth-google-native] No idToken returned — almost certainly a ' +
          'webClientId misconfiguration. Check [auth-google-config] log ' +
          'above for the actual client IDs baked into this build.',
        );
        reportError('Google didn’t return a sign-in token. Try again.', 'google-sdk-no-token');
        return;
      }
      const out = await api.authSignIn('google', idToken);
      if (!out) {
        reportError('Couldn’t sign in with Google right now. Try again in a moment.', 'authSignIn-returned-null');
        return;
      }
      console.log(`[auth-buttons] Google sign-in SUCCESS userId=${out.userId.slice(0, 8)}…`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSuccess({ ...out, provider: 'google' });
    } catch (e: any) {
      // Cancel codes vary by SDK / platform; treat all of them as
      // silent dismiss.
      if (
        e?.code === statusCodes.SIGN_IN_CANCELLED ||
        e?.code === 'SIGN_IN_CANCELLED' ||
        e?.code === '-5' /* iOS cancel */
      ) {
        console.log('[auth-buttons] Google sign-in user-cancelled');
        return;
      }
      console.warn('[auth-buttons] Google sign-in threw:', e?.code, e?.message);
      if (e?.stack) console.warn(e.stack);
      reportError('Google sign-in failed. Try again.', 'google-sdk-threw');
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
          style={[styles.modalBackdrop, { paddingBottom: kbHeight }]}
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
