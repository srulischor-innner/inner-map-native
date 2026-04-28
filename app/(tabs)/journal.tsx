// Journal tab — two private entry kinds, both stored locally only.
//
//   FREE FLOW    — bypass-the-editor stream-of-consciousness writing.
//                  Long guidance text fades to 20% once the user starts
//                  writing or recording, taps to restore.
//   REFLECTION   — slower, more intentional capture of something the
//                  user wants to remember.
//
// Both kinds share the same JournalEntryModal: a full-screen text area
// with a press-and-hold mic for voice → transcript (audio is not saved,
// only the transcript). Free Flow shows a Cormorant italic encouragement
// above the recording indicator; Reflection does not.
//
// Entries are listed below the two New buttons, most-recent first. Tap
// an entry to view; long-press to delete (via Alert.confirm).

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Modal, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { journal, JournalEntry, JournalKind } from '../../services/journal';
import { JournalEntryModal } from '../../components/journal/JournalEntryModal';

export default function JournalScreen() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [composeKind, setComposeKind] = useState<JournalKind | null>(null);
  const [viewing, setViewing] = useState<JournalEntry | null>(null);

  const refresh = useCallback(async () => {
    setEntries(await journal.list());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave(content: string) {
    if (!composeKind) return;
    await journal.add(composeKind, content);
    setComposeKind(null);
    refresh();
  }

  function confirmDelete(id: string) {
    Alert.alert(
      'Delete entry?',
      'This entry will be permanently removed from your journal.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          await journal.remove(id);
          refresh();
        } },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <View style={styles.privateRow}>
        <Ionicons name="lock-closed" size={11} color={colors.creamFaint} />
        <Text style={styles.privateText}>Private — only you can see this</Text>
      </View>

      <Text style={styles.heading}>Journal</Text>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Two New buttons — Free Flow + Reflection. */}
        <View style={styles.cardsRow}>
          <NewEntryCard
            label="Free Flow"
            tagline="Bypass the editor — let it come."
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setComposeKind('freeflow');
            }}
          />
          <NewEntryCard
            label="Reflection"
            tagline="Capture something with intention."
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setComposeKind('deepdive');
            }}
          />
        </View>

        {/* Entry list. */}
        {entries.length === 0 ? (
          <Text style={styles.empty}>
            Your private entries will live here.
          </Text>
        ) : (
          <View style={{ gap: 10, marginTop: spacing.lg }}>
            {entries.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => setViewing(e)}
                onLongPress={() => confirmDelete(e.id)}
                style={styles.entryCard}
              >
                <View style={styles.entryHeader}>
                  <Text style={styles.entryKind}>
                    {e.kind === 'freeflow' ? 'FREE FLOW' : 'REFLECTION'}
                  </Text>
                  <Text style={styles.entryDate}>{formatDate(e.createdAt)}</Text>
                </View>
                <Text style={styles.entryPreview} numberOfLines={3}>
                  {e.content}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Compose modal. */}
      <JournalEntryModal
        visible={!!composeKind}
        kind={composeKind ?? 'freeflow'}
        onClose={() => setComposeKind(null)}
        onSave={handleSave}
      />

      {/* View modal. */}
      <ViewEntryModal
        entry={viewing}
        onClose={() => setViewing(null)}
        onDelete={(id) => { setViewing(null); confirmDelete(id); }}
      />
    </SafeAreaView>
  );
}

function NewEntryCard({
  label, tagline, onPress,
}: { label: string; tagline: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.newCard} accessibilityLabel={`New ${label} entry`}>
      <Text style={styles.newCardLabel}>{label}</Text>
      <Text style={styles.newCardTagline}>{tagline}</Text>
    </Pressable>
  );
}

function ViewEntryModal({
  entry, onClose, onDelete,
}: {
  entry: JournalEntry | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={!!entry}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <View style={[styles.viewTopBar, { paddingTop: insets.top + 14 }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={colors.creamDim} />
          </Pressable>
          <Pressable
            onPress={() => entry && onDelete(entry.id)}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityLabel="Delete entry"
          >
            <Ionicons name="trash-outline" size={20} color={colors.creamDim} />
          </Pressable>
        </View>
        {entry ? (
          <ScrollView contentContainerStyle={styles.viewBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.entryKind}>
              {entry.kind === 'freeflow' ? 'FREE FLOW' : 'REFLECTION'}
            </Text>
            <Text style={[styles.entryDate, { marginBottom: spacing.lg }]}>
              {formatDate(entry.createdAt, true)}
            </Text>
            <Text style={styles.viewContent}>{entry.content}</Text>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function formatDate(iso: string, withTime?: boolean): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  privateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  privateText: {
    color: colors.creamFaint,
    fontSize: 11,
    letterSpacing: 0.5,
  },

  heading: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 42,
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: spacing.lg,
  },

  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  cardsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  newCard: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.45)',
    backgroundColor: 'rgba(230,180,122,0.06)',
  },
  newCardLabel: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  newCardTagline: {
    color: colors.creamDim,
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 13,
    lineHeight: 18,
  },

  empty: {
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    color: 'rgba(240,237,232,0.35)',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },

  entryCard: {
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  entryKind: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.6,
  },
  entryDate: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  entryPreview: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },

  viewTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewBody: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  viewContent: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 26,
  },
});
