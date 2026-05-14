// Chat-activity service — owns a single boolean "is the user actively
// in a chat session right now?" that the bottom-tab Map icon uses to
// render its subtle "alive" pulse. Same subscriber pattern as
// services/mapSeen.ts so the tab layout can subscribe once and react
// to changes without polling.
//
// Semantics:
//   - Chat tab calls setChatSessionActive(true) AFTER the user sends
//     their first message in the current session. We don't want the
//     pulse firing on bare tab focus; it should signal "there is live
//     conversation happening that may produce map content."
//   - Chat tab calls setChatSessionActive(false) on session end
//     (end-session button / summary modal flow), on chat-tab blur, or
//     on app background.
//   - This is distinct from the unseen-map dot (services/mapSeen.ts):
//     that dot is a concrete "new content waiting" signal that lingers
//     until the user visits the Map tab. The chatActive pulse is an
//     ambient "the map is listening" signal that disappears the moment
//     the session ends — no persistence, no server round-trip.

let active = false;
const listeners = new Set<(isActive: boolean) => void>();

function broadcast() {
  for (const fn of listeners) {
    try { fn(active); } catch (e) {
      console.warn('[chatActivity] listener threw:', (e as Error)?.message);
    }
  }
}

/** Subscribe to chatSessionActive transitions. Fires immediately with
 *  the current value so a freshly-mounted subscriber doesn't have to
 *  wait for the next transition to learn the state. Returns an
 *  unsubscribe function. */
export function subscribeChatActivity(listener: (isActive: boolean) => void): () => void {
  listeners.add(listener);
  try { listener(active); } catch {}
  return () => { listeners.delete(listener); };
}

/** Flip the chat-active state. Idempotent — a no-op if the new value
 *  matches the current one, so callers can fire on every relevant
 *  event without worrying about deduplication. */
export function setChatSessionActive(next: boolean): void {
  if (active === next) return;
  active = next;
  broadcast();
}

/** Synchronous read of the current state. Useful for one-shot reads
 *  that don't need a subscription (e.g. a non-React caller deciding
 *  whether to skip work). Subscribers should use subscribeChatActivity
 *  instead so they re-render on changes. */
export function isChatSessionActive(): boolean {
  return active;
}
