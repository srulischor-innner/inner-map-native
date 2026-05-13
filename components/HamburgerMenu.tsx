// Full-height slide-in drawer triggered by the hamburger icon in the top bar.
//
// Sections (matches web app's side menu):
//   1. Header — user name + close button
//   2. Recent Sessions — last 8 sessions from /api/sessions, each with date,
//      AI-generated title, most-active-part colored dot. Tap opens the
//      shared SessionDetailModal.
//   3. Settings — Audio + Notifications toggles
//   4. About / Feedback / Privacy links
//   5. Reset onboarding (long-press) + version number

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, Switch, ScrollView, StyleSheet,
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
import {
  useExperienceLevel, setExperienceLevel,
  LEVEL_OPTIONS, LEVEL_LABELS, ExperienceLevel,
} from '../services/experienceLevel';
import { resetOnboarding } from '../services/onboarding';
import { PART_COLOR } from '../utils/markers';
import { SessionDetailModal } from './session/SessionDetailModal';

const FEEDBACK_TO  = 'support@my-inner-map.com';

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
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const [intake, settings, sessionList] = await Promise.all([
        api.getIntake(),
        getSettings(),
        api.listSessions(),
      ]);
      setName(intake?.name?.trim() || null);
      setAudioOn(settings.audioEnabled);
      setPushOn(settings.pushEnabled);
      setSessions((sessionList || []).slice(0, 8));
    })();
  }, [visible]);

  function openSession(id: string) {
    Haptics.selectionAsync().catch(() => {});
    setSelectedSessionId(id);
  }

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

        {/* The middle section scrolls — the reset row + version below the
            ScrollView stay pinned to the bottom regardless of content length. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: spacing.md }}
          showsVerticalScrollIndicator={false}
        >

        {/* ===== RECENT SESSIONS ===== */}
        <SectionLabel>RECENT SESSIONS</SectionLabel>
        {sessions.length === 0 ? (
          <Text style={styles.emptySessions}>
            Your conversations will appear here after your first session.
          </Text>
        ) : (
          <View>
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                date={s.date}
                title={s.title || s.preview}
                mostActivePart={s.mostActivePart}
                chatMode={s.chatMode}
                onPress={() => openSession(s.id)}
              />
            ))}
          </View>
        )}

        <View style={styles.divider} />

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
        <ExperienceLevelRow />


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
          label="Settings"
          onPress={() => go('/settings')}
          icon="settings-outline"
        />
        <LinkRow
          label="Privacy policy"
          onPress={() => go('/privacy')}
          icon="shield-checkmark-outline"
        />
        </ScrollView>

        {/* ===== RESET + VERSION (pinned) ===== */}
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

      {/* Session transcript modal — shared with Journey tab. */}
      <SessionDetailModal
        visible={!!selectedSessionId}
        sessionId={selectedSessionId}
        onClose={() => setSelectedSessionId(null)}
      />
    </Modal>
  );
}

// ---------- session row ----------
function SessionRow({
  date, title, mostActivePart, chatMode, onPress,
}: {
  date?: string;
  title?: string;
  mostActivePart?: string | null;
  /** Mode the session was ended in. NULL for legacy rows that
   *  predate the column on the server — the row hides the label
   *  in that case so older history doesn't grow a misleading tag. */
  chatMode?: 'process' | 'explore' | null;
  onPress: () => void;
}) {
  const dotColor = mostActivePart ? (PART_COLOR[mostActivePart] || colors.amber) : 'rgba(255,255,255,0.2)';
  const showMode = chatMode === 'process' || chatMode === 'explore';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.sessionRow, pressed && { opacity: 0.65 }]}>
      <View style={[styles.sessionDot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.sessionHeaderRow}>
          <Text style={styles.sessionDate}>{formatShortDate(date)}</Text>
          {showMode ? (
            <Text
              style={[
                styles.sessionMode,
                chatMode === 'explore'
                  ? styles.sessionModeExplore
                  : styles.sessionModeProcess,
              ]}
            >
              {chatMode === 'explore' ? 'Explore' : 'Process'}
            </Text>
          ) : null}
        </View>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {title?.trim() || 'Untitled session'}
        </Text>
      </View>
    </Pressable>
  );
}

function formatShortDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${months[mi]} ${parseInt(d, 10)}`;
}

// ---------- experience-level row + picker ----------
function ExperienceLevelRow() {
  const level = useExperienceLevel();
  const [picking, setPicking] = useState(false);
  return (
    <>
      <Pressable onPress={() => setPicking(true)} style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Your experience level</Text>
          <Text style={styles.rowSub}>{LEVEL_LABELS[level]}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.creamFaint} />
      </Pressable>
      <ExperienceLevelPicker
        visible={picking}
        current={level}
        onClose={() => setPicking(false)}
      />
    </>
  );
}

function ExperienceLevelPicker({
  visible, current, onClose,
}: { visible: boolean; current: ExperienceLevel; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.pickerBackdrop} onPress={onClose} />
      <View style={styles.pickerSheet}>
        <View style={styles.pickerHandle} />
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Where are you in your journey?</Text>
          <Pressable onPress={onClose} style={{ padding: 6 }} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>
        <Text style={styles.pickerBody}>
          You can change this anytime — the new setting applies to your next reply.
        </Text>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {LEVEL_OPTIONS.map((opt) => {
            const isHard = opt.level === 'hard';
            const isCurrent = !isHard && opt.level === current;
            return (
              <Pressable
                key={opt.level}
                onPress={async () => {
                  Haptics.selectionAsync().catch(() => {});
                  // The 4th option ("hard place") sets level to curious;
                  // doesn't re-trigger the resources screen from settings —
                  // the user already saw it once if they picked it then.
                  await setExperienceLevel(isHard ? 'curious' : (opt.level as ExperienceLevel));
                  onClose();
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

  // Experience-level picker — bottom sheet, matches the spectrum / part-
  // folder modal grammar.
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

  emptySessions: {
    color: colors.creamFaint,
    fontStyle: 'italic',
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 6,
  },

  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  sessionDot: {
    width: 8, height: 8, borderRadius: 4,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3,
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sessionDate: {
    color: colors.creamFaint,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  // Muted-gold mode label per the spec — Process is the gentler
  // default (dimmer); Explore is the active mode (brighter). Sits
  // on the right side of the date row, hidden when chatMode is
  // null (legacy rows predating the column).
  sessionMode: {
    fontSize: 10,
    letterSpacing: 0.5,
    fontStyle: 'italic',
    fontFamily: 'CormorantGaramond_400Regular_Italic',
  },
  sessionModeProcess: {
    color: 'rgba(230,180,122,0.55)',
  },
  sessionModeExplore: {
    color: '#E6B47A',
  },
  sessionTitle: { color: colors.cream, fontSize: 14, marginTop: 2 },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
});
