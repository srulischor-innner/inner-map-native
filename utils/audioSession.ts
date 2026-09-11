// THE AUDIO SESSION HAS ONE OWNER, AND THIS IS IT.
//
// WHAT WAS WRONG. Three surfaces in this app create expo-audio players with
// `{ keepAudioSessionActive: true }`: utils/ttsStream.ts (chat read-aloud),
// components/map/MapVoiceBar.tsx (Map Voice replies) and
// components/MessageBubble.tsx (user voice notes). Read that flag's contract in
// the installed package rather than in the comment above each call site --
// expo-audio 1.1.1, ios/AudioModule.swift:
//
//   Constructor { ... player.onPlaybackComplete = {
//                   if !keepAudioSessionActive { self?.deactivateSession() } } }
//   Function("pause") { player.ref.pause()
//                       if !player.keepAudioSessionActive { deactivateSession() } }
//
// Those two lines are the ONLY places expo-audio hands the iOS session back on
// its own, and the flag switches both off. Its own doc says what to do instead:
// "If needed, you can manually deactivate the audio session using
// setIsAudioActiveAsync(false)." Nothing in this app ever called it.
//
// So the first Map Voice reply -- or the first read-aloud line -- ran
//
//     player.play()  ->  Function("play") { try activateSession() }
//                    ->  AVAudioSession.setActive(true)
//
// under a .playback / doNotMix category, and setActive(false, options:
// [.notifyOthersOnDeactivation]) never ran again for the life of the process.
// Someone listening to music or a podcast had it stopped and never told it
// could resume: not when the reply ended, not when they left the tab, not when
// they backgrounded the app (iOS OnAppEntersBackground pauses players; it does
// not deactivate).
//
// WHY ONE OWNER RATHER THAN THREE COPIES. setIsAudioActiveAsync(false) is not a
// local call. On iOS it is
//
//     setIsAudioActive(false) -> pauseAllPlayers()
//                             -> setActive(false, [.notifyOthersOnDeactivation])
//
// and pauseAllPlayers() pauses EVERY registered player, not the caller's. A
// per-player handback is therefore a global mute of the other two: read-aloud
// deactivating at the end of its own chunk would pause a voice note the user
// was listening to in the same scroll view. "May the session go away now" can
// only be answered with knowledge of all three, so one place holds the count.
//
// ANDROID DOES NOT NEED THIS AND MUST NOT GET IT. Two facts from
// android/src/main/java/expo/modules/audio/AudioModule.kt:
//
//   1. The Android AudioPlayer constructor accepts `keepAudioSessionActive` and
//      never reads it. It wires
//        onPlaybackStateChange = { isPlaying ->
//          if (!isPlaying && shouldReleaseFocus()) releaseAudioFocus() }
//      Android already abandons audio focus when the last player stops. There
//      is no bug on that platform.
//   2. setIsAudioActiveAsync(false) sets `audioEnabled = false`, and
//      Function("play") opens with
//        if (!audioEnabled) { Log.e(TAG, "Audio has been disabled. Re-enable to
//        start playing"); return@Function }
//      It is a LATCH. Ship a deactivate on Android without a matching re-enable
//      and every subsequent play() in the process is a silent no-op.
//
// So the native handback is iOS-only. The bookkeeping below runs on both
// platforms -- one code path, one set of logs -- and only the native call is
// gated.

import { Platform } from 'react-native';
import { createAudioPlayer, setIsAudioActiveAsync } from 'expo-audio';

export type ManagedPlayer = ReturnType<typeof createAudioPlayer>;
type ManagedSource = Parameters<typeof createAudioPlayer>[0];

/** How long after the last lease drops before the session is handed back.
 *
 *  A GUESS, logged on every fire so it can be replaced with a measured one. It
 *  has to clear two gaps:
 *    - the ~60ms utils/ttsStream.ts leaves between read-aloud sentences
 *      (TTS_CHUNK_GAP_MS) -- belt and braces, since the chain worker also holds
 *      a span lease across the whole drain;
 *    - a Map Voice reply ending and the user immediately holding the mic, where
 *      deactivating and reactivating inside a third of a second would be a
 *      pointless "your music may resume" blip.
 *  Longer is safer for us and worse for them: it is how long they wait for
 *  their podcast to come back. */
const DEACTIVATE_DEBOUNCE_MS = 400;

let nextLeaseId = 1;
/** id -> tag. Size, not identity, is what gates the handback; the tags are for
 *  the log line that tells you who is still holding when it does not fire. */
const leases = new Map<number, string>();
const livePlayers = new Set<ManagedPlayer>();
const playerLeases = new WeakMap<ManagedPlayer, number>();

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

/** Set by ttsStream.ensureRecordingMode() -- the one funnel into capture in
 *  this app, which scripts/check-recording-wakelock.js RULE 2 already holds.
 *  While it is true we refuse to hand the session back: on iOS a setActive
 *  (false) under a live AVAudioRecorder either throws
 *  AVAudioSessionErrorCodeIsBusy or pulls the input route out from under the
 *  take, and a silent take is the failure this codebase is most armored
 *  against.
 *
 *  IT IS CLEARED BY THE START OF ANY MANAGED PLAYBACK, not by each recording
 *  surface. That is deliberate. A stale `true` can only SUPPRESS a handback,
 *  which is exactly the behaviour shipping today and therefore cannot regress
 *  anything; and the next moment we would ever want to hand back is the end of
 *  a playback, which by definition begins with a play. Nothing to forget
 *  per-surface. */
let recordingArmed = false;

function describe(): string {
  return `leases=${leases.size} players=${livePlayers.size} recordingArmed=${recordingArmed}`;
}

/** Take a lease on the session; the returned function drops it and is safe to
 *  call more than once.
 *
 *  Use this for a SPAN that outlives any single player. The read-aloud chain
 *  worker holds one across its whole queue drain, so the up-to-a-second
 *  /api/speak gap between two sentences sits INSIDE the lease and cannot
 *  trigger a handback the next sentence would immediately undo. */
export function acquireAudioSession(tag: string): () => void {
  const id = nextLeaseId++;
  leases.set(id, tag);
  cancelPendingDeactivate();
  console.log(`[audio-session] acquire ${tag}#${id} — ${describe()}`);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leases.delete(id);
    console.log(`[audio-session] release ${tag}#${id} — ${describe()}`);
    scheduleDeactivate();
  };
}

/** Called by ensureRecordingMode(). See `recordingArmed` above. */
export function noteRecordingArmed(): void {
  recordingArmed = true;
  cancelPendingDeactivate();
  console.log(`[audio-session] recording armed — ${describe()}`);
}

/** Resolves once no handback is in flight, and cancels one that is merely
 *  scheduled. ensureRecordingMode() awaits this BEFORE it sets the record
 *  category, so a deactivate that had already passed its guards cannot land on
 *  top of the recorder's own setActive(true). */
export function whenAudioSessionSettled(): Promise<void> {
  cancelPendingDeactivate();
  if (!inFlight) return Promise.resolve();
  return inFlight.then(() => undefined, () => undefined);
}

/** The only way to get an audio player in this app.
 *
 *  keepAudioSessionActive stays TRUE on every player here. It is what stops
 *  expo-audio from tearing the session down at each pause/finish -- between two
 *  read-aloud sentences, or one beat before a capture. Turning it off would
 *  hand the decision back to the library, which can only see one player at a
 *  time. Keeping it on is what makes this module the owner. */
export function createManagedPlayer(source: ManagedSource, tag: string): ManagedPlayer {
  const p = createAudioPlayer(source, { keepAudioSessionActive: true });
  livePlayers.add(p);
  console.log(`[audio-session] player created for ${tag} — ${describe()}`);
  return p;
}

/** Start playback. Natively this is `Function("play") { try activateSession() }`
 *  -> setActive(true): THIS call is where the user's music stops, so this is
 *  where the lease that will eventually give it back has to be taken. */
export function playManaged(player: ManagedPlayer | null | undefined, tag: string): void {
  if (!player) return;
  if (playerLeases.get(player) === undefined) {
    const id = nextLeaseId++;
    leases.set(id, `play:${tag}`);
    playerLeases.set(player, id);
  }
  recordingArmed = false;
  cancelPendingDeactivate();
  console.log(`[audio-session] play ${tag} — ${describe()}`);
  player.play();
}

/** Pause but keep the player loaded (voice notes resume from here). Drops the
 *  lease, because a paused player is not holding anyone's music hostage. */
export function pauseManaged(player: ManagedPlayer | null | undefined): void {
  if (!player) return;
  try { player.pause(); } catch {}
  dropPlayerLease(player);
}

/** Pause, release the native player, drop its lease. Idempotent. Every teardown
 *  path -- finish, cancel, unmount -- goes through here. */
export function releaseManagedPlayer(player: ManagedPlayer | null | undefined): void {
  if (!player) return;
  try { player.pause(); } catch {}
  try { player.remove(); } catch {}
  livePlayers.delete(player);
  dropPlayerLease(player);
}

function dropPlayerLease(player: ManagedPlayer): void {
  const id = playerLeases.get(player);
  if (id === undefined) return;
  playerLeases.delete(player);
  leases.delete(id);
  console.log(`[audio-session] lease dropped — ${describe()}`);
  scheduleDeactivate();
}

function cancelPendingDeactivate(): void {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
}

function scheduleDeactivate(): void {
  cancelPendingDeactivate();
  if (leases.size > 0) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void deactivateNow();
  }, DEACTIVATE_DEBOUNCE_MS);
}

async function deactivateNow(): Promise<void> {
  // Re-check at FIRE time, not at schedule time. Everything below the guards
  // runs without an await until `inFlight` is assigned, so nothing can slip
  // between the checks and the claim.
  if (leases.size > 0) {
    console.log(`[audio-session] handback skipped — someone re-claimed (${describe()})`);
    return;
  }
  if (recordingArmed) {
    console.log(`[audio-session] handback skipped — a capture is armed (${describe()})`);
    return;
  }
  // A missing lease is a bug; a still-playing player is its symptom. Because
  // setIsAudioActiveAsync(false) pauses EVERY player, the cost of being wrong
  // here is muting someone mid-sentence -- so refuse, loudly, and let the
  // session stay active (today's behaviour) rather than guess.
  for (const p of livePlayers) {
    let stillPlaying = false;
    try { stillPlaying = p.playing === true; } catch { stillPlaying = false; }
    if (stillPlaying) {
      console.warn(`[audio-session] handback REFUSED — a tracked player is still playing with no lease (${describe()}). That is a missing release, not a reason to mute it.`);
      return;
    }
  }
  if (Platform.OS !== 'ios') {
    // See the header: Android already abandons focus on its own, and its
    // deactivate is a latch that would silence every later play().
    console.log(`[audio-session] handback not needed on ${Platform.OS} — focus is released natively`);
    return;
  }
  const run = (async () => {
    try {
      await setIsAudioActiveAsync(false);
      console.log(`[audio-session] session handed back after ${DEACTIVATE_DEBOUNCE_MS}ms — other apps told they may resume`);
    } catch (e) {
      console.warn('[audio-session] handback failed:', (e as Error)?.message);
    }
  })();
  inFlight = run;
  try {
    await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
  // Someone claimed the session while the native call was in the air. Put it
  // back: on iOS this is an idempotent setActive(true); it also clears the
  // Android `audioEnabled` latch if this path ever reaches that platform.
  if (leases.size > 0 || recordingArmed) {
    try {
      await setIsAudioActiveAsync(true);
      console.log(`[audio-session] session re-activated — claimed during handback (${describe()})`);
    } catch (e) {
      console.warn('[audio-session] re-activate after handback failed:', (e as Error)?.message);
    }
  }
}

/** Read-only view of the bookkeeping, for scripts/check-audio-session-pairing.js.
 *  Nothing in the app reads this. */
export function __audioSessionDebug(): {
  leases: number; players: number; recordingArmed: boolean; pending: boolean;
} {
  return {
    leases: leases.size,
    players: livePlayers.size,
    recordingArmed,
    pending: pendingTimer !== null,
  };
}
