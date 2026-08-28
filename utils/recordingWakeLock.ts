// KEEP THE SCREEN AWAKE WHILE THE MIC IS OPEN (founder ruling 2026-08-27).
//
// WHY THIS EXISTS. A client reported Free Flow pausing after ~30 seconds of
// no touch. Nothing in our code stops it: expo-audio 1.1.1's own
// OnAppEntersBackground handler pauses every recorder whenever
// `allowsBackgroundRecording` is false (the default), and SCREEN LOCK fires
// that handler. iOS Auto-Lock's minimum setting is 30 seconds, which is the
// number the client saw. See utils/recorderWatch.ts for the full mechanism —
// that file makes the pause VISIBLE; this one stops it happening.
//
// Free Flow is the mode this hurts most, and it is the mode that causes it:
// its own record prompt reads "Close your eyes. Just let the words come" —
// the app asks for exactly the stillness that trips auto-lock.
//
// SCOPE: the screen, not the audio session. True background recording
// (`allowsBackgroundRecording: true` + an Android foreground service) is a
// separate decision and is deliberately NOT taken here. This does not save a
// take from a deliberate side-button press, a call, or Siri — the recorder
// watch still catches those and shows the paused state.
//
// WHY A HOOK AND NOT deactivate() CALLS ON EACH STOP PATH. There are many
// ways a take ends: release, slide-to-cancel, the check, a permission
// failure, a prepare throw, an interruption the user resolves by finishing,
// closing the modal mid-record, an unmount during an error unwind. Wiring a
// release into each one is a discipline that has to be reapplied every time
// someone adds a path, and the first missed path leaves the screen pinned on
// forever. So release is STRUCTURAL instead:
//
//   • `active` false      → the effect's cleanup releases;
//   • the owner unmounts  → the same cleanup releases;
//
// which together cover every exit, including ones that never run our code.
// The only way to leak is for `active` to stay true on a mounted component
// with no recording — which is the same invariant the recorder watch already
// depends on, and which the watch itself would be reporting as a live take.
//
// NEVER THROWS. A keep-awake failure must not be able to break recording:
// the whole feature is a nicety wrapped around the thing that matters. Every
// call is caught. Same reasoning as the __markerLog sink on the server.
import { useEffect, useRef } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/** Per-surface tags. expo-keep-awake reference-counts BY TAG: a surface can
 *  only ever release its own lock, so two surfaces can never turn each
 *  other's off. One per recording surface, never shared. */
export const WAKE_TAG = {
  journal: 'innermap-record-journal',
  chat: 'innermap-record-chat',
  mapVoice: 'innermap-record-map-voice',
  guideAsk: 'innermap-record-guide-ask',
  partner: 'innermap-record-partner',
} as const;

export type WakeTag = (typeof WAKE_TAG)[keyof typeof WAKE_TAG];

/**
 * Holds a screen-sleep lock for exactly as long as `active` is true.
 *
 * @param active True while a recording is live (the same flag the recorder
 *               watch treats as a live take).
 * @param tag    This surface's tag from WAKE_TAG. Never share one.
 */
export function useRecordingWakeLock(active: boolean, tag: WakeTag) {
  // Whether WE currently hold the lock. Not derived from `active`: the
  // activate is async, so there is a window where active is true and the
  // lock is not held yet, and releasing then would be a no-op against a
  // tag we never took.
  const heldRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    // Guards the async gap below. If the take ends while activate() is still
    // in flight, cleanup has already run and found nothing held — so the
    // resolution itself has to release, or the lock outlives the take.
    let ended = false;

    activateKeepAwakeAsync(tag)
      .then(() => {
        if (ended) {
          deactivateKeepAwake(tag).catch(() => {});
          return;
        }
        heldRef.current = true;
      })
      .catch((e) => {
        // Recording continues without it. Worth a line because the symptom
        // of a silent failure here is the original bug coming back.
        console.warn(`[wakelock] could not keep screen awake (${tag}):`, (e as Error)?.message);
      });

    return () => {
      ended = true;
      if (!heldRef.current) return;
      heldRef.current = false;
      deactivateKeepAwake(tag).catch(() => {});
    };
  }, [active, tag]);
}
