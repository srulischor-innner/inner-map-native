// One chat bubble — user or assistant.
//
// AI bubbles carry:
//   - optional PartBadge (the detected part)
//   - a small 🔊 speaker button that plays THIS message aloud on demand via
//     /api/speak + expo-audio. Tapping again while playing stops playback.
//     No auto-play: TTS only happens when the user explicitly asks for it.
//   - a blinking caret while the message is still streaming.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  createAudioPlayer, setAudioModeAsync,
} from 'expo-audio';

import { colors, radii, spacing } from '../constants/theme';
import { api } from '../services/api';
import { PartBadge } from './PartBadge';

export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  detectedPart?: string | null;
  partLabel?: string | null;
  streaming?: boolean;
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
        <Text style={styles.text}>
          {msg.text}
          {msg.streaming ? <StreamCaret /> : null}
        </Text>
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
  rowUser: { justifyContent: 'flex-end', paddingLeft: 40 },
  rowAssistant: { justifyContent: 'flex-start', paddingRight: 40 },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.md,
    maxWidth: '100%',
    position: 'relative',
  },
  assistant: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderLeftWidth: 2,
    borderLeftColor: colors.borderAmber,
    borderTopLeftRadius: 2,
    paddingBottom: 24, // room for the absolute speaker button
  },
  user: {
    backgroundColor: 'rgba(230,180,122,0.12)',
    borderWidth: 0.5,
    borderColor: colors.borderAmber,
    borderBottomRightRadius: 2,
  },
  text: { color: colors.cream, fontSize: 15, lineHeight: 22 },
  caret: { color: colors.amber, fontSize: 14 },
  speakerBtn: {
    position: 'absolute',
    right: 6, bottom: 4,
    padding: 4,
    opacity: 0.9,
  },
});
