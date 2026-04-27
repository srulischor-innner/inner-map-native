// Privacy policy — in-app screen, accessible from Settings.
//
// Same dark background + serif/title visual language as the rest of
// the app. The copy is intentionally plain — what we collect, what we
// do with it, what we never do, and how to contact us. Not a legal
// document; a warm direct explanation.

import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { colors, fonts, spacing } from '../constants/theme';

export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.creamDim} />
        </Pressable>
        <Text style={styles.title}>Privacy Policy</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.paragraph}>
          Inner Map collects and stores your conversation data to build and
          maintain your personal map. This data is stored securely on our
          servers and is never sold or shared with third parties.
        </Text>
        <Text style={styles.paragraph}>
          Your conversations are used only to improve your personal Inner Map
          experience — to help the AI understand your parts, track your
          journey, and give you more accurate reflections over time.
        </Text>
        <Text style={styles.paragraph}>
          You can request deletion of all your data at any time by contacting
          us.
        </Text>
        <Text style={styles.paragraph}>
          Inner Map is not a medical or therapeutic service. It is a
          self-reflection companion. If you are in crisis, please contact 988
          (Suicide and Crisis Lifeline) or your local emergency services.
        </Text>

        <Text style={styles.updated}>Last updated: April 2026</Text>
      </ScrollView>
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

  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  paragraph: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  updated: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
