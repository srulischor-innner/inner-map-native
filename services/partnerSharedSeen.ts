// Partner-shared-seen service (PR 2). Owns the cache + subscriber
// pattern for the "new shared-space content" dot on the Partner tab.
//
// Mirrors services/mapSeen.ts. Two key differences:
//   1. Status is per-relationship (the relationshipId arg). Most users
//      have at most one active pairing, so the cache is keyed on the
//      single most-recently-queried id. If a future build supports
//      multiple simultaneous pairings, switch to a Map<relId, Status>.
//   2. We also surface `frozenUntil` so the Partner-tab dot can be
//      suppressed during off-purpose cooldowns (no point flagging
//      unread when the user can't act on it).
//
// Lifecycle:
//   - Subscribers register a listener that's invoked whenever status
//     changes.
//   - Pollers (the layout's pathname / AppState listener) call
//     refreshPartnerSharedSeenStatus(relId), which hits
//     /api/relationships/:id/shared/unread-status if the cached value
//     for THAT relId is older than CACHE_TTL_MS.
//   - markPartnerSharedSeen(relId) is called when the user enters the
//     Partner tab. Optimistic broadcast hasUnread=false; then POST
//     /shared/mark-seen; then refresh to confirm.

import { api } from './api';

const CACHE_TTL_MS = 30 * 1000;

export type PartnerSharedSeenStatus = {
  relationshipId: string | null;
  hasUnread: boolean;
  frozenUntil: string | null;
  lastSeenAt: string | null;
  latestAt: string | null;
};

let cached: PartnerSharedSeenStatus | null = null;
let cachedAt = 0;
let inFlight: Promise<PartnerSharedSeenStatus | null> | null = null;
const listeners = new Set<(s: PartnerSharedSeenStatus) => void>();

function broadcast(s: PartnerSharedSeenStatus) {
  for (const fn of listeners) {
    try { fn(s); } catch (e) {
      console.warn('[partnerSharedSeen] listener threw:', (e as Error)?.message);
    }
  }
}

/** Subscribe to status updates. Returns an unsubscribe fn. Fires
 *  immediately with the current cached value (if any). */
export function subscribePartnerSharedSeen(
  listener: (s: PartnerSharedSeenStatus) => void,
): () => void {
  listeners.add(listener);
  if (cached) {
    try { listener(cached); } catch {}
  }
  return () => { listeners.delete(listener); };
}

/** Fetch + cache the current unread status for the given relationship.
 *  Pass null/undefined relationshipId to clear cache (e.g., the user
 *  has no active pairing yet — the dot stays off). force=true bypasses
 *  the cache freshness check. */
export async function refreshPartnerSharedSeenStatus(
  relationshipId: string | null,
  force = false,
): Promise<PartnerSharedSeenStatus | null> {
  if (!relationshipId) {
    cached = { relationshipId: null, hasUnread: false, frozenUntil: null, lastSeenAt: null, latestAt: null };
    cachedAt = Date.now();
    broadcast(cached);
    return cached;
  }
  const now = Date.now();
  const sameRel = cached && cached.relationshipId === relationshipId;
  if (!force && sameRel && (now - cachedAt) < CACHE_TTL_MS) {
    return cached;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const raw = await api.getSharedUnreadStatus(relationshipId);
      if (!raw) return null;
      const next: PartnerSharedSeenStatus = {
        relationshipId,
        hasUnread: !!raw.unread,
        frozenUntil: raw.frozenUntil || null,
        lastSeenAt: raw.lastSeenAt || null,
        latestAt: raw.latestAt || null,
      };
      cached = next;
      cachedAt = Date.now();
      broadcast(next);
      return next;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Mark the shared space as seen NOW. Optimistic local clear, then
 *  POST /shared/mark-seen, then refresh to confirm. Safe to call
 *  unconditionally — a no-op write on the server if already cleared. */
export async function markPartnerSharedSeen(relationshipId: string): Promise<void> {
  const optimistic: PartnerSharedSeenStatus = {
    relationshipId,
    hasUnread: false,
    frozenUntil: cached?.frozenUntil ?? null,
    lastSeenAt: new Date().toISOString(),
    latestAt: cached?.latestAt ?? null,
  };
  cached = optimistic;
  cachedAt = Date.now();
  broadcast(optimistic);

  try {
    await api.markSharedSeen(relationshipId);
  } catch (e) {
    console.warn('[partnerSharedSeen] markSeen threw:', (e as Error)?.message);
  }
  // Force-refresh to sync latestAt / frozenUntil with the server.
  refreshPartnerSharedSeenStatus(relationshipId, true).catch(() => {});
}

/** Reset on logout / account-delete. */
export function resetPartnerSharedSeen(): void {
  cached = null;
  cachedAt = 0;
  const fresh: PartnerSharedSeenStatus = {
    relationshipId: null, hasUnread: false, frozenUntil: null,
    lastSeenAt: null, latestAt: null,
  };
  broadcast(fresh);
}
