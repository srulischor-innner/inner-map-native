// M2 — the LIVE half: the starter-map count and the two card actions. The
// pure rules are in services/m2.ts. (The account flag that used to live here
// is gone: M2 is the app as of 1.4.0, founder 2026-11-09.)
//
// WHY THE ACTIONS LIVE HERE. A tap in either place — the chat screen or
// Messages — is the same write, and its answer carries the server's count of
// tapped cards and, sometimes, "the starter map is complete now". Both have to
// reach the chat screen whichever surface the tap came from.

import { useEffect, useState } from 'react';
import { api } from './api';
import { refreshInboxStatus } from './messagesInbox';
import type { M2BundledEdit } from './m2';

let starterCount: number | null = null;
const countListeners = new Set<(v: number | null) => void>();
const starterCompleteListeners = new Set<() => void>();

/** The server's count of tapped cards; null until the server says one. */
export function setStarterCount(n: number | null): void {
  if (n === starterCount) return;
  starterCount = n;
  for (const l of countListeners) l(starterCount);
}

export function useStarterCount(): number | null {
  const [v, setV] = useState<number | null>(starterCount);
  useEffect(() => {
    countListeners.add(setV);
    setV(starterCount);
    return () => { countListeners.delete(setV); };
  }, []);
  return v;
}

/** Fires when an accept response says the tap completed the starter map
 *  (the server remembered an early [STARTER_MAP_COMPLETE] and honoured it on
 *  the tap that made two). The chat screen puts the button on screen. */
export function subscribeStarterComplete(fn: () => void): () => void {
  starterCompleteListeners.add(fn);
  return () => { starterCompleteListeners.delete(fn); };
}

/** ADD, from either surface. Resolves with ok:false on any failure, never
 *  throws, and never reports a write that did not land. */
export async function acceptM2Item(
  messageId: string,
  itemIndex: number,
  edit?: string | M2BundledEdit,
): Promise<{ ok: boolean; written: number }> {
  const res = await api.actOnMessage(
    messageId,
    [itemIndex],
    edit !== undefined ? { [itemIndex]: edit } : undefined,
  );
  if (res.starterCount !== null) setStarterCount(res.starterCount);
  if (res.ok && res.starterMapComplete) {
    for (const l of starterCompleteListeners) {
      try { l(); } catch {}
    }
  }
  refreshInboxStatus(true).catch(() => {});
  // ok with nothing written means the card was no longer open — declined,
  // replaced or expired on the server since it was drawn (m2-api.md: act on a
  // card that isn't pending writes nothing). The caller must not say "added".
  return { ok: res.ok, written: res.written };
}

/** "Not now", from either surface. Final. */
export async function declineM2Item(messageId: string, itemIndex: number): Promise<{ ok: boolean }> {
  const res = await api.declineMessageItems(messageId, [itemIndex]);
  if (res.ok) refreshInboxStatus(true).catch(() => {});
  return { ok: res.ok };
}

// A card's 14-day clock starts the first time it is shown (m2-api.md, "Seen").
// Opening a card in Messages stamps every item through /read, as it always
// has; the chat screen stamps the items it shows through the M2 seen route.
// Once per item per launch.
const seen = new Set<string>();
export function markM2CardShown(messageId: string, itemIndex: number): void {
  const key = `${messageId}#${itemIndex}`;
  if (!messageId || seen.has(key)) return;
  seen.add(key);
  api.markM2CardsSeen(messageId, [itemIndex]).catch(() => {});
}

// "Build my starter map" (founder, 2026-11-08): the button on the empty map
// asks the chat to open a starter-map conversation. A one-shot handoff, like
// utils/pendingChatMessage: the map arms it and routes to the chat; the chat
// consumes it on focus, so warm navigation reaches it too.
let starterMapRequested = false;
export function requestStarterMap(): void {
  starterMapRequested = true;
}
export function consumeStarterMapRequest(): boolean {
  const was = starterMapRequested;
  starterMapRequested = false;
  return was;
}
