// Map-tab voice FAB. Two pipelines behind the same button:
//
//   Pipeline A — OpenAI Realtime via /realtime WebSocket proxy.
//     Tap to start → opens WS, starts recording; server-side proxy injects
//     the API key + system prompt. Tap again → commits the utterance,
//     receives streaming audio back, plays, auto-resumes listening.
//   Pipeline B (fallback) — legacy record → /api/transcribe → /api/chat →
//     /api/speak used when the WS open times out (Expo Go on a bad network,
//     server down, etc). No user-visible error on fallback.
//
// Both paths fire onDetectedPart so the map's activePart state animates the
// same way.
//
// Known limitation (documented, not a bug):
// Realtime input is tap-to-stop rather than continuous streaming because
// expo-audio can't emit live PCM16 chunks — that needs a custom native
// audio module via a dev build. Output side is proper streaming.

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
import { RealtimeSession, VoiceState } from './RealtimeSession';

type Props = {
  onDetectedPart?: (part: string, label?: string | null) => void;
  onStateChange?: (s: VoiceState) => void;
  sessionId: string;
};

export function MapVoiceButton({ onDetectedPart, onStateChange, sessionId }: Props) {
  const [state, setState] = useState<VoiceState>('idle');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Realtime session pipeline (preferred).
  const realtimeRef = useRef<RealtimeSession | null>(null);
  // Fallback pipeline state.
  const audioPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const legacyHistory = useRef<ChatMessage[]>([]);
  const legacyActive = useRef(false);

  function setStateAnd(s: VoiceState) { setState(s); onStateChange?.(s); }

  /* =====================================================================
   * TAP DISPATCH
   * ===================================================================== */
  async function onPress() {
    if (state === 'idle') {
      // Start a session. Try realtime first; if it fails fall through to legacy.
      const rt = new RealtimeSession({
        onStateChange: setStateAnd,
        onPartDetected: (p, l) => onDetectedPart?.(p, l),
        onUserTranscript: () => {},
        onAssistantTranscript: () => {},
        onEnded: (turns) => {
          if (!turns.length) return;
          // Save transcript alongside existing web session history.
          api.saveSession({ id: sessionId, messages: turns });
        },
      });
      rt.attachRecorder(recorder);
      const ok = await rt.start();
      if (ok) {
        realtimeRef.current = rt;
        return;
      }
      console.log('[map-voice] realtime unavailable — falling back to legacy pipeline');
      realtimeRef.current = null;
      legacyStart();
      return;
    }

    // We're already in a session. Any tap from a non-idle state:
    // - If realtime is running, tap commits the user's turn.
    // - If a user's turn is processing or the AI is speaking, a second tap
    //   ends the whole session so they can exit the voice flow.
    if (realtimeRef.current) {
      if (state === 'listening') { await realtimeRef.current.commitTurn(); return; }
      // Any other state → stop the whole session.
      realtimeRef.current.stop();
      realtimeRef.current = null;
      return;
    }

    // Legacy path — single tap toggles recording / stops playback.
    if (legacyActive.current) {
      if (state === 'listening') await legacyStopAndRespond();
      else if (state === 'speaking') { try { audioPlayerRef.current?.pause(); audioPlayerRef.current?.remove(); } catch {} audioPlayerRef.current = null; legacyActive.current = false; setStateAnd('idle'); }
    }
  }

  /* =====================================================================
   * LEGACY FALLBACK PIPELINE (unchanged behavior from the previous build)
   * ===================================================================== */
  async function legacyStart() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { setStateAnd('idle'); return; }
      try {
        await setAudioModeAsync({
          allowsRecording: true, playsInSilentMode: true,
          interruptionMode: 'duckOthers', shouldPlayInBackground: false,
        });
      } catch {}
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      legacyActive.current = true;
      setStateAnd('listening');
    } catch (e) {
      console.warn('[map-voice] legacy start failed:', (e as Error).message);
      setStateAnd('idle');
      legacyActive.current = false;
    }
  }

  async function legacyStopAndRespond() {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setStateAnd('idle'); legacyActive.current = false; return; }
      setStateAnd('thinking');
      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      const transcript = await api.transcribe(uri, mime);
      const text = (transcript || '').trim();
      if (!text) { setStateAnd('idle'); legacyActive.current = false; return; }
      legacyHistory.current.push({ role: 'user', content: text });
      let fullReply = '';
      let partFired = false;
      await api.streamChat(
        { messages: legacyHistory.current, mode: 'ongoing', sessionId },
        {
          onDelta: (d) => {
            fullReply += d;
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
            legacyHistory.current.push({ role: 'assistant', content: cleaned });
            if (!cleaned) { setStateAnd('idle'); legacyActive.current = false; return; }
            await legacyPlayTTS(cleaned);
          },
          onError: () => { setStateAnd('idle'); legacyActive.current = false; },
        },
      );
    } catch (e) {
      console.warn('[map-voice] legacy respond failed:', (e as Error).message);
      setStateAnd('idle'); legacyActive.current = false;
    }
  }

  async function legacyPlayTTS(text: string) {
    setStateAnd('speaking');
    try {
      const buf = await api.speak(text);
      if (!buf) { setStateAnd('idle'); legacyActive.current = false; return; }
      const { bytesToBase64 } = await import('../../utils/audioWav');
      const b64 = bytesToBase64(new Uint8Array(buf));
      const dataUri = 'data:audio/mpeg;base64,' + b64;
      const player = createAudioPlayer({ uri: dataUri });
      audioPlayerRef.current = player;
      player.play();
      while (audioPlayerRef.current === player) {
        try {
          const s = player.currentStatus;
          if (s?.didJustFinish || s?.isLoaded === false) break;
        } catch { break; }
        await new Promise((r) => setTimeout(r, 250));
      }
      try { player.remove(); } catch {}
      if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    } catch (e) {
      console.warn('[map-voice] TTS failed:', (e as Error).message);
    } finally {
      // Auto-resume listening so turns chain.
      if (legacyActive.current) await legacyStart();
    }
  }

  /* =====================================================================
   * RENDER
   * ===================================================================== */
  const iconName: any =
    state === 'listening'  ? 'stop' :
    state === 'speaking'   ? 'volume-high' :
    state === 'connecting' ? 'wifi' :
    'mic';

  const label =
    state === 'listening'  ? 'Listening…' :
    state === 'thinking'   ? 'Thinking…' :
    state === 'speaking'   ? 'Speaking…' :
    state === 'connecting' ? 'Connecting…' :
    state === 'error'      ? 'Error' :
    null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      {label ? (
        <View style={styles.status}>
          <Text style={styles.statusText}>{label}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        style={[
          styles.btn,
          state === 'listening' && styles.btnListening,
          state === 'speaking'  && styles.btnSpeaking,
          state === 'thinking'  && styles.btnThinking,
          state === 'connecting' && styles.btnThinking,
          state === 'error'     && styles.btnThinking,
        ]}
        accessibilityLabel="Voice conversation"
      >
        {state === 'thinking' || state === 'connecting' ? (
          <ActivityIndicator color={colors.amber} />
        ) : (
          <Ionicons
            name={iconName}
            size={26}
            color={state === 'idle' ? colors.amber : '#fff'}
          />
        )}
      </Pressable>
    </View>
  );
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
  btnListening: { backgroundColor: '#d4726a', borderColor: '#d4726a' },
  btnSpeaking:  { backgroundColor: '#8A7AAA', borderColor: '#8A7AAA' },
  btnThinking:  { backgroundColor: colors.backgroundSecondary },
});
