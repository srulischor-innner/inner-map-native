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

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from '../../utils/useKeyboardInset';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { playPreFetchedAudio } from '../../utils/ttsStream';
import { armPendingChatMessage } from '../../utils/pendingChatMessage';
import { emitBeliefChanged } from '../../utils/beliefEvents';
import type { NodeKey } from './InnerMapCanvas';

// Round 9 correction (single-belief model): the user has ONE belief
// total — what they stand on, separate from every part on the map.
// That belief lives on the Self-like part row. The belief section
// only renders inside the Self-like part folder; opening any other
// folder shows just the part's own content.
const BELIEF_PART_TYPES = new Set(['self-like']);

type Props = {
  visible: boolean;
  partKey: NodeKey | null;
  /** Raw mapData + session envelope from /api/latest-map. */
  mapData?: any;
  /** List from /api/parts — per-part rich fields incl. markerFields JSON. */
  parts?: any[];
  onClose: () => void;
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
    // Reframed (June 2026) — two-beat framing: (1) honor what it built and
    // how well, then (2) name the new possibility — leading from its own
    // ground (the belief, separate from the parts) rather than being run by
    // the loudest part. Two paragraphs joined by a blank line.
    description:
      'The part that navigates between your fixer and skeptic. It built your career, your relationships, the rhythms of your life — finding ways to feel okay within the system. It has done this brilliantly, for your whole life.\n\n' +
      "And it's the part that can do something new: stop being run by whichever part is loudest, and lead. To stand on its own ground — what you believe, separate from what your parts believe — and hold it.",
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
  // The Lean — which pole self-like tilts toward when managing the
  // tension between fixer and skeptic. Surfaces in the AI's narration
  // ("leans toward fixer — defaults to doing more under stress" etc).
  { label: 'The Lean',       key: 'lean',      placeholder: 'Which pole self-like tilts toward under stress...' },
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
  visible, partKey, mapData, parts, onClose,
}: Props) {
  if (!partKey) return null;
  const meta = META[partKey];
  // For wound/fixer/skeptic/self-like, the canonical part row is the
  // single row matching the category. For manager/firefighter, we want
  // every row (each named protector is its own card in the list).
  const allParts = parts || [];
  const part = allParts.find((p) => p?.category === partKey) || null;
  const insets = useSafeAreaInsets();
  // Keyboard avoidance for the belief-establish editor (and any other
  // input in this sheet). insideModal:true → manual lift on both
  // platforms; applied as extra paddingBottom on the ScrollView content
  // so the focused input can scroll above the keyboard. (RN Modal windows
  // don't inherit the activity's softwareKeyboardLayoutMode:'resize'.)
  const kbHeight = useKeyboardInset({ insideModal: true });

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

        <ScrollView
          contentContainerStyle={[styles.body, kbHeight > 0 ? { paddingBottom: kbHeight } : null]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {meta.subtitle ? (
            <Text style={[styles.subtitle, { color: meta.color }]}>{meta.subtitle.toUpperCase()}</Text>
          ) : null}
          <Text style={styles.description}>{meta.description}</Text>

          {/* User's articulated belief — the single belief that
              activates Self-like voice across the whole map (round 9
              correction). Renders ONLY inside the Self-like part
              folder. Doesn't require a part.id — the empty-state
              "Establish your belief" button routes to chat, and the
              server saves on the Self-like row via the SAVE_BELIEF
              marker (it tolerates the row not existing yet by
              creating one when the user has at least begun mapping). */}
          {BELIEF_PART_TYPES.has(String(partKey)) ? (
            <>
              <BeliefSection part={part} color={meta.color} onClose={onClose} />
              <MiddleGroundSection part={part} color={meta.color} />
            </>
          ) : null}

          {/* Per-part section rendering. Every section is ALWAYS visible —
              empty fields show a quiet italic placeholder so the user can
              see what the map is building toward, instead of a missing row.
              Folders refine over time as the AI files content. */}
          {partKey === 'wound'       ? <WoundSections      mapData={mapData} part={part} /> : null}
          {partKey === 'fixer'       ? <FixerSections      part={part} />                    : null}
          {partKey === 'skeptic'     ? <SkepticSections    part={part} />                    : null}
          {partKey === 'self'        ? <SelfSections       part={part} color={meta.color} /> : null}
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
// Belief section — Phase 2 (polish round 8; rescoped in round 9).
// Renders inside the Self-like part folder only. The single belief is
// what the user stands on, separate from their parts; it activates
// Self-like voice for the entire map. Three render states:
//
//   1. EMPTY  → "Establish your belief" button. Arms a pre-filled
//      chat message via utils/pendingChatMessage, then routes to the
//      chat tab where the index screen consumes the prefill on mount
//      and sends it in Explore mode.
//
//   2. FILLED → belief text + Edit + Clear actions. Clear shows a
//      confirmation Alert (the user just spent real effort articulating
//      this — destructive action gets a guardrail).
//
//   3. EDITING → multi-line TextInput + Save + Cancel. Save calls
//      /api/parts/:id/belief; failure leaves the editor open so the
//      user doesn't lose their draft on a transient network blip.
//
// The component owns its own state and doesn't bubble changes to the
// modal's parent — re-reading the parts list happens at the map-tab
// level on the next /api/parts pull. The local state is what the user
// sees within this session of the folder being open.
// ============================================================================
function BeliefSection({ part, color, onClose }: { part: any; color: string; onClose?: () => void }) {
  const router = useRouter();
  const [belief, setBelief] = useState<string>(typeof part?.belief === 'string' ? part.belief : '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // If the modal switches part rows while open, resync local state from
  // the new row's belief field. Without this the section would keep
  // showing the previous part's belief on re-open.
  useEffect(() => {
    setBelief(typeof part?.belief === 'string' ? part.belief : '');
    setEditing(false);
    setDraft('');
  }, [part?.id, part?.belief]);

  const handleEstablish = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    const text =
      "I want to work on my own belief — what I stand on that's separate from my parts.";
    armPendingChatMessage(text, 'explore');
    // Close the folder BEFORE navigating — otherwise the sheet stays
    // open behind the chat handoff and the map is in a confusing state
    // when the user comes back. (Mirrors the Self folder's
    // onEnterSelfMode path, which closes via map.tsx before pushing.)
    onClose?.();
    router.push('/');
  }, [router, onClose]);

  const handleStartEdit = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setDraft(belief);
    setEditing(true);
  }, [belief]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setDraft('');
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || !part?.id) return;
    setSaving(true);
    Haptics.selectionAsync().catch(() => {});
    try {
      const result = await api.savePartBelief(String(part.id), trimmed);
      if (result?.belief) {
        setBelief(result.belief);
        setEditing(false);
        setDraft('');
        // Unlock the Self-like mic immediately — this save happens ON
        // the Map tab (no focus change, no remount), so the mic's
        // mount-time belief check would otherwise stay stale.
        emitBeliefChanged();
      } else {
        Alert.alert(
          'Couldn’t save',
          'We couldn’t save your belief just now. Your draft is still here — try again in a moment.',
        );
      }
    } finally {
      setSaving(false);
    }
  }, [draft, part?.id]);

  const handleClear = useCallback(() => {
    if (!part?.id) return;
    Alert.alert(
      'Clear belief?',
      'This will remove the belief you saved. The Self-like voice will be unavailable until you establish a new belief.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const ok = await api.deletePartBelief(String(part.id));
            if (ok) {
              setBelief('');
              // Re-LOCK the Self-like mic — same staleness in reverse.
              emitBeliefChanged();
            } else {
              Alert.alert(
                'Couldn’t clear',
                'We couldn’t clear the belief just now. Try again in a moment.',
              );
            }
          },
        },
      ],
    );
  }, [part?.id]);

  const hasBelief = !!(belief && belief.trim());

  return (
    <View style={styles.beliefWrap}>
      <Text style={styles.beliefLabel}>YOUR BELIEF</Text>
      <Text style={styles.beliefSubtitle}>
        What you stand on — separate from what your parts believe.
      </Text>

      {editing ? (
        <View style={styles.beliefEditor}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="What do you stand on? (different from what your parts believe)"
            placeholderTextColor="rgba(240,237,232,0.3)"
            style={styles.beliefInput}
            editable={!saving}
            autoFocus
          />
          <View style={styles.beliefActionsRow}>
            <Pressable
              onPress={handleCancelEdit}
              disabled={saving}
              style={({ pressed }) => [
                styles.beliefBtn,
                styles.beliefBtnSecondary,
                pressed && { opacity: 0.7 },
                saving && { opacity: 0.5 },
              ]}
              hitSlop={6}
            >
              <Text style={styles.beliefBtnSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saving || !draft.trim()}
              style={({ pressed }) => [
                styles.beliefBtn,
                styles.beliefBtnPrimary,
                { borderColor: color, backgroundColor: color + '22' },
                pressed && { opacity: 0.85 },
                (saving || !draft.trim()) && { opacity: 0.5 },
              ]}
              hitSlop={6}
            >
              {saving ? (
                <ActivityIndicator size="small" color={color} />
              ) : (
                <Text style={[styles.beliefBtnPrimaryText, { color }]}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : hasBelief ? (
        <View style={styles.beliefFilled}>
          <Text style={styles.beliefValue}>{belief}</Text>
          <View style={styles.beliefActionsRow}>
            <Pressable
              onPress={handleStartEdit}
              style={({ pressed }) => [
                styles.beliefBtn,
                styles.beliefBtnSecondary,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={6}
            >
              <Ionicons name="create-outline" size={13} color={colors.creamDim} style={{ marginRight: 4 }} />
              <Text style={styles.beliefBtnSecondaryText}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={handleClear}
              style={({ pressed }) => [
                styles.beliefBtn,
                styles.beliefBtnSecondary,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={6}
            >
              <Ionicons name="trash-outline" size={13} color={colors.creamDim} style={{ marginRight: 4 }} />
              <Text style={styles.beliefBtnSecondaryText}>Clear</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={handleEstablish}
          style={({ pressed }) => [
            styles.beliefEstablishBtn,
            { borderColor: color + '66', backgroundColor: color + '10' },
            pressed && { opacity: 0.85 },
          ]}
          accessibilityLabel="Establish your belief"
          hitSlop={8}
        >
          <Ionicons
            name="create-outline"
            size={15}
            color={color}
            style={{ marginRight: 8 }}
          />
          <Text style={[styles.beliefEstablishText, { color }]}>
            Establish your belief
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ============================================================================
// "Where You Live" section — the Self-like middle-ground collection.
// Renders inside the Self-like part folder only, directly below the
// belief section. The AI files items here (with in-conversation consent)
// when it notices something the user keeps returning to — the middle
// ground that steadies them.
//
// READ-ONLY for the user: no add, no edit. Each item can be deleted with
// a confirm (mirrors the belief Clear guardrail) if it was filed in error
// or no longer fits. Items are {id, label, note?, createdAt}.
//
// Empty state shows a quiet line so the section reads as "building toward"
// rather than "missing" — consistent with the rest of the folder. Like
// BeliefSection, this owns its local list and doesn't bubble changes up;
// the map tab re-pulls /api/parts on next focus. ("Where You Live" is a
// placeholder label — final copy lands later.)
// ============================================================================
type MiddleGroundItem = { id: string; label: string; note?: string | null; createdAt?: string };

function MiddleGroundSection({ part }: { part: any; color: string }) {
  const [items, setItems] = useState<MiddleGroundItem[]>(
    Array.isArray(part?.middleGround) ? part.middleGround : [],
  );

  // Resync from the row when the modal switches part rows while open
  // (same staleness guard as BeliefSection).
  useEffect(() => {
    setItems(Array.isArray(part?.middleGround) ? part.middleGround : []);
  }, [part?.id, part?.middleGround]);

  const handleDelete = useCallback((item: MiddleGroundItem) => {
    if (!part?.id || !item?.id) return;
    Alert.alert(
      'Remove this?',
      `“${item.label}” will be removed from where you live.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            Haptics.selectionAsync().catch(() => {});
            const updated = await api.deleteMiddleGroundItem(String(part.id), String(item.id));
            if (updated) {
              setItems(updated);
            } else {
              Alert.alert(
                'Couldn’t remove',
                'We couldn’t remove that just now. Try again in a moment.',
              );
            }
          },
        },
      ],
    );
  }, [part?.id]);

  return (
    <View style={styles.middleWrap}>
      <Text style={styles.middleLabel}>WHERE YOU LIVE</Text>
      <Text style={styles.middleSubtitle}>
        What you keep coming back to — the ground that steadies you.
      </Text>

      {items.length === 0 ? (
        <Text style={styles.middleEmpty}>
          As we talk, the things you return to will gather here.
        </Text>
      ) : (
        <View style={styles.middleList}>
          {items.map((item, idx) => (
            <View
              key={item.id}
              style={[styles.middleItem, idx > 0 && styles.middleItemDivider]}
            >
              <View style={styles.middleItemBody}>
                <Text style={styles.middleItemLabel}>{item.label}</Text>
                {item.note ? (
                  <Text style={styles.middleItemNote}>{item.note}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => handleDelete(item)}
                style={({ pressed }) => [styles.middleDeleteBtn, pressed && { opacity: 0.6 }]}
                hitSlop={10}
                accessibilityLabel={`Remove ${item.label}`}
              >
                <Ionicons name="close" size={16} color={colors.creamFaint} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
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
  part, color,
}: { part: any; color: string }) {
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

    </View>
  );
}
function SelfLikeSections({ part, mapData }: { part: any; mapData: any }) {
  // Section copy reframed May 2026 — old labels ("The Agenda",
  // "Opening vs. Clenching") and old empty-state lines ("the
  // underlying agenda…") read as accusatory. New language honors
  // the part: what it WANTS underneath, how it's currently HOLDING
  // things. Same fields, same data flow, warmer surface.
  return (
    <View style={styles.sections}>
      <DetectedPill part={part} color="#8A7AAA" />
      <Section
        label="What It Built"
        value={readField(part, 'what-it-built') || mapData?.compromise}
        placeholder="The actual life this part has shaped — work, choices, the way you show up day to day."
      />
      <Section
        label="How It Manages"
        value={readField(part, 'how-it-shows-up')}
        placeholder="How this part navigates between your fixer and skeptic to keep things workable."
      />
      <Section
        label="What It Wants"
        value={readField(part, 'agenda')}
        placeholder="Underneath everything, what this part is trying to feel — usually some version of okay, stable, at peace."
      />
      <Section
        label="How It Shows Up"
        value={readField(part, 'clenched-or-open')}
        placeholder="How this part is currently holding things — relaxed and trusting, or tight and managing."
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
// One-liner row that prints "Last activated · 3 hours ago" (or "yesterday",
// "5 days ago", etc.) under a protector card. Returns null if the
// part has never been detected so brand-new rows don't show a stale
// "never" string. Lightweight relative-time formatter — no extra dep.
function formatRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  if (day < 30) {
    const wk = Math.floor(day / 7);
    return `${wk} week${wk === 1 ? '' : 's'} ago`;
  }
  if (day < 365) {
    const mo = Math.floor(day / 30);
    return `${mo} month${mo === 1 ? '' : 's'} ago`;
  }
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? '' : 's'} ago`;
}

function LastActivatedRow({ lastDetected }: { lastDetected: string | null | undefined }) {
  const rel = formatRelativeTime(lastDetected);
  if (!rel) return null;
  return (
    <View style={styles.lastActivatedRow}>
      <Text style={styles.lastActivatedLabel}>LAST ACTIVATED</Text>
      <Text style={styles.lastActivatedValue}>{rel}</Text>
    </View>
  );
}

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
            {/* Last activated — surfaces the parts.lastDetected
                timestamp as a relative-time line. Helps the user see
                which protectors are currently busy vs. which haven't
                fired in weeks. Hidden when the row has never been
                detected (a brand-new part inserted via direct edit). */}
            <LastActivatedRow lastDetected={row.lastDetected} />
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

  // Belief section — sits below the part description and above the
  // detected pill. Distinct visual register from the regular Section
  // rows (which are amber/cream) — uses the part's own color so the
  // user reads it as "my answer to this part" rather than "another
  // field the AI fills." Padding + soft border so it reads as a
  // self-contained zone within the folder.
  beliefWrap: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(240,237,232,0.08)',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(240,237,232,0.08)',
  },
  beliefLabel: {
    color: '#E6B47A',
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  beliefSubtitle: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  beliefEstablishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  beliefEstablishText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  beliefFilled: {},
  beliefValue: {
    color: '#F0EDE8',
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
  },
  beliefEditor: {},
  beliefInput: {
    color: '#F0EDE8',
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 80,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.sm,
    borderWidth: 0.5,
    borderColor: 'rgba(240,237,232,0.18)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 10,
    textAlignVertical: 'top',
  },
  beliefActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  beliefBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  beliefBtnPrimary: {},
  beliefBtnPrimaryText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  beliefBtnSecondary: {
    borderColor: 'rgba(240,237,232,0.2)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  beliefBtnSecondaryText: {
    color: colors.creamDim,
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.3,
  },

  // "Where You Live" section — sits directly below the belief section
  // inside the Self-like folder. No top border: the belief section's
  // bottom border serves as the divider between the two. Its own bottom
  // border closes the zone, matching the belief section's framing.
  middleWrap: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(240,237,232,0.08)',
  },
  middleLabel: {
    color: '#E6B47A',
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  middleSubtitle: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  middleEmpty: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.8,
  },
  middleList: {},
  middleItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },
  middleItemDivider: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(240,237,232,0.06)',
  },
  middleItemBody: {
    flex: 1,
    paddingRight: 10,
  },
  middleItemLabel: {
    color: '#F0EDE8',
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 21,
  },
  middleItemNote: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  middleDeleteBtn: {
    padding: 4,
    marginTop: 1,
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

  // Self folder framer.
  selfFramer: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: spacing.sm,
    textAlign: 'center',
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
  // "LAST ACTIVATED · 3 hours ago" — quiet metadata row that sits
  // beneath the strategy/what-it-manages sections. Same uppercase
  // amber label register as the section labels for visual rhyme,
  // value rendered inline in cream serif italic.
  lastActivatedRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 14,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(230,180,122,0.15)',
  },
  lastActivatedLabel: {
    color: '#E6B47A',
    fontFamily: fonts.sansBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    marginRight: 8,
  },
  lastActivatedValue: {
    color: colors.creamDim,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    letterSpacing: 0.2,
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
