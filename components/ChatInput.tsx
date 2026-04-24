// Bottom input bar — DICTATION MODEL (not a conversation loop).
//
// Flow:
//   idle      → tap mic → recording (red pulse + "Recording…" label above bar)
//   recording → tap mic → stop, transcribe, drop transcript INTO the text input
//                         (not auto-sent — user reviews, edits, then taps send)
//   typing    → send button shown instead of mic; tap to send
//
// No TTS auto-play. No listening-after-AI loop. Voice input behaves like
// dictation on an iPhone keyboard: press, talk, release, get editable text.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Animated,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { colors, radii, spacing } from '../constants/theme';
import { api } from '../services/api';

export function ChatInput({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Mic pulse animation — scale 1.0 ↔ 1.12 while recording. Stops cleanly when
  // recording flips false.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!recording) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  const canSend = text.trim().length > 0 && !disabled && !transcribing;

  async function handleSend() {
    const t = text.trim();
    if (!t || disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setText('');
    onSend(t);
  }

  async function startRecord() {
    console.log('[mic] tap → requesting permission');
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      console.log('[mic] permission result:', perm.granted);
      if (!perm.granted) {
        Alert.alert('Microphone off', 'Grant mic access in Settings to use voice input.');
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (e) {
      console.warn('[mic] start failed:', (e as Error).message);
      setRecording(false);
    }
  }

  /**
   * Stop → transcribe → DROP INTO INPUT FIELD. Not auto-sent. The user reviews
   * the transcription, edits if needed, then taps the Send button themselves.
   * If the text area already has content, the transcript is appended with a
   * leading space so nothing gets clobbered.
   */
  async function stopRecordAndTranscribe() {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      setRecording(false);
      if (!uri) return;
      setTranscribing(true);
      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      const transcript = await api.transcribe(uri, mime);
      setTranscribing(false);
      const t = (transcript || '').trim();
      if (!t) return;
      Haptics.selectionAsync().catch(() => {});
      setText((prev) => (prev.trim() ? prev.replace(/\s+$/, '') + ' ' + t : t));
    } catch (e) {
      console.warn('[mic] stop/transcribe failed:', (e as Error).message);
      setRecording(false);
      setTranscribing(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {/* "Recording…" label sits just above the input while the mic is active. */}
      {recording ? (
        <View style={styles.recordingRow}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingLabel}>Recording…</Text>
        </View>
      ) : null}

      <View style={styles.bar}>
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!disabled && !transcribing}
          multiline
          placeholder={recording ? 'Listening…' : 'Share what feels true…'}
          placeholderTextColor={colors.creamFaint}
          style={styles.input}
          selectionColor={colors.amber}
          onSubmitEditing={handleSend}
        />
        {canSend ? (
          <Pressable onPress={handleSend} style={[styles.btn, styles.sendBtn]} accessibilityLabel="Send">
            <Ionicons name="arrow-up" size={18} color={colors.background} />
          </Pressable>
        ) : (
          <Pressable
            onPress={recording ? stopRecordAndTranscribe : startRecord}
            accessibilityLabel={recording ? 'Stop dictation' : 'Start voice dictation'}
            disabled={transcribing}
          >
            <Animated.View
              style={[
                styles.btn,
                styles.micBtn,
                recording && styles.micRecording,
                recording ? { transform: [{ scale: pulse }] } : null,
              ]}
            >
              {transcribing ? (
                <ActivityIndicator size="small" color={colors.amber} />
              ) : (
                <Ionicons
                  name={recording ? 'stop' : 'mic'}
                  size={18}
                  color={recording ? '#fff' : colors.amber}
                />
              )}
            </Animated.View>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // A little presence so the input reads as "a place to write" rather than
    // an afterthought — faint white-on-dark wash + a 0.5px top border to
    // separate it from the scrolling messages without dominating.
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 6,
    paddingBottom: 2,
  },
  recordingDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#d4726a',
    shadowColor: '#d4726a', shadowOpacity: 0.7, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
  },
  recordingLabel: {
    color: '#d4726a',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.cream,
    fontSize: 16,
    lineHeight: 22,
    // Taller, more inviting input surface. No maxHeight cap for short
    // messages — the multiline field grows naturally as the user types.
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.2)',
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: { backgroundColor: colors.amber },
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
});
