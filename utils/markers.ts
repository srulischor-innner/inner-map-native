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

/**
 * Remove every known marker from a string so it's safe to display or speak.
 * Mirrors the web app's strip list. Always strips — used for TTS, saved
 * transcripts, history sent back to the server, and any path where markers
 * leaking through would actually break something.
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
    .replace(/(?:^|\n)\s*(?:MAP_UPDATE|MAP_READY|MAP_FILL|MAP_SECONDARY|CHAT_META|SUMMARY_META):\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '')
    .replace(/\b(?:PART_UPDATE|PART_SUMMARY_UPDATE|SPECTRUM_UPDATE):[\s\S]*?$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Display-time stripper used by the chat-bubble render path. In production
 * builds it behaves identically to `stripMarkers`; in __DEV__ builds it
 * returns the input unchanged so MAP_UPDATE / MAP_SECONDARY / SPECTRUM_UPDATE
 * / CHAT_META / etc. are visible in the bubble for live debugging.
 *
 * IMPORTANT: never use this for TTS, history saves, or anything sent back to
 * the server. Only the visual bubble. Audio + persistence keep using
 * `stripMarkers` unconditionally so a dev build never speaks a marker aloud
 * or echoes one back to the model on the next turn.
 */
export function stripMarkersForDisplay(text: string): string {
  if (!text) return '';
  if (__DEV__) return text;
  return stripMarkers(text);
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
