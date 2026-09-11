// Journal tab — per-entry privacy. Each entry is either SHARED (synced to the
// server for RAG so the AI can read it as context) or PRIVATE (encrypted, kept
// on this device only, never synced). The choice is made per entry in the
// compose modal and locked at save. Two entry kinds:
//   FREE FLOW              — stream-of-consciousness, no prompt.
//   DEEP DIVE · FREE       — guided invitation into free association.
//   ASSOCIATION
//
// Layout:
//   • Header caption: "Share entries with the AI, or keep them private"
//   • "Journal" Cormorant title + italic subtitle
//   • Two stacked cards (full width)
//   • RECENT ENTRIES section with text search
//
// (The crude local keyword part-tagger and its color-dot / part-filter UI were
// removed with the journal→RAG change. Understanding now comes from the entry
// text via server-side RAG — the AI reads SHARED journals as context and never
// auto-maps from them.)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Modal, Alert, TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { journal, JournalEntry, JournalKind } from '../../services/journal';
import { JournalEntryModal } from '../../components/journal/JournalEntryModal';
import { CrisisResourcesCard } from '../../components/safety/CrisisResourcesCard';

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [composeKind, setComposeKind] = useState<JournalKind | null>(null);
  const [viewing, setViewing] = useState<JournalEntry | null>(null);
  const [search, setSearch] = useState('');
  // CRISIS (server-detected on the synced entry). Set by the onCrisis callback
  // passed into journal.add — it lands AFTER the entry is saved and the
  // compose modal has closed, which is why it needs its own state rather than
  // a return value. `referral` is the server's deterministic text, so the
  // tier-1 / tier-2 / third-party wording can never drift from chat's.
  const [crisis, setCrisis] = useState<{ tier: number | null; referral: string } | null>(null);
  // MODAL CONTENTION — the referral is silently dropped without this.
  // CrisisResourcesCard's modal variant, JournalEntryModal and ViewEntryModal
  // are all RN <Modal>, and RN will not present one while another is
  // dismissing (~300ms animated on iOS). handleSave calls setComposeKind(null)
  // synchronously, so a fast POST resolving inside that window would ask for a
  // second modal mid-dismissal and get nothing. Hold the card until no other
  // modal is up, then wait out the animation. If the person opens compose or
  // an entry before it lands, the card retreats and re-arms rather than being
  // lost — `crisis` is only cleared by an explicit close.
  const [crisisReady, setCrisisReady] = useState(false);

  const refresh = useCallback(async () => {
    setEntries(await journal.list());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!crisis || composeKind || viewing) { setCrisisReady(false); return; }
    const t = setTimeout(() => setCrisisReady(true), 500);
    return () => clearTimeout(t);
  }, [crisis, composeKind, viewing]);

  async function handleSave(content: string, shared: boolean) {
    if (!composeKind) return;
    // setCrisis is passed as the onCrisis callback, NOT awaited. The save and
    // the modal close stay exactly as fast as they are today and an offline
    // save is unchanged; if the server's ack carries a referral it arrives a
    // moment later and opens the resources card over the journal list.
    await journal.add(composeKind, content, undefined, shared, setCrisis);
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

  // Text search applied client-side. Entry text is always available locally
  // so this is instant.
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.content.toLowerCase().includes(q));
  }, [entries, search]);

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* CRISIS — the same tappable card Map Voice surfaces when the server
          flags a turn. The header says the entry SAVED, because the first
          thing a person needs to know is that their writing was not lost or
          refused; the lede is the server's deterministic referral text. No
          acknowledge button and no gate: this surface refers and does not
          hold, so the X is the whole exit by design. */}
      <CrisisResourcesCard
        asModal
        visible={!!crisis && crisisReady}
        onClose={() => setCrisis(null)}
        header="Your entry is saved"
        lede={crisis?.referral}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing.xxl + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== HEADER ===== */}
        <View style={styles.privateRow}>
          <Text style={styles.privateText}>Share entries with the AI, or keep them private</Text>
        </View>
        <Text style={styles.heading}>Journal</Text>
        <Text style={styles.subtitle}>A space for whatever's present.</Text>

        {/* ===== ENTRY CARDS ===== */}
        <EntryCard
          label="FREE FLOW"
          title="Just write. No rules. This is yours."
          body="A blank space. Type or speak — whatever is present. Share it with the AI to add to your map, or keep it private."
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setComposeKind('freeflow');
          }}
        />
        <EntryCard
          label="DEEP DIVE · FREE ASSOCIATION"
          title="Let the slide open."
          body="A guided invitation into free association — unfiltered, whatever comes up."
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

        {/* Search row. */}
        <View style={styles.searchRow}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search your entries..."
            placeholderTextColor={colors.creamFaint}
            style={styles.searchInput}
            selectionColor={colors.amber}
          />
        </View>

        {/* Entry list / empty state. */}
        {visibleEntries.length === 0 ? (
          <Text style={styles.empty}>
            {entries.length === 0
              ? 'No entries yet. Your words will live here.'
              : 'No entries match your search.'}
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

  // ----- search row -----
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
});
