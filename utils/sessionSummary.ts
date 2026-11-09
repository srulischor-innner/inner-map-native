// THE SESSION SUMMARY, AS THE PERSON READS IT — one reading for the End
// Session screen, the Journey session detail and the share export.
//
// PURE: no React, no network, so scripts/smoke-m2-app.mjs imports and runs it.
//
// TWO SHAPES (2026-11-09):
//
//   idle-v2 (the founder's idle-summary-v2.md; the server stores it on the
//   session and returns it from /api/session-summary):
//     { kind: "idle-v2", whatWeTalkedAbout, whatLanded | null,
//       onYourMap | null, yourWords: string[] }
//   shown in this order: whatWeTalkedAbout, then whatLanded if present, then
//   onYourMap if present, then yourWords if any. The server also sends the
//   old three fields beside them, for app versions that read only those; this
//   app reads the new ones when kind is "idle-v2" and never the old ones then,
//   so nothing shows twice. `forNextTime` is for the next conversation, never
//   for the person: the server does not send it, and nothing here reads it if
//   it does.
//
//   older summaries (kind "structured-v1", or an object with only the old
//   fields): exploredText, then mapShowingText. "Something to try" is gone
//   (idle-summary-v2.md: "The 'something to try' section is removed") and is
//   not shown for old sessions either.
//
// HEADINGS. The founder's files give none for the new fields, so the screen
// reuses its existing ones where they fit (listed for the founder's check):
//   whatWeTalkedAbout                 WHAT WE EXPLORED
//   whatLanded                        the same section, its second paragraph
//                                     (the server files it there too, in the
//                                     old exploredText)
//   onYourMap                         WHAT THE MAP IS SHOWING (where the
//                                     server files it for old versions, as
//                                     mapShowingText)
//   yourWords                         no heading: no existing one fits, so
//                                     the phrases are shown in quotation
//                                     marks under the sections above
//   older exploredText / mapShowingText  unchanged headings

export const SUMMARY_KIND_V2 = 'idle-v2';

export const SUMMARY_HEADING_EXPLORED = 'WHAT WE EXPLORED';
export const SUMMARY_HEADING_MAP = 'WHAT THE MAP IS SHOWING';

/** Anything the server may send or have stored. Every field optional. */
export type SessionSummaryShape = {
  kind?: string | null;
  whatWeTalkedAbout?: string | null;
  whatLanded?: string | null;
  onYourMap?: string | null;
  yourWords?: string[] | null;
  exploredText?: string | null;
  mapShowingText?: string | null;
  /** Older summaries only. Never shown. */
  somethingToTryText?: string | null;
};

/** One block on screen: an optional heading, then its paragraphs. `quoted`
 *  paragraphs are the person's own phrases, shown in quotation marks. */
export type SummarySection = {
  key: 'talked' | 'map' | 'words';
  label: string | null;
  paragraphs: string[];
  quoted?: boolean;
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function isSummaryV2(s: unknown): boolean {
  return !!s && typeof s === 'object' && (s as { kind?: unknown }).kind === SUMMARY_KIND_V2;
}

/** The sections to show, in order, with nothing empty. [] means nothing to
 *  show (the caller shows its fallback line). */
export function summarySections(s: SessionSummaryShape | null | undefined): SummarySection[] {
  if (!s || typeof s !== 'object') return [];
  const out: SummarySection[] = [];
  if (isSummaryV2(s)) {
    const talked = [text(s.whatWeTalkedAbout), text(s.whatLanded)].filter(Boolean);
    if (talked.length) out.push({ key: 'talked', label: SUMMARY_HEADING_EXPLORED, paragraphs: talked });
    const map = text(s.onYourMap);
    if (map) out.push({ key: 'map', label: SUMMARY_HEADING_MAP, paragraphs: [map] });
    const words = (Array.isArray(s.yourWords) ? s.yourWords : []).map(text).filter(Boolean);
    if (words.length) out.push({ key: 'words', label: null, paragraphs: words, quoted: true });
    return out;
  }
  const explored = text(s.exploredText);
  if (explored) out.push({ key: 'talked', label: SUMMARY_HEADING_EXPLORED, paragraphs: [explored] });
  const map = text(s.mapShowingText);
  if (map) out.push({ key: 'map', label: SUMMARY_HEADING_MAP, paragraphs: [map] });
  return out;
}

/** One of the person's phrases as shown: in curly quotation marks. */
export function quotePhrase(p: string): string {
  return `“${p}”`;
}

/** A stored session summary (GET /api/sessions/:id `summary`), read: the
 *  object when it is one of the two JSON shapes, else null (prose, or
 *  nothing). */
export function parseStoredSummary(raw: unknown): SessionSummaryShape | null {
  let j: unknown = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t.startsWith('{')) return null;
    try { j = JSON.parse(t); } catch { return null; }
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o.kind === SUMMARY_KIND_V2 || o.kind === 'structured-v1') return o as SessionSummaryShape;
  if (typeof o.exploredText === 'string' || typeof o.mapShowingText === 'string') return o as SessionSummaryShape;
  return null;
}

/** The fields the app keeps from a /api/session-summary response: the new
 *  ones and the old two it can still show. Never forNextTime. */
export function summaryFromResponse(j: unknown): SessionSummaryShape {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  return {
    kind: typeof o.kind === 'string' ? o.kind : null,
    whatWeTalkedAbout: text(o.whatWeTalkedAbout),
    whatLanded: text(o.whatLanded) || null,
    onYourMap: text(o.onYourMap) || null,
    yourWords: Array.isArray(o.yourWords) ? o.yourWords.map(text).filter(Boolean) : [],
    exploredText: text(o.exploredText),
    mapShowingText: text(o.mapShowingText),
  };
}
