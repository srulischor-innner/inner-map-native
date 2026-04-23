// CHAT_META + marker utilities. The server embeds metadata in assistant replies as
// `[CHAT_META:{...}]` at the end of the text (and occasionally MAP_UPDATE, PART_UPDATE,
// SPECTRUM_UPDATE markers). These must never reach the UI or TTS — stripped here and
// parsed for the detectedPart / partLabel so the Chat UI can show a part badge.

export type ChatMeta = {
  detectedPart?: string;
  partLabel?: string | null;
  confidence?: number;
};

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
 * Mirrors the web app's strip list.
 */
export function stripMarkers(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[CHAT_META:[\s\S]*?\]/g, '')
    .replace(/\[(?:MAP_UPDATE|MAP_READY|MAP_FILL|MAP_SECONDARY|SUMMARY_META):[\s\S]*?\]/g, '')
    .replace(/\b(?:PART_UPDATE|PART_SUMMARY_UPDATE|SPECTRUM_UPDATE):[\s\S]*?$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
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
