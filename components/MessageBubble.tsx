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

import { colors, fonts, radii, spacing } from '../constants/theme';
import { api } from '../services/api';
import { PartBadge } from './PartBadge';
import { ensureTTS, getCachedTTS } from '../utils/ttsCache';

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

// One shared player slot — tapping the speaker on a new bubble stops playback
// on the previous bubble. Keeps the UI unambiguous about which reply is
// currently being read aloud.
let currentPlayer: ReturnType<typeof createAudioPlayer> | null = null;
let currentPlayerOwnerId: string | null = null;
const listeners = new Set<(playingId: string | null) => void>();
function setPlayingId(id: string | null) {
  currentPlayerOwnerId = id;
  listeners.forEach((l) => l(id));
}
function usePlayingId() {
  const [id, setId] = useState<string | null>(currentPlayerOwnerId);
  useEffect(() => {
    listeners.add(setId);
    return () => { listeners.delete(setId); };
  }, []);
  return id;
}

export function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user';
  const playingId = usePlayingId();
  const isPlaying = playingId === msg.id;
  // Local player kept alive across pauses so Tap-pause → Tap-resume picks up
  // exactly where it left off. Survives isPlaying toggles; only released on
  // a different message claiming the slot (via the useEffect below) or on
  // component unmount.
  const localPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const [loading, setLoading] = useState(false);
  // Show the spinner only if the fetch takes more than 500ms — a cache hit
  // feels instant and shouldn't flash a spinner for a single frame.
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When a different message claims the playing slot, tear down our local
  // player — it's ours no longer and keeping it loaded wastes memory.
  useEffect(() => {
    if (playingId && playingId !== msg.id && localPlayerRef.current) {
      try { localPlayerRef.current.pause(); localPlayerRef.current.remove(); } catch {}
      localPlayerRef.current = null;
    }
  }, [playingId, msg.id]);

  // Unmount cleanup — always release the native player and clear the
  // singleton slot if we still own it.
  useEffect(() => () => {
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    try { localPlayerRef.current?.pause(); localPlayerRef.current?.remove(); } catch {}
    localPlayerRef.current = null;
    if (currentPlayerOwnerId === msg.id) setPlayingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function togglePlayback() {
    Haptics.selectionAsync().catch(() => {});
    // --- Case 1: this message is already the one playing → pause ---
    if (isPlaying && localPlayerRef.current) {
      try { localPlayerRef.current.pause(); } catch {}
      setPlayingId(null);
      return;
    }
    // --- Case 2: we already have a loaded player (paused earlier) → resume ---
    if (localPlayerRef.current && !isPlaying) {
      try {
        await setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'mixWithOthers', shouldPlayInBackground: false,
        });
      } catch {}
      // Kick out whoever else holds the slot (other bubble / voice note).
      setPlayingId(msg.id);
      try { localPlayerRef.current.play(); } catch (e) {
        console.warn('[tts] resume failed:', (e as Error)?.message);
      }
      watchForFinish(localPlayerRef.current, msg.id);
      return;
    }
    // --- Case 3: first play — create a player, ideally from cache ---
    // Delay the spinner by 500ms so cache hits don't flash.
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => setLoading(true), 500);
    try {
      try {
        await setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'mixWithOthers', shouldPlayInBackground: false,
        });
      } catch {}
      // Try cache first — instant path.
      let uri = getCachedTTS(msg.id);
      if (!uri) {
        // Miss → await the in-flight prefetch (or kick one off). This is
        // the slow path but the spinner already covers it.
        const fallback = await ensureTTS(msg.id, msg.text);
        uri = fallback || null;
      }
      if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null; }
      setLoading(false);
      if (!uri) return;
      const player = createAudioPlayer({ uri });
      localPlayerRef.current = player;
      setPlayingId(msg.id);
      try { player.play(); } catch (e) {
        console.warn('[tts] play failed:', (e as Error)?.message);
      }
      watchForFinish(player, msg.id);
    } catch (e) {
      console.warn('[tts] togglePlayback failed:', (e as Error)?.message);
      if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null; }
      setLoading(false);
      setPlayingId(null);
    }
  }

  /** Lightweight poll — when the clip finishes, reset UI + release the
   *  native player so the next tap starts fresh from zero. */
  function watchForFinish(player: ReturnType<typeof createAudioPlayer>, ownerId: string) {
    const watch = async () => {
      while (localPlayerRef.current === player) {
        try {
          const s = player.currentStatus;
          if (s?.didJustFinish) break;
          if (s?.isLoaded === false) break;
        } catch { break; }
        await new Promise((r) => setTimeout(r, 250));
      }
      // Finished cleanly — release + reset so a fresh tap starts at 0.
      if (localPlayerRef.current === player) {
        try { player.remove(); } catch {}
        localPlayerRef.current = null;
        if (currentPlayerOwnerId === ownerId) setPlayingId(null);
      }
    };
    watch();
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
        {/* Speaker button only on AI messages once streaming is complete.
            Three visual states per spec:
              default: dim speaker (volume-medium-outline) in 40% cream
              playing: amber pause icon (#E6B47A)
              loading: ActivityIndicator — only shown after 500ms delay */}
        {!isUser && !msg.streaming && msg.text.trim() ? (
          <Pressable
            onPress={togglePlayback}
            hitSlop={12}
            style={styles.speakerBtn}
            accessibilityLabel={isPlaying ? 'Pause reading aloud' : 'Read aloud'}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.amber} />
            ) : (
              <Ionicons
                name={isPlaying ? 'pause' : 'volume-medium-outline'}
                size={16}
                color={isPlaying ? '#E6B47A' : 'rgba(240,237,232,0.4)'}
              />
            )}
          </Pressable>
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

  // If another voice note / TTS claimed the slot → pause ours.
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
    if (currentPlayerOwnerId === id) setPlayingId(null);
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
          if (currentPlayerOwnerId === id) setPlayingId(null);
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
    // PLAY (or resume). Claim the singleton slot FIRST so other bubbles pause.
    setLoading(true);
    try {
      const p = await ensurePlayer();
      // Stop any other bubble via the pub/sub slot.
      if (currentPlayerOwnerId && currentPlayerOwnerId !== id) {
        setPlayingId(id); // other owners will pause via their useEffect
      } else {
        setPlayingId(id);
      }
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
  speakerBtn: {
    position: 'absolute',
    right: 6, bottom: 4,
    padding: 4,
    opacity: 0.9,
  },
});
