// Per-node folder modal — one slide-up sheet per map node.
//
// Three layers per part folder:
//
//   1. DETECTED PILL (top) — small "Detected Nx" pill showing how many
//      times the AI has filed this part across all sessions. Display
//      only for now; tap-to-history is a future feature.
//
//   2. MAIN SECTIONS (always visible) — the four headline fields per
//      part type: belief/feeling/body/history for wound; pattern/
//      protects/shows-up/needs for fixer & skeptic; etc.
//
//   3. SELF-VOICE BUTTON — "Hear what Self would say to this part",
//      visible only when more than half of the schema fields for that
//      part type are CONFIRMED (not partial). Generates a personalized
//      Self-from-Self message via /api/self-voice and plays through
//      the same audio path as chat TTS.
//
//   4. GO DEEPER (collapsed by default) — the rest of the marker
//      fields for that part type, smaller header, slight indent.
//
// Each section label is small amber uppercase; content is cream. When
// the backend hasn't filed anything yet, the section shows a dim
// "still emerging" line — identical to the web app's pattern, so the
// folder still feels valuable empty.

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { playPreFetchedAudio } from '../../utils/ttsStream';
import type { NodeKey } from './InnerMapCanvas';

type Props = {
  visible: boolean;
  partKey: NodeKey | null;
  /** Raw mapData + session envelope from /api/latest-map. */
  mapData?: any;
  /** List from /api/parts — per-part rich fields incl. markerFields JSON. */
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
// Field-resolution helpers shared by main + Go Deeper sections.
//
// Marker fields are stored in two places — the markerFields JSON column
// (preferred, has confidence + ts) and the canonical mirror columns
// (fallback for older rows / data written via /api/parts/update which
// doesn't carry confidence). Reading order: markerFields first, mirror
// second, "" if neither.
// ============================================================================
const FIELD_TO_MIRROR: Record<string, string> = {
  body: 'bodyLocation',
  feeling: 'sensation',
  history: 'originStory',
  worldview: 'howItSeesTheWorld',
  desire: 'whatItWants',
  pattern: 'fullDescription',
  'what-it-protects': 'whatItsProtecting',
  'how-it-shows-up': 'howItShowsUp',
  agenda: 'whatItWants',
  'clenched-or-open': 'howItSeesTheWorld',
  'what-it-built': 'fullDescription',
  strategy: 'summary',
};

function readField(part: any, fieldKey: string): string {
  const mf = part?.markerFields?.[fieldKey];
  if (mf?.value && String(mf.value).trim()) return String(mf.value);
  const mirror = FIELD_TO_MIRROR[fieldKey];
  if (mirror && part?.[mirror] && String(part[mirror]).trim()) return String(part[mirror]);
  return '';
}

// ============================================================================
// Self-voice visibility — count confirmed fields, divide by schema size,
// show the button only when > 50%. We count CONFIRMED only (partial does
// not count toward the threshold) per the spec — the button shouldn't
// fire when there's not enough settled material for a meaningful Self
// message.
// ============================================================================
const PART_FIELD_TOTAL: Record<string, number> = {
  wound: 8, fixer: 8, skeptic: 8, 'self-like': 3, manager: 6, firefighter: 6,
};

function countConfirmedFields(part: any): number {
  if (!part?.markerFields) return 0;
  let n = 0;
  for (const v of Object.values(part.markerFields) as any[]) {
    if (v?.confidence === 'confirmed') n++;
  }
  return n;
}

function isMoreThanHalfConfirmed(part: any): boolean {
  if (!part?.category) return false;
  const total = PART_FIELD_TOTAL[part.category] || 0;
  if (total === 0) return false;
  return countConfirmedFields(part) / total > 0.5;
}

// ============================================================================
// Per-part Go Deeper field allocations. Each entry maps a UI label to a
// marker field key. Empty fields render with the same italic placeholder
// pattern as the main sections so the deeper section never looks broken.
// ============================================================================
type DeeperField = { label: string; key: string; placeholder: string };

const WOUND_DEEPER: DeeperField[] = [
  { label: 'Where It Lives',     key: 'body',       placeholder: 'Where this lives in the body...' },
  { label: 'The Story',          key: 'story',      placeholder: 'The story this part tells...' },
  { label: 'When It Started',    key: 'history',    placeholder: 'When this formed...' },
  { label: 'What Triggers It',   key: 'trigger',    placeholder: 'What activates this...' },
  { label: 'Worldview',          key: 'worldview',  placeholder: 'How this part sees the world...' },
  { label: 'Bipolarity',         key: 'bipolarity', placeholder: 'Which side it leans...' },
];

const PROTECTOR_DEEPER: DeeperField[] = [
  { label: 'Where It Lives',          key: 'body',             placeholder: 'Where this lives in the body...' },
  { label: 'How It Shows Up',         key: 'how-it-shows-up',  placeholder: 'How this surfaces in life...' },
  { label: 'Worldview',               key: 'worldview',        placeholder: 'How this part sees the world...' },
  { label: 'What It Desires',         key: 'desire',           placeholder: 'What this part wants most...' },
  { label: 'What It Fantasizes About',key: 'fantasy',          placeholder: 'The fantasy this part holds...' },
];

const SELF_LIKE_DEEPER: DeeperField[] = [
  { label: 'Where It Lives', key: 'body',      placeholder: 'Where this lives in the body...' },
  { label: 'History',        key: 'history',   placeholder: 'When this formed...' },
  { label: 'Worldview',      key: 'worldview', placeholder: 'How this part sees the world...' },
];

const MANAGER_FIREFIGHTER_DEEPER: DeeperField[] = [
  { label: 'When It Fires',  key: 'when-it-fires',  placeholder: 'What activates this...' },
  { label: 'What It Gives',  key: 'what-it-gives',  placeholder: 'What this offers...' },
  { label: 'Where It Lives', key: 'body',           placeholder: 'Where this lives in the body...' },
  { label: 'History',        key: 'history',        placeholder: 'When this formed...' },
];

// ============================================================================
// Main component
// ============================================================================
export function PartFolderModal({
  visible, partKey, mapData, parts, onClose, onEnterSelfMode,
}: Props) {
  if (!partKey) return null;
  const meta = META[partKey];
  // For wound/fixer/skeptic/self-like, the canonical part row is the
  // single row matching the category. For manager/firefighter, we want
  // every row (each named protector is its own card in the list).
  const allParts = parts || [];
  const part = allParts.find((p) => p?.category === partKey) || null;
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
          {partKey === 'manager'     ? <ProtectorList
              category="manager"
              partsRows={allParts.filter((p) => p?.category === 'manager')}
              fallbackItems={mapData?.detectedManagers || []}
              color={meta.color}
              emptyLine="The protective strategies that feel like personality traits will be mapped here as they emerge in conversation."
            /> : null}
          {partKey === 'firefighter' ? <ProtectorList
              category="firefighter"
              partsRows={allParts.filter((p) => p?.category === 'firefighter')}
              fallbackItems={mapData?.detectedFirefighters || []}
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
// Detected Nx pill — shown at the top of each part folder body. Pulls
// detectionCount off the parts row. Renders nothing when there's no
// part row yet OR detectionCount is 0 — there's no useful information
// in "Detected 0x".
// ============================================================================
function DetectedPill({ part, color }: { part: any; color: string }) {
  const n = Number(part?.detectionCount || 0);
  if (n <= 0) return null;
  return (
    <View style={[styles.detectedPill, { borderColor: color + '55' }]}>
      <Text style={[styles.detectedPillText, { color }]}>Detected {n}x</Text>
    </View>
  );
}

// ============================================================================
// Self-voice button — visible only when > 50% of the part's schema fields
// are confirmed. Tap → /api/self-voice → audio. Disabled while the
// generate-then-TTS round trip is in flight (5-15 sec total).
// ============================================================================
function SelfVoiceButton({ part }: { part: any }) {
  const [loading, setLoading] = useState(false);
  if (!isMoreThanHalfConfirmed(part)) return null;
  if (!part?.id) return null;

  async function handlePress() {
    if (loading) return;
    setLoading(true);
    Haptics.selectionAsync().catch(() => {});
    try {
      const buf = await api.selfVoice(part.id);
      if (!buf) {
        console.warn('[self-voice] no audio returned from server');
        return;
      }
      await playPreFetchedAudio(part.id, buf);
    } catch (e) {
      console.warn('[self-voice] play failed:', (e as Error)?.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={loading}
      style={({ pressed }) => [
        styles.selfVoiceBtn,
        loading && { opacity: 0.6 },
        pressed && !loading && { opacity: 0.85 },
      ]}
      accessibilityLabel="Hear what Self would say to this part"
      hitSlop={10}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.amber} style={{ marginRight: 8 }} />
      ) : (
        <Ionicons name="volume-medium" size={16} color={colors.amber} style={{ marginRight: 8 }} />
      )}
      <Text style={styles.selfVoiceText}>
        {loading ? 'Generating…' : 'Hear what Self would say to this part'}
      </Text>
    </Pressable>
  );
}

// ============================================================================
// Go Deeper expandable section — collapsed by default, taps to expand.
// Renders the part's secondary fields (per-part schema below) in the same
// visual style as the main sections, with a slightly smaller header
// weight to read as "deeper" rather than "primary."
// ============================================================================
function GoDeeperSection({ part, fields }: { part: any; fields: DeeperField[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!fields || fields.length === 0) return null;

  return (
    <View style={styles.deeperWrap}>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setExpanded((v) => !v);
        }}
        style={styles.deeperToggle}
        accessibilityLabel={expanded ? 'Collapse Go Deeper' : 'Expand Go Deeper'}
        hitSlop={8}
      >
        <Text style={styles.deeperToggleText}>{expanded ? 'GO DEEPER' : 'GO DEEPER'}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color="rgba(230,180,122,0.55)"
        />
      </Pressable>
      {expanded ? (
        <View style={styles.deeperBody}>
          {fields.map((f) => {
            const value = readField(part, f.key);
            const has = !!(value && value.trim());
            return (
              <View key={f.key}>
                <Text style={styles.deeperLabel}>{f.label.toUpperCase()}</Text>
                <Text style={has ? styles.sectionValue : styles.sectionPlaceholder}>
                  {has ? value : f.placeholder}
                </Text>
                <View style={styles.sectionDivider} />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ============================================================================
// Per-part section groups. Each part has its own canonical structure;
// fields that haven't surfaced yet still render with a placeholder.
//
// Order within each: DetectedPill → main sections → SelfVoiceButton →
// GoDeeperSection.
// ============================================================================
function WoundSections({ mapData, part }: { mapData: any; part: any }) {
  return (
    <View style={styles.sections}>
      <DetectedPill part={part} color="#E05050" />
      <Section
        label="The Belief"
        value={mapData?.wound || part?.corePhrase}
        placeholder="The core belief is still taking shape..."
      />
      <Section
        label="The Feeling Layer"
        value={readField(part, 'feeling') || part?.fullDescription}
        placeholder="The feeling beneath the story..."
      />
      <Section
        label="Where It Lives"
        value={readField(part, 'body')}
        placeholder="Where this lives in the body..."
      />
      <Section
        label="When It Started"
        value={readField(part, 'history') || mapData?.objectiveStory}
        placeholder="Still emerging..."
      />
      <SelfVoiceButton part={part} />
      <GoDeeperSection part={part} fields={WOUND_DEEPER} />
    </View>
  );
}
function FixerSections({ part }: { part: any }) {
  return (
    <View style={styles.sections}>
      <DetectedPill part={part} color="#E6B47A" />
      <Section
        label="The Pattern"
        value={readField(part, 'pattern') || part?.howItShowsUp || part?.fullDescription}
        placeholder="The proving pattern is still taking shape..."
      />
      <Section
        label="What It's Protecting"
        value={readField(part, 'what-it-protects')}
        placeholder="What this part is protecting against..."
      />
      <Section
        label="How It Shows Up"
        value={part?.triggers?.join?.(', ') || part?.recurringPhrases?.join?.(', ') || part?.voice}
        placeholder="How this shows up in your life..."
      />
      <Section
        label="What It Needs"
        value={readField(part, 'desire')}
        placeholder="Still getting to know this part..."
      />
      <SelfVoiceButton part={part} />
      <GoDeeperSection part={part} fields={PROTECTOR_DEEPER} />
    </View>
  );
}
function SkepticSections({ part }: { part: any }) {
  return (
    <View style={styles.sections}>
      <DetectedPill part={part} color="#86BDDC" />
      <Section
        label="The Pattern"
        value={readField(part, 'pattern') || part?.howItShowsUp || part?.fullDescription}
        placeholder="The withdrawal pattern is still taking shape..."
      />
      <Section
        label="What It's Protecting"
        value={readField(part, 'what-it-protects')}
        placeholder="What this part is protecting against..."
      />
      <Section
        label="Its Evidence"
        value={part?.recurringPhrases?.join?.(', ') || part?.voice}
        placeholder="The evidence this part holds..."
      />
      <Section
        label="What It Needs"
        value={readField(part, 'desire')}
        placeholder="Still getting to know this part..."
      />
      <SelfVoiceButton part={part} />
      <GoDeeperSection part={part} fields={PROTECTOR_DEEPER} />
    </View>
  );
}
function SelfSections({
  part, color, onEnterSelfMode, onClose,
}: { part: any; color: string; onEnterSelfMode?: () => void; onClose?: () => void }) {
  // Self deliberately gets no DetectedPill, no SelfVoiceButton, and no
  // GoDeeperSection. Self isn't a part to be mapped or spoken to — it's
  // the seat from which Self-voice messages are GENERATED, not received.
  // The MAPPING prompt is also instructed to never fire MAP_UPDATE for
  // part="self" so detectionCount on this row would be 0 anyway.
  return (
    <View style={styles.sections}>
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
        value={part?.fullDescription || readField(part, 'feeling') || part?.recurringPhrases?.join?.(', ')}
        placeholder="The quality of Self energy as it emerges..."
      />

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
      <DetectedPill part={part} color="#8A7AAA" />
      <Section
        label="What It Built"
        value={readField(part, 'what-it-built') || mapData?.compromise}
        placeholder="What this part has built and holds together..."
      />
      <Section
        label="How It Manages"
        value={readField(part, 'how-it-shows-up')}
        placeholder="How this part keeps things stable..."
      />
      <Section
        label="The Agenda"
        value={readField(part, 'agenda')}
        placeholder="The underlying agenda..."
      />
      <Section
        label="Opening vs. Clenching"
        value={readField(part, 'clenched-or-open')}
        placeholder="Still reading this part..."
      />
      <SelfVoiceButton part={part} />
      <GoDeeperSection part={part} fields={SELF_LIKE_DEEPER} />
    </View>
  );
}

// ============================================================================
// Managers / Firefighters — list layout. Each list item is its own mini-
// folder with: name, DetectedPill, summary line, SelfVoiceButton, and
// GoDeeperSection (using the manager/firefighter Deeper schema).
//
// Data source: the `parts` table (which now stores per-protector rows
// with rich markerFields after the recent server fix). For backward
// compatibility we also accept the legacy `mapData.detectedManagers`
// list and render those as plain name+context cards without the
// per-protector deeper UI.
// ============================================================================
function ProtectorList({
  category, partsRows, fallbackItems, color, emptyLine,
}: {
  category: 'manager' | 'firefighter';
  partsRows: any[];
  fallbackItems: any[];
  color: string;
  emptyLine: string;
}) {
  // Prefer rich rows from the parts table; fall back to legacy list
  // entries if no rows yet.
  if (partsRows && partsRows.length > 0) {
    return (
      <View style={styles.sections}>
        {partsRows.map((row) => (
          <View key={row.id} style={[styles.protectorCard, { borderLeftColor: color }]}>
            <View style={styles.protectorHeader}>
              <Text style={[styles.protectorName, { color }]}>
                {(row.name && row.name.trim()) || 'Unnamed'}
              </Text>
              <DetectedPill part={row} color={color} />
            </View>
            <Section
              label="Strategy"
              value={readField(row, 'strategy')}
              placeholder="The strategy is still taking shape..."
            />
            <Section
              label="What It's Managing"
              value={readField(row, 'what-it-manages')}
              placeholder="Still getting to know this part..."
            />
            <SelfVoiceButton part={row} />
            <GoDeeperSection part={row} fields={MANAGER_FIREFIGHTER_DEEPER} />
          </View>
        ))}
      </View>
    );
  }

  if (!fallbackItems || fallbackItems.length === 0) {
    return (
      <View style={styles.sections}>
        <Text style={styles.sectionPlaceholder}>{emptyLine}</Text>
      </View>
    );
  }
  return (
    <View style={styles.sections}>
      {fallbackItems.map((it, i) => (
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
  sectionValue: {
    color: '#F0EDE8',
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
  sectionPlaceholder: {
    color: 'rgba(240,237,232,0.35)',
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 21,
    fontStyle: 'italic',
  },
  sectionDivider: {
    height: 0.5,
    backgroundColor: 'rgba(240,237,232,0.08)',
    marginTop: 12,
  },

  // Detected Nx pill — small amber bordered pill at the top of the
  // folder body. Self-aligned start so it doesn't fight the meta header.
  detectedPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 0.5,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginTop: spacing.sm,
  },
  detectedPillText: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // Self-voice CTA — sits between main sections and Go Deeper. Subtle
  // amber accent so it reads as an offering rather than a primary
  // action. Outline-only so the main four sections stay the focal point.
  selfVoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.4)',
    backgroundColor: 'rgba(230,180,122,0.06)',
  },
  selfVoiceText: {
    color: colors.amber,
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.3,
  },

  // Go Deeper — collapsible section. Toggle is a row with label +
  // chevron; body is the same Section pattern but with smaller-weight
  // labels (deeperLabel) to read as "secondary."
  deeperWrap: {
    marginTop: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(240,237,232,0.08)',
  },
  deeperToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  deeperToggleText: {
    color: 'rgba(230,180,122,0.7)',
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  deeperBody: {
    marginTop: 4,
    paddingLeft: 6,
    borderLeftWidth: 0.5,
    borderLeftColor: 'rgba(230,180,122,0.15)',
  },
  deeperLabel: {
    color: 'rgba(230,180,122,0.75)',
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 2,
    marginTop: 14,
    marginBottom: 5,
    textTransform: 'uppercase',
  },

  // Self folder framer + Self-mode CTA (unchanged).
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

  // Protector cards (managers / firefighters from the parts table) —
  // each is a mini-folder with its own header row, sections, and Go
  // Deeper. Visually separated from neighbors with a left accent bar.
  protectorCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderLeftWidth: 2,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 12,
    borderRadius: radii.sm,
    marginBottom: 14,
  },
  protectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  protectorName: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fonts.sansMedium,
    flex: 1,
  },

  // Legacy fallback list-item (when partsRows is empty but
  // mapData.detectedManagers has data from the old code path).
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
