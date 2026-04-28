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
  Modal, View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Easing,
  GestureResponderEvent, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync,
} from 'expo-audio';

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

type Props = {
  visible: boolean;
  kind: JournalKind;
  onClose: () => void;
  onSave: (content: string) => Promise<void> | void;
};

export function JournalEntryModal({ visible, kind, onClose, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  // Guidance opacity — collapses to 0.2 once the user has started typing
  // or recorded a voice note. Tapping the guidance restores to 1.0.
  const guidanceOpacity = useRef(new Animated.Value(1)).current;
  const [guidanceCollapsed, setGuidanceCollapsed] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Red-dot pulse during recording.
  const pulse = useRef(new Animated.Value(1)).current;

  // Reset state every time the modal becomes visible. We don't carry text
  // across opens — each entry is its own thing.
  useEffect(() => {
    if (!visible) return;
    setText('');
    setRecording(false);
    setTranscribing(false);
    setSeconds(0);
    setSaving(false);
    setGuidanceCollapsed(false);
    guidanceOpacity.setValue(1);
  }, [visible, guidanceOpacity]);

  // Cleanup timers if the modal closes mid-recording.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
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
      await onSave(t);
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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <KeyboardAvoidingView
          // iOS handles 'padding' natively for full-screen Modals. On
          // Android we fall back to 'height' in case windowSoftInputMode
          // isn't set to adjustResize on a particular build.
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.flex}
        >
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

          {/* Mic dock — sits at the bottom-right with its "Or speak" label.
              Press-and-hold to record. Release to transcribe. */}
          <View style={styles.micDock}>
            <Text style={styles.micLabel}>Or speak</Text>
            <Pressable
              onPressIn={() => { Haptics.selectionAsync().catch(() => {}); }}
              onLongPress={startRecording}
              delayLongPress={180}
              onPressOut={endRecording}
              hitSlop={12}
              style={[styles.micBtn, recording && styles.micBtnActive]}
              accessibilityLabel="Hold to record voice note"
            >
              <Ionicons
                name="mic"
                size={22}
                color={recording ? '#fff' : colors.amber}
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
});
