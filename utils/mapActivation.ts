// Lightweight pub/sub so the Chat tab can light up a node on the Map tab
// when CHAT_META detects a part during a conversation. Map tab subscribes
// and updates its local activePart state, which drives the connection-line
// glow and ripple animations in InnerMapCanvas.
//
// Same event-bus pattern as utils/mapPulse.ts — zero re-renders on the tab
// label, just a fire-and-forget signal.
//
// Payload — historically just the category. Now also carries an optional
// `label` so managers / firefighters can surface the SPECIFIC part name
// ("perfectionist", "image-manager", …) inside the circle when active,
// rather than only the generic category. The label is opt-in: existing
// callers that pass nothing keep working unchanged.

export type ActivatablePart =
  | 'wound' | 'fixer' | 'skeptic' | 'self' | 'self-like' | 'manager' | 'firefighter';

type Listener = (part: ActivatablePart, label: string | null, tick: number) => void;
const listeners = new Set<Listener>();
let tick = 0;

/** Fire an activation. Any subscribed Map tab will spring the matching
 *  node + emit its color into the connection lines + ripple outward.
 *  `label` is the specific part name (e.g. "perfectionist") for
 *  manager/firefighter activations; pass undefined / null for the
 *  primary triangle nodes (wound/fixer/skeptic/self/self-like) where
 *  there's only ever one of each. Safe to call from anywhere. */
export function activatePartOnMap(part: ActivatablePart, label?: string | null) {
  tick++;
  const safeLabel = label && String(label).trim() ? String(label).trim() : null;
  for (const l of listeners) l(part, safeLabel, tick);
}

/** Subscribe — returns an unsubscribe function. Callback receives the
 *  category, the optional specific label, and a monotonically-increasing
 *  tick so the subscriber can treat each call as a fresh trigger even if
 *  it lands mid-animation. */
export function subscribeMapActivation(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
