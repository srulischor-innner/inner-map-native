// One chat bubble — user or assistant.
//
// AI bubbles carry:
//   - optional PartBadge (the detected part)
//   - a small 🔊 speaker button that plays THIS message aloud on demand via
//     /api/speak + expo-audio. Tapping again while playing stops playback.
//     No auto-play: TTS only happens when the user explicitly asks for it.
//   - a blinking caret while the message is still streaming.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet, PanResponder, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  createAudioPlayer, setAudioModeAsync,
} from 'expo-audio';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, fonts, radii, spacing } from '../constants/theme';
import { PartBadge } from './PartBadge';
import {
  acquireSlot, releaseSlot, usePlayingId, useIsPlaying,
  useAudioMode, setAudioMode, playTTS, togglePauseResume,
  getCurrentMessageId, getAudioMode,
} from '../utils/ttsPlayer';

export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  detectedPart?: string | null;
  partLabel?: string | null;
  streaming?: boolean;
  /** Present on user voice-note messages. The bubble renders a play button +
   *  waveform + duration + the transcript below a hairline divider. While
   *  the transcript is still being produced, `transcript` is null and the
   *  bubble shows a "Transcribing…" line instead. */
  voice?: { uri: string; durationSec: number; transcript: string | null };
};

const SPEAKER_HINT_KEY = 'speakerLongPressHintSeen.v1';

export function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user';
  // Slot ownership + session-wide audio mode + play/pause state come from
  // the shared ttsPlayer service. Speaker icon variants:
  //   audioMode OFF, slot ≠ ours          → dim speaker (40% cream)
  //   audioMode ON,  slot ≠ ours          → bright amber speaker
  //   slot == ours, currently playing     → amber pause icon ⏸
  //   slot == ours, currently paused      → amber play icon ▶
  const playingId = usePlayingId();
  const audioModeOn = useAudioMode();
  const isOwner = playingId === msg.id;
  const playingNow = useIsPlaying(); // true when ttsPlayer's clip is playing
  const isPlaying = isOwner && playingNow;
  const isPaused  = isOwner && !playingNow;
  // Spinner gate — show only if a fetch takes longer than 500ms.
  const [loading, setLoading] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // First-tap tooltip ("Long-press to turn audio mode off") shown ONCE
  // per device after the user first taps any speaker icon.
  const [hintVisible, setHintVisible] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
  }, []);

  async function maybeShowFirstTapHint() {
    try {
      const seen = await AsyncStorage.getItem(SPEAKER_HINT_KEY);
      if (seen === '1') return;
      setHintVisible(true);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setHintVisible(false), 3000);
      AsyncStorage.setItem(SPEAKER_HINT_KEY, '1').catch(() => {});
    } catch {}
  }

  /** TAP the speaker icon. State machine per spec:
   *    - We OWN the slot AND playing  → pause (audio mode stays ON)
   *    - We OWN the slot AND paused   → resume (audio mode stays ON)
   *    - We're not the owner          → switch to us (or turn audio mode
   *                                      ON if it was OFF) and play this
   *  Long-press = turn audio mode OFF entirely (handled separately).
   *
   *  CRITICAL: read ownership from the LIVE module state, not the React
   *  state captured in this closure. If a user taps the same speaker
   *  twice in quick succession, the second tap's render hasn't happened
   *  yet — the captured `isOwner`/`audioModeOn` would still be false.
   *  Without this, the second tap calls playTTS() instead of the
   *  pause path, and we get TWO players overlapping. (This was the
   *  reported regression.) */
  async function handleTap() {
    Haptics.selectionAsync().catch(() => {});
    // Surface the long-press tip the first time the user uses the speaker.
    maybeShowFirstTapHint();
    const ownerNow = getCurrentMessageId() === msg.id;
    if (ownerNow) {
      togglePauseResume(msg.id);
      return;          // do NOT fall through — would create a second player
    }
    if (!getAudioMode()) await setAudioMode(true);
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => setLoading(true), 500);
    try {
      await playTTS(msg.id, msg.text);
    } catch (e) {
      console.warn('[tts] handleTap failed:', (e as Error)?.message);
    } finally {
      if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null; }
      setLoading(false);
    }
  }

  /** LONG-PRESS the speaker icon → turn audio mode OFF entirely.
   *  Stops any playing clip + flips the session flag. All speaker icons
   *  app-wide will revert to dim default on the next render tick. */
  async function handleLongPress() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    await setAudioMode(false);
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
          <Text style={styles.text}>
            {msg.text}
            {msg.streaming ? <StreamCaret /> : null}
          </Text>
        )}
        {!isUser && msg.detectedPart ? (
          <PartBadge part={msg.detectedPart} label={msg.partLabel} />
        ) : null}
        {/* Speaker icon. THREE visual states per spec:
              default (audio mode OFF, not us)  → dim speaker, 40% cream
              active  (audio mode ON,  not us)  → bright amber speaker
              playing (slot owner is us)        → amber pause icon
            Tapping the icon also flips session-wide audio mode — see
            togglePlayback() above for the full state machine. */}
        {!isUser && !msg.streaming && msg.text.trim() ? (
          <View style={styles.speakerWrap}>
            {hintVisible ? (
              <View style={styles.speakerHint} pointerEvents="none">
                <Text style={styles.speakerHintText}>Long-press to turn audio mode off</Text>
              </View>
            ) : null}
            <Pressable
              onPress={handleTap}
              onLongPress={handleLongPress}
              delayLongPress={400}
              hitSlop={12}
              style={styles.speakerBtn}
              accessibilityLabel={
                isPlaying ? 'Pause this voice note (long-press to turn off audio mode)'
                : isPaused ? 'Resume this voice note'
                : audioModeOn ? 'Switch audio to this message'
                : 'Turn on audio and read this message aloud'
              }
            >
              {loading ? (
                <ActivityIndicator size="small" color={colors.amber} />
              ) : (
                <Ionicons
                  name={
                    isPlaying ? 'pause'
                    : isPaused ? 'play'
                    : 'volume-medium-outline'
                  }
                  size={16}
                  color={
                    isOwner ? '#E6B47A'
                    : audioModeOn ? '#E6B47A'
                    : 'rgba(240,237,232,0.4)'
                  }
                />
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
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
  // Subscribe to the shared playing-id slot so a second voice note (or the
  // TTS speaker on an AI bubble) can kick us out of the play state without
  // needing a prop drill.
  const activePlayingId = usePlayingId();

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

  // If another voice note / TTS claimed the slot → pause ours. Reads the
  // shared playing-id from ttsPlayer so any owner change anywhere mutes
  // this bubble's local player.
  useEffect(() => {
    if (playing && activePlayingId !== id) {
      try { playerRef.current?.pause(); } catch {}
      setPlaying(false);
      stopPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlayingId]);

  // Release the native player on unmount — prevents leaks if the session is
  // reset while a bubble is cached in the Messages list.
  useEffect(() => () => {
    stopPolling();
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
    playerRef.current = null;
    releaseSlot(id);
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
          releaseSlot(id);
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
    // PLAY (or resume). Claim the slot via ttsPlayer.acquireSlot — that
    // tears down any TTS player + fires eviction callbacks for any other
    // voice note that holds the slot. We pass our own pause as the
    // eviction callback.
    setLoading(true);
    try {
      const p = await ensurePlayer();
      await acquireSlot(id, () => {
        try { playerRef.current?.pause(); } catch {}
        setPlaying(false);
        stopPolling();
      });
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
});
