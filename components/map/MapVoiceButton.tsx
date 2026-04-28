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
// Re-enabled now that we're on a real EAS dev build (was previously off in
// Expo Go where PCM16 WAV recording wasn't reliable). On a real build the
// custom PCM16_RECORDING preset above produces honest LPCM that the
// Realtime API accepts. If anything still fails, the legacy pipeline is
// kept as a fallback — see realtime watchdog timers below.
// ============================================================================
const USE_REALTIME = true;
// Watchdog windows. The Realtime path opens a WebSocket and waits for the
// upstream to acknowledge — if either step misses its window we tear down
// and run the legacy /api/transcribe → /api/chat → /api/speak pipeline so
// the user always hears a reply even when the realtime endpoint is sick.
const REALTIME_CONNECT_TIMEOUT_MS = 3000;   // WS open + first state change
const REALTIME_RESPONSE_TIMEOUT_MS = 8000;  // commit → first audio response

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
  // Realtime watchdog timers — cleared on successful state transitions or
  // tear-down. If they fire we drop realtime and fall back to legacy.
  const realtimeConnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeResponseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearRealtimeTimers() {
    if (realtimeConnectTimer.current) { clearTimeout(realtimeConnectTimer.current); realtimeConnectTimer.current = null; }
    if (realtimeResponseTimer.current) { clearTimeout(realtimeResponseTimer.current); realtimeResponseTimer.current = null; }
  }

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
      // Immediate "received, processing" feedback — fires BEFORE we wait on
      // recorder.stop() / transcribe so the user feels the system react the
      // instant they release. Heavy haptic + flip the visible state to
      // 'thinking' so the spinner appears now, not 800ms later.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      setStateAnd('thinking');

      if (realtimeRef.current) {
        console.log('[map-voice] SECOND TAP → commitTurn ONLY (no stop, no cleanup)');
        // Arm the response watchdog — if no audible response within
        // REALTIME_RESPONSE_TIMEOUT_MS we tear down and try legacy.
        if (realtimeResponseTimer.current) clearTimeout(realtimeResponseTimer.current);
        realtimeResponseTimer.current = setTimeout(() => {
          console.warn('[map-voice] Realtime response timeout — falling back to legacy');
          try { realtimeRef.current?.stop(); } catch {}
          realtimeRef.current = null;
          // Legacy needs a fresh recording — we can't reuse the realtime
          // capture. Best we can do is reset to idle so the user re-records.
          setStateAnd('idle');
        }, REALTIME_RESPONSE_TIMEOUT_MS);
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
          onStateChange: (s) => {
            // Any state transition counts as "the socket is alive" — clear
            // the connect watchdog. The response watchdog is cleared when
            // we hear the first audio response (state → 'speaking').
            if (s !== 'connecting' && realtimeConnectTimer.current) {
              clearTimeout(realtimeConnectTimer.current);
              realtimeConnectTimer.current = null;
            }
            if (s === 'speaking' && realtimeResponseTimer.current) {
              clearTimeout(realtimeResponseTimer.current);
              realtimeResponseTimer.current = null;
            }
            setStateAnd(s);
          },
          onPartDetected: (p, l) => onDetectedPart?.(p, l),
          onUserTranscript: (t) => console.log('[map-voice] user said:', t.slice(0, 60)),
          onAssistantTranscript: (t) => console.log('[map-voice] AI said:', t.slice(0, 60)),
          onEnded: (turns) => {
            console.log('[map-voice] session ended, turns=', turns.length);
            clearRealtimeTimers();
            if (!turns.length) return;
            api.saveSession({ id: sessionId, messages: turns });
          },
        });
        rt.attachRecorder(recorder);
        // Arm the connect watchdog before await — if start() hangs past
        // REALTIME_CONNECT_TIMEOUT_MS we'll have already kicked off legacy.
        let connectTimedOut = false;
        realtimeConnectTimer.current = setTimeout(() => {
          connectTimedOut = true;
          console.warn('[map-voice] Realtime connect timeout — falling back to legacy');
          try { rt.stop(); } catch {}
          realtimeRef.current = null;
          legacyStart();
        }, REALTIME_CONNECT_TIMEOUT_MS);
        const ok = await rt.start();
        if (connectTimedOut) return;       // legacy already started
        clearRealtimeTimers();
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
      clearRealtimeTimers();
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
      // CRITICAL iOS FIX: after recording stops the audio session is still in
      // PlayAndRecord/recording mode — TTS playback through the speaker stays
      // silent until we explicitly flip back to playback. Mirrors expo-av's
      // { allowsRecordingIOS:false, playsInSilentModeIOS:true } guidance, but
      // we use the expo-audio names this project already imports.
      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
          shouldPlayInBackground: false,
        });
        console.log('[map-voice] audio session reset to playback mode');
      } catch (e) {
        console.warn('[map-voice] failed to reset audio session to playback:', (e as Error).message);
      }
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
      // Sentence-streaming TTS pipeline: as Claude streams the reply, we
      // detect complete sentences (ending . ! ? or newline) and start
      // fetching their TTS in parallel. A single sequential play-chain
      // ensures the user hears them in order. This dramatically cuts the
      // perceived latency — first sentence often plays while later ones
      // are still being generated.
      let fullReply = '';
      let partFired = false;
      let cleanedConsumed = 0;            // chars of stripped text already enqueued
      let speakingStateSet = false;       // flip 'thinking' → 'speaking' once first audio plays
      let playChain: Promise<void> = Promise.resolve();

      function enqueueSentenceForTTS(sentence: string) {
        const speakP = api.speak(sentence, { mapVoice: true });
        playChain = playChain.then(async () => {
          try {
            const buf = await speakP;
            if (!buf) return;
            if (!speakingStateSet) {
              speakingStateSet = true;
              setStateAnd('speaking');
            }
            await playArrayBuffer(buf);
          } catch (e) {
            console.warn('[map-voice] sentence playback failed:', (e as Error).message);
          }
        });
      }

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
            // Detect complete sentences in the stripped (marker-free) text
            // and enqueue them for TTS. cleanedConsumed tracks our cursor
            // into stripMarkers(fullReply) so we never re-enqueue.
            const cleaned = stripMarkers(fullReply);
            const tail = cleaned.slice(cleanedConsumed);
            const sentenceRegex = /[^.!?\n]+[.!?\n]+/g;
            let m: RegExpExecArray | null;
            let lastEnd = 0;
            while ((m = sentenceRegex.exec(tail)) !== null) {
              const s = m[0].trim();
              if (s.length >= 10) {
                console.log('[map-voice] enqueue sentence (' + s.length + ' chars)');
                enqueueSentenceForTTS(s);
              }
              lastEnd = m.index + m[0].length;
            }
            cleanedConsumed += lastEnd;
          },
          onDone: async (full) => {
            const cleaned = stripMarkers(full || fullReply);
            console.log('[legacy] 5/7 ✓ reply:', cleaned.slice(0, 60) + (cleaned.length > 60 ? '…' : ''));
            legacyHistory.current.push({ role: 'assistant', content: cleaned });
            // Flush any trailing fragment that didn't end with .!?
            const tail = cleaned.slice(cleanedConsumed).trim();
            if (tail.length >= 3) {
              console.log('[map-voice] enqueue tail fragment (' + tail.length + ' chars)');
              enqueueSentenceForTTS(tail);
            }
            if (!cleaned && cleanedConsumed === 0) {
              setStateAnd('idle'); legacyActive.current = false; return;
            }
            // Wait for the playback chain to fully drain, then return to idle.
            try { await playChain; } catch {}
            legacyActive.current = false;
            setStateAnd('idle');
            console.log('[map-voice] 7/7 ✓ all sentences played');
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

  // Play one MP3 ArrayBuffer through the bottom speaker. Used by the
  // sentence-streaming TTS pipeline — each sentence is decoded + played
  // in turn off a single chained promise so order is preserved.
  //
  // iOS speaker routing: setting the session to playback (allowsRecording:
  // false, playsInSilentMode:true) before play() ensures audio routes to
  // the bottom main speaker rather than the earpiece. The earpiece bug
  // happens when the session is still in PlayAndRecord/recording category
  // from the prior mic capture — this is the explicit reset.
  async function playArrayBuffer(buf: ArrayBuffer) {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
      });
    } catch {}
    const { bytesToBase64 } = await import('../../utils/audioWav');
    const b64 = bytesToBase64(new Uint8Array(buf));
    const dataUri = 'data:audio/mpeg;base64,' + b64;
    const player = createAudioPlayer({ uri: dataUri });
    audioPlayerRef.current = player;
    // Volume 1.0 — full output. Belt-and-braces in case the session was
    // left at a reduced gain by another component.
    try { (player as any).volume = 1.0; } catch {}
    player.play();
    while (audioPlayerRef.current === player) {
      try {
        const s = player.currentStatus;
        if (s?.didJustFinish || s?.isLoaded === false) break;
      } catch { break; }
      await new Promise((r) => setTimeout(r, 150));
    }
    try { player.remove(); } catch {}
    if (audioPlayerRef.current === player) audioPlayerRef.current = null;
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

  // Always show the status label. In idle state it's a small dim
  // "Tap to speak" hint sitting directly above the mic; active states
  // show the red "Recording…" or amber "Thinking…" variants. The pill is
  // right-aligned over the mic so it never reaches the SELF-LIKE label
  // on the central axis.
  const showStatus = true;

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
    // Bottom-right corner, pulled 20px lower than before so the "Tap to
    // speak" pill (which sits above the mic via the flex stack) no longer
    // climbs into the Fixer node's area on narrow screens. bottom:50
    // keeps the mic clear of the YOUR PROGRESS strip (40px collapsed)
    // with 10px of breathing room.
    position: 'absolute',
    right: 16,
    bottom: 50,
    alignItems: 'flex-end',
    gap: 8,
  },
  status: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,19,26,0.75)',
    borderRadius: 100,
    borderColor: colors.amberDim,
    borderWidth: 0.5,
  },
  statusText: {
    color: colors.creamDim,
    fontSize: 11,
    letterSpacing: 1,
  },
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
