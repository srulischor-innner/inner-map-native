// Full-height slide-in drawer triggered by the hamburger icon in the top bar.
//
// Sections (matches web app's side menu):
//   1. Header — user name + close button
//   2. Recent Sessions — last 8 sessions from /api/sessions, each with date,
//      AI-generated title, most-active-part colored dot. Tap opens the
//      shared SessionDetailModal.
//   3. About / Feedback / Settings / Privacy, Data & Safety links
//   4. Reset onboarding (long-press) + version number
//
// The experience-level row and its picker used to live here too. They were
// drift: Settings has always owned that control, and its copy explains what
// the setting DOES ("How the AI calibrates its voice for you") where this
// one only showed the current value. One control, one place — the Settings
// link below is the route to it.

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
  Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { colors, spacing } from '../constants/theme';
import { api, RelationshipSession } from '../services/api';
import { resetOnboarding } from '../services/onboarding';
import { subscribeInbox, refreshInboxStatus } from '../services/messagesInbox';
import { PART_COLOR } from '../utils/markers';
import { continuedLabel } from '../utils/sessionDisplay';
import { SessionDetailModal } from './session/SessionDetailModal';
import { RelationshipSessionSummaryModal } from './relationships/RelationshipSessionSummaryModal';
import { MODE_LABEL, type WorkingMode } from './WorkingModeControl';

const FEEDBACK_TO  = 'support@my-inner-map.com';

export function HamburgerMenu({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // Partner-session summary modal state — opened when the user taps a
  // recent session whose id starts with `relsession::` (real
  // relationship_sessions row). We fetch the full session detail and
  // pass it into RelationshipSessionSummaryModal in read-only mode so
  // the user can re-read the summary + practices any time.
  // selectedRelSession holds the resolved row; selectedRelMeta tracks
  // the partnerName + relationshipId so practice cards can still
  // "Send to {partner}" + "Forward" from a past session.
  const [selectedRelSession, setSelectedRelSession] = useState<RelationshipSession | null>(null);
  const [selectedRelMeta, setSelectedRelMeta] =
    useState<{ relationshipId: string; partnerName: string | null } | null>(null);
  const [relSummaryFailed, setRelSummaryFailed] = useState(false);
  // Messages-inbox "items waiting" count — quiet badge on the Messages row.
  // Tracks UN-ACTED noticed items (persist until accepted/declined), not just
  // unread, so the badge clears only when the user actually handles them.
  // Refreshed each time the menu opens (the GET also runs the sweep).
  const [inboxWaiting, setInboxWaiting] = useState(0);
  useEffect(() => subscribeInbox((s) => setInboxWaiting(s.unactedCount)), []);
  const router = useRouter();

  useEffect(() => {
    if (!visible) return;
    refreshInboxStatus().catch(() => {});
    (async () => {
      const [intake, sessionList] = await Promise.all([
        api.getIntake(),
        api.listSessions(),
      ]);
      setName(intake?.name?.trim() || null);
      setSessions((sessionList || []).slice(0, 8));
    })();
  }, [visible]);

  function openSession(id: string, row?: any) {
    Haptics.selectionAsync().catch(() => {});
    // Partner sessions (real relationship_sessions rows) carry the
    // `relsession::<uuid>` prefix — fetch + open the summary modal
    // instead of the regular SessionDetailModal (which expects a
    // /api/sessions row). Legacy `partner::` day-bucket ids still
    // route through SessionDetailModal so pre-PR partner history
    // remains viewable.
    if (id.startsWith('relsession::')) {
      const realId = id.slice('relsession::'.length);
      setSelectedRelMeta({
        relationshipId: row?.relationshipId || '',
        partnerName: row?.partnerName || null,
      });
      setSelectedRelSession(null);
      setRelSummaryFailed(false);
      (async () => {
        const session = await api.getRelationshipSession(realId);
        if (session) setSelectedRelSession(session);
        else setRelSummaryFailed(true);
      })();
      return;
    }
    setSelectedSessionId(id);
  }

  function go(path: string) {
    Haptics.selectionAsync().catch(() => {});
    onClose();
    // Brief delay so the close animation doesn't fight the push.
    setTimeout(() => router.push(path as any), 120);
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
          {/* Full greeting: prior version was truncating to "Hey Y" because
              the parent's space-between layout gave heyName whatever space
              remained after the close button. flex:1 + numberOfLines=1 +
              flexShrink lets the text take the full available width and
              degrade with ellipsis only on absurdly long names. */}
          <Text style={styles.heyName} numberOfLines={1} ellipsizeMode="tail">
            {name ? `Hey ${name}` : 'Menu'}
          </Text>
          {/* X close — moved 6px down from the top edge via the
              styles.closeBtn paddingTop so a thumb landing near the
              status bar / notch doesn't fight the safe-area inset.
              hitSlop expanded from 10 → 16 for the same reason. */}
          <Pressable
            onPress={onClose}
            hitSlop={16}
            accessibilityLabel="Close menu"
            style={styles.closeBtn}
          >
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
                updatedAt={s.updatedAt}
                title={s.title || s.preview}
                mostActivePart={s.mostActivePart}
                chatMode={s.chatMode}
                onPress={() => openSession(s.id, s)}
              />
            ))}
          </View>
        )}

        <View style={styles.divider} />

        {/* ===== LINKS ===== */}
        <SectionLabel>ABOUT</SectionLabel>
        <LinkRow
          label="About Inner Map"
          onPress={() => go('/guide')}
          icon="book-outline"
        />
        <LinkRow
          label="Messages"
          onPress={() => go('/messages')}
          icon="file-tray-outline"
          badge={inboxWaiting}
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
        {/* The sub-line is load-bearing, not decoration: "Safety" sitting
            next to "Privacy" and "Data" reads as DATA safety. The second
            line is what tells a user in distress that help lives behind
            this row. Do not drop it to tidy the menu. */}
        <LinkRow
          label="Privacy, Data & Safety"
          sub="Your data, your controls, and where to get help right now."
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

      {/* Session transcript modal — shared with Journey tab. Used
          for regular Process/Explore sessions AND the legacy
          `partner::` day-bucket ids (pre-PR partner-chat history). */}
      <SessionDetailModal
        visible={!!selectedSessionId}
        sessionId={selectedSessionId}
        onClose={() => setSelectedSessionId(null)}
      />

      {/* Partner-session summary modal (read-only). Opened when the
          user taps a recent session whose id starts with
          `relsession::` — a real relationship_sessions row from the
          post-PR per-partner session-bracketing model. The "Begin
          New Session" button is repurposed as "Done" via onContinue,
          which just closes the modal without minting a new session. */}
      <RelationshipSessionSummaryModal
        visible={!!selectedRelMeta}
        session={selectedRelSession}
        failed={relSummaryFailed}
        relationshipId={selectedRelMeta?.relationshipId || ''}
        partnerName={selectedRelMeta?.partnerName || null}
        onContinue={() => {
          setSelectedRelMeta(null);
          setSelectedRelSession(null);
          setRelSummaryFailed(false);
        }}
      />
    </Modal>
  );
}

// ---------- session row ----------
function SessionRow({
  date, updatedAt, title, mostActivePart, chatMode, onPress,
}: {
  date?: string;
  /** Last-activity timestamp (ISO) — drives the "continued <when>"
   *  provenance label when it lands on a later day than `date`. */
  updatedAt?: string | null;
  title?: string;
  mostActivePart?: string | null;
  /** Mode the session was ended in. NULL for legacy rows that
   *  predate the column on the server — the row hides the label
   *  in that case so older history doesn't grow a misleading tag.
   *  Build 11 adds 'partner_private' for synthetic Partner-chat
   *  sessions surfaced from relationship_messages. */
  chatMode?: 'process' | 'explore' | 'partner_private' | null;
  onPress: () => void;
}) {
  // Partner sessions get a heart-color dot (no part detection); the
  // row indicator carries the 💗 affordance via the "Partner" chip
  // styling.
  const isPartner = chatMode === 'partner_private';
  const dotColor = isPartner
    ? '#E0879A'
    : (mostActivePart ? (PART_COLOR[mostActivePart] || colors.amber) : 'rgba(255,255,255,0.2)');
  // Printed 'Explore' / 'Process' until 2026-09-02 — our names for our prompts,
  // shown to the person, and blind to two of the four ways of working, which
  // therefore got no label at all. One canonical list now, the same one the mode
  // sheet reads, so a person cannot meet two different names for one thing.
  const partnerMode = chatMode === 'partner_private';
  const workLabel = MODE_LABEL[chatMode as WorkingMode] || null;
  const showMode = partnerMode || !!workLabel;
  const modeLabel = partnerMode ? '💗 Partner' : (workLabel || '');
  const cont = continuedLabel(date, updatedAt);
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
                  : chatMode === 'partner_private'
                    ? styles.sessionModePartner
                    : styles.sessionModeProcess,
              ]}
            >
              {modeLabel}
            </Text>
          ) : null}
        </View>
        {cont ? <Text style={styles.sessionContinued}>{cont}</Text> : null}
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

// ---------- reusable bits ----------
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}
/** One menu row. `sub` is optional — when present the label and sub-line
 *  stack inside the flex:1 column, so the sub-line WRAPS rather than
 *  pushing the badge and chevron off the row. (Before the sub-line existed
 *  the label sat bare next to a flex:1 spacer; the column replaces that
 *  spacer and behaves identically when `sub` is absent.) */
function LinkRow({
  label, sub, onPress, icon, badge,
}: {
  label: string;
  sub?: string;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={18} color={colors.amber} style={{ marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {/* Quiet unread badge — small static count, no animation. */}
      {badge && badge > 0 ? (
        <View style={styles.rowBadge}>
          <Text style={styles.rowBadgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  heyName: {
    color: colors.amber,
    fontSize: 20,
    fontWeight: '500',
    letterSpacing: 0.3,
    // flex:1 so the greeting takes the full row width minus the close
    // button. Without this, space-between let the X push the greeting
    // text to a single-character-wide slot on long names.
    flex: 1,
    flexShrink: 1,
  },
  closeBtn: {
    // Nudge the X down a few pixels from the safe-area top so a thumb
    // tap doesn't fight the notch / status-bar overlap. The Pressable
    // itself is 44x44 (the Ionicons "close" renders centered) so the
    // visible icon sits slightly below the heyName's vertical center
    // — matches Apple's standard for top-bar close affordances.
    width: 44,
    height: 44,
    paddingTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionLabel: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  rowLabel: { color: colors.cream, fontSize: 15 },
  // Optional second line on a LinkRow. Currently only "Privacy, Data &
  // Safety" uses it — it's what disambiguates "Safety" from data safety.
  rowSub: { color: colors.creamFaint, fontSize: 12, marginTop: 2, lineHeight: 16 },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  // Quiet unread-count badge on the Messages row — small static pill,
  // no animation (the inbox is a low-urgency surface).
  rowBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  rowBadgeText: {
    color: colors.background,
    fontSize: 11,
    fontWeight: '700',
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

  // (The experience-level picker's bottom-sheet styles went with the
  // picker itself — Settings owns that control now.)

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
  // Build 11 — Partner chat label. Heart-pink to distinguish from
  // amber Process/Explore tags; same italic Cormorant register so
  // it fits visually with the rest of the chip family.
  sessionModePartner: {
    color: '#E0879A',
  },
  sessionTitle: { color: colors.cream, fontSize: 14, marginTop: 2 },
  sessionContinued: { color: 'rgba(230,180,122,0.8)', fontSize: 10, fontStyle: 'italic', marginTop: 2 },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
});
