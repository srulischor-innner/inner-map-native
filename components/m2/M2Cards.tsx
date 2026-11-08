// M2 CARDS — the one place anything reaches the map under M2.
//
// "The chat never writes the map." CARD TIMING (founder): the card comes WITH
// the chat's offer, in the same reply, and shows under that reply. It reads
// as a choice — "add to your map" or "not now" — never as the confirmation of
// something already agreed, because nothing is: the tap is the yes and the
// only write. A typed yes writes nothing, so the card stays tappable until the
// conversation ends. A no, or a corrected offer, resolves it from the server's
// side: the card greys out in place with no buttons, and a corrected offer's
// new card shows under the reply that made it. When the session goes idle a
// pass proposes more, which wait in Messages.
//
// ONE CARD, BOTH SURFACES. M2ItemCard is what the chat screen shows and what
// Messages shows, and both go through services/m2Store's acceptM2Item and
// declineM2Item. A card can be in both places at once — Messages lists every
// M2 row — and a tap in either resolves it in both. Keeping one component is
// what keeps the consent behaviour from drifting between the two.
//
// Three actions: ADD writes it, EDIT changes the wording first (each bundled
// field on a chat card, the one value on a pass proposal), and "Not now"
// declines it (the server treats that as final).
//
// Never rendered while a crisis owns the chat screen (the caller gates it), on
// the same rule as the mode boxes and the billing sheets.
//
// MICROCOPY on these cards is flagged for the copy pass.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing } from '../../constants/theme';
import type { InboxMessage } from '../../services/api';
import {
  isM2Item, m2BuildEdit, m2CardKey, m2EditDraft, m2FieldWords, m2ItemCategory, m2ItemFieldEntries,
  m2ItemHasOwnName, m2ItemIsBundled, m2ItemNote, m2ItemSource, m2ItemTitle,
  type ChatPendingCard, type M2CardItem, type M2CardStatus, type M2EditDraft,
} from '../../services/m2';
import { acceptM2Item, declineM2Item, markM2CardShown } from '../../services/m2Store';

/** What a tap did. */
type Outcome = 'accepted' | 'declined';
/** Every state a card can show without buttons: what a tap did, or what the
 *  server says happened to it. */
type Resolved = Exclude<M2CardStatus, 'pending'>;
type Surface = 'chat' | 'inbox';
type EditFocusHandler = (node: { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null) => void;

/** How long a resolved card stays on the chat screen before it goes. Long
 *  enough to read "Added to your map", short enough not to pile up under the
 *  conversation. */
const RESOLVED_LINGER_MS = 3500;

const keyOf = (c: ChatPendingCard) => m2CardKey(c.messageId, c.itemIndex);

// What a resolved card says under its title. "settled" says nothing: the
// server stopped listing it as pending without saying why, so the card makes
// no claim. MICROCOPY — flagged for the copy pass.
const RESOLVED_WORDS: Record<Resolved, string | null> = {
  accepted: 'Added to your map.',
  declined: 'Left off your map.',
  superseded: 'Replaced by the newer offer below.',
  expired: 'No longer waiting.',
  settled: null,
};

// ===========================================================================
// The chat screen's cards
// ===========================================================================

export function PendingMapCards({ cards }: { cards: ChatPendingCard[] }) {
  // Cards resolved here stay visible for a beat after the inbox refresh drops
  // them from `cards`, so the person sees what their tap did. After the beat
  // they are HIDDEN, not forgotten: if the refresh failed and the inbox cache
  // still lists the card as pending, it must not come back with live buttons
  // over an item that is already on the map.
  const [settled, setSettled] = useState<Record<string, { card: ChatPendingCard; outcome: Resolved; hidden: boolean }>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);

  // The card's 14-day clock starts the first time it is shown here.
  useEffect(() => {
    for (const c of cards) markM2CardShown(c.messageId, c.itemIndex);
  }, [cards]);

  function settle(card: ChatPendingCard, outcome: Resolved) {
    const k = keyOf(card);
    setSettled((prev) => ({ ...prev, [k]: { card, outcome, hidden: false } }));
    timers.current.push(setTimeout(() => {
      setSettled((prev) => (prev[k] ? { ...prev, [k]: { ...prev[k], hidden: true } } : prev));
    }, RESOLVED_LINGER_MS));
  }

  const pendingKeys = new Set(cards.map(keyOf));
  const shown: { card: ChatPendingCard; outcome: Resolved | null }[] = [
    ...cards
      .filter((card) => !settled[keyOf(card)]?.hidden)
      .map((card) => ({ card, outcome: settled[keyOf(card)]?.outcome ?? null })),
    ...Object.entries(settled)
      .filter(([k, v]) => !pendingKeys.has(k) && !v.hidden)
      .map(([, v]) => ({ card: v.card, outcome: v.outcome })),
  ];
  if (shown.length === 0) return null;

  return (
    <View style={styles.chatWrap}>
      {shown.map(({ card, outcome }) => (
        <M2ItemCard
          key={keyOf(card)}
          surface="chat"
          messageId={card.messageId}
          itemIndex={card.itemIndex}
          item={card.item}
          outcome={outcome}
          onSettled={(o) => settle(card, o)}
        />
      ))}
    </View>
  );
}

// ===========================================================================
// Under the reply that offered them (card timing, founder)
// ===========================================================================

/** The cards one reply offered, drawn under that reply. Each is live while
 *  pending and greyed with no buttons once it is anything else; the chat
 *  screen owns the statuses, so a card a later reply declined or replaced
 *  greys out where it is. */
export function M2InlineCards({
  entries, onSettled,
}: {
  entries: { card: ChatPendingCard; status: M2CardStatus }[];
  onSettled: (key: string, o: Resolved) => void;
}) {
  // The card's 14-day clock starts the first time it is shown here.
  useEffect(() => {
    for (const e of entries) if (e.status === 'pending') markM2CardShown(e.card.messageId, e.card.itemIndex);
  }, [entries]);
  if (entries.length === 0) return null;
  return (
    <View style={styles.inlineWrap}>
      {entries.map(({ card, status }) => (
        <M2ItemCard
          key={keyOf(card)}
          surface="chat"
          messageId={card.messageId}
          itemIndex={card.itemIndex}
          item={card.item}
          outcome={status === 'pending' ? null : status}
          onSettled={(o) => onSettled(keyOf(card), o)}
        />
      ))}
    </View>
  );
}

// ===========================================================================
// Messages: one M2 row, every item in it
// ===========================================================================

export function M2InboxCard({ message, onEditFocus }: { message: InboxMessage; onEditFocus?: EditFocusHandler }) {
  const items = Array.isArray(message.payload.items) ? message.payload.items : [];
  const [outcomes, setOutcomes] = useState<Record<number, Resolved>>({});
  // Items the app cannot read, or that have nothing to show, are left out
  // rather than drawn as an empty row with live buttons. An expired item is
  // left out too: it can no longer be added. So is a superseded one: a
  // corrected offer replaced it, and the replacement is the item to decide on.
  const rows = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => isM2Item(it) && !!m2ItemTitle(it) && it.status !== 'expired' && it.status !== 'superseded') as { it: M2CardItem; i: number }[];
  if (rows.length === 0) return null;

  return (
    <View style={styles.inboxCard}>
      <Text style={styles.kicker}>
        {`FROM A CONVERSATION${message.payload.sessionDate ? ` · ${message.payload.sessionDate}` : ''}`}
      </Text>
      <Text style={styles.inboxLede}>
        Things from a conversation that might belong on your map. Nothing goes on it unless you add it:
      </Text>
      {rows.map(({ it, i }) => (
        <View key={`${message.id}-${i}`} style={styles.inboxItem}>
          <M2ItemCard
            surface="inbox"
            messageId={message.id}
            itemIndex={i}
            item={it}
            outcome={outcomes[i] ?? (it.status === 'accepted' || it.status === 'declined' ? it.status : null)}
            onSettled={(o) => setOutcomes((prev) => ({ ...prev, [i]: o }))}
            onEditFocus={onEditFocus}
          />
        </View>
      ))}
    </View>
  );
}

// ===========================================================================
// One card
// ===========================================================================

function M2ItemCard({
  surface, messageId, itemIndex, item, outcome, onSettled, onEditFocus,
}: {
  surface: Surface;
  messageId: string;
  itemIndex: number;
  item: M2CardItem;
  outcome: Resolved | null;
  onSettled: (o: Resolved) => void;
  onEditFocus?: EditFocusHandler;
}) {
  const bundled = m2ItemIsBundled(item);
  const fields = m2ItemFieldEntries(item);
  const category = m2ItemCategory(item);
  const source = m2ItemSource(item);
  const note = m2ItemNote(item);
  // A pass proposal's headline is its one value, and that is what EDIT edits.
  // A chat card's headline is its name, which is not editable (m2BuildEdit says
  // why); its fields are. When it has no name of its own, its first field
  // stands in as the headline and is not repeated underneath.
  const ownName = m2ItemHasOwnName(item);
  const [draft, setDraft] = useState<M2EditDraft>(() => m2EditDraft(item));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const firstInput = useRef<TextInput>(null);

  async function add() {
    if (busy || outcome) return;
    setBusy(true);
    setFailed(false);
    Haptics.selectionAsync().catch(() => {});
    const res = await acceptM2Item(messageId, itemIndex, m2BuildEdit(item, draft));
    setBusy(false);
    if (res.ok && res.written > 0) {
      setEditing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSettled('accepted');
    } else if (res.ok) {
      // The server took the tap but wrote nothing: this card was no longer
      // open (declined, replaced or expired since it was drawn). Grey it out
      // and claim nothing — never "Added to your map" for a write that did
      // not happen.
      setEditing(false);
      onSettled('settled');
    } else {
      // Say no back. The card stays where it is, wording intact, so they can
      // try again or leave it.
      setFailed(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }

  async function decline() {
    if (busy || outcome) return;
    setBusy(true);
    Haptics.selectionAsync().catch(() => {});
    const res = await declineM2Item(messageId, itemIndex);
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      onSettled('declined');
    }
  }

  const shownTitle = !bundled || ownName ? draft.title : draft.fields[fields[0].key];

  // Resolved: greyed, no buttons. Under its reply it stays as the record of
  // what was offered and what happened to it.
  if (outcome) {
    const said = RESOLVED_WORDS[outcome];
    return (
      <View
        style={surface === 'chat' ? [styles.chatCard, styles.chatCardResolved] : null}
        accessibilityLabel={said ? `${shownTitle}: ${said}` : shownTitle}
      >
        <Text style={[styles.title, styles.titleDim]}>{shownTitle}</Text>
        {said ? (
          <View style={styles.resolvedRow}>
            <Ionicons
              name={outcome === 'accepted' ? 'checkmark-circle' : 'close-circle-outline'}
              size={15}
              color={outcome === 'accepted' ? colors.amber : colors.creamFaint}
            />
            <Text style={outcome === 'accepted' ? styles.resolvedText : styles.resolvedTextDim}>{said}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // The rows under the headline: every bundled field, except the first when it
  // is already the headline.
  const rowFields = ownName ? fields : fields.slice(1);

  return (
    <View
      style={surface === 'chat' ? styles.chatCard : null}
      accessibilityLabel={surface === 'chat' ? 'Offered for your map' : undefined}
    >
      {surface === 'chat' ? <Text style={styles.kicker}>FOR YOUR MAP</Text> : null}

      {editing ? (
        <>
          {bundled && ownName ? <Text style={styles.title}>{shownTitle}</Text> : null}
          {!bundled ? (
            <TextInput
              ref={firstInput}
              value={draft.title}
              onChangeText={(t) => setDraft((d) => ({ ...d, title: t }))}
              style={styles.titleInput}
              selectionColor={colors.amber}
              autoFocus
              multiline
              blurOnSubmit
              onFocus={() => onEditFocus?.(firstInput.current)}
              accessibilityLabel="Edit the wording before it goes on your map"
            />
          ) : null}
          {fields.map(({ key }, n) => (
            <View key={key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{m2FieldWords(key, item.kind)}</Text>
              <TextInput
                value={draft.fields[key] ?? ''}
                onChangeText={(t) => setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: t } }))}
                style={styles.fieldInput}
                selectionColor={colors.amber}
                autoFocus={n === 0}
                multiline
                blurOnSubmit
                accessibilityLabel={`Edit ${m2FieldWords(key, item.kind)}`}
              />
            </View>
          ))}
        </>
      ) : (
        <>
          <Text style={styles.title}>{shownTitle}</Text>
          {category ? <Text style={styles.category}>{category}</Text> : null}
          {rowFields.map(({ key }) => (
            <View key={key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{m2FieldWords(key, item.kind)}</Text>
              <Text style={styles.fieldValue}>{draft.fields[key]}</Text>
            </View>
          ))}
        </>
      )}
      {note ? (
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{m2FieldWords('note')}</Text>
          <Text style={styles.fieldValue}>{note}</Text>
        </View>
      ) : null}

      {surface === 'inbox' && source ? (
        <Text style={styles.source}>{`You said: “${source}”`}</Text>
      ) : null}
      {/* In Messages the line still says where things stand. Under the offer
          in chat the two buttons say it: it is a choice, not a confirmation. */}
      {surface === 'inbox' ? <Text style={styles.note}>It isn’t on your map until you add it.</Text> : null}

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
          accessibilityLabel={`Add to your map: ${shownTitle}`}
        >
          <Text style={styles.btnAcceptText}>{busy ? 'ADDING…' : 'ADD TO YOUR MAP'}</Text>
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
          accessibilityLabel={`Not now: ${shownTitle}`}
        >
          <Text style={styles.btnTextDim}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Visual language of the Messages cards (app/messages.tsx). The chat card is a
// shade warmer so it reads as live rather than archived.
const styles = StyleSheet.create({
  chatWrap: { marginTop: spacing.sm },
  inlineWrap: { marginTop: 2, marginBottom: spacing.sm },
  chatCard: {
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.35)',
    backgroundColor: 'rgba(230,180,122,0.06)',
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  chatCardResolved: {
    paddingVertical: 10,
    borderColor: colors.border,
    backgroundColor: 'rgba(230,180,122,0.03)',
  },
  inboxCard: {
    borderWidth: 0.5,
    borderColor: colors.border,
    backgroundColor: 'rgba(230,180,122,0.04)',
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  inboxLede: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  inboxItem: {
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  kicker: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  title: {
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    lineHeight: 23,
  },
  titleDim: { color: colors.creamFaint },
  titleInput: {
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
  fieldRow: { marginTop: 8 },
  fieldLabel: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  fieldValue: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 1,
  },
  fieldInput: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(230,180,122,0.5)',
    paddingVertical: 2,
    marginTop: 1,
  },
  source: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
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
    marginTop: 6,
  },
  resolvedText: { color: colors.creamDim, fontFamily: fonts.sans, fontSize: 13 },
  resolvedTextDim: { color: colors.creamFaint, fontFamily: fonts.sans, fontSize: 13 },
});
