// Bottom input bar — WHATSAPP-STYLE VOICE NOTES.
//
// Modes:
//   idle        → text field + mic button (press-and-hold to record)
//   typing      → text field + send (arrow-up) button
//   recording   → text field is covered by a "Recording… 0:03" pill with
//                 a red pulsing dot.
//
// Voice-note gesture (mic button) — press-and-hold, PLUS swipe-to-lock:
//   • Press-and-hold the mic → recording starts after a 150ms long-press.
//   • Release below the lock/cancel thresholds → sends (held ≥ MIN_RECORDING_MS;
//     anything shorter is a misfire → brief "hold longer" toast, audio dropped).
//   • Swipe UP past LOCK_DY while holding → recording LOCKS (hands-free): the
//     finger can lift, the mic keeps capturing, the trailing button becomes a
//     send control, and a trash/cancel affordance appears in the pill.
//   • Swipe LEFT past CANCEL_DX while holding → arms cancel; release to discard.
//
// On send (release below threshold, OR the locked send button):
//   - recorder.stop() → file URI
//   - Parent onSendVoice({ uri, durationSec }) is called. The parent
//     (ChatScreen) pushes the voice-note bubble into the messages list AND
//     sends the transcribed text through /api/chat.
//
// GESTURE / AUDIO-SESSION SEPARATION (important — keep it this way):
//   The gesture layer below is a thin UI shell over the EXISTING recorder. It
//   only ever calls startRecording / finalizeAndSend / cancelRecording — it
//   NEVER touches the audio session directly. All audio-session orchestration
//   stays inside startRecording (the ensureRecordingMode gate) and the stop
//   helpers. The playback→record handoff in utils/ttsStream.ts is delicate;
//   don't route gesture logic through it.
//
// Built with react-native-gesture-handler (Gesture.Pan + Gesture.Tap composed
// via Gesture.Exclusive) — mirrors the Gesture.Pan precedent in GuideAskModal.
// runOnJS hops the discrete transitions back to JS (React state + expo-audio)
// while the high-frequency drag tracking stays on the UI thread.
//
// ⚠️ The gesture + audio behavior CANNOT be validated by tsc/smoke — it
// REQUIRES a real-device test pass: press → swipe-up-lock → release-still-
// recording → stop-to-send, and swipe-left-cancel, each without disturbing
// recording/playback audio.

// Minimum hold duration in milliseconds. Anything shorter is dropped
// because Whisper consistently returns empty transcripts for sub-half-
// second clips (mic warmup + capture latency leave near-silence). Tuned
// up from 300ms after the empty-transcript bug — see [voice-note] logs.
const MIN_RECORDING_MS = 500;

// Trailing-audio safeguards — mirror the MapVoiceBar fix (commit
// 13b650b). On real devices the Pressable.onPressOut event can fire
// 0-200ms after the finger physically begins to lift, and on iOS
// expo-audio's stop() resolves before AVAudioRecorder finishes
// finalizing the M4A container. Both races chop the trailing
// syllable off voice notes — exact same symptom user reported in
// Map Voice, and the same symptom shows up in Partner-chat voice
// notes (which use this same ChatInput).
//
//   STOP_GRACE_MS — keep the mic open 250ms after release so any
//     trailing syllable lands in the recorder buffer.
//   POST_STOP_FLUSH_MS — wait 150ms after recorder.stop() resolves
//     before reading recorder.uri, letting iOS finalize the M4A
//     moov atom + flush the last AAC frames.
const STOP_GRACE_MS = 250;
const POST_STOP_FLUSH_MS = 150;

// Swipe-to-lock thresholds (WhatsApp-style hands-free recording), in px of
// finger travel from the press origin. Negative = up / left. Tuned
// conservatively — final values want a real-device pass (see header).
//   LOCK_DY   — drag UP past this to LOCK the recording hands-free, so the
//               finger can lift and the mic keeps capturing.
//   CANCEL_DX — drag LEFT past this to ARM cancel; releasing while armed
//               discards the take (sliding back inside the threshold disarms).
const LOCK_DY = -64;
const CANCEL_DX = -88;

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Animated,
  StyleSheet,
  Alert,
  Easing,
} from 'react-native';
import ReAnimated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
  runOnJS,
  interpolate,
  interpolateColor,
  Extrapolation,
  Easing as ReEasing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { colors, fonts, spacing } from '../constants/theme';
import { ensureRecordingMode } from '../utils/ttsStream';

export function ChatInput({
  disabled,
  onSend,
  onSendVoice,
  prefillText,
  onPrefillConsumed,
  streaming,
  onStop,
}: {
  disabled?: boolean;
  /** True while an assistant reply is streaming. Swaps the send/mic
   *  button for a STOP control (standard streaming-chat convention). */
  streaming?: boolean;
  /** Tapping STOP — aborts the in-flight stream and keeps the partial. */
  onStop?: () => void;
  onSend: (text: string) => void;
  /** Called when user releases a voice note hold without cancelling. The
   *  parent shows the voice-note bubble with a "Transcribing…" line, then
   *  transcribes the audio and runs the resulting text through /api/chat. */
  onSendVoice?: (opts: { uri: string; durationSec: number }) => void;
  /** Optional external prefill — when the parent sets this to a non-null
   *  string, ChatInput seeds its internal text state with that value
   *  exactly once (treating each new value as a fresh prefill), then
   *  fires onPrefillConsumed so the parent can clear its prop. Used by
   *  the Partner chat's Shared-feed chip flow. */
  prefillText?: string | null;
  onPrefillConsumed?: () => void;
}) {
  const [text, setText] = useState('');
  // Apply each non-null prefill exactly once. We compare against the
  // last-applied value so a parent that holds the prefill prop steady
  // across re-renders doesn't re-seed the input on every tick — only
  // when the value genuinely changes to a new non-null string.
  const lastPrefillRef = useRef<string | null>(null);
  useEffect(() => {
    if (prefillText == null) return;
    if (prefillText === lastPrefillRef.current) return;
    lastPrefillRef.current = prefillText;
    setText(prefillText);
    onPrefillConsumed?.();
  }, [prefillText, onPrefillConsumed]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // Direct ref to the TextInput. The previous version called focus()
  // on press to keep the keyboard up, but that ALSO opened the
  // keyboard from a closed state — pushing the UI up whenever the
  // user just wanted to record. We rely on the parent ScrollView's
  // keyboardShouldPersistTaps="handled" to preserve focus when the
  // user was already typing, and never open the keyboard from
  // closed. Ref kept for setNativeProps clear on send.
  const inputRef = useRef<TextInput | null>(null);
  // Short-tap tooltip — anchored above the mic at the bar level so its
  // natural one-line width isn't clipped by the 52px mic wrapper. Driven by
  // a Reanimated shared value: fades in over 150ms, holds 1.5s, fades out
  // over 300ms.
  const tapHintOpacity = useSharedValue(0);
  const tapHintHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapHintFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapHintStyle = useAnimatedStyle(() => ({ opacity: tapHintOpacity.value }));
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const startTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Swipe-to-lock state. `recording` stays the single source of truth for
  // "the recorder is capturing" — it covers BOTH the finger-held phase and the
  // hands-free locked phase. `locked` adds one bit: the finger has been
  // released and recording continues until the user taps send/cancel.
  const [locked, setLocked] = useState(false);
  // Mirror of `recording` for the unmount cleanup, which captures mount-time
  // closures and can't read live state. See the teardown effect below.
  const recordingRef = useRef(false);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  // Finger travel during a hold — written by the pan worklet on the UI thread,
  // read by the lock-affordance + cancel-hint animated styles. Negative dragY =
  // upward (toward lock); negative dragX = leftward (toward cancel).
  const dragY = useSharedValue(0);
  const dragX = useSharedValue(0);
  // Worklet-side once-guards so the lock/cancel transitions + haptics fire
  // exactly once per hold instead of every animation frame. 0 = not armed.
  const lockArmedSV = useSharedValue(0);
  const cancelArmedSV = useSharedValue(0);

  // Lock affordance (floats above the mic while holding): brightens, lifts, and
  // scales up as the finger rises toward LOCK_DY. p: 0 at rest → 1 at threshold.
  const lockAffordanceStyle = useAnimatedStyle(() => {
    const p = interpolate(dragY.value, [LOCK_DY, 0], [1, 0], Extrapolation.CLAMP);
    return {
      opacity: 0.45 + p * 0.55,
      transform: [{ translateY: -p * 10 }, { scale: 1 + p * 0.18 }],
    };
  });
  // "Slide to cancel" hint: follows the finger left and fades up as it nears
  // CANCEL_DX. p: 0 at rest → 1 at threshold.
  const cancelHintStyle = useAnimatedStyle(() => {
    const p = interpolate(dragX.value, [CANCEL_DX, 0], [1, 0], Extrapolation.CLAMP);
    return {
      opacity: 0.55 + p * 0.45,
      transform: [{ translateX: dragX.value * 0.35 }],
    };
  });
  // Hint text reddens as cancel arms (cream → recording-red).
  const cancelHintTextStyle = useAnimatedStyle(() => {
    const p = interpolate(dragX.value, [CANCEL_DX, 0], [1, 0], Extrapolation.CLAMP);
    return { color: interpolateColor(p, [0, 1], [colors.creamFaint, '#d4726a']) };
  });

  useEffect(() => () => {
    if (tapHintHoldTimer.current) clearTimeout(tapHintHoldTimer.current);
    if (tapHintFadeTimer.current) clearTimeout(tapHintFadeTimer.current);
    if (tickRef.current) clearInterval(tickRef.current);
    // FLAG #1 fix — a LOCKED recording outlives the finger, so if this
    // component unmounts mid-record (e.g. the user navigates away while a
    // locked note is running) nothing else would stop the recorder: the mic
    // would stay hot and the audio session wouldn't reset. Stop it on the way
    // out. Mirrors PartnerContributionInput's teardown. We read recordingRef
    // (not the `recording` state) because this cleanup captures mount-time
    // scope; `recorder` from useAudioRecorder is a stable instance.
    if (recordingRef.current) {
      recorder.stop().catch(() => {});
    }
  }, []);

  // Red pulse while recording.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!recording) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.2, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  const canSend = text.trim().length > 0 && !disabled && !recording;

  async function handleSend() {
    const t = text.trim();
    if (!t || disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // ROOT-CAUSE FIX for "input not clearing" reports:
    // The previous version called only setText(''). On iOS, when the
    // predictive/IME keyboard has a candidate in flight at send-time,
    // it re-fires onChangeText AFTER our state setter resolves —
    // restoring the typed text. Belt-and-braces clear:
    //   1. setNativeProps({ text: '' }) — wipes the underlying UITextView
    //      so the IME has nothing to rehydrate from.
    //   2. inputRef.current?.clear()   — public RN API doing the same.
    //   3. setText('')                 — keeps the controlled state in sync.
    // We also schedule a second clear on the next tick to defeat any
    // late onChangeText callback that fires after the send button's
    // press cycle ends.
    try { (inputRef.current as any)?.setNativeProps?.({ text: '' }); } catch {}
    try { inputRef.current?.clear(); } catch {}
    setText('');
    setTimeout(() => {
      try { (inputRef.current as any)?.setNativeProps?.({ text: '' }); } catch {}
      setText('');
    }, 0);
    onSend(t);
  }

  // ------------------------------------------------------------------------
  // Press-and-hold voice recording — uses onLongPress (fires after 150ms of
  // hold) so a quick tap can show the teaching tooltip without accidentally
  // triggering a recording.
  // ------------------------------------------------------------------------

  async function startRecording() {
    console.log(`[voice-note] startRecording — minRecordingMs=${MIN_RECORDING_MS} timestamp=${Date.now()}`);
    // No explicit focus() call — the parent ScrollView's
    // keyboardShouldPersistTaps="handled" preserves focus when the
    // user was already typing, and we explicitly do NOT want to OPEN
    // the keyboard if it was closed (which is what calling focus()
    // unconditionally caused).
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone off', 'Grant mic access in Settings to record voice notes.');
        return;
      }
      // Authoritative playback→record handoff. ensureRecordingMode hard-
      // stops any read-aloud, releases its audio player, and AWAITS the
      // switch to a record-capable audio category. Previously this was a
      // non-awaited cancelTTSStream() + a swallowed setAudioModeAsync, so
      // on the turn right after a spoken reply the category switch raced
      // the player teardown and capture began in playback mode → silent
      // recording → empty transcript (the "every other message" bug). If
      // the switch fails we ABORT rather than capture silence.
      const ready = await ensureRecordingMode();
      if (!ready) {
        console.warn('[voice-note] audio session not record-ready — aborting (refusing to record silence)');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Alert.alert('One sec', 'Audio is still finishing playback. Try the mic again in a moment.');
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setSeconds(0);
      startTimeRef.current = Date.now();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      tickRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setSeconds(s);
      }, 250);
    } catch (err) {
      console.warn('[mic] startRecording failed:', (err as Error).message);
      setRecording(false);
    }
  }

  function handleShortTap() {
    // Fires when the touch ends BEFORE the 150ms long-press timer. Fade
    // the tooltip in, hold 1.5s, then fade it out. Clears prior timers so
    // rapid taps cleanly restart the cycle.
    if (tapHintHoldTimer.current) clearTimeout(tapHintHoldTimer.current);
    if (tapHintFadeTimer.current) clearTimeout(tapHintFadeTimer.current);
    tapHintOpacity.value = withTiming(1, { duration: 150, easing: ReEasing.out(ReEasing.ease) });
    tapHintHoldTimer.current = setTimeout(() => {
      tapHintOpacity.value = withTiming(0, { duration: 300, easing: ReEasing.in(ReEasing.ease) });
    }, 1500);
  }

  // Stop the recorder and send the take. Shared by BOTH the press-release
  // path (finger lifts below the lock threshold) and the locked send button —
  // identical stop/flush/guard logic, so the trailing-audio + M4A-finalize
  // safeguards apply uniformly. This is the only place that reads recorder.uri.
  async function finalizeAndSend() {
    // If the recorder never started (a misfire, or startRecording aborted
    // because the audio session wasn't record-ready), there's nothing to
    // send — just make sure no locked UI is left stranded.
    if (!recording) { setLocked(false); return; }
    const stopTs = Date.now();
    const heldMs = stopTs - startTimeRef.current;
    const heldSec = Math.max(0.1, heldMs / 1000);
    console.log(`[voice-note] finalizeAndSend — stopTimestamp=${stopTs} heldMs=${heldMs} heldSec=${heldSec.toFixed(3)} threshold=${MIN_RECORDING_MS}ms`);
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    // Skip the grace + flush for micro-taps that would be discarded anyway.
    // Otherwise we'd burn 400ms waiting on audio we're not going to send.
    const willDiscard = heldMs < MIN_RECORDING_MS;
    // Trailing-audio fix: keep the mic open STOP_GRACE_MS more so any
    // syllable the user was finishing at the moment of release lands
    // in the recorder buffer. State stays "recording" visually during
    // this window — the pill keeps reading "Recording…" for an extra
    // 250ms but the user won't notice. See STOP_GRACE_MS docstring.
    if (!willDiscard) {
      await new Promise<void>((r) => setTimeout(r, STOP_GRACE_MS));
    }
    setRecording(false);
    setLocked(false);
    setSeconds(0);
    try {
      await recorder.stop();
      // Belt-and-braces flush: wait POST_STOP_FLUSH_MS so iOS finalizes
      // the M4A container before we read recorder.uri. Skip on micro-
      // tap discard since the file is being thrown away.
      if (!willDiscard) {
        await new Promise<void>((r) => setTimeout(r, POST_STOP_FLUSH_MS));
      }
      const uri = recorder.uri;
      const capturedMs = heldMs + (willDiscard ? 0 : STOP_GRACE_MS);
      console.log(`[voice-note] recorder.stop returned — uri=${uri ? uri.slice(-60) : '(null)'} capturedMs=${capturedMs}`);
      // Minimum-duration guard. Whisper returns empty transcripts for
      // sub-half-second clips (mic warmup + capture latency leaves
      // mostly silence). Show the user a quick "hold longer" alert
      // instead of silently dropping the audio so they understand why
      // the gesture didn't produce a message.
      if (!uri) {
        console.warn('[voice-note] recorder produced no uri — discarding');
        Haptics.selectionAsync().catch(() => {});
        return;
      }
      if (heldMs < MIN_RECORDING_MS) {
        console.warn(`[voice-note] recording too short (${heldMs}ms < ${MIN_RECORDING_MS}ms) — not sending to /api/transcribe`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Alert.alert(
          'Hold a bit longer',
          'Voice notes need at least half a second of audio to transcribe. Press and hold the mic, then release when you\'re done.',
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Parent shows the voice bubble + runs transcription asynchronously.
      onSendVoice?.({ uri, durationSec: heldSec });
    } catch (err) {
      console.warn('[voice-note] finalizeAndSend stop failed:', (err as Error).message);
    }
  }

  // Discard the in-progress take WITHOUT sending. Still stops the recorder so
  // the mic is released and the audio session resets cleanly (the same teardown
  // the send path relies on) — we just never call onSendVoice. No grace/flush
  // since we're throwing the audio away. Reachable via swipe-left-to-cancel
  // (finger held) or the trash affordance (locked).
  async function cancelRecording() {
    if (!recording) { setLocked(false); return; }
    console.log('[voice-note] cancelRecording — user discarded the take');
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setRecording(false);
    setLocked(false);
    setSeconds(0);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    try {
      await recorder.stop();
    } catch (err) {
      console.warn('[voice-note] cancelRecording stop failed:', (err as Error).message);
    }
  }

  // Called once per hold (from the pan worklet via runOnJS) when the finger
  // crosses the lock threshold → hands-free recording. Set unconditionally so
  // the locked UI never desyncs from the worklet's lockArmedSV guard; if the
  // recorder somehow isn't running, the send/cancel handlers reset it cleanly.
  function onLockCrossed() {
    setLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }

  // Called (from the pan worklet via runOnJS) when the cancel-arm state toggles
  // — a one-shot haptic on arm. The visual is driven by the shared values.
  function onCancelArm(armed: boolean) {
    if (armed) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  // ------------------------------------------------------------------------
  // Voice-note gesture — press-and-hold + swipe-to-lock / swipe-to-cancel.
  // A thin UI shell over the existing recorder (see header). The pan ACTIVATES
  // only after a 150ms long-press, so a quick tap can't start a recording; the
  // tap handles the teaching tooltip. Exclusive(pan, tap) gives the long-press
  // pan priority, with the tap firing only when the pan fails (a release before
  // 150ms). High-frequency drag tracking stays on the UI thread (shared values);
  // runOnJS hops the discrete transitions back to JS (state + expo-audio).
  // ------------------------------------------------------------------------
  const recordPan = Gesture.Pan()
    .activateAfterLongPress(150)
    .hitSlop(14)
    .onStart(() => {
      'worklet';
      dragY.value = 0;
      dragX.value = 0;
      lockArmedSV.value = 0;
      cancelArmedSV.value = 0;
      runOnJS(startRecording)();
    })
    .onUpdate((e) => {
      'worklet';
      dragY.value = e.translationY;
      dragX.value = e.translationX;
      // LOCK — dragged up past the threshold, dominantly vertical, nothing armed
      // yet. One-shot: arms + locks exactly once, then we stop evaluating.
      if (
        lockArmedSV.value === 0 &&
        cancelArmedSV.value === 0 &&
        e.translationY <= LOCK_DY &&
        -e.translationY > Math.abs(e.translationX)
      ) {
        lockArmedSV.value = 1;
        runOnJS(onLockCrossed)();
        return;
      }
      // CANCEL-ARM — dragged left past the threshold, dominantly horizontal.
      // Releasable: dragging back inside the threshold disarms (so the user can
      // abort a cancel by sliding back). Never arms once locked.
      if (lockArmedSV.value === 0) {
        const armed = e.translationX <= CANCEL_DX && -e.translationX > Math.abs(e.translationY);
        if (armed && cancelArmedSV.value === 0) {
          cancelArmedSV.value = 1;
          runOnJS(onCancelArm)(true);
        } else if (!armed && cancelArmedSV.value === 1) {
          cancelArmedSV.value = 0;
          runOnJS(onCancelArm)(false);
        }
      }
    })
    .onEnd(() => {
      'worklet';
      if (lockArmedSV.value === 1) {
        // Locked — recording continues hands-free; the locked controls take
        // over. Nothing to do on finger release.
        return;
      }
      if (cancelArmedSV.value === 1) {
        runOnJS(cancelRecording)();
        return;
      }
      // Plain release below both thresholds → send (the original behavior).
      runOnJS(finalizeAndSend)();
    })
    .onFinalize(() => {
      'worklet';
      // Settle the drag visuals. Lock state (if engaged) lives in React state,
      // not these shared values, so it persists past this reset.
      dragY.value = withTiming(0, { duration: 140 });
      dragX.value = withTiming(0, { duration: 140 });
    });

  // Quick tap → teaching tooltip. Only reached when the pan fails to activate
  // (release before the 150ms long-press), via Gesture.Exclusive below.
  const recordTap = Gesture.Tap()
    .hitSlop(14)
    .onStart(() => {
      'worklet';
      runOnJS(handleShortTap)();
    });

  const micGesture = Gesture.Exclusive(recordPan, recordTap);

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {/* TextInput is ALWAYS mounted — the recording pill is rendered
            as an absolute overlay on top of it instead of swapping
            the two views. Reason: swapping unmounts the TextInput,
            which dismisses the keyboard the user had open. With the
            input mounted-but-covered, the keyboard stays up so the
            user can switch back to typing without re-tapping the
            field. */}
        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            // Always editable. The recording overlay above visually
            // hides the input during a hold, but keeping editable=true
            // means iOS preserves focus → keyboard stays up.
            editable={!disabled}
            multiline
            // Placeholder is suppressed while recording — without this,
            // the "Share what feels true…" copy bled through the
            // recording pill (the overlay above is tinted-translucent
            // by design). The TextInput stays mounted so the keyboard
            // doesn't drop, but its visible text is fully masked by
            // the now-opaque overlay below.
            placeholder={recording ? '' : 'Share what feels true…'}
            placeholderTextColor={colors.creamFaint}
            style={styles.input}
            selectionColor={colors.amber}
            onSubmitEditing={handleSend}
          />
          {recording ? (
            // RECORDING PILL — overlay covering the TextInput.
            // pointerEvents='auto' so taps on the pill DON'T fall
            // through to the input below (the user can't accidentally
            // type while recording).
            <View style={styles.recordingOverlay} pointerEvents="auto">
              {locked ? (
                // Locked: trash discards the take (mirrors swipe-left-cancel).
                <Pressable
                  onPress={cancelRecording}
                  hitSlop={10}
                  style={styles.cancelTrash}
                  accessibilityLabel="Cancel and discard voice note"
                >
                  <Ionicons name="trash-outline" size={18} color="#d4726a" />
                </Pressable>
              ) : null}
              <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulse }] }]} />
              <Text style={styles.recordingLabel}>Recording…</Text>
              {locked ? (
                // Spacer so the timer right-aligns when no cancel hint is shown.
                <View style={{ flex: 1 }} />
              ) : (
                // Holding: "‹ Slide to cancel" — follows the finger left and
                // reddens as it nears the cancel threshold (driven by dragX).
                <ReAnimated.View style={[styles.cancelHint, cancelHintStyle]} pointerEvents="none">
                  <Ionicons name="chevron-back" size={14} color={colors.creamFaint} />
                  <ReAnimated.Text style={[styles.cancelHintText, cancelHintTextStyle]}>
                    Slide to cancel
                  </ReAnimated.Text>
                </ReAnimated.View>
              )}
              <Text style={styles.recordingTime}>{formatSecs(seconds)}</Text>
            </View>
          ) : null}
        </View>

        {streaming ? (
          // STOP — while a reply streams, the action button halts it.
          // Tapping aborts the in-flight stream; the partial reply so far
          // stays in the conversation (handled by the parent).
          <Pressable onPress={onStop} style={[styles.btn, styles.stopBtn]} accessibilityLabel="Stop response">
            <Ionicons name="stop" size={18} color={colors.background} />
          </Pressable>
        ) : locked ? (
          // LOCKED — hands-free recording; the mic hold is over. This button
          // stops + sends. Cancel lives in the pill's trash affordance.
          <Pressable onPress={finalizeAndSend} style={[styles.btn, styles.sendBtn]} accessibilityLabel="Stop and send voice note">
            <Ionicons name="arrow-up" size={20} color={colors.background} />
          </Pressable>
        ) : canSend ? (
          <Pressable onPress={handleSend} style={[styles.btn, styles.sendBtn]} accessibilityLabel="Send">
            <Ionicons name="arrow-up" size={20} color={colors.background} />
          </Pressable>
        ) : (
          // idle / holding — press-and-hold to record, swipe up to lock, left to
          // cancel. GestureDetector replaces the old Pressable so the pan can
          // track finger movement during the hold (Pressable cannot). hitSlop
          // lives on the gestures; the 52px wrapper keeps the visible target big.
          <GestureDetector gesture={micGesture}>
            <View
              style={styles.micPressable}
              accessible
              accessibilityRole="button"
              accessibilityLabel={recording
                ? 'Recording. Release to send, swipe up to lock, or swipe left to cancel.'
                : 'Hold to record voice note'}
            >
              <View style={[styles.btn, styles.micBtn, recording && styles.micRecording]}>
                <Ionicons
                  name="mic"
                  size={20}
                  color={recording ? '#fff' : colors.amber}
                />
              </View>
            </View>
          </GestureDetector>
        )}

        {/* "Hold to record" tooltip — lives at the bar level so it can
            extend beyond the 52px mic wrapper's bounds. Anchored above the
            mic button with a small pointer arrow. pointerEvents="none" so
            it never steals a subsequent hold. Rendered unconditionally and
            driven by the Reanimated opacity — this avoids a mount/unmount
            flash when the user double-taps. */}
        <ReAnimated.View
          pointerEvents="none"
          style={[styles.tapHint, tapHintStyle]}
        >
          <Text
            numberOfLines={1}
            allowFontScaling={false}
            style={styles.tapHintText}
          >
            Hold to record
          </Text>
          <View style={styles.tapHintArrow} />
        </ReAnimated.View>

        {/* Lock affordance — floats above the mic while holding (not yet
            locked). Slide the finger up to it to lock hands-free recording;
            it brightens, lifts, and scales as the finger rises (driven by
            dragY). pointerEvents="none" so it never intercepts the ongoing
            pan. Disappears the moment recording locks or ends. */}
        {recording && !locked ? (
          <ReAnimated.View pointerEvents="none" style={[styles.lockAffordance, lockAffordanceStyle]}>
            <Ionicons name="lock-closed" size={15} color={colors.cream} />
            <Ionicons name="chevron-up" size={13} color={colors.creamFaint} style={{ marginTop: 1 }} />
          </ReAnimated.View>
        ) : null}
      </View>
    </View>
  );
}

function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: spacing.sm,
  },
  inputWrap: {
    // Container for the TextInput + the recording overlay. Flex so it
    // expands to fill the bar between the leading area and the trailing
    // mic/send button; relative-positioned so the overlay can sit on
    // top of the input without affecting layout.
    flex: 1,
    position: 'relative',
  },
  recordingOverlay: {
    // Sits exactly over the TextInput. Mutually exclusive with the
    // input visually — when recording is true, ONLY this pill is
    // shown to the user. Background is opaque (was rgba alpha 0.18,
    // which let the TextInput's placeholder bleed through). The
    // borderRadius matches the input's 24 so the overlay covers it
    // edge-to-edge with no peeking input corners.
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(70,28,28,0.96)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(212,114,106,0.7)',
  },
  input: {
    // Fills the inputWrap so the TextInput's tappable area stays full-
    // width whether or not the recording overlay is on top.
    flex: 1,
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.2)',
  },

  // The mic Pressable itself — 48×48 minimum tap area, larger than the
  // visible circle so presses near the edge still register.
  micPressable: {
    width: 52, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: { backgroundColor: colors.amber, width: 44, height: 44 },
  // Stop control — same amber affordance as send so it reads as the
  // primary action, with a square "stop" glyph (ChatGPT/Claude convention).
  stopBtn: { backgroundColor: colors.amber, width: 44, height: 44 },
  micBtn: {
    borderWidth: 1,
    borderColor: colors.amberDim,
    backgroundColor: 'transparent',
  },
  micRecording: {
    backgroundColor: '#d4726a',
    borderColor: '#d4726a',
    shadowColor: '#d4726a',
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },

  recordingDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#d4726a',
    shadowColor: '#d4726a', shadowOpacity: 0.7, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
  },
  recordingLabel: {
    color: '#d4726a',
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  recordingTime: {
    color: colors.cream,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    minWidth: 36,
  },

  // Trash affordance inside the LOCKED recording pill — discards the take.
  cancelTrash: {
    paddingVertical: 2,
    paddingHorizontal: 2,
    marginRight: 2,
  },
  // "‹ Slide to cancel" hint shown WHILE HOLDING (pre-lock). flex:1 so it
  // centers between the "Recording…" label and the right-aligned timer.
  cancelHint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  cancelHintText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.2,
    // color is supplied by cancelHintTextStyle (animated cream → recording-red)
  },
  // Lock affordance floating above the mic during a hold. Anchored like the
  // tapHint (right edge over the mic) but higher, so the finger slides up to
  // it; the ~64px lift toward LOCK_DY lands the fingertip right around here.
  lockAffordance: {
    position: 'absolute',
    bottom: 82,
    right: 24,
    zIndex: 11,
    alignItems: 'center',
    gap: 1,
    paddingVertical: 8,
    paddingHorizontal: 9,
    backgroundColor: 'rgba(70,28,28,0.92)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(212,114,106,0.6)',
    shadowColor: '#d4726a', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },

  // Short-tap tooltip — rendered at the bar level so its natural content
  // width isn't constrained by the 52px mic wrapper. Anchored above the
  // mic with a small gap; a downward arrow points at the mic.
  tapHint: {
    position: 'absolute',
    // Sits above the 44px mic button + the bar's 14px vertical padding.
    // bottom:60 clears the mic visibly with ~16px breathing room.
    bottom: 60,
    // The mic Pressable (52×52) is at the right edge of the bar with
    // spacing.md (16px) of right padding. Aligning the tooltip's right
    // edge with the mic wrapper's right edge (right:16) + an arrow at
    // right:26 on the tooltip puts the arrow tip directly below the mic
    // circle's center (16 + 26 = 42 ≈ circle center).
    right: 16,
    zIndex: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(20,20,30,0.95)',
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.3)',
    borderRadius: 10,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  tapHintText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: '#F0EDE8',
    letterSpacing: 0.2,
  },
  // Small 10px diamond rotated 45° hugs the bottom edge of the tooltip and
  // points down at the mic. Only the bottom-right two borders are painted
  // so the top two edges merge cleanly into the tooltip body.
  tapHintArrow: {
    position: 'absolute',
    bottom: -5,
    right: 26,             // see tapHint.right math — lands over mic center
    width: 10,
    height: 10,
    backgroundColor: 'rgba(20,20,30,0.95)',
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.3)',
    transform: [{ rotate: '45deg' }],
  },
});
