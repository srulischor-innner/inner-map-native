// Lightweight pub/sub so the Chat tab can light up a node on the Map tab
// when CHAT_META detects a part during a conversation. Map tab subscribes
// and updates its local activePart state, which drives the connection-line
// glow and ripple animations in InnerMapCanvas.
//
// Same event-bus pattern as utils/mapPulse.ts — zero re-renders on the tab
// label, just a fire-and-forget signal that carries the part name.

export type ActivatablePart =
  | 'wound' | 'fixer' | 'skeptic' | 'self' | 'self-like' | 'manager' | 'firefighter';

type Listener = (part: ActivatablePart, tick: number) => void;
const listeners = new Set<Listener>();
let tick = 0;

/** Fire an activation. Any subscribed Map tab will spring the matching
 *  node + emit its color into the connection lines + ripple outward.
 *  Safe to call from anywhere. */
export function activatePartOnMap(part: ActivatablePart) {
  tick++;
  for (const l of listeners) l(part, tick);
}

/** Subscribe — returns an unsubscribe function. Callback receives the
 *  part name and a monotonically-increasing tick so the subscriber can
 *  treat each call as a fresh trigger even if it lands mid-animation. */
export function subscribeMapActivation(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
