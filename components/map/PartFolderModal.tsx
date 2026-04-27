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

          {/* Per-part section rendering. If the node has been sensed but no
              fields are populated yet, the placeholder communicates "still
              taking shape" rather than rendering a row of empty sections. */}
          {isFolderEmpty(partKey, mapData, part) ? (
            <FormingPlaceholder />
          ) : (
            <>
              {partKey === 'wound'      ? <WoundSections      mapData={mapData} part={part} /> : null}
              {partKey === 'fixer'      ? <FixerSections      part={part} />                    : null}
              {partKey === 'skeptic'    ? <SkepticSections    part={part} />                    : null}
              {partKey === 'self'       ? <SelfSections       part={part} onEnterSelfMode={onEnterSelfMode} onClose={onClose} color={meta.color} /> : null}
              {partKey === 'self-like'  ? <SelfLikeSections   part={part} mapData={mapData} />  : null}
              {partKey === 'manager'    ? <ContainerList
                  items={mapData?.detectedManagers || []}
                  color={meta.color}
                  emptyLine="Your managers will appear here as we identify them in conversation."
                /> : null}
              {partKey === 'firefighter' ? <ContainerList
                  items={mapData?.detectedFirefighters || []}
                  color={meta.color}
                  emptyLine="Your firefighters will appear here as they surface."
                /> : null}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ============================================================================
// Empty-folder detection + placeholder
// ============================================================================
//
// A folder is "empty" when neither the part record nor the relevant mapData
// fields carry anything substantive. The map is a living document: when the
// AI has named a node but not yet filed content, we show a quiet placeholder
// instead of a row of "Not yet explored…" empties — the node is forming, not
// missing.
function nonEmpty(v: any): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
function isFolderEmpty(partKey: NodeKey, mapData: any, part: any): boolean {
  switch (partKey) {
    case 'wound':
      return !nonEmpty(mapData?.wound)
          && !nonEmpty(part?.corePhrase)
          && !nonEmpty(mapData?.objectiveStory)
          && !nonEmpty(mapData?.alternativeStory)
          && !nonEmpty(part?.sensation)
          && !nonEmpty(part?.fullDescription)
          && !nonEmpty(part?.bodyLocation)
          && !nonEmpty(part?.howItShowsUp)
          && !nonEmpty(part?.originStory);
    case 'fixer':
    case 'skeptic':
      return !nonEmpty(part?.whatItWants)
          && !nonEmpty(part?.howItShowsUp)
          && !nonEmpty(part?.bodyLocation)
          && !nonEmpty(part?.recurringPhrases)
          && !nonEmpty(part?.voice)
          && !nonEmpty(part?.historicalEntries)
          && !nonEmpty(part?.triggers)
          && !nonEmpty(part?.whatItsProtecting)
          && !nonEmpty(partKey === 'fixer' ? mapData?.fixer : mapData?.skeptic);
    case 'self-like':
      return !nonEmpty(part?.howItShowsUp)
          && !nonEmpty(mapData?.compromise)
          && !nonEmpty(part?.whatItWants)
          && !nonEmpty(part?.howItSeesTheWorld)
          && !nonEmpty(part?.bodyLocation);
    case 'manager':
      return !nonEmpty(mapData?.detectedManagers);
    case 'firefighter':
      return !nonEmpty(mapData?.detectedFirefighters);
    case 'self':
      // Self folder always has the "Enter Self mode" CTA — never blank.
      return false;
  }
  return false;
}

function FormingPlaceholder() {
  return (
    <View style={styles.formingWrap}>
      <Text style={styles.formingText}>
        The map has sensed something here — still taking shape. Keep talking
        and it will become clearer.
      </Text>
    </View>
  );
}

// ============================================================================
// Section building blocks
// ============================================================================
function Section({ label, value }: { label: string; value?: string | null }) {
  const has = !!(value && value.trim());
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
      <Text style={has ? styles.sectionValue : styles.sectionEmpty}>
        {has ? value : 'Not yet explored…'}
      </Text>
    </View>
  );
}

// ============================================================================
// Per-part section groups
// ============================================================================
function WoundSections({ mapData, part }: { mapData: any; part: any }) {
  return (
    <View style={styles.sections}>
      <Section label="Core belief"            value={mapData?.wound || part?.corePhrase} />
      <Section label="What happened"          value={mapData?.objectiveStory} />
      <Section label="Another way to see it"  value={mapData?.alternativeStory} />
      <Section label="The feeling"            value={part?.sensation || part?.fullDescription} />
      <Section label="Where you feel it"      value={part?.bodyLocation} />
      <Section label="Memories"               value={part?.howItShowsUp} />
      <Section label="Origin story"           value={part?.originStory} />
    </View>
  );
}
function FixerSections({ part }: { part: any }) {
  return (
    <View style={styles.sections}>
      <Section label="What it wants"       value={part?.whatItWants} />
      <Section label="How it shows up"     value={part?.howItShowsUp} />
      <Section label="Where you feel it"   value={part?.bodyLocation} />
      <Section label="Voice"               value={part?.recurringPhrases?.join?.(', ') || part?.voice} />
      <Section label="Memories"            value={part?.historicalEntries?.length ? `${part.historicalEntries.length} recorded` : undefined} />
      <Section label="What triggers it"    value={part?.triggers?.join?.(', ') || part?.whatItsProtecting} />
    </View>
  );
}
function SkepticSections({ part }: { part: any }) {
  return (
    <View style={styles.sections}>
      <Section label="What it believes"                value={part?.whatItWants} />
      <Section label="How it shows up"                 value={part?.howItShowsUp} />
      <Section label="Where you feel it"               value={part?.bodyLocation} />
      <Section label="Voice"                           value={part?.recurringPhrases?.join?.(', ') || part?.voice} />
      <Section label="Memories"                        value={part?.historicalEntries?.length ? `${part.historicalEntries.length} recorded` : undefined} />
      <Section label="What it's protecting against"    value={part?.whatItsProtecting} />
    </View>
  );
}
function SelfSections({
  part, color, onEnterSelfMode, onClose,
}: { part: any; color: string; onEnterSelfMode?: () => void; onClose?: () => void }) {
  return (
    <View style={styles.sections}>
      <Section label="Moments of Self detected" value={part?.historicalEntries?.length ? `${part.historicalEntries.length} noticed so far` : undefined} />
      <Section label="Qualities noticed"         value={part?.recurringPhrases?.join?.(', ')} />
      <Section label="What it feels like"        value={part?.fullDescription || part?.sensation} />

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
      <Section label="How it shows up"     value={part?.howItShowsUp || mapData?.compromise} />
      <Section label="Its agenda"          value={part?.whatItWants} />
      <Section label="How it mimics Self"  value={part?.howItSeesTheWorld} />
      <Section label="Where it lives"      value={part?.bodyLocation} />
    </View>
  );
}

// Managers / Firefighters — shared list layout
function ContainerList({
  items, color, emptyLine,
}: { items: any[]; color: string; emptyLine: string }) {
  if (!items || items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{emptyLine}</Text>
      </View>
    );
  }
  return (
    <View style={{ marginTop: spacing.sm }}>
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
  section: { marginBottom: spacing.md },
  sectionLabel: {
    color: colors.amber, fontFamily: fonts.sansBold,
    fontSize: 11, letterSpacing: 2, marginBottom: 6,
  },
  sectionValue: { color: colors.cream, fontFamily: fonts.sans, fontSize: 14, lineHeight: 22 },
  sectionEmpty: { color: colors.creamFaint, fontFamily: fonts.serifItalic, fontSize: 13, opacity: 0.7 },

  // Folder-wide "still taking shape" placeholder. Quieter than missing
  // content — italic dim copy that signals presence without specificity.
  formingWrap: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  formingText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    opacity: 0.75,
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
