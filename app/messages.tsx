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
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
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

// One actionable pending_parts message: items + checkboxes + Add to map.
function PendingPartsCard({ message }: { message: InboxMessage }) {
  const items = message.payload.items || [];
  const [checked, setChecked] = useState<boolean[]>(items.map(() => true));
  const [state, setState] = useState<'idle' | 'sending' | 'done'>(
    message.actedAt ? 'done' : 'idle',
  );
  const [writtenCount, setWrittenCount] = useState(0);

  const anyChecked = checked.some(Boolean);

  async function submit() {
    if (state !== 'idle' || !anyChecked) return;
    setState('sending');
    Haptics.selectionAsync().catch(() => {});
    const indices = checked.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    const res = await api.actOnMessage(message.id, indices);
    if (res.ok) {
      setWrittenCount(res.written);
      setState('done');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      refreshInboxStatus(true).catch(() => {});
    } else {
      setState('idle');
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardKicker}>FROM A PAST SESSION{message.payload.sessionDate ? ` · ${message.payload.sessionDate}` : ''}</Text>
      <Text style={styles.cardLede}>
        A few things surfaced that might belong on your map:
      </Text>
      {items.map((it, i) => (
        <Pressable
          key={`${message.id}-${i}`}
          style={styles.itemRow}
          disabled={state !== 'idle'}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setChecked((prev) => prev.map((c, j) => (j === i ? !c : c)));
          }}
        >
          <View style={[styles.checkbox, checked[i] && state !== 'done' && styles.checkboxOn, state === 'done' && styles.checkboxDone]}>
            {checked[i] ? (
              <Ionicons name="checkmark" size={13} color={state === 'done' ? colors.creamFaint : colors.background} />
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>
              {it.name}
              <Text style={styles.itemCategory}>  ·  {it.part}</Text>
            </Text>
            {it.context ? <Text style={styles.itemContext}>{it.context}</Text> : null}
          </View>
        </Pressable>
      ))}
      {state === 'done' ? (
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={16} color={colors.amber} />
          <Text style={styles.doneText}>
            {message.actedAt && !writtenCount
              ? 'Already added to your map.'
              : `Added to your map${writtenCount ? ` (${writtenCount})` : ''}.`}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={submit}
          disabled={!anyChecked || state === 'sending'}
          style={[styles.addBtn, (!anyChecked || state === 'sending') && styles.addBtnDim]}
          accessibilityLabel="Add selected to map"
        >
          <Text style={styles.addBtnText}>
            {state === 'sending' ? 'ADDING…' : 'ADD TO MAP'}
          </Text>
        </Pressable>
      )}
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
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, marginTop: 2,
    borderColor: colors.amberDim, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  checkboxDone: { borderColor: colors.creamFaint, backgroundColor: 'transparent' },
  itemName: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
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
  addBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.05)',
  },
  addBtnDim: { opacity: 0.4 },
  addBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  doneText: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
  },
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
