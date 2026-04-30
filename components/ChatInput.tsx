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
import ReAnimated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
  Easing as ReEasing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { colors, fonts, radii, spacing } from '../constants/theme';
import { cancelStream as cancelTTSStream } from '../utils/ttsStream';

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
  // Direct ref to the TextInput. We re-call focus() at recording start
  // and end so iOS doesn't drop the keyboard when the mic Pressable
  // briefly grabs touch focus. Without this, tapping the mic could
  // implicitly blur the TextInput → keyboard slides down.
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

  const startXRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (tapHintHoldTimer.current) clearTimeout(tapHintHoldTimer.current);
    if (tapHintFadeTimer.current) clearTimeout(tapHintFadeTimer.current);
    if (tickRef.current) clearInterval(tickRef.current);
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
    // Clear the input IMMEDIATELY — both via state and via the native
    // TextInput's clear() method. We've seen cases where setText('')
    // alone doesn't visually empty the field (likely because the parent
    // re-renders synchronously with `disabled=true` from the new
    // `sending` state, which can race with the controlled-input state
    // update). Belt-and-braces: clear native value too, before invoking
    // onSend so the user sees an empty box the instant they tap send.
    setText('');
    try { inputRef.current?.clear(); } catch {}
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
    // Hard-stop any read-aloud / streaming-TTS playback before the mic
    // session opens. Otherwise the user hears the AI's reply talking
    // over their own recording prompt — confusing on iPhone speakers.
    cancelTTSStream();
    // Re-focus the TextInput synchronously so iOS doesn't drop the
    // keyboard. The mic Pressable's touch capture would otherwise
    // implicitly blur whatever was focused.
    try { inputRef.current?.focus(); } catch {}
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

  async function endHold() {
    // If the recorder never started (short tap), bail cleanly. Swipe-cancel
    // still runs through this path.
    if (!recording) return;
    console.log('[mic] press-out, cancelArmed=', cancelArmed);
    // Belt-and-braces: re-focus the input so the keyboard remains up
    // after the recording overlay disappears.
    try { inputRef.current?.focus(); } catch {}
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
            placeholder={'Share what feels true…'}
            placeholderTextColor={colors.creamFaint}
            style={styles.input}
            selectionColor={colors.amber}
            onSubmitEditing={handleSend}
          />
          {recording ? (
            // RECORDING PILL — overlay covering the TextInput.
            // pointerEvents='auto' so taps on the pill DON'T fall
            // through to the input below (the user can't accidentally
            // type while recording). The TextInput keeps focus and
            // the keyboard stays up because nothing has actually
            // blurred the input.
            <View
              style={[styles.recordingOverlay, cancelArmed && styles.recordingPillCancel]}
              pointerEvents="auto"
            >
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
          ) : null}
        </View>

        {canSend ? (
          <Pressable onPress={handleSend} style={[styles.btn, styles.sendBtn]} accessibilityLabel="Send">
            <Ionicons name="arrow-up" size={20} color={colors.background} />
          </Pressable>
        ) : (
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
    // Sits exactly over the TextInput. Same minHeight + paddings as
    // the recording pill used to have. pointerEvents='none' on the
    // wrapper above so taps fall through to the underlying TextInput
    // (the user can dismiss the keyboard by tapping outside, etc.).
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(212,114,106,0.18)',
    borderRadius: radii.md,
    borderWidth: 0.5,
    borderColor: 'rgba(212,114,106,0.55)',
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
