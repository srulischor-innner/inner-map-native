// M2 — the chat talks and offers; a tap writes the map.
//
// Everything the app needs to know about the M2 chat stack lives here, so the
// assumptions about the server's API sit in ONE file. They are written out in
// docs/m2-app-assumptions.md; when the server branch's docs/m2-api.md lands,
// this file is where the swap happens.
//
// WHAT M2 CHANGES ON THIS SIDE (founder's lock, mapping-m2.md):
//   - the chat never writes the map. A yes in chat shows a card on the chat
//     screen, and the person's tap writes it;
//   - a pass proposes cards to Messages, each accepted, edited or declined;
//   - one prompt, so the four mode boxes and the mode control go;
//   - a new first-session welcome;
//   - in a first session the "view my map" button waits for two entries.
//
// OFF MEANS TODAY. The flag is read once at boot off the first-session status
// payload. Every failure shape reads as OFF, so a flaky request can only ever
// hand someone the app as it is now, never half of M2. The server's own
// selection reads a missing or failed setting as today's stack too, so the two
// fail in the same direction.

import type { InboxMessage } from './api';

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

/** ASSUMPTION A1: GET /api/first-session-status carries the account's stack as
 *  `promptStack: "m2"` (the setting's name in the switch plan, step 1), or as
 *  `chatStack: "m2"`. Only the exact string "m2" turns M2 on; anything else, a
 *  missing field, or an unparseable body is OFF. */
export function parseM2Flag(statusBody: unknown): boolean {
  if (!statusBody || typeof statusBody !== 'object') return false;
  const b = statusBody as { promptStack?: unknown; chatStack?: unknown };
  return b.promptStack === 'm2' || b.chatStack === 'm2';
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** ASSUMPTION A2: M2 proposals reach the app as inbox rows of this kind, one
 *  row per session with an `items` array, so accept and decline are the
 *  existing /api/messages/:id/act and /decline with item indices. */
export const M2_CARD_KIND = 'm2_card' as const;

export type M2CardKind = 'part' | 'detail' | 'voice' | 'middle_ground' | 'second_wound';

/** One proposal, as the pass writes it (mapping-m2.md, "The pass"). The payload
 *  shapes mirror the live markers, so they are read loosely here: the app only
 *  displays them, and the server owns the write. */
export type M2CardItem = {
  kind: M2CardKind;
  payload: Record<string, unknown>;
  /** Their exact words the proposal was drawn from. */
  anchor?: string;
  recognised?: 'confirmed' | 'partial';
  /** True when they said yes to this exact item in chat. These are the cards
   *  the chat screen shows; the rest live in Messages only. Read under both
   *  spellings because the pass emits snake_case. */
  confirmedInChat?: boolean;
  confirmed_in_chat?: boolean;
  status?: 'pending' | 'accepted' | 'declined';
  /** What the person changed the wording to before accepting, server-owned. */
  editedValue?: string;
};

const KINDS: M2CardKind[] = ['part', 'detail', 'voice', 'middle_ground', 'second_wound'];

export function isM2Item(it: unknown): it is M2CardItem {
  if (!it || typeof it !== 'object') return false;
  const o = it as { kind?: unknown; payload?: unknown };
  return KINDS.includes(o.kind as M2CardKind) && !!o.payload && typeof o.payload === 'object';
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The words the card offers to keep — the thing an edit changes. */
export function m2ItemValue(it: M2CardItem): string {
  const p = it.payload;
  switch (it.kind) {
    case 'middle_ground': return str(p.label);
    case 'second_wound': return str(p.wound);
    default: return str(p.value);
  }
}

// Plain words for the map's shapes. The person meets these on a card before
// they have necessarily opened the map, so they say what the thing is rather
// than naming the framework's term. MICROCOPY — flagged for the copy pass.
const PART_WORDS: Record<string, string> = {
  wound: 'what it feels like underneath',
  fixer: 'one way you handle it',
  skeptic: 'one way you handle it',
  'self-like': 'how you hold yourself together',
  manager: 'one way you cope',
  firefighter: 'one way you cope',
};

/** Who a detail or a phrase belongs to: their own name for the part when they
 *  gave one (the pass carries it as `label`), otherwise plain words. Never the
 *  map's internal category name. */
function ownerWords(part: string, label: string): string {
  return label || PART_WORDS[part] || 'a part of you';
}

const FIELD_WORDS: Record<string, string> = {
  belief: 'the belief underneath',
  feeling: 'the feeling underneath',
  trigger: 'what sets it off',
  situation: 'when it shows up',
  example: 'an example',
  body: 'where you feel it',
  voice: 'what it says',
  worldview: 'how it sees things',
  story: 'the story it carries',
  memory: 'a memory it carries',
  manner: 'how it speaks',
  strategy: 'what it does',
  pattern: 'what it does',
};

/** A short line saying what kind of thing this is, or null for none. */
export function m2ItemCategory(it: M2CardItem): string | null {
  const p = it.payload;
  const part = str(p.part);
  const label = str(p.label);
  const field = str(p.field);
  switch (it.kind) {
    case 'part':
      if (part === 'manager' || part === 'firefighter') return label ? `${label} · one way you cope` : PART_WORDS[part];
      if (part === 'wound' && field && FIELD_WORDS[field]) return FIELD_WORDS[field];
      return PART_WORDS[part] || null;
    case 'detail':
      return `${ownerWords(part, label)} · ${FIELD_WORDS[field] || 'more detail'}`;
    case 'voice':
      return `${ownerWords(part, label)} · something it says`;
    case 'middle_ground':
      return null;
    case 'second_wound':
      return 'something separate underneath';
  }
}

export function m2ItemConfirmedInChat(it: M2CardItem): boolean {
  return it.confirmedInChat === true || it.confirmed_in_chat === true;
}

/** A pending card the chat screen shows: one item of one inbox row. */
export type ChatPendingCard = {
  messageId: string;
  itemIndex: number;
  item: M2CardItem;
};

/** The cards that belong on the chat screen right now: M2 rows from THIS
 *  session, items they said yes to in chat, not yet accepted or declined.
 *  Anything else stays in Messages, which shows every M2 row. */
export function chatPendingCards(messages: InboxMessage[], sessionId: string): ChatPendingCard[] {
  const out: ChatPendingCard[] = [];
  for (const m of messages) {
    if (m.kind !== M2_CARD_KIND) continue;
    if (!sessionId || m.payload?.sessionId !== sessionId) continue;
    const items = Array.isArray(m.payload?.items) ? m.payload.items : [];
    items.forEach((raw, i) => {
      if (!isM2Item(raw)) return;
      if (raw.status === 'accepted' || raw.status === 'declined') return;
      if (!m2ItemConfirmedInChat(raw)) return;
      if (!m2ItemValue(raw)) return;
      out.push({ messageId: m.id, itemIndex: i, item: raw });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The starter map's two entries
// ---------------------------------------------------------------------------

const CORE_CATEGORIES = new Set(['wound', 'fixer', 'skeptic', 'self-like', 'manager', 'firefighter']);

/** How many things are on the map, counted the way first-session.md counts
 *  them: "the feeling or belief", "one way they handle it", "what tends to set
 *  it off" are three entries even when two of them sit on the same part. So an
 *  entry is a filled FIELD, not a part row.
 *
 *  Per part: every markerFields value that is a non-empty string counts once.
 *  A part with no field values but a corePhrase counts once (the older shape,
 *  where the phrase was the only thing written). Unknown categories are not
 *  counted, so an empty node the map draws by default never counts.
 *
 *  ASSUMPTION A6: if the payload carries a server-owned `mapEntryCount` number,
 *  that wins — the server gates [STARTER_MAP_COMPLETE] on the same count and
 *  the two should never disagree. */
export function countMapEntries(map: unknown): number {
  if (!map || typeof map !== 'object') return 0;
  const m = map as { mapEntryCount?: unknown; parts?: unknown };
  if (typeof m.mapEntryCount === 'number' && Number.isFinite(m.mapEntryCount) && m.mapEntryCount >= 0) {
    return Math.floor(m.mapEntryCount);
  }
  const parts = Array.isArray(m.parts) ? m.parts : [];
  let n = 0;
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    const cat = String((p as { category?: unknown }).category || '').toLowerCase();
    if (!CORE_CATEGORIES.has(cat)) continue;
    const mf = (p as { markerFields?: unknown }).markerFields;
    let fields = 0;
    if (mf && typeof mf === 'object') {
      for (const v of Object.values(mf as Record<string, unknown>)) {
        const val = v && typeof v === 'object' ? (v as { value?: unknown }).value : undefined;
        if (typeof val === 'string' && val.trim()) fields++;
      }
    }
    if (fields === 0) {
      const core = (p as { corePhrase?: unknown }).corePhrase;
      if (typeof core === 'string' && core.trim()) fields = 1;
    }
    n += fields;
  }
  return n;
}

/** The first-session "view my map" button opens the map, and an empty map is
 *  the failure first-session.md names: "the button would open an empty map".
 *  Under M2 it waits for two entries. Legacy is untouched. */
export const STARTER_MAP_MIN_ENTRIES = 2;

export function starterMapButtonAllowed(m2: boolean, entries: number): boolean {
  return !m2 || entries >= STARTER_MAP_MIN_ENTRIES;
}

// ---------------------------------------------------------------------------
// When to look for a chat card
// ---------------------------------------------------------------------------

/** ASSUMPTION A3: the pass runs after each assistant reply, in the background,
 *  and its cards land in the inbox some seconds later. Nothing pushes them to
 *  the chat screen, so after a reply finishes the app looks three times. A new
 *  turn cancels the remaining looks and starts its own. */
export const CHAT_CARD_POLL_DELAYS_MS = [3000, 8000, 16000];
