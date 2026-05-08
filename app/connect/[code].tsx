// Deep-link landing route — handles BOTH:
//   • Universal Link / App Link  → https://inner-map-production.up.railway.app/connect/<CODE>
//   • Custom-scheme              → innermap://connect/<CODE>
//
// File-based routing maps `app/connect/[code].tsx` to both URL shapes
// because expo-router registers the route under the bundle's scheme and
// (when associatedDomains / intentFilters are set in app.json) the OS
// hands off matching https links to the same route.
//
// Behavior:
//   1. If onboarding isn't complete, route the user to /onboarding
//      and remember the code locally so we can resume the accept call
//      after the user lands in the app proper. (Phase 4 wires this
//      resume; for now we surface an "after you finish setup, paste
//      the code" message so we don't lose the invite quietly.)
//   2. If onboarding IS complete, call /api/relationships/accept with
//      the code and route to /(tabs)/ on success. The full Relationships
//      tab is Phase 4 — this screen just confirms the bind landed.
//   3. On any server-side rejection, surface a clear message with the
//      reason and a button back to the main app.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { getOnboardingState } from '../../services/onboarding';

// Stash the code under a known key so a returning user — one who tapped
// the link before completing onboarding — can have the accept call
// retried automatically when Phase 4's Relationships tab boots. The key
// is read by /(tabs)/_layout.tsx (or wherever resume hooks live) AFTER
// onboarding completes; on success that consumer clears the key.
export const PENDING_INVITE_CODE_KEY = 'relationships.pendingInviteCode';

type Status =
  | 'resolving'      // reading onboarding state + matching code
  | 'needs-onboarding'
  | 'accepting'      // posting to /api/relationships/accept
  | 'accepted'
  | 'error';

export default function ConnectByCode() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  // expo-router can deliver dynamic segments as string OR string[] when
  // the URL parses oddly. Normalize + uppercase to match the server's
  // canonical form.
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = String(rawCode || '').trim().toUpperCase();

  const [status, setStatus] = useState<Status>('resolving');
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Defensive: a missing/empty code can't be acted on. Fall back to
      // an error rather than a confusing onboarding redirect.
      if (!code) {
        if (!cancelled) {
          setErrorReason('missing-code');
          setStatus('error');
        }
        return;
      }

      console.log(`[connect] route opened — code=${code}`);

      // Stash the code BEFORE branching so any subsequent reload, app
      // backgrounding, or onboarding redirect doesn't lose it. The
      // accept-on-resume consumer clears the key when the bind lands.
      try { await AsyncStorage.setItem(PENDING_INVITE_CODE_KEY, code); } catch {}

      const ob = await getOnboardingState().catch(() => ({
        hasSeenIntro: false, termsAccepted: false, intakeComplete: false,
      }));
      const onboarded = ob.hasSeenIntro && ob.termsAccepted && ob.intakeComplete;
      if (!onboarded) {
        if (cancelled) return;
        console.log('[connect] not onboarded yet — staging code, redirecting to /onboarding');
        setStatus('needs-onboarding');
        // Brief hold so the user reads the message, then redirect.
        // Phase 4 will resume the accept after onboarding finishes.
        setTimeout(() => {
          if (!cancelled) router.replace('/onboarding');
        }, 1800);
        return;
      }

      // User is fully onboarded — call /api/relationships/accept now.
      if (!cancelled) setStatus('accepting');
      const result = await api.acceptRelationshipInvite(code);
      if (cancelled) return;
      if ('error' in result) {
        console.warn(`[connect] accept failed: ${result.error} ${result.message || ''}`);
        setErrorReason(result.error);
        setStatus('error');
        // Don't clear the pending code on error — Phase 4's
        // Relationships tab can offer a manual retry.
        return;
      }
      console.log(`[connect] accepted — relationshipId=${result.relationshipId} partner=${result.partnerName || '(unnamed)'}`);
      setPartnerName(result.partnerName);
      setStatus('accepted');
      // Bind landed — clear the staged code.
      try { await AsyncStorage.removeItem(PENDING_INVITE_CODE_KEY); } catch {}
      // Hold on the success state for a moment so the user sees the
      // confirmation, then route to the main app. Phase 4 will route
      // directly to the Relationships tab; for now we land on chat.
      setTimeout(() => {
        if (!cancelled) router.replace('/');
      }, 2200);
    })();
    return () => { cancelled = true; };
  }, [code, router]);

  // Map every server-side rejection to a clear user-facing message. The
  // invite codes themselves are never exposed in error copy.
  function errorBody(): string {
    switch (errorReason) {
      case 'missing-code':
        return "This invite link is incomplete. Ask your partner to send it again.";
      case 'invite-not-found':
        return "We couldn't find this invite. It may have been cancelled — ask your partner to share a new link.";
      case 'invite-already-used':
        return "This invite has already been used.";
      case 'invite-already-claimed':
        return "Someone has already accepted this invite.";
      case 'cannot-accept-own-invite':
        return "This is your own invite link. Share it with your partner instead.";
      case 'already-in-relationship':
        return "You already have an active relationship in Inner Map. Only one is supported in this version.";
      case 'transport-failed':
        return "Couldn't reach the server. Check your connection and try again.";
      default:
        return "Something went wrong with this invite. Try again, or ask your partner to share a fresh link.";
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.center}>
        {status === 'resolving' || status === 'accepting' ? (
          <>
            <ActivityIndicator size="large" color={colors.amber} />
            <Text style={styles.title}>
              {status === 'resolving' ? 'Opening invite…' : 'Connecting…'}
            </Text>
            <Text style={styles.code}>{code || '—'}</Text>
          </>
        ) : null}

        {status === 'needs-onboarding' ? (
          <>
            <Text style={styles.title}>Welcome</Text>
            <Text style={styles.body}>
              Let's get you set up first. We'll keep your invite code ready
              and pair you with your partner once you've finished.
            </Text>
            <Text style={styles.codeDim}>Code: {code}</Text>
          </>
        ) : null}

        {status === 'accepted' ? (
          <>
            <Text style={styles.title}>You're connected</Text>
            <Text style={styles.body}>
              {partnerName
                ? `You and ${partnerName} are paired. Both of you will need to read a short intro before the shared space opens.`
                : 'You and your partner are paired. Both of you will need to read a short intro before the shared space opens.'}
            </Text>
          </>
        ) : null}

        {status === 'error' ? (
          <>
            <Text style={styles.title}>Hmm, that didn't work</Text>
            <Text style={styles.body}>{errorBody()}</Text>
            <Pressable
              onPress={() => router.replace('/')}
              style={styles.btn}
              accessibilityLabel="Continue to Inner Map"
            >
              <Text style={styles.btnText}>Continue to Inner Map</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  title: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 26,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
    marginBottom: spacing.lg,
  },
  code: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 18,
    letterSpacing: 4,
    marginTop: spacing.sm,
  },
  codeDim: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 2,
    marginTop: spacing.sm,
  },
  btn: {
    backgroundColor: colors.amber,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: 28,
  },
  btnText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
