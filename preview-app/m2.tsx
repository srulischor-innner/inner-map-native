// PREVIEW DRIVER — the M2 cards, real components, stubbed transport.
//
//   npm run preview:reading      then open http://localhost:8081/m2
//
// WHAT IS REAL: components/chat/PendingMapCards.tsx (the card a yes in chat
// turns into) and app/messages.tsx's MessagesScreen with its M2 variant,
// unmodified, at phone width.
//
// WHAT IS STUBBED: the transport, and only the transport. The four inbox calls
// are swapped for functions returning the row shapes docs/m2-app-assumptions.md
// sets out (A2). The server's real M2 endpoints did not exist when this was
// written, so these shapes are the app's ASSUMPTION, not a copy of server.js.
//
// The words on the cards are INVENTED for this preview. No real user's words
// appear in this file, and none should ever be pasted here.
//
//   ?case=chat           two cards waiting on the chat screen
//   ?case=chat-failing   the write fails: the card says so and stays
//   ?case=messages       the Messages screen with an M2 row and an old row
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, type InboxMessage } from '../services/api';
import { chatPendingCards } from '../services/m2';
import { PendingMapCards } from '../components/chat/PendingMapCards';
import MessagesScreen from '../app/messages';

const SESSION = 'preview-session';

const ROWS: InboxMessage[] = [
  {
    id: 'm2-row-1',
    kind: 'm2_card',
    payload: {
      sessionId: SESSION,
      sessionDate: 'Nov 4',
      items: [
        {
          part: 'wound',
          kind: 'part',
          payload: { part: 'wound', field: 'belief', value: 'If I need something, I’m too much' },
          anchor: 'it’s like if I need something I’m automatically too much',
          recognised: 'confirmed',
          confirmedInChat: true,
          status: 'pending',
        },
        {
          part: 'manager',
          kind: 'part',
          payload: { part: 'manager', label: 'the drafter', field: 'strategy', value: 'Rewrites a message until it asks for nothing' },
          anchor: 'I rewrite it until it doesn’t really ask for anything',
          recognised: 'confirmed',
          confirmedInChat: true,
          status: 'pending',
        },
        {
          part: 'wound',
          kind: 'detail',
          payload: { part: 'wound', field: 'trigger', value: 'The moment before asking for help', enrich: true },
          anchor: 'right before I ask, every time',
          recognised: 'partial',
          confirmedInChat: false,
          status: 'pending',
        },
      ],
    },
    createdAt: new Date().toISOString(),
    readAt: null,
    actedAt: null,
    expiresAt: null,
  },
  {
    id: 'old-row-1',
    kind: 'pending_parts',
    payload: {
      sessionId: 'older-session',
      sessionDate: 'Oct 28',
      items: [{ part: 'skeptic', name: 'The one that expects a no', context: 'It decides in advance nobody will say yes.' }],
    },
    createdAt: new Date().toISOString(),
    readAt: null,
    actedAt: null,
    expiresAt: null,
  },
];

function stubTransport(failWrites: boolean) {
  const a = api as unknown as Record<string, unknown>;
  a.listMessages = async () => ({ messages: ROWS, unreadCount: 0, unactedCount: 3 });
  a.markMessageRead = async () => true;
  a.actOnMessage = async () => {
    await new Promise((r) => setTimeout(r, 700));
    return failWrites
      ? { ok: false, written: 0, failed: 1, allResolved: false }
      : { ok: true, written: 1, failed: 0, allResolved: false };
  };
  a.declineMessageItems = async () => {
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, declined: 1, allResolved: false };
  };
}

export default function M2Preview() {
  const { case: which = 'chat' } = useLocalSearchParams<{ case?: string }>();
  useMemo(() => stubTransport(which === 'chat-failing'), [which]);

  if (which === 'messages') return <MessagesScreen />;

  const cards = chatPendingCards(ROWS, SESSION);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>yeah. that’s exactly it.</Text>
      </View>
      <Text style={styles.aiText}>
        Then it’s yours. It’s waiting just below for you to add, in your words.
      </Text>
      <PendingMapCards cards={cards} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 16, maxWidth: 375, width: '100%', alignSelf: 'center' },
  userBubble: {
    alignSelf: 'flex-end', backgroundColor: 'rgba(230,180,122,0.12)', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12, maxWidth: '80%',
  },
  userText: { color: '#F0EDE8', fontSize: 15 },
  aiText: { color: '#F0EDE8', fontSize: 16, lineHeight: 24, marginBottom: 4 },
});
