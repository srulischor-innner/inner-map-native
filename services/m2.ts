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
// The welcome (founder, 2026-11-08)
// ---------------------------------------------------------------------------

/** Two welcomes, chosen by the SERVER by whether the starter map is finished:
 *  the first-conversation one, and a "Welcome back" one whose middle sentence
 *  the server fills from their map or last session. The app shows whichever
 *  the server sends; with nothing usable it falls back to the first-
 *  conversation text (index.tsx's M2_WELCOME), exactly.
 *
 *  This is the one opener that comes off the wire, on M2 only, and only for a
 *  person whose starter map is unfinished. The August ruling made every
 *  opener a compile-time constant because model-made openers kept asserting
 *  things; this text is the server's own, not a model's, and the guard below
 *  is what stands between it and the screen. Anything it rejects becomes the
 *  constant — never a blank, never a partial. */
export const M2_WELCOME_MAX_CHARS = 900;

export function sanitizeM2Welcome(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!t || t.length > M2_WELCOME_MAX_CHARS) return null;
  // Brackets and braces never belong in a welcome: they are a marker, a JSON
  // leak, or the founder's unfilled "[filled by the server …]" placeholder.
  if (/[[\]{}<>]/.test(t)) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(t)) return null;
  return t;
}

/** What the server says about the starter map for a conversation (m2-api.md,
 *  Nov 8): the welcome to open it with, whether it runs with the starter-map
 *  overlay, and whether the starter map is finished. Read the same way off the
 *  first-session status, the build response and (overlay, finished) the done
 *  frame. null means the server did not say. */
export type M2Starter = { welcome: string | null; overlay: boolean | null; finished: boolean | null };

export function parseM2Starter(body: unknown): M2Starter {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return {
    welcome: sanitizeM2Welcome(b.m2Welcome),
    overlay: typeof b.starterOverlay === 'boolean' ? b.starterOverlay : null,
    finished: typeof b.starterMapFinished === 'boolean' ? b.starterMapFinished : null,
  };
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
  status?: 'pending' | 'accepted' | 'declined' | 'expired' | 'superseded';
  /** Why a declined item was declined (founder, round 4): "no" (their typed
   *  no) or "user" ("Not now"). Older staging rows may still say "untapped" or
   *  "left-off" until the server reopens them; those rules are withdrawn. */
  declinedReason?: string;
  /** Still untapped when its conversation went idle: it stays pending and is
   *  a proposal in Messages from then on, tappable there and under its reply. */
  carriedOver?: boolean;
  carriedOverAt?: string;
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

/** The card's headline. A chat card leads with its name: the marker's label
 *  ("2–6 words, their words"), else the server's `value`, which m2-api.md
 *  defines as that same name (label or first field), else its first field. A
 *  pass proposal leads with its value. */
export function m2ItemTitle(it: M2CardItem): string {
  if (m2ItemIsBundled(it)) {
    return str(it.payload.label) || str(it.payload.value) || m2ItemFieldEntries(it)[0].value;
  }
  return m2ItemValue(it);
}

/** Whether a chat card's headline is a name of its own, rather than its first
 *  field standing in for one. */
export function m2ItemHasOwnName(it: M2CardItem): boolean {
  if (!m2ItemIsBundled(it)) return false;
  const first = m2ItemFieldEntries(it)[0].value;
  const name = str(it.payload.label) || str(it.payload.value);
  return !!name && name !== first;
}

/** A middle-ground card's "the line it came from", shown under its label. */
export function m2ItemNote(it: M2CardItem): string {
  return it.kind === 'middle_ground' || it.kind === 'middle' ? str(it.payload.note) : '';
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

// Every field mapping-m2 (3).md line 16 lets a card carry, and what the card
// calls it:
//   wound              belief, feeling, story, body, history, worldview,
//                      trigger, voice, underneath (home-layer-for-code.md
//                      section 3, Nov 8: added after line 16)
//   fixer, skeptic     pattern, selectivity, what-it-protects,
//                      how-it-shows-up, body, history, worldview, desire,
//                      fantasy, voice
//   manager, ff        strategy, when-it-fires, what-it-gives,
//                      what-it-manages, trigger, situation, example, body,
//                      voice, worldview, story
//   self-like          stands-on, body, clenched-or-open
//   middle             label, note
//   belief             belief
// Plus the pass's extras (memory, manner, fear). scripts/smoke-m2-app.mjs
// holds the same list and fails if any of these falls back to the generic
// label, or if two fields on one part read the same.
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
  // "The selectivity tell": the premise is held about one person or one
  // place and not the rest (prompts/beliefSaving.js on the server).
  selectivity: 'who or where it shows up with',
  'what-it-protects': 'what it protects',
  'what-it-manages': 'what it keeps in check',
  'when-it-fires': 'when it steps in',
  'what-it-gives': 'what it gives you',
  'how-it-shows-up': 'how it shows up',
  fear: 'what it’s afraid of',
  desire: 'what it wants',
  fantasy: 'what it dreams of',
  history: 'where it comes from',
  'stands-on': 'what you stand on',
  'clenched-or-open': 'tight or open',
  // The wound's "underneath" (home-layer-for-code.md section 3): who the part
  // is without what it carries, in their words. The founder's own phrase, not
  // "who it is underneath": on a wound card that would sit beside "the belief
  // underneath" and "the feeling underneath", which name the burden, the
  // opposite layer. MICROCOPY — the founder may word it.
  underneath: 'who it is without what it carries',
  // Self-like keys the server's rules still allow (lib/m2/rules.js) though
  // line 16 no longer lists them; labelled so no card can show the generic.
  'what-it-built': 'what you’ve built',
  agenda: 'what it’s after',
  lean: 'which way it leans',
  // A middle card: label is "their words for the moment", note is "the line
  // it came from" (mapping-m2, the pass's middle_ground payload).
  label: 'the moment',
  note: 'what you said',
};

/** A field's name in plain words. An unknown key never reaches the screen raw.
 *  One key reads differently by card: a belief card's `belief` is their own
 *  ground ("what you stand on"), not a wound's belief underneath. */
export function m2FieldWords(key: string, kind?: string): string {
  if (kind === 'belief' && key === 'belief') return FIELD_WORDS['stands-on'];
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

/** A chat card's edit: m2-api.md's object edit, `{ "<field>": "<new value>" }`,
 *  which "replaces just those fields". Only the fields that changed. */
export type M2BundledEdit = Record<string, string>;

/** The draft the edit UI holds: the headline, plus each bundled field. */
export type M2EditDraft = { title: string; fields: Record<string, string> };

export function m2EditDraft(it: M2CardItem): M2EditDraft {
  const fields: Record<string, string> = {};
  for (const { key, value } of m2ItemFieldEntries(it)) fields[key] = value;
  return { title: m2ItemTitle(it), fields };
}

/** What goes in /act's `edits[i]`, or undefined when nothing changed.
 *  A pass proposal edits its one value, as a string — the shape every card
 *  path already takes. A chat card's fields are bundled, so its edit is the
 *  object form, carrying only the fields that changed.
 *
 *  A chat card's NAME is not editable. m2-api.md's only rename is a text edit
 *  on a several-field card, and one edit carries one shape, so a rename and a
 *  field change could not go in the same tap; and the name reaches the map
 *  only for a manager or firefighter. An edit that empties a field is ignored
 *  for that field: emptying is what "Doesn't fit" is for. */
export function m2BuildEdit(it: M2CardItem, draft: M2EditDraft): string | M2BundledEdit | undefined {
  if (!m2ItemIsBundled(it)) {
    const v = draft.title.trim();
    return v && v !== m2ItemValue(it) ? v : undefined;
  }
  const fields: M2BundledEdit = {};
  for (const { key, value } of m2ItemFieldEntries(it)) {
    const next = (draft.fields[key] ?? '').trim();
    if (next && next !== value) fields[key] = next;
  }
  return Object.keys(fields).length ? fields : undefined;
}

// ---------------------------------------------------------------------------
// The starter map's two entries
// ---------------------------------------------------------------------------

/** "The server counts tapped cards for the starter-map button" (ruling
 *  2026-11-05). The app does not count anything itself: it reads the server's
 *  `mapEntryCount` — the number of accepted M2 card items (m2-api.md) — from
 *  the done frame, the accept response and /api/m2/pending. Two other names
 *  are still read so a rename on the server cannot silently zero the button.
 *  null means the server said nothing, which is not the same as zero. */
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
// Reading the chat cards (m2-api.md, "Polling")
// ---------------------------------------------------------------------------

/** GET /api/m2/pending?sessionId= — the chat screen's own read, which skips
 *  the inbox sweep. No polling any more: the card is made on the yes, and the
 *  reply's done frame names it in `cardsAdded`, so the app reads once when
 *  that list is non-empty — plus at M2 boot and on focus. */
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

/** One card's key, the same on every surface: its inbox row and item index. */
export function m2CardKey(messageId: string, itemIndex: number): string {
  return `${messageId}#${itemIndex}`;
}

/** Where a card stands on the chat screen. "pending" is the only state with
 *  buttons. "settled" means the server no longer lists it as pending and has
 *  not said why: greyed, and claiming nothing. */
export type M2CardStatus = 'pending' | 'accepted' | 'declined' | 'superseded' | 'expired' | 'settled';

/** "Left off your map." is said ONLY for a typed no or "Not now" (founder,
 *  round 4: "Untapped is not declined. Only 'Not now' or a no declines a
 *  card."). A declined item for any other reason — the withdrawn "untapped"
 *  and "left-off", or none given — greys out claiming nothing until the
 *  server reopens it. Everything else is the server's status as it stands. */
export function m2ItemShownStatus(it: M2CardItem): M2CardStatus {
  switch (it.status ?? 'pending') {
    case 'pending': return 'pending';
    case 'accepted': return 'accepted';
    case 'declined': return it.declinedReason === 'no' || it.declinedReason === 'user' ? 'declined' : 'settled';
    case 'superseded': return 'superseded';
    case 'expired': return 'expired';
    default: return 'settled';
  }
}

/** A card a reply resolved without a tap: a no, or a corrected offer that
 *  replaces it (founder, card timing). */
export type M2CardResolved = {
  messageId: string;
  itemIndex: number;
  status: 'declined' | 'superseded';
  /** Why: "no" (their typed no) or "corrected" (superseded). "left-off" is a
   *  withdrawn rule, still parsed so an old frame reads; null for anything
   *  else. */
  reason: 'no' | 'left-off' | 'corrected' | null;
  /** The card that replaces a superseded one; it is in the same reply's
   *  cardsAdded. */
  replacedBy: { messageId: string; itemIndex: number } | null;
};

/** What a reply's resolution shows under the card: a decline is "Left off your
 *  map." only when the reason is their no; any other decline greys out
 *  claiming nothing (round 4). A supersede is always "Replaced…", in every
 *  conversation. */
export function m2ResolvedShownStatus(r: M2CardResolved): M2CardStatus {
  if (r.status === 'superseded') return 'superseded';
  return r.reason === 'no' ? 'declined' : 'settled';
}

/** The done frame's `m2` block: the cards this reply made, the earlier cards
 *  it resolved, and the count. (`passScheduled` is always false now that the
 *  pass runs at idle; it is not read.) */
export type M2DoneInfo = {
  cardsAdded: { messageId: string; itemIndex: number }[];
  cardsResolved: M2CardResolved[];
  starterCount: number | null;
  starterPending: boolean;
  /** Whether this turn ran with the starter-map overlay (Nov 8). */
  starterOverlay: boolean | null;
  starterMapFinished: boolean | null;
};

const cardRef = (o: unknown): { messageId: string; itemIndex: number } | null => {
  const r = o as { messageId?: unknown; itemIndex?: unknown } | null;
  return r && typeof r.messageId === 'string' && Number.isInteger(r.itemIndex) && (r.itemIndex as number) >= 0
    ? { messageId: r.messageId, itemIndex: r.itemIndex as number }
    : null;
};

/** CARD TIMING (founder): the card comes with the offer, the tap is the yes,
 *  and a no or a corrected offer resolves it. Field name and shape confirmed
 *  by the chat stack (2026-11-08): cardsResolved, always present on an M2
 *  done frame, [] when empty. This is the one place that reads it. */
const RESOLVED_FIELD = 'cardsResolved';

export function parseM2Done(m2Block: unknown): M2DoneInfo | null {
  if (!m2Block || typeof m2Block !== 'object') return null;
  const b = m2Block as Record<string, unknown> & { stack?: unknown; cardsAdded?: unknown; starterPending?: unknown };
  if (b.stack !== undefined && b.stack !== 'm2') return null;
  const cardsAdded: { messageId: string; itemIndex: number }[] = [];
  for (const c of Array.isArray(b.cardsAdded) ? b.cardsAdded : []) {
    const r = cardRef(c);
    if (r) cardsAdded.push(r);
  }
  const cardsResolved: M2CardResolved[] = [];
  const rawResolved = b[RESOLVED_FIELD];
  for (const c of Array.isArray(rawResolved) ? rawResolved : []) {
    const r = cardRef(c);
    const status = (c as { status?: unknown })?.status;
    if (!r || (status !== 'declined' && status !== 'superseded')) continue;
    const reason = (c as { reason?: unknown }).reason;
    cardsResolved.push({
      ...r,
      status,
      reason: reason === 'no' || reason === 'left-off' || reason === 'corrected' ? reason : null,
      replacedBy: status === 'superseded' ? cardRef((c as { replacedBy?: unknown }).replacedBy) : null,
    });
  }
  const starter = parseM2Starter(m2Block);
  return {
    cardsAdded,
    cardsResolved,
    starterCount: readStarterCount(m2Block),
    starterPending: b.starterPending === true,
    starterOverlay: starter.overlay,
    starterMapFinished: starter.finished,
  };
}

// ---------------------------------------------------------------------------
// THE AXIS RENAME (CHANGE-LIST-2026-11-08.md, ruling 5, Nov 8 21:02): the
// blended axis is "Blended → You Leading" on M2, not "Self-Led": the one who
// leads is "You", and Self is underneath. Only the label words change. The
// sentences around them stay as they are until the founder's copy rewrite.
// ---------------------------------------------------------------------------
export const AXIS_RIGHT_LEGACY = 'Self-Led';
export const AXIS_RIGHT_M2 = 'You Leading';

/** The blended axis's right pole, as the bars show it. */
export function blendedAxisRight(m2: boolean): string {
  return m2 ? AXIS_RIGHT_M2 : AXIS_RIGHT_LEGACY;
}

type AxisCopy = {
  title: string;
  rightLabel: string;
  rightIndicatorsHeading: string;
  sections: { label: string; paragraphs: string[] }[];
};

/** The detail panel's copy for this axis on M2: its title, pole label,
 *  indicator heading and section headings renamed, every sentence untouched. */
export function youLeadingAxisCopy<T extends AxisCopy>(legacy: T): T {
  const rename = (s: string) => s.split(AXIS_RIGHT_LEGACY).join(AXIS_RIGHT_M2);
  return {
    ...legacy,
    title: rename(legacy.title),
    rightLabel: rename(legacy.rightLabel),
    rightIndicatorsHeading: rename(legacy.rightIndicatorsHeading),
    sections: legacy.sections.map((s) => ({ ...s, label: rename(s.label) })),
  };
}
