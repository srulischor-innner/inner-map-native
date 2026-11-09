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
import { colors, fonts, radii, spacing, serifInkSlack } from '../../constants/theme';
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
      "The place your deepest sensitivity lives. Underneath what it carries is a part of you that was made for something: often the very thing the hurt is about. Held rather than defended, it's where your capacity to feel, to understand others and to know what matters comes from.",
  },
  fixer: {
    title: 'Fixer',
    color: '#F0C070',
    body:
      "The drive, no longer having to prove anything, and still yours. The force that was pressed into earning your worth shows what you're capable of; standing in what you are, it moves because it wants to, not because it has to.",
  },
  skeptic: {
    title: 'Skeptic',
    color: '#90C8E8',
    body:
      "The discernment, no longer having to brace, and still yours. The part that refused to be fooled, that wouldn't settle for a version of you that wasn't real, becomes the part that knows what's true and can say so.",
  },
  'self-like': {
    title: 'You',
    color: '#A090C0',
    body:
      "Still here, and no longer only keeping the peace. You are the one everything arrives at and the one who chooses where to stand. Standing in what you are rather than in the hurt, you lead both sides instead of brokering between them.",
  },
  self: {
    title: 'Self',
    color: '#D4B8E8',
    body:
      "Was always here, always whole. Not somewhere you arrive; what you are underneath everything built on top, and what gets lived, a little more each time, the more you stand there.",
  },
  manager: {
    title: 'Managers',
    color: '#A8DCC0',
    body:
      "Still watchful, no longer on duty alone. Their intelligence, the strategies, the order, the attention, is available for living rather than only for protecting. The same capacity, turned toward what you actually want.",
  },
  firefighter: {
    title: 'Firefighters',
    color: '#F0A050',
    body:
      "Still quick, no longer only putting out fires. Their intensity, which reached for relief when the hurt broke through, is available for real pleasure, real rest, real engagement. The hurt is still yours; how it's held has changed.",
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
    // This panel also has a part titled "Self", in a flexDirection:'row'
    // header, which shrink-wraps on the horizontal axis exactly like the
    // Guide slide did. alignSelf:'stretch' would change the HEIGHT here,
    // so the room goes on as padding instead. Left-aligned in a
    // space-between row, so nothing shifts.
    paddingRight: serifInkSlack(26, 0.3),
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
