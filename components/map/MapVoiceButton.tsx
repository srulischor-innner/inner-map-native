// Floating mic button on the Map tab for voice conversation. Single-tap flow:
//   idle     → tap → record
//   record   → tap → stop, transcribe, send to chat, stream reply, play via TTS
//   speaking → tap → stop playback (user wants to interrupt and say something else)
//
// CHAT_META parsed from the reply drives onDetectedPart so the caller can pulse the
// matching node. This is the Expo-managed-workflow compatible voice path; the
// production WebSocket Realtime flow requires a dev-client build with a native
// audio module for continuous PCM16 streaming and lands in a follow-up.

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, ActivityIndicator, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useAudioRecorder, AudioModule, RecordingPresets,
  createAudioPlayer, setAudioModeAsync,
} from 'expo-audio';

import { api, ChatMessage } from '../../services/api';
import { parseChatMeta, stripMarkers } from '../../utils/markers';
import { colors } from '../../constants/theme';

type VoiceState = 'idle' | 'recording' | 'thinking' | 'speaking';

type Props = {
  /** Called when a CHAT_META part is detected so the caller can animate the map. */
  onDetectedPart?: (part: string, label?: string | null) => void;
  /** Called with state changes — used to update the status indicator in map.tsx. */
  onStateChange?: (s: VoiceState) => void;
  sessionId: string;
};

export function MapVoiceButton({ onDetectedPart, onStateChange, sessionId }: Props) {
  const [state, setState] = useState<VoiceState>('idle');
  const history = useRef<ChatMessage[]>([]);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  function setStateAnd(s: VoiceState) {
    setState(s);
    onStateChange?.(s);
  }

  async function startRecord() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      // Configure audio mode so recording is allowed and playback routes through
      // the default speaker (not earpiece). Critical on iOS for a hands-free feel.
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'duckOthers',
          shouldPlayInBackground: false,
        });
      } catch {}
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setStateAnd('recording');
    } catch (e) {
      console.warn('[map-voice] startRecord failed:', (e as Error).message);
      setStateAnd('idle');
    }
  }

  async function stopAndRespond() {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setStateAnd('idle'); return; }
      setStateAnd('thinking');
      Haptics.selectionAsync().catch(() => {});

      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      const transcript = await api.transcribe(uri, mime);
      const text = (transcript || '').trim();
      if (!text) { setStateAnd('idle'); return; }

      // Push the user turn and stream the assistant reply.
      history.current.push({ role: 'user', content: text });
      let fullReply = '';
      let partFired = false;

      await api.streamChat(
        { messages: history.current, mode: 'ongoing', sessionId },
        {
          onDelta: (delta) => {
            fullReply += delta;
            if (!partFired) {
              const meta = parseChatMeta(fullReply);
              if (meta?.detectedPart && meta.detectedPart !== 'unknown') {
                partFired = true;
                onDetectedPart?.(meta.detectedPart, meta.partLabel ?? null);
              }
            }
          },
          onDone: async (full) => {
            const cleaned = stripMarkers(full || fullReply);
            history.current.push({ role: 'assistant', content: cleaned });
            if (!cleaned) { setStateAnd('idle'); return; }
            await playTTS(cleaned);
          },
          onError: () => { setStateAnd('idle'); },
        },
      );
    } catch (e) {
      console.warn('[map-voice] stopAndRespond failed:', (e as Error).message);
      setStateAnd('idle');
    }
  }

  async function playTTS(text: string) {
    setStateAnd('speaking');
    try {
      // Download the MP3 as an ArrayBuffer then hand a data URI to createAudioPlayer.
      // Skipping streaming playback for now — expo-audio v1.1 doesn't expose
      // streaming MP3 from a remote URL cleanly, but the MP3 blob is small
      // (~20-40KB per sentence) and fetches in <500ms on cellular.
      const buf = await api.speak(text);
      if (!buf) { setStateAnd('idle'); return; }
      const base64 = bufferToBase64(buf);
      const dataUri = 'data:audio/mpeg;base64,' + base64;
      const player = createAudioPlayer({ uri: dataUri });
      audioPlayerRef.current = player;
      player.play();
      // Poll for completion — cheaper than hooking expo-audio events which are
      // less stable across SDK versions. The MP3 is short so 500ms is fine.
      const waitUntilDone = async () => {
        while (audioPlayerRef.current === player) {
          try {
            const status = player.currentStatus;
            if (status?.didJustFinish || status?.isLoaded === false) break;
            if (!status?.playing && (status?.currentTime ?? 0) > 0 && !status?.reasonForWaitingToPlay) break;
          } catch { break; }
          await new Promise((r) => setTimeout(r, 250));
        }
        try { player.remove(); } catch {}
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
      };
      await waitUntilDone();
    } catch (e) {
      console.warn('[map-voice] TTS failed:', (e as Error).message);
    } finally {
      // When playback finishes, automatically go back to listening so the user
      // can keep the conversation flowing without a manual tap each turn.
      if (state !== 'idle') startRecord();
    }
  }

  async function onPress() {
    // Tap semantics depend on current state — matches the single-tap flow on web.
    if (state === 'idle')      return startRecord();
    if (state === 'recording') return stopAndRespond();
    if (state === 'speaking') {
      try { audioPlayerRef.current?.pause(); audioPlayerRef.current?.remove(); } catch {}
      audioPlayerRef.current = null;
      setStateAnd('idle');
      return;
    }
    // thinking: ignore tap
  }

  const iconName: any =
    state === 'recording' ? 'stop' :
    state === 'speaking'  ? 'volume-high' :
    'mic';

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      {state === 'recording' || state === 'thinking' || state === 'speaking' ? (
        <View style={styles.status}>
          <Text style={styles.statusText}>
            {state === 'recording' ? 'Listening…' : state === 'thinking' ? 'Thinking…' : 'Speaking…'}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        style={[
          styles.btn,
          state === 'recording' && styles.btnRecording,
          state === 'speaking' && styles.btnSpeaking,
          state === 'thinking' && styles.btnThinking,
        ]}
        accessibilityLabel="Voice conversation"
      >
        {state === 'thinking' ? (
          <ActivityIndicator color={colors.amber} />
        ) : (
          <Ionicons name={iconName} size={26} color={state === 'idle' ? colors.amber : '#fff'} />
        )}
      </Pressable>
    </View>
  );
}

// Convert ArrayBuffer → base64 without Node's Buffer (not available in RN).
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return globalThis.btoa ? globalThis.btoa(binary) : legacyBtoa(binary);
}
// Minimal base64 encoder for environments without btoa (older Hermes builds).
function legacyBtoa(str: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < str.length; ) {
    const c1 = str.charCodeAt(i++);
    const c2 = str.charCodeAt(i++);
    const c3 = str.charCodeAt(i++);
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (c2 >> 4);
    const e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (c3 >> 6);
    const e4 = isNaN(c3) ? 64 : c3 & 63;
    out += chars[e1] + chars[e2] + chars[e3] + chars[e4];
  }
  return out;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 22,
    bottom: 28,
    alignItems: 'center',
    gap: 8,
  },
  status: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,19,26,0.85)',
    borderRadius: 100,
    borderColor: colors.amberDim,
    borderWidth: 0.5,
  },
  statusText: { color: colors.cream, fontSize: 11, letterSpacing: 1 },
  btn: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(20,19,26,0.9)',
    borderWidth: 2, borderColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.amber, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  btnRecording: { backgroundColor: '#d4726a', borderColor: '#d4726a' },
  btnSpeaking:  { backgroundColor: '#8A7AAA', borderColor: '#8A7AAA' },
  btnThinking:  { backgroundColor: colors.backgroundSecondary },
});
