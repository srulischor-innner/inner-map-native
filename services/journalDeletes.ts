// DELETES THE SERVER HASN'T CONFIRMED (founder, 2026-11-08).
//
// The privacy policy says a deleted journal entry is deleted. journal.remove()
// deletes the device copy at once, and it used to fire DELETE
// /api/journal/:id exactly once. So a shared entry deleted while offline stayed
// on the server: still read by the AI as context, still in a data export.
//
// Now the id goes on a small persisted list BEFORE the request, so an app
// killed mid-request can't lose it. It comes off only when the server answers
// OK, or 404 (nothing there to delete). The list is retried:
//   - on the next app launch (app/_layout.tsx, the deferred work after boot);
//   - after the next journal entry that syncs successfully (services/journal.ts).
// A retry walks the list in order and stops at the first failure, which most
// likely means offline; the rest wait for the next trigger.
//
// It never blocks the local delete: callers fire it and forget it, and every
// storage or network failure is swallowed here.
//
// The pure queue sits above the React Native imports so
// scripts/smoke-journal-delete-retry.js can load it in plain Node (the same
// lift smoke-journal-encryption.js uses on journalMigration.ts).

export type DeleteQueueDeps = {
  /** The persisted list, as stored (JSON), or null when there is none. */
  load: () => Promise<string | null>;
  /** Persist the list; null removes it. */
  save: (raw: string | null) => Promise<void>;
  /** true when the server confirmed: a 2xx, or a 404 (already gone). */
  deleteOnServer: (id: string) => Promise<boolean>;
};

/** The stored list, cleaned. Anything unreadable is an empty list. */
export function parsePendingDeletes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) if (typeof x === 'string' && x && !out.includes(x)) out.push(x);
    return out;
  } catch {
    return [];
  }
}

export function createJournalDeleteQueue(deps: DeleteQueueDeps) {
  // One change to the list at a time, so a delete and a retry can't overwrite
  // each other's copy. A list that can't be READ is never written over: the
  // change is dropped rather than risk erasing ids already on it.
  let chain: Promise<void> = Promise.resolve();
  const change = (fn: (ids: string[]) => string[]): Promise<void> => {
    const run = chain.then(async () => {
      let ids: string[];
      try { ids = parsePendingDeletes(await deps.load()); } catch { return; }
      const next = fn(ids);
      if (JSON.stringify(next) === JSON.stringify(ids)) return;
      try { await deps.save(next.length ? JSON.stringify(next) : null); } catch {}
    });
    // A failed change never stalls the ones queued behind it.
    chain = run.catch(() => {});
    return chain;
  };
  const confirmed = async (id: string): Promise<boolean> => {
    try { return (await deps.deleteOnServer(id)) === true; } catch { return false; }
  };

  let running: Promise<void> | null = null;

  return {
    /** Delete one entry on the server. Its id stays on the list until the
     *  server confirms. */
    async remove(id: string): Promise<void> {
      if (!id) return;
      await change((ids) => (ids.includes(id) ? ids : [...ids, id]));
      if (await confirmed(id)) await change((ids) => ids.filter((x) => x !== id));
    },

    /** Retry every id still on the list, oldest first, stopping at the first
     *  failure. One retry at a time; a second call joins the running one. */
    retry(): Promise<void> {
      if (running) return running;
      running = (async () => {
        await chain;
        let ids: string[];
        try { ids = parsePendingDeletes(await deps.load()); } catch { return; }
        for (const id of ids) {
          if (!(await confirmed(id))) return;
          await change((cur) => cur.filter((x) => x !== id));
        }
      })().finally(() => { running = null; });
      return running;
    },

    /** The ids still waiting for the server. */
    async pending(): Promise<string[]> {
      await chain;
      try { return parsePendingDeletes(await deps.load()); } catch { return []; }
    },
  };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const PENDING_DELETES_KEY = 'journal.pendingServerDeletes';

const queue = createJournalDeleteQueue({
  load: () => AsyncStorage.getItem(PENDING_DELETES_KEY),
  save: async (raw) => {
    if (raw === null) await AsyncStorage.removeItem(PENDING_DELETES_KEY);
    else await AsyncStorage.setItem(PENDING_DELETES_KEY, raw);
  },
  deleteOnServer: (id) => api.deleteJournalEntry(id),
});

/** Delete a journal entry's server copy, retried until the server confirms.
 *  Fire and forget: it never throws and never blocks the local delete. */
export function deleteJournalOnServer(id: string): Promise<void> {
  return queue.remove(id).catch(() => {});
}

/** Retry the deletes the server hasn't confirmed. Fire and forget. */
export function retryPendingJournalDeletes(): Promise<void> {
  return queue.retry().catch(() => {});
}
