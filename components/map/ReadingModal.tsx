// ============================================================================
// THE READING SCREEN (cycle 3, founder ruling 2026-08-21k).
//
// Renders the document the server wrote. It does NOT interpret it: the module
// layer already guaranteed the structure (headers repaired, arrival written,
// quotes scanned, coinages spelled as stored), so this file's only job is to
// show the text with its section breaks intact and get out of the way.
//
// Six sections, an opening frame with no heading, and a closing paragraph with
// no heading. The renderer treats "## " lines as section titles and everything
// else as body — nothing more clever, because anything cleverer would be a
// second place where the document's shape is decided.
//
// SHARING goes through confirmReadingShare (utils/sessionExport). The reading
// has no separable part — it is one document or nothing — so the confirm
// carries a single affirmative, and it names what is being sent before the OS
// sheet opens.
// ============================================================================
import React, { useCallback, useMemo } from 'react';
import {
  Modal, View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { confirmReadingShare, shareReadingText } from '../../utils/sessionExport';

type Block = { kind: 'heading' | 'para'; text: string };

function parseReading(body: string): Block[] {
  return String(body || '')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (/^#{1,6}\s+/.test(chunk)
      ? { kind: 'heading' as const, text: chunk.replace(/^#{1,6}\s+/, '').trim() }
      : { kind: 'para' as const, text: chunk }));
}

export function ReadingModal({
  visible, body, createdAt, onClose,
}: {
  visible: boolean;
  body: string | null;
  createdAt?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const blocks = useMemo(() => (body ? parseReading(body) : []), [body]);

  const dateLine = useMemo(() => {
    if (!createdAt) return null;
    try {
      return new Date(createdAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch { return null; }
  }, [createdAt]);

  const onShare = useCallback(async () => {
    if (!body) return;
    Haptics.selectionAsync().catch(() => {});
    const ok = await confirmReadingShare();
    if (!ok) return;
    await shareReadingText(body);
  }, [body]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close reading">
            <Ionicons name="chevron-down" size={22} color="rgba(255,255,255,0.55)" />
          </Pressable>
          <Pressable onPress={onShare} hitSlop={12} accessibilityLabel="Forward this reading">
            <Ionicons name="share-outline" size={20} color="rgba(230,180,122,0.6)" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.docTitle}>What your map means</Text>
          {dateLine ? <Text style={styles.docDate}>{dateLine}</Text> : null}
          {blocks.map((b, i) => (
            b.kind === 'heading'
              ? <Text key={i} style={styles.heading}>{b.text}</Text>
              : <Text key={i} style={styles.para}>{b.text}</Text>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d10' },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 8,
  },
  // width:100% on the content container, and stretch on every text block
  // below, for the same reason as MessageBubble.text: under Fabric a Text with
  // no explicit width is measured at its single-line intrinsic width and then
  // clipped by the parent. The reading is long-form prose, so it is the surface
  // where that shows up most.
  body: { paddingHorizontal: 24, paddingTop: 8, width: "100%" },
  docTitle: { color: 'rgba(230,180,122,0.92)', fontSize: 22, letterSpacing: 0.3, alignSelf: 'stretch' },
  docDate: { color: 'rgba(255,255,255,0.38)', fontSize: 12, marginTop: 4, marginBottom: 18, alignSelf: 'stretch' },
  heading: {
    color: 'rgba(230,180,122,0.85)', fontSize: 15, letterSpacing: 0.6,
    textTransform: 'uppercase', marginTop: 26, marginBottom: 8, alignSelf: 'stretch',
  },
  para: { color: 'rgba(255,255,255,0.82)', fontSize: 15.5, lineHeight: 25, marginBottom: 14, alignSelf: 'stretch' },
});
