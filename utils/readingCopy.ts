// Copy for the reading element on the Map tab.
//
// The element follows the SELF-LIKE MIC pattern exactly (founder ruling
// 2026-08-27): a thing on the map that does not light, tappable while locked
// to explain what it needs, lighting differently once it opens. Same visual
// language, same behaviour — people learn one pattern, not two.
//
// THE LOCKED CARD HAS TWO JOBS AND THE ORDER MATTERS. Someone tapping it has
// never seen a reading and does not know what they are being kept from, so it
// leads with WHAT IT IS and only then says what it is waiting for. The
// previous copy did only the second half and read as a rule rather than an
// offer.
//
// AND IT NAMES THE ACTUAL GAP, not the requirement. "It needs both sides"
// told someone who already has one side nothing about whether they were close
// or nowhere. So the waiting line is built from the person's real map state
// and says which pieces are there and which are not — by the names printed on
// the map itself (WOUND, FIXER, SKEPTIC, MANAGERS, FIREFIGHTERS), so the
// sentence can be checked against the thing behind the card.
//
// NO COUNTS, NO PERCENTAGES, NO PROGRESS BAR, NO DISTANCE TO TRAVEL. Not
// "3 of 5", not "one more protector", not "almost there". Which pieces exist
// and which do not — nothing that implies a measured journey.


/** The label under the glyph, in the mic-row register (uppercase, tracked). */
export const READING_LABEL = 'THE WHOLE PICTURE';

// ---------------------------------------------------------------------------
// LOCKED
// ---------------------------------------------------------------------------

export const READING_LOCKED_TITLE = 'The whole picture';

/** Job one: what a reading IS. Constant — everyone tapping this card is
 *  meeting the idea for the first time, whatever their map looks like. The
 *  contrast with chat is the point: the conversation is the only other place
 *  the map gets talked about, and it necessarily works a part at a time. */
export const READING_LEAD =
  'A reading is a page written back to you about your whole map — everything at once, ' +
  'instead of a part at a time. It is the one thing the conversation cannot do: chat ' +
  'stays with whatever is in front of you, and this stands back and reads all of it together.';

/** What the gate actually knows. The server sends every one of these inside
 *  `eligibility` on GET /api/reading; the client only ever reads them. */
export type ReadingEligibility = {
  eligible: boolean;
  reason?: string | null;
  woundBelief?: boolean;
  fixerPattern?: boolean;
  skepticPattern?: boolean;
  protCount?: number;
  protectorFloor?: number;
};

/**
 * Job two: what this particular map is waiting for.
 *
 * Each branch is written out in full rather than assembled from shared
 * fragments. Templates leave visible seams ("Your wound and your Fixer is on
 * the map"), and this card is the first prose a person reads about the
 * feature — it cannot sound generated.
 */
export function readingWaitingLine(e: ReadingEligibility | null | undefined): string {
  const wound = !!e?.woundBelief;
  const fixer = !!e?.fixerPattern;
  const skeptic = !!e?.skepticPattern;
  const prot = typeof e?.protCount === 'number' ? e.protCount : 0;
  const floor = typeof e?.protectorFloor === 'number' ? e.protectorFloor : 3;

  // 1. The belief at the centre. Everything else on the map answers it, so
  //    there is no reading to write without it — and no point naming any
  //    other gap first.
  if (!wound) {
    return 'What it is waiting for is the belief at the centre — the thing your wound actually ' +
      'says about you. Every other part on the map is answering it, so a reading has nowhere ' +
      'to start until it is named.';
  }

  // 2. Both sides absent. The wound alone is a statement, not a picture.
  if (!fixer && !skeptic) {
    return 'Your wound is on the map. Neither side that answers it is yet — not the Fixer, which ' +
      'works to prove the wound wrong, and not the Skeptic, which doubts that it can be. A ' +
      'reading is mostly about how those two pull against each other, so it waits for them.';
  }

  // 3 & 4. One side. This is the case the old copy failed: it told someone
  //        holding half the picture that "it needs both sides", which is true
  //        and useless. Name the side they have and the side they do not.
  if (!fixer) {
    return 'Your wound and your Skeptic are on the map. The Fixer is not — the side that answers ' +
      'the wound by trying to prove it wrong, through drive and achievement and performance. ' +
      'A reading is mostly about how those two pull against each other, so it waits for that side.';
  }
  if (!skeptic) {
    return 'Your wound and your Fixer are on the map. The Skeptic is not — the side that doubts, ' +
      'and that keeps the Fixer from overreaching. A reading is mostly about how those two pull ' +
      'against each other, so it waits for that side.';
  }

  // 5. The everyday layer. Split on nothing-vs-something because "they are
  //    not on the map" is simply false to someone looking at two of them.
  if (prot < floor) {
    if (prot === 0) {
      return 'Your wound and both sides that answer it are on the map. What is not there is the ' +
        'day-to-day — your Managers and Firefighters, the parts that carry this around when ' +
        'you are just living your life. A reading is about how all of that works together, so ' +
        'it waits for them.';
    }
    return 'Your wound and both sides that answer it are on the map, and your Managers and ' +
      'Firefighters have started to appear. The day-to-day is still thin, though — a reading ' +
      'is about how all of it works together, so it waits until more of that everyday layer ' +
      'is on the page.';
  }

  // Unreachable while eligible===false. Never a generic fallback: if this
  // string ever renders, a gate condition exists that this copy does not
  // know about, and saying nothing specific is better than saying something
  // wrong about someone's map.
  return 'Your map has what a reading needs. Give it a moment to catch up.';
}

// ---------------------------------------------------------------------------
// OPEN
// ---------------------------------------------------------------------------

export const READING_UNLOCKED_TITLE = 'The whole picture';

/** Shown on the element itself once it lights, under the label.
 *
 *  The approved open-state card copy ("Your map read as one thing… Tap to
 *  have it written. It takes about a minute.") has no home under the approved
 *  interaction: an open tap starts the reading rather than opening a card, so
 *  there is nowhere for that paragraph to render. Rather than ship it as a
 *  dead export, its one load-bearing fact — the wait — moved into this line.
 *  A minute of generation should never start unannounced. */
export const READING_UNLOCKED_SUB = 'The whole map, read as one thing. About a minute to write.';

export const READING_GOT_IT = 'GOT IT';

// ---------------------------------------------------------------------------
// WAITING (generation takes 50-60s) — unchanged, founder ruling 2026-08-21k.
// The element breathes; these advance on their own timing, never loop, and
// the last one HOLDS so a slow generation never implies a stuck timer.
// ---------------------------------------------------------------------------
export const READING_WAITING_LINES: { text: string; holdMs: number }[] = [
  { text: 'Reading your map…', holdMs: 14000 },
  { text: 'Putting the pieces in order…', holdMs: 16000 },
  { text: 'Writing it out…', holdMs: 20000 },
  { text: 'Almost there.', holdMs: Number.POSITIVE_INFINITY },
];

// ---------------------------------------------------------------------------
// FAILURE — unchanged, founder ruling 2026-08-23.
// ---------------------------------------------------------------------------
export const READING_ERROR_TITLE = "The reading didn't finish";
export const READING_ERROR_BODY =
  'Something went wrong while it was being written. Nothing on your map changed.';
export const READING_ERROR_ACTION = 'Try again';
