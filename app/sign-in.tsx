// Sign-In Screen — Build 11 first-launch entry.
//
// Routed to from app/_layout.tsx when:
//   - signInChoiceMade flag is false (no prior choice on this device)
//   - hasSeenIntro is false (genuine fresh install, not a Build-10
//     tester upgrading mid-onboarding)
//
// Three sign-in options + a small "Use anonymously instead" link.
// Either path sets signInChoiceMade=true and routes to /onboarding,
// where the existing welcome → privacy → terms → intake flow runs.

import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors, fonts, spacing } from '../constants/theme';
import { AuthButtonRow, AuthSignInResult } from '../components/auth/AuthButtonRow';
import { markSignInChoiceMade } from '../services/onboarding';
// Canonical, legally-binding documents (hosted). The acceptance footer below
// links to the full live versions via the shared helper.
import {
  PRIVACY_POLICY_URL as PRIVACY_URL,
  TERMS_OF_SERVICE_URL as TERMS_URL,
  openLegalDoc,
} from '../utils/legalDocs';

export default function SignInScreen() {
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);

  const proceedToOnboarding = useCallback(async () => {
    if (advancing) return;
    setAdvancing(true);
    try {
      await markSignInChoiceMade();
    } finally {
      router.replace('/onboarding');
    }
  }, [advancing, router]);

  const handleSuccess = useCallback(async (result: AuthSignInResult) => {
    console.log(
      `[sign-in] success — userId=${result.userId.slice(0, 8)} ` +
      `isNew=${result.isNewUser} migrated=${result.migrated} provider=${result.provider}`,
    );
    await proceedToOnboarding();
  }, [proceedToOnboarding]);

  const handleAnonymous = useCallback(() => {
    Alert.alert(
      'Continue without saving?',
      'If you continue anonymously, your map, journal, and history will only exist on this device. ' +
      'If you lose your phone, switch devices, or delete the app, everything will be permanently lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue anonymously', style: 'destructive',
          onPress: proceedToOnboarding,
        },
      ],
      { cancelable: true },
    );
  }, [proceedToOnboarding]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Inner Map</Text>
          <Text style={styles.subtitle}>
            Understand what's happening inside you.
          </Text>
        </View>

        <View style={styles.buttonsWrap}>
          <AuthButtonRow onSuccess={handleSuccess} />
          <Pressable
            onPress={handleAnonymous}
            disabled={advancing}
            hitSlop={10}
            style={styles.anonymousLinkBtn}
            accessibilityLabel="Use anonymously instead"
          >
            <Text style={styles.anonymousLinkText}>Use anonymously instead</Text>
          </Pressable>

          <Text style={styles.acceptanceText}>
            By continuing, you agree to our{' '}
            <Text style={styles.acceptanceLink} onPress={() => openLegalDoc(TERMS_URL)}>
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text style={styles.acceptanceLink} onPress={() => openLegalDoc(PRIVACY_URL)}>
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1, justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.xl,
  },
  header: { alignItems: 'center', marginTop: spacing.xxl },
  title: {
    color: colors.amber, fontFamily: fonts.serifBold,
    fontSize: 38, letterSpacing: 0.3, marginBottom: spacing.md,
  },
  subtitle: {
    color: colors.cream, fontFamily: fonts.serifItalic,
    fontSize: 17, lineHeight: 26, textAlign: 'center', opacity: 0.85,
    paddingHorizontal: spacing.md,
  },
  buttonsWrap: { width: '100%', alignItems: 'center', marginBottom: spacing.xl },
  anonymousLinkBtn: { marginTop: spacing.lg, padding: spacing.sm },
  anonymousLinkText: {
    color: colors.creamFaint, fontFamily: fonts.sans, fontSize: 13,
    letterSpacing: 0.3, textDecorationLine: 'underline', opacity: 0.7,
  },
  acceptanceText: {
    color: colors.creamFaint, fontFamily: fonts.sans, fontSize: 12,
    lineHeight: 18, textAlign: 'center', marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  acceptanceLink: {
    color: colors.amber, fontFamily: fonts.sansBold,
    textDecorationLine: 'underline',
  },
});
