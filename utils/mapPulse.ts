// Lightweight pub/sub so the Chat tab can trigger a pulse animation on the
// MAP tab label in the top tab bar when CHAT_META / MAP_UPDATE arrives.
// Event-bus pattern (not context) because the tab bar lives above the
// route tree and we want zero re-renders on pulse — we just fire a
// numeric ticker that the tab bar's animation effect watches.

type Listener = (tick: number) => void;
const listeners = new Set<Listener>();
let tick = 0;

/** Fire a pulse. Any subscribed MAP tab label will run its highlight
 *  animation once. Safe to call from anywhere on any thread. */
export function pulseMapTab() {
  tick++;
  for (const l of listeners) l(tick);
}

/** Subscribe to pulses — returns an unsubscribe function. The callback
 *  receives a monotonically-increasing tick so the subscriber can treat
 *  each call as a fresh trigger even if it arrives mid-animation. */
export function subscribeMapPulse(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
