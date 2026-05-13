// Privacy policy — in-app screen, accessible from Settings.
//
// Same dark background + serif/title visual language as the rest of
// the app. The copy is intentionally plain — what we collect, what we
// do with it, what we never do, third parties we use, your rights,
// and how to contact us.
//
// The same text is mirrored at the public URL
// https://inner-map-production.up.railway.app/privacy (served by the
// Express app under /privacy) so the App Store / Play Store listings
// have a public link that matches.

import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { colors, fonts, spacing } from '../constants/theme';

const CONTACT_EMAIL = 'privacy@my-inner-map.com';

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
        <Text style={styles.h1}>Privacy Policy for Inner Map</Text>
        <Text style={styles.updated}>Last updated: May 5, 2026</Text>

        <Text style={styles.paragraph}>
          Inner Map respects your privacy. This policy explains how we handle
          your data.
        </Text>

        <Text style={styles.h2}>What we collect</Text>
        <Bullet>Conversation content you share with the AI</Bullet>
        <Bullet>
          Map data derived from your conversations: parts, beliefs, body
          sensations, language patterns
        </Bullet>
        <Bullet>Session history and AI-generated summaries</Bullet>
        <Bullet>Account identifiers</Bullet>

        <Text style={styles.h2}>How we use it</Text>
        <Bullet>
          To provide the personalized mapping and reflection experience the
          app delivers
        </Bullet>
        <Bullet>
          To improve the AI's understanding of your inner system across
          sessions
        </Bullet>
        <Bullet>
          To generate personalized audio messages and session summaries
        </Bullet>

        <Text style={styles.h2}>What we don't do</Text>
        <Bullet>We do not sell your data</Bullet>
        <Bullet>We do not share your data with advertisers</Bullet>
        <Bullet>
          We do not use your conversations to train external AI models without
          your explicit consent
        </Bullet>

        <Text style={styles.h2}>Third parties we use</Text>
        <Bullet>OpenAI: for audio transcription and text-to-speech</Bullet>
        <Bullet>Anthropic: for AI conversation</Bullet>
        <Text style={styles.paragraph}>
          Both have their own privacy policies that govern their handling of
          data passed to them.
        </Text>

        <Text style={styles.h2}>Your rights</Text>
        <Text style={styles.paragraph}>
          You can request deletion of all your data at any time by contacting
          us.
        </Text>

        <Text style={styles.h2}>Important note</Text>
        <Text style={styles.paragraph}>
          Inner Map is not a medical or therapeutic service. It is a
          self-reflection companion. If you are in crisis, please contact 988
          (Suicide and Crisis Lifeline) or your local emergency services.
        </Text>

        <Text style={styles.contactLine}>
          Contact:{' '}
          <Text
            style={styles.contactLink}
            onPress={() =>
              Linking.openURL(
                `mailto:${CONTACT_EMAIL}?subject=Inner%20Map%20privacy`,
              ).catch(() => {})
            }
          >
            {CONTACT_EMAIL}
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
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
  h1: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 24,
    letterSpacing: 0.3,
    marginBottom: spacing.xs,
  },
  h2: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  paragraph: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
    paddingLeft: spacing.xs,
  },
  bulletDot: {
    color: colors.amber,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
    width: 14,
  },
  bulletText: {
    flex: 1,
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
  },
  contactLine: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
    marginTop: spacing.lg,
  },
  contactLink: {
    color: colors.amber,
    textDecorationLine: 'underline',
  },
  updated: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    marginBottom: spacing.lg,
  },
});
