// Settings screen — accessible from the chat hamburger menu.
//
// A simple list, modeled after the existing About / Privacy rows in the
// hamburger so the visual language is consistent. Sections:
//   - "If you need help now" pointer row → the crisis section of
//     /privacy ("Privacy, Data & Safety")
//   - EXPERIENCE LEVEL with a Change link that re-opens the level picker
//   - YOUR PLAN — membership / restore / manage subscription (iOS only)
//   - ACCOUNT — linked sign-in options
//   - PRIVACY — App Lock, share-journal-with-AI, inbox notifications
//   - CONTACT — mailto link to support
//   - VERSION — dim line at the bottom
//
// Most of the per-toggle controls (audio, notifications) still live in
// the hamburger because they're commonly toggled and benefit from being
// one tap away. This screen is for the less-frequent, more meaningful
// settings + transparency rows.
//
// NOT here any more, and deliberately so: the crisis resources card, the
// long privacy/data explainer, and the data controls (export / your ID).
// They moved to app/privacy.tsx — "Privacy, Data & Safety" — so there is
// ONE place that explains the data story and ONE place that acts on it.
// Settings keeps a single pointer row to the crisis section (Apple Mental
// Health & Wellness review wants a discoverable crisis surface; one row,
// no duplicated content).
//
// The ONE exception to that move: ACCOUNT keeps a "Delete account" row.
// It is an entry point only — /account/delete still owns the whole
// confirmation flow and the copy that explains it — but App Store
// guideline 5.1.1(v) requires account deletion to be discoverable, and
// reviewers (and users) look for it in Settings, under Account. See the
// row itself for why it is not the duplicate that was removed.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Linking, Alert, Switch,
  ActivityIndicator, Platform, Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';

import { colors, fonts, radii, spacing } from '../constants/theme';
import { getUserId, setUserId as overrideUserId, clearUserId } from '../services/user';
import { resetOnboarding } from '../services/onboarding';
import { AuthButtonRow } from '../components/auth/AuthButtonRow';
import {
  useExperienceLevel, loadExperienceLevel, setExperienceLevel,
  useChoseHardPlace, loadChoseHardPlace, setChoseHardPlace,
  LEVEL_LABELS, LEVEL_OPTIONS, ExperienceLevel,
} from '../services/experienceLevel';
import {
  biometricsAvailable, isLockEnabled, setLockEnabled,
} from '../services/biometrics';
import { getJournalShareDefault, setJournalShareDefault } from '../services/journal';
import { getInboxPushOptIn, enableInboxPush, disableInboxPush } from '../services/push';
import { api } from '../services/api';
import type { BillingStatus } from '../services/api';
import { restore as restorePurchases } from '../services/purchases';
import * as Sentry from '@sentry/react-native';

const SUPPORT_EMAIL = 'support@my-inner-map.com';

/** What the EXPERIENCE LEVEL row reads when the user picked "I'm in a hard
 *  place right now".
 *
 *  Sourced from the SAME LEVEL_OPTIONS entry the picker renders, never
 *  restated, so the row and the sheet cannot word the choice differently. That
 *  option stores the level 'curious', so LEVEL_LABELS would render "New to
 *  inner work" over it — the app answering someone who just said something is
 *  heavy by telling them what they said was something else.
 *
 *  `undefined` if the entry is ever removed; the row falls back to the stored
 *  level's label rather than rendering a blank title. */
const HARD_PLACE_TITLE = LEVEL_OPTIONS.find((o) => o.level === 'hard')?.title;

export default function SettingsScreen() {
  const router = useRouter();
  const level = useExperienceLevel();
  // Read alongside the level because the EXPERIENCE LEVEL row below has to
  // reflect the "hard place" choice, which is not a storable level — the same
  // flag the picker draws its selected row from.
  const choseHard = useChoseHardPlace();
  const [userId, setUserId] = useState<string>('');
  // App Lock toggle visibility is gated on biometric capability — if the
  // device has no Face ID / Touch ID the toggle is hidden entirely so we
  // never offer a setting that does nothing.
  const [bioAvailable, setBioAvailable] = useState<boolean>(false);
  const [lockOn, setLockOn] = useState<boolean>(false);
  // Global "share new journal entries with the AI" default. true = shared
  // (synced to the server for RAG); false = new entries stay on-device.
  const [journalShareOn, setJournalShareOn] = useState<boolean>(true);
  const [shorterReplies, setShorterReplies] = useState<boolean>(false);
  // Inbox notification opt-in (the ONLY notification type). Local mirror of the
  // opt-in state; the server-side gate is token presence. Off by default.
  const [notifyOn, setNotifyOn] = useState<boolean>(false);
  // Experience-level sheet (see ExperienceLevelPicker below).
  const [levelPickerOpen, setLevelPickerOpen] = useState<boolean>(false);
  // Set by the picker when the user taps "I'm in a hard place right now".
  // The navigation to the resources screen is deferred until the sheet has
  // actually closed — see the effect below.
  const resourcesPendingRef = useRef<boolean>(false);

  useEffect(() => {
    loadExperienceLevel().catch(() => {});
    loadChoseHardPlace().catch(() => {});
    // userId is consumed ONLY by the dev-only "Override device ID" row, as
    // the prefilled value of its Alert.prompt. Gated so production builds
    // don't run a SecureStore read and a setState for a row they never render.
    if (__DEV__) getUserId().then(setUserId).catch(() => {});
    getJournalShareDefault().then(setJournalShareOn).catch(() => {});
    api.getReplyLength().then((v) => setShorterReplies(v === 'shorter')).catch(() => {});
    getInboxPushOptIn().then(setNotifyOn).catch(() => {});
    (async () => {
      const ok = await biometricsAvailable();
      setBioAvailable(ok);
      if (ok) setLockOn(await isLockEnabled());
    })();
  }, []);

  // Deferred hand-off from the level sheet to the resources screen.
  //
  // Ordering matters on a support-seeking path: the picker sets the ref and
  // closes the sheet, and the push is deferred so that the visible={false}
  // commit is flushed before we navigate — pushing from inside the same render
  // pass leaves the sheet sitting over the destination on iOS.
  //
  // setTimeout(0), NOT InteractionManager.runAfterInteractions. The Modal's
  // dismissal is a NATIVE animation: it registers no interaction handle, so
  // runAfterInteractions never "waited out" anything — it fired on the next
  // batch, same as this does. What it DID add was starvation: a single
  // JS-driven looping Animated anywhere in the mounted tree keeps an
  // interaction handle open indefinitely and the callback would simply never
  // run, restoring the exact silence this path exists to end. Every
  // Animated.loop in the app happens to use useNativeDriver today; a timer
  // does not depend on that staying true.
  //
  // The ref is cleared before the push so a double-tap (or a re-render of this
  // effect) can never queue the screen twice.
  useEffect(() => {
    if (levelPickerOpen || !resourcesPendingRef.current) return;
    const t = setTimeout(() => {
      if (!resourcesPendingRef.current) return;
      resourcesPendingRef.current = false;
      router.push('/support-resources' as any);
    }, 0);
    return () => clearTimeout(t);
  }, [levelPickerOpen, router]);

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

  // Optimistic, then REVERTED if the write did not land. The whole feature
  // exists because someone asked for shorter replies and the product could
  // not hear her; a switch that shows 'on' for a preference that was never
  // stored would be the same failure with a nicer surface. Same rule the
  // prompt follows: only claim to hold it when it is actually held.
  async function toggleShorterReplies(next: boolean) {
    Haptics.selectionAsync().catch(() => {});
    setShorterReplies(next);
    const ok = await api.setReplyLength(next ? 'shorter' : 'standard');
    if (!ok) {
      setShorterReplies(!next);
      Alert.alert(
        "Couldn't save that",
        'Your preference was not stored, so nothing has changed. Check your connection and try again.',
      );
    }
  }

  async function toggleInboxNotify(next: boolean) {
    Haptics.selectionAsync().catch(() => {});
    if (next) {
      const ok = await enableInboxPush(); // OS permission ask + token register
      setNotifyOn(ok);
      if (!ok) {
        Alert.alert(
          'Notifications are off',
          'To get a quiet heads-up when something is waiting, allow notifications for Inner Map in your device settings.',
        );
      }
    } else {
      setNotifyOn(false);
      await disableInboxPush();
    }
  }

  const version = (Constants.expoConfig?.version || '1.0.0');

  function changeLevel() {
    Haptics.selectionAsync().catch(() => {});
    // Opens the bottom sheet below. Avoids a full re-run of onboarding,
    // which would also force the user back through welcome / terms / intake.
    //
    // This WAS an Alert.alert with four buttons (three levels + Cancel).
    // React Native's Android implementation does buttons.slice(0, 3)
    // (Libraries/Alert/Alert.js, RN 0.81.5) and silently discards the rest,
    // so Android users got a dialog with no Cancel button and three long
    // labels ellipsized into native buttons. The Alert also had no room for
    // the option subtitles on either platform, and no room at all for the
    // fourth LEVEL_OPTIONS entry ("I'm in a hard place right now") — which
    // made this the one post-onboarding surface where a struggling user
    // could not say so. The sheet restores all three.
    setLevelPickerOpen(true);
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
        {/* ===== IF YOU NEED HELP NOW =====
            The crisis card itself lives at the TOP of /privacy
            ("Privacy, Data & Safety") so a distressed user never has to
            scroll past a data-collection table to reach a phone number.
            This row is the discoverable pointer to it — Apple Mental
            Health & Wellness review looks for a crisis surface that is
            findable, not for the content to exist twice.

            Pinned first, above billing and account rows, because
            position IS the discoverability. Styled as an ordinary row
            on purpose: calm and available, not an alarm. */}
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            router.push('/privacy?focus=crisis' as any);
          }}
          style={styles.linkRow}
          accessibilityLabel="If you need help now — crisis resources"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>If you need help now</Text>
            <Text style={styles.rowSub}>
              Crisis lines and text services you can reach right now.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.creamFaint} />
        </Pressable>

        {/* ===== EXPERIENCE LEVEL ===== */}
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>EXPERIENCE LEVEL</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            {/* The hard-place choice wins over the stored level, exactly as it
                does inside the picker. Without this the row read "New to inner
                work" straight after the user tapped "I'm in a hard place right
                now" — the surface one level up contradicting the choice the
                sheet had just acknowledged. The subtitle stays true either way:
                this row IS what the voice is calibrated from, and the hard-place
                option calibrates it to the most-scaffolded voice. */}
            <Text style={styles.rowTitle}>
              {(choseHard && HARD_PLACE_TITLE) || LEVEL_LABELS[level] || 'Not set'}
            </Text>
            <Text style={styles.rowSub}>How the AI calibrates its voice for you.</Text>
          </View>
          <Pressable onPress={changeLevel} hitSlop={10} style={styles.linkBtn}>
            <Text style={styles.linkText}>CHANGE</Text>
          </Pressable>
        </View>

        {/* ===== YOUR PLAN ===== */}
        <YourPlanSection />

        {/* ===== ACCOUNT (Build 11) ===== */}
        <AccountSection />

        {/* ===== PRIVACY ===== */}
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>PRIVACY</Text>
        {bioAvailable ? (
          <View style={[styles.row, { marginBottom: spacing.sm }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>App Lock</Text>
              <Text style={styles.rowSub}>
                Require Face ID to open Inner Map, so no one else who picks up your phone can open it.
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
            <Text style={styles.rowTitle}>Shorter replies</Text>
            <Text style={styles.rowSub}>
              Fewer words, same care. You can also just say so in conversation —
              “keep it shorter” works, and it sticks from then on, including next
              time you open the app.
            </Text>
          </View>
          <Switch
            value={shorterReplies}
            onValueChange={toggleShorterReplies}
            trackColor={{ false: '#3A3340', true: 'rgba(230,180,122,0.45)' }}
            thumbColor={shorterReplies ? colors.amber : '#bdb6c8'}
            ios_backgroundColor="#3A3340"
          />
        </View>
        <View style={[styles.row, { marginBottom: spacing.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Share journal with AI</Text>
            <Text style={styles.rowSub}>
              New entries are shared with the AI by default — stored on our server
              so it can reference them in conversation, and occasionally suggest
              something for your map (which you always approve first). Turn off to
              keep new entries private: encrypted on your device, never sent.
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
        <View style={[styles.row, { marginBottom: spacing.sm }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Notify me when something's waiting</Text>
            <Text style={styles.rowSub}>
              A quiet heads-up when something you noticed lands in your inbox. The
              notification never shows what it is — only that something's there.
              Nothing else is ever sent.
            </Text>
          </View>
          <Switch
            value={notifyOn}
            onValueChange={toggleInboxNotify}
            trackColor={{ false: '#3A3340', true: 'rgba(230,180,122,0.45)' }}
            thumbColor={notifyOn ? colors.amber : '#bdb6c8'}
            ios_backgroundColor="#3A3340"
          />
        </View>
        {/* The "Privacy policy" row is gone: the side menu's
            "Privacy, Data & Safety" entry is the single route to
            /privacy now, and that screen carries the crisis card, the
            summary, and the data controls together. */}

        {/* ===== DEVELOPER =====
            Dev-only tools. The label lives inside the __DEV__ gate with
            the rows it heads, so production never renders a section
            heading with nothing under it. (These sat under the old YOUR
            DATA label, which moved to /privacy with the data controls.) */}
        {__DEV__ ? (
          <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>DEVELOPER</Text>
        ) : null}

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

        {/* Export My Data and Your ID now live exclusively on /privacy
            ("Privacy, Data & Safety"), together with the summary that
            explains what the data is. Single source of truth — do not
            re-add them here. Account deletion is reachable from both
            surfaces on purpose: /privacy explains it, and ACCOUNT above
            carries the entry point App Store review expects to find in
            Settings. Neither one performs the deletion. */}

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

      <ExperienceLevelPicker
        visible={levelPickerOpen}
        current={level}
        onClose={() => setLevelPickerOpen(false)}
        onRequestResources={() => { resourcesPendingRef.current = true; }}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// ExperienceLevelPicker — bottom sheet, ported back from the hamburger menu
// (components/HamburgerMenu.tsx at d9d2427) when that copy was deleted and
// Settings became the only post-onboarding route to this control.
//
// Renders all four LEVEL_OPTIONS with title AND subtitle. Matches the
// spectrum / part-folder modal grammar.
//
// The 4th option ("I'm in a hard place right now"), founder ruling 2026-08-04:
//
//   1. It still stores 'curious' — the most-scaffolded voice — and 'hard' is
//      still never persisted as a level or sent to the server.
//   2. It now ROUTES to the same resources screen onboarding shows
//      (/support-resources → components/safety/SupportResourcesScreen). The
//      previous behaviour ("the user already saw it once") failed anyone who
//      picked another option during onboarding and only later ended up in a
//      hard place — the subtitle promises real-person resources and none
//      arrived. The push is handed to the parent so it happens AFTER this
//      sheet is dismissed.
//   3. It IS now drawn as selected, off the separate local choseHardPlace
//      flag rather than off the stored level. When that flag is set, 'curious'
//      must NOT also render as current or two rows would look selected.
// =============================================================================
function ExperienceLevelPicker({
  visible, current, onClose, onRequestResources,
}: {
  visible: boolean;
  current: ExperienceLevel;
  onClose: () => void;
  /** Called (before onClose) when the user picks "I'm in a hard place right
   *  now". The parent owns the navigation so it can wait for this Modal to
   *  finish dismissing first. */
  onRequestResources: () => void;
}) {
  const choseHard = useChoseHardPlace();
  // One pick per opening. Without this, a fast double-tap runs the async
  // handler twice and can queue the resources screen twice.
  const pickedRef = useRef<boolean>(false);
  useEffect(() => { if (visible) pickedRef.current = false; }, [visible]);
  // The sheet is anchored at bottom:0, so it sits UNDER the gesture bar /
  // 3-button nav bar. The inset goes on the sheet container (not on the
  // ScrollView's contentContainer) so it ADDS to the scroll body's own
  // paddingBottom: 24 rather than replacing it — the 4th option ("in a hard
  // place") keeps its full 24px of breathing room above the nav strip on
  // every device.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.pickerBackdrop} onPress={onClose} />
      <View style={[styles.pickerSheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.pickerHandle} />
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Where are you in your journey?</Text>
          <Pressable onPress={onClose} style={{ padding: 6 }} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>
        <Text style={styles.pickerBody}>
          You can change this anytime — the new setting applies to your next reply.
        </Text>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {LEVEL_OPTIONS.map((opt) => {
            const isHard = opt.level === 'hard';
            // Selected state: the hard option draws off the local flag, and
            // the three real levels only draw as current when that flag is
            // clear — otherwise 'curious' (what "hard" stores) would light up
            // alongside it.
            const isCurrent = isHard ? choseHard : (!choseHard && opt.level === current);
            return (
              <Pressable
                key={opt.level}
                onPress={() => {
                  if (pickedRef.current) return;
                  pickedRef.current = true;
                  Haptics.selectionAsync().catch(() => {});
                  // "Hard place" stores 'curious' — the wire payload is
                  // identical to picking the first option — and records the
                  // real choice in the separate local flag. Passing isHard on
                  // every branch means any other pick CLEARS the flag, so the
                  // sheet can never show two selected rows.
                  const nextLevel: ExperienceLevel =
                    isHard ? 'curious' : (opt.level as ExperienceLevel);
                  // CLOSE FIRST, PERSIST AFTER — deliberate ordering.
                  //
                  // Ask for the resources screen BEFORE closing: the parent
                  // reads the request when the sheet's visible flag flips.
                  if (isHard) onRequestResources();
                  onClose();
                  // The two writes are fire-and-forget. Awaiting them gated the
                  // close on two AsyncStorage round trips, and an AsyncStorage
                  // stall is an OBSERVED failure in this app — app/_layout.tsx
                  // races the boot read against a 3s timeout for exactly that
                  // reason. A stall here left the sheet sitting open with
                  // pickedRef already latched, so every further tap was a
                  // no-op: silence, on the path built to end silence.
                  //
                  // Nothing downstream reads these synchronously, and nothing
                  // visible is lost by deferring them: both helpers update their
                  // in-memory copy and notify listeners SYNCHRONOUSLY, before
                  // touching AsyncStorage — so the selected row here, the
                  // EXPERIENCE LEVEL row behind the sheet, and the level sent on
                  // the next /api/chat request are all already correct. Only the
                  // disk write is deferred. Both helpers also swallow their own
                  // storage errors; the .catch is belt and braces so a future
                  // change there can never surface as an unhandled rejection.
                  setExperienceLevel(nextLevel).catch(() => {});
                  setChoseHardPlace(isHard).catch(() => {});
                }}
                style={[styles.pickerOption, isCurrent && styles.pickerOptionSelected]}
              >
                <Text style={[styles.pickerOptionTitle, isCurrent && { color: colors.amber }]}>
                  {opt.title}
                </Text>
                <Text style={styles.pickerOptionSubtitle}>{opt.subtitle}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
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

  // Experience-level picker — bottom sheet, ported back from the deleted
  // hamburger copy. NOTE: paddingBottom is applied at runtime from
  // insets.bottom (see ExperienceLevelPicker) — don't add a static one here.
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  pickerSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '80%',
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8,
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 42, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: 8,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingBottom: 8,
  },
  pickerTitle: { color: colors.amber, fontSize: 18, fontWeight: '600', flex: 1, marginRight: 8 },
  pickerBody: {
    color: colors.creamDim, fontSize: 13, lineHeight: 19,
    paddingHorizontal: 24, paddingBottom: 16,
  },
  pickerOption: {
    backgroundColor: colors.background,
    borderColor: colors.border, borderWidth: 1, borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  pickerOptionSelected: {
    borderColor: colors.amber,
    backgroundColor: 'rgba(230,180,122,0.08)',
  },
  pickerOptionTitle: { color: colors.cream, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  pickerOptionSubtitle: { color: colors.creamDim, fontSize: 12, lineHeight: 17 },

  version: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xxl,
    letterSpacing: 0.4,
  },
  // (Former accountRow* / crisis* / privacy* styles dropped with the
  // components they dressed — the crisis card, the privacy explainer and
  // the data controls all live on /privacy now, which owns its own
  // styling.)
});

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
//
// Below both states, in every state: the "Delete account" row (see there).
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

  // Entry point ONLY. app/account/delete.tsx owns the irreversible-action
  // confirmation — nothing is pre-confirmed, warned about or short-circuited
  // here. Same push (and same haptic) app/privacy.tsx uses for its
  // "DELETE MY ACCOUNT" control, so the two entrances land identically.
  const handleDelete = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    router.push('/account/delete' as any);
  }, [router]);

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

  // Account deletion's entry point.
  //
  // NOT the duplicate that was removed in today's IA pass — that one was a
  // second "Privacy policy" row pointing where the side menu already points,
  // i.e. two doors to the same explanation. This is a differently-purposed
  // row: App Store guideline 5.1.1(v) requires deletion to be DISCOVERABLE,
  // and both users and reviewers look for it in Settings under Account, not
  // inside a privacy explainer. Please don't de-duplicate it away.
  //
  // Deliberately an ordinary row: findable, not shouty. The destructive
  // styling and the confirmation both live on /account/delete, where the
  // destructive action actually happens.
  //
  // Rendered in EVERY state of this section, loading included — a slow or
  // failed identities call must not be able to hide the deletion path.
  const deleteRow = (
    <Pressable
      onPress={handleDelete}
      style={[styles.linkRow, { marginTop: spacing.md }]}
      accessibilityRole="button"
      accessibilityLabel="Delete account"
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>Delete account</Text>
        <Text style={styles.rowSub}>
          Permanently delete your account and your data.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.creamFaint} />
    </Pressable>
  );

  if (loading) {
    return (
      <>
        <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>ACCOUNT</Text>
        <View style={styles.row}>
          <Text style={styles.rowSub}>Loading…</Text>
        </View>
        {deleteRow}
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
      {deleteRow}
    </>
  );
}

// =============================================================================
// YourPlanSection — the purchase entry point. iOS ONLY: the entire section,
// label included, is absent on Android until Play billing exists (see the gate
// in the component body).
//
// Three rows:
//   1. Membership        → /paywall, EXCEPT for an entitled user (active or
//                          trialing), who is routed to Apple's subscription
//                          management instead — we do not offer a subscription
//                          to someone who already has one. Same helper as row
//                          3; entitlement unknown falls through to the paywall.
//                          Subtitle is LIVE, derived from the
//                          SERVER's billing status (api.getBillingStatus),
//                          which is the authority on entitlement — never the
//                          client-side RevenueCat read. No subtitle at all
//                          when that read fails; see planSubtitle.
//   2. Restore purchases → RevenueCat restorePurchases(). Alerts on every
//                          outcome, and always stops spinning — but only while
//                          still mounted; the call can outlive the screen.
//   3. Manage subscription → Apple's subscription management page.
//
// Row 3 exists because the paywall's disclosure line says "Cancel anytime in
// Settings…". Users read that as THIS Settings screen and come looking here.
// Without this row that sentence is a dead end.
//
// COPY RULE: capabilities only, never volume. No message counts, no "N left",
// no "unlimited" — the server enforces a spend cap that no fixed number can
// honestly describe, so any quantity here would be a claim we can't back.
// =============================================================================

// Apple's canonical subscription-management destination. The itms-apps scheme
// jumps straight into the App Store app; the https form is the same
// Apple-hosted page and is used as the fallback when the scheme is
// unavailable (e.g. Simulator, where no App Store app is installed).
const APPLE_SUBSCRIPTIONS_URL = 'itms-apps://apps.apple.com/account/subscriptions';
const APPLE_SUBSCRIPTIONS_URL_WEB = 'https://apps.apple.com/account/subscriptions';

/** The ONE way this app sends a user to subscription management.
 *
 *  Lifted out of the Manage row's handler when the Membership row started
 *  needing it too (an entitled user is routed to management instead of the
 *  paywall — see handleMembership). Two rows, one mechanism: the scheme, the
 *  web fallback, and the "we couldn't open it" copy cannot drift between them.
 *  Module-level and state-free on purpose, so it is not tangled in hook order. */
async function openAppleSubscriptions(): Promise<void> {
  try {
    await Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
  } catch {
    // No App Store app (Simulator) — fall back to the web page, and if even
    // that fails, say so rather than silently doing nothing.
    try {
      await Linking.openURL(APPLE_SUBSCRIPTIONS_URL_WEB);
    } catch (e) {
      console.warn('[settings/manage-sub] threw:', (e as Error)?.message);
      Alert.alert(
        "Couldn't open the App Store",
        'Open the Settings app on your device, tap your name, then Subscriptions.',
      );
    }
  }
}

/** "August 12" — or null when the timestamp is missing or unparseable, so
 *  every caller has to decide what to render without a date. */
function formatPlanDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/** Map the server's billing state to one line of user-facing copy, or null
 *  when there is nothing we can honestly say.
 *
 *  `null` status means UNKNOWN — getBillingStatus returns null on ANY failure
 *  (transport, non-OK, malformed body), which is a different state from "the
 *  server told us there is no subscription". Collapsing the two showed an
 *  ACTIVE subscriber on a flaky connection the line "Not subscribed." directly
 *  above a row that pushes a paywall. So: no subtitle at all when we could not
 *  ask. The row still has its title and chevron and reads fine bare — absence
 *  is the honest rendering, and inventing a second claim ("status
 *  unavailable") would just be a different assertion. */
function planSubtitle(status: BillingStatus | null): string | null {
  if (!status) return null;
  switch (status.state) {
    case 'trialing': {
      const d = formatPlanDate(status.trialEnd);
      return d ? `Free trial — ends ${d}.` : 'Free trial.';
    }
    // `active_capped` is still an ACTIVE membership server-side — the period's
    // spend pool is used up, which the chat surface communicates in context.
    // Describing it here would require a volume claim, so it reads as active.
    case 'active':
    case 'active_capped': {
      const d = formatPlanDate(status.periodEnd);
      // willRenew false = the user already cancelled; it runs out, it does not
      // renew. Saying "renews" to someone who just cancelled is wrong, and
      // this row is exactly where a cancelling user lands.
      const verb = status.willRenew ? 'renews' : 'ends';
      return d ? `Active — ${verb} ${d}.` : 'Active.';
    }
    case 'grace':
      return 'Payment issue — renewal pending.';
    case 'frozen':
      return 'Paused.';
    case 'none':
      return 'Not subscribed.';
    default:
      // A successful read of a state this build doesn't know about (a server
      // that shipped ahead of the app). Unrecognized is not "not subscribed" —
      // same reasoning as the null case above: say nothing.
      return null;
  }
}

function YourPlanSection() {
  const router = useRouter();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [restoring, setRestoring] = useState(false);

  // Unmount guard. The status read can outlive this screen (the user backs out
  // of Settings while the GET is open), and refreshStatus is shared by three
  // call sites, so the guard lives with the fetch rather than in any one
  // caller's effect cleanup.
  // Re-armed on mount (not just cleared on unmount) so a remount — Fast
  // Refresh, or a future StrictMode double-invoke — can't leave it latched
  // false and silently swallow every later setState.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // One-flight coalescing. refreshStatus now fires from mount, from every
  // focus, and from the Restore handler — a call that arrives while a request
  // is still open JOINS that request instead of racing a duplicate GET whose
  // response could land out of order and overwrite the newer answer.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refreshStatus = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const p = (async () => {
      try {
        // getBillingStatus never throws — it returns null on any failure — but
        // the try/finally guarantees the "Loading…" line always resolves.
        const next = await api.getBillingStatus();
        if (mountedRef.current) setStatus(next);
      } finally {
        if (mountedRef.current) setLoadingStatus(false);
      }
    })();
    inFlightRef.current = p;
    // Release the slot however p settles. An async IIFE always returns a
    // promise, so this handler can never run before the assignment above; the
    // two-arg form means a rejection can't surface as an unhandled rejection
    // from this bookkeeping chain (p itself still rejects to its callers).
    p.then(
      () => { inFlightRef.current = null; },
      () => { inFlightRef.current = null; },
    );
    return p;
  }, []);

  // LOAD-TIME read — defensive baseline for the case where this screen is
  // mounted without gaining focus.
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // FOCUS re-read. /paywall is router.push'ed ON TOP of Settings (see
  // handleMembership below) and its success paths just call router.back(), so
  // Settings never unmounts and a mount-only read left the Membership subtitle
  // reading "Not subscribed." after a completed purchase or restore. Worse,
  // the local Restore button DID call refreshStatus, so restoring from here
  // updated the row and restoring from the paywall didn't — an inconsistency
  // that reads as a broken purchase rather than a stale label. The server is
  // the authority on entitlement, so re-read it every time we come back.
  useFocusEffect(
    useCallback(() => { refreshStatus(); }, [refreshStatus]),
  );

  // Server-confirmed entitlement. `status` is null while loading AND on any
  // failed read (getBillingStatus returns null on transport/non-OK/malformed),
  // so this is false unless the server affirmatively said yes — the same
  // pessimism planSubtitle applies to the copy, applied to the routing.
  const entitled = !!status?.entitlementActive;

  const handleMembership = useCallback(() => {
    // ROUTE BY STATE. An active or trialing member must not be handed a
    // Subscribe CTA for the subscription they already hold — StoreKit catches
    // it with its own "already subscribed" sheet, but that is a seam, not a
    // destination. Settings already knows the state (the subtitle on this very
    // row reads "Active — renews …"), so it routes to management instead,
    // through the SAME helper the Manage subscription row below uses.
    //
    // When entitlement is unknown — read still in flight, or it failed — this
    // falls through to the paywall. That is the deliberate direction: a
    // billing outage must never lock a non-subscriber out of subscribing, and
    // the paywall carries its own entitlement guard for the subscriber case.
    if (entitled) {
      Haptics.selectionAsync().catch(() => {});
      openAppleSubscriptions();
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    router.push('/paywall' as any);
  }, [entitled, router]);

  const handleRestore = useCallback(async () => {
    if (restoring) return;
    Haptics.selectionAsync().catch(() => {});
    setRestoring(true);
    try {
      const result = await restorePurchases();
      // The RevenueCat round trip takes seconds on a cold SDK or a bad
      // network, which is long enough for the user to back out of Settings.
      // Without this bail the alert lands on top of whatever screen they went
      // to, and setRestoring warns on an unmounted component. Same guard the
      // paywall's restore handler already uses (app/paywall.tsx).
      if (!mountedRef.current) return;
      if (!result.ok) {
        Alert.alert(
          "Couldn't restore",
          result.message || 'Something went wrong. Please try again.',
        );
        return;
      }
      if (result.hasEntitlement) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert(
          'Membership restored',
          'Your membership is active on this device again.',
        );
        // The server is the authority — re-read it so the Membership row
        // reflects the restored state without needing a screen reload.
        await refreshStatus();
      } else {
        Alert.alert(
          'Nothing to restore',
          "We didn't find a membership on this Apple Account. If you subscribed with a different Apple Account, sign in to that one and try again.",
        );
      }
    } catch (e) {
      // Defensive: restore() catches internally, but an unexpected throw must
      // still surface and must still clear the spinner.
      console.warn('[settings/restore] threw:', (e as Error)?.message);
      // Log unconditionally, alert only while we're still on screen.
      if (!mountedRef.current) return;
      Alert.alert("Couldn't restore", (e as Error)?.message || 'Unknown error');
    } finally {
      if (mountedRef.current) setRestoring(false);
    }
  }, [restoring, refreshStatus]);

  const handleManage = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    await openAppleSubscriptions();
  }, []);

  const isIOS = Platform.OS === 'ios';

  // WHOLE-SECTION iOS GATE. configurePurchases() returns early on non-iOS
  // without marking itself configured (services/purchases.ts), so every
  // purchase path returns null/failure on Android: Membership opens a paywall
  // that can never load an offering, and Restore always ends in "Couldn't
  // restore." Hiding row 3 alone left the two rows that fail in the user's
  // face. Returning null here (after all hooks, so hook order is stable) drops
  // the amber YOUR PLAN label with the rows — no empty header.
  //
  // REMOVE THIS GATE when the Play Store billing key lands and
  // configurePurchases() configures on Android; then restore the per-row
  // `isIOS` check on Manage subscription, which is Apple-specific for good.
  if (!isIOS) return null;

  // Nothing to say is better than saying the wrong thing: null subtitle =
  // the status read failed, so we render the row bare (see planSubtitle).
  const subtitle = loadingStatus ? 'Loading…' : planSubtitle(status);

  return (
    <>
      <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>YOUR PLAN</Text>

      <Pressable
        onPress={handleMembership}
        style={[styles.linkRow, { marginBottom: spacing.sm }]}
        accessibilityLabel={entitled ? 'Membership — manage subscription' : 'Membership'}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Membership</Text>
          {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.creamFaint} />
      </Pressable>

      <Pressable
        onPress={handleRestore}
        disabled={restoring}
        style={[styles.linkRow, { marginBottom: spacing.sm }]}
        accessibilityLabel="Restore purchases"
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Restore purchases</Text>
          <Text style={styles.rowSub}>
            Already subscribed on another device? Bring it over.
          </Text>
        </View>
        {restoring ? (
          <ActivityIndicator size="small" color={colors.creamFaint} style={{ width: 18 }} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.creamFaint} />
        )}
      </Pressable>

      <Pressable
        onPress={handleManage}
        style={styles.linkRow}
        accessibilityLabel="Manage subscription"
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Manage subscription</Text>
          <Text style={styles.rowSub}>Change or cancel in your Apple Account.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.creamFaint} />
      </Pressable>
    </>
  );
}
