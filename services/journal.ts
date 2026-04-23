// Journal storage — local-only, AsyncStorage-backed. Entries never leave the
// device, matching the web app's "Private — only you can see this" promise.
// Each entry has an id, kind (freeflow | deepdive), timestamp, content.

import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

const KEY = 'journal.entries';

export type JournalKind = 'freeflow' | 'deepdive';
export type JournalEntry = {
  id: string;
  kind: JournalKind;
  createdAt: string;   // ISO timestamp
  content: string;
  prompt?: string;     // for deepdive — the guiding prompt shown at the top
};

async function readAll(): Promise<JournalEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
async function writeAll(entries: JournalEntry[]): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(entries)); }
  catch (e) { console.warn('[journal] write failed:', (e as Error).message); }
}

export const journal = {
  async list(): Promise<JournalEntry[]> {
    const all = await readAll();
    // Most recent first.
    return all.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async add(kind: JournalKind, content: string, prompt?: string): Promise<JournalEntry> {
    const all = await readAll();
    const entry: JournalEntry = {
      id: uuidv4(),
      kind,
      createdAt: new Date().toISOString(),
      content: content.trim(),
      prompt,
    };
    all.push(entry);
    await writeAll(all);
    return entry;
  },

  async remove(id: string): Promise<void> {
    const all = await readAll();
    await writeAll(all.filter((e) => e.id !== id));
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
