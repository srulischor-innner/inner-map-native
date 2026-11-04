// THE PENDING MAP CARD (M2) — what a yes in chat turns into.
//
// Under M2 the chat never writes the map. When the person says yes to
// something the chat offered, the pass turns that yes into a card, and this is
// where it shows: at the end of the conversation, under the reply, until they
// tap it. Their tap is the write. Until then the card says plainly that it is
// waiting for them, so nothing reads as saved that is not.
//
// It stays at the end of the thread as the conversation goes on, rather than
// scrolling away with the turn it came from: a card the person has to hunt for
// is a card that expires in Messages unseen. It is still in Messages too —
// leaving the session without tapping loses nothing.
//
// The three actions are the Messages card's actions, through the same two
// endpoints, so the chat card and the inbox card cannot drift into two consent
// behaviours: ADD writes, EDIT changes the wording before it is added, and
// "Doesn't fit" declines it for good.
//
// Not rendered while a crisis owns the screen (the caller gates it), on the
// same rule as the mode boxes and the billing sheets.
//
// MICROCOPY on this card is flagged for the copy pass.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { refreshInboxStatus } from '../../services/messagesInbox';
import { m2ItemCategory, m2ItemValue, type ChatPendingCard } from '../../services/m2';

type Outcome = 'accepted' | 'declined';

/** How long a resolved card stays on screen before it goes. Long enough to read
 *  "Added to your map", short enough not to pile up under the conversation. */
const RESOLVED_LINGER_MS = 3500;

const keyOf = (c: ChatPendingCard) => `${c.messageId}#${c.itemIndex}`;

type Props = {
  cards: ChatPendingCard[];
  /** Fires after a write landed, so the screen can recount the map. */
  onAccepted?: () => void;
};

export function PendingMapCards({ cards, onAccepted }: Props) {
  // Cards resolved here stay visible for a beat after the inbox refresh drops
  // them from `cards`, so the person sees what their tap did. After the beat
  // they are HIDDEN, not forgotten: if the refresh failed and the inbox cache
  // still lists the card as pending, it must not come back with live buttons
  // over an item that is already on the map.
  const [settled, setSettled] = useState<Record<string, { card: ChatPendingCard; outcome: Outcome; hidden: boolean }>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);

  function settle(card: ChatPendingCard, outcome: Outcome) {
    const k = keyOf(card);
    setSettled((prev) => ({ ...prev, [k]: { card, outcome, hidden: false } }));
    timers.current.push(setTimeout(() => {
      setSettled((prev) => (prev[k] ? { ...prev, [k]: { ...prev[k], hidden: true } } : prev));
    }, RESOLVED_LINGER_MS));
  }

  const pendingKeys = new Set(cards.map(keyOf));
  const shown: { card: ChatPendingCard; outcome: Outcome | null }[] = [
    ...cards
      .filter((card) => !settled[keyOf(card)]?.hidden)
      .map((card) => ({ card, outcome: settled[keyOf(card)]?.outcome ?? null })),
    ...Object.entries(settled)
      .filter(([k, v]) => !pendingKeys.has(k) && !v.hidden)
      .map(([, v]) => ({ card: v.card, outcome: v.outcome })),
  ];
  if (shown.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {shown.map(({ card, outcome }) => (
        <OneCard
          key={keyOf(card)}
          card={card}
          outcome={outcome}
          onSettled={(o) => {
            settle(card, o);
            if (o === 'accepted') onAccepted?.();
          }}
        />
      ))}
    </View>
  );
}

function OneCard({
  card, outcome, onSettled,
}: {
  card: ChatPendingCard;
  outcome: Outcome | null;
  onSettled: (o: Outcome) => void;
}) {
  const original = m2ItemValue(card.item);
  const category = m2ItemCategory(card.item);
  const [value, setValue] = useState(original);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function add() {
    if (busy || outcome) return;
    setBusy(true);
    setFailed(false);
    Haptics.selectionAsync().catch(() => {});
    const trimmed = value.trim();
    const edits = trimmed && trimmed !== original ? { [card.itemIndex]: trimmed } : undefined;
    const res = await api.actOnMessage(card.messageId, [card.itemIndex], edits);
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSettled('accepted');
      refreshInboxStatus(true).catch(() => {});
    } else {
      // Say no back. The card stays where it is, wording intact, so they can
      // try again or leave it for Messages.
      setFailed(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }

  async function decline() {
    if (busy || outcome) return;
    setBusy(true);
    Haptics.selectionAsync().catch(() => {});
    const res = await api.declineMessageItems(card.messageId, [card.itemIndex]);
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      onSettled('declined');
      refreshInboxStatus(true).catch(() => {});
    }
  }

  if (outcome) {
    return (
      <View style={[styles.card, styles.cardResolved]}>
        <View style={styles.resolvedRow}>
          <Ionicons
            name={outcome === 'accepted' ? 'checkmark-circle' : 'close-circle-outline'}
            size={15}
            color={outcome === 'accepted' ? colors.amber : colors.creamFaint}
          />
          <Text style={outcome === 'accepted' ? styles.resolvedText : styles.resolvedTextDim}>
            {outcome === 'accepted' ? 'Added to your map.' : 'Left off your map.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card} accessibilityLabel="Waiting for you to add to your map">
      <Text style={styles.kicker}>WAITING FOR YOU TO ADD</Text>
      {editing ? (
        <TextInput
          value={value}
          onChangeText={setValue}
          style={styles.valueInput}
          selectionColor={colors.amber}
          autoFocus
          multiline
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={() => setEditing(false)}
          accessibilityLabel="Edit the wording before it goes on your map"
        />
      ) : (
        <Text style={styles.value}>{value}</Text>
      )}
      {category ? <Text style={styles.category}>{category}</Text> : null}
      <Text style={styles.note}>It isn’t on your map until you add it.</Text>

      {failed ? (
        <View style={styles.resolvedRow}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.creamDim} />
          <Text style={styles.resolvedTextDim}>Couldn’t add it just now — it’s still here.</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          onPress={add}
          disabled={busy}
          style={[styles.btnAccept, busy && styles.btnDim]}
          accessibilityLabel={`Add to your map: ${value}`}
        >
          <Text style={styles.btnAcceptText}>{busy ? 'ADDING…' : 'ADD TO MY MAP'}</Text>
        </Pressable>
        <Pressable
          onPress={() => setEditing((e) => !e)}
          disabled={busy}
          style={[styles.btn, busy && styles.btnDim]}
          accessibilityLabel="Edit the wording before it goes on your map"
        >
          <Text style={styles.btnText}>{editing ? 'DONE' : 'EDIT'}</Text>
        </Pressable>
        <Pressable
          onPress={decline}
          disabled={busy}
          style={[styles.btn, busy && styles.btnDim]}
          accessibilityLabel={`Leave this off your map: ${value}`}
        >
          <Text style={styles.btnTextDim}>Doesn’t fit</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Visual language of the Messages cards (app/messages.tsx), a shade warmer so
// it reads as live rather than archived.
const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  card: {
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.35)',
    backgroundColor: 'rgba(230,180,122,0.06)',
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardResolved: {
    paddingVertical: 10,
    borderColor: colors.border,
    backgroundColor: 'rgba(230,180,122,0.03)',
  },
  kicker: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  value: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    lineHeight: 23,
  },
  valueInput: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    lineHeight: 23,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(230,180,122,0.5)',
    paddingVertical: 2,
  },
  category: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12,
    marginTop: 4,
  },
  note: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  actionRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
  },
  btn: { paddingVertical: 6 },
  btnDim: { opacity: 0.4 },
  btnAccept: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.08)',
  },
  btnAcceptText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  btnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  btnTextDim: {
    color: colors.creamFaint,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  resolvedRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  resolvedText: { color: colors.creamDim, fontFamily: fonts.sans, fontSize: 13 },
  resolvedTextDim: { color: colors.creamFaint, fontFamily: fonts.sans, fontSize: 13 },
});
