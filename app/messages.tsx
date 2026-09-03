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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, TextInput,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, fonts, spacing } from '../constants/theme';
import { api, InboxMessage } from '../services/api';
import { refreshInboxStatus } from '../services/messagesInbox';
import { getInboxPushOptIn, enableInboxPush } from '../services/push';
import { useKeyboardInset } from '../utils/useKeyboardInset';

// One-time contextual opt-in prompt: shown the first time the user opens the
// inbox with a card present and hasn't opted in. Declining is permanent-quiet
// (they can still enable in Settings). Once-ever flag.
const PUSH_PROMPT_SEEN_KEY = 'push.inboxPromptSeen';

export default function MessagesScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [showPushPrompt, setShowPushPrompt] = useState(false);

  // Keyboard avoidance for the per-item EDIT fields (enrichment +
  // pending_parts cards). Manual lift via useKeyboardInset — the app-wide
  // pattern (adjustResize is a no-op under Android 15 edge-to-edge, and iOS
  // never resizes; see utils/useKeyboardInset.ts). The inset pads the scroll
  // content so the covered region becomes scrollable, and ensureEditVisible
  // scrolls the focused field (plus its action row) above the keyboard.
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const kbInset = useKeyboardInset();
  const kbRef = useRef(0);
  kbRef.current = kbInset;

  const ensureEditVisible = useCallback((node: { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null) => {
    const attempt = () => {
      node?.measureInWindow?.((x, y, w, h) => {
        const visibleBottom = Dimensions.get('window').height - kbRef.current;
        // +96 keeps the ADD/DONE action row under the field reachable too.
        const overlap = y + h + 96 - visibleBottom;
        if (overlap > 0) {
          scrollRef.current?.scrollTo({ y: scrollYRef.current + overlap, animated: true });
        }
      });
    };
    // Two passes: immediately (iOS keyboardWillShow has already set the
    // inset) and after the keyboard animation settles (Android only emits
    // keyboardDidShow, so the first pass can run before the inset exists).
    requestAnimationFrame(attempt);
    setTimeout(attempt, 350);
  }, []);

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
    // One-time opt-in offer: only with a card present, only if not already
    // opted in, and only once ever.
    if (list.length) {
      try {
        const [optedIn, seen] = await Promise.all([
          getInboxPushOptIn(),
          AsyncStorage.getItem(PUSH_PROMPT_SEEN_KEY),
        ]);
        if (!optedIn && seen !== '1') setShowPushPrompt(true);
      } catch {}
    }
  }, []);

  // Dismiss the one-time prompt. Either choice marks it seen forever
  // (permanent-quiet); "enable" additionally runs the OS permission ask.
  const dismissPushPrompt = useCallback(async (enable: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    setShowPushPrompt(false);
    try { await AsyncStorage.setItem(PUSH_PROMPT_SEEN_KEY, '1'); } catch {}
    if (enable) { try { await enableInboxPush(); } catch {} }
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
        <ScrollView
          ref={scrollRef}
          onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.body, kbInset > 0 && { paddingBottom: kbInset + spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          {showPushPrompt ? (
            <View style={styles.pushPrompt}>
              <Text style={styles.pushPromptTitle}>Want to know when something's waiting here?</Text>
              <Text style={styles.pushPromptSub}>
                A quiet heads-up — never what it is, only that something arrived.
              </Text>
              <View style={styles.pushPromptRow}>
                <Pressable onPress={() => dismissPushPrompt(false)} hitSlop={8} style={styles.pushPromptDismiss}>
                  <Text style={styles.pushPromptDismissText}>Not now</Text>
                </Pressable>
                <Pressable onPress={() => dismissPushPrompt(true)} hitSlop={8} style={styles.pushPromptEnable}>
                  <Text style={styles.pushPromptEnableText}>Enable</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {messages.map((m) =>
            m.kind === 'pending_parts' ? (
              <PendingPartsCard key={m.id} message={m} onEditFocus={ensureEditVisible} />
            ) : m.kind === 'enrichment' ? (
              <EnrichmentCard key={m.id} message={m} onEditFocus={ensureEditVisible} />
            ) : m.kind === 'middle_ground' ? (
              <PendingPartsCard key={m.id} message={m} onEditFocus={ensureEditVisible} variant={MIDDLE_GROUND_VARIANT} />
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

type EditFocusHandler = (node: { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null) => void;

// TWO CARDS, ONE MECHANISM (2026-09-02). middle_ground cards were being written
// by the server, replicated, and pushed -- and then rendered by NoteCard, which
// reads only payload.title and payload.body. A middle_ground payload has neither;
// it has {items:[{label,note,status}]}. So every one displayed as a card reading
// "NOTE" with an empty body, and the accept branch at server.js:13773 -- the
// filing consent for ruling 2026-08-19e -- could never be reached. A consent
// surface nobody can tap is not a consent surface.
//
// The accept / edit / decline flow is identical for both kinds; only the field
// name and the copy differ. Parameterised rather than duplicated, so the two
// cards cannot drift into two different consent behaviours.
type CardVariant = {
  kicker: (m: InboxMessage) => string;
  lede: string;
  labelOf: (it: any) => string;
  editedOf: (it: any) => string | undefined;
  subOf: (it: any) => string | null;
  categoryOf: (it: any) => string | null;
  acceptText: string;
  acceptingText: string;
  acceptedText: string;
  editA11y: string;
};

const PENDING_PARTS_VARIANT: CardVariant = {
  kicker: (m) =>
    m.payload.source === 'journal'
      ? `FROM A JOURNAL ENTRY${m.payload.entryDate ? ` \u00b7 ${m.payload.entryDate}` : ''}`
      : `FROM A PAST SESSION${m.payload.sessionDate ? ` \u00b7 ${m.payload.sessionDate}` : ''}`,
  lede: 'A few things surfaced that might belong on your map:',
  labelOf: (it) => it.name || '',
  editedOf: (it) => it.editedName,
  subOf: (it) => it.context || null,
  categoryOf: (it) => it.part || null,
  acceptText: 'ADD TO MAP',
  acceptingText: 'ADDING\u2026',
  acceptedText: 'Added to your map.',
  editA11y: 'Edit the part name',
};

// Middle ground is a place the person described standing, in their own words --
// not a part. So: no category chip, and copy about keeping something they said
// rather than adding something we noticed.
const MIDDLE_GROUND_VARIANT: CardVariant = {
  kicker: (m) => `FROM A PAST SESSION${m.payload.sessionDate ? ` \u00b7 ${m.payload.sessionDate}` : ''}`,
  lede: 'You described somewhere you can stand that isn\u2019t either side:',
  labelOf: (it) => it.label || '',
  editedOf: (it) => it.editedLabel,
  subOf: (it) => it.note || null,
  categoryOf: () => null,
  acceptText: 'KEEP THIS',
  acceptingText: 'KEEPING\u2026',
  acceptedText: 'Kept on your map.',
  editA11y: 'Edit the wording',
};

function PendingPartsCard({ message, onEditFocus, variant = PENDING_PARTS_VARIANT }: { message: InboxMessage; onEditFocus?: EditFocusHandler; variant?: CardVariant }) {
  const editInputRef = useRef<TextInput>(null);
  const items = message.payload.items || [];
  const [states, setStates] = useState<ItemState[]>(
    items.map((it) =>
      it.status === 'accepted' || it.status === 'declined' ? it.status : 'pending',
    ),
  );
  const [names, setNames] = useState<string[]>(items.map((it) => variant.editedOf(it) || variant.labelOf(it)));
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  function setItemState(i: number, s: ItemState) {
    setStates((prev) => prev.map((v, j) => (j === i ? s : v)));
  }

  async function accept(i: number) {
    if (states[i] !== 'pending') return;
    setItemState(i, 'sending');
    Haptics.selectionAsync().catch(() => {});
    const trimmed = names[i].trim();
    const edits = trimmed && trimmed !== variant.labelOf(items[i]) ? { [i]: trimmed } : undefined;
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
      <Text style={styles.cardKicker}>{variant.kicker(message)}</Text>
      <Text style={styles.cardLede}>{variant.lede}</Text>
      {items.map((it, i) => {
        const st = states[i];
        const editing = editingIdx === i;
        return (
          <View key={`${message.id}-${i}`} style={styles.noticedItem}>
            {editing ? (
              <TextInput
                ref={editInputRef}
                value={names[i]}
                onChangeText={(t) => setNames((prev) => prev.map((v, j) => (j === i ? t : v)))}
                style={styles.itemNameInput}
                selectionColor={colors.amber}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => setEditingIdx(null)}
                onFocus={() => onEditFocus?.(editInputRef.current)}
                accessibilityLabel={variant.editA11y}
              />
            ) : (
              <Text style={[styles.itemName, st === 'declined' && styles.itemNameDim]}>
                {names[i]}
                {variant.categoryOf(it) ? (
                  <Text style={styles.itemCategory}>  ·  {variant.categoryOf(it)}</Text>
                ) : null}
              </Text>
            )}
            {variant.subOf(it) ? <Text style={styles.itemContext}>{variant.subOf(it)}</Text> : null}

            {st === 'accepted' ? (
              <View style={styles.itemResolvedRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.amber} />
                <Text style={styles.itemResolvedText}>{variant.acceptedText}</Text>
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
                  accessibilityLabel={`${variant.acceptText} — ${names[i]}`}
                >
                  <Text style={styles.itemBtnAcceptText}>{st === 'sending' ? variant.acceptingText : variant.acceptText}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setEditingIdx(editing ? null : i)}
                  disabled={st === 'sending'}
                  style={[styles.itemBtn, st === 'sending' && styles.itemBtnDim]}
                  accessibilityLabel={variant.editA11y}
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

// One enrichment message: new facets of parts already on the map, surfaced
// when the in-session consent handshake hadn't happened. Same per-item
// accept/edit/decline machinery as PendingPartsCard (same endpoints), but
// EDIT refines the facet VALUE, and accepting appends to the part's folder
// rather than creating anything new.
const ENRICH_FACET_LABEL: Record<string, string> = {
  trigger: 'trigger', body: 'where it lives', situation: 'situation',
  example: 'example', voice: 'phrase', manner: 'way of speaking',
  worldview: 'worldview', story: 'story it carries', memory: 'memory',
};

function EnrichmentCard({ message, onEditFocus }: { message: InboxMessage; onEditFocus?: EditFocusHandler }) {
  const editInputRef = useRef<TextInput>(null);
  const items = message.payload.items || [];
  const [states, setStates] = useState<ItemState[]>(
    items.map((it) =>
      it.status === 'accepted' || it.status === 'declined' ? it.status : 'pending',
    ),
  );
  const [values, setValues] = useState<string[]>(items.map((it) => it.editedValue || it.value || ''));
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  function setItemState(i: number, s: ItemState) {
    setStates((prev) => prev.map((v, j) => (j === i ? s : v)));
  }

  async function accept(i: number) {
    if (states[i] !== 'pending') return;
    setItemState(i, 'sending');
    Haptics.selectionAsync().catch(() => {});
    const trimmed = values[i].trim();
    const edits = trimmed && trimmed !== items[i].value ? { [i]: trimmed } : undefined;
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
        {`YOUR PARTS, IN MORE DETAIL${message.payload.sessionDate ? ` · ${message.payload.sessionDate}` : ''}`}
      </Text>
      <Text style={styles.cardLede}>
        New facets of parts already on your map surfaced in conversation. Keep what fits:
      </Text>
      {items.map((it, i) => {
        const st = states[i];
        const editing = editingIdx === i;
        const partName = it.label || it.part;
        const facetLabel = ENRICH_FACET_LABEL[it.field || ''] || it.field || 'detail';
        return (
          <View key={`${message.id}-${i}`} style={styles.noticedItem}>
            <Text style={[styles.itemName, st === 'declined' && styles.itemNameDim]}>
              {partName}
              <Text style={styles.itemCategory}>  ·  new {facetLabel}</Text>
            </Text>
            {editing ? (
              <TextInput
                ref={editInputRef}
                value={values[i]}
                onChangeText={(t) => setValues((prev) => prev.map((v, j) => (j === i ? t : v)))}
                style={styles.itemNameInput}
                selectionColor={colors.amber}
                autoFocus
                multiline
                returnKeyType="done"
                onSubmitEditing={() => setEditingIdx(null)}
                onFocus={() => onEditFocus?.(editInputRef.current)}
                accessibilityLabel="Edit the facet wording"
              />
            ) : (
              <Text style={styles.itemContext}>{values[i]}</Text>
            )}

            {st === 'accepted' ? (
              <View style={styles.itemResolvedRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.amber} />
                <Text style={styles.itemResolvedText}>Added to the part’s folder.</Text>
              </View>
            ) : st === 'declined' ? (
              <View style={styles.itemResolvedRow}>
                <Ionicons name="close-circle-outline" size={15} color={colors.creamFaint} />
                <Text style={styles.itemResolvedTextDim}>Doesn’t fit — dismissed.</Text>
              </View>
            ) : (
              <View style={styles.itemActionRow}>
                <Pressable
                  onPress={() => accept(i)}
                  disabled={st === 'sending'}
                  style={[styles.itemBtnAccept, st === 'sending' && styles.itemBtnDim]}
                  accessibilityLabel={`Add this ${facetLabel} to ${partName}`}
                >
                  <Text style={styles.itemBtnAcceptText}>{st === 'sending' ? 'ADDING…' : 'ADD TO PART'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setEditingIdx(editing ? null : i)}
                  disabled={st === 'sending'}
                  style={[styles.itemBtn, st === 'sending' && styles.itemBtnDim]}
                  accessibilityLabel="Edit the facet wording"
                >
                  <Text style={styles.itemBtnText}>{editing ? 'DONE' : 'EDIT'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => decline(i)}
                  disabled={st === 'sending'}
                  style={[styles.itemBtn, st === 'sending' && styles.itemBtnDim]}
                  accessibilityLabel="Dismiss this facet"
                >
                  <Text style={styles.itemBtnTextDim}>Doesn’t fit</Text>
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

  // One-time contextual opt-in prompt. Quiet amber card matching the inbox
  // register — no urgency, no color alarm.
  pushPrompt: {
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.28)',
    backgroundColor: 'rgba(230,180,122,0.06)',
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pushPromptTitle: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    marginBottom: 4,
  },
  pushPromptSub: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
  },
  pushPromptRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  pushPromptDismiss: { paddingVertical: 6, paddingHorizontal: 12, marginRight: 6 },
  pushPromptDismissText: { color: colors.creamFaint, fontFamily: fonts.sans, fontSize: 13 },
  pushPromptEnable: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(230,180,122,0.18)',
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.4)',
  },
  pushPromptEnableText: { color: colors.amber, fontFamily: fonts.sansBold, fontSize: 13 },

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
