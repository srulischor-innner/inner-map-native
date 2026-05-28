// Map Voice bar — bottom of the Map tab (polish round 7).
//
// Replaces the press-and-hold MapVoiceButton + MapVoicePanel (entry
// modal + 10-min cap timer) with two mics side-by-side:
//
//   SELF (left, ●)        SELF-LIKE (right, ◆)  ← disabled in Phase 1
//
// Self mic flow:
//   tap-and-hold → records audio → release → POST audio to
//   /api/map-voice/turn → server returns transcript + Self reply
//   text + detected part + base64 MP3. Client plays the MP3 and
//   fires onDetectedPart so the map lights the blended part.
//
// First-time explainer modal plays the very first time the user
// taps Self; flag stored server-side via /api/map-voice/explainer-
// seen so it never plays again. The Self-like mic shows a "need
// belief established" tooltip on tap; it's otherwise inert until
// Phase 2.
//
// Each mic has a small (i) icon next to it that opens a brief
// description popup ("Self — pure presence …" / "Self-like part —
// active leadership …").
//
// No cap UI, no timer, no balance indicator — those went away
// with the Realtime pipeline. The server still rate-limits at
// 200 turns/24h per user.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, Modal, StyleSheet, ActivityIndicator, PanResponder,
  PanResponderInstance, GestureResponderEvent, PanResponderGestureState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
// Use the legacy expo-file-system surface (cacheDirectory,
// writeAsStringAsync, EncodingType) — same import path the other
// places in this codebase (app/settings.tsx, app/account/delete.tsx)
// use. The new top-level API removed these symbols.
import * as FileSystem from 'expo-file-system/legacy';
import {
  useAudioRecorder, AudioModule, RecordingPresets,
  setAudioModeAsync, createAudioPlayer,
} from 'expo-audio';

import { colors, fonts, spacing, radii } from '../../constants/theme';
import { api } from '../../services/api';

type VoiceState = 'idle' | 'recording' | 'thinking' | 'speaking';
type ModalKind = null | 'explainer' | 'selfInfo' | 'selfLikeInfo' | 'selfLikeDisabled';
type ActiveMic = 'self' | 'self-like';

// Phase 2 (polish round 8) — small toast shown when the server returns
// fallback="missing_belief" (the user spoke to a part they haven't yet
// established a belief for) or fallback="no_part_detected" (no part
// was detected with confidence). The audio still plays in both cases;
// the toast is purely informational and dismisses on its own.
//
// Build 11 extends this with two press-and-hold gesture toasts:
//   - 'hold-to-record'  → user released within MIN_HOLD_MS (accidental tap)
//   - 'slide-cancelled' → user slid finger off the mic and released
//                          (recording discarded silently otherwise)
type FallbackToast = {
  kind: 'missing_belief' | 'no_part_detected' | 'hold-to-record' | 'slide-cancelled';
  partName?: string | null;
} | null;

const MIN_HOLD_MS = 300;          // discard accidental taps shorter than this
const MAX_HOLD_MS = 120000;       // 2 minutes — auto-send if user holds longer
const SLIDE_CANCEL_DY = -60;      // upward swipe past this distance cancels
// Audio-truncation fix (real-device regression — user reports of
// transcripts ending mid-word: "I was wondering ", "my needs don't",
// "this part of me that's yelling at me like "). Two trailing-audio
// safeguards layered together:
//
//   STOP_GRACE_MS — keep the mic OPEN for 250ms AFTER the user lifts
//     their finger. The PanResponder release event fires within
//     ~0-200ms of the finger physically beginning to lift; if we call
//     recorder.stop() the instant we receive the release, any trailing
//     syllable the user was finishing gets swallowed. 250ms of post-
//     release recording captures the tail.
//
//   POST_STOP_FLUSH_MS — wait 150ms AFTER recorder.stop() resolves
//     before reading recorder.uri. expo-audio's stop() promise resolves
//     when the recorder transitions out of the recording state, but
//     the underlying iOS AVAudioRecorder may still be finalizing the
//     M4A container (writing the moov atom + flushing the last AAC
//     frames) for another 50-200ms. Reading uri + uploading
//     immediately can give us a file with the last frames missing.
//
// Skip both delays for slide-cancel / terminate paths — the audio is
// being discarded anyway, no point keeping the user waiting.
const STOP_GRACE_MS = 250;
const POST_STOP_FLUSH_MS = 150;
const SELF_LABEL = 'SELF';
const SELF_LIKE_LABEL = 'SELF-LIKE';

// Reasons stopAndDispatch can be invoked. Surfaces in the diagnostic
// log so future truncation reports can be triaged at a glance:
//   user_release — normal press-out (the dominant happy path)
//   auto_max    — MAX_HOLD_MS auto-fire (stuck-finger guard)
//   slide_cancel — user slid past SLIDE_CANCEL_DY OR external
//                  interruption (PanResponder terminate) — both
//                  discard the audio, so they share a reason label.
//   other       — explicit fallback for future call sites; treated
//                 like user_release for the tail-capture window.
type StopReason = 'user_release' | 'auto_max' | 'slide_cancel' | 'other';

const EXPLAINER_BODY = [
  // Mirrors the spec verbatim. The render path splits this into
  // paragraphs so the prose breathes.
  "Most of the time, when a part is loud — anxious, harsh, fearful — you don't notice. You ARE the anxiety. That's called blending. You're fused with the part. From the inside, it just feels like you.",
  "When you tap a mic and speak, the AI listens for which part is talking through you. That part lights up on the map — you see it externally, separate from you. That's unblending happening in real time. The moment you see \"oh, that's a part — I'm not that,\" a small space opens.",
  "Then a voice responds:",
];
const EXPLAINER_SELF_LINE =
  '🎙 Self — "I see you. I\'m here." Pure presence. When you need to be witnessed and settle — without being managed.';
const EXPLAINER_SELF_LIKE_LINE =
  '🎙 Self-like part — "I hear you, AND we\'re going a different way." Active leadership. When you need to hold a line with a part — make a different choice, redirect.';
const EXPLAINER_FOOTNOTE =
  "(Self-like part voice becomes available once you've established your own belief separate from your parts. Tap the Self-like part on the map to begin.)";

const SELF_INFO_BODY =
  "Self — pure presence. Speak; the part you're blended with lights up; Self responds to that part. Use when you need to be witnessed and settle.";
const SELF_LIKE_INFO_BODY =
  "Self-like part — active leadership. Speak; the part lights up; Self-like part responds from your established belief. Use when you need help holding a line with a part.";
const SELF_LIKE_DISABLED_BODY =
  "Self-like part — for active leadership when you need to hold a line with a part. Requires your own belief separate from the parts first. Tap the Self-like part on the map to begin.";

type Props = {
  sessionId: string;
  onDetectedPart?: (part: string, label?: string | null) => void;
};

export function MapVoiceBar({ sessionId: _sessionId, onDetectedPart }: Props) {
  const [state, setState] = useState<VoiceState>('idle');
  const [modal, setModal] = useState<ModalKind>(null);
  const [explainerSeen, setExplainerSeen] = useState<boolean | undefined>(undefined);
  const [holdSec, setHoldSec] = useState(0);
  // Phase 2 (polish round 8) — Self-like activation gate. True when
  // the user has at least one part with an established belief. Drives
  // the Self-like mic styling (enabled vs. disabled placeholder) and
  // the tap-vs-hold behavior. Loaded once on mount; refreshed each
  // time the user dismisses the explainer or finishes a self-like
  // turn (a SAVE_BELIEF flow in chat could land a new belief while
  // the user is here).
  const [selfLikeEnabled, setSelfLikeEnabled] = useState(false);
  const [activeMic, setActiveMic] = useState<ActiveMic | null>(null);
  const [fallbackToast, setFallbackToast] = useState<FallbackToast>(null);

  // Recording infra — same expo-audio hook the chat tab voice-note
  // path uses. HIGH_QUALITY gives m4a on iOS / mp4 on Android, both
  // of which Cartesia accepts.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const wantRecordingRef = useRef(false);
  const pressStartTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Locks which mic the current recording belongs to, so a mid-record
  // state change can't redirect dispatch into the wrong branch.
  const recordingModeRef = useRef<ActiveMic | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Build 11 — slide-to-cancel + max-hold infra. cancellingRef tracks
  // whether the user has slid past SLIDE_CANCEL_DY during a hold; the
  // matching `slideCancelling` state mirrors it for render-time UI
  // feedback (icon swap + red overlay). maxHoldTimerRef auto-sends
  // at MAX_HOLD_MS so a stuck-finger hold doesn't burn an unbounded
  // recording.
  const cancellingRef = useRef(false);
  const [slideCancelling, setSlideCancelling] = useState(false);
  const maxHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the explainer-seen flag once on mount. Result is cached
  // for this session; the POST/dismiss path updates it locally so
  // subsequent taps in the same session don't re-show the modal.
  useEffect(() => {
    let cancelled = false;
    api.getMapVoiceExplainerStatus()
      .then(({ seen }) => { if (!cancelled) setExplainerSeen(seen); })
      .catch(() => { if (!cancelled) setExplainerSeen(false); });
    return () => { cancelled = true; };
  }, []);

  // Refresh the belief gate. Round 9 correction (single-belief model):
  // Self-like activates only when the user's SELF-LIKE PART specifically
  // carries a belief — not any part on the map. The whole map operates
  // from one underlying belief system; the Self-like part holds the
  // single different belief that contrasts with the entire map. Called
  // on mount and after any self-like turn so a freshly-saved belief
  // (via SAVE_BELIEF marker in chat) lights the mic without a manual
  // reload.
  const refreshBeliefStatus = useCallback(async () => {
    try {
      const { parts } = await api.getPartsWithBeliefs();
      const selfLike = parts.find((p) => String(p.type || '').toLowerCase() === 'self-like');
      const hasBelief = !!(selfLike && selfLike.belief && selfLike.belief.trim());
      setSelfLikeEnabled(hasBelief);
    } catch {
      setSelfLikeEnabled(false);
    }
  }, []);

  useEffect(() => { refreshBeliefStatus(); }, [refreshBeliefStatus]);

  // Unmount cleanup — make sure no recorder / player is left running.
  useEffect(() => () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { recorder.stop(); } catch {}
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
    playerRef.current = null;
  }, [recorder]);

  // Show a fallback toast for ~4s, then auto-dismiss. The toast is
  // additive — the audio still plays underneath; the toast just gives
  // the user the next step ("Open this folder to establish belief").
  const showFallbackToast = useCallback((toast: FallbackToast) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setFallbackToast(toast);
    if (toast) {
      toastTimerRef.current = setTimeout(() => setFallbackToast(null), 4500);
    }
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // -------- Unified press-and-hold lifecycle (Self + Self-like) --------
  // The Self mic and the Self-like mic share the same record / stop /
  // send pipeline; only the mode arg + post-turn handling differ. The
  // mode for the in-flight recording is held in recordingModeRef so a
  // mid-record state shuffle can't crosswire branches.
  const startRecording = useCallback(async (mode: ActiveMic) => {
    if (state !== 'idle') {
      console.log(`[map-voice-bar] startRecording bailed — state=${state} (expected idle)`);
      return;
    }
    console.log(`[map-voice-bar] startRecording BEGIN mode=${mode}`);
    // Stamp the press start time IMMEDIATELY so heldMs at release
    // reflects the actual hold duration, even if the user releases
    // before prepareToRecordAsync() finishes (~500ms on iOS cold
    // start). Previously this was set AFTER the await, which meant
    // a 700ms hold computed heldMs ≈ 200ms and fell into the
    // accidental-tap branch — and we'd never have reached
    // setState('recording') anyway, so the release handler couldn't
    // even fire stopAndDispatch under the old `state === 'recording'`
    // gate. Both gates are fixed below; this is the cleanup.
    pressStartTimeRef.current = Date.now();
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        console.log('[map-voice-bar] mic permission denied');
        return;
      }
      try {
        await setAudioModeAsync({
          allowsRecording: true, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        });
      } catch {}
      await recorder.prepareToRecordAsync();
      // STUCK-RECORDER FIX (build 13 quick-tap regression):
      //   prepareToRecordAsync takes ~500ms on iOS cold start. If the
      //   user has tapped + released during that window — onPressOut
      //   has already fired, set wantRecordingRef.current = false, hit
      //   its "no active recording, skipping dispatch" branch and
      //   returned without doing anything (because recordingModeRef
      //   was still null at that point). If we now blindly call
      //   recorder.record() + setState('recording') the recorder
      //   starts with no finger on the screen, no future release
      //   event can fire, and the state machine is stuck on
      //   "recording" forever — user has no path to stop.
      //
      //   Guard: if wantRecordingRef.current is false here, the user
      //   already released. Abort cleanly: stop the prepared recorder,
      //   restore the playback audio mode, surface the "Hold to record"
      //   toast (same UX as a too-short hold), and return to idle.
      if (!wantRecordingRef.current) {
        const tappedMs = Date.now() - pressStartTimeRef.current;
        console.log(`[map-voice-bar] tap detected duration=${tappedMs}ms action="discarded" — released during prepareToRecordAsync, aborting cleanly`);
        try { await recorder.stop(); } catch {}
        try {
          await setAudioModeAsync({
            allowsRecording: false, playsInSilentMode: true,
            interruptionMode: 'doNotMix', shouldPlayInBackground: false,
          });
        } catch {}
        showFallbackToast({ kind: 'hold-to-record' });
        setState('idle');
        setActiveMic(null);
        recordingModeRef.current = null;
        return;
      }
      recorder.record();
      // recordingModeRef.current is the AUTHORITATIVE signal that a
      // recording is in flight — set the moment recorder.record() has
      // been called. The release handler reads THIS (not React state)
      // so closure-capture timing can't make us miss a dispatch.
      recordingModeRef.current = mode;
      setActiveMic(mode);
      setState('recording');
      setHoldSec(0);
      cancellingRef.current = false;
      setSlideCancelling(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      tickRef.current = setInterval(() => {
        setHoldSec(Math.floor((Date.now() - pressStartTimeRef.current) / 1000));
      }, 250);
      // Build 11 — auto-send at MAX_HOLD_MS so a stuck finger doesn't
      // burn an unbounded recording. The auto-fire goes through the
      // same stopAndDispatch path as a normal release, just without a
      // user gesture initiating it.
      if (maxHoldTimerRef.current) clearTimeout(maxHoldTimerRef.current);
      maxHoldTimerRef.current = setTimeout(() => {
        console.log('[map-voice-bar] MAX_HOLD_MS reached — auto-sending');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        stopAndDispatchRef.current?.('auto_max');
      }, MAX_HOLD_MS);
      console.log(`[map-voice-bar] startRecording READY mode=${mode}, recorder armed`);
    } catch (e) {
      console.warn('[map-voice-bar] startRecording failed:', (e as Error)?.message);
      setState('idle');
      setActiveMic(null);
      recordingModeRef.current = null;
    }
  }, [state, recorder, showFallbackToast]);

  // stopAndDispatchRef holds the latest version of stopAndDispatch so
  // the max-hold setTimeout can call it without capturing a stale
  // closure. Wired after stopAndDispatch is declared below.
  const stopAndDispatchRef = useRef<((reason?: StopReason) => Promise<void>) | null>(null);

  // Decode + play the base64 MP3 returned by /api/map-voice/turn.
  // Reused across all four outcome branches (self / self-like
  // success / missing_belief / no_part_detected) so the audio path
  // is identical regardless of what the LLM produced. Returns
  // a cleanup promise that resolves when playback finishes — the
  // state machine transitions idle on its own via the poll below.
  const playReplyAudio = useCallback(async (base64: string) => {
    const tmpUri = `${FileSystem.cacheDirectory ?? ''}map-voice-${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(tmpUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
    const player = createAudioPlayer({ uri: tmpUri });
    playerRef.current = player;
    setState('speaking');
    player.play();
    const playCheck = setInterval(() => {
      try {
        const s = player.currentStatus;
        if (s?.didJustFinish || (s && s.duration > 0 && s.currentTime >= s.duration - 0.05)) {
          clearInterval(playCheck);
          setState('idle');
          setActiveMic(null);
          try { player.remove(); } catch {}
          playerRef.current = null;
          FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
        }
      } catch {}
    }, 200);
  }, []);

  const sendAudio = useCallback(async (uri: string, mime: string, mode: ActiveMic) => {
    console.log(`[map-voice-bar] sendAudio START mode=${mode}`);
    setState('thinking');
    try {
      const result = await api.mapVoiceTurn(uri, mime, mode);
      console.log(`[map-voice-bar] sendAudio — mapVoiceTurn resolved (${result ? 'truthy' : 'null'})`);
      if (!result) {
        console.warn('[map-voice-bar] turn returned null');
        setState('idle');
        setActiveMic(null);
        return;
      }
      if ('error' in result) {
        console.warn('[map-voice-bar] turn error:', result.error, result.message);
        setState('idle');
        setActiveMic(null);
        return;
      }

      // Branch on (mode, fallback). Self mode never returns a
      // fallback. Self-like has two: missing_belief (a part was
      // detected but the user hasn't articulated their belief for
      // it yet) and no_part_detected (the detection LLM couldn't
      // commit to a single part with confidence). In BOTH self-like
      // fallback branches we still play the server's audio reply
      // — the LLM crafts a gentle nudge — and skip the part-lighting
      // so the visual doesn't claim a detection that didn't happen.
      if (mode === 'self-like' && result.fallback === 'missing_belief') {
        showFallbackToast({ kind: 'missing_belief', partName: result.part_name || result.detected_part });
        await playReplyAudio(result.audio_base64);
        // Refresh belief status — the user may establish belief in
        // a follow-up, and the next mount/refresh re-enables this
        // flag without a manual remount.
        refreshBeliefStatus();
        return;
      }
      if (mode === 'self-like' && result.fallback === 'no_part_detected') {
        showFallbackToast({ kind: 'no_part_detected' });
        await playReplyAudio(result.audio_base64);
        return;
      }

      // Happy path — Self always, or Self-like with a part + belief.
      // Light up the detected part on the map before audio starts —
      // the visual hits at the same beat the user starts hearing the
      // reply, which is the whole point of the unblending moment.
      try { onDetectedPart?.(result.detected_part, result.part_label); } catch {}
      await playReplyAudio(result.audio_base64);
      if (mode === 'self-like') refreshBeliefStatus();
    } catch (e) {
      console.warn('[map-voice-bar] sendAudio threw:', (e as Error)?.message);
      setState('idle');
      setActiveMic(null);
    }
  }, [onDetectedPart, playReplyAudio, refreshBeliefStatus, showFallbackToast]);

  const stopAndDispatch = useCallback(async (reasonHint: StopReason = 'user_release') => {
    console.log(`[map-voice-bar] stopAndDispatch START reasonHint=${reasonHint}`);
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (maxHoldTimerRef.current) { clearTimeout(maxHoldTimerRef.current); maxHoldTimerRef.current = null; }
    const heldMs = Date.now() - pressStartTimeRef.current;
    const mode = recordingModeRef.current;
    recordingModeRef.current = null;
    const cancelled = cancellingRef.current;
    cancellingRef.current = false;
    setSlideCancelling(false);
    // Effective reason: cancellingRef set during this hold overrides
    // a 'user_release' hint with 'slide_cancel' so the log always
    // reflects what actually happened. terminate path also routes
    // through cancellingRef → reads as slide_cancel below.
    const reason: StopReason = cancelled ? 'slide_cancel' : reasonHint;
    console.log(`[map-voice-bar] stopAndDispatch mode=${mode} heldMs=${heldMs} reason=${reason}`);

    // ===== TRAILING-AUDIO FIX =====
    // For real user releases (not cancel / not terminate / not
    // max-hold auto-fire), keep the mic open for STOP_GRACE_MS more
    // so any trailing syllable hits the recorder before we close
    // the file. See STOP_GRACE_MS docstring above.
    const captureTail = reason === 'user_release' || reason === 'auto_max' || reason === 'other';
    if (captureTail) {
      await new Promise<void>((r) => setTimeout(r, STOP_GRACE_MS));
    }

    try {
      await recorder.stop();
      console.log('[map-voice-bar] recorder.stop resolved');
      // Belt-and-braces flush: even after stop() resolves, the iOS
      // AVAudioRecorder may still be finalizing the M4A container.
      // Wait POST_STOP_FLUSH_MS before reading recorder.uri so we
      // don't upload a file with truncated trailing frames.
      if (captureTail) {
        await new Promise<void>((r) => setTimeout(r, POST_STOP_FLUSH_MS));
      }
      try {
        await setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        });
      } catch {}
    } catch (e) {
      console.warn('[map-voice-bar] recorder.stop threw:', (e as Error)?.message);
    }

    // Effective captured duration includes the grace window (the mic
    // was open during STOP_GRACE_MS too). Surfaces in the diagnostic
    // log below so we can correlate transcript truncation reports
    // with how long the file should have been.
    const capturedMs = heldMs + (captureTail ? STOP_GRACE_MS : 0);
    console.log(
      `[map-voice-bar] recorder stopped duration=${capturedMs}ms ` +
      `maxAllowedMs=${MAX_HOLD_MS} reason="${reason}"`,
    );

    if (cancelled) {
      console.log('[map-voice-bar] slide-cancelled — discarding');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      showFallbackToast({ kind: 'slide-cancelled' });
      setState('idle');
      setActiveMic(null);
      return;
    }
    if (heldMs < MIN_HOLD_MS) {
      // Build 11 — replace the silent discard with a toast so the
      // user understands the gesture model. Previously a quick
      // accidental tap dropped to idle with no feedback, which read
      // as "the mic is broken." Now they see "Hold to record."
      console.log(`[map-voice-bar] hold too short (${heldMs}ms < ${MIN_HOLD_MS}ms) — toast`);
      showFallbackToast({ kind: 'hold-to-record' });
      setState('idle');
      setActiveMic(null);
      return;
    }
    const uri = recorder.uri;
    if (!uri) {
      console.warn('[map-voice-bar] no recording uri after stop — silent fail');
      setState('idle');
      setActiveMic(null);
      return;
    }
    const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/mp4';
    console.log(`[map-voice-bar] dispatching to sendAudio mode=${mode || 'self'} uri=...${uri.slice(-30)} mime=${mime}`);
    sendAudio(uri, mime, mode || 'self');
  }, [recorder, sendAudio, showFallbackToast]);

  // Wire the ref so the max-hold setTimeout can fire stopAndDispatch
  // without closing over a stale instance.
  useEffect(() => {
    stopAndDispatchRef.current = stopAndDispatch;
  }, [stopAndDispatch]);

  // Build 11 — gesture handlers driven by PanResponder instead of
  // Pressable so we can track finger movement during a hold (slide-
  // to-cancel) and reliably distinguish a real release from a parent-
  // ScrollView intercept. The press-in / press-out shape stays the
  // same; the responder just wraps it with onMove dy tracking.
  //
  // Refs hold the latest handler closures so the PanResponder we
  // create once (per mount) always calls the freshest startRecording
  // / stopAndDispatch — PanResponder.create captures by closure, and
  // we don't want to recreate it on every dependency change because
  // re-creating mid-gesture orphans the in-flight responder.
  const handlersRef = useRef<{
    onPressIn: (mode: ActiveMic) => void;
    onPressOut: () => void;
    onMove: (dy: number) => void;
  }>({
    onPressIn: () => {}, onPressOut: () => {}, onMove: () => {},
  });

  const onSelfPressIn = useCallback(() => {
    console.log(`[map-voice-bar] onSelfPressIn — state=${state} explainerSeen=${explainerSeen}`);
    if (state !== 'idle') return;
    wantRecordingRef.current = true;
    if (explainerSeen === false) {
      setModal('explainer');
      wantRecordingRef.current = false;
      return;
    }
    startRecording('self');
  }, [state, explainerSeen, startRecording]);

  // Build 11 release handler — use recordingModeRef.current (a synchronous
  // ref set the moment recorder.record() fires) as the dispatch gate,
  // NOT React state. The previous `state === 'recording'` check was
  // bitten by closure capture: useCallback's closure captures `state`
  // at the time React re-renders, which lags the actual recording
  // having started (state transitions through batched updates). On
  // some iOS first-launch cold paths the closure still held state='idle'
  // at release time, the gate failed silently, and the recording was
  // never dispatched. recordingModeRef.current avoids that entire class
  // of bug — refs are read at call time, not closure-capture time.
  const onSelfPressOut = useCallback(() => {
    const heldMs = Date.now() - pressStartTimeRef.current;
    const wasRecording = recordingModeRef.current !== null;
    console.log(
      `[map-voice-bar] onSelfPressOut — wantRecording=${wantRecordingRef.current} ` +
      `recordingMode=${recordingModeRef.current} state=${state} heldMs=${heldMs}`,
    );
    if (!wantRecordingRef.current) return;
    wantRecordingRef.current = false;
    if (wasRecording) {
      console.log('[map-voice-bar] onSelfPressOut → calling stopAndDispatch');
      stopAndDispatch('user_release');
    } else {
      console.log('[map-voice-bar] onSelfPressOut — no active recording, skipping dispatch');
    }
  }, [state, stopAndDispatch]);

  const onSelfLikePressIn = useCallback(() => {
    console.log(`[map-voice-bar] onSelfLikePressIn — state=${state} selfLikeEnabled=${selfLikeEnabled}`);
    if (state !== 'idle') return;
    if (!selfLikeEnabled) {
      Haptics.selectionAsync().catch(() => {});
      setModal('selfLikeDisabled');
      return;
    }
    wantRecordingRef.current = true;
    if (explainerSeen === false) {
      setModal('explainer');
      wantRecordingRef.current = false;
      return;
    }
    startRecording('self-like');
  }, [state, selfLikeEnabled, explainerSeen, startRecording]);

  const onSelfLikePressOut = useCallback(() => {
    const heldMs = Date.now() - pressStartTimeRef.current;
    const wasRecording = recordingModeRef.current !== null;
    console.log(
      `[map-voice-bar] onSelfLikePressOut — wantRecording=${wantRecordingRef.current} ` +
      `recordingMode=${recordingModeRef.current} state=${state} heldMs=${heldMs}`,
    );
    if (!wantRecordingRef.current) return;
    wantRecordingRef.current = false;
    if (wasRecording) {
      console.log('[map-voice-bar] onSelfLikePressOut → calling stopAndDispatch');
      stopAndDispatch('user_release');
    } else {
      console.log('[map-voice-bar] onSelfLikePressOut — no active recording, skipping dispatch');
    }
  }, [state, stopAndDispatch]);

  // Shared slide-to-cancel: when the user drags up past SLIDE_CANCEL_DY
  // (60px), set cancellingRef so the eventual release discards the
  // recording. Dragging BACK below the threshold un-cancels (matches
  // WhatsApp's behavior). The state mirror drives the visual: mic
  // icon swaps to an X and the recording chip turns red.
  const onMicMove = useCallback((dy: number) => {
    if (state !== 'recording') return;
    const shouldCancel = dy < SLIDE_CANCEL_DY;
    if (shouldCancel !== cancellingRef.current) {
      cancellingRef.current = shouldCancel;
      setSlideCancelling(shouldCancel);
      if (shouldCancel) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    }
  }, [state]);

  // PanResponder factory — produces ONE responder per mic. Created
  // once at mount; reads the latest handlers via handlersRef so we
  // don't need to recreate the responder when callbacks change.
  function makeMicResponder(mode: ActiveMic): PanResponderInstance {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        console.log(`[map-voice-bar] PanResponder GRANT mode=${mode}`);
        if (mode === 'self') handlersRef.current.onPressIn('self');
        else handlersRef.current.onPressIn('self-like');
      },
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
        handlersRef.current.onMove(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        console.log(`[map-voice-bar] PanResponder RELEASE mode=${mode} dy=${g.dy.toFixed(1)} dx=${g.dx.toFixed(1)}`);
        handlersRef.current.onPressOut();
      },
      onPanResponderTerminate: (_e, g) => {
        // Treat external interruption (e.g., parent scroll, modal
        // appearing) as a cancel: stop the recorder + don't send.
        // Use recordingModeRef.current — NOT React state — since
        // makeMicResponder is called once at mount and `state` in
        // this closure would be permanently 'idle'.
        console.log(`[map-voice-bar] PanResponder TERMINATE mode=${mode} dy=${g.dy.toFixed(1)} recordingMode=${recordingModeRef.current}`);
        if (recordingModeRef.current !== null) {
          cancellingRef.current = true;
          setSlideCancelling(true);
        }
        handlersRef.current.onPressOut();
      },
    });
  }

  const selfResponderRef = useRef<PanResponderInstance | null>(null);
  const selfLikeResponderRef = useRef<PanResponderInstance | null>(null);
  if (!selfResponderRef.current) selfResponderRef.current = makeMicResponder('self');
  if (!selfLikeResponderRef.current) selfLikeResponderRef.current = makeMicResponder('self-like');

  // Keep handlersRef pointed at the freshest callbacks for each mic.
  // The PanResponder grabs onPressIn(mode) via a route that branches
  // inside makeMicResponder; the handlers themselves are keyed by
  // mode externally, so we only need to publish three slots: the
  // per-mic onPressIn (selected at responder time), onPressOut
  // (shared), and onMove (shared).
  useEffect(() => {
    handlersRef.current = {
      onPressIn: (mode) => (mode === 'self' ? onSelfPressIn() : onSelfLikePressIn()),
      onPressOut: () => (activeMic === 'self-like' ? onSelfLikePressOut() : onSelfPressOut()),
      onMove: onMicMove,
    };
  }, [onSelfPressIn, onSelfPressOut, onSelfLikePressIn, onSelfLikePressOut, onMicMove, activeMic]);

  // Cleanup max-hold timer on unmount.
  useEffect(() => () => {
    if (maxHoldTimerRef.current) clearTimeout(maxHoldTimerRef.current);
  }, []);

  const dismissExplainer = useCallback(() => {
    setModal(null);
    setExplainerSeen(true);
    api.markMapVoiceExplainerSeen().catch(() => {});
  }, []);

  // -------- Render --------
  const recording = state === 'recording';
  const thinking = state === 'thinking';
  const speaking = state === 'speaking';
  const selfMicRecording = recording && activeMic === 'self';
  const selfLikeMicRecording = recording && activeMic === 'self-like';
  const selfMicBusy = (thinking || speaking) && activeMic === 'self';
  const selfLikeMicBusy = (thinking || speaking) && activeMic === 'self-like';

  return (
    <>
      <View style={styles.bar} pointerEvents="box-none">
        <View style={styles.col}>
          <Text style={styles.glyph}>●</Text>
          <View
            {...(selfResponderRef.current?.panHandlers || {})}
            style={[
              styles.mic,
              selfMicRecording && styles.micRecording,
              selfMicBusy && thinking && styles.micThinking,
              selfMicBusy && speaking && styles.micSpeaking,
              // Build 11 — slide-to-cancel visual: red overlay + X
              // icon when the user has dragged past the threshold.
              selfMicRecording && slideCancelling && styles.micCancelling,
            ]}
            accessible
            accessibilityLabel="Self — hold to speak, slide up to cancel"
            accessibilityRole="button"
          >
            {selfMicBusy && thinking ? (
              <ActivityIndicator color={colors.amber} />
            ) : (
              <Ionicons
                name={selfMicRecording && slideCancelling ? 'close' : 'mic'}
                size={22}
                color={
                  selfMicRecording && slideCancelling
                    ? '#fff'
                    : selfMicRecording || (selfMicBusy && speaking)
                      ? '#fff'
                      : colors.amber
                }
              />
            )}
          </View>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{SELF_LABEL}</Text>
            <Pressable
              onPress={() => setModal('selfInfo')}
              hitSlop={8}
              style={styles.infoBtn}
              accessibilityLabel="What does Self do"
            >
              <Ionicons name="information-circle-outline" size={14} color={colors.creamDim} />
            </Pressable>
          </View>
          {selfMicRecording ? (
            <Text style={[styles.hint, slideCancelling && styles.hintCancelling]}>
              {slideCancelling ? 'release to cancel' : `recording… ${holdSec}s`}
            </Text>
          ) : null}
        </View>

        {/* Self-like mic. When `selfLikeEnabled` is false (no part has
            a belief yet), tap → 'selfLikeDisabled' tooltip and no
            recording. When enabled, behavior mirrors Self: press-and-
            hold to record, release to dispatch with mode='self-like'.
            Visual: same amber styling as Self when enabled, dimmed
            cream placeholder when disabled — same hierarchy as the
            Phase 1 design but the column is no longer permanently
            faded. */}
        <View style={[styles.col, !selfLikeEnabled && styles.colDisabled]}>
          <Text style={[styles.glyph, !selfLikeEnabled && styles.glyphDim]}>◆</Text>
          <View
            {...(selfLikeResponderRef.current?.panHandlers || {})}
            style={[
              styles.mic,
              !selfLikeEnabled && styles.micDisabled,
              selfLikeMicRecording && styles.micRecording,
              selfLikeMicBusy && thinking && styles.micThinking,
              selfLikeMicBusy && speaking && styles.micSpeaking,
              selfLikeMicRecording && slideCancelling && styles.micCancelling,
            ]}
            accessible
            accessibilityLabel={
              selfLikeEnabled
                ? 'Self-like part — hold to speak, slide up to cancel'
                : 'Self-like part — not yet available'
            }
            accessibilityRole="button"
          >
            {selfLikeMicBusy && thinking ? (
              <ActivityIndicator color={colors.amber} />
            ) : (
              <Ionicons
                name={selfLikeMicRecording && slideCancelling ? 'close' : 'mic'}
                size={22}
                color={
                  !selfLikeEnabled
                    ? colors.creamFaint
                    : selfLikeMicRecording || (selfLikeMicBusy && speaking)
                      ? '#fff'
                      : colors.amber
                }
              />
            )}
          </View>
          <View style={styles.labelRow}>
            <Pressable
              onPress={() => setModal('selfLikeInfo')}
              hitSlop={8}
              style={styles.infoBtn}
              accessibilityLabel="What does Self-like part do"
            >
              <Ionicons
                name="information-circle-outline"
                size={14}
                color={selfLikeEnabled ? colors.creamDim : colors.creamFaint}
              />
            </Pressable>
            <Text style={[styles.label, !selfLikeEnabled && styles.labelDim]}>
              {SELF_LIKE_LABEL}
            </Text>
          </View>
          {selfLikeMicRecording ? (
            <Text style={[styles.hint, slideCancelling && styles.hintCancelling]}>
              {slideCancelling ? 'release to cancel' : `recording… ${holdSec}s`}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Fallback toast — sits above the mics, auto-dismisses ~4.5s
          after appearing. Two variants:
            • missing_belief: "{part_name} — open this folder and
              establish your belief." Audio (the LLM's gentle nudge)
              is already playing underneath.
            • no_part_detected: "Couldn’t identify a single part —
              try again with one specific situation." */}
      {fallbackToast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Text style={styles.toastText}>
              {fallbackToast.kind === 'missing_belief'
                ? 'Tap the Self-like part on the map to establish your belief.'
                : fallbackToast.kind === 'no_part_detected'
                  ? 'Couldn’t identify a single part — try again with one specific situation.'
                  : fallbackToast.kind === 'hold-to-record'
                    ? 'Hold to record.'
                    : 'Recording cancelled.'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* First-time explainer modal. */}
      <Modal
        visible={modal === 'explainer'}
        transparent
        animationType="fade"
        onRequestClose={dismissExplainer}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={dismissExplainer}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>Seeing your parts, hearing Self speak to them</Text>
            {EXPLAINER_BODY.map((p, i) => (
              <Text key={i} style={styles.cardBody}>{p}</Text>
            ))}
            <Text style={[styles.cardBody, styles.cardLine]}>{EXPLAINER_SELF_LINE}</Text>
            <Text style={[styles.cardBody, styles.cardLine]}>{EXPLAINER_SELF_LIKE_LINE}</Text>
            <Text style={[styles.cardBody, styles.cardFootnote]}>{EXPLAINER_FOOTNOTE}</Text>
            <Pressable onPress={dismissExplainer} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Self (i) popup. */}
      <Modal
        visible={modal === 'selfInfo'}
        transparent
        animationType="fade"
        onRequestClose={() => setModal(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>Self</Text>
            <Text style={styles.cardBody}>{SELF_INFO_BODY}</Text>
            <Pressable onPress={() => setModal(null)} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Self-like part (i) popup. */}
      <Modal
        visible={modal === 'selfLikeInfo'}
        transparent
        animationType="fade"
        onRequestClose={() => setModal(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>Self-like part</Text>
            <Text style={styles.cardBody}>{SELF_LIKE_INFO_BODY}</Text>
            <Pressable onPress={() => setModal(null)} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Self-like disabled — Phase 1 placeholder tooltip. */}
      <Modal
        visible={modal === 'selfLikeDisabled'}
        transparent
        animationType="fade"
        onRequestClose={() => setModal(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setModal(null)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.cardTitle}>Not yet available</Text>
            <Text style={styles.cardBody}>{SELF_LIKE_DISABLED_BODY}</Text>
            <Pressable onPress={() => setModal(null)} style={styles.gotItBtn}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Bottom bar — sits ABOVE the ProgressStrip footer. Two columns of
  // equal width with the mics centered. No background — sits over
  // the map's deep-navy directly.
  bar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 50,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
  },
  col: {
    alignItems: 'center',
    minWidth: 100,
  },
  colDisabled: { opacity: 0.4 },
  glyph: {
    color: colors.amber,
    fontSize: 11,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  glyphDim: { color: colors.creamFaint },
  mic: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(20,19,26,0.9)',
    borderWidth: 2, borderColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.amber, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  micRecording: { backgroundColor: '#d4726a', borderColor: '#d4726a' },
  micThinking:  { backgroundColor: colors.backgroundSecondary },
  micSpeaking:  { backgroundColor: '#8A7AAA', borderColor: '#8A7AAA' },
  // Build 11 — slide-to-cancel state. Darker red + thicker border so
  // the user clearly sees the recording is about to be discarded on
  // release. The icon swaps to "close" via the render branch.
  micCancelling: { backgroundColor: '#8a2a2a', borderColor: '#5a1a1a', borderWidth: 3 },
  micDisabled: {
    borderColor: colors.creamFaint,
    shadowOpacity: 0,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  label: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  labelDim: { color: colors.creamFaint },
  infoBtn: {
    padding: 2,
  },
  hint: {
    marginTop: 4,
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 11,
  },
  // Build 11 — recording hint when the user has slid past the
  // cancel threshold. Red text matches the cancelling mic visual
  // so the discard intention reads loud + clear.
  hintCancelling: {
    color: '#E05050',
    fontFamily: fonts.sansBold,
  },

  // Fallback toast — pinned just above the mic bar. Self-aligned
  // wrap with absolute positioning so it overlays without affecting
  // mic-row layout. Pointer-events disabled so taps pass through.
  toastWrap: {
    position: 'absolute',
    left: 0, right: 0,
    bottom: 140,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  toast: {
    maxWidth: 360,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: 'rgba(20,19,26,0.92)',
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.35)',
  },
  toastText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  // Modals — shared backdrop + card styling. Single GOT IT button on
  // each. Cards use Cormorant for the body to match the chat /
  // welcome aesthetic; titles + button stay sans for UI chrome.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#0e0e1a',
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.25)',
  },
  cardTitle: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 22,
    lineHeight: 28,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  cardBody: {
    color: colors.cream,
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  cardLine: { fontStyle: 'italic' },
  cardFootnote: {
    color: colors.creamDim,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  gotItBtn: {
    backgroundColor: colors.amber,
    paddingVertical: 14,
    borderRadius: radii.pill,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  gotItText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.4,
  },
});
