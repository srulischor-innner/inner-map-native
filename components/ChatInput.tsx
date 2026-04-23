// Bottom input bar: multiline textarea, mic button (voice dictation via expo-audio +
// /api/transcribe), and send button. Send appears when there's content, mic appears
// when the input is empty — matching the web app's single-button-at-a-time pattern.

import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
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
  const sentOnce = useRef(false);

  const canSend = text.trim().length > 0 && !disabled && !transcribing;

  async function handleSend() {
    const t = text.trim();
    if (!t || disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setText('');
    onSend(t);
    sentOnce.current = true;
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

  async function stopRecordAndTranscribe() {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      setRecording(false);
      if (!uri) return;
      setTranscribing(true);
      // Pick a plausible mime type from the file extension; server accepts any audio/*.
      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      const transcript = await api.transcribe(uri, mime);
      setTranscribing(false);
      const t = (transcript || '').trim();
      if (t) {
        // Send directly — matches the web app's post-transcription auto-send flow.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onSend(t);
      }
    } catch (e) {
      console.warn('[mic] stop/transcribe failed:', (e as Error).message);
      setRecording(false);
      setTranscribing(false);
    }
  }

  return (
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
          style={[styles.btn, styles.micBtn, recording && styles.micRecording]}
          accessibilityLabel={recording ? 'Stop recording' : 'Start voice input'}
          disabled={transcribing}
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
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.cream,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 40,
    maxHeight: 140,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.backgroundCard,
    borderRadius: radii.lg,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    backgroundColor: colors.amber,
  },
  micBtn: {
    borderWidth: 1,
    borderColor: colors.amberDim,
    backgroundColor: 'transparent',
  },
  micRecording: {
    backgroundColor: '#d4726a',
    borderColor: '#d4726a',
  },
});
