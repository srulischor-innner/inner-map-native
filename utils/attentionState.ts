// Tiny pub/sub for the chat-tab attention indicator.
//
// The state is QUALITATIVE only — three ambient values driven by the AI:
//   quiet     — generic chat, no pattern forming
//   listening — articulation/recognition phase, texture is present
//   noticing  — a pattern is taking shape (still pre-permission)
//
// Critically NOT a continuum the user can climb. The indicator never
// quantifies anything. State changes flow from the AI via ATTENTION_STATE
// markers parsed out of streaming replies.

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AttentionState, NoticedPart } from './markers';

let current: AttentionState = 'idle';
let currentPart: NoticedPart | null = null;
const listeners = new Set<(s: AttentionState) => void>();
const partListeners = new Set<(p: NoticedPart | null) => void>();

const STORAGE_KEY = 'attentionIndicator.firstTransitionSeen.v1';
// Separate flag for the "tap to learn what this is" text label that
// fades on the first chat session. Renamed key per the latest spec —
// also resets discoverability for users who saw the prior dimmer
// indicator and may have missed it.
const LABEL_KEY = 'attention_indicator_seen';

/** React hook — re-renders when the AI moves the state. */
export function useAttentionState(): AttentionState {
  const [s, setS] = useState<AttentionState>(current);
  useEffect(() => {
    listeners.add(setS);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

export function getAttentionState(): AttentionState { return current; }

/** Module-level setter. Idempotent — no-op if the value is unchanged. */
export function setAttentionState(s: AttentionState): void {
  if (s === current) return;
  current = s;
  for (const l of listeners) l(s);
  // Leaving the noticing state always clears the noticed part, so the
  // small label below the triangle can't get stuck on a stale name.
  // 'detected' also keeps the noticed part visible during the flash.
  if (s !== 'noticing' && s !== 'detected') setNoticedPart(null);
}

/** Hook + setter for the part currently being noticed. Only meaningful
 *  when state is 'noticing' — null otherwise. The chat header uses this
 *  to render a small dim label below the triangle. */
export function useNoticedPart(): NoticedPart | null {
  const [p, setP] = useState<NoticedPart | null>(currentPart);
  useEffect(() => {
    partListeners.add(setP);
    return () => { partListeners.delete(setP); };
  }, []);
  return p;
}
export function getNoticedPart(): NoticedPart | null { return currentPart; }
export function setNoticedPart(p: NoticedPart | null): void {
  if (p === currentPart) return;
  currentPart = p;
  for (const l of partListeners) l(p);
}

/** Reset to 'idle' on session end / tab unmount. */
export function resetAttentionState(): void {
  setAttentionState('idle');
  setNoticedPart(null);
}

/** First-time-discovery flag. The chat screen pulses the indicator once
 *  the first time it transitions out of 'quiet' so the user notices it
 *  exists. After that, transitions are smooth and ambient.
 *  Stored in AsyncStorage so the flag persists across app restarts. */
export async function hasSeenFirstTransition(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return v === '1';
  } catch { return true; }   // fail closed — don't pulse if we can't read
}
export async function markFirstTransitionSeen(): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEY, '1'); } catch {}
}

/** First-session label discoverability flag — separate from the pulse
 *  flag because the label has a different lifecycle (shown while reading
 *  the screen, not tied to a state change). */
export async function hasSeenFirstSessionLabel(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(LABEL_KEY);
    return v === '1';
  } catch { return true; }
}
export async function markFirstSessionLabelSeen(): Promise<void> {
  try { await AsyncStorage.setItem(LABEL_KEY, '1'); } catch {}
}
