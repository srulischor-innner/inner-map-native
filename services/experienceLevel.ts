// Experience level — set during onboarding (after intake) and adjustable
// from settings later. Determines which voice mode the AI uses for its
// replies. Stored locally; sent on every /api/chat request body.
//
// 'curious'     — new to inner work; full scaffolding (Level 1 voice)
// 'familiar'    — has done some inner work; standard pacing (Level 2)
// 'experienced' — has done significant inner work; minimal scaffolding (L3)

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ExperienceLevel = 'curious' | 'familiar' | 'experienced';

const STORAGE_KEY = 'experienceLevel.v1';
const DEFAULT: ExperienceLevel = 'curious';

let current: ExperienceLevel = DEFAULT;
let initialized = false;
const listeners = new Set<(l: ExperienceLevel) => void>();

/** Read from disk on first call, then keep the in-memory copy. Returns
 *  the default 'curious' if anything goes wrong — safer than blocking.
 *  Synchronous accessors (getExperienceLevel) read the in-memory copy. */
export async function loadExperienceLevel(): Promise<ExperienceLevel> {
  if (initialized) return current;
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === 'curious' || v === 'familiar' || v === 'experienced') {
      current = v;
    }
  } catch {}
  initialized = true;
  for (const l of listeners) l(current);
  return current;
}

export function getExperienceLevel(): ExperienceLevel { return current; }

export async function setExperienceLevel(next: ExperienceLevel): Promise<void> {
  if (next === current && initialized) return;
  current = next;
  initialized = true;
  for (const l of listeners) l(next);
  try { await AsyncStorage.setItem(STORAGE_KEY, next); } catch {}
}

/** React hook — re-renders when the level changes. Triggers a one-shot
 *  loadExperienceLevel() on first mount so the in-memory copy is hot. */
export function useExperienceLevel(): ExperienceLevel {
  const [v, setV] = useState<ExperienceLevel>(current);
  useEffect(() => {
    listeners.add(setV);
    if (!initialized) {
      loadExperienceLevel().then((l) => setV(l));
    }
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}

// ---------------------------------------------------------------------------
// "In a hard place" marker — a LOCAL UI flag, deliberately NOT a level.
// ---------------------------------------------------------------------------
// The 4th picker option ("I'm in a hard place right now") is not a storable
// ExperienceLevel: it maps to 'curious' so the AI uses the most-scaffolded
// voice, and it routes the user to the support-resources screen. 'hard' must
// never reach the wire — services/api.ts types the request field as the three
// real levels and the SERVER selects the prompt from it, so an unmapped value
// would hit prompt selection for a user who just said they are struggling.
//
// This flag records only the FACT of the choice, in its own AsyncStorage key,
// so the picker can draw a checkmark next to what the user actually tapped
// (they used to reopen the sheet and see "I'm new to this kind of work"
// highlighted instead). It is read by the UI and by nothing else — no getter
// here feeds any request body.
//
// Mutual exclusivity: every pick in the picker calls setChoseHardPlace() with
// whether THAT option was the hard one, so choosing any other option clears
// the flag and the sheet can never show two selected rows.
const HARD_PLACE_KEY = 'experienceLevel.hardPlace.v1';

let hardPlace = false;
let hardPlaceInitialized = false;
const hardPlaceListeners = new Set<(v: boolean) => void>();

export async function loadChoseHardPlace(): Promise<boolean> {
  if (hardPlaceInitialized) return hardPlace;
  try {
    hardPlace = (await AsyncStorage.getItem(HARD_PLACE_KEY)) === '1';
  } catch {}
  hardPlaceInitialized = true;
  for (const l of hardPlaceListeners) l(hardPlace);
  return hardPlace;
}

export function getChoseHardPlace(): boolean { return hardPlace; }

export async function setChoseHardPlace(next: boolean): Promise<void> {
  hardPlace = next;
  hardPlaceInitialized = true;
  for (const l of hardPlaceListeners) l(next);
  try {
    if (next) await AsyncStorage.setItem(HARD_PLACE_KEY, '1');
    else await AsyncStorage.removeItem(HARD_PLACE_KEY);
  } catch {}
}

/** React hook — mirrors useExperienceLevel's shape. */
export function useChoseHardPlace(): boolean {
  const [v, setV] = useState<boolean>(hardPlace);
  useEffect(() => {
    hardPlaceListeners.add(setV);
    if (!hardPlaceInitialized) {
      loadChoseHardPlace().then((h) => setV(h));
    }
    return () => { hardPlaceListeners.delete(setV); };
  }, []);
  return v;
}

// ---------- copy used in onboarding + settings ----------
export const LEVEL_OPTIONS: Array<{
  level: ExperienceLevel | 'hard';
  title: string;
  subtitle: string;
}> = [
  {
    level: 'curious',
    title: "I'm new to this kind of work",
    subtitle:
      "I'm curious about understanding myself better but don't have much experience with inner work.",
  },
  {
    level: 'familiar',
    title: "I've done some inner work",
    subtitle:
      "Therapy, journaling, meditation, reading — I have some familiarity with looking inward.",
  },
  {
    level: 'experienced',
    title: "I've done a lot of this work",
    subtitle:
      "I've done deep inner work — therapy, parts work, contemplative practice. I have language for this.",
  },
  {
    level: 'hard',
    title: "I'm in a hard place right now",
    subtitle:
      "Something is heavy and I'm looking for support. (We'll suggest some real-person resources too.)",
  },
];

export const LEVEL_LABELS: Record<ExperienceLevel, string> = {
  curious:     'New to inner work',
  familiar:    'Some experience with inner work',
  experienced: 'Experienced in inner work',
};
