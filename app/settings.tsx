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

import React, { useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Linking, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';

import { colors, fonts, radii, spacing } from '../constants/theme';
import { getUserId } from '../services/user';
import {
  useExperienceLevel, loadExperienceLevel, setExperienceLevel,
  LEVEL_LABELS, ExperienceLevel,
} from '../services/experienceLevel';
import {
  biometricsAvailable, isLockEnabled, setLockEnabled,
} from '../services/biometrics';

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
        {/* ===== EXPERIENCE LEVEL ===== */}
        <Text style={styles.sectionLabel}>EXPERIENCE LEVEL</Text>
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
});
