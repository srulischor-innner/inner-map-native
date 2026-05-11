// Lightweight pub/sub for per-user rate-limit notifications.
//
// services/api.ts emits a notice when the server returns a 429 with
// `error: "rate-limit-exceeded"`. The chat tab subscribes to render
// a brief inline notification for the /api/speak case (the /api/chat
// case is delivered via the StreamCallbacks.onRateLimit callback —
// inline in the conversation flow, styled card, no pub/sub needed).
//
// Same event-bus pattern as utils/mapPulse + utils/mapActivation:
// zero re-renders on inactive screens, fire-and-forget signal.

export type RateLimitNotice = {
  /** Which endpoint hit the cap. Currently 'speak'; 'chat' is
   *  handled directly by the StreamCallbacks.onRateLimit path. */
  endpoint: string;
  /** Server-prepared human-readable copy to display. */
  message: string;
  /** Monotonically increasing tick — lets subscribers treat each
   *  notice as a fresh trigger even if it lands mid-animation
   *  while a previous notice is still on screen. */
  tick: number;
};

type Listener = (n: RateLimitNotice) => void;
const listeners = new Set<Listener>();
let tick = 0;

/** Fire a notice. Any subscribed screen will receive it
 *  fire-and-forget. Safe to call from anywhere. */
export function emitRateLimitNotice(endpoint: string, message: string) {
  tick++;
  const notice: RateLimitNotice = { endpoint, message, tick };
  for (const l of listeners) l(notice);
}

/** Subscribe — returns an unsubscribe function. */
export function subscribeRateLimitNotice(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
