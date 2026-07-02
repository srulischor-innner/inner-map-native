// Privacy policy — in-app screen, accessible from Settings.
//
// Same dark background + serif/title visual language as the rest of
// the app. The copy is intentionally plain — what we collect, what we
// do with it, what we never do, third parties we use, your rights,
// and how to contact us.
//
// CONSOLIDATION (Option A): this screen is an explicitly NON-binding,
// plain-language summary. The full, legally-binding Privacy Policy lives at
// my-inner-map.com/privacy-policy.html (canonical, authored in the
// inner-map-legal repo). A banner at the top and a repeated link at the
// bottom make the live document the authoritative source; this screen exists
// only so users get a quick, offline-readable overview. We no longer mirror
// the full policy text here — that prevented the three-copy drift we kept
// having to reconcile.

import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { colors, fonts, spacing } from '../constants/theme';
import {
  PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, openLegalDoc,
} from '../utils/legalDocs';

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
        <Text style={styles.h1}>Privacy at a glance</Text>
        <Text style={styles.updated}>Reflects the policy last updated: July 1, 2026</Text>

        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>This is a summary.</Text>
          <Text style={styles.bannerBody}>
            The full Privacy Policy is the legally-binding version. This screen
            is a plain-language overview to help you understand it quickly — it
            doesn't replace the document itself.
          </Text>
          <Pressable
            style={styles.docLinkBtn}
            onPress={() => openLegalDoc(PRIVACY_POLICY_URL)}
            accessibilityLabel="Read the full Privacy Policy"
          >
            <Text style={styles.docLinkText}>Read the full Privacy Policy ↗</Text>
          </Pressable>
          <Pressable
            style={styles.docLinkBtn}
            onPress={() => openLegalDoc(TERMS_OF_SERVICE_URL)}
            accessibilityLabel="Read the full Terms of Service"
          >
            <Text style={styles.docLinkText}>Read the full Terms of Service ↗</Text>
          </Pressable>
        </View>

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

        <Text style={styles.h2}>Your journal</Text>
        <Text style={styles.paragraph}>
          You control each entry. Shared entries help the AI understand you
          and are stored on our servers; a shared entry may also be analyzed
          to suggest something for your map, which lands in your inbox for you
          to approve — nothing is added automatically. Private entries stay
          encrypted on your device, unreadable to us.
        </Text>

        <Text style={styles.h2}>What we don't do</Text>
        <Bullet>We do not sell your data</Bullet>
        <Bullet>We do not share your data with advertisers</Bullet>
        <Bullet>We do not train any Inner Map AI model on your conversations</Bullet>
        <Bullet>
          We do not provide your conversations to any third party for model
          training
        </Bullet>

        <Text style={styles.h2}>Third parties we use</Text>
        <Bullet>OpenAI: for audio transcription and text-to-speech</Bullet>
        <Bullet>Anthropic: for AI conversation</Bullet>
        <Text style={styles.paragraph}>
          Our AI providers (Anthropic, OpenAI) process your messages to
          generate responses and do not retain or train on them, per our API
          agreements. Both also have their own privacy policies that govern
          their handling of data passed to them.
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

        <View style={styles.endNote}>
          <Text style={styles.endNoteText}>
            This page is a summary. The Privacy Policy at my-inner-map.com is
            the authoritative, legally-binding document — read it for the full
            detail on data use, retention, your rights, and third parties.
          </Text>
          <Pressable
            style={styles.docLinkBtn}
            onPress={() => openLegalDoc(PRIVACY_POLICY_URL)}
            accessibilityLabel="Read the full Privacy Policy"
          >
            <Text style={styles.docLinkText}>Read the full Privacy Policy ↗</Text>
          </Pressable>
          <Pressable
            style={styles.docLinkBtn}
            onPress={() => openLegalDoc(TERMS_OF_SERVICE_URL)}
            accessibilityLabel="Read the full Terms of Service"
          >
            <Text style={styles.docLinkText}>Read the full Terms of Service ↗</Text>
          </Pressable>
        </View>

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
  banner: {
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.45)',
    backgroundColor: 'rgba(230,180,122,0.07)',
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  bannerTitle: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 15,
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  bannerBody: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  endNote: {
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
  },
  endNoteText: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  docLinkBtn: {
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.4)',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  docLinkText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 0.3,
  },
  updated: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    marginBottom: spacing.lg,
  },
});
