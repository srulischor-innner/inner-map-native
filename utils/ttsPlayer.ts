// Shared playback slot — only ONE clip plays at a time across the entire
// chat (TTS speaker icon AND user voice notes share this slot).
//
// Two kinds of clients:
//  1. TTS speaker icon — calls playTTS(messageId, text). The module
//     creates + manages the player itself, pulls audio from ttsCache.
//  2. Voice notes — keep their own native player (for seek / scrub / live
//     progress). They claim the slot via acquireSlot(id, onEvict). When a
//     different message claims the slot, their onEvict callback fires so
//     they can pause their own player.
//
// Session-level audio mode: when on, the chat screen auto-fires playTTS()
// the moment a new AI reply finishes streaming. Speaker icons read this
// flag via useAudioMode() and switch from "dim default" to "active amber".
// Tapping a speaker icon while audio mode is on turns it OFF (and stops
// whatever is playing).

import { useEffect, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { ensureTTS, getCachedTTS } from './ttsCache';

// ----- module state -----
type Player = ReturnType<typeof createAudioPlayer>;
let ttsPlayer: Player | null = null;        // OUR own player (null when slot is held by a voice note)
let currentMessageId: string | null = null;  // who owns the slot right now
let evictCb: (() => void) | null = null;     // called when slot is taken from an external owner
let audioMode = false;
let watchToken = 0;                          // invalidates pending watchdogs after stop

// ----- pub/sub -----
const playingListeners = new Set<(id: string | null) => void>();
const audioModeListeners = new Set<(on: boolean) => void>();

function emitPlayingId(id: string | null) {
  currentMessageId = id;
  for (const l of playingListeners) l(id);
}
function emitAudioMode(on: boolean) {
  audioMode = on;
  for (const l of audioModeListeners) l(on);
}

/** React hook — re-renders when the active playback owner changes. */
export function usePlayingId(): string | null {
  const [id, setId] = useState<string | null>(currentMessageId);
  useEffect(() => {
    playingListeners.add(setId);
    return () => { playingListeners.delete(setId); };
  }, []);
  return id;
}

/** React hook — re-renders when session-wide audio mode flips. */
export function useAudioMode(): boolean {
  const [on, setOn] = useState<boolean>(audioMode);
  useEffect(() => {
    audioModeListeners.add(setOn);
    return () => { audioModeListeners.delete(setOn); };
  }, []);
  return on;
}

export function getAudioMode(): boolean { return audioMode; }
export function getCurrentMessageId(): string | null { return currentMessageId; }
export function isOwner(id: string): boolean { return currentMessageId === id; }

/** Internal — clears whatever currently owns the slot (TTS player or
 *  external voice note). Callers must follow with their own setup if
 *  they're starting fresh playback. */
async function clearSlot(): Promise<void> {
  watchToken++;
  // External owner — fire its eviction callback so it can pause its
  // own player. We don't manage their player; just notify.
  if (evictCb) {
    const cb = evictCb;
    evictCb = null;
    try { cb(); } catch {}
  }
  // Our own TTS player — pause + remove.
  const p = ttsPlayer;
  ttsPlayer = null;
  if (p) {
    try { p.pause(); } catch {}
    try { p.remove(); } catch {}
  }
  if (currentMessageId !== null) emitPlayingId(null);
}

/** External player (e.g. voice note) claims the slot. Provides a callback
 *  the slot will fire if/when something else (TTS or another voice note)
 *  takes it over. */
export async function acquireSlot(id: string, onEvict: () => void): Promise<void> {
  await clearSlot();
  evictCb = onEvict;
  emitPlayingId(id);
}

/** External player relinquishes the slot — only acts if this id is the
 *  current owner so a stale call from a finished voice note can't clear
 *  someone else's claim. */
export function releaseSlot(id: string): void {
  if (currentMessageId !== id) return;
  evictCb = null;
  emitPlayingId(null);
}

/** Flip session-wide auto-play mode. Turning OFF also stops any
 *  currently playing clip. Turning ON does NOT auto-start anything —
 *  the caller (typically a tap on a speaker icon) supplies what to play. */
export async function setAudioMode(on: boolean): Promise<void> {
  emitAudioMode(on);
  if (!on) await stopAll();
}

/** Public stop — used by chat screen on session reset / tab unmount and
 *  by speaker tap when audio mode is being turned off. */
export async function stopAll(): Promise<void> {
  await clearSlot();
}

/** Tap-on-currently-playing-bubble for TTS: pause if playing, resume if
 *  paused. Returns the new logical state. Voice notes don't use this —
 *  they manage their own play/pause locally via the player they own. */
export function togglePauseResume(messageId: string): 'playing' | 'paused' | 'idle' {
  if (currentMessageId !== messageId || !ttsPlayer) return 'idle';
  try {
    const s = ttsPlayer.currentStatus;
    if (s?.isLoaded === false) return 'idle';
    const isPlaying = !!s?.playing;
    if (isPlaying) { ttsPlayer.pause(); return 'paused'; }
    ttsPlayer.play(); return 'playing';
  } catch {
    return 'idle';
  }
}

/** Start (or restart) TTS playback for an AI message. Always awaits a
 *  clean teardown of the prior player BEFORE creating the new one —
 *  guarantees no two clips ever play simultaneously. Falls back to a
 *  network fetch if the prefetch cache hasn't filled yet. */
export async function playTTS(messageId: string, text: string): Promise<void> {
  await clearSlot();
  // Audio session: playback (no recording, mix-with-others).
  try {
    await setAudioModeAsync({
      allowsRecording: false, playsInSilentMode: true,
      interruptionMode: 'mixWithOthers', shouldPlayInBackground: false,
    });
  } catch {}
  let uri = getCachedTTS(messageId);
  if (!uri) uri = (await ensureTTS(messageId, text)) || null;
  if (!uri) return;
  // Bail if something else has claimed the slot during the await above —
  // a fast double-tap can race two playTTS calls.
  if (currentMessageId !== null) return;
  const myToken = ++watchToken;
  const player = createAudioPlayer({ uri });
  ttsPlayer = player;
  emitPlayingId(messageId);
  try { player.play(); } catch {}
  // Watchdog — release on finish so the speaker icon flips back from
  // pause→speaker. Auto-advance to the next message is the chat
  // screen's job (it calls playTTS again when the next reply lands).
  (async () => {
    while (myToken === watchToken && ttsPlayer === player) {
      try {
        const s = player.currentStatus;
        if (s?.didJustFinish) break;
        if (s?.isLoaded === false) break;
      } catch { break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (myToken === watchToken && ttsPlayer === player) {
      try { player.remove(); } catch {}
      ttsPlayer = null;
      emitPlayingId(null);
    }
  })();
}
