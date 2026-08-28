// Reconciles JS recording state with NATIVE recorder truth.
//
// WHY THIS EXISTS (iOS truncation bug, July 2026): the `recording` state in
// ChatInput / JournalEntryModal is purely our belief — nothing observed the
// recorder. expo-audio 1.1.1 pauses the native recorder underneath us:
//   • on app background / screen lock — the module's own OnAppEntersBackground
//     handler pauses all recorders whenever allowsBackgroundRecording is
//     false (the default; the UIBackgroundModes plist key alone does NOT
//     enable it), resuming on foreground;
//   • on AVAudioSession interruptions (call / Siri / another app taking the
//     session) — native auto-pauses, then auto-resumes with a silently
//     swallowed `try?` that can fail, and iOS does not guarantee the
//     .ended notification ever arrives.
// NO JS event fires for any of this. The one push event that exists,
// `recordingStatusUpdate`, only fires on forDuration-completion or encode
// error — and `mediaServicesDidReset` is hardcoded false on iOS in 1.1.1.
// Result: a beta tester dictated minutes of journal over a recorder that
// had paused at ~30s — live UI, frozen file.
//
// The watch, while a recording is supposed to be live:
//   • polls getStatus() every 500ms;
//   • feeds durationMillis out as the ACTUAL captured duration (native
//     accumulates across pauses) — this drives the visible timer, so it
//     freezes when capture freezes instead of climbing with wall clock;
//   • isRecording=false without one of OUR stop paths running → an
//     interruption: surfaced within one poll tick;
//   • isRecording returning true while we're showing the interrupted state
//     → the library's own auto-resume kicked in: report the gap (wall
//     clock minus captured), never hide it;
//   • subscribes to recordingStatusUpdate so encode errors are heard —
//     suppressed, exactly like the poll, while one of the OWNER's own stop
//     paths is running (see the guard on the subscription below).
import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import type { AudioRecorder } from 'expo-audio';

export const RECORDER_WATCH_INTERVAL_MS = 500;

// A PAUSED BAR IS NOT A SIGNAL TO SOMEONE WITH THEIR EYES CLOSED
// (founder ruling 2026-08-28). Free Flow's own record prompt says "Close
// your eyes. Just let the words come" — so the visible paused state this
// file exists to produce reaches everyone EXCEPT the person in the mode it
// matters most for. They keep talking into a recorder that stopped.
//
// Fired here rather than in each owner for the same reason the wake lock is
// released here-not-there: this is the one place an interruption is
// detected, so a surface added later inherits it. Warning-style, not
// success — this is bad news and should not feel neutral. Never awaited and
// never able to throw: a haptic failure must not touch recording.
function buzzInterrupted() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

export function useRecorderWatch(recorder: AudioRecorder, opts: {
  /** JS believes a recording (held or locked) is live. */
  active: boolean;
  /** True while one of OUR stop paths is running — suppresses reconciliation. */
  stoppingRef: React.MutableRefObject<boolean>;
  /** Wall-clock start of the take — used only for gap estimates. */
  startTimeRef: React.MutableRefObject<number>;
  /** Mirror of the interrupted UI state, readable inside the poll. */
  interruptedRef: React.MutableRefObject<boolean>;
  /** Actual captured duration — fires every poll tick while active. */
  onCapturedMs: (ms: number) => void;
  /** Native recorder stopped/paused and it wasn't us. */
  onInterrupted: () => void;
  /** Native recorder came back on its own while interrupted; gapSec ≈ audio lost. */
  onAutoResumed: (gapSec: number) => void;
  /** recordingStatusUpdate arrived with hasError. */
  onEncodeError: (message: string | null) => void;
}) {
  // Latest-callback ref — the interval/subscription closures never go stale,
  // and the effect only re-runs when `active` flips (start/stop of a take).
  const cbRef = useRef(opts);
  cbRef.current = opts;

  useEffect(() => {
    if (!opts.active) return;
    // SAME SUPPRESSION AS THE POLL BELOW (`if (o.stoppingRef.current) return;`),
    // for the same reason and read the same way — through cbRef, so it is
    // always the live ref and never a stale closure.
    //
    // WHAT IT DISTINGUISHES: stoppingRef is raised by the owner the instant it
    // decides to end a take, and stays raised until the next take starts. An
    // encode error arriving while it is DOWN happened mid-take, with the user
    // still recording — a real fault, and it still surfaces. That is the whole
    // reason this subscription exists (the iOS truncation bug in the header).
    // An error arriving while it is UP arrived during, or after, our own stop.
    //
    // WHY IT IS NEEDED AT ALL: Android's MediaRecorder fires onError/onInfo
    // while it is being torn down, and expo-audio forwards both as
    // recordingStatusUpdate with hasError=true (AudioRecorder.kt onError /
    // onInfo). Those land AFTER the owner has already cleared its interrupted
    // latch as part of stopping, so an unguarded call re-sets that latch on a
    // component that has just left the recording UI. Unsubscribing does not
    // close the window: `active` flips in React state, and the effect cleanup
    // that removes this subscription runs a render later, not synchronously.
    //
    // WHERE IT ERRS: an error that genuinely occurs INSIDE the owner's own
    // stop window (the release grace + stop() resolving — a few hundred ms at
    // the very end of a take) is suppressed along with the teardown noise. The
    // two are indistinguishable from here: both are "an error while stopping".
    // Erring toward suppression is the right direction. By then the take is
    // over and the file is about to be read, so a genuinely broken recording
    // still announces itself on the stop path — a null uri, or a stop() that
    // throws — where the owner can act on it. The opposite bias cannot be
    // recovered from at all: it paints a "Paused" state onto a take that has
    // already been sent, over a recorder that is gone.
    const sub = recorder.addListener('recordingStatusUpdate', (status) => {
      if (!status.hasError) return;
      if (cbRef.current.stoppingRef.current) return;
      buzzInterrupted();
      cbRef.current.onEncodeError(status.error ?? null);
    });
    const iv = setInterval(() => {
      const o = cbRef.current;
      let st: ReturnType<AudioRecorder['getStatus']>;
      try {
        st = recorder.getStatus();
      } catch {
        return; // recorder released mid-teardown — the effect cleanup is imminent
      }
      if (typeof st.durationMillis === 'number' && st.durationMillis >= 0) {
        o.onCapturedMs(st.durationMillis);
      }
      if (o.stoppingRef.current) return;
      if (o.interruptedRef.current) {
        if (st.isRecording) {
          const wall = Date.now() - o.startTimeRef.current;
          const gapSec = Math.max(1, Math.round((wall - (st.durationMillis || 0)) / 1000));
          o.onAutoResumed(gapSec);
        }
        return;
      }
      if (!st.isRecording) { buzzInterrupted(); o.onInterrupted(); }
    }, RECORDER_WATCH_INTERVAL_MS);
    return () => {
      sub.remove();
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.active, recorder]);
}
