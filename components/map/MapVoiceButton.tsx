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

// Custom recording preset forcing LINEAR PCM 16-bit mono at 24kHz — the exact
// format the OpenAI Realtime API expects. iOS's LPCM output writes a standard
// RIFF/WAVE file so stripping the 44-byte header yields raw PCM16. Android
// falls back to device-default sample rate; the proxy re-samples server-side.
const PCM16_RECORDING: any = {
  extension: '.wav',
  sampleRate: 24000,
  numberOfChannels: 1,
  bitRate: 384000,
  android: {
    outputFormat: 'default',
    audioEncoder: 'default',
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 384000,
  },
  ios: {
    outputFormat: 'lpcm',
    audioQuality: 'max',
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 384000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

import { api, ChatMessage } from '../../services/api';
import { parseChatMeta, stripMarkers } from '../../utils/markers';
import { colors } from '../../constants/theme';
import { RealtimeSession, VoiceState } from './RealtimeSession';

// ============================================================================
// FEATURE FLAG: Realtime WebSocket path.
//
// Disabled by default because expo-audio's RecordingPresets.HIGH_QUALITY
// records AAC-in-M4A on iOS, not linear PCM16 WAV — OpenAI Realtime expects
// PCM16. Stripping a "44-byte WAV header" from an M4A file produces
// garbage bytes that the upstream silently ignores, so the response.done
// event never fires and the user sits on "Thinking…" forever.
//
// Getting real PCM16 streaming in Expo requires a custom native audio
// module (AVAudioEngine / AudioRecord) which needs a dev build. Until that
// lands we default to the legacy pipeline (record → /api/transcribe via
// Whisper → /api/chat → /api/speak), which handles M4A natively and is
// stable on the current build.
// ============================================================================
// Re-enabled: recorder now writes true PCM16 WAV on both platforms, so the
// Realtime path can actually upload valid audio. Falls back to legacy
// automatically if the WebSocket fails to open in 2.5s.
const USE_REALTIME = true;

type Props = {
  onDetectedPart?: (part: string, label?: string | null) => void;
  onStateChange?: (s: VoiceState) => void;
  sessionId: string;
};

export function MapVoiceButton({ onDetectedPart, onStateChange, sessionId }: Props) {
  const [state, setState] = useState<VoiceState>('idle');
  // Force a PCM16 WAV recorder so the Realtime API's input_audio_buffer
  // accepts our audio. HIGH_QUALITY previously gave AAC-in-M4A on iOS.
  const recorder = useAudioRecorder(PCM16_RECORDING as any);
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
    console.log('[map-voice] mic tapped — current state:', state);
    if (state === 'idle') {
      // Realtime path — disabled behind USE_REALTIME until we have a proper
      // PCM16 recorder. Skipping straight to the legacy pipeline is the
      // reliable behavior today.
      if (USE_REALTIME) {
        console.log('[map-voice] starting new session (trying realtime first)');
        const rt = new RealtimeSession({
          onStateChange: setStateAnd,
          onPartDetected: (p, l) => onDetectedPart?.(p, l),
          onUserTranscript: (t) => console.log('[map-voice] user said:', t.slice(0, 60)),
          onAssistantTranscript: (t) => console.log('[map-voice] AI said:', t.slice(0, 60)),
          onEnded: (turns) => {
            console.log('[map-voice] session ended, turns=', turns.length);
            if (!turns.length) return;
            api.saveSession({ id: sessionId, messages: turns });
          },
        });
        rt.attachRecorder(recorder);
        const ok = await rt.start();
        if (ok) { realtimeRef.current = rt; return; }
        console.log('[map-voice] realtime unavailable — falling back to legacy pipeline');
      } else {
        console.log('[map-voice] USE_REALTIME=false — using legacy pipeline directly');
      }
      realtimeRef.current = null;
      legacyStart();
      return;
    }

    // We're already in a session.
    if (realtimeRef.current) {
      if (state === 'listening') {
        console.log('[map-voice] mic tapped again — committing turn');
        await realtimeRef.current.commitTurn();
        return;
      }
      // Any other state → stop the whole session cleanly.
      console.log('[map-voice] stopping session from state=', state);
      realtimeRef.current.stop();
      realtimeRef.current = null;
      return;
    }

    // Legacy path — same tap semantics.
    if (legacyActive.current) {
      if (state === 'listening') {
        console.log('[map-voice] legacy — mic tapped again, stopping + transcribing');
        await legacyStopAndRespond();
      } else if (state === 'speaking') {
        console.log('[map-voice] legacy — interrupting playback');
        try { audioPlayerRef.current?.pause(); audioPlayerRef.current?.remove(); } catch {}
        audioPlayerRef.current = null;
        legacyActive.current = false;
        setStateAnd('idle');
      }
    }
  }

  // Cancel — bail out of a session without sending anything.
  async function onCancel() {
    console.log('[map-voice] cancel tapped, state was:', state);
    Haptics.selectionAsync().catch(() => {});
    if (realtimeRef.current) {
      realtimeRef.current.stop();
      realtimeRef.current = null;
    }
    if (legacyActive.current) {
      try { await recorder.stop(); } catch {}
      try { audioPlayerRef.current?.pause(); audioPlayerRef.current?.remove(); } catch {}
      audioPlayerRef.current = null;
      legacyActive.current = false;
    }
    setStateAnd('idle');
  }

  /* =====================================================================
   * LEGACY FALLBACK PIPELINE (unchanged behavior from the previous build)
   * ===================================================================== */
  async function legacyStart() {
    console.log('[legacy] 1/7 requesting mic permission');
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      console.log('[legacy] 1/7 permission granted:', perm.granted);
      if (!perm.granted) { setStateAnd('idle'); return; }
      try {
        await setAudioModeAsync({
          allowsRecording: true, playsInSilentMode: true,
          interruptionMode: 'duckOthers', shouldPlayInBackground: false,
        });
      } catch (e) {
        console.warn('[legacy] setAudioModeAsync failed:', (e as Error).message);
      }
      console.log('[legacy] 2/7 preparing + starting recording');
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      legacyActive.current = true;
      setStateAnd('listening');
      console.log('[legacy] 2/7 ✓ recording started');
    } catch (e) {
      console.warn('[legacy] start failed:', (e as Error).message);
      setStateAnd('idle');
      legacyActive.current = false;
    }
  }

  async function legacyStopAndRespond() {
    console.log('[legacy] 3/7 mic tapped again — stopping recorder');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      console.log('[legacy] 3/7 recorder uri:', uri);
      if (!uri) {
        console.warn('[legacy] no uri after stop — aborting');
        setStateAnd('idle'); legacyActive.current = false; return;
      }
      setStateAnd('thinking');
      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      console.log('[legacy] 4/7 POST /api/transcribe (mime=' + mime + ')');
      const transcript = await api.transcribe(uri, mime);
      const text = (transcript || '').trim();
      console.log('[legacy] 4/7 transcript:', text ? `"${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"` : '(empty)');
      if (!text) {
        console.warn('[legacy] empty transcript — mic may have captured silence');
        setStateAnd('idle'); legacyActive.current = false; return;
      }
      legacyHistory.current.push({ role: 'user', content: text });
      console.log('[legacy] 5/7 POST /api/chat (msgs=' + legacyHistory.current.length + ')');
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
                console.log('[legacy] 5/7 CHAT_META detected:', meta.detectedPart);
                onDetectedPart?.(meta.detectedPart, meta.partLabel ?? null);
              }
            }
          },
          onDone: async (full) => {
            const cleaned = stripMarkers(full || fullReply);
            console.log('[legacy] 5/7 ✓ reply:', cleaned.slice(0, 60) + (cleaned.length > 60 ? '…' : ''));
            legacyHistory.current.push({ role: 'assistant', content: cleaned });
            if (!cleaned) { setStateAnd('idle'); legacyActive.current = false; return; }
            await legacyPlayTTS(cleaned);
          },
          onError: (err) => {
            console.warn('[legacy] 5/7 chat error:', err);
            setStateAnd('idle'); legacyActive.current = false;
          },
        },
      );
    } catch (e) {
      console.warn('[legacy] respond failed:', (e as Error).message);
      setStateAnd('idle'); legacyActive.current = false;
    }
  }

  async function legacyPlayTTS(text: string) {
    console.log('[legacy] 6/7 POST /api/speak (' + text.length + ' chars)');
    setStateAnd('speaking');
    try {
      const buf = await api.speak(text);
      if (!buf) {
        console.warn('[legacy] /api/speak returned null — skipping playback');
        setStateAnd('idle'); legacyActive.current = false; return;
      }
      console.log('[legacy] 6/7 ✓ MP3 received (' + buf.byteLength + ' bytes)');
      const { bytesToBase64 } = await import('../../utils/audioWav');
      const b64 = bytesToBase64(new Uint8Array(buf));
      const dataUri = 'data:audio/mpeg;base64,' + b64;
      console.log('[legacy] 7/7 playing audio…');
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
      console.log('[legacy] 7/7 ✓ playback finished, auto-resuming listening');
    } catch (e) {
      console.warn('[legacy] TTS failed:', (e as Error).message);
    } finally {
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

  // Explicit, instructive status text — tells the user exactly what to do next.
  const label =
    state === 'listening'  ? 'Listening… tap to send' :
    state === 'thinking'   ? 'Thinking…' :
    state === 'speaking'   ? 'Speaking…' :
    state === 'connecting' ? 'Connecting…' :
    state === 'error'      ? 'Something went wrong' :
    'Tap to speak';

  const showCancel = state === 'listening';

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.status}>
        <Text
          style={[
            styles.statusText,
            state === 'listening' && { color: '#d4726a', fontWeight: '700' },
          ]}
        >
          {label}
        </Text>
      </View>

      <View style={styles.row}>
        {showCancel ? (
          <Pressable
            onPress={onCancel}
            style={styles.cancelBtn}
            accessibilityLabel="Cancel recording"
            hitSlop={10}
          >
            <Ionicons name="close" size={18} color={colors.creamDim} />
          </Pressable>
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
          accessibilityLabel={state === 'listening' ? 'Tap to send' : 'Voice conversation'}
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Positioned well above the YOUR PROGRESS strip (which sits at bottom:0
    // when collapsed, ~44px tall). bottom:90 gives 46px clearance above it;
    // right:16 keeps the 60px circle + its 12px shadow inside the viewport
    // on any iPhone.
    position: 'absolute',
    right: 16,
    bottom: 90,
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

  // Row that holds [cancel X] [mic]. Cancel is only rendered while listening.
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: 'rgba(20,19,26,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
});
