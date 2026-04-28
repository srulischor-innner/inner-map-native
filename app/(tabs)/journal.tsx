// Journal tab — private, local-only entries. Two entry kinds:
//   FREE FLOW              — bypass the editor, stream-of-consciousness.
//   DEEP DIVE · FREE       — guided invitation into free association.
//   ASSOCIATION
//
// Layout matches the web app:
//   • Lock + "Private — only you can see this" header
//   • "Journal" Cormorant title + italic subtitle
//   • Two stacked cards (full width)
//   • RECENT ENTRIES section with search + parts filter
//   • Entry cards show small color dots for each detected part
//
// Part detection: a cheap keyword-based heuristic runs at save time —
// see journal.detectParts(). Stored on the entry as detectedParts and
// used by the parts-filter dropdown.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Modal, Alert,
  TextInput, FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { journal, JournalEntry, JournalKind, DetectedPart } from '../../services/journal';
import { JournalEntryModal } from '../../components/journal/JournalEntryModal';

// Part color palette — same source of truth as the map's MAP_STROKE so
// the dots in this list match the nodes on the integrated circle.
const PART_COLOR: Record<DetectedPart, string> = {
  wound:       '#FF5555',
  fixer:       '#F0C070',
  skeptic:     '#90C8E8',
  self:        '#D4B8E8',
  'self-like': '#A090C0',
  manager:     '#A8DCC0',
  firefighter: '#F0A050',
};

const PART_LABEL: Record<DetectedPart, string> = {
  wound:       'Wound',
  fixer:       'Fixer',
  skeptic:     'Skeptic',
  self:        'Self',
  'self-like': 'Self-Like',
  manager:     'Managers',
  firefighter: 'Firefighters',
};

type PartFilter = 'all' | DetectedPart;

export default function JournalScreen() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [composeKind, setComposeKind] = useState<JournalKind | null>(null);
  const [viewing, setViewing] = useState<JournalEntry | null>(null);
  const [search, setSearch] = useState('');
  const [partFilter, setPartFilter] = useState<PartFilter>('all');
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);

  const refresh = useCallback(async () => {
    setEntries(await journal.list());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave(content: string) {
    if (!composeKind) return;
    const detected = journal.detectParts(content);
    await journal.add(composeKind, content, undefined, detected);
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

  // Search + parts filter applied client-side. Entry text is always
  // available locally so this is instant.
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !e.content.toLowerCase().includes(q)) return false;
      if (partFilter !== 'all') {
        const tags = e.detectedParts || [];
        if (!tags.includes(partFilter)) return false;
      }
      return true;
    });
  }, [entries, search, partFilter]);

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== HEADER ===== */}
        <View style={styles.privateRow}>
          <Ionicons name="lock-closed" size={11} color={colors.creamFaint} />
          <Text style={styles.privateText}>Private — only you can see this</Text>
        </View>
        <Text style={styles.heading}>Journal</Text>
        <Text style={styles.subtitle}>A quiet space just for you.</Text>

        {/* ===== ENTRY CARDS ===== */}
        <EntryCard
          label="FREE FLOW"
          title="Just write. No rules. This is yours."
          body="A blank space. Type or speak. No AI, no questions. Whatever is present."
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setComposeKind('freeflow');
          }}
        />
        <EntryCard
          label="DEEP DIVE · FREE ASSOCIATION"
          title="Let the slide open."
          body="A guided invitation into free association — unfiltered, uncensored, whatever comes up."
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setComposeKind('deepdive');
          }}
        />

        {/* ===== RECENT ENTRIES ===== */}
        <View style={styles.recentHeaderWrap}>
          <Text style={styles.recentHeader}>RECENT ENTRIES</Text>
          <View style={styles.recentRule} />
        </View>

        {/* Search + parts filter row. */}
        <View style={styles.filterRow}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search your entries..."
            placeholderTextColor={colors.creamFaint}
            style={styles.searchInput}
            selectionColor={colors.amber}
          />
          <Pressable
            onPress={() => setFilterPickerOpen(true)}
            style={styles.filterPill}
            accessibilityLabel="Filter by part"
            hitSlop={6}
          >
            <Text style={styles.filterPillText} numberOfLines={1}>
              {partFilter === 'all' ? 'All parts' : PART_LABEL[partFilter]}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.amber} />
          </Pressable>
        </View>

        {/* Entry list / empty state. */}
        {visibleEntries.length === 0 ? (
          <Text style={styles.empty}>
            {entries.length === 0
              ? 'No entries yet. Your words will live here.'
              : 'No entries match these filters.'}
          </Text>
        ) : (
          <View style={{ gap: 10 }}>
            {visibleEntries.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => setViewing(e)}
                onLongPress={() => confirmDelete(e.id)}
                style={styles.entryCard}
              >
                <View style={styles.entryHeader}>
                  <Text style={styles.entryKind}>
                    {e.kind === 'freeflow' ? 'FREE FLOW' : 'DEEP DIVE'}
                  </Text>
                  <Text style={styles.entryDate}>{formatDate(e.createdAt)}</Text>
                </View>
                <Text style={styles.entryPreview} numberOfLines={3}>
                  {e.content}
                </Text>
                {e.detectedParts && e.detectedParts.length > 0 ? (
                  <View style={styles.dotsRow}>
                    {e.detectedParts.map((p) => (
                      <View
                        key={p}
                        style={[styles.dot, { backgroundColor: PART_COLOR[p] }]}
                      />
                    ))}
                  </View>
                ) : null}
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

      {/* Parts filter picker — bottom-sheet style action list. */}
      <Modal
        visible={filterPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setFilterPickerOpen(false)}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerHeading}>Filter by part</Text>
            {(['all', 'wound', 'fixer', 'skeptic', 'self-like', 'manager', 'firefighter'] as PartFilter[]).map((opt) => (
              <Pressable
                key={opt}
                onPress={() => { setPartFilter(opt); setFilterPickerOpen(false); }}
                style={[styles.pickerRow, partFilter === opt && styles.pickerRowActive]}
              >
                {opt !== 'all' ? (
                  <View style={[styles.dot, { backgroundColor: PART_COLOR[opt] }]} />
                ) : <View style={styles.dot} />}
                <Text style={styles.pickerRowText}>
                  {opt === 'all' ? 'All parts' : PART_LABEL[opt]}
                </Text>
                {partFilter === opt ? (
                  <Ionicons name="checkmark" size={18} color={colors.amber} style={{ marginLeft: 'auto' }} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================================
function EntryCard({
  label, title, body, onPress,
}: {
  label: string; title: string; body: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.cardOuter} accessibilityLabel={`Start ${label} entry`}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
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
              {entry.kind === 'freeflow' ? 'FREE FLOW' : 'DEEP DIVE'}
            </Text>
            <Text style={[styles.entryDate, { marginBottom: spacing.lg }]}>
              {formatDate(entry.createdAt, true)}
            </Text>
            <Text style={styles.viewContent}>{entry.content}</Text>
            {entry.detectedParts && entry.detectedParts.length > 0 ? (
              <View style={[styles.dotsRow, { marginTop: spacing.lg }]}>
                {entry.detectedParts.map((p) => (
                  <View key={p} style={styles.detectedTag}>
                    <View style={[styles.dot, { backgroundColor: PART_COLOR[p] }]} />
                    <Text style={styles.detectedTagText}>{PART_LABEL[p]}</Text>
                  </View>
                ))}
              </View>
            ) : null}
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

  scrollContent: { paddingBottom: spacing.xxl },

  // ----- header -----
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
    marginBottom: 4,
  },
  subtitle: {
    color: 'rgba(230,180,122,0.55)',
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: spacing.lg,
  },

  // ----- entry cards (Free Flow / Deep Dive) -----
  cardOuter: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardLabel: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 8,
  },
  cardTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  cardBody: {
    color: 'rgba(240,237,232,0.65)',
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
  },

  // ----- recent entries header -----
  recentHeaderWrap: {
    marginTop: spacing.lg,
    marginHorizontal: 16,
    marginBottom: spacing.sm,
  },
  recentHeader: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 6,
  },
  recentRule: {
    height: 0.5,
    backgroundColor: 'rgba(230,180,122,0.25)',
  },

  // ----- search + filter row -----
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.45)',
    backgroundColor: 'rgba(230,180,122,0.06)',
    maxWidth: 130,
  },
  filterPillText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.4,
  },

  // ----- empty state -----
  empty: {
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    color: 'rgba(240,237,232,0.4)',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },

  // ----- entry list cards -----
  entryCard: {
    backgroundColor: colors.backgroundCard,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: 16,
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
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'transparent',
  },

  // ----- view modal -----
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
  viewBody: { padding: spacing.lg, paddingBottom: spacing.xxl },
  viewContent: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 26,
  },
  detectedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  detectedTagText: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
  },

  // ----- parts filter picker (bottom sheet) -----
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#14131A',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(230,180,122,0.35)',
  },
  pickerHeading: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
    paddingHorizontal: 10,
    marginBottom: spacing.sm,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 10,
  },
  pickerRowActive: { backgroundColor: 'rgba(230,180,122,0.08)' },
  pickerRowText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
});
