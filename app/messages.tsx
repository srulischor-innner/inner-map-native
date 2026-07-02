// Messages — the in-app inbox, reached from the hamburger menu.
//
// Catches parts the AI noticed in sessions that never reached the
// end-session flow (kind 'pending_parts' — created by the server's
// abandoned-session sweep), plus general read-only notes. Each
// pending_parts message shows the parked items with their context
// lines and checkboxes; "Add to map" fires the act endpoint, which
// writes the consented subset through the normal parts path
// (confidence 'confirmed' — the tap IS the consent).
//
// Visual language matches the rest of the app: dark background,
// serif headers, amber accents, calm spacing. Messages expire after
// 14 days server-side (auto-archived, never re-asked).

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../constants/theme';
import { api, InboxMessage } from '../services/api';
import { refreshInboxStatus } from '../services/messagesInbox';

export default function MessagesScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<InboxMessage[]>([]);

  const load = useCallback(async () => {
    const { messages: list } = await api.listMessages();
    setMessages(list);
    setLoading(false);
    // Mark everything read on open — the badge is "you have mail," not
    // a per-item nag. Items stay actionable until acted or expired.
    const unread = list.filter((m) => !m.readAt);
    for (const m of unread) {
      api.markMessageRead(m.id).catch(() => {});
    }
    if (unread.length) refreshInboxStatus(true).catch(() => {});
  }, []);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.creamDim} />
        </Pressable>
        <Text style={styles.title}>Messages</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.amber} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="file-tray-outline" size={28} color={colors.creamFaint} />
          <Text style={styles.emptyText}>Nothing waiting.</Text>
          <Text style={styles.emptySub}>
            When something surfaces in a conversation that might belong on
            your map and the session ends before it's asked, it lands here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {messages.map((m) =>
            m.kind === 'pending_parts' ? (
              <PendingPartsCard key={m.id} message={m} />
            ) : (
              <NoteCard key={m.id} message={m} />
            ),
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// One pending_parts message: each noticed item is its own row with
// Accept / Edit / "Doesn't resonate". Per-item — the card stays in the inbox
// until EVERY item is resolved (accepted or declined). Nothing the AI noticed
// is lost. (MICROCOPY here — "ADD TO MAP" / "EDIT" / "Doesn't resonate" /
// resolved lines — is flagged for the copy pass.)
type ItemState = 'pending' | 'sending' | 'accepted' | 'declined';

function PendingPartsCard({ message }: { message: InboxMessage }) {
  const items = message.payload.items || [];
  const [states, setStates] = useState<ItemState[]>(
    items.map((it) =>
      it.status === 'accepted' || it.status === 'declined' ? it.status : 'pending',
    ),
  );
  const [names, setNames] = useState<string[]>(items.map((it) => it.editedName || it.name));
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  function setItemState(i: number, s: ItemState) {
    setStates((prev) => prev.map((v, j) => (j === i ? s : v)));
  }

  async function accept(i: number) {
    if (states[i] !== 'pending') return;
    setItemState(i, 'sending');
    Haptics.selectionAsync().catch(() => {});
    const trimmed = names[i].trim();
    const edits = trimmed && trimmed !== items[i].name ? { [i]: trimmed } : undefined;
    const res = await api.actOnMessage(message.id, [i], edits);
    setItemState(i, res.ok ? 'accepted' : 'pending');
    if (res.ok) {
      if (editingIdx === i) setEditingIdx(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      refreshInboxStatus(true).catch(() => {});
    }
  }

  async function decline(i: number) {
    if (states[i] !== 'pending') return;
    setItemState(i, 'sending');
    Haptics.selectionAsync().catch(() => {});
    const res = await api.declineMessageItems(message.id, [i]);
    setItemState(i, res.ok ? 'declined' : 'pending');
    if (res.ok) {
      if (editingIdx === i) setEditingIdx(null);
      refreshInboxStatus(true).catch(() => {});
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardKicker}>
        {message.payload.source === 'journal'
          ? `FROM A JOURNAL ENTRY${message.payload.entryDate ? ` · ${message.payload.entryDate}` : ''}`
          : `FROM A PAST SESSION${message.payload.sessionDate ? ` · ${message.payload.sessionDate}` : ''}`}
      </Text>
      <Text style={styles.cardLede}>A few things surfaced that might belong on your map:</Text>
      {items.map((it, i) => {
        const st = states[i];
        const editing = editingIdx === i;
        return (
          <View key={`${message.id}-${i}`} style={styles.noticedItem}>
            {editing ? (
              <TextInput
                value={names[i]}
                onChangeText={(t) => setNames((prev) => prev.map((v, j) => (j === i ? t : v)))}
                style={styles.itemNameInput}
                selectionColor={colors.amber}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => setEditingIdx(null)}
                accessibilityLabel="Edit the part name"
              />
            ) : (
              <Text style={[styles.itemName, st === 'declined' && styles.itemNameDim]}>
                {names[i]}
                <Text style={styles.itemCategory}>  ·  {it.part}</Text>
              </Text>
            )}
            {it.context ? <Text style={styles.itemContext}>{it.context}</Text> : null}

            {st === 'accepted' ? (
              <View style={styles.itemResolvedRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.amber} />
                <Text style={styles.itemResolvedText}>Added to your map.</Text>
              </View>
            ) : st === 'declined' ? (
              <View style={styles.itemResolvedRow}>
                <Ionicons name="close-circle-outline" size={15} color={colors.creamFaint} />
                <Text style={styles.itemResolvedTextDim}>Doesn’t resonate — dismissed.</Text>
              </View>
            ) : (
              <View style={styles.itemActionRow}>
                <Pressable
                  onPress={() => accept(i)}
                  disabled={st === 'sending'}
                  style={[styles.itemBtnAccept, st === 'sending' && styles.itemBtnDim]}
                  accessibilityLabel={`Add ${names[i]} to your map`}
                >
                  <Text style={styles.itemBtnAcceptText}>{st === 'sending' ? 'ADDING…' : 'ADD TO MAP'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setEditingIdx(editing ? null : i)}
                  disabled={st === 'sending'}
                  style={[styles.itemBtn, st === 'sending' && styles.itemBtnDim]}
                  accessibilityLabel="Edit the part name"
                >
                  <Text style={styles.itemBtnText}>{editing ? 'DONE' : 'EDIT'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => decline(i)}
                  disabled={st === 'sending'}
                  style={[styles.itemBtn, st === 'sending' && styles.itemBtnDim]}
                  accessibilityLabel={`Dismiss ${names[i]}`}
                >
                  <Text style={styles.itemBtnTextDim}>Doesn’t resonate</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// Read-only system_note / release_note rendering.
function NoteCard({ message }: { message: InboxMessage }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardKicker}>
        {message.kind === 'release_note' ? 'WHAT’S NEW' : 'NOTE'}
      </Text>
      {message.payload.title ? <Text style={styles.noteTitle}>{message.payload.title}</Text> : null}
      <Text style={styles.noteBody}>{message.payload.body || ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    letterSpacing: 0.4,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    marginTop: spacing.md,
  },
  emptySub: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  body: { padding: spacing.md, paddingBottom: spacing.xxl },

  card: {
    borderWidth: 0.5,
    borderColor: colors.border,
    backgroundColor: 'rgba(230,180,122,0.04)',
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardKicker: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  cardLede: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  // ----- per-item noticed rows (Accept / Edit / Doesn't resonate) -----
  noticedItem: {
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  itemName: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
  },
  itemNameDim: {
    color: colors.creamFaint,
    textDecorationLine: 'line-through',
  },
  itemNameInput: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(230,180,122,0.5)',
    paddingVertical: 2,
  },
  itemCategory: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12,
  },
  itemContext: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  itemActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 10,
  },
  itemBtn: { paddingVertical: 6 },
  itemBtnDim: { opacity: 0.4 },
  itemBtnAccept: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.05)',
  },
  itemBtnAcceptText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  itemBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  itemBtnTextDim: {
    color: colors.creamFaint,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  itemResolvedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  itemResolvedText: { color: colors.creamDim, fontFamily: fonts.sans, fontSize: 13 },
  itemResolvedTextDim: { color: colors.creamFaint, fontFamily: fonts.sans, fontSize: 13 },
  noteTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 17,
    marginBottom: 4,
  },
  noteBody: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
  },
});
