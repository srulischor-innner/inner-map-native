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
//   • subscribes to recordingStatusUpdate so encode errors are heard.
import { useEffect, useRef } from 'react';
import type { AudioRecorder } from 'expo-audio';

export const RECORDER_WATCH_INTERVAL_MS = 500;

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
    const sub = recorder.addListener('recordingStatusUpdate', (status) => {
      if (status.hasError) cbRef.current.onEncodeError(status.error ?? null);
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
      if (!st.isRecording) o.onInterrupted();
    }, RECORDER_WATCH_INTERVAL_MS);
    return () => {
      sub.remove();
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.active, recorder]);
}
