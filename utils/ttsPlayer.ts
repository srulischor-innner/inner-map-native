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

/** React hook — re-renders ~5×/sec while ANY clip is loaded so callers
 *  can reflect pause vs. playing state on the icon. Polls ttsPlayer's
 *  own player AND any external isPlaying hook (streaming TTS / voice
 *  note) so the speaker icon flips correctly regardless of which
 *  system actually owns the slot. */
export function useIsPlaying(): boolean {
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const tick = setInterval(() => {
      if (cancelled) return;
      // External owner — ask its own isPlaying fn.
      if (externalIsPlayingFn) {
        try {
          const next = !!externalIsPlayingFn();
          setPlaying((prev) => (prev === next ? prev : next));
        } catch {}
        return;
      }
      const p = ttsPlayer;
      if (!p) {
        if (playing) setPlaying(true);
        return;
      }
      try {
        const s = p.currentStatus;
        const next = !!s?.playing;
        setPlaying((prev) => (prev === next ? prev : next));
      } catch {}
    }, 200);
    return () => { cancelled = true; clearInterval(tick); };
  }, [playing]);
  return playing;
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
  externalPauseFn = null;
  externalResumeFn = null;
  externalIsPlayingFn = null;
  // Our own TTS player — pause + remove.
  const p = ttsPlayer;
  ttsPlayer = null;
  if (p) {
    try { p.pause(); } catch {}
    try { p.remove(); } catch {}
  }
  if (currentMessageId !== null) emitPlayingId(null);
}

// External pause/resume hooks. When a non-ttsPlayer system (streaming
// TTS, voice note) owns the slot, it can register these so
// togglePauseResume(messageId) routes the user's tap to the right
// system. Without this, tapping a streaming-message speaker would see
// "no ttsPlayer" and do nothing — leaving the audio playing.
let externalPauseFn: (() => void) | null = null;
let externalResumeFn: (() => void) | null = null;
let externalIsPlayingFn: (() => boolean) | null = null;

/** External player (voice note OR streaming TTS) claims the slot.
 *    `onEvict`     — called when the slot is taken by something else;
 *                    the external owner should pause+release its player.
 *    `onPause`     — togglePauseResume on the slot owner routes here.
 *    `onResume`    — togglePauseResume routes here when paused.
 *    `isPlaying`   — sync fn returning true if the external player is
 *                    currently producing sound (used by useIsPlaying). */
export async function acquireSlot(
  id: string,
  onEvict: () => void,
  hooks?: { onPause?: () => void; onResume?: () => void; isPlaying?: () => boolean },
): Promise<void> {
  await clearSlot();
  evictCb = onEvict;
  externalPauseFn  = hooks?.onPause  ?? null;
  externalResumeFn = hooks?.onResume ?? null;
  externalIsPlayingFn = hooks?.isPlaying ?? null;
  emitPlayingId(id);
}

/** External player relinquishes the slot — only acts if this id is the
 *  current owner so a stale call from a finished voice note can't clear
 *  someone else's claim. */
export function releaseSlot(id: string): void {
  if (currentMessageId !== id) return;
  evictCb = null;
  externalPauseFn = null;
  externalResumeFn = null;
  externalIsPlayingFn = null;
  emitPlayingId(null);
}

// Pluggable hook so the streaming-TTS layer can cancel its queue when
// audio mode is turned off, without ttsPlayer needing to import it
// (which would create a circular dependency).
type ModeOffHook = () => void;
const modeOffHooks = new Set<ModeOffHook>();
export function onAudioModeOff(fn: ModeOffHook): () => void {
  modeOffHooks.add(fn);
  return () => { modeOffHooks.delete(fn); };
}

/** Flip session-wide auto-play mode. Turning OFF also stops any
 *  currently playing clip AND fires every onAudioModeOff hook so the
 *  streaming-TTS controller can cancel its in-flight queue. Turning ON
 *  does NOT auto-start anything — the caller (typically a tap on a
 *  speaker icon) supplies what to play. */
export async function setAudioMode(on: boolean): Promise<void> {
  emitAudioMode(on);
  if (!on) {
    for (const h of modeOffHooks) { try { h(); } catch {} }
    await stopAll();
  }
}

/** Public stop — used by chat screen on session reset / tab unmount and
 *  by speaker tap when audio mode is being turned off. */
export async function stopAll(): Promise<void> {
  await clearSlot();
}

/** Tap-on-currently-playing-bubble. Routes to whichever system owns
 *  the slot:
 *   - ttsPlayer (single-clip cache replay) — pause/resume our own player.
 *   - external system with hooks (streaming TTS, voice note) — call
 *     onPause/onResume which the system registered via acquireSlot.
 *   - nothing → 'idle'. */
export function togglePauseResume(messageId: string): 'playing' | 'paused' | 'idle' {
  if (currentMessageId !== messageId) return 'idle';
  // External owner with pause/resume hooks (streaming TTS / voice note).
  if (externalPauseFn || externalResumeFn) {
    try {
      const playing = externalIsPlayingFn ? externalIsPlayingFn() : true;
      if (playing) { externalPauseFn?.(); return 'paused'; }
      externalResumeFn?.(); return 'playing';
    } catch { return 'idle'; }
  }
  // Our own ttsPlayer (cache-replay) path.
  if (!ttsPlayer) return 'idle';
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

// In-flight guard. Without this, two rapid taps on the same speaker
// (before React has re-rendered with the post-tap-1 owner state) can BOTH
// see "we're not the owner", and both call playTTS — racing through the
// `await clearSlot()` and creating two players. The guard makes the
// second call a no-op if a play is already starting.
let playTTSInFlight = false;

/** Start (or restart) TTS playback for an AI message. Always awaits a
 *  clean teardown of the prior player BEFORE creating the new one —
 *  guarantees no two clips ever play simultaneously. Falls back to a
 *  network fetch if the prefetch cache hasn't filled yet.
 *
 *  IF THE GIVEN messageId IS ALREADY THE SLOT OWNER, this is a no-op —
 *  we don't tear down a healthy player and re-create it just because
 *  the caller didn't realize. Use togglePauseResume(messageId) for
 *  pause/resume instead. */
export async function playTTS(messageId: string, text: string): Promise<void> {
  if (currentMessageId === messageId && ttsPlayer) {
    // Same message tapped while it's already loaded — defer to the
    // pause/resume path. Caller probably intended that.
    return;
  }
  if (playTTSInFlight) return;
  playTTSInFlight = true;
  try {
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
  } finally {
    playTTSInFlight = false;
  }
}
