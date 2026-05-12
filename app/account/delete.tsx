// Account deletion — dedicated confirmation screen.
//
// Per the PR 2b spec: this is NOT a modal Alert. It's a full screen
// the user has to land on and read before the destructive button is
// available. Two main controls:
//   - "Export now" — runs the same export flow as Settings, in case
//     the user wants a copy before deleting.
//   - "Permanently Delete My Account" — red, requires a single
//     confirm dialog ("This cannot be undone. Continue?"), then
//     calls DELETE /api/account, then runs wipeLocalAccountData(),
//     then routes to /account/deleted.
//
// If the user is in an active relationship, we surface the
// partner-departure notice up front so they understand what their
// partner will see.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
// expo-file-system v19's class API is forward-looking but more verbose
// for our one-JSON-file use case; the legacy URI-based namespace is
// the same package and matches the cacheDirectory + writeAsStringAsync
// pattern we want.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { wipeLocalAccountData } from '../../utils/localCleanup';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const [hasRelationship, setHasRelationship] = useState<boolean>(false);
  const [busy, setBusy] = useState<'idle' | 'exporting' | 'deleting'>('idle');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rels = await api.listRelationships();
        if (cancelled) return;
        setHasRelationship(rels.some((r) => r.status === 'active'));
      } catch {
        // best-effort — if we can't tell, render the screen without the
        // relationship-specific notice (the cascade still does the right
        // thing on the server).
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function exportNow() {
    if (busy !== 'idle') return;
    Haptics.selectionAsync().catch(() => {});
    setBusy('exporting');
    try {
      const result = await api.exportAccount();
      if (!result.ok) {
        Alert.alert(
          "Couldn't export",
          result.message || 'Try again from Settings → Account & Data, or proceed without exporting.',
        );
        return;
      }
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
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: 'Save your Inner Map data',
          UTI: 'public.json',
        });
      } else {
        Alert.alert('Saved', `Export file at:\n${uri}`);
      }
    } catch (e) {
      Alert.alert("Couldn't export", (e as Error)?.message || 'unknown');
    } finally {
      setBusy('idle');
    }
  }

  function startDelete() {
    if (busy !== 'idle') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    Alert.alert(
      'This cannot be undone',
      'Your conversations, inner map, journal entries, and all related data will be permanently removed. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete forever',
          style: 'destructive',
          onPress: runDelete,
        },
      ],
    );
  }

  async function runDelete() {
    setBusy('deleting');
    try {
      const result = await api.deleteAccount();
      if (!result.ok) {
        Alert.alert(
          "Couldn't delete",
          result.message || 'Please try again. If this keeps happening, contact support.',
        );
        setBusy('idle');
        return;
      }
      // Server-side delete succeeded. Now wipe everything local.
      // Even if local cleanup fails partially, the server is the source
      // of truth — the user is genuinely deleted server-side, and the
      // remaining local state is just stale flags that the next fresh
      // install path will recover from anyway.
      try {
        await wipeLocalAccountData();
      } catch (e) {
        console.warn('[delete] local cleanup threw (continuing):', (e as Error)?.message);
      }
      // Land on the warm "deleted" screen. The user can tap Begin again
      // from there to re-onboard. We use router.replace so they can't
      // back-stack into the deleted-account state.
      router.replace('/account/deleted' as any);
    } catch (e) {
      Alert.alert("Couldn't delete", (e as Error)?.message || 'unknown');
      setBusy('idle');
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          disabled={busy !== 'idle'}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.creamDim} />
        </Pressable>
        <Text style={styles.title}>Delete account</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.lede}>
          Deleting your account will permanently remove everything Inner Map
          holds about you:
        </Text>
        <View style={styles.bulletList}>
          <Bullet>All your conversations and session transcripts</Bullet>
          <Bullet>Your inner map — wound, parts, spectrum scores</Bullet>
          <Bullet>All journal entries</Bullet>
          <Bullet>Settings, preferences, and your anonymous device ID</Bullet>
        </View>

        {hasRelationship ? (
          <View style={styles.relationshipNotice}>
            <Ionicons name="information-circle" size={16} color={colors.amber} />
            <Text style={styles.relationshipNoticeText}>
              You're in a relationship on Inner Map. Your partner will see that
              you've left — and the shared insights you built together will stay
              visible to them.
            </Text>
          </View>
        ) : null}

        <Text style={styles.warning}>
          This action is immediate and irreversible. There's no recovery — not
          by us, not by you, not by Apple.
        </Text>

        <Text style={[styles.lede, { marginTop: spacing.xl }]}>
          If you'd like a copy first, you can save one now:
        </Text>
        <Pressable
          onPress={exportNow}
          disabled={busy !== 'idle'}
          style={[styles.exportBtn, busy === 'exporting' && styles.btnDim]}
        >
          {busy === 'exporting' ? (
            <ActivityIndicator color={colors.amber} />
          ) : (
            <>
              <Ionicons name="download-outline" size={16} color={colors.amber} />
              <Text style={styles.exportBtnText}>Export now</Text>
            </>
          )}
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={startDelete}
          disabled={busy !== 'idle'}
          style={[styles.deleteBtn, busy === 'deleting' && styles.btnDim]}
        >
          {busy === 'deleting' ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.deleteBtnText}>Permanently Delete My Account</Text>
          )}
        </Pressable>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.cream, fontFamily: fonts.serifBold, fontSize: 22, letterSpacing: 0.4 },

  body: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },

  lede: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  bulletList: { marginTop: spacing.sm, marginBottom: spacing.lg },
  bulletRow: { flexDirection: 'row', marginBottom: 8 },
  bulletDot: { color: colors.amber, width: 16, fontFamily: fonts.sansBold },
  bulletText: { color: colors.creamDim, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, flex: 1 },

  relationshipNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(230,180,122,0.08)',
    borderColor: 'rgba(230,180,122,0.45)',
    borderWidth: 0.5,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 10,
    marginBottom: spacing.lg,
  },
  relationshipNoticeText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },

  warning: {
    color: '#E68080',
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.lg,
  },

  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 999,
    borderColor: 'rgba(230,180,122,0.45)',
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  exportBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.5,
  },

  deleteBtn: {
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: '#B43A3A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  deleteBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  btnDim: { opacity: 0.6 },
});
