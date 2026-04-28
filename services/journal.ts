// Journal storage — local-only, AsyncStorage-backed. Entries never leave the
// device, matching the web app's "Private — only you can see this" promise.
// Each entry has an id, kind (freeflow | deepdive), timestamp, content.

import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

const KEY = 'journal.entries';

export type JournalKind = 'freeflow' | 'deepdive';
// Parts that can be tagged on an entry. Mirrors the NodeKey union used
// elsewhere so the UI can reuse the same color palette without a remap.
export type DetectedPart =
  | 'wound' | 'fixer' | 'skeptic' | 'self' | 'self-like'
  | 'manager' | 'firefighter';
export type JournalEntry = {
  id: string;
  kind: JournalKind;
  createdAt: string;   // ISO timestamp
  content: string;
  prompt?: string;     // for deepdive — the guiding prompt shown at the top
  /** Parts detected in the entry text at save time. Used by the parts
   *  filter dropdown on the journal tab. May be empty when none of the
   *  recognized signal words appeared, or undefined for legacy entries
   *  saved before tagging existed. */
  detectedParts?: DetectedPart[];
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

  async add(
    kind: JournalKind,
    content: string,
    prompt?: string,
    detectedParts?: DetectedPart[],
  ): Promise<JournalEntry> {
    const all = await readAll();
    const entry: JournalEntry = {
      id: uuidv4(),
      kind,
      createdAt: new Date().toISOString(),
      content: content.trim(),
      prompt,
      detectedParts: detectedParts && detectedParts.length ? detectedParts : undefined,
    };
    all.push(entry);
    await writeAll(all);
    return entry;
  },

  /** Heuristic keyword-based parts detector used at journal-save time.
   *  Cheap and offline so saving stays instant. The signal vocabulary
   *  is intentionally broad — better to over-tag than to miss — and
   *  can be replaced with a server-side LLM detector later without
   *  changing the storage shape. */
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
