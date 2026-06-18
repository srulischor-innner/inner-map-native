// CHAT_META + marker utilities. The server embeds metadata in assistant replies as
// `[CHAT_META:{...}]` at the end of the text (and occasionally MAP_UPDATE, PART_UPDATE,
// SPECTRUM_UPDATE markers). These must never reach the UI or TTS — stripped here and
// parsed for the detectedPart / partLabel so the Chat UI can show a part badge.

export type ChatMeta = {
  detectedPart?: string;
  partLabel?: string | null;
  confidence?: number;
};

/** Two sets of values, merged at the AttentionIndicator:
 *    AI-driven (from ATTENTION_STATE markers in assistant replies):
 *      quiet | listening | noticing
 *    User-action-driven (from chat tab interactions):
 *      idle | userTyping | thinking | streaming | detected
 *  User-action states take precedence over AI markers because they
 *  reflect the literal current activity. NEVER quantitative — every
 *  value is a qualitative ambient state. */
export type AttentionState =
  | 'quiet' | 'listening' | 'noticing'
  | 'idle' | 'userTyping' | 'thinking' | 'streaming' | 'detected';

/** A noticing-state marker can carry the part being noticed so the chat
 *  header can render a small label below the triangle. quiet/listening
 *  never carry a part. The set must mirror PART_DISPLAY below. */
export type NoticedPart =
  | 'wound' | 'fixer' | 'skeptic' | 'self-like' | 'manager' | 'firefighter' | 'self';

export type AttentionPayload = {
  state: AttentionState;
  part: NoticedPart | null;
};

/** Parse the latest ATTENTION_STATE marker from streaming text. The AI
 *  emits these as `[ATTENTION_STATE:listening]` or
 *  `[ATTENTION_STATE:noticing | part: fixer]` (line- or inline-safe).
 *  Returns the LAST occurrence so a later state in the same turn wins. */
export function parseAttentionStatePayload(text: string): AttentionPayload | null {
  if (!text) return null;
  const re = /\[?ATTENTION_STATE:\s*(quiet|listening|noticing)(?:\s*\|\s*part:\s*([a-z-]+))?\s*\]?/gi;
  let m: RegExpExecArray | null;
  let last: AttentionPayload | null = null;
  while ((m = re.exec(text)) !== null) {
    const state = m[1].toLowerCase() as AttentionState;
    const rawPart = (m[2] || '').toLowerCase();
    const allowed: NoticedPart[] =
      ['wound', 'fixer', 'skeptic', 'self-like', 'manager', 'firefighter', 'self'];
    const part: NoticedPart | null =
      state === 'noticing' && (allowed as string[]).includes(rawPart)
        ? (rawPart as NoticedPart)
        : null;
    last = { state, part };
  }
  return last;
}

/** Backwards-compatible state-only parser — kept so existing callers that
 *  only need the AttentionState string don't need to change. */
export function parseAttentionState(text: string): AttentionState | null {
  return parseAttentionStatePayload(text)?.state ?? null;
}

/**
 * Extract CHAT_META JSON from an assistant reply. Forgiving — returns null if the
 * marker is absent or the JSON is malformed (which happens mid-stream before the
 * closing `]` has arrived).
 */
export function parseChatMeta(text: string): ChatMeta | null {
  const m = text.match(/\[CHAT_META:(\{[\s\S]*?\})\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as ChatMeta;
  } catch {
    return null;
  }
}

/** Strict ADDED_TO_MAP marker pattern. Only matches the COMPLETE form
 *  `[ADDED_TO_MAP: <name>]` — partial markers mid-stream
 *  (`[ADDED_TO_MAP: the`) don't match, so the partial text stays in
 *  the bubble until the closing bracket arrives and the regex starts
 *  catching it.
 *
 *  Capture group 1 is the descriptive name; whitespace around the
 *  name is trimmed on parse. */
const ADDED_TO_MAP_RE = /\[ADDED_TO_MAP:\s*([^\]]+)\]/g;

/** Strict SHARE_SUGGEST marker pattern. PR C — relationship-mode
 *  private chats use this to nudge the user to share something they
 *  just said into the shared space. The native client renders a
 *  SharePromptCard inline at each match position; tapping the card
 *  opens a confirmation modal with the suggestion as the editable
 *  pre-filled content.
 *
 *  Same strict-match semantics as ADDED_TO_MAP — partial markers
 *  mid-stream don't match. */
const SHARE_SUGGEST_RE = /\[SHARE_SUGGEST:\s*([^\]]+)\]/g;

export type AddedToMapMatch = {
  /** Whole match including brackets, e.g. "[ADDED_TO_MAP: anxious part]". */
  raw: string;
  /** Trimmed descriptive name from the capture group. */
  name: string;
  /** Start index in the source text (inclusive). */
  start: number;
  /** End index in the source text (exclusive). */
  end: number;
};

/** Find every complete [ADDED_TO_MAP: ...] marker in the input.
 *  Returns matches in document order. The bubble renderer uses this
 *  to splice MapPill components in at each match position. Empty
 *  array on no matches or malformed input — never throws. */
export function parseAddedToMapMarkers(text: string): AddedToMapMatch[] {
  if (!text) return [];
  const out: AddedToMapMatch[] = [];
  // Local copy of the global regex — global state on a module-level
  // /g regex would race between callers.
  const re = new RegExp(ADDED_TO_MAP_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = String(m[1] || '').trim();
    if (!name) continue;
    out.push({
      raw: m[0],
      name,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export type ShareSuggestMatch = {
  raw: string;
  /** The suggestion text — pre-fills the share confirmation modal. */
  suggestion: string;
  start: number;
  end: number;
};

/** Find every complete [SHARE_SUGGEST: ...] marker. Same strict-match
 *  semantics as parseAddedToMapMarkers — partial markers mid-stream
 *  don't match. The bubble renderer (in relationship-mode private
 *  chats) splices a <SharePromptCard> in at each marker position;
 *  tapping the card opens a confirmation modal pre-filled with the
 *  suggestion text. */
export function parseShareSuggestMarkers(text: string): ShareSuggestMatch[] {
  if (!text) return [];
  const out: ShareSuggestMatch[] = [];
  const re = new RegExp(SHARE_SUGGEST_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const suggestion = String(m[1] || '').trim();
    if (!suggestion) continue;
    out.push({
      raw: m[0],
      suggestion,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** Strict ADDED_TO_MIDDLE marker pattern — the user-facing pill for the
 *  Self-like "where you live" collection. Same strict-match semantics as
 *  ADDED_TO_MAP: only the COMPLETE `[ADDED_TO_MIDDLE: <label>]` form
 *  matches, so a partial marker mid-stream stays as plain text until its
 *  closing bracket arrives. Capture group 1 is the item label. */
const ADDED_TO_MIDDLE_RE = /\[ADDED_TO_MIDDLE:\s*([^\]]+)\]/g;

export type AddedToMiddleMatch = {
  /** Whole match including brackets, e.g. "[ADDED_TO_MIDDLE: rock climbing]". */
  raw: string;
  /** Trimmed item label from the capture group. */
  name: string;
  start: number;
  end: number;
};

/** Find every complete [ADDED_TO_MIDDLE: ...] marker in document order.
 *  The bubble renderer splices a <MiddlePill> at each match position —
 *  same mechanism as parseAddedToMapMarkers. Empty array on no matches
 *  or malformed input; never throws. */
export function parseAddedToMiddleMarkers(text: string): AddedToMiddleMatch[] {
  if (!text) return [];
  const out: AddedToMiddleMatch[] = [];
  const re = new RegExp(ADDED_TO_MIDDLE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = String(m[1] || '').trim();
    if (!name) continue;
    out.push({ raw: m[0], name, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Remove every known marker from a string so it's safe to display or speak.
 * Mirrors the web app's strip list. Always strips — used for TTS, saved
 * transcripts, history sent back to the server, and any path where markers
 * leaking through would actually break something.
 *
 * stripMarkers also strips ADDED_TO_MAP — the user-facing pill marker
 * MUST be removed before audio playback (so the AI doesn't speak the
 * literal "[ADDED_TO_MAP: ...]" string out loud) and before history is
 * sent back to the model (so the model doesn't see its own pill
 * markers echoed back). Display path uses stripMarkersForDisplay,
 * which leaves ADDED_TO_MAP in place.
 */
export function stripMarkers(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[CHAT_META:[\s\S]*?\]/g, '')
    .replace(/\[(?:MAP_UPDATE|MAP_READY|MAP_FILL|MAP_SECONDARY|SUMMARY_META):[\s\S]*?\]/g, '')
    // ATTENTION_STATE — bracketed and bare forms both stripped from visible text.
    .replace(/\[?ATTENTION_STATE:\s*(?:quiet|listening|noticing)(?:\s*\|\s*part:\s*[a-z-]+)?\s*\]?/gi, '')
    // Line-anchored bare forms emitted by the new MAPPING prompt at the
    // very end of replies — same set as the bracketed versions above.
    .replace(/(?:^|\n)\s*(?:MAP_UPDATE|MAP_READY|MAP_FILL|MAP_SECONDARY|CHAT_META|SUMMARY_META|NOTICED):\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '')
    .replace(/\b(?:PART_UPDATE|PART_SUMMARY_UPDATE|SPECTRUM_UPDATE):[\s\S]*?$/gm, '')
    // NOTICED — parked part-observation marker (server persists onto the
    // session's noticedParts; consumed by end-session gathering). Never
    // user-visible in any mode — strip bracketed fallback shape too.
    .replace(/\[NOTICED:\s*\{[\s\S]*?\}\s*\]/g, '')
    // ADDED_TO_MAP — user-facing pill marker. Stripped here for TTS +
    // history + saves. The display path preserves it (see
    // stripMarkersForDisplay) so the bubble renderer can splice in a
    // <MapPill> component at the marker's position.
    .replace(/\[ADDED_TO_MAP:\s*[^\]]+\]/g, '')
    // SHARE_SUGGEST — same treatment. PR C nudge marker in
    // relationship-mode private chats. Display path preserves it
    // so the bubble can render a <SharePromptCard>.
    .replace(/\[SHARE_SUGGEST:\s*[^\]]+\]/g, '')
    // INTAKE_COMPLETE — fires once at the end of the first relationship-
    // mode session after the AI has collected all five intake answers.
    // Server-side parser persists the JSON payload onto relationship_-
    // intakes; client just needs to scrub the marker from the bubble.
    // JSON values may contain newlines, so we use [\s\S] inside.
    .replace(/(?:^|\n)\s*INTAKE_COMPLETE:\s*\{[\s\S]*?\}/g, '')
    // STARTER_MAP_COMPLETE — first-session completion signal. Server
    // detects it in the streamed text and writes firstSessionCompletedAt;
    // the client uses its presence to render a "View my starter map"
    // button below the message. Strip it from TTS / history / saves
    // so the model doesn't speak the literal marker aloud and doesn't
    // see its own marker echoed back next turn. Display path preserves
    // it (see hasStarterMapComplete + stripMarkersForDisplay below).
    .replace(/\[STARTER_MAP_COMPLETE\]/g, '')
    // SAVE_BELIEF — Phase 2 (polish round 8) belief-work marker. The
    // server parses + strips this from /api/chat replies before they
    // hit the client and emits the parsed records via savedBeliefs[]
    // on the response payload (cleanedText is what arrives in the
    // streamed text). Adding the strip rule here is defensive — a
    // streaming-mid-flush could let a partial marker leak through,
    // and we never want the literal "[SAVE_BELIEF:{...}]" string to
    // be spoken by TTS or echoed back into the model's next turn.
    .replace(/\[SAVE_BELIEF:\s*\{[\s\S]*?\}\s*\]/g, '')
    // MIDDLE_GROUND — Self-like "where you live" data marker. The server
    // parses + strips it before the reply reaches us; this is the
    // defensive catch for streaming partials. ADDED_TO_MIDDLE is the
    // user-facing pill: stripped HERE (TTS + history + saves must never
    // include it or echo it back), but PRESERVED by stripMarkersForDisplay
    // so the bubble can render a <MiddlePill> — same split as ADDED_TO_MAP.
    .replace(/\[MIDDLE_GROUND:\s*\{[\s\S]*?\}\s*\]/g, '')
    .replace(/\[ADDED_TO_MIDDLE:\s*[^\]]+\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// ===== STREAMING TAIL HOLD-BACK ============================================
// With true streaming (build 14+), marker text arrives split across deltas —
// "CHAT_ME" in one chunk, "TA:{...}" in the next. The strip functions only
// remove COMPLETE markers, so a partial trailing marker would flash in the
// bubble (or get spoken by TTS) before its closing bytes arrive.
// holdBackBoundary returns the index up to which the accumulated text is SAFE
// to display/speak; the caller slices there and re-evaluates on every delta.
// Two candidate hold points, earliest wins:
//   (a) the last '[' that could still grow into a bracketed marker
//       ([ADDED_TO_MAP: …], [SAVE_BELIEF:{…}], [STARTER_MAP_COMPLETE], …)
//       and has no closing ']' yet, and
//   (b) the final line, when it could still grow into a line-anchored
//       marker (MAP_UPDATE:, CHAT_META:, NOTICED:, …) — either a pure
//       uppercase run that prefixes a known token ("MAP_UPD") or a full
//       "NAME:" already present with its payload still streaming.
// Prose releases immediately: "[sic]" closes its bracket; "Maybe" stops
// being a candidate the moment its lowercase 'a' arrives. Held text is only
// ever transiently withheld — once complete, markers are stripped (or, for
// ADDED_TO_MAP, rendered as a pill) by the normal display path.

// Line-anchored marker tokens the server/prompts emit at end of reply.
const LINE_MARKER_TOKENS = [
  'MAP_UPDATE:', 'MAP_READY:', 'MAP_FILL:', 'MAP_SECONDARY:',
  'CHAT_META:', 'SUMMARY_META:', 'SPECTRUM_UPDATE:', 'PART_UPDATE:',
  'PART_SUMMARY_UPDATE:', 'ATTENTION_STATE:', 'NOTICED:', 'INTAKE_COMPLETE:',
];
// Names that appear in bracketed form ('[NAME…]'). STARTER_MAP_COMPLETE has
// no colon; the prefix test below treats the name itself as the token.
const BRACKET_MARKER_TOKENS = [
  'ADDED_TO_MAP:', 'SHARE_SUGGEST:', 'SAVE_BELIEF:', 'KEY_MOMENT:',
  'STARTER_MAP_COMPLETE', 'CHAT_META:', 'MAP_UPDATE:', 'MAP_READY:',
  'MAP_FILL:', 'MAP_SECONDARY:', 'SPECTRUM_UPDATE:', 'SUMMARY_META:',
  'NOTICED:', 'CRISIS_DETECTED:',
  // Middle-ground collection (Self-like "where you live"). Data marker +
  // user-facing pill — registered so a streaming partial holds back
  // instead of flashing a raw marker.
  'MIDDLE_GROUND:', 'ADDED_TO_MIDDLE:',
];

function couldBeTokenPrefix(s: string, tokens: string[]): boolean {
  for (const t of tokens) {
    if (t.startsWith(s) || s.startsWith(t)) return true;
  }
  return false;
}

export function holdBackBoundary(text: string): number {
  if (!text) return 0;
  let boundary = text.length;

  // (a) Bracket candidate — last '[' with no ']' after it.
  const lb = text.lastIndexOf('[');
  if (lb >= 0 && text.indexOf(']', lb) === -1) {
    const after = text.slice(lb + 1);
    // Could this still become a bracketed marker? Either the name is
    // still being typed (pure uppercase/underscore run), or a known
    // token is already present and we're mid-payload.
    if (/^[A-Z_]*$/.test(after) || couldBeTokenPrefix(after, BRACKET_MARKER_TOKENS)) {
      boundary = Math.min(boundary, lb);
    }
  }

  // (b) Line candidate — the final (newline-unterminated) line.
  const nl = text.lastIndexOf('\n');
  const lineStart = nl + 1; // 0 when no newline
  const line = text.slice(lineStart).replace(/^\s+/, '');
  if (line.length > 0) {
    const fullToken = LINE_MARKER_TOKENS.find((t) => line.startsWith(t));
    const pureRun = /^[A-Z_]+$/.test(line) && couldBeTokenPrefix(line, LINE_MARKER_TOKENS);
    if (fullToken || pureRun) {
      boundary = Math.min(boundary, lineStart);
    }
  }

  return boundary;
}

/**
 * Display-time stripper used by the chat-bubble render path. In production
 * builds it strips most markers but PRESERVES [ADDED_TO_MAP: ...] so the
 * bubble renderer (MessageBubble) can find the marker and splice in a
 * <MapPill> component at that position. In __DEV__ builds it returns
 * the input unchanged so MAP_UPDATE / MAP_SECONDARY / SPECTRUM_UPDATE /
 * CHAT_META / etc. are visible for live debugging.
 *
 * IMPORTANT: never use this for TTS, history saves, or anything sent back to
 * the server. Only the visual bubble. Audio + persistence keep using
 * `stripMarkers` unconditionally so a dev build never speaks a marker aloud
 * (or pill-marker text aloud) or echoes a marker back to the model.
 */
export function stripMarkersForDisplay(text: string): string {
  if (!text) return '';
  if (__DEV__) return text;
  // Production: same as stripMarkers but RESTORE the user-facing
  // pill markers so MessageBubble can position pills inline.
  // Specifically preserved here (vs stripMarkers):
  //   - ADDED_TO_MAP   (any chat mode)
  //   - SHARE_SUGGEST  (relationship-mode chats)
  //
  // Implementation: duplicate the regex chain minus those two
  // replacements so the markers survive intact.
  return text
    .replace(/\[CHAT_META:[\s\S]*?\]/g, '')
    .replace(/\[(?:MAP_UPDATE|MAP_READY|MAP_FILL|MAP_SECONDARY|SUMMARY_META|NOTICED):[\s\S]*?\]/g, '')
    .replace(/\[?ATTENTION_STATE:\s*(?:quiet|listening|noticing)(?:\s*\|\s*part:\s*[a-z-]+)?\s*\]?/gi, '')
    .replace(/(?:^|\n)\s*(?:MAP_UPDATE|MAP_READY|MAP_FILL|MAP_SECONDARY|CHAT_META|SUMMARY_META|NOTICED):\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '')
    .replace(/\b(?:PART_UPDATE|PART_SUMMARY_UPDATE|SPECTRUM_UPDATE):[\s\S]*?$/gm, '')
    // ADDED_TO_MAP and SHARE_SUGGEST intentionally NOT stripped here.
    // STARTER_MAP_COMPLETE — UNLIKE the pill markers, this one IS
    // stripped from the display path too. The marker is a pure
    // structured signal: the UI renders a "View my starter map"
    // button beside the bubble (not inline at the marker's position),
    // so leaving the literal "[STARTER_MAP_COMPLETE]" string in the
    // bubble would just be noise. Detection is done separately via
    // hasStarterMapComplete(rawText) before this strip runs.
    .replace(/\[STARTER_MAP_COMPLETE\]/g, '')
    // SAVE_BELIEF — see note in stripMarkers(). The server normally
    // strips this before the response reaches us; the rule here is
    // a defensive catch for streaming partials that slipped through.
    .replace(/\[SAVE_BELIEF:\s*\{[\s\S]*?\}\s*\]/g, '')
    // MIDDLE_GROUND — the "where you live" DATA marker: always stripped
    // from display (never user-facing; carries the JSON the server
    // persists). The ADDED_TO_MIDDLE PILL marker is intentionally NOT
    // stripped here — like ADDED_TO_MAP / SHARE_SUGGEST above it survives
    // so MessageBubble can splice a <MiddlePill> at its position.
    // stripMarkers (TTS/history) still removes both.
    .replace(/\[MIDDLE_GROUND:\s*\{[\s\S]*?\}\s*\]/g, '')
    // INTAKE_COMPLETE — strip from display path too. The marker is
    // pure structured payload (the 5 intake fields are persisted
    // server-side); the user-visible transition line that follows
    // it carries all the displayable copy.
    .replace(/(?:^|\n)\s*INTAKE_COMPLETE:\s*\{[\s\S]*?\}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Returns true if the raw assistant text contains the
 *  [STARTER_MAP_COMPLETE] marker. The chat tab uses this to decide
 *  whether to render a "View my starter map" button below the
 *  bubble. Detect BEFORE calling stripMarkers/stripMarkersForDisplay
 *  — those both strip the marker. */
export function hasStarterMapComplete(text: string): boolean {
  if (!text) return false;
  return /\[STARTER_MAP_COMPLETE\]/.test(text);
}

/** Friendly display name for each part category. */
export const PART_DISPLAY: Record<string, string> = {
  wound: 'Wound',
  fixer: 'Fixer',
  skeptic: 'Skeptic',
  self: 'Self',
  'self-like': 'Self-Like',
  compromised: 'Self-Like',
  manager: 'Manager',
  firefighter: 'Firefighter',
};

/** Color for each part — must match constants/theme.ts palette. */
export const PART_COLOR: Record<string, string> = {
  wound: '#E05050',
  fixer: '#E6B47A',
  skeptic: '#86BDDC',
  self: '#C1AAD8',
  'self-like': '#8A7AAA',
  compromised: '#8A7AAA',
  manager: '#9DCCB3',
  firefighter: '#EF8C30',
};
