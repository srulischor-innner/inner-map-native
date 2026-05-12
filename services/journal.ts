// Journal storage — local-only, ENCRYPTED on-device. Entries never leave
// the device, matching the in-app "Private — only you can see this"
// promise. Backed by react-native-mmkv with an AES key persisted in
// expo-secure-store (Keychain / EncryptedSharedPreferences).
//
// Migration from the legacy AsyncStorage backend runs at most once per
// process on first read after upgrade — see services/journalMigration.ts
// for the verify-before-delete contract. Until the migration verifies
// the MMKV write byte-for-byte, the AsyncStorage copy is retained.
//
// Public API (list / add / remove / detectParts / randomDeepDivePrompt)
// is unchanged from the pre-encryption shape so call sites in
// app/(tabs)/journal.tsx and components/journal/* compile + behave
// identically.

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import * as encryptedStorage from '../utils/encryptedStorage';
import { runMigrationOnce } from './journalMigration';

// Re-export the shared types from the encrypted-storage module so
// consumers can keep their `from '../services/journal'` imports
// unchanged. JournalEntry / JournalKind / DetectedPart all live in
// utils/encryptedStorage as the source of truth now.
export type { JournalKind, DetectedPart, JournalEntry } from '../utils/encryptedStorage';
import type { JournalKind, DetectedPart, JournalEntry } from '../utils/encryptedStorage';

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
    detectedParts?: DetectedPart[],
  ): Promise<JournalEntry> {
    await ensureReady();
    const entry: JournalEntry = {
      id: uuidv4(),
      kind,
      createdAt: new Date().toISOString(),
      content: content.trim(),
      prompt,
      detectedParts: detectedParts && detectedParts.length ? detectedParts : undefined,
    };
    await encryptedStorage.addEntry(entry);
    return entry;
  },

  async remove(id: string): Promise<void> {
    await ensureReady();
    await encryptedStorage.deleteEntry(id);
  },

  /** Heuristic keyword-based parts detector used at journal-save time.
   *  Cheap and offline so saving stays instant. The signal vocabulary
   *  is intentionally broad — better to over-tag than to miss — and
   *  can be replaced with a server-side LLM detector later without
   *  changing the storage shape. Pure function; no storage touch. */
  detectParts(text: string): DetectedPart[] {
    if (!text) return [];
    const t = text.toLowerCase();
    const hits = new Set<DetectedPart>();
    const test = (re: RegExp, k: DetectedPart) => { if (re.test(t)) hits.add(k); };
    // Wound — pain, hurt, broken, not enough, unworthy.
    test(/\b(wound|hurt|pain|aching|broken|abandon|reject|unworthy|not enough|too much|unloved|alone)\b/, 'wound');
    // Fixer — proving, pushing, achieving, performing.
    test(/\b(fix(ing|ed|er)?|prove|proving|push(ing|ed)?|achieve|achievement|perform(ing)?|earn(ing)?|hard[- ]?work)\b/, 'fixer');
    // Skeptic — doubt, cynicism, giving up, withdrawal.
    test(/\b(skeptic(al)?|doubt|cynic(al)?|give up|gave up|withdraw|pointless|why bother|tired of trying|hopeless)\b/, 'skeptic');
    // Self — presence, calm, witness.
    test(/\b(self|present|presence|witness|calm|grounded|centered|spacious)\b/, 'self');
    // Self-like — controlling, holding it together, managing tension.
    test(/\b(self[- ]?like|hold(ing)? it together|control(ling)?|manage(d|s)? (myself|tension)|composed|put[- ]?together)\b/, 'self-like');
    // Manager — proactive routines, perfectionism, planning, anxiety.
    test(/\b(manager|perfection(ist|ism)?|plan(ning)?|prepare|anxious|control freak|anticipat(e|ing))\b/, 'manager');
    // Firefighter — distractions, numbing, reaching for relief.
    test(/\b(firefighter|distract(ion|ed)?|numb(ing)?|scroll(ing)?|binge|reach for|relief|escape|drink(ing)?|smok(e|ing))\b/, 'firefighter');
    return Array.from(hits);
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
