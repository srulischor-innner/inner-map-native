// Bottom-sheet panel that opens when the user taps a node in the
// integration (Tikun) view. Each part has a short paragraph describing
// what it BECOMES in integration — what the same energy looks like
// once the wound has healed. Different from PartFolderModal: this is
// not a status page, it's a vision.

import React from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radii, spacing } from '../../constants/theme';
import type { IntegrationKey } from './CircleMapCanvas';

type Props = {
  visible: boolean;
  partKey: IntegrationKey | null;
  onClose: () => void;
};

const META: Record<IntegrationKey, { title: string; color: string; body: string }> = {
  wound: {
    title: 'Wound',
    color: '#FF5555',
    body:
      "The place where your deepest sensitivity lives. No longer the center of defense — the source of your capacity to feel deeply, to understand others, to know what matters. The wound transformed is where your most precious gifts come from.",
  },
  fixer: {
    title: 'Fixer',
    color: '#F0C070',
    body:
      "The drive, freed from proving. Still moves forward — now from wholeness rather than from lack. The same energy that was trying to earn worth becomes the energy of genuine contribution. It no longer needs to win. It just moves.",
  },
  skeptic: {
    title: 'Skeptic',
    color: '#90C8E8',
    body:
      "The wisdom, freed from withdrawal. Still discerns — now in service of genuine judgment rather than self-protection. The part that knew something was wrong and refused to pretend otherwise becomes the part that knows what is true and can say so.",
  },
  'self-like': {
    title: 'Self-Like',
    color: '#A090C0',
    body:
      "Still present. Transparent now. The part that was managing and controlling — open rather than clenched — becomes the bridge between your inner world and everything outside it. Da'at serving connection rather than defense. The ego not gone. Just no longer in the way.",
  },
  self: {
    title: 'Self',
    color: '#D4B8E8',
    body:
      "Was always here. Always complete. Now simply visible as what it always was — the center of the whole system. Not a destination you reached. What you are underneath everything that was built on top.",
  },
  manager: {
    title: 'Managers',
    color: '#A8DCC0',
    body:
      "No longer needed for defense. Their intelligence — the strategies, the organization, the vigilance — now available for living rather than protecting. The same capacity, turned toward what you actually want.",
  },
  firefighter: {
    title: 'Firefighters',
    color: '#F0A050',
    body:
      "No longer reaching for relief from pain that isn't there anymore. Their energy now available for genuine pleasure, genuine rest, genuine engagement. The same intensity — now in service of life rather than escape from it.",
  },
};

export function IntegrationPanel({ visible, partKey, onClose }: Props) {
  const insets = useSafeAreaInsets();
  if (!partKey) return null;
  const meta = META[partKey];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: meta.color }]}>{meta.title}</Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close" hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.paragraph}>{meta.body}</Text>
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
    maxHeight: '60%',
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.serifBold,
    fontSize: 26,
    letterSpacing: 0.3,
  },
  close: { padding: 6 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  paragraph: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 26,
  },
});
