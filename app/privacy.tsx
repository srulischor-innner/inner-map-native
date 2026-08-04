// Privacy, Data & Safety — in-app screen, reachable from the side menu
// (and deep-linked from Settings' "If you need help now" row).
//
// Same dark background + serif/title visual language as the rest of
// the app. The copy is intentionally plain — what we collect, what we
// do with it, what we never do, third parties we use, your rights,
// and how to contact us.
//
// SCREEN ORDER (founder ruling, 1.2.0):
//   1. IF YOU NEED HELP NOW — the shared CrisisResourcesCard, FIRST.
//      Someone in distress must not scroll past a data-collection table
//      to reach a phone number. This is also the Apple Mental Health &
//      Wellness "discoverable crisis surface" the review looks for.
//   2. PRIVACY AT A GLANCE — the non-binding plain-language summary.
//   3. YOUR DATA — export / delete / device id, moved here from Settings
//      so every data control lives with the privacy text that explains it.
//
// CONSOLIDATION (Option A): section 2 is an explicitly NON-binding,
// plain-language summary. The full, legally-binding Privacy Policy lives at
// my-inner-map.com/privacy-policy.html (canonical, authored in the
// inner-map-legal repo). A banner at the top and a repeated link at the
// bottom make the live document the authoritative source; this screen exists
// only so users get a quick, offline-readable overview. We no longer mirror
// the full policy text here — that prevented the three-copy drift we kept
// having to reconcile.
//
// DEEP LINK: /privacy?focus=crisis scrolls the crisis section into view.
// Without the param the screen renders normally from the top. The crisis
// card being FIRST means a failed or skipped scroll still leaves the user
// looking straight at it — that is the intended failure mode.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';

// expo-file-system v19 ships a new class-based API (Paths/File/Directory).
// The legacy URI-based namespace at 'expo-file-system/legacy' is still
// shipped alongside it; we use that here because (a) the export-share-
// sheet flow only needs to write one short JSON file and (b) the
// imperative writeAsStringAsync API is a closer match to what we want
// than constructing a File instance.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { colors, fonts, radii, spacing } from '../constants/theme';
import {
  PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, openLegalDoc,
} from '../utils/legalDocs';
import { CrisisResourcesCard } from '../components/safety/CrisisResourcesCard';
import { getUserId } from '../services/user';
import { api } from '../services/api';

const CONTACT_EMAIL = 'privacy@my-inner-map.com';

/** Route param value that focuses the crisis section: /privacy?focus=crisis */
const FOCUS_CRISIS = 'crisis';

export default function PrivacyScreen() {
  const router = useRouter();

  // ---- deep link: /privacy?focus=crisis ------------------------------------
  // useLocalSearchParams gives string | string[] | undefined depending on how
  // the route was entered, so normalize before comparing. Anything other than
  // exactly "crisis" is treated as no param at all — a normal top-of-screen
  // render.
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const rawFocus = params?.focus;
  const focus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const wantsCrisis = focus === FOCUS_CRISIS;

  const scrollRef = useRef<ScrollView>(null);
  // Measured top of the crisis block. Today it is the first thing in the
  // ScrollView so this is ~0; measured rather than assumed so the deep link
  // keeps working if anything is ever inserted above it.
  const crisisYRef = useRef(0);

  const scrollToCrisis = useCallback(() => {
    // Best-effort by design. If the ref is not attached yet, or scrollTo
    // throws for any reason, we simply do nothing — the crisis card is the
    // first thing on the screen, so "no scroll" lands the user on it anyway.
    try {
      scrollRef.current?.scrollTo({
        y: Math.max(0, crisisYRef.current - spacing.sm),
        animated: true,
      });
    } catch (e) {
      console.warn('[privacy/focus] scrollTo threw:', (e as Error)?.message);
    }
  }, []);

  // ONCE PER ARRIVAL. The focus callback runs on mount and again on every
  // REfocus, and ?focus=crisis stays in this screen's params for its whole
  // life — so without this latch, coming back from a screen pushed on top
  // (scroll to the bottom, tap DELETE MY ACCOUNT, come back) snapped the user
  // to the top, throwing away a scroll position they chose. Focusing the
  // crisis card is an arrival behaviour, not a focus behaviour.
  const focusHandledRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!wantsCrisis) {
        // No param — nothing to do, and re-arm so a later arrival WITH the
        // param is still honoured.
        focusHandledRef.current = false;
        return;
      }
      // Already scrolled for this arrival; a refocus must leave the user
      // wherever they were. Entering fresh from Settings pushes a new screen,
      // whose ref starts false — the deep link still lands on the card.
      if (focusHandledRef.current) return;
      focusHandledRef.current = true;
      // Immediately (covers an already-laid-out screen) and once more after a
      // beat (covers a cold mount whose layout hasn't happened yet).
      scrollToCrisis();
      const t = setTimeout(scrollToCrisis, 250);
      return () => clearTimeout(t);
    }, [wantsCrisis, scrollToCrisis]),
  );

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
        <Text style={styles.title}>Privacy, Data & Safety</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 1. IF YOU NEED HELP NOW =====
            FIRST on the screen, on purpose. The card itself is the SHARED
            CrisisResourcesCard — the same component Settings used to render
            and the same one the Map Voice / in-chat crisis surfacing uses.
            Its content (every number, every URL) is single-sourced there and
            is not restated here. The section heading is passed to the card as
            `header` rather than rendered as a sibling <Text> — a separate
            heading stacked a second amber all-caps line above the card's own
            title, and "IF YOU'RE IN CRISIS" is a label some users won't apply
            to themselves. Don't reintroduce one. */}
        <View
          onLayout={(e) => { crisisYRef.current = e.nativeEvent.layout.y; }}
        >
          <CrisisResourcesCard header="If you need help now" />
        </View>

        {/* ===== 2. PRIVACY AT A GLANCE ===== */}
        <Text style={[styles.h1, styles.h1Top]}>Privacy at a glance</Text>
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
        <Bullet>Anthropic: for AI conversation</Bullet>
        <Bullet>
          OpenAI: for voice-note transcription, spoken audio, and the app's
          memory
        </Bullet>
        <Bullet>
          Cartesia and ElevenLabs: for live voice (speech-to-text and
          text-to-speech)
        </Bullet>
        <Text style={styles.paragraph}>
          These providers process your messages or audio to power those
          features and do not retain or train on them, per our API
          agreements. Each also has its own privacy policy that governs its
          handling of data passed to it.
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

        {/* ===== 3. YOUR DATA ===== */}
        <YourDataSection />
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

// =============================================================================
// useAccountExport — moved verbatim from app/settings.tsx (it backed the
// Settings → PRIVACY & DATA "Export My Data" row, which now lives here).
// useState-wrapped so the caller's button can dim itself while the export is
// in flight.
// =============================================================================
function useAccountExport() {
  const [exporting, setExporting] = useState(false);
  const run = useCallback(async () => {
    if (exporting) return;
    Haptics.selectionAsync().catch(() => {});
    setExporting(true);
    try {
      const result = await api.exportAccount();
      if (!result.ok) {
        if (result.error === 'rate-limit-exceeded') {
          Alert.alert(
            'Export limit reached',
            result.message || "You've hit the daily export limit. Please try again later.",
          );
        } else {
          Alert.alert(
            "Couldn't export",
            result.message || 'Something went wrong. Please try again.',
          );
        }
        return;
      }
      // Write the JSON body to a temp file so the share sheet has a
      // proper file URI (sharing a raw string opens up paste, not save).
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
      if (!cacheDir) {
        Alert.alert("Couldn't export", 'No cache directory available.');
        return;
      }
      const uri = cacheDir + result.suggestedFilename;
      await FileSystem.writeAsStringAsync(uri, result.body, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(
          'Share unavailable',
          "Sharing isn't available on this device. The export file is at:\n" + uri,
        );
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: 'Save your Inner Map data',
        UTI: 'public.json',
      });
    } catch (e) {
      console.warn('[settings/export] threw:', (e as Error)?.message);
      Alert.alert("Couldn't export", (e as Error)?.message || 'Unknown error');
    } finally {
      setExporting(false);
    }
  }, [exporting]);
  return { exporting, run };
}

// =============================================================================
// YourDataSection — the three data controls, moved out of Settings so they sit
// under the privacy text that explains them rather than in a second place.
//
// Export wires through the useAccountExport hook above (moved with it).
// Delete pushes to the existing /account/delete screen, which owns the
// irreversible-action confirmation flow — this row is only its entry point and
// deliberately does not duplicate or short-circuit it.
// Your ID is the anonymous device identifier, selectable so support requests
// can quote it.
// =============================================================================
function YourDataSection() {
  const router = useRouter();
  const { exporting, run: handleExport } = useAccountExport();
  const [userId, setUserId] = useState<string>('');

  useEffect(() => {
    getUserId().then(setUserId).catch(() => {});
  }, []);

  const handleDelete = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push('/account/delete' as any);
  };

  return (
    <>
      <Text style={styles.h2}>Your data</Text>

      <View style={styles.dataBlock}>
        <Text style={styles.dataTitle}>Export your data</Text>
        <Text style={styles.dataBody}>
          Download a copy of your data as a JSON file, anytime.
        </Text>
        <Pressable
          onPress={handleExport}
          disabled={exporting}
          style={[styles.dataActionBtn, exporting && styles.dataActionBtnDim]}
          accessibilityLabel="Export my data"
        >
          <Text style={styles.dataActionBtnText}>
            {exporting ? 'EXPORTING…' : 'EXPORT MY DATA'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.dataBlock}>
        <Text style={styles.dataTitle}>Delete your account</Text>
        <Text style={styles.dataBody}>
          Remove everything from our servers in one tap. Not soft-deleted —
          actually deleted.
        </Text>
        <Pressable
          onPress={handleDelete}
          style={[styles.dataActionBtn, styles.dataActionBtnDestructive]}
          accessibilityLabel="Delete my account"
        >
          <Text style={[styles.dataActionBtnText, styles.dataActionBtnTextDestructive]}>
            DELETE MY ACCOUNT
          </Text>
        </Pressable>
      </View>

      <View style={styles.dataBlock}>
        <Text style={styles.dataTitle}>Your ID</Text>
        <Text style={styles.dataBody}>
          Anonymous device identifier — long-press to copy and share with
          support if you need help.
        </Text>
        <Text style={styles.idText} selectable>
          {userId || '…'}
        </Text>
      </View>
    </>
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
  // "Privacy at a glance" is now the SECOND block on the screen, so it needs
  // the breathing room a leading h1 didn't.
  h1Top: { marginTop: spacing.xl },
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

  // ===== YOUR DATA =====
  // Bordered cards in the same visual language the controls had in Settings,
  // so the move doesn't change how they read.
  dataBlock: {
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  dataTitle: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 2,
  },
  dataBody: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  dataActionBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.05)',
  },
  dataActionBtnDim: { opacity: 0.5 },
  dataActionBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  dataActionBtnDestructive: {
    borderColor: 'rgba(220, 90, 90, 0.45)',
    backgroundColor: 'rgba(220, 90, 90, 0.05)',
  },
  dataActionBtnTextDestructive: {
    color: '#E68080',
  },
  idText: {
    color: colors.creamFaint,
    fontFamily: 'Courier',
    fontSize: 11,
    marginTop: 6,
    letterSpacing: 0.3,
  },
});
