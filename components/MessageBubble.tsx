// One chat bubble — user or assistant.
//
// AI bubbles carry:
//   - optional PartBadge (the detected part)
//   - a small 🔊 speaker button that plays THIS message aloud on demand via
//     /api/speak + expo-audio. Tapping again while playing stops playback.
//     No auto-play: TTS only happens when the user explicitly asks for it.
//   - a blinking caret while the message is still streaming.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  createAudioPlayer, setAudioModeAsync,
} from 'expo-audio';

import { colors, fonts, radii, spacing } from '../constants/theme';
import { api } from '../services/api';
import { PartBadge } from './PartBadge';

export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  detectedPart?: string | null;
  partLabel?: string | null;
  streaming?: boolean;
  /** Present on user voice-note messages. The bubble renders a play button +
   *  waveform + duration instead of the text string. The text field still
   *  holds the transcript so the AI sees what was said. */
  voice?: { uri: string; durationSec: number };
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
  const [loading, setLoading] = useState(false);

  async function togglePlayback() {
    Haptics.selectionAsync().catch(() => {});
    if (isPlaying) {
      try { currentPlayer?.pause(); currentPlayer?.remove(); } catch {}
      currentPlayer = null;
      setPlayingId(null);
      return;
    }
    // Stop anything else currently playing first.
    try { currentPlayer?.pause(); currentPlayer?.remove(); } catch {}
    currentPlayer = null;
    setPlayingId(null);

    setLoading(true);
    try {
      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          interruptionMode: 'mixWithOthers',
          shouldPlayInBackground: false,
        });
      } catch {}
      const buf = await api.speak(msg.text);
      if (!buf) { setLoading(false); return; }
      const dataUri = 'data:audio/mpeg;base64,' + bufferToBase64(buf);
      const player = createAudioPlayer({ uri: dataUri });
      currentPlayer = player;
      setPlayingId(msg.id);
      setLoading(false);
      player.play();
      // Poll for completion — lightweight and doesn't depend on expo-audio
      // event APIs that vary across SDK versions.
      const watch = async () => {
        while (currentPlayer === player) {
          try {
            const s = player.currentStatus;
            if (s?.didJustFinish || s?.isLoaded === false) break;
          } catch { break; }
          await new Promise((r) => setTimeout(r, 250));
        }
        try { player.remove(); } catch {}
        if (currentPlayer === player) { currentPlayer = null; setPlayingId(null); }
      };
      watch();
    } catch (e) {
      console.warn('[tts] play failed:', (e as Error).message);
      setLoading(false);
      setPlayingId(null);
    }
  }

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
        {msg.voice ? (
          <VoiceNoteBubble uri={msg.voice.uri} durationSec={msg.voice.durationSec} />
        ) : (
          <Text style={styles.text}>
            {msg.text}
            {msg.streaming ? <StreamCaret /> : null}
          </Text>
        )}
        {!isUser && msg.detectedPart ? (
          <PartBadge part={msg.detectedPart} label={msg.partLabel} />
        ) : null}
        {/* Speaker button only on AI messages once streaming is complete. */}
        {!isUser && !msg.streaming && msg.text.trim() ? (
          <Pressable
            onPress={togglePlayback}
            hitSlop={6}
            style={styles.speakerBtn}
            accessibilityLabel={isPlaying ? 'Stop reading aloud' : 'Read aloud'}
          >
            <Ionicons
              name={
                loading ? 'sync' :
                isPlaying ? 'volume-high' :
                'volume-medium-outline'
              }
              size={14}
              color={isPlaying ? colors.amber : colors.creamFaint}
            />
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
function VoiceNoteBubble({ uri, durationSec }: { uri: string; durationSec: number }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  // 20 fixed-height bars derived from the URI hash so the waveform is stable
  // across renders but different per message. Not a real audio analysis —
  // purely visual.
  const bars = useMemo(() => {
    let seed = 0;
    for (let i = 0; i < uri.length; i++) seed = (seed * 31 + uri.charCodeAt(i)) >>> 0;
    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const t = (seed & 0xffff) / 0xffff;
      // Amplitude curve — taller toward the middle, shorter at edges.
      const edgeFade = 1 - Math.abs((i - 9.5) / 10);
      out.push(6 + Math.round(t * 16 * edgeFade));
    }
    return out;
  }, [uri]);

  async function toggle() {
    Haptics.selectionAsync().catch(() => {});
    if (playing) {
      try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
      playerRef.current = null;
      setPlaying(false);
      return;
    }
    // Stop anything else playing (TTS from another bubble, etc).
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch {}
    setLoading(true);
    try {
      try {
        await setAudioModeAsync({
          allowsRecording: false, playsInSilentMode: true,
          interruptionMode: 'mixWithOthers', shouldPlayInBackground: false,
        });
      } catch {}
      const player = createAudioPlayer({ uri });
      playerRef.current = player;
      setPlaying(true);
      setLoading(false);
      player.play();
      const watch = async () => {
        while (playerRef.current === player) {
          try {
            const s = player.currentStatus;
            if (s?.didJustFinish || s?.isLoaded === false) break;
          } catch { break; }
          await new Promise((r) => setTimeout(r, 250));
        }
        try { player.remove(); } catch {}
        if (playerRef.current === player) { playerRef.current = null; setPlaying(false); }
      };
      watch();
    } catch (e) {
      console.warn('[voice-note] play failed:', (e as Error).message);
      setLoading(false);
      setPlaying(false);
    }
  }

  return (
    <Pressable onPress={toggle} style={voiceStyles.row} accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}>
      <View style={voiceStyles.playBtn}>
        {loading ? (
          <Ionicons name="sync" size={18} color={colors.amber} />
        ) : (
          <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.amber} />
        )}
      </View>
      <View style={voiceStyles.waveform}>
        {bars.map((h, i) => (
          <View key={i} style={[voiceStyles.bar, { height: h }]} />
        ))}
      </View>
      <Text style={voiceStyles.duration}>{formatDuration(durationSec)}</Text>
    </Pressable>
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
    minWidth: 200,
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
    backgroundColor: colors.amber,
    borderRadius: 1.5,
    opacity: 0.8,
  },
  duration: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    minWidth: 32,
    textAlign: 'right',
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
