// Lightweight pub/sub for "the Self-like belief just changed" — same
// event-bus pattern as utils/mapPulse.ts.
//
// Why push instead of focus-refetch: the Self-like mic's locked state
// (MapVoiceBar.selfLikeEnabled) is loaded once on mount, but the belief
// can change while the Map tab stays mounted the whole time:
//   - the develop-belief chat flow saves via a SAVE_BELIEF marker
//     (user on the Chat tab; Map tab never re-mounts on tab switch), and
//   - the Self-like folder's belief editor saves/clears while the user
//     is ON the Map tab (no focus change at all — a focus-refetch would
//     miss this case entirely).
// Emitting from both save paths keeps every belief-dependent surface
// honest in-session; the existing mount-time fetch covers cold starts.

type Listener = (tick: number) => void;
const listeners = new Set<Listener>();
let tick = 0;

/** Fire after a belief save OR clear lands server-side. Subscribers
 *  re-fetch rather than trusting a payload, so emit-after-mutation is
 *  the only contract. */
export function emitBeliefChanged() {
  tick++;
  for (const l of listeners) l(tick);
}

/** Subscribe to belief changes — returns an unsubscribe function. */
export function subscribeBeliefChanged(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
