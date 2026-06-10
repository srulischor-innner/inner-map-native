// Messages-inbox service — owns the cache + subscriber pattern for the
// hamburger "Messages" unread-count badge. Mirrors services/mapSeen.ts.
//
// Lifecycle:
//   - Subscribers (HamburgerMenu) register a listener invoked whenever
//     the unread count changes.
//   - Pollers call refreshInboxStatus(): app-foreground, hamburger open,
//     and after a chat session ends. Hitting GET /api/messages also runs
//     the server's lazy abandoned-session sweep, so the badge is what
//     materializes pending_parts messages for stale sessions.
//   - The inbox screen calls refreshInboxStatus(true) after read/act so
//     the badge tracks immediately.
//
// Quiet by design: a small count, no animation, low-urgency signal —
// 30s cache staleness is invisible.

import { api, InboxMessage } from './api';

const CACHE_TTL_MS = 30 * 1000;

type InboxStatus = {
  unreadCount: number;
  messages: InboxMessage[];
};

let cached: InboxStatus | null = null;
let cachedAt = 0;
let inFlight: Promise<InboxStatus | null> | null = null;
const listeners = new Set<(s: InboxStatus) => void>();

function broadcast(s: InboxStatus) {
  for (const fn of listeners) {
    try { fn(s); } catch (e) {
      console.warn('[inbox] listener threw:', (e as Error)?.message);
    }
  }
}

/** Subscribe to inbox updates. Fires immediately with the cached value
 *  (if any). Returns an unsubscribe fn. */
export function subscribeInbox(listener: (s: InboxStatus) => void): () => void {
  listeners.add(listener);
  if (cached) {
    try { listener(cached); } catch {}
  }
  return () => { listeners.delete(listener); };
}

/** Fetch + cache the inbox from the server. Joins an in-flight fetch;
 *  force=true bypasses the cache (after read/act mutations). */
export async function refreshInboxStatus(force = false): Promise<InboxStatus | null> {
  const now = Date.now();
  if (!force && cached && (now - cachedAt) < CACHE_TTL_MS) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const next = await api.listMessages();
      cached = { unreadCount: next.unreadCount, messages: next.messages };
      cachedAt = Date.now();
      broadcast(cached);
      return cached;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Reset on logout / account-delete. */
export function resetInbox(): void {
  cached = null;
  cachedAt = 0;
  broadcast({ unreadCount: 0, messages: [] });
}
