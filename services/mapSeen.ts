// Map-seen service — owns the cache + subscriber pattern for the
// "you have new map content" dot on the bottom-tab Map icon.
//
// Lifecycle:
//   - Subscribers (the top tab bar) register a listener that's
//     invoked whenever hasUnseen flips.
//   - Pollers (the layout's AppState + tab focus listeners) call
//     refreshMapSeenStatus(), which hits /api/map/seen-status if
//     the cached value is older than CACHE_TTL_MS.
//   - markMapSeen() is called when the user enters the Map tab.
//     It immediately broadcasts hasUnseen=false to all subscribers
//     (optimistic), then POSTs /api/map/mark-seen, then refreshes
//     from the server to confirm.
//
// Cache rationale: tab-focus + app-foreground events can fire
// rapidly (a quick app-switch round-trip can trigger 3-4 events
// in a few seconds). 30 seconds of staleness is invisible to the
// user — the dot is a low-urgency signal — and the cache keeps
// us well under the server's 1000/day rate limit.

import { api } from './api';

const CACHE_TTL_MS = 30 * 1000;

type Status = {
  lastSeenMapAt: string | null;
  mapUpdatedAt: string | null;
  hasUnseen: boolean;
};

let cached: Status | null = null;
let cachedAt = 0;
let inFlight: Promise<Status | null> | null = null;
const listeners = new Set<(s: Status) => void>();

function broadcast(s: Status) {
  for (const fn of listeners) {
    try { fn(s); } catch (e) {
      console.warn('[mapSeen] listener threw:', (e as Error)?.message);
    }
  }
}

/** Subscribe to hasUnseen updates. Returns an unsubscribe fn.
 *  The listener fires immediately with the current cached value
 *  (if any) so a freshly-mounted component doesn't have to wait
 *  for the next poll to know the current state. */
export function subscribeMapSeen(listener: (s: Status) => void): () => void {
  listeners.add(listener);
  if (cached) {
    try { listener(cached); } catch {}
  }
  return () => { listeners.delete(listener); };
}

/** Fetch + cache the current seen-status from the server. If the
 *  cached value is fresh (within CACHE_TTL_MS), returns it
 *  immediately without a network round-trip. If a concurrent fetch
 *  is already in flight, joins it rather than starting a second.
 *  Force=true bypasses the cache (used after markSeen to confirm). */
export async function refreshMapSeenStatus(force = false): Promise<Status | null> {
  const now = Date.now();
  if (!force && cached && (now - cachedAt) < CACHE_TTL_MS) {
    return cached;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const next = await api.getMapSeenStatus();
      if (next) {
        cached = next;
        cachedAt = Date.now();
        broadcast(next);
      }
      return next;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Optimistic mid-chat flip — called from the chat send pipeline
 *  when an [ADDED_TO_MAP: ...] marker first lands in the streamed
 *  raw text. Flips hasUnseen=true locally + broadcasts, so the
 *  bottom-tab Map dot lights up within a frame of the pill
 *  rendering instead of waiting for the next 30-second poll cycle
 *  or a tab-focus refresh.
 *
 *  Idempotent: if hasUnseen is already true (cache says the dot is
 *  already lit), this is a no-op — no redundant broadcast. The
 *  caller is also expected to fire this at most ONCE per turn
 *  (see the addedToMapFired flag in app/(tabs)/index.tsx onDelta).
 *
 *  No immediate server round-trip: the server has already persisted
 *  the marker by the time we see it in the stream, but its
 *  /api/map/seen-status response can briefly lag the write. We
 *  stay with the optimistic value; the next pathname / AppState
 *  poll will sync if anything is off. */
export function optimisticMarkUnseen(): void {
  if (cached?.hasUnseen) return;
  cached = {
    lastSeenMapAt: cached?.lastSeenMapAt ?? null,
    // mapUpdatedAt — best-guess "now" since the server just persisted
    // a map write. The next poll will replace this with the
    // authoritative server timestamp.
    mapUpdatedAt: new Date().toISOString(),
    hasUnseen: true,
  };
  cachedAt = Date.now();
  broadcast(cached);
}

/** Mark the user's map as seen NOW. Three steps:
 *    1. Optimistic local update: broadcast hasUnseen=false
 *       immediately so the dot clears with no perceptible delay.
 *    2. POST /api/map/mark-seen.
 *    3. Refresh from the server to confirm + sync timestamps.
 *
 *  Called from app/(tabs)/map.tsx on tab focus. Safe to call
 *  unconditionally — if the dot was already cleared this is a
 *  cheap no-op write. */
export async function markMapSeen(): Promise<void> {
  // Optimistic local broadcast — the dot disappears before the
  // network round-trip even starts. Server confirmation refresh
  // happens below; if it disagrees (e.g. mark-seen 4xx'd), the
  // next poll will re-sync.
  const optimistic: Status = {
    lastSeenMapAt: new Date().toISOString(),
    mapUpdatedAt: cached?.mapUpdatedAt ?? null,
    hasUnseen: false,
  };
  cached = optimistic;
  cachedAt = Date.now();
  broadcast(optimistic);

  try {
    const result = await api.markMapSeen();
    if (result) {
      // Server returned the authoritative timestamp. Update the
      // cache (mapUpdatedAt may have been refreshed too).
      cached = {
        lastSeenMapAt: result.lastSeenMapAt,
        mapUpdatedAt: cached?.mapUpdatedAt ?? null,
        hasUnseen: false,
      };
      cachedAt = Date.now();
      broadcast(cached);
    }
  } catch (e) {
    console.warn('[mapSeen] markMapSeen threw:', (e as Error)?.message);
  }
  // Force-refresh to pick up any mapUpdatedAt the server bumped
  // between cache write and now. Cheap (one GET) and keeps the
  // local cache authoritative.
  refreshMapSeenStatus(true).catch(() => {});
}

/** Reset on logout / account-delete. Clears cache + broadcasts a
 *  fresh-zero state so any mounted subscriber re-renders without
 *  the dot. */
export function resetMapSeen(): void {
  cached = null;
  cachedAt = 0;
  const fresh: Status = { lastSeenMapAt: null, mapUpdatedAt: null, hasUnseen: false };
  broadcast(fresh);
}
