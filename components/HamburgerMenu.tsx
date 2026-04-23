// Full-height slide-in drawer triggered by the hamburger icon in the top bar.
//
// Sections (matches web app's side menu):
//   1. Header — user name + small edit button (edit routes to intake)
//   2. Settings — Audio on/off, Notifications on/off (both local-device toggles
//      stored via services/settings.ts)
//   3. About Inner Map → Guide tab
//   4. Send feedback → opens mail link
//   5. Privacy policy → opens URL
//   6. Reset onboarding — long-press (500 ms) so it isn't accidentally tapped
//   7. Version number in dim text at the bottom

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, Switch, StyleSheet,
  Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { colors, radii, spacing } from '../constants/theme';
import { api } from '../services/api';
import { getSettings, setAudioEnabled, setPushEnabled } from '../services/settings';
import { resetOnboarding } from '../services/onboarding';

const PRIVACY_URL  = 'https://inner-map-production.up.railway.app/privacy';
const FEEDBACK_TO  = 'hello@innermap.app';

export function HamburgerMenu({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const [pushOn, setPushOn]   = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const [intake, settings] = await Promise.all([
        api.getIntake(),
        getSettings(),
      ]);
      setName(intake?.name?.trim() || null);
      setAudioOn(settings.audioEnabled);
      setPushOn(settings.pushEnabled);
    })();
  }, [visible]);

  function go(path: string) {
    Haptics.selectionAsync().catch(() => {});
    onClose();
    // Brief delay so the close animation doesn't fight the push.
    setTimeout(() => router.push(path as any), 120);
  }

  async function toggleAudio(v: boolean) {
    Haptics.selectionAsync().catch(() => {});
    setAudioOn(v);
    await setAudioEnabled(v);
  }
  async function togglePush(v: boolean) {
    Haptics.selectionAsync().catch(() => {});
    setPushOn(v);
    await setPushEnabled(v);
  }

  function doReset() {
    Alert.alert(
      'Reset onboarding?',
      'This erases your local onboarding flags so the intake flow runs again on next launch. Sessions on the server are untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset', style: 'destructive',
          onPress: async () => {
            await resetOnboarding();
            onClose();
            router.replace('/onboarding');
          },
        },
      ],
    );
  }

  const version = (Constants.expoConfig?.version || '1.0.0');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView style={styles.drawer} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <Text style={styles.heyName}>
            {name ? `Hey ${name}` : 'Menu'}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close menu">
            <Ionicons name="close" size={22} color={colors.creamDim} />
          </Pressable>
        </View>

        {/* ===== SETTINGS ===== */}
        <SectionLabel>SETTINGS</SectionLabel>
        <Row
          label="Audio"
          sub="Speak replies aloud"
          right={
            <Switch
              value={audioOn}
              onValueChange={toggleAudio}
              trackColor={{ false: colors.border, true: colors.amberDim }}
              thumbColor={audioOn ? colors.amber : colors.creamFaint}
            />
          }
        />
        <Row
          label="Notifications"
          sub="Gentle check-ins + session reminders"
          right={
            <Switch
              value={pushOn}
              onValueChange={togglePush}
              trackColor={{ false: colors.border, true: colors.amberDim }}
              thumbColor={pushOn ? colors.amber : colors.creamFaint}
            />
          }
        />

        {/* ===== LINKS ===== */}
        <SectionLabel>ABOUT</SectionLabel>
        <LinkRow
          label="About Inner Map"
          onPress={() => go('/guide')}
          icon="book-outline"
        />
        <LinkRow
          label="Send feedback"
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            Linking.openURL(`mailto:${FEEDBACK_TO}?subject=Inner%20Map%20feedback`).catch(() => {});
          }}
          icon="mail-outline"
        />
        <LinkRow
          label="Privacy policy"
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            Linking.openURL(PRIVACY_URL).catch(() => {});
          }}
          icon="shield-checkmark-outline"
        />

        <View style={{ flex: 1 }} />

        {/* ===== RESET + VERSION ===== */}
        <Pressable
          onLongPress={doReset}
          delayLongPress={500}
          style={styles.resetRow}
          accessibilityLabel="Reset onboarding (long press)"
        >
          <Text style={styles.resetText}>Reset onboarding</Text>
          <Text style={styles.resetHint}>long press</Text>
        </Pressable>
        <Text style={styles.version}>Inner Map · v{version}</Text>
      </SafeAreaView>
    </Modal>
  );
}

// ---------- reusable bits ----------
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}
function Row({ label, sub, right }: { label: string; sub?: string; right: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}
function LinkRow({
  label, onPress, icon,
}: { label: string; onPress: () => void; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={18} color={colors.amber} style={{ marginRight: 12 }} />
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Ionicons name="chevron-forward" size={16} color={colors.creamFaint} />
    </Pressable>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  drawer: {
    width: '82%',
    maxWidth: 420,
    height: '100%',
    backgroundColor: '#0d0d13',
    borderRightColor: colors.border,
    borderRightWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.lg,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    marginBottom: spacing.md,
  },
  heyName: {
    color: colors.amber,
    fontSize: 20,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  sectionLabel: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  rowLabel: { color: colors.cream, fontSize: 15 },
  rowSub: { color: colors.creamFaint, fontSize: 12, marginTop: 2 },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },

  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginTop: spacing.md,
  },
  resetText: { color: colors.creamFaint, fontSize: 12 },
  resetHint: { color: colors.creamFaint, fontSize: 10, fontStyle: 'italic' },

  version: {
    color: colors.creamFaint,
    fontSize: 10,
    textAlign: 'center',
    opacity: 0.5,
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
});
