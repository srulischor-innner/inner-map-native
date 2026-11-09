// PREVIEW DRIVER — the M2 cards, real components, stubbed transport.
//
//   npm run preview:reading      then open http://localhost:8081/m2
//
// WHAT IS REAL: components/m2/M2Cards.tsx — the card a yes in chat turns into,
// and the same card in Messages — and app/messages.tsx's MessagesScreen,
// unmodified, at phone width.
//
// WHAT IS STUBBED: the transport, and only the transport. The four inbox calls
// are swapped for functions returning the row shapes docs/m2-app-assumptions.md
// sets out, which match the server's docs/m2-api.md except where the Nov 5
// rulings differ (a chat card's bundled fields). Not a copy of server.js.
//
// The words on the cards are INVENTED for this preview. No real user's words
// appear in this file, and none should ever be pasted here.
//
//   ?case=chat           the cards a yes in chat made, on the chat screen
//   ?case=chat-failing   the write fails: the card says so and stays
//   ?case=messages       Messages: the same row, plus an old-stack row
//   ?case=timing         card timing: one reply's cards in every state
//   ?case=wound-card     a wound card carrying `underneath` (home-layer s.3)
//   ?case=wound          the Wound folder on M2 with `underneath` filled
//   ?case=wound-empty    the same folder on M2 with `underneath` empty
//   ?case=wound-off      the filled folder with the flag off: no row
//   ?case=axis           the map's YOUR PROGRESS strip on M2 (Blended → You Leading)
//   ?case=axis-off       the same strip with the flag off (Blended → Self-Led)
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, type InboxMessage } from '../services/api';
import { chatPendingCards } from '../services/m2';
import { PendingMapCards, M2InlineCards } from '../components/m2/M2Cards';
import MessagesScreen from '../app/messages';
import { PartFolderModal } from '../components/map/PartFolderModal';
import { setM2Flag } from '../services/m2Store';
import { ProgressStrip } from '../components/map/ProgressStrip';

// A wound row as /api/parts returns it, with markerFields as the tap writes
// them ({ value, confidence, ts }). Invented words.
function woundRow(withUnderneath: boolean) {
  const mf: Record<string, { value: string; confidence: string; ts: string }> = {
    feeling: { value: 'A tightness, like holding my breath', confidence: 'confirmed', ts: '2026-11-08T12:00:00Z' },
  };
  if (withUnderneath) {
    mf.underneath = { value: 'Someone curious, who used to take things apart to see how they worked', confidence: 'confirmed', ts: '2026-11-08T12:05:00Z' };
  }
  return { id: 'preview-wound', category: 'wound', corePhrase: 'If I need something, I’m too much', markerFields: mf };
}

const SESSION = 'preview-session';

const ROWS: InboxMessage[] = [
  {
    id: 'm2-row-1',
    kind: 'm2_card',
    payload: {
      sessionId: SESSION,
      sessionDate: 'Nov 5',
      items: [
        // A chat card as m2-api.md shows it: the reply's [CARD:...], fields
        // bundled, `value` the card's name, `anchor` the yes.
        {
          part: 'wound',
          kind: 'part',
          source: 'chat',
          confirmedInChat: true,
          payload: {
            part: 'wound',
            label: 'Needing is too much',
            fields: { belief: 'If I need something, I’m too much', trigger: 'The moment before asking for help' },
            field: 'belief',
            value: 'Needing is too much',
            enrich: false,
          },
          anchor: 'yeah. that’s exactly it.',
          status: 'pending',
        },
        // A chat card with no label: `value` is its first field, which stands
        // in as the headline and is not repeated underneath.
        {
          part: 'manager',
          kind: 'part',
          source: 'chat',
          confirmedInChat: true,
          payload: {
            part: 'manager',
            fields: { strategy: 'Rewrites a message until it asks for nothing' },
            field: 'strategy',
            value: 'Rewrites a message until it asks for nothing',
            enrich: false,
          },
          anchor: 'yes, that’s what I do',
          status: 'pending',
        },
        // A fixer card with the fields mapping-m2 (3).md line 16 adds.
        {
          part: 'fixer',
          kind: 'part',
          source: 'chat',
          confirmedInChat: true,
          payload: {
            part: 'fixer',
            label: 'Taking on extra',
            fields: {
              pattern: 'I take on extra so no one sees me struggle',
              selectivity: 'Only at work, never with friends',
              fantasy: 'Being so good no one could ever doubt me',
            },
            field: 'pattern', value: 'Taking on extra', enrich: false,
          },
          anchor: 'yes, that’s it',
          status: 'pending',
        },
        // A self-like card.
        {
          part: 'self-like',
          kind: 'part',
          source: 'chat',
          confirmedInChat: true,
          payload: {
            part: 'self-like',
            fields: { 'stands-on': 'I can ask and still be okay', 'clenched-or-open': 'Tight, most days' },
            field: 'stands-on', value: 'I can ask and still be okay', enrich: false,
          },
          anchor: 'yeah, keep that',
          status: 'pending',
        },
        // A belief card: one value, edited as text.
        {
          part: 'self-like',
          kind: 'belief',
          source: 'chat',
          confirmedInChat: true,
          payload: { belief: 'My worth isn’t earned', value: 'My worth isn’t earned' },
          anchor: 'yes. keep that one',
          status: 'pending',
        },
        // An idle-pass proposal: one value, Messages only.
        {
          part: 'wound',
          kind: 'detail',
          payload: { part: 'wound', field: 'body', value: 'A tightness in the throat', enrich: true },
          anchor: 'my throat goes tight right before I ask',
          recognised: 'partial',
          status: 'pending',
        },
        // Past its clock: the list reports it, the app leaves it out.
        {
          part: 'fixer',
          kind: 'detail',
          payload: { part: 'fixer', field: 'trigger', value: 'Being left on read' },
          anchor: 'when I get left on read',
          status: 'expired',
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

// EVERY api method these components can reach is stubbed here. The preview's
// BASE_URL is production: an unstubbed call would send a real request.
function stubTransport(failWrites: boolean) {
  const a = api as unknown as Record<string, unknown>;
  a.listMessages = async () => ({ messages: ROWS, unreadCount: 0, unactedCount: 3 });
  a.markMessageRead = async () => true;
  a.markM2CardsSeen = async () => true;
  a.getM2Pending = async () => null;
  a.actOnMessage = async (_id: string, idx: number[], edits?: unknown) => {
    console.log('[preview] act', JSON.stringify({ idx, edits }));
    await new Promise((r) => setTimeout(r, 700));
    return failWrites
      ? { ok: false, written: 0, failed: 1, allResolved: false, starterCount: null, starterMapComplete: false }
      : { ok: true, written: 1, failed: 0, allResolved: false, starterCount: 1, starterMapComplete: false };
  };
  a.declineMessageItems = async () => {
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, declined: 1, allResolved: false };
  };
  // The part folder's own calls (all behind a tap).
  a.savePartBelief = async () => null;
  a.deletePartBelief = async () => false;
  a.deleteMiddleGroundItem = async () => null;
  a.selfVoice = async () => null;
}

export default function M2Preview() {
  const { case: which = 'chat' } = useLocalSearchParams<{ case?: string }>();
  useMemo(() => stubTransport(which === 'chat-failing'), [which]);

  if (which === 'messages') return <MessagesScreen />;

  if (which === 'axis' || which === 'axis-off') {
    setM2Flag(which === 'axis');
    return (
      <View style={[styles.root, { justifyContent: 'flex-end' }]}>
        <ProgressStrip
          outsideInScore={0.3}
          blendedSelfLedScore={0.45}
          fragmentedScore={0.6}
          spectrumEarned={{ outsideIn: true, blendedSelfLed: true, fragmented: true }}
          clinicalPatterns={null}
        />
      </View>
    );
  }

  if (which === 'wound-card') {
    setM2Flag(true);
    const entry = {
      card: {
        messageId: 'm2-row-wound', itemIndex: 0,
        item: {
          part: 'wound', kind: 'part', source: 'chat', confirmedInChat: false, status: 'pending',
          payload: {
            part: 'wound', label: 'The one who holds back',
            fields: {
              belief: 'If I need something, I’m too much',
              underneath: 'Someone curious, who used to take things apart to see how they worked',
            },
            value: 'The one who holds back',
          },
        },
      },
      status: 'pending',
    } as unknown as Parameters<typeof M2InlineCards>[0]['entries'][number];
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.aiText}>Would you want that on your map, in your words?</Text>
        <M2InlineCards entries={[entry]} onSettled={() => {}} />
      </ScrollView>
    );
  }

  if (which === 'wound' || which === 'wound-empty' || which === 'wound-off') {
    setM2Flag(which !== 'wound-off');
    return (
      <View style={styles.root}>
        <PartFolderModal
          visible
          partKey="wound"
          mapData={{ wound: 'If I need something, I’m too much' }}
          parts={[woundRow(which !== 'wound-empty')]}
          onClose={() => {}}
        />
      </View>
    );
  }

  if (which === 'timing') {
    // One reply's cards as the chat screen draws them under it: an offer still
    // open, one a later "no" declined, one a corrected offer replaced, and
    // one tapped. Only the open one has buttons.
    const offered = chatPendingCards(ROWS, SESSION);
    const states = ['pending', 'declined', 'superseded', 'accepted'] as const;
    const entries = offered.slice(0, 4).map((card, i) => ({ card, status: states[i] }));
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.aiText}>
          It sounds like the moment before asking is where it bites. Would you want that on your map?
        </Text>
        <M2InlineCards entries={entries} onSettled={() => {}} />
      </ScrollView>
    );
  }

  const cards = chatPendingCards(ROWS, SESSION);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>yeah. that’s exactly it.</Text>
      </View>
      <Text style={styles.aiText}>
        Then it’s yours to keep. It’s just below, waiting for you to add.
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
