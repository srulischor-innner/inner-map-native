// Bottom input bar — WHATSAPP-STYLE VOICE NOTES.
//
// Modes:
//   idle        → text field + mic button (press-and-hold to record)
//   typing      → text field + send (arrow-up) button
//   recording   → text field is covered by a "Recording… 0:03" pill with
//                 a red pulsing dot. User must keep holding; release to
//                 send. Anything held under MIN_RECORDING_MS is treated
//                 as a misfire — the user gets a brief "hold longer"
//                 toast and the audio is discarded.
//
// On release (held ≥ MIN_RECORDING_MS):
//   - recorder.stop() → file URI
//   - Parent onSendVoice(uri, durationSec, transcript) is called. The
//     parent (ChatScreen) handles pushing the voice-note bubble into the
//     messages list AND sending the transcribed text through /api/chat.
//   - We transcribe HERE so the parent gets both the file URI and the
//     text in a single callback.
//
// No swipe-to-cancel — Pressable's gesture system can't track a swipe
// reliably once the finger leaves the press-retention zone. If a real
// cancel is needed, build it on top of PanResponder.

// Minimum hold duration in milliseconds. Anything shorter is dropped
// because Whisper consistently returns empty transcripts for sub-half-
// second clips (mic warmup + capture latency leave near-silence). Tuned
// up from 300ms after the empty-transcript bug — see [voice-note] logs.
const MIN_RECORDING_MS = 500;

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
  Easing as ReEasing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { colors, fonts, spacing } from '../constants/theme';
import { cancelStream as cancelTTSStream } from '../utils/ttsStream';

export function ChatInput({
  disabled,
  onSend,
  onSendVoice,
  prefillText,
  onPrefillConsumed,
}: {
  disabled?: boolean;
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
    // Hard-stop any read-aloud / streaming-TTS playback before the mic
    // session opens. Otherwise the user hears the AI's reply talking
    // over their own recording prompt — confusing on iPhone speakers.
    cancelTTSStream();
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
    // If the recorder never started (short tap), bail cleanly.
    if (!recording) return;
    const stopTs = Date.now();
    const heldMs = stopTs - startTimeRef.current;
    const heldSec = Math.max(0.1, heldMs / 1000);
    console.log(`[voice-note] endHold — stopTimestamp=${stopTs} heldMs=${heldMs} heldSec=${heldSec.toFixed(3)} threshold=${MIN_RECORDING_MS}ms`);
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setRecording(false);
    setSeconds(0);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      console.log(`[voice-note] recorder.stop returned — uri=${uri ? uri.slice(-60) : '(null)'}`);
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
      console.warn('[voice-note] endHold stop failed:', (err as Error).message);
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
              <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulse }] }]} />
              <Text style={styles.recordingLabel}>Recording…</Text>
              <Text style={styles.recordingTime}>{formatSecs(seconds)}</Text>
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
            onPressOut={endHold}
            // Hit area expanded well beyond the visible 44px so the button
            // reliably catches press-and-hold with imprecise finger
            // placement — previously reports of "mic not tappable" were
            // tracing to the tap area being exactly the visible 40px circle.
            hitSlop={14}
            style={styles.micPressable}
            accessibilityLabel={recording ? 'Release to send voice note' : 'Hold to record voice note'}
          >
            <View style={[styles.btn, styles.micBtn, recording && styles.micRecording]}>
              <Ionicons
                name="mic"
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
