// Support resources — the standalone route for the "I'm in a hard place
// right now" experience-level option.
//
// WHY THIS ROUTE EXISTS: that option's subtitle promises "(We'll suggest
// some real-person resources too.)". Onboarding honoured it via an internal
// phase; Settings did not — it stored the level and closed the sheet, so a
// user reaching for support from Settings got silence. The resources UI was
// trapped inside onboarding with no route to it, so it was extracted to
// components/safety/SupportResourcesScreen and this route renders that same
// component. Both surfaces show one screen, from one source.
//
// A back chevron AND a bottom CTA both return to Settings: a dead end on a
// support-seeking path would be worse than the silence this fixes.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../constants/theme';
import { SupportResourcesScreen } from '../components/safety/SupportResourcesScreen';

export default function SupportResourcesRoute() {
  const router = useRouter();

  // WHERE THIS SCREEN WAS OPENED FROM. Settings is the original caller and stays
  // the default; ?from=door is the membership door (app/paywall.tsx in door
  // mode). Nothing about the resources changes — the numbers, the copy and the
  // layout are the same screen. What changes is what the exit is CALLED: a
  // person who tapped "If you need support right now" on a paywall must not have
  // "Back to settings" read out to them on a screen they have never been near,
  // and a cold deep link must not drop them into Settings instead.
  const params = useLocalSearchParams<{ from?: string | string[] }>();
  const rawFrom = Array.isArray(params.from) ? params.from[0] : params.from;
  const fromDoor = rawFrom === 'door';
  const backLabel = fromDoor ? 'Back' : 'Back to settings';
  const continueLabel = fromDoor ? 'BACK' : 'BACK TO SETTINGS';
  // The fallback loses the `then` destination, which is correct: it is only
  // reached on a cold deep link, where there was no onboarding exit to return
  // to, and the door's own allow-list defaults an absent `then` to '/'.
  const fallbackRoute = fromDoor ? '/paywall?door=1' : '/settings';

  // canGoBack() guard: this route is normally pushed from Settings or from the
  // membership door, but a cold deep link would leave nothing to pop — fall
  // back explicitly so the exit never no-ops.
  function goBack() {
    Haptics.selectionAsync().catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace(fallbackRoute as any);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityLabel={backLabel}
        >
          <Ionicons name="chevron-back" size={22} color={colors.creamDim} />
        </Pressable>
        <Text style={styles.title}>Support</Text>
        <View style={styles.backBtn} />
      </View>

      <SupportResourcesScreen onContinue={goBack} continueLabel={continueLabel} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    letterSpacing: 0.4,
  },
});
