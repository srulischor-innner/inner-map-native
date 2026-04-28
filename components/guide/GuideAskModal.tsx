// Guide tab → floating "Ask" chat. Bottom-sheet modal that slides up
// over whichever Guide pill the user is on. Same teaching-only chat as
// before (backed by /api/guide-chat — no markers, no map, no session
// save), now reachable from anywhere in the Guide tab without
// interrupting the slide experience.
//
// Voice notes: WhatsApp-style press-and-hold on the mic. Release →
// /api/transcribe → the transcript is sent as a regular text message
// (no audio bubble — keep it simple per the design brief).
//
// Conversation lives in component state and resets each time the modal
// is fully dismissed (parent passes a `key` change on close, or the
// component clears state on visible→true transition — we use the
// latter so the parent doesn't need to know).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  Platform, Animated, Easing,
  PanResponder, Alert, Keyboard,
} from 'react-native';
import { TypingIndicator } from '../TypingIndicator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync,
} from 'expo-audio';

import { colors, fonts, radii, spacing } from '../../constants/theme';
import { api, ChatMessage } from '../../services/api';

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
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const idRef = useRef(0);
  function nextId() { idRef.current += 1; return 'g' + idRef.current; }

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const dotPulse = useRef(new Animated.Value(1)).current;

  // Track the keyboard height so the bottom sheet can lift above it. We
  // do this manually instead of relying on KeyboardAvoidingView because
  // KAV plays poorly with transparent slide-up Modals on iOS — the
  // modal's overlay sits BELOW the keyboard region by default and the
  // keyboard ends up covering the input bar at the bottom of the sheet.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKbHeight(e.endCoordinates?.height || 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Reset state every time the modal becomes visible. Conversation never
  // persists across dismiss — keeps the surface educational and stateless.
  useEffect(() => {
    if (!visible) return;
    setTurns([]);
    setInput('');
    setLoading(false);
    setRecording(false);
    setTranscribing(false);
    setSeconds(0);
    idRef.current = 0;
  }, [visible]);

  // Cleanup timers on unmount.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  // Red dot pulse during recording.
  useEffect(() => {
    if (!recording) { dotPulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, { toValue: 1.2, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(dotPulse, { toValue: 1.0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, dotPulse]);

  // Swipe-down-to-dismiss gesture on the drag handle area.
  const dismissTranslate = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) dismissTranslate.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 80) {
          Haptics.selectionAsync().catch(() => {});
          onClose();
          // Reset for next open.
          dismissTranslate.setValue(0);
        } else {
          Animated.spring(dismissTranslate, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dismissTranslate, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      },
    }),
  ).current;

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    Haptics.selectionAsync().catch(() => {});
    const userTurn: Turn = { id: nextId(), role: 'user', text: trimmed };
    // Append user turn + an empty assistant turn we'll stream into.
    const assistantId = nextId();
    const nextTurns: Turn[] = [
      ...turns,
      userTurn,
      { id: assistantId, role: 'assistant', text: '' },
    ];
    setTurns(nextTurns);
    setInput('');
    setLoading(true);
    const apiMessages: ChatMessage[] = [...turns, userTurn].map((t) => ({
      role: t.role,
      content: t.text,
    }));
    let firstChunk = true;
    api.streamGuide(apiMessages, {
      onChunk: (chunk) => {
        // First chunk has arrived → drop the typing indicator.
        if (firstChunk) { firstChunk = false; setLoading(false); }
        setTurns((prev) => {
          const idx = prev.findIndex((t) => t.id === assistantId);
          if (idx === -1) return prev;
          const updated = prev.slice();
          updated[idx] = { ...updated[idx], text: updated[idx].text + chunk };
          return updated;
        });
        // Scroll to bottom as the bubble grows. Use animated:false so the
        // scroll itself doesn't fight with rapid chunks.
        setTimeout(() => {
          scrollRef.current?.scrollToEnd({ animated: false });
        }, 30);
      },
      onDone: () => {
        setLoading(false);
        // If no chunks ever arrived, replace the empty assistant bubble
        // with a polite error so the UI doesn't sit blank.
        setTurns((prev) => {
          const idx = prev.findIndex((t) => t.id === assistantId);
          if (idx === -1) return prev;
          const trimmedReply = prev[idx].text.trim();
          if (trimmedReply) {
            // Trim leading whitespace from heartbeat keep-alive spaces.
            const updated = prev.slice();
            updated[idx] = { ...updated[idx], text: trimmedReply };
            return updated;
          }
          const updated = prev.slice();
          updated[idx] = {
            ...updated[idx],
            text: "I couldn't reach the framework guide just now — try again in a moment?",
          };
          return updated;
        });
      },
      onError: (err) => {
        console.warn('[guide-chat] stream error:', err);
        setLoading(false);
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
  }, [turns, loading]);

  // ---- Voice note: WhatsApp-style press-and-hold ----
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
      // Send the transcript as a regular user message — no audio bubble.
      send(cleaned);
    } catch (err) {
      console.warn('[guide-ask-mic] endRecording failed:', (err as Error).message);
      setTranscribing(false);
    }
  }

  const showStarters = turns.length === 0 && !loading;
  const canSend = input.trim().length > 0 && !loading && !recording;

  // Auto-scroll to the bottom whenever the message list grows OR the
  // loading/transcribing indicators appear/disappear. The 100ms delay
  // gives the new bubble time to render into the layout before we
  // measure-and-scroll.
  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
    return () => clearTimeout(t);
  }, [turns.length, loading, transcribing, kbHeight]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        {/* Dim backdrop — purely visual, NOT tappable. The user dismisses
            via the X button in the header or a downward swipe on the
            drag handle so a stray tap can't blow away the conversation. */}
        <View style={styles.backdrop} pointerEvents="none" />

        <Animated.View
          style={[
            styles.sheet,
            // Lift the sheet by the keyboard height when it's open so the
            // input bar stays visible above the keyboard. When the
            // keyboard is closed we restore the safe-area bottom padding.
            kbHeight > 0
              ? { marginBottom: kbHeight, paddingBottom: 12 }
              : { paddingBottom: Math.max(insets.bottom, 12) },
            { transform: [{ translateY: dismissTranslate }] },
          ]}
        >
          {/* Drag handle area — swipe down or tap to dismiss. */}
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
          </View>

          {/* Header — title + subtitle centered, with an explicit X
              close button in the top-right so users always have a
              tap-to-dismiss affordance (since the backdrop is no
              longer tappable). */}
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

          {/* Inner content. The sheet's marginBottom (driven by the
              keyboard listener above) lifts the whole sheet — so the
              ScrollView simply fills the remaining sheet height. */}
          <View style={styles.flex}>
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => {
                // Belt-and-braces — also scroll on content-size growth so a
                // wrapping long bubble doesn't leave its tail offscreen.
                scrollRef.current?.scrollToEnd({ animated: true });
              }}
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
            <View style={styles.inputBar}>
              {recording ? (
                <View style={styles.recordingPill}>
                  <Animated.View style={[styles.recordingDot, { transform: [{ scale: dotPulse }] }]} />
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
              {canSend ? (
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
      </View>
    </Modal>
  );
}

function AIBubble({ text, opening }: { text: string; opening?: boolean }) {
  return (
    <View style={styles.aiBubble}>
      <Text style={[styles.aiText, opening && styles.aiTextOpening]}>{text}</Text>
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
  overlay: {
    flex: 1,
    // Dim is now applied by the absolute `backdrop` view below so the
    // overlay itself can stay free of pointer-event quirks. The sheet
    // anchors at the bottom via justifyContent: 'flex-end'.
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  closeBtn: {
    position: 'absolute',
    top: 8,
    right: 12,
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  sheet: {
    // maxHeight (not fixed height) so the keyboard listener can lift the
    // sheet via marginBottom without the layout fighting with a hard
    // height value. minHeight keeps the sheet substantial when the
    // keyboard is closed and the conversation is short.
    maxHeight: '75%',
    minHeight: '55%',
    backgroundColor: '#14131A',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(230,180,122,0.35)',
    overflow: 'hidden',
  },
  flex: { flex: 1 },

  // Drag handle.
  handleArea: { paddingVertical: 10, alignItems: 'center' },
  handle: {
    width: 42, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
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
    fontSize: 24,
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

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
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
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 24,
  },
  aiTextOpening: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 28,
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
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
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
  chipText: {
    color: '#F0EDE8',
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
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
    paddingVertical: spacing.sm,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    gap: 8,
    backgroundColor: '#14131A',
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
