// Warm post-account-delete confirmation screen.
//
// Landed here only via router.replace() from /account/delete after the
// server returned status="deleted" and wipeLocalAccountData() ran. There
// is no back button — there's nothing to go back TO; the previous user
// is no longer on the device.
//
// Single CTA: "Begin again" → routes to onboarding. Onboarding's first-
// launch path will mint a fresh UUID via getUserId() (the SecureStore
// + AsyncStorage mirrors are both cleared at this point) and treat the
// user as net-new.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';

export default function AccountDeletedScreen() {
  const router = useRouter();
  function beginAgain() {
    Haptics.selectionAsync().catch(() => {});
    // Replace so the user can't navigate back into the deleted state.
    router.replace('/onboarding' as any);
  }
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <Text style={styles.title}>Your account has been deleted.</Text>
        <Text style={styles.lede}>
          Thank you for the time you spent with Inner Map.
        </Text>
        <Text style={styles.lede}>
          If you'd like to start fresh, you can.
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={beginAgain} style={styles.cta} accessibilityLabel="Begin again">
          <Text style={styles.ctaText}>BEGIN AGAIN</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl * 1.5,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  title: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: 0.3,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  lede: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
    marginBottom: spacing.md,
    maxWidth: 340,
  },
  cta: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: colors.amber,
    minWidth: 240,
    alignItems: 'center',
  },
  ctaText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 1,
  },
});
