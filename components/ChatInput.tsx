// Bottom input bar — WHATSAPP-STYLE VOICE NOTES.
//
// Modes:
//   idle        → text field + mic button (press-and-hold to record)
//   typing      → text field + send (arrow-up) button
//   recording   → text field collapses into a "Recording… 0:03" pill with
//                 a red pulsing dot and a "Slide to cancel ←" hint. User
//                 must keep holding; release to send, drag left to cancel.
//
// On release (not cancelled):
//   - recorder.stop() → file URI
//   - Parent onSendVoice(uri, durationSec, transcript) is called. The
//     parent (ChatScreen) handles pushing the voice-note bubble into the
//     messages list AND sending the transcribed text through /api/chat.
//   - We transcribe HERE so the parent gets both the file URI and the
//     text in a single callback.
//
// On cancel (dragged left past threshold):
//   - recorder.stop() is still called (to release the mic hardware) but
//     the file is discarded and no callback fires.

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
  GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { colors, fonts, radii, spacing } from '../constants/theme';

// Swiping the finger this far left during a hold → cancel the recording.
const CANCEL_SWIPE_PX = 80;

export function ChatInput({
  disabled,
  onSend,
  onSendVoice,
}: {
  disabled?: boolean;
  onSend: (text: string) => void;
  /** Called when user releases a voice note hold without cancelling. The
   *  parent shows the voice-note bubble with a "Transcribing…" line, then
   *  transcribes the audio and runs the resulting text through /api/chat. */
  onSendVoice?: (opts: { uri: string; durationSec: number }) => void;
}) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // Short-tap tooltip — appears above the mic when the user taps without
  // holding long enough to trigger a recording. Fades after 1.5s.
  const [showTapHint, setShowTapHint] = useState(false);
  const tapHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const startXRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setText('');
    onSend(t);
  }

  // ------------------------------------------------------------------------
  // Press-and-hold voice recording — uses onLongPress (fires after 150ms of
  // hold) so a quick tap can show the teaching tooltip without accidentally
  // triggering a recording. Swipe-left cancel is tracked via onTouchMove so
  // we need to keep the pointer events flowing even while the recorder is
  // running.
  // ------------------------------------------------------------------------
  function beginTouch(e: GestureResponderEvent) {
    // Remember the initial finger X so handleMove can compute dx for the
    // swipe-left cancel gesture. Fires on EVERY touch down — recording
    // itself waits for onLongPress.
    startXRef.current = e.nativeEvent.pageX;
  }

  async function startRecording() {
    console.log('[mic] long-press fired → recording start');
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
        const s = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setSeconds(s);
      }, 250);
    } catch (err) {
      console.warn('[mic] startRecording failed:', (err as Error).message);
      setRecording(false);
    }
  }

  function handleMove(e: GestureResponderEvent) {
    if (!recording) return;
    const startX = startXRef.current;
    if (startX == null) return;
    const dx = e.nativeEvent.pageX - startX;
    const shouldArm = dx < -CANCEL_SWIPE_PX;
    if (shouldArm !== cancelArmed) {
      setCancelArmed(shouldArm);
      if (shouldArm) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }

  function handleShortTap() {
    // Fires when the touch ends BEFORE the 150ms long-press timer. Shows
    // a transient "Hold to record" hint so the gesture discovers itself
    // without nagging the user.
    if (tapHintTimer.current) clearTimeout(tapHintTimer.current);
    setShowTapHint(true);
    tapHintTimer.current = setTimeout(() => setShowTapHint(false), 1500);
  }

  async function endHold() {
    // If the recorder never started (short tap), bail cleanly. Swipe-cancel
    // still runs through this path.
    if (!recording) return;
    console.log('[mic] press-out, cancelArmed=', cancelArmed);
    const wasCancel = cancelArmed;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const heldSec = Math.max(0.1, (Date.now() - startTimeRef.current) / 1000);
    setRecording(false);
    setCancelArmed(false);
    setSeconds(0);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (wasCancel || !uri || heldSec < 0.3) {
        Haptics.selectionAsync().catch(() => {});
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Parent shows the voice bubble + runs transcription asynchronously.
      onSendVoice?.({ uri, durationSec: heldSec });
    } catch (err) {
      console.warn('[mic] endHold stop failed:', (err as Error).message);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {recording ? (
          // -----------------------------------------------------------------
          // RECORDING PILL — replaces the text field while the hold is active.
          // Red pulsing dot + "Recording" + ticking duration + swipe hint.
          // When cancelArmed, the pill turns red to confirm a release now
          // will discard.
          // -----------------------------------------------------------------
          <View style={[styles.recordingPill, cancelArmed && styles.recordingPillCancel]}>
            <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulse }] }]} />
            <Text style={styles.recordingLabel}>
              {cancelArmed ? 'Release to cancel' : 'Recording…'}
            </Text>
            <Text style={styles.recordingTime}>{formatSecs(seconds)}</Text>
            <View style={{ flex: 1 }} />
            {!cancelArmed ? (
              <Text style={styles.swipeHint}>Slide to cancel ←</Text>
            ) : null}
          </View>
        ) : (
          <TextInput
            value={text}
            onChangeText={setText}
            editable={!disabled}
            multiline
            placeholder={'Share what feels true…'}
            placeholderTextColor={colors.creamFaint}
            style={styles.input}
            selectionColor={colors.amber}
            onSubmitEditing={handleSend}
          />
        )}

        {canSend ? (
          <Pressable onPress={handleSend} style={[styles.btn, styles.sendBtn]} accessibilityLabel="Send">
            <Ionicons name="arrow-up" size={20} color={colors.background} />
          </Pressable>
        ) : (
          <View>
            {showTapHint ? (
              <View style={styles.tapHint} pointerEvents="none">
                <Text style={styles.tapHintText}>Hold to record</Text>
              </View>
            ) : null}
            <Pressable
              onLongPress={startRecording}
              delayLongPress={150}
              onPress={handleShortTap}
              onPressIn={beginTouch}
              onPressOut={endHold}
              onTouchMove={handleMove}
              // Hit area expanded well beyond the visible 44px so the button
              // reliably catches press-and-hold with imprecise finger
              // placement — previously reports of "mic not tappable" were
              // tracing to the tap area being exactly the visible 40px circle.
              hitSlop={14}
              style={styles.micPressable}
              accessibilityLabel={recording ? 'Release to send voice note' : 'Hold to record voice note'}
            >
              <View
                style={[
                  styles.btn,
                  styles.micBtn,
                  recording && styles.micRecording,
                  cancelArmed && styles.micCancel,
                ]}
              >
                <Ionicons
                  name={recording && cancelArmed ? 'close' : 'mic'}
                  size={20}
                  color={recording ? '#fff' : colors.amber}
                />
              </View>
            </Pressable>
          </View>
        )}
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
  input: {
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
  micCancel: {
    backgroundColor: '#6a2a2a',
    borderColor: '#6a2a2a',
  },

  // Recording pill — replaces the text field while holding.
  recordingPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(212,114,106,0.12)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(212,114,106,0.4)',
  },
  recordingPillCancel: {
    backgroundColor: 'rgba(180,60,60,0.25)',
    borderColor: 'rgba(255,100,100,0.7)',
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
  swipeHint: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 11,
    fontStyle: 'italic',
  },

  // Short-tap tooltip. Sits above the mic; pointerEvents:none so it never
  // steals a subsequent hold attempt.
  tapHint: {
    position: 'absolute',
    bottom: 56,            // clears the 52px mic pressable + a little gap
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,19,26,0.95)',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.amberDim,
    // Small shadow helps it float above dark surfaces.
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tapHintText: {
    color: colors.cream,
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.3,
  },
});
