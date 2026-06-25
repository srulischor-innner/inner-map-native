// Journal storage — local-first (encrypted on device) AND synced to the
// server for RAG. Entries are written to react-native-mmkv (AES key in
// expo-secure-store) so the journal tab works offline and the on-device copy
// stays encrypted at rest; each entry is ALSO synced to the server
// (services/api → POST /api/journal), where it is embedded so the AI can read
// it as context. NOTE: the earlier "never leaves the device" guarantee no
// longer holds — user-facing copy is being updated in a separate pass.
//
// Migration from the legacy AsyncStorage backend runs at most once per
// process on first read after upgrade — see services/journalMigration.ts
// for the verify-before-delete contract. Until the migration verifies
// the MMKV write byte-for-byte, the AsyncStorage copy is retained.
//
// Public API: list / add / remove / randomDeepDivePrompt. (The local keyword
// part-tagger `detectParts` was removed with the journal→RAG change — the
// server now derives understanding from the entry text via RAG.)

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import * as encryptedStorage from '../utils/encryptedStorage';
import { runMigrationOnce } from './journalMigration';
import { api } from './api';

// Re-export the shared types from the encrypted-storage module so
// consumers can keep their `from '../services/journal'` imports
// unchanged. JournalEntry / JournalKind / DetectedPart all live in
// utils/encryptedStorage as the source of truth now.
export type { JournalKind, DetectedPart, JournalEntry } from '../utils/encryptedStorage';
import type { JournalKind, JournalEntry } from '../utils/encryptedStorage';

/** Run the one-time AsyncStorage→MMKV migration before any read or
 *  write. Cached promise — subsequent calls in the same process
 *  resolve instantly. */
function ensureReady(): Promise<unknown> {
  return runMigrationOnce();
}

export const journal = {
  async list(): Promise<JournalEntry[]> {
    await ensureReady();
    const all = await encryptedStorage.getAllEntries();
    // Most recent first — sort stays identical to the pre-encryption
    // implementation so journal-tab ordering doesn't change.
    return all.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async add(
    kind: JournalKind,
    content: string,
    prompt?: string,
    shared: boolean = true,
  ): Promise<JournalEntry> {
    await ensureReady();
    const entry: JournalEntry = {
      id: uuidv4(),
      kind,
      createdAt: new Date().toISOString(),
      content: content.trim(),
      prompt,
      shared,
    };
    await encryptedStorage.addEntry(entry);
    // Per-entry privacy: only SHARED entries sync to the server for RAG. A
    // PRIVATE entry (shared === false) stays in local encrypted storage only —
    // never synced, never embedded, never leaves the device (like the
    // pre-Stage-A journal). Status is locked at save, so a private entry simply
    // never syncs; there is no flip-to-private purge path.
    //
    // The sync is offline-first + fire-and-forget — a failure (offline, server
    // down) must never block or fail the local save; syncJournalEntry swallows
    // its own errors. `!== false` so any legacy entry written before the toggle
    // (no flag, already synced) continues to sync.
    if (entry.shared !== false) {
      void api.syncJournalEntry({
        id: entry.id,
        kind: entry.kind,
        content: entry.content,
        prompt: entry.prompt,
        createdAt: entry.createdAt,
      });
    }
    return entry;
  },

  async remove(id: string): Promise<void> {
    await ensureReady();
    await encryptedStorage.deleteEntry(id);
    // Mirror the deletion to the server — removes the synced copy + its RAG
    // embedding. Fire-and-forget; never blocks the local delete.
    void api.deleteJournalEntry(id);
  },

  /** A rotating bank of deepdive prompts — picked at random when the user taps
   *  the Deep Dive card. Matches the warm clinical tone of the web app. */
  randomDeepDivePrompt(): string {
    const prompts = [
      "The first thing that comes to mind when I think about today is…",
      "Something I haven't said out loud yet…",
      "If I trusted nobody would read this, I would write…",
      "The feeling I've been avoiding is…",
      "What I wish someone understood about me right now is…",
      "The part of me that's loudest today wants to say…",
      "If I let myself feel it fully, what's actually there is…",
    ];
    return prompts[Math.floor(Math.random() * prompts.length)];
  },
};
