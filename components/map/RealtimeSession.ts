// OpenAI Realtime WebSocket session manager. Drives the Map-tab voice flow
// via the existing Railway /realtime proxy which injects the API key and
// system prompt server-side.
//
// IMPORTANT SCOPE NOTE:
// True continuous PCM16 streaming from the mic would require a custom native
// audio module (AVAudioEngine / AudioRecord) — not possible in Expo's managed
// workflow because expo-audio only hands you a finalized file after
// stopAndUnloadAsync(). So the input side here is tap-to-stop:
//   - user taps mic → recorder starts
//   - user taps again → recorder stops, we read the file, strip the WAV
//     header, base64 the PCM, push as one input_audio_buffer.append +
//     commit + response.create on the open socket
// The OUTPUT side is proper streaming — PCM16 deltas accumulate as they
// arrive and we play the whole response via createAudioPlayer the moment
// response.done fires. CHAT_META parsed out of transcript deltas drives
// onPartDetected in real time so the map node animates before playback.

import {
  useAudioRecorder, AudioModule, RecordingPresets,
  createAudioPlayer, setAudioModeAsync,
} from 'expo-audio';
import Constants from 'expo-constants';
import { getUserId } from '../../services/user';
import { parseChatMeta, stripMarkers } from '../../utils/markers';
import { base64ToBytes, bytesToBase64, pcm16ToWavBase64, stripWavHeaderToPcm16Base64 } from '../../utils/audioWav';

const API_BASE: string =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ||
  'https://inner-map-production.up.railway.app';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'retrying' | 'error';

export type RealtimeCallbacks = {
  onStateChange?: (s: VoiceState) => void;
  onPartDetected?: (part: string, label?: string | null) => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onEnded?: (turns: { role: 'user' | 'assistant'; content: string }[]) => void;
};

export class RealtimeSession {
  private ws: WebSocket | null = null;
  private recorderRef: ReturnType<typeof useAudioRecorder> | null = null;
  private cb: RealtimeCallbacks;
  private audioChunks: string[] = [];       // base64 PCM16 deltas for current response
  private aiTranscript = '';
  private userTranscript = '';
  private partFiredThisTurn = false;
  private turns: { role: 'user' | 'assistant'; content: string }[] = [];
  private player: ReturnType<typeof createAudioPlayer> | null = null;
  private closed = false;
  private recording = false;
  // Watchdog for response.done — if we ask the server for a response and
  // nothing comes back in 30s we treat it as stuck and tear down cleanly
  // rather than leaving the user on 'Thinking…' forever.
  private responseTimeout: ReturnType<typeof setTimeout> | null = null;
  // Retry state. OpenAI's Realtime service sometimes returns transient
  // server_error — we cache the PCM we just uploaded and resend up to 3
  // times before giving up. Cleared after response.done.
  private lastPcmB64: string | null = null;
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;

  constructor(cb: RealtimeCallbacks = {}) { this.cb = cb; }

  /** Call this from a React component that has already called
   *  useAudioRecorder(RecordingPresets.HIGH_QUALITY) — we need the hook
   *  instance because RecordingPresets objects are opaque. */
  attachRecorder(r: ReturnType<typeof useAudioRecorder>) { this.recorderRef = r; }

  private setState(s: VoiceState) { this.cb.onStateChange?.(s); }

  async start(): Promise<boolean> {
    console.log('[realtime] start() — requesting mic permission');
    this.setState('connecting');
    try {
      // Mic permission (required whether we end up using realtime or falling back).
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      console.log('[realtime] mic permission:', perm.granted);
      if (!perm.granted) {
        this.setState('error');
        return false;
      }
      // CRITICAL on iOS: the audio session category must be PlayAndRecord
      // BEFORE the recorder prepares/starts or the mic captures silence even
      // though permission is granted. `allowsRecording: true` +
      // `playsInSilentMode: true` selects PlayAndRecord; `doNotMix` requests
      // exclusive audio focus so a backgrounded player/tts/realtime-output
      // from an earlier turn can't leave us in a playback-only category.
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
          shouldPlayInBackground: false,
        });
        console.log('[realtime] audio mode set — allowsRecording:true, category=PlayAndRecord, interruption=doNotMix');
      } catch (e) {
        console.warn('[realtime] setAudioModeAsync failed:', (e as Error)?.message);
      }

      // Open socket. The server-side proxy injects the OpenAI key +
      // session.update with the Inner Map system prompt as soon as the
      // upstream connects — we just need to keep our end alive.
      const userId = await getUserId();
      const wsUrl = API_BASE.replace(/^http/, 'ws') + '/realtime';
      console.log('[realtime] WS status: connecting →', wsUrl);
      const WSAny = WebSocket as any;
      const ws = new WSAny(wsUrl, undefined, { headers: { 'X-User-Id': userId } });
      this.ws = ws;

      // Open gate with a hard timeout so a stuck socket doesn't lock up the UI.
      const ok = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          console.warn('[realtime] WS open TIMEOUT after 2500ms');
          resolve(false);
        }, 2500);
        ws.onopen = () => { clearTimeout(timer); resolve(true); };
        ws.onerror = (e: any) => {
          console.warn('[realtime] WS error during open:', e?.message || 'no message');
          clearTimeout(timer); resolve(false);
        };
      });
      if (!ok) { console.warn('[realtime] WS status: failed — falling back'); this.cleanup(); return false; }
      console.log('[realtime] WS status: open ✓');

      ws.onmessage = (ev: any) => this.handleServerEvent(ev);
      ws.onclose = (ev: any) => {
        console.log('[realtime] WS closed (passive — upstream or proxy closed us):',
          'code=' + (ev?.code ?? '?'),
          'reason="' + (ev?.reason ?? '') + '"',
          'wasClean=' + (ev?.wasClean ?? '?'),
        );
        this.cleanup();
      };
      ws.onerror = (e: any) => { console.warn('[realtime] WS error', e?.message); };

      // Recorder uses the preset's sample rate — 44.1k on iOS default, the
      // server re-samples. Having non-24k input is fine for one-shot uploads.
      if (!this.recorderRef) {
        console.warn('[realtime] no recorder attached — cannot capture mic');
        this.cleanup();
        return false;
      }
      console.log('[realtime] starting recording…');
      await this.recorderRef.prepareToRecordAsync();
      this.recorderRef.record();
      this.recording = true;
      console.log('[realtime] recording started ✓');
      this.setState('listening');
      return true;
    } catch (e) {
      console.warn('[realtime] start failed:', (e as Error)?.message);
      this.cleanup();
      return false;
    }
  }

  /** Called when user taps the mic a second time — finalize the recording,
   *  upload the audio, and ask the server for a response. */
  async commitTurn(): Promise<void> {
    console.log('[realtime] commitTurn called — NOT closing session, waiting for response');
    console.log(
      '[realtime] commitTurn() — ws?=', !!this.ws,
      'readyState=', this.ws?.readyState,
      'recorder?=', !!this.recorderRef,
      'recording=', this.recording,
    );
    if (!this.ws || this.ws.readyState !== 1 || !this.recorderRef) {
      console.warn('[realtime] commitTurn aborted — socket or recorder missing');
      return;
    }
    if (!this.recording) {
      console.warn('[realtime] commitTurn aborted — not recording');
      return;
    }
    this.setState('thinking');
    try {
      console.log('[realtime] stopping recording…');
      await this.recorderRef.stop();
      this.recording = false;
      const uri = this.recorderRef.uri;
      console.log('[realtime] recording stopped, file uri:', uri);
      if (!uri) { console.warn('[realtime] no uri after stop — aborting'); return; }
      // Read WAV. fetch(file://) works on iOS reliably and on Android in
      // most cases; if blob() fails we fall back to reading as text and
      // re-encoding. Log sizes at each step so we can see where audio is lost.
      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      console.log('[realtime] blob size =', blob.size, 'bytes, type =', blob.type);
      if (blob.size < 512) {
        console.warn('[realtime] blob too small — mic may not have captured audio. Check mic permission.');
      }
      const b64 = await blobToBase64(blob);
      // Sanity check: the first 4 decoded bytes of a RIFF/WAVE file are
      //   0x52 0x49 0x46 0x46  ("RIFF"). If they're anything else, the
      //   recorder gave us the wrong format (typically AAC-in-M4A) and the
      //   strip-header path will produce garbage bytes the upstream rejects.
      const rawBytes = base64ToBytes(b64);
      const magic = Array.from(rawBytes.subarray(0, 4))
        .map((b) => b.toString(16).padStart(2, '0')).join(' ');
      const isWav = rawBytes[0] === 0x52 && rawBytes[1] === 0x49 && rawBytes[2] === 0x46 && rawBytes[3] === 0x46;
      console.log('[realtime] first 4 bytes:', magic, isWav ? '(RIFF — WAV ✓)' : '(NOT WAV — upload will fail)');
      if (!isWav) {
        console.warn('[realtime] recorder did not produce WAV — aborting upload to avoid a stuck turn');
        this.setState('error');
        return;
      }
      const pcmB64 = stripWavHeaderToPcm16Base64(b64);
      if (!pcmB64) { console.warn('[realtime] empty PCM after header strip'); this.setState('error'); return; }
      // Energy check — decode a subset of the PCM to confirm the recorder
      // actually captured audio. If every sample is zero the mic never
      // produced sound (silent boot, permission stub, wrong route on iOS,
      // etc.), and OpenAI will error server-side on an empty buffer.
      const pcmBytes = base64ToBytes(pcmB64);
      const energy = checkAudioEnergy(pcmBytes);
      const first20 = Array.from(pcmBytes.slice(0, 20))
        .map((b) => b.toString(16).padStart(2, '0')).join(' ');
      console.log('[realtime] first 20 PCM bytes:', first20);
      console.log(
        '[realtime] audio energy — maxAmp=' + energy.maxAmplitude,
        'rms=' + energy.rms,
        'hasAudio=' + energy.hasAudio,
      );
      if (!energy.hasAudio) {
        console.warn('[realtime] recording appears silent (maxAmp < 100) — not sending. Mic may not have captured audio.');
        this.setState('idle');
        return;
      }
      const pcmByteCount = Math.round((pcmB64.length * 3) / 4);
      // PCM16 mono @ 24kHz = 48000 bytes/second. Realtime requires >=100ms
      // (4800 bytes) to accept a commit — any less and OpenAI rejects with
      // input_audio_buffer_commit_empty and closes.
      console.log(
        '[realtime] uploading audio chunk —',
        'pcm b64 chars=' + pcmB64.length,
        'pcm bytes≈' + pcmByteCount,
        'duration≈' + (pcmByteCount / 48000).toFixed(2) + 's',
      );
      if (pcmByteCount < 4800) {
        console.warn('[realtime] ⚠ audio is shorter than 100ms — OpenAI may reject commit');
      }
      // Cache so we can retry the same audio on a transient OpenAI
      // server_error without re-recording.
      this.lastPcmB64 = pcmB64;
      this.retryCount = 0;
      this.sendTurnFrames(pcmB64);
      console.log('[realtime] user turn committed, awaiting response.done (30s watchdog armed)');
    } catch (e) {
      console.warn('[realtime] commitTurn failed:', (e as Error)?.message);
      this.setState('error');
    }
  }

  /** Low-level: send append + commit + response.create for a cached PCM
   *  payload, and arm the 30s response watchdog. Used by both commitTurn()
   *  (first attempt) and retryLastTurn() (after a transient server_error). */
  private sendTurnFrames(pcmB64: string) {
    if (!this.ws || this.ws.readyState !== 1) {
      console.warn('[realtime] sendTurnFrames aborted — ws not open');
      return;
    }
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmB64 }));
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.ws.send(JSON.stringify({ type: 'response.create' }));
    if (this.responseTimeout) clearTimeout(this.responseTimeout);
    this.responseTimeout = setTimeout(() => {
      console.warn('[realtime] response.done timeout after 30s — stopping session');
      this.cleanup();
    }, 30000);
  }

  /** Retry the last committed turn after a transient OpenAI error. Uses the
   *  cached PCM so we don't force the user to re-record. Called from the
   *  server_error branch of handleServerEvent. */
  private retryLastTurn() {
    if (!this.lastPcmB64) {
      console.warn('[realtime] retryLastTurn: no cached PCM');
      this.setState('error');
      return;
    }
    if (!this.ws || this.ws.readyState !== 1) {
      console.warn('[realtime] retryLastTurn: socket closed, cannot retry');
      this.setState('error');
      return;
    }
    console.log(`[realtime] retrying last turn (attempt ${this.retryCount}/${this.MAX_RETRIES})`);
    this.setState('retrying');
    // Switch back to thinking so the UI stops flashing the retry pill after
    // the resend is on its way.
    setTimeout(() => {
      this.setState('thinking');
    }, 400);
    this.sendTurnFrames(this.lastPcmB64);
  }

  /** Fully tear down: close WS, stop playback, end recording, fire onEnded.
   *  Only call this on unmount. commitTurn() NEVER calls this. */
  stop() {
    console.log('[realtime] stop() called — tearing down session', new Error('stop trace').stack?.split('\n').slice(1, 5).join(' | '));
    this.cleanup();
  }

  private handleServerEvent(ev: any) {
    let evt: any;
    try { evt = typeof ev.data === 'string' ? JSON.parse(ev.data) : null; }
    catch { return; }
    if (!evt) return;

    switch (evt.type) {
      case 'session.created':
      case 'session.updated':
        // nothing to do — server proxy already pre-configured the session
        break;
      case 'response.audio.delta':
        if (typeof evt.delta === 'string') this.audioChunks.push(evt.delta);
        break;
      case 'response.audio_transcript.delta':
        if (typeof evt.delta === 'string') {
          this.aiTranscript += evt.delta;
          if (!this.partFiredThisTurn) {
            const meta = parseChatMeta(this.aiTranscript);
            if (meta?.detectedPart && meta.detectedPart !== 'unknown') {
              this.partFiredThisTurn = true;
              this.cb.onPartDetected?.(meta.detectedPart, meta.partLabel ?? null);
            }
          }
        }
        break;
      case 'response.audio_transcript.done': {
        const cleaned = stripMarkers(evt.transcript || this.aiTranscript).trim();
        if (cleaned) {
          this.turns.push({ role: 'assistant', content: cleaned });
          this.cb.onAssistantTranscript?.(cleaned);
        }
        this.aiTranscript = '';
        this.partFiredThisTurn = false;
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof evt.transcript === 'string') {
          const t = evt.transcript.trim();
          if (t) {
            this.turns.push({ role: 'user', content: t });
            this.cb.onUserTranscript?.(t);
          }
        }
        break;
      case 'response.done': {
        if (this.responseTimeout) { clearTimeout(this.responseTimeout); this.responseTimeout = null; }
        // Turn completed cleanly — drop cached PCM + retry counter.
        this.lastPcmB64 = null;
        this.retryCount = 0;
        this.setState('speaking');
        // Concatenate all collected PCM16 deltas and play as one WAV.
        // After playback, return to idle — the user taps the mic again to
        // start the next turn. No auto-resume (keeps the flow predictable:
        // one tap = one action).
        this.playAccumulatedAudio().then(() => {
          this.setState('idle');
        });
        break;
      }
      case 'error': {
        const errType = evt?.error?.type || '(unknown)';
        const errMsg  = evt?.error?.message || '';
        console.warn('[realtime] server error:', errType, errMsg, JSON.stringify(evt?.error || {}).slice(0, 400));
        // OpenAI Realtime occasionally returns transient server_error — the
        // same PCM retried a second later usually goes through. We cache the
        // last payload so the user never has to re-record.
        if (errType === 'server_error' && this.lastPcmB64) {
          this.retryCount += 1;
          if (this.retryCount <= this.MAX_RETRIES) {
            console.log(`[realtime] transient OpenAI error — retry ${this.retryCount}/${this.MAX_RETRIES} in 1s`);
            if (this.responseTimeout) { clearTimeout(this.responseTimeout); this.responseTimeout = null; }
            this.setState('retrying');
            setTimeout(() => this.retryLastTurn(), 1000);
          } else {
            console.warn('[realtime] max retries reached — giving up on this turn');
            this.setState('error');
            // Don't tear down the whole session — the user can tap mic again.
            this.lastPcmB64 = null;
            this.retryCount = 0;
            // Bump back to idle after a moment so the mic is tappable again.
            setTimeout(() => this.setState('idle'), 1500);
          }
        } else {
          // Non-transient error (invalid_request_error etc.) — surface and
          // let the user decide.
          this.setState('error');
          setTimeout(() => this.setState('idle'), 1500);
        }
        break;
      }
    }
  }

  private async playAccumulatedAudio() {
    if (this.audioChunks.length === 0) { this.setState('listening'); return; }
    const fullPcmB64 = concatBase64(this.audioChunks);
    this.audioChunks = [];
    try {
      const wavB64 = pcm16ToWavBase64(fullPcmB64, 24000, 1);
      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          interruptionMode: 'mixWithOthers',
          shouldPlayInBackground: false,
        });
      } catch {}
      const player = createAudioPlayer({ uri: 'data:audio/wav;base64,' + wavB64 });
      this.player = player;
      player.play();
      // Poll for finish (expo-audio's event API varies across SDK versions).
      while (this.player === player && !this.closed) {
        try {
          const s = player.currentStatus;
          if (s?.didJustFinish || s?.isLoaded === false) break;
        } catch { break; }
        await new Promise((r) => setTimeout(r, 250));
      }
      try { player.remove(); } catch {}
      if (this.player === player) this.player = null;
    } catch (e) {
      console.warn('[realtime] playback failed:', (e as Error)?.message);
    }
  }

  /** Start recording the next user turn on the already-open socket. Called
   *  from MapVoiceButton when the user taps mic after a 'speaking'→'idle'
   *  transition so the WS session is reused across turns. */
  async startNextTurn(): Promise<boolean> {
    if (this.closed || !this.recorderRef || !this.ws || this.ws.readyState !== 1) return false;
    try {
      // Playback switched the session to mixWithOthers + allowsRecording:false.
      // Flip back to PlayAndRecord + doNotMix BEFORE prepareToRecordAsync —
      // otherwise iOS keeps the previous category and the mic stays muted.
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
      });
      console.log('[realtime] audio mode set for next turn — allowsRecording:true');
      await this.recorderRef.prepareToRecordAsync();
      this.recorderRef.record();
      this.recording = true;
      this.setState('listening');
      return true;
    } catch (e) {
      console.warn('[realtime] startNextTurn failed:', (e as Error)?.message);
      this.setState('idle');
      return false;
    }
  }

  private cleanup() {
    if (this.closed) return;
    console.log('[realtime] cleanup() — closing session. Caller:',
      new Error('cleanup trace').stack?.split('\n').slice(1, 6).join(' | '),
    );
    this.closed = true;
    if (this.responseTimeout) { clearTimeout(this.responseTimeout); this.responseTimeout = null; }
    try { this.player?.pause(); this.player?.remove(); } catch {}
    this.player = null;
    try { if (this.recording && this.recorderRef) this.recorderRef.stop(); } catch {}
    this.recording = false;
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.cb.onEnded?.(this.turns);
    this.setState('idle');
  }
}

// ---- helpers ----

/** Scan a PCM16 little-endian buffer for signal energy. A fully silent
 *  recording has maxAmplitude = 0; quiet room noise is usually < 50; normal
 *  speech peaks well above 1000 on int16. If nothing crosses 100 the mic
 *  didn't capture real audio — sending it to OpenAI just wastes the turn. */
function checkAudioEnergy(pcmBytes: Uint8Array): { hasAudio: boolean; maxAmplitude: number; rms: number } {
  let sumSquares = 0;
  let maxAmp = 0;
  // PCM16 = 2 bytes/sample, little-endian, signed. Samples limited to ~200k
  // to cap work on long recordings — plenty to judge whether there's signal.
  const endIndex = Math.min(pcmBytes.length - 1, 400000);
  let sampleCount = 0;
  for (let i = 0; i < endIndex; i += 2) {
    // Reconstruct signed int16: LE bytes → 16-bit value, sign-extend via <<16 >>16.
    const raw = pcmBytes[i] | (pcmBytes[i + 1] << 8);
    const sample = (raw << 16) >> 16;
    sumSquares += sample * sample;
    const abs = sample < 0 ? -sample : sample;
    if (abs > maxAmp) maxAmp = abs;
    sampleCount++;
  }
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  return { hasAudio: maxAmp > 100, maxAmplitude: maxAmp, rms: Math.round(rms) };
}

async function blobToBase64(blob: Blob): Promise<string> {
  // RN's FileReader supports readAsDataURL which returns "data:...;base64,<..>"
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function concatBase64(parts: string[]): string {
  // Decode each, concat bytes, re-encode. Fine for a single response (typically
  // <1MB of audio); don't use this on streaming loops.
  let total = 0;
  const arrs: Uint8Array[] = parts.map((p) => {
    const b = base64ToBytes(p);
    total += b.length;
    return b;
  });
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return bytesToBase64(out);
}
