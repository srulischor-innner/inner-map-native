// "Share something with your partner" input — sits at the bottom of
// the shared space. Lets a user post a contribution manually,
// independent of any AI nudge in the private chat.
//
// Collapsed: a single button "Share something with [partner]".
// Expanded: multi-line input + mic + Share + Cancel.
//
// Build 14:
//   - Keyboard handling replaced KeyboardAvoidingView with the manual
//     kbHeight pattern that already works in main chat (app/(tabs)/
//     index.tsx) and Partner chat (RelationshipChat.tsx). KAV with
//     behavior:'padding'/'height' was unreliable on Android (the
//     input got covered even with softwareKeyboardLayoutMode:'pan'
//     set globally — the parent flex column's bottom-anchored input
//     wasn't getting picked up by Android's pan target detection).
//   - Voice note added. Press and hold the mic to record; release
//     transcribes via /api/transcribe and POPULATES the text field
//     for review. Does NOT auto-share — Shared is a consent surface,
//     so the user must see and confirm the transcribed text before
//     tapping SHARE. Same trailing-audio fix (250ms grace + 150ms
//     flush) ChatInput uses so the last spoken word isn't clipped.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert,
  Platform, Keyboard, Animated,
} from 'react-native';
import { useKeyboardInset } from '../../utils/useKeyboardInset';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api } from '../../services/api';

const CONTRIB_MAX_CHARS = 500;
const MIN_RECORDING_MS = 500;
// Mirrors ChatInput's trailing-audio fix — see commit 728ef86. Without
// these, on iOS the M4A trailer isn't fully flushed by the time
// recorder.uri is read, and the last word of the user's voice gets
// dropped from the transcription. The Shared compose is one round
// trip away from a partner-visible share, so getting the transcript
// right matters even more here than in the main chat.
const STOP_GRACE_MS = 250;
const POST_STOP_FLUSH_MS = 150;

export function PartnerContributionInput({
  relationshipId,
  partnerName,
  onContributed,
}: {
  relationshipId: string;
  partnerName: string | null;
  /** Fires after a successful share so the parent can refresh the
   *  thread. */
  onContributed: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);

  // expo-audio recorder + tick timer. Same shape as ChatInput.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordStartRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Recording-dot pulse animation — visually mirrors ChatInput's
  // pulse so the gesture feels consistent across compose surfaces.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!recording) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0,  duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  // ===== KEYBOARD HEIGHT =====
  // Manual lift, exactly like RelationshipChat + the main chat tab.
  // KeyboardAvoidingView with behavior:'padding'/'height' was the
  // original implementation and was unreliable on Android (the input
  // stayed under the keyboard on real devices). The endCoordinates
  // listener catches both iOS keyboardWillShow (pre-animation, no
  // perceptible lag) and Android keyboardDidShow.
  // Centralized in utils/useKeyboardInset. Non-modal inline input → on
  // Android the OS resize lifts the screen (inset stays 0); iOS lifts by
  // the live keyboard height. (Partner is gated off for v1 — device-test
  // when PARTNER_ENABLED is flipped on.)
  const kbHeight = useKeyboardInset();

  // Unmount cleanup — if the user collapses or navigates away mid-
  // recording, stop the recorder so the mic isn't held open in the
  // background and the audio session resets cleanly.
  useEffect(() => () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { recorder.stop(); } catch {}
  }, [recorder]);

  const cancel = useCallback(() => {
    if (sending || transcribing) return;
    setExpanded(false);
    setText('');
  }, [sending, transcribing]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    Haptics.selectionAsync().catch(() => {});
    const result = await api.contributeToSharedSpace(relationshipId, trimmed);
    setSending(false);
    if ('error' in result) {
      // PR 2 — if the server returned a freeze (shared-space-frozen),
      // refresh the partnerSharedSeen cache so the SharedDialogueView's
      // banner appears in the same frame as the alert. The user's
      // typed text is preserved so they don't lose it on the bounce.
      if (result.error === 'shared-space-frozen') {
        try {
          const svc = await import('../../services/partnerSharedSeen');
          svc.refreshPartnerSharedSeenStatus(relationshipId, true).catch(() => {});
        } catch {}
      }
      Alert.alert(
        "Couldn't share",
        result.message || result.error || 'Try again in a moment.',
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setExpanded(false);
    setText('');
    onContributed();
  }, [text, sending, relationshipId, onContributed]);

  // ===== VOICE NOTE: PRESS-AND-HOLD → TRANSCRIBE INTO FIELD =====
  // Differences from ChatInput.tsx's mic:
  //   - On release: DON'T auto-send. Transcribe and stuff the result
  //     into the text field. The user must explicitly tap SHARE
  //     before anything reaches the partner.
  //   - Append to existing text (separated by a space) rather than
  //     replace — so the user can dictate one thought, type a
  //     correction, dictate another, build the contribution
  //     incrementally.
  // Same MIN_RECORDING_MS / STOP_GRACE_MS / POST_STOP_FLUSH_MS as
  // ChatInput, copied verbatim — trailing-audio fix must apply here
  // too (a clipped transcription that the user doesn't notice is
  // worse than a clipped chat message; partner reads the share).

  const startRecording = useCallback(async () => {
    if (transcribing || sending) return;
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
      setRecordSec(0);
      recordStartRef.current = Date.now();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      tickRef.current = setInterval(() => {
        setRecordSec(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 250);
    } catch (e) {
      console.warn('[shared-compose-voice] startRecording failed:', (e as Error)?.message);
      setRecording(false);
    }
  }, [transcribing, sending, recorder]);

  const endHold = useCallback(async () => {
    if (!recording) return;
    const heldMs = Date.now() - recordStartRef.current;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const willDiscard = heldMs < MIN_RECORDING_MS;
    // Tail-capture grace before recorder.stop(). See STOP_GRACE_MS.
    if (!willDiscard) {
      await new Promise<void>((r) => setTimeout(r, STOP_GRACE_MS));
    }
    setRecording(false);
    setRecordSec(0);
    let uri: string | null = null;
    try {
      await recorder.stop();
      if (!willDiscard) {
        await new Promise<void>((r) => setTimeout(r, POST_STOP_FLUSH_MS));
      }
      uri = recorder.uri || null;
    } catch (e) {
      console.warn('[shared-compose-voice] recorder.stop threw:', (e as Error)?.message);
    }
    if (willDiscard) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Alert.alert(
        'Hold a bit longer',
        'Voice notes need at least half a second of audio to transcribe. Press and hold the mic, then release when you\'re done.',
      );
      return;
    }
    if (!uri) {
      console.warn('[shared-compose-voice] no uri after stop — discarding');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTranscribing(true);
    const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/mp4';
    let transcript = '';
    try {
      const t = await Promise.race([
        api.transcribe(uri, mime),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('transcribe timeout (30s)')), 30000),
        ),
      ]);
      transcript = (t || '').trim();
    } catch (err) {
      console.warn('[shared-compose-voice] transcribe failed:', (err as Error)?.message);
    }
    setTranscribing(false);
    if (!transcript) {
      Alert.alert(
        "Nothing heard",
        "We couldn't hear anything in that recording. Try again, speaking a little closer to the phone.",
      );
      return;
    }
    // Append rather than replace — the user might already have typed
    // a partial thought before dictating, or want to dictate in
    // multiple takes. Cap at CONTRIB_MAX_CHARS so a long dictation
    // doesn't break the post.
    setText((prev) => {
      const joined = prev.trim() ? prev.trim() + ' ' + transcript : transcript;
      return joined.slice(0, CONTRIB_MAX_CHARS);
    });
  }, [recording, recorder]);

  if (!expanded) {
    return (
      <View style={styles.collapsed}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setExpanded(true);
          }}
          style={styles.collapsedBtn}
          accessibilityLabel={`Share something with ${partnerName || 'your partner'}`}
        >
          <Ionicons name="add-circle-outline" size={16} color={colors.amber} style={styles.collapsedIcon} />
          <Text style={styles.collapsedText}>
            Share something with {partnerName || 'your partner'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.expandedWrap, { paddingBottom: kbHeight }]}>
      <View style={styles.expanded}>
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={(s) => setText(s.slice(0, CONTRIB_MAX_CHARS))}
            editable={!sending && !transcribing}
            multiline
            placeholder={
              transcribing
                ? 'Transcribing…'
                : recording
                  ? `Recording… ${recordSec}s`
                  : 'What do you want to share with your partner?'
            }
            placeholderTextColor={colors.creamFaint}
            selectionColor={colors.amber}
            style={styles.input}
            autoFocus
          />
          {/* Mic — press and hold to record. Releases trigger
              endHold which transcribes into the field rather than
              auto-sending. Disabled while a previous transcription
              is in flight. */}
          <Pressable
            onLongPress={startRecording}
            delayLongPress={150}
            onPressOut={endHold}
            hitSlop={12}
            disabled={transcribing || sending}
            style={styles.micPressable}
            accessibilityLabel={
              recording ? 'Release to transcribe' : 'Hold to dictate'
            }
          >
            <View style={[
              styles.micBtn,
              recording && styles.micBtnRecording,
              (transcribing || sending) && styles.micBtnDisabled,
            ]}>
              {transcribing ? (
                <ActivityIndicator color={colors.amber} size="small" />
              ) : recording ? (
                <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulse }] }]} />
              ) : (
                <Ionicons name="mic" size={18} color={colors.amber} />
              )}
            </View>
          </Pressable>
        </View>
        <View style={styles.row}>
          <Text style={styles.count}>
            {text.length} / {CONTRIB_MAX_CHARS}
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={cancel}
              disabled={sending || transcribing}
              style={[styles.btn, styles.btnGhost]}
              accessibilityLabel="Cancel"
            >
              <Text style={styles.btnGhostText}>CANCEL</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={sending || transcribing || !text.trim()}
              style={[
                styles.btn, styles.btnPrimary,
                (sending || transcribing || !text.trim()) && styles.btnDim,
              ]}
              accessibilityLabel="Share"
            >
              {sending ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text style={styles.btnPrimaryText}>SHARE</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  collapsedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 0.75,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.04)',
    alignSelf: 'center',
  },
  collapsedIcon: { marginRight: 8 },
  collapsedText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    letterSpacing: 0.3,
  },

  expandedWrap: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: colors.background,
  },
  expanded: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  // Build 14 — flex row that holds the multi-line input + the mic
  // button. The mic is sized to align with the input's vertical
  // center via alignSelf:'flex-end' so a 1-line input doesn't push
  // the mic upward, and a 6-line input keeps the mic anchored to the
  // bottom edge.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 90,
    maxHeight: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(230, 180, 122, 0.25)',
    textAlignVertical: 'top',
  },
  micPressable: {
    // Slightly larger hit area than the visible 40px circle so
    // press-and-hold doesn't miss on imprecise placement.
    padding: 4,
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 0.75,
    borderColor: 'rgba(230, 180, 122, 0.45)',
    backgroundColor: 'rgba(230, 180, 122, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnRecording: {
    backgroundColor: 'rgba(220, 70, 70, 0.85)',
    borderColor: 'rgba(220, 70, 70, 0.95)',
  },
  micBtnDisabled: { opacity: 0.5 },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  count: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 11,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 999,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    borderWidth: 0.75,
    borderColor: 'rgba(230, 180, 122, 0.3)',
  },
  btnGhostText: {
    color: colors.creamDim,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  btnPrimary: { backgroundColor: colors.amber },
  btnPrimaryText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  btnDim: { opacity: 0.5 },
});
