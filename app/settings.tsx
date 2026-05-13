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
import { getUserId, setUserId as overrideUserId } from '../services/user';
import {
  useExperienceLevel, loadExperienceLevel, setExperienceLevel,
  LEVEL_LABELS, ExperienceLevel,
} from '../services/experienceLevel';
import {
  biometricsAvailable, isLockEnabled, setLockEnabled,
} from '../services/biometrics';
import { api } from '../services/api';

const SUPPORT_EMAIL = 'innermapapp@gmail.com';

export default function SettingsScreen() {
  const router = useRouter();
  const level = useExperienceLevel();
  const [userId, setUserId] = useState<string>('');
  // App Lock toggle visibility is gated on biometric capability — if the
  // device has no Face ID / Touch ID the toggle is hidden entirely so we
  // never offer a setting that does nothing.
  const [bioAvailable, setBioAvailable] = useState<boolean>(false);
  const [lockOn, setLockOn] = useState<boolean>(false);

  useEffect(() => {
    loadExperienceLevel().catch(() => {});
    getUserId().then(setUserId).catch(() => {});
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

        {/* ===== ACCOUNT & DATA — export + delete ===== */}
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>ACCOUNT & DATA</Text>
        <AccountDataRows />

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

  version: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xxl,
    letterSpacing: 0.4,
  },
  // Account & Data rows — "Export My Data" + "Delete Account" pills.
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  accountRowDestructive: {
    borderColor: 'rgba(220, 90, 90, 0.45)',
  },
  accountRowTitleDestructive: {
    color: '#E68080',
    fontFamily: fonts.sansBold,
    fontSize: 14,
  },

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
// runAccountExport — shared helper for the two Settings rows (in
// AccountDataRows below and in the new PrivacyDataSection) that
// trigger an account export. Exposed via a useState-wrapping hook so
// the caller's button can dim itself while the export is in flight.
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
// AccountDataRows — Export + Delete pills inside Settings → Account & Data.
//
// Export: calls api.exportAccount(), writes the JSON to a temp file via
// expo-file-system, opens the OS share sheet via expo-sharing. The share
// sheet lets the user save to Files / send via Mail / save to Drive.
//
// Delete: routes to /account/delete (dedicated confirmation screen —
// per spec, not a modal alert). The actual cascade-delete + post-delete
// local cleanup all live on that screen.
// =============================================================================
function AccountDataRows() {
  const router = useRouter();
  const { exporting, run: handleExport } = useAccountExport();

  const handleDelete = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push('/account/delete' as any);
  };

  return (
    <>
      <Pressable onPress={handleExport} disabled={exporting} style={styles.accountRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Export My Data</Text>
          <Text style={styles.rowSub}>
            Save a copy of everything Inner Map holds about you. JSON file you can
            keep, search, or import into another tool later.
          </Text>
        </View>
        {exporting ? (
          <Ionicons name="hourglass-outline" size={18} color={colors.creamFaint} />
        ) : (
          <Ionicons name="download-outline" size={18} color={colors.creamFaint} />
        )}
      </Pressable>
      <Pressable
        onPress={handleDelete}
        style={[styles.accountRow, styles.accountRowDestructive]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.accountRowTitleDestructive}>Delete Account</Text>
          <Text style={styles.rowSub}>
            Permanently remove your data from Inner Map. Cannot be undone.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#E68080" />
      </Pressable>
    </>
  );
}

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
function CrisisResourcesSection() {
  const open = useCallback((url: string) => {
    Haptics.selectionAsync().catch(() => {});
    Linking.openURL(url).catch((e) =>
      console.warn('[settings/crisis] Linking.openURL threw:', (e as Error)?.message),
    );
  }, []);
  return (
    <View style={styles.crisisCard}>
      <Text style={styles.crisisTitle}>IF YOU'RE IN CRISIS</Text>
      <Text style={styles.crisisLede}>
        You're not alone. These resources are available 24/7.
      </Text>

      <Text style={styles.crisisLocaleLabel}>UNITED STATES</Text>
      <View style={styles.crisisRow}>
        <Pressable onPress={() => open('tel:988')} style={styles.crisisBtn}>
          <Text style={styles.crisisBtnText}>Call 988</Text>
        </Pressable>
        <Pressable onPress={() => open('sms:988')} style={styles.crisisBtn}>
          <Text style={styles.crisisBtnText}>Text 988</Text>
        </Pressable>
      </View>
      <Text style={styles.crisisSub}>Suicide &amp; Crisis Lifeline</Text>

      <Text style={[styles.crisisLocaleLabel, styles.crisisLocaleLabelTop]}>UNITED KINGDOM</Text>
      <View style={styles.crisisRow}>
        <Pressable onPress={() => open('tel:116123')} style={styles.crisisBtn}>
          <Text style={styles.crisisBtnText}>Call Samaritans</Text>
        </Pressable>
      </View>
      <Text style={styles.crisisSub}>116 123</Text>

      <Text style={[styles.crisisLocaleLabel, styles.crisisLocaleLabelTop]}>INTERNATIONAL</Text>
      <View style={styles.crisisRow}>
        <Pressable onPress={() => open('https://findahelpline.com')} style={styles.crisisBtn}>
          <Text style={styles.crisisBtnText}>Find a helpline</Text>
        </Pressable>
      </View>
      <Text style={styles.crisisSub}>findahelpline.com</Text>

      <Text style={[styles.crisisLocaleLabel, styles.crisisLocaleLabelTop]}>EMERGENCY</Text>
      <Text style={styles.crisisBody}>
        For immediate danger, call your local emergency number (911 in the US,
        999 in the UK, 112 in much of Europe).
      </Text>

      <Text style={[styles.crisisLocaleLabel, styles.crisisLocaleLabelTop]}>A NOTE</Text>
      <Text style={styles.crisisBody}>
        Inner Map is a reflection tool, not a crisis service. If you need real-time
        help, please use the resources above. The AI here can't replace a human in
        a moment like that.
      </Text>
    </View>
  );
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

  return (
    <>
      <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>PRIVACY &amp; DATA</Text>

      <View style={styles.privacyBlock}>
        <Text style={styles.privacyH3}>WHAT WE STORE</Text>
        <Text style={styles.privacyBodyBold}>On your device only</Text>
        <Text style={styles.privacyBody}>
          Your journal entries. They're encrypted with a key only your phone
          has. We genuinely can't read them.
        </Text>
        <Text style={[styles.privacyBodyBold, styles.privacyBodyBoldTop]}>On our server</Text>
        <Text style={styles.privacyBody}>
          Your account, your conversations, and your map (parts and patterns).
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
