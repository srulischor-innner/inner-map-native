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

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, StyleSheet, Switch,
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
import { JournalKind } from '../../services/journal';

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
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  // Per-entry privacy — chosen here, locked at save. Default ON (shared): the
  // AI can read it for RAG. OFF (private): stays on-device, never synced.
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
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Red-dot pulse during recording.
  const pulse = useRef(new Animated.Value(1)).current;

  // --- Swipe-up-to-lock (hands-free) ---
  // `recording` covers both the held and the locked phases; `locked` adds:
  // the finger has lifted and recording continues until the finish button.
  const [locked, setLocked] = useState(false);
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
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        recorder.stop().catch(() => {});
        setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        }).catch(() => {});
        setRecording(false);
        setLocked(false);
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
    setShared(true);
    setGuidanceCollapsed(false);
    guidanceOpacity.setValue(1);
  }, [visible, guidanceOpacity, recorder]);

  // Cleanup timers if the modal closes mid-recording.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
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

  // Pulse the red recording dot.
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

  async function startRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone off', 'Grant mic access in Settings to record voice notes.');
        return;
      }
      try {
        await setAudioModeAsync({
          allowsRecording: true, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        });
      } catch {}
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setSeconds(0);
      startTimeRef.current = Date.now();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      tickRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);
    } catch (err) {
      console.warn('[journal-mic] startRecording failed:', (err as Error).message);
      setRecording(false);
    }
  }

  async function endRecording() {
    if (!recording) return;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const heldSec = Math.max(0.1, (Date.now() - startTimeRef.current) / 1000);
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
      const transcript = await api.transcribe(uri, mime);
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
  // a 180ms long-press (matching the prior press-and-hold), so a quick tap
  // stays a no-op. This is a thin shell over startRecording/endRecording — it
  // adds NO audio-session calls (those stay inside those two functions). Mirrors
  // the chat gesture (ChatInput) minus the swipe-left-cancel axis.
  const micPan = Gesture.Pan()
    .activateAfterLongPress(180)
    .hitSlop(12)
    .onBegin(() => {
      'worklet';
      dragY.value = 0;
      lockArmedSV.value = 0;
      runOnJS(micHaptic)();
    })
    .onStart(() => {
      'worklet';
      runOnJS(startRecording)();
    })
    .onUpdate((e) => {
      'worklet';
      dragY.value = e.translationY;
      // Lock once the finger rises past the threshold (one-shot guard).
      if (lockArmedSV.value === 0 && e.translationY <= LOCK_DY) {
        lockArmedSV.value = 1;
        runOnJS(onLockCrossed)();
      }
    })
    .onEnd(() => {
      'worklet';
      // Locked → recording continues; the dock's finish button stops it.
      if (lockArmedSV.value === 1) return;
      // Plain release → stop + transcribe (the original behavior).
      runOnJS(endRecording)();
    })
    .onFinalize(() => {
      'worklet';
      dragY.value = withTiming(0, { duration: 140 });
    });

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

          {/* Per-entry privacy toggle — set before saving, locked at save.
              Default ON (shared). MICROCOPY below is flagged for the copy pass. */}
          <View style={styles.shareRow}>
            <View style={styles.shareTextWrap}>
              <Text style={styles.shareLabel}>
                {shared ? 'Shared with the AI' : 'Private to this device'}
              </Text>
              <Text style={styles.shareHelp}>
                {shared
                  ? 'The AI can read this entry and bring it into conversation.'
                  : "Kept on this device only — we genuinely can't read it."}
              </Text>
            </View>
            <Switch
              value={shared}
              onValueChange={setShared}
              trackColor={{ false: 'rgba(255,255,255,0.16)', true: 'rgba(230,180,122,0.5)' }}
              thumbColor={shared ? colors.amber : '#9a9a9a'}
              ios_backgroundColor="rgba(255,255,255,0.16)"
              accessibilityLabel="Share this entry with the AI"
            />
          </View>

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
              {recording ? (
                <View style={styles.recordingRow}>
                  <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulse }] }]} />
                  <Text style={styles.recordingText}>Recording…</Text>
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
            <Text style={styles.micLabel}>{locked ? 'Tap to finish' : 'Or speak'}</Text>
            {/* Lock affordance — floats above the mic while holding (pre-lock),
                brightening + lifting as the finger rises toward the lock. */}
            {recording && !locked ? (
              <ReAnimated.View pointerEvents="none" style={[styles.lockAffordance, lockAffordanceStyle]}>
                <Ionicons name="lock-closed" size={14} color={colors.cream} />
                <Ionicons name="chevron-up" size={12} color={colors.creamFaint} style={{ marginTop: 1 }} />
              </ReAnimated.View>
            ) : null}
            {locked ? (
              // LOCKED — hands-free. This finish button stops + transcribes.
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

  // ----- per-entry privacy toggle row (above the recording bar / mic dock) -----
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  shareTextWrap: { flex: 1 },
  shareLabel: {
    color: colors.cream,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  shareHelp: {
    color: 'rgba(240,237,232,0.5)',
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
  },

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
