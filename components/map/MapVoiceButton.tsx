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

// Legacy module path — expo-file-system v19's top-level export switched
// to a class-based File API. The legacy `readAsStringAsync(uri, { encoding })`
// still ships under the /legacy entry and is what we need for one-off
// base64 reads of the recorder's WAV file.
import * as FileSystem from 'expo-file-system/legacy';
import { api, ChatMessage } from '../../services/api';
import {
  appendMapVoiceTurn, getMapVoiceHistory,
} from '../../services/mapVoiceHistory';
import { parseChatMeta, stripMarkers } from '../../utils/markers';
import { colors } from '../../constants/theme';
import { VoiceState } from './RealtimeSession';
import {
  base64ToBytes, bytesToBase64, pcm16ToWavBase64, stripWavHeaderToPcm16Base64,
} from '../../utils/audioWav';

// ============================================================================
// FEATURE FLAG: Realtime WebSocket path.
//
// Re-enabled for testing on a real EAS development build (native audio
// modules should work properly here, unlike Expo Go where the previous
// attempt silently failed). The 3s connect / 8s response watchdogs in
// onPress() below fall back to the legacy pipeline if anything misses
// its window — so a Realtime regression now still produces an audible
// reply via /api/transcribe → /api/chat → /api/speak.
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
  // Ephemeral-token Realtime path — token is pre-fetched WHILE the user
  // is speaking, so by the time the recorder stops the WebSocket can
  // open immediately. The promise lives in a ref so we don't rerender
  // while waiting.
  const prefetchedTokenRef = useRef<Promise<string | null> | null>(null);
  // Fallback pipeline state.
  const audioPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  // Conversation history is held at MODULE SCOPE in services/mapVoiceHistory.ts
  // so it survives MapVoiceButton's mount/unmount cycles (tab nav, etc.) for
  // the duration of the chat session. The chat tab's session-end and
  // session-start handlers explicitly call clearMapVoiceHistory() — this
  // component never truncates.
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
      // Immediate "received, processing" feedback — fires BEFORE we wait
      // on recorder.stop() / transcribe so the user feels the system
      // react the instant they release. Heavy haptic + flip the visible
      // state to 'thinking' so the spinner appears now, not 800ms later.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      setStateAnd('thinking');
      if (legacyActive.current) {
        await dispatchCommit();
      } else {
        console.warn('[map-voice] listening but no active session — resetting to idle');
        setStateAnd('idle');
      }
      return;
    }

    // Start a new turn (first tap, or tap after the AI finished speaking).
    if (state === 'idle') {
      console.log('[map-voice] using:', USE_REALTIME ? 'Realtime API (ephemeral token)' : 'Legacy pipeline');
      // Pre-fetch the ephemeral OpenAI Realtime token IN PARALLEL with
      // recording. By the time the user releases the mic, the token
      // promise is already resolved — saving ~600ms off the perceived
      // latency. The token is one-shot per turn; we mint a fresh one
      // every time the user starts a new recording.
      if (USE_REALTIME) {
        console.log('[realtime] pre-fetching token...');
        // Pass the FULL session history into the token mint so the
        // server can include it in the Realtime session's instructions.
        // Therapeutic conversations need continuity — the AI must
        // remember everything said earlier in the session.
        prefetchedTokenRef.current = api.realtimeToken(getMapVoiceHistory()).then((tok) => {
          if (tok) console.log('[realtime] token ready');
          else console.warn('[realtime] token fetch returned null — will fall back to legacy');
          return tok;
        });
      } else {
        prefetchedTokenRef.current = null;
      }
      legacyStart();   // starts the recorder; sets state → 'listening'
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
      prefetchedTokenRef.current = null;
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
   * LEGACY FALLBACK PIPELINE
   * ===================================================================== */
  // Monotonic turn id. Every time the user starts a new voice turn
  // (mic press → recording) we increment this. The sentence-streaming
  // chain in legacyStopAndRespond captures the id at enqueue time and
  // bails out if the id no longer matches at play time — the previous
  // turn's pending TTS responses cannot create a new player while a
  // newer turn is in flight. Combined with stopAndClearAudio() this
  // gives a hard "kill all" guarantee end-to-end.
  const voiceTurnId = useRef(0);

  // Hard stop on whatever audio is currently playing AND invalidate any
  // sentence-stream playback chains from prior turns. Called at the
  // start of every recording AND before each sentence's player is
  // allocated.
  async function stopAndClearAudio() {
    voiceTurnId.current += 1;
    const prev = audioPlayerRef.current;
    audioPlayerRef.current = null;
    if (prev) {
      try { prev.pause(); } catch {}
      try { prev.remove(); } catch {}
    }
  }

  async function legacyStart() {
    console.log('[legacy] 1/7 requesting mic permission');
    // Stop any in-flight TTS playback BEFORE we re-arm the mic. Two
    // bugs fall out of this: (a) the prior turn's sentence chain
    // overlapping with the new turn's reply audio, (b) the audio
    // session getting flipped to recording while a player is still
    // alive on the playback channel.
    await stopAndClearAudio();
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

  // Shared commit dispatcher. Stops the recorder once, resets the audio
  // session to playback, then tries the Realtime ephemeral-token path
  // first (when a token was pre-fetched) and falls back to the legacy
  // /api/transcribe → /api/chat → /api/speak pipeline if Realtime fails.
  async function dispatchCommit() {
    let uri: string | null = null;
    try {
      console.log('[map-voice] Step 1: stopping recorder...');
      await recorder.stop();
      uri = recorder.uri;
      console.log('[map-voice] Step 1 ✓ recorder.uri =', uri);
    } catch (e) {
      console.error('[map-voice] recorder.stop threw:', (e as Error).message);
    }
    legacyActive.current = false;
    // Reset audio session to playback BEFORE we try anything that
    // needs the speaker — both realtime and legacy will play audio.
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
      });
      console.log('[map-voice] Step 2 ✓ audio session is now playback');
    } catch (e) {
      console.error('[map-voice] Step 2 ✗ setAudioModeAsync threw:', (e as Error).message);
    }
    if (!uri) {
      console.error('[map-voice] no uri after recorder.stop — aborting');
      setStateAnd('idle'); return;
    }

    // Try Realtime first if we have a pre-fetched token. On any failure
    // (timeout, WS close, empty response, error event) we fall through
    // to the legacy pipeline using the SAME recorded URI.
    if (USE_REALTIME && prefetchedTokenRef.current) {
      const ok = await realtimeViaEphemeralToken(uri).catch((e) => {
        console.error('[realtime] dispatcher caught:', (e as Error).message);
        return false;
      });
      prefetchedTokenRef.current = null;
      if (ok) return;
      console.log('[realtime] failed — falling back to legacy pipeline with same URI');
    }
    await legacyRespondFromUri(uri);
  }

  async function legacyRespondFromUri(uri: string) {
    // Snapshot the turn id at the moment we start handling this commit.
    // Every async branch below — TTS fetch, sentence playback chain —
    // checks against this so a stale turn whose response arrived AFTER
    // a new turn started can't accidentally play.
    const myTurn = voiceTurnId.current;
    const isStale = () => voiceTurnId.current !== myTurn;
    try {
      console.log('[legacy] starting from URI:', uri);
      const mime = uri.toLowerCase().endsWith('.m4a') ? 'audio/m4a' : 'audio/webm';
      console.log('[map-voice] Step 3: POST /api/transcribe (mime=' + mime + ')');
      // 5s transcription timeout — Whisper rarely takes more than 1-2s
      // for short voice clips, so anything past 5s is almost certainly
      // a stalled connection and we should reset the UI rather than
      // hold the user on 'thinking…' indefinitely.
      const transcript = await Promise.race([
        api.transcribe(uri, mime),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('transcription timeout')), 5000),
        ),
      ]).catch((e) => {
        console.warn('[map-voice] Step 3 ✗ transcribe failed/timeout:', (e as Error)?.message);
        return null;
      });
      const text = (transcript || '').trim();
      console.log('[map-voice] Step 3 ✓ transcript:', text.length, 'chars',
        text ? `"${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"` : '(empty)');
      if (!text) {
        console.warn('[map-voice] empty transcript — mic may have captured silence; returning to idle');
        setStateAnd('idle'); legacyActive.current = false; return;
      }
      appendMapVoiceTurn('user', text);
      const history = getMapVoiceHistory();

      console.log('[map-voice] Step 4: POST /api/chat (msgs=' + history.length + ')');
      // Sentence-streaming TTS pipeline: as Claude streams the reply we
      // detect complete sentences and fire each /api/speak in parallel,
      // playing through a single sequential chain. The previous
      // implementation `await`ed api.streamChat directly — but streamChat
      // returns a Promise that resolves IMMEDIATELY with the abort
      // function, not when onDone fires. That meant if anything in the
      // stream path threw asynchronously, the outer try/catch missed it
      // and the user saw "thinking → idle" with no log. We now wrap the
      // stream in a manual Promise that resolves on onDone / onError so
      // the outer try/catch actually owns the lifetime.
      let fullReply = '';
      let partFired = false;
      let cleanedConsumed = 0;
      let speakingStateSet = false;
      let playChain: Promise<void> = Promise.resolve();

      function enqueueSentenceForTTS(sentence: string) {
        // Belt-and-braces guard. The earlier sentenceRegex / 10-char
        // filter should already prevent blanks, but if a marker-only or
        // whitespace-only chunk ever reaches here the server would 400
        // ('Empty text after scrubbing markers') and api.speak would
        // return null — visible to the user as a silent step-5 failure.
        const finalText = (sentence || '').trim();
        if (!finalText) {
          console.error('[map-voice] Step 5 skipped — sentence is empty after trim');
          return;
        }
        console.log('[map-voice] Step 5: POST /api/speak (' + finalText.length + ' chars) — "' + finalText.slice(0, 40) + '…"');
        const speakP = api.speak(finalText, { mapVoice: true });
        playChain = playChain.then(async () => {
          // Stale-turn check — if the user started a new voice turn
          // while this sentence's TTS was in flight, drop the audio
          // on the floor instead of overlapping with the new turn.
          if (isStale()) return;
          try {
            const buf = await speakP;
            if (isStale()) return;
            if (!buf) {
              console.error('[map-voice] Step 5 ✗ /api/speak returned null');
              return;
            }
            console.log('[map-voice] Step 6: audio received (' + buf.byteLength + ' bytes), playing...');
            if (!speakingStateSet) {
              speakingStateSet = true;
              setStateAnd('speaking');
            }
            await playArrayBuffer(buf);
            console.log('[map-voice] Step 7: playback complete for sentence');
          } catch (e) {
            console.error('[map-voice] sentence playback threw:', (e as Error).message);
          }
        });
      }

      await new Promise<void>((resolve) => {
        api.streamChat(
          { messages: history, mode: 'ongoing', sessionId, mapVoice: true },
          {
            onDelta: (d) => {
              fullReply += d;
              if (!partFired) {
                const meta = parseChatMeta(fullReply);
                if (meta?.detectedPart && meta.detectedPart !== 'unknown') {
                  partFired = true;
                  console.log('[map-voice] CHAT_META detected:', meta.detectedPart);
                  onDetectedPart?.(meta.detectedPart, meta.partLabel ?? null);
                }
              }
              const cleaned = stripMarkers(fullReply);
              const tail = cleaned.slice(cleanedConsumed);
              const sentenceRegex = /[^.!?\n]+[.!?\n]+/g;
              let m: RegExpExecArray | null;
              let lastEnd = 0;
              while ((m = sentenceRegex.exec(tail)) !== null) {
                const s = m[0].trim();
                if (s.length >= 10) enqueueSentenceForTTS(s);
                lastEnd = m.index + m[0].length;
              }
              cleanedConsumed += lastEnd;
            },
            onDone: (full) => {
              const cleaned = stripMarkers(full || fullReply);
              console.log('[map-voice] Step 4 ✓ chat reply:', cleaned.length, 'chars');
              appendMapVoiceTurn('assistant', cleaned);
              const tail = cleaned.slice(cleanedConsumed).trim();
              if (tail.length >= 3) enqueueSentenceForTTS(tail);
              resolve();
            },
            onError: (err) => {
              console.error('[map-voice] Step 4 ✗ chat error:', err);
              resolve();    // resolve so outer pipeline returns to idle
            },
          },
        );
      });

      // Drain the playback chain so we don't return to 'idle' while a
      // sentence is still being read aloud.
      try { await playChain; } catch (e) {
        console.error('[map-voice] playChain final await threw:', (e as Error).message);
      }
      legacyActive.current = false;
      setStateAnd('idle');
      console.log('[map-voice] ✓ pipeline complete — back to idle');
    } catch (error) {
      console.error('[map-voice] PIPELINE FAILED at:', (error as Error).message, error);
      legacyActive.current = false;
      setStateAnd('idle');
    }
  }

  // Realtime via ephemeral OpenAI session token. Tries to speak directly
  // to wss://api.openai.com/v1/realtime. Returns true on success
  // (response audio played), false on any failure so the dispatcher
  // can fall through to the legacy pipeline using the same recorded
  // URI. Wrapped in its own try so a thrown error here never crashes
  // the dispatcher — fallback always runs.
  async function realtimeViaEphemeralToken(uri: string): Promise<boolean> {
    const myTurn = voiceTurnId.current;
    const isStale = () => voiceTurnId.current !== myTurn;
    try {
      // Wait on the prefetched token (almost certainly already ready).
      console.log('[realtime] awaiting prefetched token...');
      const token = await prefetchedTokenRef.current;
      if (!token) {
        console.warn('[realtime] no token — falling back');
        return false;
      }

      // Read the recorded WAV and strip the header to get raw PCM16
      // base64 (24kHz / mono / 16-bit) — exactly what the Realtime API
      // wants in input_audio_buffer.append.
      console.log('[realtime] reading audio file...');
      const fileUri = uri.startsWith('file://') ? uri : 'file://' + uri;
      const wavB64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log('[realtime] WAV size:', wavB64.length, 'b64 chars');
      const pcmB64 = stripWavHeaderToPcm16Base64(wavB64);
      if (!pcmB64) {
        console.warn('[realtime] empty PCM after header strip — falling back');
        return false;
      }

      // Open the WS. Reanimated/Hermes RN supports the standard
      // WebSocket constructor; OpenAI requires the ephemeral token in
      // the Authorization header + the realtime beta header.
      console.log('[realtime] connecting WebSocket...');
      // RN's WebSocket polyfill accepts a third options arg with
      // `headers`, but lib.dom.d.ts only declares a 2-arg overload —
      // hence the (WebSocket as any)(...) cast.
      const WSCtor: any = WebSocket;
      const ws: WebSocket = new WSCtor(
        'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
        [],
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        },
      );

      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      let responseTimer: ReturnType<typeof setTimeout> | null = null;
      const audioPcmChunks: string[] = [];
      let assistantText = '';
      let ended = false;
      let ok = false;

      // Wrap the entire stream in a single Promise that resolves when
      // we have a finished response (or fails fast on any error).
      await new Promise<void>((resolve) => {
        function finish(success: boolean, reason: string) {
          if (ended) return;
          ended = true;
          ok = success;
          if (connectTimer) clearTimeout(connectTimer);
          if (responseTimer) clearTimeout(responseTimer);
          try { ws.close(); } catch {}
          console.log('[realtime] finished:', reason, '— success=' + success);
          resolve();
        }

        connectTimer = setTimeout(() => finish(false, 'connect timeout (4s)'), 4000);

        ws.onopen = () => {
          if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
          if (isStale()) { finish(false, 'stale on open'); return; }
          console.log('[realtime] connected — sending audio');
          try {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmB64 }));
            ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            ws.send(JSON.stringify({
              type: 'response.create',
              response: { modalities: ['text', 'audio'] },
            }));
            console.log('[realtime] audio sent — waiting for response');
            responseTimer = setTimeout(() => finish(false, 'response timeout (8s)'), 8000);
          } catch (e) {
            finish(false, 'send threw: ' + (e as Error).message);
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string);
            switch (data.type) {
              case 'response.audio.delta':
                if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }
                if (isStale()) { finish(false, 'stale on audio delta'); return; }
                if (typeof data.delta === 'string') {
                  audioPcmChunks.push(data.delta);
                  if (state !== 'speaking') setStateAnd('speaking');
                }
                break;
              case 'response.text.delta':
                if (typeof data.delta === 'string') assistantText += data.delta;
                break;
              case 'response.audio_transcript.delta':
                if (typeof data.delta === 'string') assistantText += data.delta;
                break;
              case 'response.done':
                console.log('[realtime] response.done — text length:', assistantText.length, 'audio chunks:', audioPcmChunks.length);
                finish(audioPcmChunks.length > 0, 'response.done');
                break;
              case 'error':
                console.error('[realtime] API error event:', JSON.stringify(data.error || data));
                finish(false, 'error event');
                break;
              default:
                console.log('[realtime] event:', data.type);
            }
          } catch (e) {
            console.warn('[realtime] message parse failed:', (e as Error).message);
          }
        };

        ws.onerror = (err: any) => {
          console.error('[realtime] WebSocket error:', err && (err.message || err.code || err));
          finish(false, 'ws error');
        };
        ws.onclose = (ev: any) => {
          if (!ended) finish(false, 'ws closed (code=' + (ev?.code || '?') + ')');
        };
      });

      if (!ok || audioPcmChunks.length === 0) return false;
      if (isStale()) return false;

      // Concatenate all PCM16 base64 chunks → raw bytes → wrap with WAV
      // header → play once via the existing playArrayBuffer pipeline.
      // (Streaming chunk-by-chunk playback would need a custom native
      // module; whole-response play keeps latency acceptable for the
      // 1-2 sentence map voice spec.)
      const concatBytes = (() => {
        const decoded = audioPcmChunks.map((c) => base64ToBytes(c));
        const total = decoded.reduce((n, b) => n + b.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const b of decoded) { out.set(b, off); off += b.length; }
        return out;
      })();
      const wavB64Out = pcm16ToWavBase64(bytesToBase64(concatBytes), 24000, 1);
      const wavBytes = base64ToBytes(wavB64Out);
      // Cast through to ArrayBuffer for playArrayBuffer.
      const arrayBuf = wavBytes.buffer.slice(
        wavBytes.byteOffset,
        wavBytes.byteOffset + wavBytes.byteLength,
      ) as ArrayBuffer;

      // Surface CHAT_META markers in the text transcript, if any, so
      // the map can light up the detected part.
      if (assistantText) {
        try {
          const meta = parseChatMeta(assistantText);
          if (meta?.detectedPart && meta.detectedPart !== 'unknown') {
            onDetectedPart?.(meta.detectedPart, meta.partLabel ?? null);
          }
        } catch {}
      }

      console.log('[realtime] playing concatenated response (', concatBytes.length, 'PCM bytes )');
      // The existing playArrayBuffer expects MP3, but Skia's
      // createAudioPlayer happily decodes WAV from a data: URI too.
      await playArrayBuffer(arrayBuf, 'audio/wav');
      appendMapVoiceTurn('assistant', stripMarkers(assistantText));
      setStateAnd('idle');
      return true;
    } catch (e) {
      console.error('[realtime] threw:', (e as Error).message);
      return false;
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
  async function playArrayBuffer(buf: ArrayBuffer, mime: string = 'audio/mpeg') {
    // Single-player guarantee. Tear down any prior player BEFORE we
    // create the next one. Combined with the sequential playChain in
    // legacyRespondFromUri this keeps overlapping voices impossible
    // even when the chain is racing tightly between sentences.
    await stopAndClearAudio();
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
      });
    } catch {}
    const b64 = bytesToBase64(new Uint8Array(buf));
    const dataUri = 'data:' + mime + ';base64,' + b64;
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
  // 'error' state intentionally falls through to 'Tap to speak' so a transient
  // backend hiccup never surfaces as user-visible failure copy. The console
  // logs still capture the diagnostic; the UI just resets silently.
  const label =
    state === 'listening'  ? 'Recording… tap to send' :
    state === 'thinking'   ? 'Thinking…' :
    state === 'speaking'   ? 'Speaking…' :
    state === 'connecting' ? 'Connecting…' :
    state === 'retrying'   ? 'Retrying…' :
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
