// Settings screen — accessible from the chat hamburger menu.
//
// A simple list, modeled after the existing About / Privacy rows in the
// hamburger so the visual language is consistent. Sections:
//   - EXPERIENCE LEVEL with a Change link that re-opens the level picker
//   - PRIVACY POLICY (in-app, /privacy)
//   - YOUR DATA — anonymous device ID for support, copyable
//   - CONTACT — mailto link to support
//   - VERSION — dim line at the bottom
//
// Most of the per-toggle controls (audio, notifications) still live in
// the hamburger because they're commonly toggled and benefit from being
// one tap away. This screen is for the less-frequent, more meaningful
// settings + transparency rows.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Linking, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';

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
  PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, openLegalDoc as openLegalDocLive,
} from '../utils/legalDocs';
import { getUserId, setUserId as overrideUserId, clearUserId } from '../services/user';
import { resetOnboarding } from '../services/onboarding';
import { AuthButtonRow } from '../components/auth/AuthButtonRow';
import { CrisisResourcesCard } from '../components/safety/CrisisResourcesCard';
import {
  useExperienceLevel, loadExperienceLevel, setExperienceLevel,
  LEVEL_LABELS, ExperienceLevel,
} from '../services/experienceLevel';
import {
  biometricsAvailable, isLockEnabled, setLockEnabled,
} from '../services/biometrics';
import { getJournalShareDefault, setJournalShareDefault } from '../services/journal';
import { api } from '../services/api';
import * as Sentry from '@sentry/react-native';

const SUPPORT_EMAIL = 'support@my-inner-map.com';

export default function SettingsScreen() {
  const router = useRouter();
  const level = useExperienceLevel();
  const [userId, setUserId] = useState<string>('');
  // App Lock toggle visibility is gated on biometric capability — if the
  // device has no Face ID / Touch ID the toggle is hidden entirely so we
  // never offer a setting that does nothing.
  const [bioAvailable, setBioAvailable] = useState<boolean>(false);
  const [lockOn, setLockOn] = useState<boolean>(false);
  // Global "share new journal entries with the AI" default. true = shared
  // (synced to the server for RAG); false = new entries stay on-device.
  const [journalShareOn, setJournalShareOn] = useState<boolean>(true);

  useEffect(() => {
    loadExperienceLevel().catch(() => {});
    getUserId().then(setUserId).catch(() => {});
    getJournalShareDefault().then(setJournalShareOn).catch(() => {});
    (async () => {
      const ok = await biometricsAvailable();
      setBioAvailable(ok);
      if (ok) setLockOn(await isLockEnabled());
    })();
  }, []);

  async function toggleLock(next: boolean) {
    Haptics.selectionAsync().catch(() => {});
    setLockOn(next);
    await setLockEnabled(next);
  }

  async function toggleJournalShare(next: boolean) {
    Haptics.selectionAsync().catch(() => {});
    setJournalShareOn(next);
    await setJournalShareDefault(next);
  }

  const version = (Constants.expoConfig?.version || '1.0.0');

  function changeLevel() {
    Haptics.selectionAsync().catch(() => {});
    // Inline picker — three quick options, one cancel. Avoids a full
    // re-run of onboarding, which would also force the user back through
    // welcome / terms / intake.
    Alert.alert(
      'Experience level',
      'How the AI calibrates its voice for you.',
      [
        { text: LEVEL_LABELS.curious,     onPress: () => setExperienceLevel('curious' as ExperienceLevel) },
        { text: LEVEL_LABELS.familiar,    onPress: () => setExperienceLevel('familiar' as ExperienceLevel) },
        { text: LEVEL_LABELS.experienced, onPress: () => setExperienceLevel('experienced' as ExperienceLevel) },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.creamDim} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== CRISIS RESOURCES =====
            Pinned at the very top of Settings — first thing the user
            sees on opening. Apple Mental Health & Wellness review
            specifically looks for a discoverable crisis-resources
            surface in apps that touch emotional content. Compact by
            design (per spec: must fit on iPhone SE without scrolling)
            with subtle elevation (faint amber border + tinted
            background) so the eye lands on it without alarm. The
            phone numbers + URL all open via expo's Linking module —
            tel: and sms: handle their respective system apps, https:
            opens the default browser. */}
        <CrisisResourcesSection />

        {/* ===== PRIVACY & DATA =====
            Second from the top. The longer companion to the
            first-launch privacy notice — what we store, what we
            never do, the AI provider note, and the user's three
            data rights (export, delete, email privacy@). Section
            content is canonical wording from the PR spec; future
            edits should land here as the single source rather than
            drifting between this screen and the first-launch notice
            in app/onboarding.tsx. */}
        <PrivacyDataSection />

        {/* ===== EXPERIENCE LEVEL ===== */}
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>EXPERIENCE LEVEL</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{LEVEL_LABELS[level] || 'Not set'}</Text>
            <Text style={styles.rowSub}>How the AI calibrates its voice for you.</Text>
          </View>
          <Pressable onPress={changeLevel} hitSlop={10} style={styles.linkBtn}>
            <Text style={styles.linkText}>CHANGE</Text>
          </Pressable>
        </View>

        {/* ===== ACCOUNT (Build 11) ===== */}
        <AccountSection />

        {/* ===== PRIVACY ===== */}
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>PRIVACY</Text>
        {bioAvailable ? (
          <View style={[styles.row, { marginBottom: spacing.sm }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>App Lock</Text>
              <Text style={styles.rowSub}>
                Require Face ID to open Inner Map. Your conversations are private.
              </Text>
            </View>
            <Switch
              value={lockOn}
              onValueChange={toggleLock}
              trackColor={{ false: '#3A3340', true: 'rgba(230,180,122,0.45)' }}
              thumbColor={lockOn ? colors.amber : '#bdb6c8'}
              ios_backgroundColor="#3A3340"
            />
          </View>
        ) : null}
        <View style={[styles.row, { marginBottom: spacing.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Share journal with AI</Text>
            <Text style={styles.rowSub}>
              New entries are shared with the AI by default — stored on our server
              so it can reference them in conversation. Turn off to keep new
              entries private: encrypted on your device, never sent.
            </Text>
          </View>
          <Switch
            value={journalShareOn}
            onValueChange={toggleJournalShare}
            trackColor={{ false: '#3A3340', true: 'rgba(230,180,122,0.45)' }}
            thumbColor={journalShareOn ? colors.amber : '#bdb6c8'}
            ios_backgroundColor="#3A3340"
          />
        </View>
        <Pressable onPress={() => router.push('/privacy')} style={styles.linkRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Privacy policy</Text>
            <Text style={styles.rowSub}>How your data is stored and used.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.creamFaint} />
        </Pressable>

        {/* ===== YOUR DATA ===== */}
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>YOUR DATA</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Your ID</Text>
            <Text style={styles.rowSub}>
              Anonymous device identifier — long-press to copy and share with
              support if you need help.
            </Text>
            <Text style={styles.idText} selectable>
              {userId || '…'}
            </Text>
          </View>
        </View>

        {/* Dev-only identity recovery — handles the case where a SecureStore
            stall caused the boot path to mint a fresh UUID and orphan the
            user from their existing data. Hidden in production builds. */}
        {__DEV__ ? (
          <Pressable
            style={styles.linkRow}
            onPress={() => {
              Alert.prompt(
                'Override device ID',
                'Paste an existing user id to restore. Writes to SecureStore + AsyncStorage and reloads on next API call.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Override',
                    style: 'destructive',
                    onPress: async (input?: string) => {
                      const next = String(input || '').trim();
                      if (!next) return;
                      try {
                        await overrideUserId(next);
                        setUserId(next);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                        Alert.alert(
                          'ID overridden',
                          `Device id is now ${next.slice(0, 8)}…\nReload the app for all tabs to pick it up cleanly.`,
                        );
                      } catch (e) {
                        Alert.alert('Override failed', (e as Error)?.message || 'unknown');
                      }
                    },
                  },
                ],
                'plain-text',
                userId,
              );
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Override device ID (dev only)</Text>
              <Text style={styles.rowSub}>
                Paste an id to recover from a SecureStore stall that orphaned
                the previous identity.
              </Text>
            </View>
            <Ionicons name="construct-outline" size={18} color={colors.creamFaint} />
          </Pressable>
        ) : null}

        {/* Dev-only Sentry verification — confirm crash reporting reaches the
            Sentry dashboard before relying on it. Hidden in production. The
            captured-error path is the safe, deterministic test (it always
            sends); the native-crash path hard-crashes the process to verify
            native crash capture (only meaningful in a real/release build). */}
        {__DEV__ ? (
          <Pressable
            style={styles.linkRow}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              Alert.alert(
                'Send test event to Sentry?',
                'Sends a captured test error now. The hard-crash option verifies native crash capture (release build only).',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Send captured error',
                    onPress: () => {
                      Sentry.captureException(
                        new Error('Sentry verification — manual test from Settings'),
                      );
                      Alert.alert(
                        'Sent',
                        'A test error was sent to Sentry. Check Issues in the innermap / react-native project (~1 min).',
                      );
                    },
                  },
                  {
                    text: 'Hard native crash',
                    style: 'destructive',
                    onPress: () => { Sentry.nativeCrash(); },
                  },
                ],
              );
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Sentry test event (dev only)</Text>
              <Text style={styles.rowSub}>
                Verify crash reporting reaches the dashboard before relying on it.
              </Text>
            </View>
            <Ionicons name="bug-outline" size={18} color={colors.creamFaint} />
          </Pressable>
        ) : null}

        {/* ACCOUNT & DATA section removed — Export My Data and Delete
            My Account now live exclusively in PRIVACY & DATA above
            (single source of truth, eliminates the two-paths-to-same-
            destructive-action confusion). The shared useAccountExport
            hook is the implementation underneath. */}

        {/* ===== CONTACT ===== */}
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>CONTACT</Text>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Inner%20Map%20support`).catch(() => {});
          }}
          style={styles.linkRow}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Email support</Text>
            <Text style={styles.rowSub}>{SUPPORT_EMAIL}</Text>
          </View>
          <Ionicons name="mail-outline" size={18} color={colors.creamFaint} />
        </Pressable>

        <Text style={styles.version}>Inner Map · v{version}</Text>
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

  sectionLabel: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  sectionLabelTop: { marginTop: spacing.xl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  rowTitle: { color: colors.cream, fontFamily: fonts.sansBold, fontSize: 14 },
  rowSub: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  idText: {
    color: colors.creamFaint,
    fontFamily: 'Courier',
    fontSize: 11,
    marginTop: 6,
    letterSpacing: 0.3,
  },
  linkBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.45)',
  },
  linkText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.4,
  },

  // Build 11 — Account section styles. The "SAVE MY DATA" primary
  // button uses the same amber CTA pattern as the EndSession button;
  // the "Add another sign-in option" / "Sign out" links use the
  // muted text-button pattern from the other settings rows.
  rowSubBlock: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  accountPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amber,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
    minWidth: 240,
    alignSelf: 'center',
  },
  accountPrimaryBtnText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 1.4,
  },
  accountAddWrap: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: radii.md,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.18)',
  },
  accountAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  accountAddBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  accountSignOutBtn: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  accountSignOutText: {
    color: '#E05050',
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.4,
  },

  version: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xxl,
    letterSpacing: 0.4,
  },
  // (Former accountRow* styles for the now-removed AccountDataRows
  // component dropped. PrivacyDataSection uses its own privacyActionBtn
  // styling for Export / Delete actions.)

  // ===== Crisis Resources card =====
  // Single elevated card at the very top of Settings. Subtle amber
  // border + faint amber wash to draw the eye without alarming the
  // user (no red, no exclamation marks). Vertical spacing kept tight
  // so the whole card fits in the first viewport on iPhone SE.
  crisisCard: {
    backgroundColor: 'rgba(230, 180, 122, 0.06)',
    borderColor: 'rgba(230, 180, 122, 0.45)',
    borderWidth: 0.75,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  crisisTitle: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 6,
  },
  crisisLede: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  crisisLocaleLabel: {
    color: colors.amberDim,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  crisisLocaleLabelTop: { marginTop: spacing.sm },
  crisisRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  crisisBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.amber,
    backgroundColor: 'rgba(230, 180, 122, 0.08)',
  },
  crisisBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  crisisSub: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  crisisBody: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },

  // ===== Privacy & Data block =====
  // Grouped sub-cards under one section label. Each sub-block is a
  // bordered card (matches the card visual language of the existing
  // Settings rows) holding one heading + one body.
  privacyBlock: {
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  privacyH3: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  privacyBody: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  privacyBodyBold: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 2,
  },
  privacyBodyBoldTop: { marginTop: spacing.sm },
  privacyBullet: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 22,
  },
  privacyActionBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.05)',
  },
  privacyActionBtnDim: { opacity: 0.5 },
  privacyActionBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  privacyActionBtnDestructive: {
    borderColor: 'rgba(220, 90, 90, 0.45)',
    backgroundColor: 'rgba(220, 90, 90, 0.05)',
  },
  privacyActionBtnTextDestructive: {
    color: '#E68080',
  },
  // "Bottom line" closing card — uses a slightly amber wash to land
  // as the section's closing beat, not as another data block.
  privacyBottomLine: {
    backgroundColor: 'rgba(230, 180, 122, 0.04)',
    borderColor: 'rgba(230, 180, 122, 0.25)',
  },
});

// =============================================================================
// useAccountExport — shared helper for the Settings → PRIVACY & DATA
// "Export My Data" row. Originally split out so two call sites could
// share the implementation; the second site (the old ACCOUNT & DATA
// section) was retired, so this is now the sole consumer — but the
// hook is kept as a clean integration point in case the export is
// surfaced from another screen later. useState-wrapped so the caller's
// button can dim itself while the export is in flight.
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
// (AccountDataRows component removed — its Export + Delete pills are
// now exclusively rendered by PrivacyDataSection below, which has the
// fuller framing + the email-privacy@ button alongside. The shared
// useAccountExport hook is the underlying export implementation.)
// =============================================================================

// =============================================================================
// CrisisResourcesSection — pinned at the very top of Settings.
//
// Compact by design — fits within the first iPhone SE-height viewport
// without scrolling. Warm (amber tint, not red-flag styling) but
// visibly elevated so the eye lands on it within a second of opening
// Settings. The phone-number + URL buttons defer to system apps via
// expo Linking (already imported as `Linking` for the existing email
// row). tel: → dialer; sms: → Messages; https: → default browser.
// =============================================================================
// Now a thin wrapper around the SHARED CrisisResourcesCard (inline variant)
// so the Settings resource list is single-sourced with the Map Voice / in-
// chat surfacing. Previously this was a separate inline copy that had
// DRIFTED — it omitted the Domestic Violence + Eating Disorders numbers the
// shared card carries. One source of truth now.
function CrisisResourcesSection() {
  return <CrisisResourcesCard />;
}

// =============================================================================
// PrivacyDataSection — the longer, in-Settings version of the
// first-launch privacy notice. Comprehensive: what we store, what we
// never do, the AI provider note, and the user's three data rights
// (export, delete, email privacy@).
//
// Export wires through to the same useAccountExport hook the
// existing ACCOUNT & DATA section uses. Delete pushes to the existing
// /account/delete screen (built in PR 2b). Email opens the user's
// default mail client with a bare mailto: link — no subject or body
// pre-filled, per spec.
//
// TODO(post-launch): when the hosted privacy policy URL is live,
// add a "Read full privacy policy" link below the YOUR RIGHTS block
// here. The existing in-app /privacy screen (linked elsewhere in
// Settings) carries the detailed policy in the meantime.
// =============================================================================
// =============================================================================
// Account section (Build 11). Three states based on /api/auth/identities:
//
//   - LOADING — small loader; doesn't render the section
//   - SIGNED IN  → list of linked identities + "Add another" sub-row
//                  + Sign out
//   - ANONYMOUS  → "You're using Inner Map anonymously" notice +
//                  primary "Save my data — add a sign-in option"
//                  button that expands into the AuthButtonRow
//
// Sign-out path: clearUserId() + resetOnboarding() so the next launch
// re-runs the welcome → sign-in → onboarding gauntlet from a clean
// slate. The user's server-side data is preserved (the auth_identities
// row → user_id mapping doesn't change), so signing back in restores
// it on the next launch.
// =============================================================================
type Identity = {
  id: string;
  provider: 'apple' | 'google' | 'email';
  email: string | null;
  created_at: string;
  last_used_at: string;
};

function AccountSection() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { identities } = await api.authListIdentities();
      setIdentities(identities as Identity[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRemove = useCallback((id: Identity) => {
    const isLast = identities.length <= 1;
    const message = isLast
      ? 'This is your only sign-in option. If you remove it, you’ll go back to anonymous mode — ' +
        'and if you lose this device, your data will be lost. Continue?'
      : 'Remove this sign-in option from your account?';
    Alert.alert(
      'Remove sign-in option',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            const ok = await api.authRemoveIdentity(id.id);
            if (ok) {
              await refresh();
            } else {
              Alert.alert('Couldn’t remove', 'Try again in a moment.');
            }
          },
        },
      ],
      { cancelable: true },
    );
  }, [identities, refresh]);

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign out?',
      'You can sign back in with the same Apple, Google, or email on this device or any other to restore your data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            try { await clearUserId(); } catch {}
            try { await resetOnboarding(); } catch {}
            // Replace, not push — the back stack should be empty
            // post-sign-out so the user can't navigate "back" into
            // their previous session's screens.
            router.replace('/sign-in');
          },
        },
      ],
      { cancelable: true },
    );
  }, [router]);

  if (loading) {
    return (
      <>
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>ACCOUNT</Text>
        <View style={styles.row}>
          <Text style={styles.rowSub}>Loading…</Text>
        </View>
      </>
    );
  }

  const providerLabel = (p: Identity['provider']) =>
    p === 'apple' ? 'Apple' : p === 'google' ? 'Google' : 'Email';

  return (
    <>
      <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>ACCOUNT</Text>
      {identities.length === 0 ? (
        <>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>You're using Inner Map anonymously.</Text>
              <Text style={styles.rowSub}>
                No email, no account. Your conversations and your map are
                stored on our servers, linked to this device. Your private journal entries stay on this phone only,
                encrypted. If you lose this phone,
                you'll lose access to your saved conversations and map. Add an
                email or sign-in any time to recover your account on a new
                device.
              </Text>
            </View>
          </View>
          {addOpen ? (
            <View style={styles.accountAddWrap}>
              <AuthButtonRow
                onSuccess={() => { setAddOpen(false); refresh(); }}
                compact
              />
            </View>
          ) : (
            <Pressable
              onPress={() => setAddOpen(true)}
              style={({ pressed }) => [styles.accountPrimaryBtn, pressed && { opacity: 0.85 }]}
              accessibilityLabel="Save my data — add a sign-in option"
            >
              <Ionicons name="cloud-upload-outline" size={16} color={colors.background} style={{ marginRight: 8 }} />
              <Text style={styles.accountPrimaryBtnText}>SAVE MY DATA</Text>
            </Pressable>
          )}
        </>
      ) : (
        <>
          <Text style={styles.rowSubBlock}>
            Your data is saved to your account. You can sign in on any device to restore it.
          </Text>
          {identities.map((id) => (
            <View key={id.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{providerLabel(id.provider)}</Text>
                {id.email ? (
                  <Text style={styles.rowSub}>{id.email}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => handleRemove(id)}
                hitSlop={10}
                style={styles.linkBtn}
              >
                <Text style={[styles.linkText, { color: '#E05050' }]}>REMOVE</Text>
              </Pressable>
            </View>
          ))}
          {addOpen ? (
            <View style={styles.accountAddWrap}>
              <Text style={styles.rowSubBlock}>Add another sign-in option:</Text>
              <AuthButtonRow
                onSuccess={() => { setAddOpen(false); refresh(); }}
                compact
              />
            </View>
          ) : (
            <Pressable
              onPress={() => setAddOpen(true)}
              hitSlop={8}
              style={styles.accountAddBtn}
            >
              <Ionicons name="add" size={14} color={colors.amber} />
              <Text style={styles.accountAddBtnText}>Add another sign-in option</Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleSignOut}
            hitSlop={8}
            style={styles.accountSignOutBtn}
          >
            <Text style={styles.accountSignOutText}>Sign out</Text>
          </Pressable>
        </>
      )}
    </>
  );
}

function PrivacyDataSection() {
  const router = useRouter();
  const { exporting, run: handleExport } = useAccountExport();
  const handleDelete = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push('/account/delete' as any);
  };
  const handleEmailPrivacy = () => {
    Haptics.selectionAsync().catch(() => {});
    // Bare mailto per spec — no subject/body pre-filled.
    Linking.openURL('mailto:privacy@my-inner-map.com').catch((e) =>
      console.warn('[settings/privacy] mailto threw:', (e as Error)?.message),
    );
  };
  // Canonical, legally-binding documents (hosted). This section is a
  // plain-language summary; these open the full live versions via the shared
  // helper (utils/legalDocs) so the open mechanism is consistent app-wide.
  const openLegalDoc = (url: string) => {
    Haptics.selectionAsync().catch(() => {});
    openLegalDocLive(url);
  };

  return (
    <>
      <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>PRIVACY &amp; DATA</Text>

      <View style={styles.privacyBlock}>
        <Text style={styles.privacyH3}>THE FULL DOCUMENTS</Text>
        <Text style={styles.privacyBody}>
          The notes below are a plain-language summary. The full,
          legally-binding documents live on the web:
        </Text>
        <Pressable
          onPress={() => openLegalDoc(PRIVACY_POLICY_URL)}
          style={styles.privacyActionBtn}
          accessibilityLabel="Read the full Privacy Policy"
        >
          <Text style={styles.privacyActionBtnText}>READ THE FULL PRIVACY POLICY ↗</Text>
        </Pressable>
        <Pressable
          onPress={() => openLegalDoc(TERMS_OF_SERVICE_URL)}
          style={[styles.privacyActionBtn, { marginTop: spacing.sm }]}
          accessibilityLabel="Read the full Terms of Service"
        >
          <Text style={styles.privacyActionBtnText}>READ THE FULL TERMS OF SERVICE ↗</Text>
        </Pressable>
      </View>

      <View style={styles.privacyBlock}>
        <Text style={styles.privacyH3}>WHAT WE STORE</Text>
        <Text style={styles.privacyBodyBold}>On your device only</Text>
        <Text style={styles.privacyBody}>
          Private journal entries. Entries you mark private are encrypted
          with a key only your phone has — we genuinely can't read them.
          (Entries you share with the AI are stored securely on our
          servers, like your conversations.)
        </Text>
        <Text style={[styles.privacyBodyBold, styles.privacyBodyBoldTop]}>On our server</Text>
        <Text style={styles.privacyBody}>
          Your account, your conversations, your map (parts and patterns),
          and any journal entries you choose to share.
          This is how Inner Map remembers context across sessions and how the
          AI can respond with continuity.
        </Text>
      </View>

      <View style={styles.privacyBlock}>
        <Text style={styles.privacyH3}>WHAT WE NEVER DO</Text>
        <Text style={styles.privacyBullet}>•  Sell your data</Text>
        <Text style={styles.privacyBullet}>•  Run ads</Text>
        <Text style={styles.privacyBullet}>•  Share with third parties for marketing</Text>
        <Text style={styles.privacyBullet}>•  Train AI models on your conversations</Text>
      </View>

      <View style={styles.privacyBlock}>
        <Text style={styles.privacyH3}>ABOUT THE AI</Text>
        <Text style={styles.privacyBody}>
          Inner Map uses Anthropic (for chat) and OpenAI (for voice and
          transcription). These providers process your conversations to
          generate replies — that's how the app works. Per their paid API
          agreements, they don't retain your data or use it to train their
          models.
        </Text>
        <Text style={[styles.privacyBody, { marginTop: spacing.sm }]}>
          We do not use your conversations to train any model either. Your
          inner work is not training data.
        </Text>
      </View>

      <View style={styles.privacyBlock}>
        <Text style={styles.privacyH3}>YOUR RIGHTS</Text>

        <Text style={styles.privacyBodyBold}>Export your data</Text>
        <Text style={styles.privacyBody}>
          Download everything we have on you as a JSON file, anytime.
        </Text>
        <Pressable
          onPress={handleExport}
          disabled={exporting}
          style={[styles.privacyActionBtn, exporting && styles.privacyActionBtnDim]}
          accessibilityLabel="Export my data"
        >
          <Text style={styles.privacyActionBtnText}>
            {exporting ? 'EXPORTING…' : 'EXPORT MY DATA'}
          </Text>
        </Pressable>

        <Text style={[styles.privacyBodyBold, styles.privacyBodyBoldTop]}>Delete your account</Text>
        <Text style={styles.privacyBody}>
          Remove everything from our servers in one tap. Not soft-deleted —
          actually deleted.
        </Text>
        <Pressable
          onPress={handleDelete}
          style={[styles.privacyActionBtn, styles.privacyActionBtnDestructive]}
          accessibilityLabel="Delete my account"
        >
          <Text style={[styles.privacyActionBtnText, styles.privacyActionBtnTextDestructive]}>
            DELETE MY ACCOUNT
          </Text>
        </Pressable>

        <Text style={[styles.privacyBodyBold, styles.privacyBodyBoldTop]}>Reach out</Text>
        <Text style={styles.privacyBody}>
          Email privacy@my-inner-map.com for questions or data requests.
        </Text>
        <Pressable
          onPress={handleEmailPrivacy}
          style={styles.privacyActionBtn}
          accessibilityLabel="Email privacy@my-inner-map.com"
        >
          <Text style={styles.privacyActionBtnText}>EMAIL PRIVACY@MY-INNER-MAP.COM</Text>
        </Pressable>
      </View>

      <View style={[styles.privacyBlock, styles.privacyBottomLine]}>
        <Text style={styles.privacyH3}>THE BOTTOM LINE</Text>
        <Text style={styles.privacyBody}>
          Inner work is private work. We built Inner Map to treat it that way.
        </Text>
      </View>
    </>
  );
}
