// M2 — the chat talks and offers; a tap writes the map.
//
// The PURE half of the app's M2 code: shapes, parsers and rules, with no React
// and no network, so scripts/smoke-m2-app.mjs can import and run it under Node.
// The live half (the shared flag, accept and decline) is services/m2Store.ts.
// The contract is the server's docs/m2-api.md (branch
// claude/m2-chat-stack-b14563, a87d084); docs/m2-app-assumptions.md says
// where the app follows it and where the Nov 5 rulings, which that doc
// predates, take the app somewhere else.
//
// WHAT M2 CHANGES ON THIS SIDE (founder's lock, mapping-m2 (2).md, and the
// rulings of 2026-11-05):
//   - the chat never writes the map. When the person says yes in chat, the
//     reply carries a [CARD:...] marker, the server makes the card at once, and
//     it shows on the chat screen; the person's tap writes it;
//   - a pass runs once, when the session goes idle, and proposes cards to
//     Messages, each accepted, edited or declined;
//   - one prompt, so the four mode boxes and the mode control go;
//   - a new first-session welcome;
//   - in a first session the "view my starter map" button waits until the
//     server's count of tapped cards reaches two;
//   - two lines of app copy that claimed memory the app does not have are
//     replaced (the Guide's "learns who you are", the YOU folder's biography).
//
// OFF MEANS TODAY. The flag is read once at boot off the first-session status
// payload. Every failure shape reads as OFF, so a flaky request can only ever
// hand someone the app as it is now, never half of M2. The server's own reader
// (lib/m2Flag.js on its branch) fails the same way.

import type { InboxMessage } from './api';

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

/** Confirmed by the server's docs/m2-api.md: GET /api/first-session-status
 *  carries `promptStack: "m2"` and `chatStack: "m2"` for a flagged account and
 *  neither for anyone else. Only the exact string "m2" turns M2 on; anything
 *  else, a missing field, or an unparseable body is OFF. (Its `m2Welcome`
 *  field is ignored: the app keeps the founder's current text as a constant.) */
export function parseM2Flag(statusBody: unknown): boolean {
  if (!statusBody || typeof statusBody !== 'object') return false;
  const b = statusBody as { promptStack?: unknown; chatStack?: unknown };
  return b.promptStack === 'm2' || b.chatStack === 'm2';
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Confirmed by docs/m2-api.md: M2 cards are inbox rows of this kind, one
 *  row per session with an `items` array; accept and decline are the existing
 *  /api/messages/:id/act and /decline with item indices. */
export const M2_CARD_KIND = 'm2_card' as const;

/** Two families of item share a row:
 *   - a CHAT card, made from the reply's [CARD:{kind,part,label,fields,said}]
 *     (mapping-m2 (2).md): kind part | detail | belief | middle, with all the
 *     agreed fields bundled in `payload.fields`;
 *   - a PASS proposal, made by the idle pass: kind part | detail | voice |
 *     middle_ground | second_wound, one value per item (the live markers'
 *     shapes).
 *  "middle" and "middle_ground" are the same thing under two spellings — the
 *  marker and the pass spell it differently — and are read alike. */
export type M2CardKind =
  | 'part' | 'detail' | 'voice' | 'middle_ground' | 'middle' | 'second_wound' | 'belief';

export type M2CardItem = {
  kind: M2CardKind;
  payload: Record<string, unknown>;
  /** A pass proposal's source: their exact words it was drawn from. */
  anchor?: string;
  /** A chat card's source: the sentence they said yes in. */
  said?: string;
  recognised?: 'confirmed' | 'partial';
  /** Which items belong on the chat screen: the ones made from a yes in chat.
   *  Read three ways because the server may mark them by source or by
   *  the pass's own field, which it emits in snake_case. */
  source?: string;
  confirmedInChat?: boolean;
  confirmed_in_chat?: boolean;
  /** Server-owned. "expired" is how the list reports a card past its clock. */
  status?: 'pending' | 'accepted' | 'declined' | 'expired';
  /** What the person changed the wording to before accepting, server-owned. */
  editedValue?: string;
};

const KINDS: M2CardKind[] = ['part', 'detail', 'voice', 'middle_ground', 'middle', 'second_wound', 'belief'];

export function isM2Item(it: unknown): it is M2CardItem {
  if (!it || typeof it !== 'object') return false;
  const o = it as { kind?: unknown; payload?: unknown };
  return KINDS.includes(o.kind as M2CardKind) && !!o.payload && typeof o.payload === 'object';
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function m2ItemPending(it: M2CardItem): boolean {
  return it.status == null || it.status === 'pending';
}

/** A chat card's bundled fields, in the order the marker gave them, empty
 *  values dropped. Empty for a pass proposal. */
export function m2ItemFieldEntries(it: M2CardItem): { key: string; value: string }[] {
  const f = it.payload.fields;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return [];
  const out: { key: string; value: string }[] = [];
  for (const [key, v] of Object.entries(f as Record<string, unknown>)) {
    const value = str(v);
    if (key && value) out.push({ key, value });
  }
  return out;
}

export function m2ItemIsBundled(it: M2CardItem): boolean {
  return m2ItemFieldEntries(it).length > 0;
}

/** The words a pass proposal offers to keep — the thing its edit changes. */
export function m2ItemValue(it: M2CardItem): string {
  const p = it.payload;
  switch (it.kind) {
    case 'middle_ground':
    case 'middle': return str(p.label);
    case 'second_wound': return str(p.wound);
    case 'belief': return str(p.belief) || str(p.value);
    default: return str(p.value);
  }
}

/** The card's headline. A chat card leads with its name (the marker's label,
 *  "2–6 words, their words"), falling back to its first field; a pass
 *  proposal leads with its value. */
export function m2ItemTitle(it: M2CardItem): string {
  if (m2ItemIsBundled(it)) return str(it.payload.label) || m2ItemFieldEntries(it)[0].value;
  return m2ItemValue(it);
}

/** Where the card came from, for the line under it in Messages. */
export function m2ItemSource(it: M2CardItem): string {
  return str(it.said) || str(it.anchor);
}

// Plain words for the map's shapes. The person meets these on a card before
// they have necessarily opened the map, so they say what the thing is rather
// than naming the framework's term (first-session.md: never the map's words
// before they have met the thing). MICROCOPY — flagged for the copy pass.
const PART_WORDS: Record<string, string> = {
  wound: 'what it feels like underneath',
  fixer: 'one way you handle it',
  skeptic: 'one way you handle it',
  'self-like': 'how you hold yourself together',
  manager: 'one way you cope',
  firefighter: 'one way you cope',
};

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
  'what-it-protects': 'what it protects',
  'what-it-manages': 'what it keeps in check',
  'when-it-fires': 'when it steps in',
  'what-it-gives': 'what it gives you',
  'how-it-shows-up': 'how it shows up',
  fear: 'what it’s afraid of',
  desire: 'what it wants',
  history: 'where it comes from',
  note: 'the moment',
};

/** A field's name in plain words. An unknown key never reaches the screen raw. */
export function m2FieldWords(key: string): string {
  return FIELD_WORDS[key] || 'more about it';
}

/** Who a detail or a phrase belongs to: their own name for the part when they
 *  gave one, otherwise plain words. Never the map's internal category name. */
function ownerWords(part: string, label: string): string {
  return label || PART_WORDS[part] || 'a part of you';
}

/** A short line saying what kind of thing this is, or null for none. */
export function m2ItemCategory(it: M2CardItem): string | null {
  const p = it.payload;
  const part = str(p.part);
  const label = str(p.label);
  const field = str(p.field);
  if (m2ItemIsBundled(it)) {
    // A chat card's label is its headline, so the category is the plain kind.
    switch (it.kind) {
      case 'belief': return 'what you stand on';
      case 'middle':
      case 'middle_ground': return 'somewhere you can stand';
      default: return PART_WORDS[part] || null;
    }
  }
  switch (it.kind) {
    case 'part':
      if (part === 'manager' || part === 'firefighter') return label ? `${label} · one way you cope` : PART_WORDS[part];
      if (part === 'wound' && field && FIELD_WORDS[field]) return FIELD_WORDS[field];
      return PART_WORDS[part] || null;
    case 'detail':
      return `${ownerWords(part, label)} · ${FIELD_WORDS[field] || 'more detail'}`;
    case 'voice':
      return `${ownerWords(part, label)} · something it says`;
    case 'belief':
      return 'what you stand on';
    case 'middle_ground':
    case 'middle':
      return null;
    case 'second_wound':
      return 'something separate underneath';
  }
}

export function m2ItemFromChat(it: M2CardItem): boolean {
  return it.source === 'chat' || it.confirmedInChat === true || it.confirmed_in_chat === true;
}

/** A pending card the chat screen shows: one item of one inbox row. */
export type ChatPendingCard = {
  messageId: string;
  itemIndex: number;
  item: M2CardItem;
};

/** The cards that belong on the chat screen right now: M2 rows from THIS
 *  session, items made from a yes in chat, still pending, with something to
 *  show. Anything else stays in Messages, which shows every M2 row. */
export function chatPendingCards(messages: InboxMessage[], sessionId: string): ChatPendingCard[] {
  const out: ChatPendingCard[] = [];
  for (const m of messages) {
    if (m.kind !== M2_CARD_KIND) continue;
    if (!sessionId || m.payload?.sessionId !== sessionId) continue;
    const items = Array.isArray(m.payload?.items) ? m.payload.items : [];
    items.forEach((raw, i) => {
      if (!isM2Item(raw)) return;
      if (!m2ItemPending(raw)) return;
      if (!m2ItemFromChat(raw)) return;
      if (!m2ItemTitle(raw)) return;
      out.push({ messageId: m.id, itemIndex: i, item: raw });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Editing before accepting
// ---------------------------------------------------------------------------

/** A chat card's edit: only what changed. */
export type M2BundledEdit = { label?: string; fields?: Record<string, string> };

/** The draft the edit UI holds: the headline, plus each bundled field. */
export type M2EditDraft = { title: string; fields: Record<string, string> };

export function m2EditDraft(it: M2CardItem): M2EditDraft {
  const fields: Record<string, string> = {};
  for (const { key, value } of m2ItemFieldEntries(it)) fields[key] = value;
  return { title: m2ItemTitle(it), fields };
}

/** What goes in /act's `edits[i]`, or undefined when nothing changed.
 *  A pass proposal edits its one value, as a string — the shape every card
 *  path already takes. A chat card's fields are bundled, so its edit is an
 *  object carrying only the label and the fields that changed. An edit that
 *  empties something is ignored for that piece: emptying is what "Doesn't
 *  fit" is for. */
export function m2BuildEdit(it: M2CardItem, draft: M2EditDraft): string | M2BundledEdit | undefined {
  if (!m2ItemIsBundled(it)) {
    const v = draft.title.trim();
    return v && v !== m2ItemValue(it) ? v : undefined;
  }
  const out: M2BundledEdit = {};
  const label = draft.title.trim();
  const originalLabel = str(it.payload.label);
  if (originalLabel && label && label !== originalLabel) out.label = label;
  const fields: Record<string, string> = {};
  for (const { key, value } of m2ItemFieldEntries(it)) {
    const next = (draft.fields[key] ?? '').trim();
    if (next && next !== value) fields[key] = next;
  }
  if (Object.keys(fields).length) out.fields = fields;
  return out.label !== undefined || out.fields ? out : undefined;
}

// ---------------------------------------------------------------------------
// The starter map's two entries
// ---------------------------------------------------------------------------

/** "The server counts tapped cards for the starter-map button" (ruling
 *  2026-11-05). The app does not count anything itself: it reads the server's
 *  number wherever the server sends one — the first-session status at
 *  boot and the accept response after a tap. Three names are read because the
 *  doc that fixes the name does not exist yet. null means the server said
 *  nothing, which is not the same as zero. */
export function readStarterCount(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  for (const k of ['starterMapCount', 'tappedCardCount', 'mapEntryCount']) {
    const v = b[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  }
  return null;
}

export const STARTER_MAP_MIN_ENTRIES = 2;

/** The first-session button opens the map, and an empty map is the failure
 *  first-session.md names ("the button would open an empty map"). On M2 it
 *  waits for the server's count to reach two. With no count from the server
 *  the marker alone decides, as it does off M2: the server only lets the
 *  marker through once the map has two entries (first-session.md, server
 *  item 1), so a marker that arrived is already the server's yes. */
export function starterMapButtonAllowed(m2: boolean, count: number | null): boolean {
  return !m2 || count === null || count >= STARTER_MAP_MIN_ENTRIES;
}

// ---------------------------------------------------------------------------
// When to look for a chat card (m2-api.md, "Polling for chat cards")
// ---------------------------------------------------------------------------

/** GET /api/m2/pending?sessionId= — the chat screen's own read, which skips
 *  the inbox sweep. The app looks once when a reply finishes (a [CARD:...]
 *  card is made with the reply), then every few seconds for as long as the
 *  server says a pass is still running, up to a ceiling. */
export const M2_PENDING_POLL_MS = 3000;
export const M2_PENDING_MAX_MS = 45000;
/** When the done frame says a pass was scheduled, how long the app keeps
 *  looking before the server reports it running. */
export const M2_PASS_START_GRACE_MS = 10000;

export type M2PendingAnswer = {
  cards: ChatPendingCard[];
  passRunning: boolean;
  starterCount: number | null;
  starterPending: boolean;
};

/** The pending endpoint's body, read with the same rules as the inbox list:
 *  the server picks the chat-screen cards, and the app still drops anything it
 *  cannot show, so the two sources can never disagree about what appears. */
export function parseM2Pending(body: unknown, sessionId: string): M2PendingAnswer | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { sessionId?: unknown; cards?: unknown; passRunning?: unknown; starterPending?: unknown };
  if (typeof b.sessionId === 'string' && b.sessionId !== sessionId) return null;
  const cards: ChatPendingCard[] = [];
  for (const c of Array.isArray(b.cards) ? b.cards : []) {
    const o = c as { messageId?: unknown; itemIndex?: unknown; item?: unknown };
    if (!o || typeof o.messageId !== 'string' || !Number.isInteger(o.itemIndex) || (o.itemIndex as number) < 0) continue;
    const it = o.item;
    if (!isM2Item(it) || !m2ItemPending(it) || !m2ItemFromChat(it) || !m2ItemTitle(it)) continue;
    cards.push({ messageId: o.messageId, itemIndex: o.itemIndex as number, item: it });
  }
  return {
    cards,
    passRunning: b.passRunning === true,
    starterCount: readStarterCount(body),
    starterPending: b.starterPending === true,
  };
}

/** The done frame's `m2` block: whether a pass is coming, and the count. */
export type M2DoneInfo = { passScheduled: boolean; starterCount: number | null; starterPending: boolean };

export function parseM2Done(m2Block: unknown): M2DoneInfo | null {
  if (!m2Block || typeof m2Block !== 'object') return null;
  const b = m2Block as { stack?: unknown; passScheduled?: unknown; starterPending?: unknown };
  if (b.stack !== undefined && b.stack !== 'm2') return null;
  return {
    passScheduled: b.passScheduled === true,
    starterCount: readStarterCount(m2Block),
    starterPending: b.starterPending === true,
  };
}
