// Per-node folder modal — one slide-up sheet per map node.
//
// Every part has its own section structure drawn from the web app's folder spec:
//   WOUND   — Core belief / What happened / Another way to see it / The feeling /
//             Where you feel it / Memories / Origin story
//   FIXER   — What it wants / How it shows up / Where you feel it / Voice /
//             Memories / What triggers it
//   SKEPTIC — What it believes / How it shows up / Where you feel it / Voice /
//             Memories / What it's protecting against
//   SELF    — Moments of Self detected / Qualities noticed / What it feels like,
//             plus an amber pill "Enter Self mode" at the bottom.
//   SELF-LIKE — How it shows up / Its agenda / How it mimics Self / Where it lives
//   MANAGERS — Warm description + list of individual managers (or empty state).
//   FIREFIGHTERS — Warm description + list of individual firefighters.
//
// Each section label is small amber uppercase; content is cream. When the backend
// hasn't filed anything yet, the section shows a dim "Not yet explored…" line —
// identical to the web app's pattern, so the folder still feels valuable empty.

import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radii, spacing } from '../../constants/theme';
import type { NodeKey } from './InnerMapCanvas';

type Props = {
  visible: boolean;
  partKey: NodeKey | null;
  /** Raw mapData + session envelope from /api/latest-map. */
  mapData?: any;
  /** List from /api/parts — per-part rich fields. */
  parts?: any[];
  onClose: () => void;
  /** Called when user taps "Enter Self mode" on the Self folder. */
  onEnterSelfMode?: () => void;
};

// ============================================================================
// Part-specific header content (title / subtitle / description)
// ============================================================================
type Meta = { title: string; color: string; subtitle?: string; description: string };
const META: Record<NodeKey, Meta> = {
  wound: {
    title: 'The Wound',
    color: '#E05050',
    description:
      'The core belief formed in childhood that shapes everything since. It is experienced as fact, not perspective.',
  },
  fixer: {
    title: 'The Fixer',
    color: '#E6B47A',
    description:
      'The part that tries to prove the wound wrong through drive, achievement, performance. It has been fighting for you your whole life.',
  },
  skeptic: {
    title: 'The Skeptic',
    color: '#86BDDC',
    description:
      'The part that protects against the fixer overreaching. Its logic deserves genuine respect.',
  },
  self: {
    title: 'Self',
    color: '#C1AAD8',
    subtitle: 'Uncovered, not built',
    description:
      'The center of the system. No agenda, no fear. Genuine curiosity, warmth, presence.',
  },
  'self-like': {
    title: 'The Self-Like Part',
    color: '#8A7AAA',
    subtitle: 'The architect of your actual life',
    description:
      'Navigates the space between fixer and skeptic. Uses the language of healing — but always has an agenda.',
  },
  manager: {
    title: 'Managers',
    color: '#9DCCB3',
    subtitle: 'Your proactive protectors',
    description:
      'Managers work hard every day to prevent the wound from being activated. Perfectionism, people-pleasing, achievement, hypervigilance.',
  },
  firefighter: {
    title: 'Firefighters',
    color: '#EF8C30',
    subtitle: 'Your reactive protectors',
    description:
      'Firefighters respond when pain breaks through anyway — distraction, rage, numbness, obsessive thinking. Not the enemy; doing the only job they know.',
  },
};

// ============================================================================
// Main component
// ============================================================================
export function PartFolderModal({
  visible, partKey, mapData, parts, onClose, onEnterSelfMode,
}: Props) {
  if (!partKey) return null;
  const meta = META[partKey];
  const part = (parts || []).find((p) => p?.category === partKey) || null;
  // Bottom inset for the home indicator area — padding the scroll body
  // prevents the last section from landing underneath the gesture bar on
  // iPhone X+ devices.
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: meta.color }]}>{meta.title}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close}>
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {meta.subtitle ? (
            <Text style={[styles.subtitle, { color: meta.color }]}>{meta.subtitle.toUpperCase()}</Text>
          ) : null}
          <Text style={styles.description}>{meta.description}</Text>

          {/* Per-part section rendering. Every section is ALWAYS visible —
              empty fields show a quiet italic placeholder so the user can
              see what the map is building toward, instead of a missing row.
              Folders refine over time as the AI files content. */}
          {partKey === 'wound'       ? <WoundSections      mapData={mapData} part={part} /> : null}
          {partKey === 'fixer'       ? <FixerSections      part={part} />                    : null}
          {partKey === 'skeptic'     ? <SkepticSections    part={part} />                    : null}
          {partKey === 'self'        ? <SelfSections       part={part} onEnterSelfMode={onEnterSelfMode} onClose={onClose} color={meta.color} /> : null}
          {partKey === 'self-like'   ? <SelfLikeSections   part={part} mapData={mapData} />  : null}
          {partKey === 'manager'     ? <ManagerList
              items={mapData?.detectedManagers || []}
              color={meta.color}
              emptyLine="The protective strategies that feel like personality traits will be mapped here as they emerge in conversation."
            /> : null}
          {partKey === 'firefighter' ? <ManagerList
              items={mapData?.detectedFirefighters || []}
              color={meta.color}
              emptyLine="The reactive parts that show up when pain breaks through will be mapped here. These are never things to stop — they're trying to help."
            /> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ============================================================================
// Section building block — always visible. Populated content uses the
// solid cream/sans style; empty content uses a quiet italic Cormorant
// placeholder so the user can see what each section is building toward
// without the layout reading as "missing data". A 0.5px divider sits at
// the bottom of every section.
// ============================================================================
function Section({
  label, value, placeholder,
}: { label: string; value?: string | null; placeholder: string }) {
  const has = !!(value && value.trim());
  return (
    <View>
      <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
      <Text style={has ? styles.sectionValue : styles.sectionPlaceholder}>
        {has ? value : placeholder}
      </Text>
      <View style={styles.sectionDivider} />
    </View>
  );
}

// ============================================================================
// Per-part section groups. Each part has its own canonical structure;
// fields that haven't surfaced yet still render with a placeholder.
// ============================================================================
function WoundSections({ mapData, part }: { mapData: any; part: any }) {
  return (
    <View style={styles.sections}>
      <Section
        label="The Belief"
        value={mapData?.wound || part?.corePhrase}
        placeholder="The core belief is still taking shape..."
      />
      <Section
        label="The Feeling Layer"
        value={part?.sensation || part?.fullDescription}
        placeholder="The feeling beneath the story..."
      />
      <Section
        label="Where It Lives"
        value={part?.bodyLocation}
        placeholder="Where this lives in the body..."
      />
      <Section
        label="When It Started"
        value={part?.originStory || mapData?.objectiveStory}
        placeholder="Still emerging..."
      />
    </View>
  );
}
function FixerSections({ part }: { part: any }) {
  return (
    <View style={styles.sections}>
      <Section
        label="The Pattern"
        value={part?.howItShowsUp || part?.fullDescription}
        placeholder="The proving pattern is still taking shape..."
      />
      <Section
        label="What It's Protecting"
        value={part?.whatItsProtecting}
        placeholder="What this part is protecting against..."
      />
      <Section
        label="How It Shows Up"
        value={part?.triggers?.join?.(', ') || part?.recurringPhrases?.join?.(', ') || part?.voice}
        placeholder="How this shows up in your life..."
      />
      <Section
        label="What It Needs"
        value={part?.whatItWants}
        placeholder="Still getting to know this part..."
      />
    </View>
  );
}
function SkepticSections({ part }: { part: any }) {
  return (
    <View style={styles.sections}>
      <Section
        label="The Pattern"
        value={part?.howItShowsUp || part?.fullDescription}
        placeholder="The withdrawal pattern is still taking shape..."
      />
      <Section
        label="What It's Protecting"
        value={part?.whatItsProtecting}
        placeholder="What this part is protecting against..."
      />
      <Section
        label="Its Evidence"
        value={part?.recurringPhrases?.join?.(', ') || part?.voice}
        placeholder="The evidence this part holds..."
      />
      <Section
        label="What It Needs"
        value={part?.whatItWants}
        placeholder="Still getting to know this part..."
      />
    </View>
  );
}
function SelfSections({
  part, color, onEnterSelfMode, onClose,
}: { part: any; color: string; onEnterSelfMode?: () => void; onClose?: () => void }) {
  return (
    <View style={styles.sections}>
      {/* Self folder always shows this short explanation at the top — Self
          is structurally different from the other parts (always complete,
          never wounded), so it gets its own framing. */}
      <Text style={styles.selfFramer}>
        Self is always complete — never wounded. These are the moments it
        has become visible in your conversations.
      </Text>

      <Section
        label="Moments of Presence"
        value={part?.historicalEntries?.length ? `${part.historicalEntries.length} noticed so far` : undefined}
        placeholder="Moments of genuine presence will be noted here..."
      />
      <Section
        label="Quality"
        value={part?.fullDescription || part?.sensation || part?.recurringPhrases?.join?.(', ')}
        placeholder="The quality of Self energy as it emerges..."
      />

      {/* Warm explanation of what Self mode is — sits above the CTA so the
          user understands what they're opting into before they tap. */}
      <Text style={styles.selfModeExplain}>
        Self mode shifts the conversation entirely. No mapping, no analysis, no agenda.
        Just pure presence — a space to feel genuinely received without anything being
        required of you. Use it when you need to be held rather than understood.
      </Text>

      {onEnterSelfMode ? (
        <View style={{ alignItems: 'center' }}>
          <Pressable
            style={[styles.selfModeBtn, { borderColor: color, backgroundColor: color + '18' }]}
            onPress={onEnterSelfMode}
            accessibilityLabel="Enter Self mode"
          >
            <Text style={[styles.selfModeText, { color }]}>Enter Self mode →</Text>
          </Pressable>
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={10} style={styles.notNowBtn}>
              <Text style={styles.notNowText}>Not now</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
function SelfLikeSections({ part, mapData }: { part: any; mapData: any }) {
  return (
    <View style={styles.sections}>
      <Section
        label="What It Built"
        value={part?.fullDescription || mapData?.compromise}
        placeholder="What this part has built and holds together..."
      />
      <Section
        label="How It Manages"
        value={part?.howItShowsUp}
        placeholder="How this part keeps things stable..."
      />
      <Section
        label="The Agenda"
        value={part?.whatItWants}
        placeholder="The underlying agenda..."
      />
      <Section
        label="Opening vs. Clenching"
        value={part?.howItSeesTheWorld}
        placeholder="Still reading this part..."
      />
    </View>
  );
}

// Managers / Firefighters — shared list layout. When the list is empty,
// renders the warm placeholder paragraph in italic. Otherwise renders
// each detected entry as its own card with name + context fields.
function ManagerList({
  items, color, emptyLine,
}: { items: any[]; color: string; emptyLine: string }) {
  if (!items || items.length === 0) {
    return (
      <View style={styles.sections}>
        <Text style={styles.sectionPlaceholder}>{emptyLine}</Text>
      </View>
    );
  }
  return (
    <View style={styles.sections}>
      {items.map((it, i) => (
        <View key={i} style={[styles.listItem, { borderLeftColor: color }]}>
          <Text style={[styles.listName, { color }]}>{it.label || it.name || 'Unnamed'}</Text>
          {it.context ? <Text style={styles.listText}>{it.context}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    maxHeight: '80%',
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 0.5,
    borderTopColor: colors.borderAmber,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 42, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { fontFamily: fonts.serifBold, fontSize: 26, letterSpacing: 0.3 },
  close: { padding: 6 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

  subtitle: {
    fontFamily: fonts.sansBold, fontSize: 11,
    letterSpacing: 2, marginBottom: spacing.sm, opacity: 0.9,
  },
  description: {
    color: colors.creamDim, fontFamily: fonts.serifItalic,
    fontSize: 15, lineHeight: 24,
  },

  sections: { marginTop: spacing.lg },
  // Section label — DM Sans 600, 10px, letter-spacing 2, uppercase amber.
  sectionLabel: {
    color: '#E6B47A',
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 2,
    marginTop: 16,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  // Populated content — DM Sans 400, 15px, cream, lineHeight 22.
  sectionValue: {
    color: '#F0EDE8',
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
  // Empty placeholder — Cormorant italic, dim, 14px lineHeight 21. Reads
  // as "this section will fill in" rather than "this is missing data".
  sectionPlaceholder: {
    color: 'rgba(240,237,232,0.35)',
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
  },
  // Hairline divider beneath each section so they read as discrete cards
  // even when most are empty placeholders.
  sectionDivider: {
    height: 0.5,
    backgroundColor: 'rgba(240,237,232,0.08)',
    marginTop: 12,
  },

  // Self folder framer — short paragraph at the top of the Self folder
  // that contextualizes the two sections that follow.
  selfFramer: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },

  selfModeExplain: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 24,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  selfModeBtn: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  selfModeText: { fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
  notNowBtn: { marginTop: spacing.sm, padding: 8 },
  notNowText: {
    color: colors.creamFaint, fontSize: 12, opacity: 0.7,
    letterSpacing: 0.3,
  },

  listItem: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderLeftWidth: 2,
    padding: 12,
    borderRadius: radii.sm,
    marginBottom: 10,
  },
  listName: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  listText: { color: colors.creamDim, fontSize: 13, lineHeight: 20 },

  empty: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  emptyText: {
    color: colors.creamFaint, fontSize: 13, lineHeight: 20,
    fontStyle: 'italic', textAlign: 'center',
  },
});
