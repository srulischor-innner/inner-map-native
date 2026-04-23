// Bottom-sheet style modal that opens when the user taps a node on the map. Shows
// the part's title, color-matched subheader, description, and whatever is currently
// filed for that part (from /api/latest-map). Empty state: a warm "what will live
// here" blurb so the folder is valuable even before the first filings.
//
// Implemented as a plain <Modal> for v1 — no gesture-handler sheet lib needed. A
// real bottom-sheet animation can be layered on later with @gorhom/bottom-sheet.

import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../constants/theme';
import { PART_COLOR, PART_DISPLAY } from '../../utils/markers';
import type { NodeKey } from './InnerMapCanvas';

type Props = {
  visible: boolean;
  partKey: NodeKey | null;
  mapData?: any;
  onClose: () => void;
};

type SectionBody = { title: string; subtitle?: string; description: string; emptyLine: string };

const SECTIONS: Record<NodeKey, SectionBody> = {
  wound: {
    title: 'The Wound',
    description:
      'The core belief formed in childhood that shapes everything since — "I am not enough," "I am invisible," "I am too much." It is experienced as fact, not perspective.',
    emptyLine: 'The wound will surface here as we explore together — often through a feeling before it becomes a story.',
  },
  fixer: {
    title: 'The Fixer',
    description:
      'The part that tries to prove the wound wrong through drive, achievement, performance. It has been fighting for you your whole life.',
    emptyLine: "The fixer's shape will appear here as patterns emerge — the way you push, what you're trying to prove, what you can't let go of.",
  },
  skeptic: {
    title: 'The Skeptic',
    description:
      'The part that protects against the fixer overreaching. It says: stop, this will end in more pain. Its logic deserves genuine respect.',
    emptyLine: "The skeptic's voice will land here — what it's seen, what it's concluded, why it holds back.",
  },
  self: {
    title: 'Self',
    subtitle: 'Uncovered, not built',
    description:
      'The center of the system. No agenda, no fear. Genuine curiosity, warmth, presence. It is not something to develop — only something to uncover.',
    emptyLine: 'Moments of Self energy — curiosity, calm, quiet clarity — will be noticed and collected here.',
  },
  'self-like': {
    title: 'The Self-Like Part',
    subtitle: 'The architect of your actual life',
    description:
      "The self-like part navigates the space between the fixer and the skeptic. It uses the language of healing — but underneath every move is an agenda: to feel okay. Not fake — just not Self.",
    emptyLine: 'The self-like part will show up here as the compromise you built — what you love, what you return to, what keeps things okay.',
  },
  manager: {
    title: 'Managers',
    subtitle: 'Your proactive protectors',
    description:
      'Managers work hard every day to prevent the wound from being activated. Perfectionism, people-pleasing, achievement, hypervigilance. They built their strategies into your identity.',
    emptyLine: 'Your managers will appear here as we identify them. Most people have several — each protecting against a specific aspect of the wound.',
  },
  firefighter: {
    title: 'Firefighters',
    subtitle: 'Your reactive protectors',
    description:
      'Firefighters respond when pain breaks through anyway — distraction, rage, numbness, obsessive thinking, shutdown. They are not the enemy. They are doing the only job they know.',
    emptyLine: 'Your firefighters will appear here as they surface. Often they show up as the behaviors you most want to change.',
  },
};

export function PartFolderModal({ visible, partKey, mapData, onClose }: Props) {
  if (!partKey) return null;
  const section = SECTIONS[partKey];
  const color = PART_COLOR[partKey] || colors.amber;

  // Pull whatever is already filed for this part. For core nodes (wound/fixer/skeptic)
  // the data lives at mapData[partKey]; for manager/firefighter it's a list; others empty.
  const coreValue: string | undefined = mapData?.[partKey];
  const items: any[] =
    (partKey === 'manager' ? mapData?.detectedManagers : undefined) ||
    (partKey === 'firefighter' ? mapData?.detectedFirefighters : undefined) ||
    [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={[styles.title, { color }]}>{section.title}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close}>
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {section.subtitle ? (
            <Text style={[styles.subtitle, { color }]}>{section.subtitle.toUpperCase()}</Text>
          ) : null}
          <Text style={styles.description}>{section.description}</Text>

          {/* Core-node filled value */}
          {(['wound', 'fixer', 'skeptic'].includes(partKey) && coreValue) ? (
            <View style={styles.filled}>
              <Text style={styles.filledLabel}>Currently on your map</Text>
              <Text style={[styles.filledValue, { color }]}>"{coreValue}"</Text>
            </View>
          ) : null}

          {/* Manager/Firefighter list */}
          {items.length > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              {items.map((it: any, i: number) => (
                <View key={i} style={[styles.listItem, { borderLeftColor: color }]}>
                  <Text style={[styles.listName, { color }]}>{it.label || it.name || 'Unnamed'}</Text>
                  {it.context ? <Text style={styles.listText}>{it.context}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* Empty state */}
          {(!coreValue && items.length === 0) ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{section.emptyLine}</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    maxHeight: '78%',
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
  title: { fontSize: 22, fontWeight: '500', letterSpacing: 0.3 },
  close: { padding: 6 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  subtitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: spacing.sm,
    opacity: 0.9,
  },
  description: {
    color: colors.creamDim,
    fontSize: 14,
    lineHeight: 22,
    fontStyle: 'italic',
  },
  filled: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopColor: colors.border, borderTopWidth: 1 },
  filledLabel: {
    color: colors.creamFaint,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  filledValue: { fontSize: 17, fontStyle: 'italic' },
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
    marginTop: spacing.xl,
    padding: spacing.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  emptyText: {
    color: colors.creamFaint,
    fontSize: 13,
    lineHeight: 20,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
