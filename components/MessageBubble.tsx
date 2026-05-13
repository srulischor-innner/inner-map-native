// One chat bubble — user or assistant.
//
// AI bubbles carry:
//   - optional PartBadge (the detected part)
//   - a blinking caret while the message is still streaming.
//
// Per-message speaker icons WERE here. They've been removed in favor of
// a single session-level mute/unmute toggle in the chat tab header.
// See components/AudioToggle.tsx.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet, PanResponder, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  createAudioPlayer, setAudioModeAsync,
} from 'expo-audio';

import { colors, fonts, radii, spacing } from '../constants/theme';
import { PartBadge } from './PartBadge';
import { parseAddedToMapMarkers, parseShareSuggestMarkers } from '../utils/markers';
import { MapPill } from './chat/MapPill';
import { SharePromptCard } from './chat/SharePromptCard';

export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  detectedPart?: string | null;
  partLabel?: string | null;
  streaming?: boolean;
  /** Set on assistant bubbles that landed via the error path. When set,
   *  the bubble renders a small "Retry" pill below the text; tapping it
   *  re-submits the user's last message. The string is the text to send. */
  errorRetryText?: string | null;
  /** Set when this "bubble" should render as the daily rate-limit
   *  card instead of a regular AI message. No avatar, no caret, no
   *  retry pill — just a centered amber-bordered card with the
   *  server-prepared message. */
  rateLimited?: boolean;
  /** Present on user voice-note messages. The bubble renders a play button +
   *  waveform + duration + the transcript below a hairline divider. While
   *  the transcript is still being produced, `transcript` is null and the
   *  bubble shows a "Transcribing…" line instead. */
  voice?: { uri: string; durationSec: number; transcript: string | null };
};

export function MessageBubble({
  msg, onRetry, relationshipId, partnerName,
}: {
  msg: ChatMsg;
  onRetry?: (text: string) => void;
  /** When the bubble is in a relationship-mode private chat, these
   *  props enable inline [SHARE_SUGGEST: …] marker rendering as
   *  <SharePromptCard> components. Omitted in the main chat tab —
   *  the marker is then preserved but no card renders (the marker
   *  is also stripped from history by stripMarkers, so the model
   *  doesn't see it echoed back). */
  relationshipId?: string;
  partnerName?: string | null;
}) {
  const isUser = msg.role === 'user';
  // Daily rate-limit card — different visual treatment from a chat
  // bubble. Centered, amber-bordered, the server-prepared copy reads
  // as a system note rather than an AI utterance. Renders early so
  // none of the bubble-specific branches below (streaming caret,
  // retry pill, part badge) need to add rate-limit guards.
  if (!isUser && msg.rateLimited) {
    return (
      <View style={styles.rateLimitRow}>
        <View style={styles.rateLimitCard}>
          <Ionicons name="time-outline" size={16} color={colors.amber} style={styles.rateLimitIcon} />
          <Text style={styles.rateLimitText}>{msg.text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
        {msg.voice ? (
          <VoiceNoteBubble
            id={msg.id}
            uri={msg.voice.uri}
            durationSec={msg.voice.durationSec}
            transcript={msg.voice.transcript}
          />
        ) : (
          <AssistantBubbleBody
            text={msg.text}
            streaming={!!msg.streaming}
            relationshipId={relationshipId}
            partnerName={partnerName ?? null}
          />
        )}
        {!isUser && msg.detectedPart ? (
          <PartBadge part={msg.detectedPart} label={msg.partLabel} />
        ) : null}
        {!isUser && msg.errorRetryText && onRetry ? (
          <Pressable
            onPress={() => onRetry(msg.errorRetryText as string)}
            hitSlop={8}
            style={styles.retryPill}
            accessibilityLabel="Retry sending this message"
          >
            <Ionicons name="refresh" size={12} color={colors.amber} />
            <Text style={styles.retryPillText}>RETRY</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ============================================================================
// AssistantBubbleBody — splits the bubble text on [ADDED_TO_MAP: …]
// markers and renders <MapPill> components inline at each marker
// position.
//
// Fast path: no markers in the text → single <Text> with the
// streaming caret tail, identical to the pre-PR-Map-Visibility
// rendering. No layout impact on the 99% of messages that never
// contain a pill marker.
//
// Slow path: markers present → split the text into segments,
// render each text segment as its own <Text> child of a wrapping
// <View>, and inject <MapPill /> at each marker position. The
// streaming caret is attached only to the FINAL text segment so
// a mid-bubble pill doesn't carry a phantom caret. If the message
// ends with a pill marker (no trailing text), the caret is omitted
// — the marker is the terminal element.
//
// Edge cases:
//   - Empty text → render an empty <Text> (no pills can match).
//   - Partial / malformed marker (no closing bracket yet because
//     the AI is still streaming) → parseAddedToMapMarkers strict-
//     matches only complete forms, so the partial marker text
//     stays in the bubble as plain text until the closing bracket
//     arrives. No crash; spec-required fallback behavior.
//   - Multiple markers in one message → each gets its own pill,
//     positioned in document order.
// ============================================================================
function AssistantBubbleBody({
  text, streaming, relationshipId, partnerName,
}: {
  text: string;
  streaming: boolean;
  relationshipId?: string;
  partnerName?: string | null;
}) {
  // Find every inline marker that has a renderable component:
  //   - ADDED_TO_MAP    → <MapPill name=... />
  //   - SHARE_SUGGEST   → <SharePromptCard suggestion=.../>  (only
  //     rendered when relationshipId is set — main-chat usage
  //     leaves the marker as plain text, but stripMarkers will
  //     have already removed it from history so the model doesn't
  //     see its own pill marker echoed back).
  //
  // Markers are merged into one sorted array so a single sweep
  // splices the right component at the right position.
  type Splice = { start: number; end: number; node: React.ReactNode };
  const splices: Splice[] = useMemo(() => {
    const out: Splice[] = [];
    for (const m of parseAddedToMapMarkers(text)) {
      out.push({
        start: m.start, end: m.end,
        node: <MapPill key={`map-${m.start}`} name={m.name} />,
      });
    }
    if (relationshipId) {
      for (const m of parseShareSuggestMarkers(text)) {
        out.push({
          start: m.start, end: m.end,
          node: (
            <SharePromptCard
              key={`share-${m.start}`}
              suggestion={m.suggestion}
              relationshipId={relationshipId}
              partnerName={partnerName ?? null}
            />
          ),
        });
      }
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }, [text, relationshipId, partnerName]);

  if (splices.length === 0) {
    return (
      <Text style={styles.text}>
        {text}
        {streaming ? <StreamCaret /> : null}
      </Text>
    );
  }
  // Build alternating chunks: text, node, text, node, ...
  const chunks: React.ReactNode[] = [];
  let cursor = 0;
  splices.forEach((s, i) => {
    const before = text.slice(cursor, s.start);
    if (before) {
      chunks.push(
        <Text key={`t-${i}`} style={styles.text}>{before}</Text>,
      );
    }
    chunks.push(s.node);
    cursor = s.end;
  });
  const tail = text.slice(cursor);
  if (tail || streaming) {
    chunks.push(
      <Text key="tail" style={styles.text}>
        {tail}
        {streaming ? <StreamCaret /> : null}
      </Text>,
    );
  }
  return <View>{chunks}</View>;
}

// ============================================================================
// VoiceNoteBubble — play/pause + static waveform + duration. Uses expo-audio's
// createAudioPlayer pointed at the local file URI expo-audio saved when the
// user released the press-and-hold mic in ChatInput. Singleton pattern with
// currentPlayer lets tapping another voice note auto-stop the previous.
// ============================================================================
function VoiceNoteBubble({
  id, uri, durationSec, transcript,
}: {
  id: string;
  uri: string;
  durationSec: number;
  transcript: string | null;
}) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  // Live playback position in seconds — drives the progress coloring on the
  // waveform AND the "0:03 / 0:08" counter. Updated every 100ms while the
  // player is active.
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Measured width of the waveform view — used to map finger x → seek seconds
  // for both tap-to-seek and drag-to-scrub.
  const waveformWidthRef = useRef<number>(0);
  // (Voice notes used to coordinate with the AI-message TTS player via a
  // shared slot. That coordination layer was removed when audio became a
  // simple session-level toggle. Each voice note now manages its own
  // playback in isolation — if you want it paused, tap pause yourself.)

  // 20 fixed-height bars derived from the URI hash so the waveform is stable
  // across renders but different per message.
  const bars = useMemo(() => {
    let seed = 0;
    for (let i = 0; i < uri.length; i++) seed = (seed * 31 + uri.charCodeAt(i)) >>> 0;
    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const t = (seed & 0xffff) / 0xffff;
      const edgeFade = 1 - Math.abs((i - 9.5) / 10);
      out.push(6 + Math.round(t * 16 * edgeFade));
    }
    return out;
  }, [uri]);

  // Release the native player on unmount — prevents leaks if the session is
  // reset while a bubble is cached in the Messages list.
  useEffect(() => () => {
    stopPolling();
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
    playerRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const s = p.currentStatus;
        const t = typeof s?.currentTime === 'number' ? s.currentTime : 0;
        setCurrentTime(t);
        if (s?.didJustFinish) {
          // Reached the end — reset UI so next tap plays from the start.
          stopPolling();
          try { p.seekTo(0); } catch {}
          setCurrentTime(0);
          setPlaying(false);
        }
      } catch {}
    }, 100);
  }

  async function ensurePlayer() {
    if (playerRef.current) return playerRef.current;
    try {
      await setAudioModeAsync({
        allowsRecording: false, playsInSilentMode: true,
        interruptionMode: 'mixWithOthers', shouldPlayInBackground: false,
      });
    } catch {}
    const p = createAudioPlayer({ uri });
    playerRef.current = p;
    return p;
  }

  async function toggle() {
    Haptics.selectionAsync().catch(() => {});
    // PAUSE — keep the player alive so a later tap resumes from here.
    if (playing) {
      try { playerRef.current?.pause(); } catch {}
      setPlaying(false);
      stopPolling();
      return;
    }
    // PLAY (or resume) this voice note's own player. No cross-bubble
    // coordination — the audio mode toggle controls AI-message TTS;
    // user voice notes are tap-to-play in isolation.
    setLoading(true);
    try {
      const p = await ensurePlayer();
      p.play();
      setPlaying(true);
      setLoading(false);
      startPolling();
    } catch (e) {
      console.warn('[voice-note] play failed:', (e as Error).message);
      setLoading(false);
      setPlaying(false);
    }
  }

  async function seekToRatio(ratio: number) {
    const r = Math.max(0, Math.min(1, ratio));
    const secs = durationSec * r;
    const p = await ensurePlayer();
    try { await p.seekTo(secs); } catch (e) {
      console.warn('[voice-note] seek failed:', (e as Error).message);
    }
    setCurrentTime(secs);
  }

  function onWaveformLayout(e: LayoutChangeEvent) {
    waveformWidthRef.current = e.nativeEvent.layout.width;
  }

  // Tap / drag scrubbing on the waveform. PanResponder captures the gesture
  // (including initial tap) so both a single tap on a bar AND a finger drag
  // across the waveform seek the audio. locationX is relative to the
  // responder view — exactly what we want.
  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const w = waveformWidthRef.current;
        if (w > 0) seekToRatio(evt.nativeEvent.locationX / w);
      },
      onPanResponderMove: (evt) => {
        const w = waveformWidthRef.current;
        if (w > 0) {
          const x = Math.max(0, Math.min(w, evt.nativeEvent.locationX));
          seekToRatio(x / w);
        }
      },
    }),
    // uri + durationSec captured by seekToRatio's closure; re-creating on
    // those changes keeps the handler consistent if the same bubble ever
    // gets a different source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uri, durationSec],
  );

  const ratio = durationSec > 0 ? Math.min(1, currentTime / durationSec) : 0;
  // Fractional bar position so the color-cutoff moves smoothly across the
  // 20-bar waveform (e.g. 7.4 means bars 0-7 lit, bar 8 partially, 9-19 dim).
  const playedBoundary = ratio * 20;

  const counterText = playing
    ? `${formatDuration(currentTime)} / ${formatDuration(durationSec)}`
    : formatDuration(durationSec);

  return (
    <View>
      <View style={voiceStyles.row}>
        <Pressable
          onPress={toggle}
          style={voiceStyles.playBtn}
          accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
          hitSlop={6}
        >
          {loading ? (
            <Ionicons name="sync" size={18} color={colors.amber} />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.amber} />
          )}
        </Pressable>

        {/* Waveform — tap to seek, drag to scrub. Wrapped in a View that
            owns the PanResponder handlers + onLayout measurement. */}
        <View
          style={voiceStyles.waveform}
          onLayout={onWaveformLayout}
          {...panResponder.panHandlers}
        >
          {bars.map((h, i) => (
            <View
              key={i}
              style={[
                voiceStyles.bar,
                {
                  height: h,
                  // Bar at index i is "played" if its center falls below
                  // the fractional boundary — gives a smooth progressing
                  // dividing line as currentTime advances.
                  backgroundColor: i + 0.5 <= playedBoundary ? '#E6B47A' : 'rgba(230,180,122,0.3)',
                },
              ]}
            />
          ))}
        </View>

        <Text style={voiceStyles.duration}>{counterText}</Text>
      </View>

      {/* Transcript row below the hairline divider. */}
      <View style={voiceStyles.transcriptWrap}>
        {transcript === null ? (
          <Text style={voiceStyles.transcriptPending}>Transcribing…</Text>
        ) : transcript.trim() ? (
          <Text style={voiceStyles.transcriptText}>{transcript}</Text>
        ) : (
          <Text style={voiceStyles.transcriptPending}>(nothing heard)</Text>
        )}
      </View>
    </View>
  );
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

const voiceStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 240,
  },
  playBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.amberDim,
    backgroundColor: 'rgba(230,180,122,0.1)',
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 24,
  },
  bar: {
    width: 2.5,
    borderRadius: 1.5,
    // backgroundColor is set inline per-bar based on playback progress.
  },
  duration: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    // Wider — "0:03 / 0:08" is ~10 glyphs; the idle state "0:08" fits fine
    // in the same column so the play button doesn't jump horizontally when
    // playback toggles.
    minWidth: 70,
    textAlign: 'right',
  },
  transcriptWrap: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(230,180,122,0.2)',
  },
  transcriptText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(240,237,232,0.85)',
  },
  transcriptPending: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontStyle: 'italic',
    color: 'rgba(240,237,232,0.55)',
  },
});

// ---- helpers ----
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return globalThis.btoa ? globalThis.btoa(binary) : '';
}

// Soft blinking amber caret shown at the tail of a streaming assistant message.
function StreamCaret() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={[styles.caret, { opacity }]}>▍</Animated.Text>;
}

const styles = StyleSheet.create({
  row: { marginBottom: spacing.sm, flexDirection: 'row' },
  // Wider bubbles — the old 40px indents made messages feel cramped. 16 lets
  // the text breathe across the screen while still signalling user vs AI via
  // left/right alignment.
  rowUser: { justifyContent: 'flex-end', paddingLeft: 16 },
  rowAssistant: { justifyContent: 'flex-start', paddingRight: 16 },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.md,
    maxWidth: '100%',
    position: 'relative',
  },
  assistant: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    // Full border all the way around, warm amber, radii.md corners with a
    // tiny 2px top-left corner so the bubble still reads as "from the AI
    // side" without the old heavy-handed left stripe.
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.25)',
    borderRadius: 12,
    borderTopLeftRadius: 2,
    paddingBottom: 24, // room for the absolute speaker button
  },
  user: {
    backgroundColor: 'rgba(230,180,122,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.35)',
    borderRadius: 12,
    borderBottomRightRadius: 2,
  },
  text: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
  },
  caret: { color: colors.amber, fontSize: 14 },
  // Retry pill for failed assistant messages — small inline affordance
  // beneath the bubble text. Tapping re-submits the original user input.
  retryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(230,180,122,0.4)',
  },
  retryPillText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  speakerWrap: {
    position: 'absolute',
    right: 6, bottom: 4,
  },
  speakerBtn: {
    padding: 4,
    opacity: 0.9,
  },
  // First-tap tip — sits ABOVE the speaker icon, points at it. Auto-fades
  // after 3s and only ever shows once per device (AsyncStorage flag).
  speakerHint: {
    position: 'absolute',
    bottom: 36,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,20,30,0.95)',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.3)',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  speakerHintText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  // Daily rate-limit card — centered, amber-bordered, distinct from
  // chat bubbles so the user reads it as a system note rather than an
  // AI utterance. Sits in the conversation flow at the point the
  // user's request would have produced a reply.
  rateLimitRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  rateLimitCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    backgroundColor: 'rgba(230,180,122,0.06)',
    borderColor: colors.amber,
    borderWidth: 0.5,
    borderRadius: radii.md,
    maxWidth: '90%',
  },
  rateLimitIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  rateLimitText: {
    flex: 1,
    color: colors.cream,
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: 0.2,
  },
});
