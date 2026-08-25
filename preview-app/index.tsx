// PREVIEW DRIVER — the real ReadingElement and the real ReadingModal, on the
// real map background, driven through every state.
//
// WHAT IS REAL: the components (imported from components/map, unmodified), the
// copy (utils/readingCopy), the breathing animation, the self-advancing waiting
// lines, the phase machine, the modal's document parser and typography.
//
// WHAT IS STUBBED: the transport, and only the transport. api.getReading and
// api.generateReading are replaced with functions that return exactly the JSON
// shapes server.js returns for each case — nothing else about the element is
// changed, and the element cannot tell the difference.
//
// The reading text below is INVENTED for this preview. No real user's document
// appears in this file.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { ReadingElement } from '../components/map/ReadingElement';
import { ReadingModal } from '../components/map/ReadingModal';
import { api } from '../services/api';

// ---------------------------------------------------------------------------
// The server's response shapes, per case, copied from server.js's handlers.
// ---------------------------------------------------------------------------
const NOW = () => new Date().toISOString();
const AGO = (ms: number) => new Date(Date.now() - ms).toISOString();

const SAMPLE_BODY = [
  'You have been at this for eleven sessions, and what follows is the whole of it at once — not a summary of the last conversation, but the shape the map has taken.',
  '## What you keep running into',
  'Underneath most of what you have mapped is a single sentence: that needing something is the same as being too much. It is not a mood. It shows up in the same place every time — the moment before you ask.',
  '## The two sides that answer it',
  'One side gets there first and makes itself useful, so the asking never has to happen. The other side decides, quietly and in advance, that the person was never going to say yes.',
  '## What carries it day to day',
  'Three parts do the daily work. The one you call the drafter rewrites a two-line message four times. The one that keeps mornings full so nothing can land. And the one that goes quiet in the exact second it would cost something to speak.',
  '## Where it came from',
  'You have said that the house you grew up in ran on not needing anything. That is where the sentence was true.',
  '## How this changes',
  'None of these parts is the problem, and none of them is going anywhere by being argued with. What moves is the sentence underneath them — and it moves when the thing it predicts fails to happen in front of a witness. That is what a therapist is for, and this is not that. What this is: the place the map gets made, a whole thing in its own right, never as preparation.',
  '## Where this goes next',
  'The nearest unfilled piece is what the quiet one is protecting. You have named when it arrives, not yet what it is standing in front of.',
].join('\n\n');

type Case = {
  key: string;
  label: string;
  note: string;
  get: () => any;
  gen?: () => any;
};

const CASES: Case[] = [
  {
    key: 'locked-ineligible',
    label: 'LOCKED — map does not qualify yet',
    note: 'GET → exists:false, eligibility.eligible:false. The element is inert; the tap does nothing.',
    get: () => ({ exists: false, eligibility: { eligible: false, reason: 'protectors:1/3' }, deliveryGate: { ready: true } }),
  },
  {
    key: 'locked-gate',
    label: 'LOCKED — map qualifies, delivery gate still shut',
    note: 'The gate outranks eligibility: a qualifying map still reads locked until one live PART_NAMED capture has fired anywhere. This is production RIGHT NOW.',
    get: () => ({ exists: false, eligibility: { eligible: true }, deliveryGate: { ready: false, reason: 'no live capture yet' } }),
  },
  {
    key: 'ready',
    label: 'UNLOCKED — clickable',
    note: 'Eligible AND the gate is open. Tapping starts a real generation; here it moves to the waiting state.',
    get: () => ({ exists: false, eligibility: { eligible: true }, deliveryGate: { ready: true } }),
    gen: () => ({ ok: true, eligible: true, id: 'preview', status: 'generating' }),
  },
  {
    key: 'generating',
    label: 'WAITING — being written (50–60s)',
    note: 'The element breathes and the line advances on its own timing: 14s, then 16s, then 20s, then holds. It never loops and never shows a percentage.',
    get: () => ({ exists: true, id: 'preview', status: 'generating', stale: false, body: null, createdAt: NOW(), eligibility: { eligible: true }, deliveryGate: { ready: true } }),
  },
  {
    key: 'has-reading',
    label: 'READY — tap to open the document',
    note: 'GET → status:"ready" with the body. Tapping opens the reading screen.',
    get: () => ({ exists: true, id: 'preview', status: 'ready', body: SAMPLE_BODY, createdAt: AGO(36 * 60 * 60 * 1000), eligibility: { eligible: true }, deliveryGate: { ready: true } }),
  },
  {
    key: 'error',
    label: 'FAILED — the generation threw',
    note: 'NEW 2026-08-23. Before today this row rendered as UNLOCKED again — the silent re-offer.',
    get: () => ({ exists: true, id: 'preview', status: 'error', stale: false, body: null, createdAt: AGO(3 * 60 * 1000), eligibility: { eligible: true }, deliveryGate: { ready: true } }),
    gen: () => null,
  },
  {
    key: 'stale',
    label: 'FAILED — abandoned (worker died mid-generation)',
    note: 'NEW 2026-08-23. status is still "generating" but the SERVER says stale. Before today the element breathed at this row forever and every retry was refused.',
    get: () => ({ exists: true, id: 'preview', status: 'generating', stale: true, body: null, createdAt: AGO(11 * 60 * 1000), eligibility: { eligible: true }, deliveryGate: { ready: true } }),
    gen: () => ({ ok: true, eligible: true, id: 'preview-2', status: 'generating' }),
  },
  {
    key: 'hidden',
    label: 'HIDDEN — old server, no /api/reading',
    note: 'GET returns null. The element renders nothing at all rather than guessing.',
    get: () => null,
  },
];

// A case can also be selected by URL (?case=ready&open=1) so a headless
// browser can capture each state deterministically. Same code path as the
// buttons — the query only picks the initial index.
function initialFromUrl(): { idx: number; open: boolean } {
  try {
    const q = new URLSearchParams(String((globalThis as any)?.location?.search || ''));
    const want = q.get('case');
    const i = CASES.findIndex((c) => c.key === want);
    return { idx: i >= 0 ? i : 0, open: q.get('open') === '1' };
  } catch { return { idx: 0, open: false }; }
}

export default function ReadingPreview() {
  const boot = initialFromUrl();
  const [idx, setIdx] = useState(boot.idx);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(boot.open);
  const [body, setBody] = useState<string | null>(boot.open ? SAMPLE_BODY : null);
  const [at, setAt] = useState<string | undefined>(boot.open ? AGO(36 * 60 * 60 * 1000) : undefined);
  const [log, setLog] = useState<string[]>([]);

  const cur = CASES[idx];

  // Swap the transport under the real element. Everything else is untouched.
  useMemo(() => {
    (api as any).getReading = async () => {
      const r = cur.get();
      setLog((l) => [`GET /api/reading → ${r ? `${r.exists ? r.status || 'no-row' : 'exists:false'}${r && r.stale ? ' (stale)' : ''}` : 'null'}`, ...l].slice(0, 6));
      return r;
    };
    (api as any).generateReading = async () => {
      const r = cur.gen ? cur.gen() : { ok: true, eligible: true, status: 'generating' };
      setLog((l) => [`POST /api/reading/generate → ${r ? JSON.stringify(r) : 'null (request failed)'}`, ...l].slice(0, 6));
      // After a successful start, the poll should see 'generating'.
      if (r && (r as any).status === 'generating') {
        (api as any).getReading = async () => ({
          exists: true, id: 'preview', status: 'generating', stale: false, body: null,
          createdAt: NOW(), eligibility: { eligible: true }, deliveryGate: { ready: true },
        });
      }
      return r;
    };
    return null;
  }, [cur, nonce]);

  const pick = useCallback((i: number) => {
    setIdx(i);
    setNonce((n) => n + 1);
    setLog([]);
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.phone}>
        <Text style={styles.fakeHeader}>Your Map</Text>
        {/* THE REAL ELEMENT, in the header band it occupies on the Map tab. */}
        <ReadingElement
          key={`${cur.key}-${nonce}`}
          onOpen={(b, createdAt) => { setBody(b); setAt(createdAt); setOpen(true); }}
        />
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={{ paddingBottom: 30 }}>
        <Text style={styles.panelTitle}>state</Text>
        {CASES.map((c, i) => (
          <Pressable key={c.key} onPress={() => pick(i)} style={[styles.btn, i === idx && styles.btnOn]}>
            <Text style={[styles.btnText, i === idx && styles.btnTextOn]}>{c.label}</Text>
          </Pressable>
        ))}
        <Text style={styles.note}>{cur.note}</Text>
        <Text style={styles.panelTitle}>viewport</Text>
        <Text style={styles.log}>{String((globalThis as any)?.innerWidth) + String.fromCharCode(120) + String((globalThis as any)?.innerHeight)}</Text>
        <Text style={styles.panelTitle}>transport</Text>
        {log.map((l, i) => <Text key={i} style={styles.log}>{l}</Text>)}
      </ScrollView>

      <ReadingModal visible={open} body={body} createdAt={at} onClose={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  // A fixed 375-wide column so the element is measured at real phone width
  // no matter how wide the browser window is.
  phone: { width: 375, alignSelf: 'center', paddingTop: 18, paddingBottom: 22,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  fakeHeader: { color: 'rgba(255,255,255,0.30)', fontSize: 12, letterSpacing: 2, marginLeft: 20, textTransform: 'uppercase' },
  panel: { flex: 1, width: 375, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 14 },
  panelTitle: { color: 'rgba(255,255,255,0.30)', fontSize: 10, letterSpacing: 2, marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  btn: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, marginBottom: 4, backgroundColor: 'rgba(255,255,255,0.03)' },
  btnOn: { backgroundColor: 'rgba(230,180,122,0.14)' },
  btnText: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  btnTextOn: { color: 'rgba(230,180,122,0.95)' },
  note: { color: 'rgba(255,255,255,0.38)', fontSize: 11, lineHeight: 16, marginTop: 8 },
  log: { color: 'rgba(120,200,160,0.6)', fontSize: 10, fontFamily: 'monospace', marginBottom: 2 },
});
