// Journal entry modal — used for both Free Flow ('freeflow') and
// Reflection ('deepdive') kinds. Differences are entirely cosmetic
// (header, guidance text, and a Free-Flow-only line shown above the
// recording indicator). Same writing surface, same voice-note flow.
//
// Voice note flow specifically diverges from the Chat tab:
//   - We DO NOT keep the audio bubble. The recording is transcribed via
//     /api/transcribe and the resulting text is APPENDED to the text
//     area. The audio file itself is never persisted — only the
//     transcript becomes part of the entry. This keeps journal entries
//     plain text and lets users speak their free-association directly
//     into the entry without a managers-mediated typing pause.
//   - On release, briefly show a "Transcribing…" indicator before the
//     transcript appears in the text area.
//
// Guidance collapse: once the user starts typing OR finishes a voice
// transcription, the guidance text fades to 20% opacity over 500ms.
// Tapping the (now dim) guidance restores it to full opacity. First
// open of the modal always starts at full opacity.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, StyleSheet,
  Platform, ScrollView, Animated, Easing, Keyboard,
  GestureResponderEvent, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from '../../utils/useKeyboardInset';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync,
} from 'expo-audio';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import ReAnimated, {
  useSharedValue, useAnimatedStyle, runOnJS, withTiming, interpolate, Extrapolation,
} from 'react-native-reanimated';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';
import { JournalKind, getJournalShareDefault } from '../../services/journal';
import { useRecorderWatch } from '../../utils/recorderWatch';
import { useRecordingWakeLock, WAKE_TAG } from '../../utils/recordingWakeLock';
import { ensureRecordingMode } from '../../utils/ttsStream';

const FREE_FLOW_GUIDANCE = [
  'This works best when you bypass your inner editor entirely — the part of you that shapes what you say before you say it.',
  "Start writing and don't stop. Don't correct, don't reread, don't make it make sense. If you don't know what to write, write that — until something else comes.",
  "What surfaces when the filter is off is often closer to what's actually there. Writing this way can release energy that's been held — and helps your map reflect what's really underneath, not just what feels safe to say.",
  'Ready? Just start.',
];

const REFLECTION_GUIDANCE = [
  "A space to capture something with intention. Something you've been sitting with, something that shifted, something you want to remember.",
  'Write as much or as little as feels right.',
];

// Free-Flow-only encouragement shown above the recording indicator while
// the mic is held. Reads as a soft permission to let the words come
// without judgment — only relevant when the user has chosen the
// bypass-the-editor mode.
const FREE_FLOW_RECORD_PROMPT =
  "Close your eyes. Just let the words come — don't worry if it makes sense.";

// Swipe-up-to-lock threshold (px of upward finger travel) for the journal
// voice note — hands-free once the finger rises past this. Tune on device.
const LOCK_DY = -64;

type Props = {
  visible: boolean;
  kind: JournalKind;
  onClose: () => void;
  onSave: (content: string, shared: boolean) => Promise<void> | void;
};

export function JournalEntryModal({ visible, kind, onClose, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  // Screen-sleep lock — held for exactly as long as the take is live, so
  // auto-lock cannot pause the recorder underneath us. Release is structural
  // (see utils/recordingWakeLock.ts): every stop path and every unmount.
  useRecordingWakeLock(recording, WAKE_TAG.journal);

  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  // Share flag — now a save-time SNAPSHOT of the global default (Settings →
  // "Share journal with AI"), seeded on open below. The in-compose per-entry
  // toggle was removed in favour of the single global setting. true → synced
  // to the server for RAG; false → stays on-device, never sent.
  const [shared, setShared] = useState(true);
  // Build 14 — manual kbHeight lift, replacing the prior
  // KeyboardAvoidingView with behavior:'height' on Android (which
  // is the known-unreliable pattern that left inputs hidden behind
  // the keyboard in main chat, Partner chat, etc. before each was
  // ported to this pattern). Inside this Modal, paddingBottom on
  // the root SafeAreaView lifts the entire ScrollView+input+mic
  // stack above the keyboard on both iOS and Android.
  // Centralized in utils/useKeyboardInset. insideModal:true → manual lift
  // on both platforms (an RN Modal window doesn't inherit the activity's
  // softwareKeyboardLayoutMode:'resize').
  const kbHeight = useKeyboardInset({ insideModal: true });
  // Guidance opacity — collapses to 0.2 once the user has started typing
  // or recorded a voice note. Tapping the guidance restores to 1.0.
  const guidanceOpacity = useRef(new Animated.Value(1)).current;
  const [guidanceCollapsed, setGuidanceCollapsed] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const startTimeRef = useRef<number>(0);
  // Red-dot pulse during recording.
  const pulse = useRef(new Animated.Value(1)).current;

  // --- Swipe-up-to-lock (hands-free) ---
  // `recording` covers both the held and the locked phases; `locked` adds:
  // the finger has lifted and recording continues until the finish button.
  const [locked, setLocked] = useState(false);

  // ---- Native-truth reconciliation (iOS truncation fix, July 2026) ----
  // `interrupted` = the native recorder stopped/paused and it wasn't us
  // (screen lock, backgrounding, call/Siri with failed auto-resume, encode
  // error). The UI switches to a visible PAUSED state the user resolves —
  // Resume (appends to the same file) or finish (keeps what's captured).
  // capturedMsRef holds the recorder's own durationMillis — the timer and
  // the transcribe duration come from THIS, never from wall clock, so the
  // display freezes exactly when capture freezes. The watch itself is
  // wired below via useRecorderWatch (utils/recorderWatch.ts).
  const [interrupted, setInterrupted] = useState(false);
  const interruptedRef = useRef(false);
  const stoppingRef = useRef(false);
  const capturedMsRef = useRef(0);
  const [gapNote, setGapNote] = useState<number | null>(null);
  const gapNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `recording` for the teardown effects (which capture mount-time
  // scope and can't read live state).
  const recordingRef = useRef(false);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  // Finger travel during a hold — written by the pan worklet, read by the
  // lock-affordance animated style. Negative = upward (toward lock).
  const dragY = useSharedValue(0);
  const lockArmedSV = useSharedValue(0);
  const lockAffordanceStyle = useAnimatedStyle(() => {
    const p = interpolate(dragY.value, [LOCK_DY, 0], [1, 0], Extrapolation.CLAMP);
    return {
      opacity: 0.5 + p * 0.5,
      transform: [{ translateY: -p * 8 }, { scale: 1 + p * 0.16 }],
    };
  });

  // Reset state every time the modal becomes visible. We don't carry text
  // across opens — each entry is its own thing.
  useEffect(() => {
    if (!visible) {
      // FLAG #3 — modal closing. A LOCKED recording outlives the finger, so if
      // the user closes (X / back / save) while locked, stop the recorder
      // WITHOUT transcribing so the mic is released and the audio session
      // resets. (A held, non-locked recording can't reach here — the finger is
      // still on the mic.)
      if (recordingRef.current) {
        stoppingRef.current = true;
        recorder.stop().catch(() => {});
        setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        }).catch(() => {});
        recordingRef.current = false;
        interruptedRef.current = false;
        setRecording(false);
        setLocked(false);
        setInterrupted(false);
        setGapNote(null);
        setTranscribing(false);
      }
      return;
    }
    setText('');
    setRecording(false);
    setLocked(false);
    setTranscribing(false);
    setSeconds(0);
    setSaving(false);
    // Seed the share flag from the global default (Settings → "Share journal
    // with AI"); no per-entry toggle — this is the save-time snapshot.
    getJournalShareDefault().then(setShared).catch(() => setShared(true));
    setGuidanceCollapsed(false);
    guidanceOpacity.setValue(1);
  }, [visible, guidanceOpacity, recorder]);

  // Cleanup if the modal closes mid-recording. (The recorder watch's poll
  // clears itself via its own effect cleanup; the gap-note timer here.)
  useEffect(() => () => {
    if (gapNoteTimer.current) clearTimeout(gapNoteTimer.current);
    // Do NOT call recorder.stop() here. useAudioRecorder wraps the recorder in
    // expo's useReleasingSharedObject, which already calls recorder.release()
    // on unmount (its effect runs before this one), freeing the native recorder
    // + the mic. Calling recorder.stop() afterwards hits the released
    // SharedObject and throws "Unable to find the native shared object"
    // (Sentry, 1.1.0+27). We still reset the audio-session mode below —
    // setAudioModeAsync is a module function (not a recorder method), so it's
    // unaffected by the release — to hand the session back to playback.
    if (recordingRef.current) {
      setAudioModeAsync({
        allowsRecording: false, playsInSilentMode: true,
        interruptionMode: 'doNotMix', shouldPlayInBackground: false,
      }).catch(() => {});
    }
  }, []);

  // Pulse the red recording dot — static while interrupted (nothing is
  // being captured; a pulsing dot would be the exact lie we're fixing).
  useEffect(() => {
    if (!recording || interrupted) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.2, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, interrupted, pulse]);

  function collapseGuidance() {
    if (guidanceCollapsed) return;
    setGuidanceCollapsed(true);
    Animated.timing(guidanceOpacity, {
      toValue: 0.2, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: true,
    }).start();
  }
  function restoreGuidance() {
    if (!guidanceCollapsed) return;
    setGuidanceCollapsed(false);
    Animated.timing(guidanceOpacity, {
      toValue: 1, duration: 250, easing: Easing.out(Easing.ease), useNativeDriver: true,
    }).start();
  }

  function handleChangeText(next: string) {
    setText(next);
    if (next.length > 0) collapseGuidance();
  }

  // ---- Start/stop race guards — same fix as ChatInput's voice note ----
  // (the "zombie recording": a short hold could fully release inside
  // startRecording's awaits; endRecording then bailed on stale state and
  // the recorder started anyway, capturing with no way to stop.)
  // recordingRef itself is declared near the top of the component (effect-
  // synced from state for the close/unmount guards); the paths below ALSO
  // write it synchronously at each transition so stop paths read truth,
  // not a stale render.
  const holdActiveRef = useRef(false);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);

  function markInterrupted(reason: string) {
    if (interruptedRef.current) return;
    console.warn(`[journal-mic] native recorder stopped without our stop (${reason}) — surfacing paused state`);
    interruptedRef.current = true;
    setInterrupted(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }

  useRecorderWatch(recorder, {
    active: recording,
    stoppingRef,
    startTimeRef,
    interruptedRef,
    onCapturedMs: (ms) => {
      capturedMsRef.current = ms;
      setSeconds(Math.floor(ms / 1000));
    },
    onInterrupted: () => markInterrupted('poll saw isRecording=false'),
    onEncodeError: (msg) => markInterrupted(`encode error: ${msg || '(none)'}`),
    onAutoResumed: (gapSec) => {
      // The library's own auto-resume brought capture back (foreground
      // return / interruption ended). Clear the paused state but SHOW the
      // gap — audio from that window is gone and the user should know.
      interruptedRef.current = false;
      setInterrupted(false);
      setGapNote(gapSec);
      if (gapNoteTimer.current) clearTimeout(gapNoteTimer.current);
      gapNoteTimer.current = setTimeout(() => setGapNote(null), 6000);
    },
  });

  // User-initiated resume from the visible paused state — continues
  // appending to the same file (expo-audio's pause keeps it open).
  function resumeRecording() {
    try {
      recorder.record();
      const st = recorder.getStatus();
      if (st.isRecording) {
        interruptedRef.current = false;
        setInterrupted(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      } else {
        Alert.alert("Can't resume", "The microphone isn't available right now. You can keep what's recorded so far — tap the check to use it.");
      }
    } catch (err) {
      console.warn('[journal-mic] resume failed:', (err as Error).message);
      Alert.alert("Can't resume", "The microphone isn't available right now. You can keep what's recorded so far — tap the check to use it.");
    }
  }

  async function startRecording() {
    holdActiveRef.current = true;
    const run = (async (): Promise<boolean> => {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Microphone off', 'Grant mic access in Settings to record voice notes.');
          return false;
        }
        if (!holdActiveRef.current) {
          console.log('[journal-mic] hold ended during permission prompt — aborting start');
          return false;
        }
        // AUTHORITATIVE PLAYBACK->RECORD HANDOFF (founder ruling 2026-08-28).
        // Was a bare setAudioModeAsync in a swallowed try. That is the exact
        // shape that produced the "every other message" silent-capture bug in
        // chat: a plain set does not tear down a live player, does not retry,
        // and returns nothing to check, so capture could begin while the
        // session was still parked in playback mode (allowsRecording:false)
        // and record silence. ChatInput was hardened in June; these four were
        // not. Map Voice PARKS the session for its own TTS replies, so
        // Map Voice -> here crossed that boundary unprotected.
        const sessionReady = await ensureRecordingMode();
        if (!sessionReady) {
          console.warn('[journal-mic] audio session not record-ready — aborting (refusing to record silence)');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          Alert.alert('One sec', 'Audio is still finishing playback. Try the mic again in a moment.');
          return false;
        }
        if (!holdActiveRef.current) {
          console.log('[journal-mic] hold ended during audio-session switch — aborting start');
          return false;
        }
        await recorder.prepareToRecordAsync();
        if (!holdActiveRef.current) {
          console.log('[journal-mic] hold ended during prepare — aborting start');
          return false;
        }
        recorder.record();
        recordingRef.current = true;
        setRecording(true);
        setSeconds(0);
        // Fresh take — reset the reconciliation state. The timer is driven
        // by the recorder watch (native durationMillis), not wall clock.
        capturedMsRef.current = 0;
        interruptedRef.current = false;
        stoppingRef.current = false;
        setInterrupted(false);
        setGapNote(null);
        startTimeRef.current = Date.now();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        return true;
      } catch (err) {
        console.warn('[journal-mic] startRecording failed:', (err as Error).message);
        recordingRef.current = false;
        setRecording(false);
        return false;
      }
    })();
    startPromiseRef.current = run;
    try {
      await run;
    } finally {
      if (startPromiseRef.current === run) startPromiseRef.current = null;
    }
  }

  async function endRecording() {
    // Claim the hold, then settle any in-flight start (see race guards above).
    holdActiveRef.current = false;
    if (startPromiseRef.current) { try { await startPromiseRef.current; } catch {} }
    if (!recordingRef.current) { setLocked(false); return; }
    // Suppress the recorder watch while OUR stop runs, and use the
    // recorder's own captured duration — never wall clock, which keeps
    // climbing across an interruption while the file does not.
    stoppingRef.current = true;
    const capturedSec = capturedMsRef.current > 0
      ? capturedMsRef.current / 1000
      : (Date.now() - startTimeRef.current) / 1000; // fallback: watch never ticked
    const heldSec = Math.max(0.1, capturedSec);
    recordingRef.current = false;
    interruptedRef.current = false;
    setInterrupted(false);
    setGapNote(null);
    setRecording(false);
    setLocked(false);
    setSeconds(0);
    setTranscribing(true);
    try {
      await recorder.stop();
      // Reset audio session back to playback mode in case other components
      // need to play TTS afterwards.
      try {
        await setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        });
      } catch {}
      const uri = recorder.uri;
      if (!uri || heldSec < 0.3) {
        setTranscribing(false);
        return;
      }
      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      const transcript = await api.transcribe(uri, mime, heldSec);
      const cleaned = (transcript || '').trim();
      setTranscribing(false);
      if (!cleaned) return;
      // Append to existing text — separator is a blank line if there's
      // already content, so the user can clearly see where the spoken
      // part picked up.
      setText((prev) => {
        const next = prev.trim().length === 0 ? cleaned : prev + '\n\n' + cleaned;
        return next;
      });
      collapseGuidance();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      console.warn('[journal-mic] endRecording failed:', (err as Error).message);
      setTranscribing(false);
    }
  }

  async function handleSave() {
    const t = text.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await onSave(t, shared);
    } finally {
      setSaving(false);
    }
  }

  const isFreeFlow = kind === 'freeflow';
  const headerLabel = isFreeFlow ? 'Free Flow' : 'Reflection';
  const guidance = isFreeFlow ? FREE_FLOW_GUIDANCE : REFLECTION_GUIDANCE;
  const placeholder = isFreeFlow
    ? 'Just start writing…'
    : 'Take your time…';

  function micHaptic() {
    Haptics.selectionAsync().catch(() => {});
  }
  // Called once per hold (from the pan worklet) when the finger crosses the
  // lock threshold → hands-free recording.
  function onLockCrossed() {
    setLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }

  // Hold-to-record + swipe-up-to-lock (NO cancel). The pan activates only after
  // a 250ms long-press, so a quick tap stays a no-op. This is a thin shell over
  // startRecording/endRecording — it adds NO audio-session calls (those stay
  // inside those two functions). Mirrors the chat gesture (ChatInput) minus the
  // swipe-left-cancel axis.
  //
  // MEMOIZATION IS LOAD-BEARING (Android): the gesture is created once and
  // calls stable trampolines that read the latest handlers through a ref.
  // The previous unmemoized version was reattached by GestureDetector on
  // every render (the seconds ticker re-renders 4×/s during a hold) — on
  // Android that cancels the in-flight pan, killing release-to-stop and
  // swipe-to-lock. Same fix as ChatInput.
  const micHandlersRef = useRef({ micHaptic, startRecording, endRecording, onLockCrossed });
  micHandlersRef.current = { micHaptic, startRecording, endRecording, onLockCrossed };
  const callMicHaptic = useCallback(() => { micHandlersRef.current.micHaptic(); }, []);
  const callStartRecording = useCallback(() => { micHandlersRef.current.startRecording(); }, []);
  const callEndRecording = useCallback(() => { micHandlersRef.current.endRecording(); }, []);
  const callLockCrossed = useCallback(() => { micHandlersRef.current.onLockCrossed(); }, []);

  const micPan = useMemo(() => Gesture.Pan()
    .activateAfterLongPress(250)
    .hitSlop(12)
    .onBegin(() => {
      'worklet';
      dragY.value = 0;
      lockArmedSV.value = 0;
      runOnJS(callMicHaptic)();
    })
    .onStart(() => {
      'worklet';
      runOnJS(callStartRecording)();
    })
    .onUpdate((e) => {
      'worklet';
      dragY.value = e.translationY;
      // Lock once the finger rises past the threshold (one-shot guard).
      if (lockArmedSV.value === 0 && e.translationY <= LOCK_DY) {
        lockArmedSV.value = 1;
        runOnJS(callLockCrossed)();
      }
    })
    .onEnd(() => {
      'worklet';
      // Locked → recording continues; the dock's finish button stops it.
      if (lockArmedSV.value === 1) return;
      // Plain release → stop + transcribe (the original behavior).
      runOnJS(callEndRecording)();
    })
    .onFinalize(() => {
      'worklet';
      dragY.value = withTiming(0, { duration: 140 });
    }),
  [dragY, lockArmedSV, callMicHaptic, callStartRecording, callEndRecording, callLockCrossed]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* GestureHandlerRootView is REQUIRED here: an RN Modal renders in a
          separate native window outside the app's root GestureHandlerRootView,
          so a bare GestureDetector wouldn't receive events. Mirrors GuideAskModal. */}
      <GestureHandlerRootView style={styles.flex}>
      <SafeAreaView style={styles.root} edges={['bottom']}>
        {/* Manual kbHeight lift — see useEffect at the top of this
            component. Replaces KeyboardAvoidingView, which on Android
            (behavior:'height') was the known-unreliable pattern. */}
        <View style={[styles.flex, { paddingBottom: kbHeight }]}>
          {/* Top bar — close (X) on the left, Save on the right. */}
          <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
            <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.creamDim} />
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={!text.trim() || saving}
              hitSlop={10}
              style={[styles.saveBtn, (!text.trim() || saving) && styles.saveBtnDisabled]}
              accessibilityLabel="Save entry"
            >
              <Text style={[styles.saveBtnText, (!text.trim() || saving) && styles.saveBtnTextDisabled]}>
                {saving ? 'SAVING…' : 'SAVE'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.header}>{headerLabel}</Text>

            {/* Guidance — fades to 0.2 once the user starts writing /
                recording. Tapping it restores full opacity so they can
                reread. Wrapped in Pressable so the entire block is
                tappable, not just the small lit area. */}
            <Pressable onPress={restoreGuidance}>
              <Animated.View style={[styles.guidanceWrap, { opacity: guidanceOpacity }]}>
                {guidance.map((line, i) => (
                  <Text key={i} style={styles.guidanceLine}>{line}</Text>
                ))}
              </Animated.View>
            </Pressable>

            <TextInput
              value={text}
              onChangeText={handleChangeText}
              multiline
              placeholder={placeholder}
              placeholderTextColor={colors.creamFaint}
              style={styles.input}
              selectionColor={colors.amber}
              textAlignVertical="top"
              autoFocus={!recording}
            />
          </ScrollView>

          {/* Recording / transcribing overlay-style row above the mic. */}
          {(recording || transcribing) ? (
            <View style={styles.recordingBar}>
              {/* Free-Flow-only encouragement — shown only while actually
                  recording, not during transcription. */}
              {isFreeFlow && recording ? (
                <Text style={styles.freeFlowRecordPrompt}>
                  {FREE_FLOW_RECORD_PROMPT}
                </Text>
              ) : null}
              {recording && interrupted ? (
                // PAUSED — the native recorder stopped underneath us (lock/
                // background/call). Never show a live recording over a dead
                // session: frozen captured time + explicit user resolution.
                <View style={styles.recordingRow}>
                  <View style={styles.pausedDot} />
                  <Text style={styles.recordingText}>Paused — {formatSecs(seconds)} captured</Text>
                  <Pressable onPress={resumeRecording} hitSlop={8} style={styles.resumeBtn} accessibilityLabel="Resume recording">
                    <Text style={styles.resumeBtnText}>Resume</Text>
                  </Pressable>
                  <Pressable onPress={endRecording} hitSlop={8} style={styles.useCapturedBtn} accessibilityLabel="Use what was captured">
                    <Text style={styles.useCapturedBtnText}>Use it</Text>
                  </Pressable>
                </View>
              ) : recording ? (
                <View style={styles.recordingRow}>
                  <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulse }] }]} />
                  <Text style={styles.recordingText}>
                    {gapNote ? `Resumed — ~${gapNote}s missed while paused` : 'Recording…'}
                  </Text>
                  <Text style={styles.recordingTime}>{formatSecs(seconds)}</Text>
                </View>
              ) : (
                <View style={styles.recordingRow}>
                  <ActivityIndicator color={colors.amber} size="small" />
                  <Text style={styles.recordingText}>Transcribing…</Text>
                </View>
              )}
            </View>
          ) : null}

          {/* Mic dock — bottom-right. Hold to record; swipe up to lock hands-
              free; release (below the lock) to transcribe. Locked → the mic
              becomes a finish button. (No swipe-to-cancel in the journal.) */}
          <View style={styles.micDock}>
            <Text style={styles.micLabel}>{locked || interrupted ? 'Tap to finish' : 'Or speak'}</Text>
            {/* Lock affordance — floats above the mic while holding (pre-lock),
                brightening + lifting as the finger rises toward the lock. */}
            {recording && !locked ? (
              <ReAnimated.View pointerEvents="none" style={[styles.lockAffordance, lockAffordanceStyle]}>
                <Ionicons name="lock-closed" size={14} color={colors.cream} />
                <Ionicons name="chevron-up" size={12} color={colors.creamFaint} style={{ marginTop: 1 }} />
              </ReAnimated.View>
            ) : null}
            {locked || interrupted ? (
              // LOCKED (hands-free) or PAUSED-BY-INTERRUPTION — the finish
              // button stops + transcribes what's captured. While interrupted
              // the mic gesture is disabled so a new hold can't double-start
              // over a paused recorder; Resume lives in the bar above.
              <Pressable
                onPress={endRecording}
                hitSlop={12}
                style={[styles.micBtn, styles.micBtnSend]}
                accessibilityLabel="Stop and add voice note"
              >
                <Ionicons name="checkmark" size={26} color={colors.background} />
              </Pressable>
            ) : (
              // idle / holding — press-and-hold to record, swipe up to lock.
              <GestureDetector gesture={micPan}>
                <View
                  style={[styles.micBtn, recording && styles.micBtnActive]}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={recording
                    ? 'Recording. Release to add, or swipe up to lock hands-free.'
                    : 'Hold to record voice note'}
                >
                  <Ionicons
                    name="mic"
                    size={22}
                    color={recording ? '#fff' : colors.amber}
                  />
                </View>
              </GestureDetector>
            )}
          </View>
        </View>
      </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.55)',
  },
  saveBtnDisabled: { borderColor: 'rgba(230,180,122,0.18)' },
  saveBtnText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.6,
  },
  saveBtnTextDisabled: { color: 'rgba(230,180,122,0.35)' },

  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl + 60,    // clearance for the mic dock
  },

  header: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 32,
    letterSpacing: 0.4,
    marginBottom: spacing.md,
  },

  guidanceWrap: {
    marginBottom: spacing.lg,
    gap: 10,
  },
  guidanceLine: {
    // DM Sans 14px italic per spec — no sansItalic family in theme so we
    // rely on the runtime italic style attribute.
    color: 'rgba(240,237,232,0.55)',
    fontFamily: fonts.sans,
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 24,
    letterSpacing: 0.2,
  },

  input: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 26,
    minHeight: 200,
    padding: 0,
  },

  // Recording / transcribing bar — sits above the mic dock.
  recordingBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordingDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#E0625C',
  },
  recordingText: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  recordingTime: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    marginLeft: 'auto',
  },
  // Interruption-paused state (recorder stopped underneath us).
  pausedDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.creamFaint,
  },
  resumeBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.amber,
  },
  resumeBtnText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 12,
  },
  useCapturedBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1, borderColor: colors.creamFaint,
  },
  useCapturedBtnText: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 12,
  },
  // Free-Flow-only encouragement above the dot/timer row.
  freeFlowRecordPrompt: {
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 14,
    color: 'rgba(240,237,232,0.5)',
    textAlign: 'center',
    marginBottom: 12,
  },

  micDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  micLabel: {
    color: 'rgba(240,237,232,0.45)',
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  micBtn: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(20,19,26,0.9)',
    borderWidth: 1.5, borderColor: colors.amber,
  },
  micBtnActive: {
    backgroundColor: '#d4726a',
    borderColor: '#d4726a',
  },
  // Locked-state finish button — amber fill (mirrors the chat send affordance).
  micBtnSend: {
    backgroundColor: colors.amber,
    borderColor: colors.amber,
  },
  // Lock affordance floating above the mic while holding (pre-lock). Anchored
  // above the 48px mic button at the right of the dock; positions want a device
  // pass alongside the LOCK_DY threshold.
  lockAffordance: {
    position: 'absolute',
    bottom: 56,
    right: 32,
    alignItems: 'center',
    gap: 1,
    paddingVertical: 6,
    paddingHorizontal: 7,
    backgroundColor: 'rgba(40,28,28,0.92)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(212,114,106,0.55)',
  },
});
