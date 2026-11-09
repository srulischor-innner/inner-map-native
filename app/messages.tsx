// Messages — the in-app inbox, reached from the hamburger menu.
//
// Where things wait: the M2 cards the idle pass proposes, cards not tapped
// in the chat, anything drawn from a shared journal entry, plus read-only
// notes. Every card is the M2 card (components/m2/M2Cards), the same one the
// chat screen shows; rows of the old kinds (pending_parts, enrichment,
// middle_ground) made before M2 are drawn as that card too
// (services/m2.ts legacyRowAsM2). ADD fires the act endpoint, which writes
// through the server's own path for that kind — the tap IS the consent.
//
// Visual language matches the rest of the app: dark background,
// serif headers, amber accents, calm spacing. Messages expire after
// 14 days server-side (auto-archived, never re-asked).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
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
import { M2_CARD_KIND, isLegacyCardKind, legacyRowAsM2 } from '../services/m2';
import { M2InboxCard } from '../components/m2/M2Cards';
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

  // Keyboard avoidance for the M2 card's EDIT fields (every card in
  // Messages since build 55). Manual lift via useKeyboardInset — the app-wide
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
            After a conversation goes quiet, anything it recognised for your
            map comes here, along with any card you didn't tap.
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
            m.kind === M2_CARD_KIND ? (
              // M2: the same card the chat screen shows (components/m2/M2Cards),
              // so a card in both places behaves the same in both.
              <M2InboxCard key={m.id} message={m} onEditFocus={ensureEditVisible} />
            ) : isLegacyCardKind(m.kind) ? (
              // An old pending_parts / enrichment / middle_ground row, made
              // before M2: drawn as the same M2 card, same id and item indices
              // (services/m2.ts legacyRowAsM2). The old kicker, the raw
              // "{name} · {part}" lines and the enrichment card are retired
              // (founder's copy v2, 2026-11-09).
              <M2InboxCard key={m.id} message={legacyRowAsM2(m) ?? m} onEditFocus={ensureEditVisible} />
            ) : (
              <NoteCard key={m.id} message={m} />
            ),
          )}
        </ScrollView>
      )}
    </SafeAreaView>
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
