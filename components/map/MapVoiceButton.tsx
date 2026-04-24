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

import React, { useEffect, useRef, useState } from 'react';
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
    // 'lpcm' is the IOSOutputFormat.LINEARPCM enum value (native side expects
    // a 4-char FourCC string here — 'lpcm' is correct).
    outputFormat: 'lpcm',
    // NUMERIC — expo-audio's AudioQuality enum. MAX = 127. The iOS bridge
    // casts this field to Int; passing the string 'max' crashes with
    // "Cannot cast max for field audioQuality of type Int".
    audioQuality: 127,
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
   * TAP DISPATCH — dead simple, two tap states only:
   *   idle       → start recording
   *   listening  → commit + send (NEVER stop the session from a tap)
   *   anything   → no-op while thinking/speaking/connecting
   *
   * The session is only torn down when the user navigates away from the
   * Map tab (see the unmount cleanup below). There is no cancel button.
   * ===================================================================== */
  async function onPress() {
    console.log('[map-voice] mic tapped — current state:', state);
    Haptics.selectionAsync().catch(() => {});

    // Commit the current turn (second tap while recording).
    if (state === 'listening') {
      if (realtimeRef.current) {
        console.log('[map-voice] SECOND TAP → commitTurn ONLY (no stop, no cleanup)');
        await realtimeRef.current.commitTurn();
        console.log('[map-voice] commitTurn resolved, session still open — awaiting response.done');
      } else if (legacyActive.current) {
        console.log('[map-voice] committing legacy turn (stop + transcribe)');
        await legacyStopAndRespond();
      } else {
        console.warn('[map-voice] listening but no active session — resetting to idle');
        setStateAnd('idle');
      }
      return;
    }

    // Start a new turn (first tap, or tap after the AI finished speaking).
    if (state === 'idle') {
      // If a realtime session is already open from a previous turn, reuse it.
      if (realtimeRef.current) {
        console.log('[map-voice] reusing open realtime session for next turn');
        const ok = await realtimeRef.current.startNextTurn();
        if (ok) return;
        // Socket died — drop the stale session and fall through to fresh start.
        console.log('[map-voice] session stale, opening a new one');
        realtimeRef.current = null;
      }

      if (USE_REALTIME) {
        console.log('[map-voice] starting new realtime session');
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
      }
      realtimeRef.current = null;
      legacyStart();
      return;
    }

    // thinking / speaking / connecting / error → tap is a no-op. The user
    // just waits for the AI to finish or for the error state to auto-clear.
    console.log('[map-voice] tap ignored in state:', state);
  }

  /* =====================================================================
   * UNMOUNT CLEANUP — navigating away from Map tab ends the session.
   * ===================================================================== */
  useEffect(() => {
    return () => {
      console.log('[map-voice] unmounting — tearing down session');
      try { realtimeRef.current?.stop(); } catch {}
      realtimeRef.current = null;
      try { audioPlayerRef.current?.pause(); audioPlayerRef.current?.remove(); } catch {}
      audioPlayerRef.current = null;
      if (legacyActive.current) {
        try { recorder.stop(); } catch {}
        legacyActive.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =====================================================================
   * LEGACY FALLBACK PIPELINE (unchanged behavior from the previous build)
   * ===================================================================== */
  async function legacyStart() {
    console.log('[legacy] 1/7 requesting mic permission');
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      console.log('[legacy] 1/7 permission granted:', perm.granted);
      if (!perm.granted) { setStateAnd('idle'); return; }
      // Same iOS audio-session requirement as the Realtime path: switch to
      // PlayAndRecord category with exclusive focus before prepareToRecord,
      // or the mic records silence while permission still appears granted.
      try {
        await setAudioModeAsync({
          allowsRecording: true, playsInSilentMode: true,
          interruptionMode: 'doNotMix', shouldPlayInBackground: false,
        });
        console.log('[legacy] audio mode set — allowsRecording:true, interruption=doNotMix');
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
      // Return to idle. User taps mic again to start the next turn — no
      // auto-resume, so the flow is predictable.
      legacyActive.current = false;
      setStateAnd('idle');
    }
  }

  /* =====================================================================
   * RENDER
   * ===================================================================== */
  // While recording, show an upward arrow (send) rather than a stop square —
  // a square reads as "end everything" and was causing users to hesitate
  // before tapping to send.
  const iconName: any =
    state === 'listening'  ? 'arrow-up' :
    state === 'speaking'   ? 'volume-high' :
    state === 'connecting' ? 'wifi' :
    'mic';

  // Explicit, instructive status text — tells the user exactly what to do next.
  const label =
    state === 'listening'  ? 'Recording… tap to send' :
    state === 'thinking'   ? 'Thinking…' :
    state === 'speaking'   ? 'Speaking…' :
    state === 'connecting' ? 'Connecting…' :
    state === 'retrying'   ? 'Retrying…' :
    state === 'error'      ? 'Something went wrong' :
    'Tap to speak';

  // Only show the status label when the session is ACTIVE — idle state
  // shouldn't carry a "Tap to speak" pill permanently covering the map.
  const showStatus = state !== 'idle';

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      {showStatus ? (
        <View style={styles.status}>
          <Text
            style={[
              styles.statusText,
              state === 'listening' && { color: '#d4726a', fontWeight: '700' },
              state === 'retrying'  && { color: colors.amber, fontWeight: '700' },
            ]}
          >
            {label}
          </Text>
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
          state === 'retrying'  && styles.btnThinking,
          state === 'error'     && styles.btnThinking,
        ]}
        accessibilityLabel={state === 'listening' ? 'Tap to send' : 'Voice conversation'}
      >
        {state === 'thinking' || state === 'connecting' || state === 'retrying' ? (
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
    // Bottom-right corner, well clear of the YOUR PROGRESS strip (40px
    // collapsed). The status pill sits ABOVE the mic (flex stacks
    // bottom-up via the alignItems:flex-end + gap); it only renders when
    // a session is active so it can't cover the SELF-LIKE label while idle.
    position: 'absolute',
    right: 20,
    bottom: 100,
    alignItems: 'flex-end',
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
