// Guide tab → floating "Ask" chat. Bottom-sheet modal that slides up
// over whichever Guide pill the user is on. Same teaching-only chat as
// before (backed by /api/guide-chat — no markers, no map, no session
// save), now reachable from anywhere in the Guide tab without
// interrupting the slide experience.
//
// SNAP-BASED RESIZE — the sheet has three positions the user drags
// between: collapsed (drag handle peeking), half (50% screen, the
// default open state), and full (90% screen for longer reads). Drag
// the handle, fling vertically, or tap the dim backdrop / drag handle
// to snap. Conversation is preserved across collapse/expand; only the
// X button fully dismisses (that's the moment we wipe state).
//
// Voice notes: WhatsApp-style press-and-hold on the mic. Release →
// /api/transcribe → the transcript is sent as a regular text message
// (no audio bubble — keep it simple per the design brief).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  Platform, Dimensions, Alert, Keyboard,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withSpring, withRepeat, withTiming, Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync,
} from 'expo-audio';

import { TypingIndicator } from '../TypingIndicator';
import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api, ChatMessage } from '../../services/api';
import { renderInlineMarkdown } from '../../utils/inlineMarkdown';

// Per-word reveal cadence — same value as the regular Chat tab so the
// two surfaces feel identical to the eye. See app/(tabs)/index.tsx.
const PER_WORD_MS = 45;

// Three snap positions for the resizable sheet. translateY is the
// vertical offset of the sheet's TOP edge; the sheet itself is
// full-screen tall so the bottom always reaches the screen bottom.
// Smaller value = sheet covers more of the screen.
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SNAP_FULL = SCREEN_HEIGHT * 0.10;       // ~90% visible
const SNAP_HALF = SCREEN_HEIGHT * 0.50;       // 50% visible (default)
const SNAP_COLLAPSED = SCREEN_HEIGHT * 0.88;  // ~12% visible — drag handle peeking
const SPRING = { damping: 20 } as const;

const OPENING_MESSAGE =
  "Curious about something you read? Ask me anything — about the framework, how it works, what any of it means. There are no wrong questions here. We can stay simple or go as deep as you want.";

const STARTER_QUESTIONS: string[] = [
  'What is a part?',
  'How is this different from therapy?',
  'What is the wound?',
  'What does healing actually look like?',
  "What's the difference between Self and the self-like part?",
];

type Turn = { id: string; role: 'user' | 'assistant'; text: string };

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function GuideAskModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // `streaming` spans the WHOLE in-flight reply (send → onDone/stop),
  // unlike `loading` which flips false on the first chunk. Drives the
  // STOP button + the stop-on-close abort.
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  // STOP control (build 14). Captured streamGuide abort fn + the active
  // word-reveal timer, both cleared on stop / sheet-close so an in-flight
  // request and its reveal loop don't keep running in the background.
  const streamAbortRef = useRef<null | (() => void)>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);
  function nextId() { idRef.current += 1; return 'g' + idRef.current; }

  // ===== AT-BOTTOM-GATED AUTO-SCROLL =====
  // Mirrors the main chat / RelationshipChat pattern (same 60px threshold):
  // auto-follow the stream ONLY while the user is already at/near the
  // bottom. The moment they scroll up to re-read, disengage; re-engage when
  // they scroll back down. Previously every streamed word called
  // scrollToEnd unconditionally, yanking the user back down mid-read.
  const AUTOSCROLL_BOTTOM_THRESHOLD_PX = 60;
  const userScrolledAwayRef = useRef(false);
  const onScroll = useCallback((e: any) => {
    const ne = e?.nativeEvent;
    if (!ne) return;
    const lm = ne.layoutMeasurement, co = ne.contentOffset, cs = ne.contentSize;
    if (!lm || !co || !cs) return;
    const distFromBottom = cs.height - (co.y + lm.height);
    userScrolledAwayRef.current = distFromBottom > AUTOSCROLL_BOTTOM_THRESHOLD_PX;
  }, []);
  // Auto-scroll to bottom UNLESS the user has scrolled up to read.
  const maybeAutoScroll = useCallback((animated: boolean) => {
    if (userScrolledAwayRef.current) return;
    scrollRef.current?.scrollToEnd({ animated });
  }, []);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Reanimated red-dot pulse during voice recording.
  const dotScale = useSharedValue(1);
  useEffect(() => {
    if (recording) {
      dotScale.value = withRepeat(
        withTiming(1.2, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1, true,
      );
    } else {
      dotScale.value = withTiming(1, { duration: 200 });
    }
  }, [recording, dotScale]);
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: dotScale.value }] }));

  // Sheet translateY — driven by gesture and snap target.
  const translateY = useSharedValue(SNAP_HALF);

  // Manual keyboard-height tracking. We bypass KeyboardAvoidingView
  // because KAV's frame measurement is unreliable inside a transparent
  // Modal that hosts an absolute-positioned, animated sheet — the iOS
  // implementation reads the sheet's static layout frame (not its
  // animated transform), and the keyboardVerticalOffset/`padding`
  // combo lands the input either too high (above the keyboard with a
  // gap) or too low (still partially covered). Instead we read the
  // keyboard height straight from the Keyboard event payload and
  // apply it as bottom padding on the chat wrapper — that lifts the
  // input bar by exactly the keyboard height, every time, on every
  // device. iOS uses keyboardWillShow/Hide so the lift animates in
  // sync with the keyboard's own animation; Android only emits *Did*
  // events, which fire after the keyboard finishes animating — still
  // smooth enough in practice because the system adjustResize would
  // otherwise leave the bar covered.
  const [kbHeight, setKbHeight] = useState(0);

  // When the modal opens fresh (visible flips false→true), reset to half
  // and wipe the conversation. While the user just collapses the sheet
  // the modal stays mounted (visible stays true), so this effect doesn't
  // run and the conversation is preserved.
  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(SNAP_HALF, SPRING);
      setTurns([]);
      setInput('');
      setLoading(false);
      setRecording(false);
      setTranscribing(false);
      setSeconds(0);
      idRef.current = 0;
      userScrolledAwayRef.current = false; // fresh open starts at bottom
      setStreaming(false);
    } else {
      // STOP-ON-CLOSE hygiene: closing the sheet (X → visible=false) aborts
      // any in-flight request and stops the reveal loop, so neither runs in
      // the background. (Collapsing keeps visible=true, so this doesn't fire
      // on a collapse — only a real close.)
      try { streamAbortRef.current?.(); } catch {}
      streamAbortRef.current = null;
      if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Stop the in-flight reply (STOP button). Aborts the request + halts the
  // reveal loop; the prose revealed so far stays in the bubble untouched.
  const stopGuide = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    try { streamAbortRef.current?.(); } catch {}
    streamAbortRef.current = null;
    if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    setLoading(false);
    setStreaming(false);
  }, []);

  // Cleanup timers + in-flight stream on unmount.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    try { streamAbortRef.current?.(); } catch {}
  }, []);

  // Keyboard show/hide listeners — track keyboard height + snap sheet
  // to FULL so there's room above the keyboard for the input bar to
  // rise. We need both: kbHeight drives the manual lift (paddingBottom
  // on the chat wrapper), and SNAP_FULL guarantees the sheet itself is
  // tall enough that the input bar isn't pushed above the sheet's top.
  useEffect(() => {
    if (!visible) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      const h = e.endCoordinates?.height ?? 0;
      setKbHeight(h);
      translateY.value = withSpring(SNAP_FULL, SPRING);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      setKbHeight(0);
    });
    return () => { showSub.remove(); hideSub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function snapTo(target: number) {
    Haptics.selectionAsync().catch(() => {});
    translateY.value = withSpring(target, SPRING);
  }

  // Pan gesture on the drag handle area — drag the sheet to a new
  // height. On release, snap to the nearest of full/half/collapsed,
  // honoring fling velocity. Uses the modern Gesture.Pan() API
  // (Reanimated v4 dropped useAnimatedGestureHandler).
  const startY = useSharedValue(SNAP_HALF);
  const panGesture = Gesture.Pan()
    .onStart(() => {
      'worklet';
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      'worklet';
      const y = startY.value + event.translationY;
      // Clamp between full and collapsed so the user can't drag the
      // sheet off-screen in either direction.
      translateY.value = Math.max(SNAP_FULL, Math.min(SNAP_COLLAPSED, y));
    })
    .onEnd((event) => {
      'worklet';
      const v = event.velocityY;
      const cur = translateY.value;
      if (v > 500) {
        // Fast swipe down — snap one step toward collapsed.
        translateY.value = cur > SNAP_HALF
          ? withSpring(SNAP_COLLAPSED, SPRING)
          : withSpring(SNAP_HALF, SPRING);
      } else if (v < -500) {
        // Fast swipe up — snap one step toward full.
        translateY.value = cur < SNAP_HALF
          ? withSpring(SNAP_FULL, SPRING)
          : withSpring(SNAP_HALF, SPRING);
      } else {
        // Slow release — snap to nearest of the three positions.
        const dC = Math.abs(cur - SNAP_COLLAPSED);
        const dH = Math.abs(cur - SNAP_HALF);
        const dF = Math.abs(cur - SNAP_FULL);
        const min = Math.min(dC, dH, dF);
        if (min === dF) translateY.value = withSpring(SNAP_FULL, SPRING);
        else if (min === dH) translateY.value = withSpring(SNAP_HALF, SPRING);
        else translateY.value = withSpring(SNAP_COLLAPSED, SPRING);
      }
    });

  // Sheet height shrinks with translateY so the BOTTOM always sits at
  // the bottom of the screen at every snap. Without this, the sheet was
  // full-screen tall at top:0 with only translateY shifting it down,
  // which pushed its bottom edge (and the input bar inside it) off
  // screen at every non-zero translateY.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    height: SCREEN_HEIGHT - translateY.value,
  }));

  // ───── chat send ─────
  // Word-by-word reveal pattern lifted verbatim from the regular chat
  // tab (app/(tabs)/index.tsx — tickReveal). The server still streams
  // chunked text; we accumulate the full text into `target` and let
  // `revealed` walk forward one word at a time on a 45ms tick. Same
  // PER_WORD_MS as Chat so both surfaces feel identical.
  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    Haptics.selectionAsync().catch(() => {});
    // Sending is an explicit "I'm engaging now" action — re-engage
    // auto-follow so the user sees their own message + the reply, even
    // if they'd scrolled up while reading the previous answer.
    userScrolledAwayRef.current = false;
    const userTurn: Turn = { id: nextId(), role: 'user', text: trimmed };
    const assistantId = nextId();
    const nextTurns: Turn[] = [
      ...turns,
      userTurn,
      { id: assistantId, role: 'assistant', text: '' },
    ];
    setTurns(nextTurns);
    setInput('');
    setLoading(true);
    setStreaming(true);
    const apiMessages: ChatMessage[] = [...turns, userTurn].map((t) => ({
      role: t.role,
      content: t.text,
    }));

    let firstChunk = true;
    let target = '';                  // full cumulative text from the server
    let revealed = 0;                 // chars already shown on screen

    function tickReveal() {
      if (revealed >= target.length) { revealTimerRef.current = null; return; }
      // Advance through one word: skip whitespace, run to next whitespace.
      let i = revealed;
      while (i < target.length && /\s/.test(target[i])) i++;
      while (i < target.length && !/\s/.test(target[i])) i++;
      revealed = i;
      const slice = target.slice(0, revealed);
      setTurns((prev) => {
        const idx = prev.findIndex((t) => t.id === assistantId);
        if (idx === -1) return prev;
        const updated = prev.slice();
        updated[idx] = { ...updated[idx], text: slice };
        return updated;
      });
      // Gated: only follows the stream if the user is at the bottom.
      setTimeout(() => maybeAutoScroll(false), 30);
      revealTimerRef.current = setTimeout(tickReveal, PER_WORD_MS);
    }

    // Capture the abort fn so the STOP button + stop-on-close can halt the
    // in-flight request. streamGuide resolves with it once the request is
    // sent (before chunks arrive). Guide-chat carries NO markers, so a
    // truncated reply is just plain prose — nothing to strip or mis-parse.
    streamAbortRef.current = await api.streamGuide(apiMessages, {
      onChunk: (chunk) => {
        if (firstChunk) { firstChunk = false; setLoading(false); }
        target += chunk;
        if (!revealTimerRef.current) revealTimerRef.current = setTimeout(tickReveal, PER_WORD_MS);
      },
      onDone: () => {
        // Stream finished arriving. Clear the streaming flag (the reveal
        // loop catches up on its own cadence — cosmetic tail). Drop the
        // abort handle; the turn is over.
        setStreaming(false);
        streamAbortRef.current = null;
        // Belt-and-braces: if no chunks landed, fall back to a polite
        // error and stop the reveal loop. Otherwise let tickReveal
        // catch up to the final target on its own cadence.
        if (target.trim().length === 0) {
          if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
          setLoading(false);
          setTurns((prev) => {
            const idx = prev.findIndex((t) => t.id === assistantId);
            if (idx === -1) return prev;
            const updated = prev.slice();
            updated[idx] = {
              ...updated[idx],
              text: "I couldn't reach the framework guide just now — try again in a moment?",
            };
            return updated;
          });
        }
      },
      onError: (err) => {
        console.warn('[guide-chat] stream error:', err);
        if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
        setLoading(false);
        setStreaming(false);
        streamAbortRef.current = null;
        setTurns((prev) => {
          const idx = prev.findIndex((t) => t.id === assistantId);
          if (idx === -1) return prev;
          const updated = prev.slice();
          updated[idx] = {
            ...updated[idx],
            text: 'Something went quiet on my end. Try asking again.',
          };
          return updated;
        });
      },
    });
  }, [turns, loading, maybeAutoScroll]);

  // ───── voice note (press-and-hold mic) ─────
  async function startRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone off', 'Grant mic access in Settings to ask by voice.');
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
      console.warn('[guide-ask-mic] startRecording failed:', (err as Error).message);
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
      try {
        await setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        });
      } catch {}
      const uri = recorder.uri;
      if (!uri || heldSec < 0.3) { setTranscribing(false); return; }
      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      const transcript = await api.transcribe(uri, mime);
      const cleaned = (transcript || '').trim();
      setTranscribing(false);
      if (!cleaned) return;
      send(cleaned);
    } catch (err) {
      console.warn('[guide-ask-mic] endRecording failed:', (err as Error).message);
      setTranscribing(false);
    }
  }

  const showStarters = turns.length === 0 && !loading;
  const canSend = input.trim().length > 0 && !loading && !recording;

  // Auto-scroll to the bottom whenever the message list grows or the
  // loading/transcribing indicators appear/disappear — gated so it never
  // yanks a user who has scrolled up to re-read.
  useEffect(() => {
    const t = setTimeout(() => { maybeAutoScroll(true); }, 100);
    return () => clearTimeout(t);
  }, [turns.length, loading, transcribing, maybeAutoScroll]);

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Dim backdrop — tap COLLAPSES the sheet (does not dismiss).
            Only the X button fully closes the modal. */}
        <Pressable
          style={styles.backdrop}
          onPress={() => snapTo(SNAP_COLLAPSED)}
          accessibilityLabel="Collapse Ask sheet"
        />

        {/* Resizable sheet — full-screen tall, translated down by
            translateY so its top edge sits at the snap position. */}
        <Animated.View style={[styles.sheet, sheetStyle]}>
          {/* Drag handle area — pan gesture for resize, AND a tap
              that springs the sheet to the half snap so a user who
              left the sheet collapsed can re-expand with one tap. */}
          <GestureDetector gesture={panGesture}>
            <Animated.View>
              <Pressable
                style={styles.handleArea}
                onPress={() => snapTo(SNAP_HALF)}
                accessibilityLabel="Expand Ask sheet"
              >
                <View style={styles.handle} />
              </Pressable>
            </Animated.View>
          </GestureDetector>

          {/* Header — title + subtitle + X close. */}
          <View style={styles.headerWrap}>
            <Text style={styles.title}>Ask anything</Text>
            <Text style={styles.subtitle}>
              About the framework, how it works, what anything means
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color="rgba(240,237,232,0.55)" />
            </Pressable>
          </View>

          {/* Chat surface + input bar — paddingBottom: kbHeight lifts
              the input bar by exactly the keyboard height when the
              keyboard appears. Paired with the keyboard-show listener
              above that snaps the sheet to SNAP_FULL so there's
              vertical room for the bar to rise. Replaces the previous
              KeyboardAvoidingView, which was unreliable inside a
              transparent Modal hosting an absolute-positioned animated
              sheet (KAV measures static layout frames, not animated
              transforms, so its keyboard-avoidance padding landed
              wrong on iOS even with keyboardVerticalOffset={0}). */}
          <View style={[styles.flex, { paddingBottom: kbHeight }]}>
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: spacing.lg + Math.max(insets.bottom, 8) },
              ]}
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={16}
              onContentSizeChange={() => { maybeAutoScroll(true); }}
            >
              <AIBubble text={OPENING_MESSAGE} opening />

              {showStarters ? (
                <View style={styles.starters}>
                  {STARTER_QUESTIONS.map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => send(q)}
                      style={styles.chip}
                      accessibilityLabel={`Ask: ${q}`}
                    >
                      <Text style={styles.chipText}>{q}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {turns.map((t) =>
                t.role === 'user' ? (
                  <UserBubble key={t.id} text={t.text} />
                ) : (
                  <AIBubble key={t.id} text={t.text} />
                ),
              )}

              {loading || transcribing ? (
                <View style={styles.loadingRow}>
                  <TypingIndicator />
                  {transcribing ? (
                    <Text style={styles.loadingText}>transcribing…</Text>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            {/* Input bar. */}
            <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
              {recording ? (
                <View style={styles.recordingPill}>
                  <Animated.View style={[styles.recordingDot, dotStyle]} />
                  <Text style={styles.recordingText}>Recording…</Text>
                  <Text style={styles.recordingTime}>{formatSecs(seconds)}</Text>
                </View>
              ) : (
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Ask anything about the framework..."
                  placeholderTextColor={colors.creamFaint}
                  editable={!loading}
                  multiline
                  onSubmitEditing={() => send(input)}
                  returnKeyType="send"
                  blurOnSubmit={false}
                  style={styles.input}
                  selectionColor={colors.amber}
                />
              )}
              {streaming ? (
                // STOP — halt the in-flight reply; the prose so far stays.
                <Pressable
                  onPress={stopGuide}
                  style={styles.sendBtn}
                  accessibilityLabel="Stop response"
                >
                  <Ionicons name="stop" size={18} color={colors.background} />
                </Pressable>
              ) : canSend ? (
                <Pressable
                  onPress={() => send(input)}
                  style={styles.sendBtn}
                  accessibilityLabel="Send question"
                >
                  <Ionicons name="arrow-up" size={20} color={colors.background} />
                </Pressable>
              ) : (
                <Pressable
                  onLongPress={startRecording}
                  delayLongPress={180}
                  onPressOut={endRecording}
                  hitSlop={12}
                  style={[styles.micBtn, recording && styles.micBtnActive]}
                  accessibilityLabel={recording ? 'Release to send voice question' : 'Hold to record voice question'}
                >
                  <Ionicons name="mic" size={20} color={recording ? '#fff' : colors.amber} />
                </Pressable>
              )}
            </View>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function AIBubble({ text, opening }: { text: string; opening?: boolean }) {
  return (
    <View style={styles.aiBubble}>
      {/* Guide answers are written with markdown emphasis (**bold** /
          *italic*); render it via the zero-dep inline renderer so markers
          don't show as literal asterisks. The opening greeting is a fixed,
          markdown-free string in its own lighter font — left untouched. */}
      <Text style={[styles.aiText, opening && styles.aiTextOpening]}>
        {opening ? text : renderInlineMarkdown(text)}
      </Text>
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userBubble}>
      <Text style={styles.userText}>{text}</Text>
    </View>
  );
}

function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  // Sheet is positioned at top:0 — translateY (from sheetStyle) shifts
  // it down to its snap; height (also from sheetStyle) is set to
  // (SCREEN_HEIGHT − translateY) so the bottom always reaches the
  // bottom of the screen and the input bar inside is on-screen at
  // every snap. The static height: SCREEN_HEIGHT was the bug.
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: '#0e0e1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.2)',
  },
  flex: { flex: 1 },

  // Drag handle.
  handleArea: { paddingVertical: 12, alignItems: 'center' },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(240,237,232,0.2)',
  },

  headerWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 0.5,
  },
  title: {
    color: colors.amber,
    fontFamily: fonts.serifBold,
    fontSize: 20,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(230,180,122,0.55)',
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  closeBtn: {
    position: 'absolute',
    top: 0,
    right: 12,
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },

  // AI bubble — amber left-border blockquote.
  aiBubble: {
    borderLeftWidth: 2.5,
    borderLeftColor: colors.amber,
    paddingLeft: spacing.md,
    paddingVertical: 4,
    alignSelf: 'stretch',
  },
  aiText: {
    // v1.1.0 typography (round 3): same params as the main Chat tab's
    // bubble text (components/MessageBubble.styles.text) — Cormorant
    // SemiBold at 17/26 ls 0.15 — so the Ask modal feels like a
    // continuation of the same voice surface. Round 2 used 20/30
    // Regular to match Welcome paraCinematic, but that dominated the
    // bubble at chat-tab density; round 3 swaps to a heavier weight
    // at smaller size for the same "thick-stroke" perception without
    // the size cost.
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 17,
    lineHeight: 26,
    letterSpacing: 0.15,
  },
  aiTextOpening: {
    // Opening greeting reads as a distinct welcoming moment — keep it
    // visibly LIGHTER and SLIGHTLY LARGER than the regular AI body so
    // the contrast (Regular @ 19 vs SemiBold @ 17) signals "this is
    // an intro, not a reply." Same letter-spacing as Welcome
    // paraCinematic so the cinematic register survives.
    fontFamily: fonts.serif,
    fontSize: 19,
    lineHeight: 28,
    letterSpacing: 0.2,
    color: '#E8D8B8',
  },

  // User bubble.
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(230,180,122,0.12)',
    borderColor: 'rgba(230,180,122,0.4)',
    borderWidth: 0.5,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '85%',
  },
  userText: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 17,
    lineHeight: 26,
    letterSpacing: 0.15,
  },

  // Conversation starters.
  starters: { flexDirection: 'column', gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.4)',
    backgroundColor: 'rgba(230,180,122,0.08)',
    alignSelf: 'flex-start',
  },
  // v1.1.0 typography (round 2): starter pills are conversational
  // content on the Ask chat surface, not UI chrome — switch to the
  // chat bubble typeface so a starter and the AI's opening message
  // feel like one continuous voice. Pill geometry unchanged.
  chipText: {
    color: '#F0EDE8',
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 24,
  },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: spacing.md + 2,
    paddingVertical: 4,
  },
  loadingText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 13,
    letterSpacing: 0.3,
  },

  // Input bar.
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    gap: 8,
    backgroundColor: '#0e0e1a',
  },
  input: {
    flex: 1,
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(20,19,26,0.9)',
    borderWidth: 1.5, borderColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  micBtnActive: { backgroundColor: '#d4726a', borderColor: '#d4726a' },

  recordingPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: colors.border,
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
});
