// Copy for the reading element on the Map tab (founder ruling 2026-08-21k).
//
// The reading REUSES the self-like element's pattern: it sits on the map as
// an element that does not click, states plainly what unlocks it, and becomes
// clickable when the map qualifies. No card, no counter, no percentage, no
// progress bar — becoming clickable is most of the message.
//
// Register matched to the existing lock copy in MapVoiceBar:
//   "Unlocks with what you stand on" / "This voice speaks from your own
//    ground — so it waits until there's ground to speak from..."

export const READING_LOCKED_TITLE = 'Unlocks when the map has enough to read';
export const READING_LOCKED_BODY =
  "A reading takes the whole map at once — the wound, both sides that answer it, and the parts that carry it day to day. It opens once those are on the page.";

export const READING_UNLOCKED_TITLE = 'Your reading';
export const READING_UNLOCKED_BODY = 'The whole map, read as one thing.';

// THE WAITING STATE (founder ruling 2026-08-21k). Generation takes 50–60
// seconds and must read as being written, not as a spinner that looks broken.
// The element itself breathes; these lines advance on their own timing, never
// loop, and the last one HOLDS — so a slower generation never implies a stuck
// timer. No percentage, ever.
export const READING_WAITING_LINES: { text: string; holdMs: number }[] = [
  { text: 'Reading your map…', holdMs: 14000 },
  { text: 'Putting the pieces in order…', holdMs: 16000 },
  { text: 'Writing it out…', holdMs: 20000 },
  { text: 'Almost there.', holdMs: Number.POSITIVE_INFINITY },
];
