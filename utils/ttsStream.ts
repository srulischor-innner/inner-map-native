// Streaming TTS controller. When audio mode is ON and a new AI message
// begins streaming, instead of waiting for the whole reply before fetching
// audio (the old "play after onDone" path), we fetch and play in chunks
// of 1-3 sentences as they complete.
//
// ORDER GUARANTEE — single sequential chain:
//   Out-of-order playback ("read end first, then beginning") is what
//   happens when we run multiple api.speak() requests in parallel and
//   push their buffers into a queue based on which fetch resolved
//   first. To prevent that, this controller maintains a single
//   `activeChain` promise. Each enqueued sentence appends to the chain
//   via `chain = chain.then(...)`, so:
//     - sentence N+1's fetch waits for sentence N's playback to finish
//     - the network speak() calls are intentionally serial
//     - playback order matches enqueue order regardless of which
//       /api/speak round trip happened to be slow
//   Tradeoff: a small pause between sentences while the next one
//   fetches (~0.5–1s on ElevenLabs). Sounds natural — like the
//   reader breathing between thoughts.
//
// Other design constraints:
//  - Only ONE streaming session active at a time. Starting a new one
//    bumps watchToken so any in-flight chain step short-circuits.
//  - Coexists with the single-clip ttsPlayer used for tap-to-replay:
//    when streaming starts, ttsPlayer.stopAll() runs so the two layers
//    never both produce sound at once.
//  - Honors audio-mode flips. If the user long-presses a speaker mid-
//    stream, cancelStream() runs and everything goes silent.
//  - Chunking: we extract complete sentences (terminated by . ! ? \n)
//    and emit a TTS request when the in-buffer text reaches a soft
//    minimum (~80 chars) OR the stream finishes. This avoids per-word
//    fetches that produce unnatural one-syllable audio.

import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
// expo-file-system legacy entry — class-based File API is in the
// new top-level export, but the path-based writeAsStringAsync we
// need still ships under /legacy and is the simplest call for
// "write base64 bytes to cache" in standalone builds.
import * as FileSystem from 'expo-file-system/legacy';
import { api } from '../services/api';
type Player = ReturnType<typeof createAudioPlayer>;

// We write each chunk to a single fixed cache file rather than data
// URIs because expo-audio's data-URI playback was failing silently
// on iOS standalone preview builds (Console.app showed createAudioPlayer
// returned a player, play() threw nothing, didJustFinish eventually
// fired — but no sound came out of the speaker). file:// URIs work
// reliably. The worker is strictly sequential so reusing the same
// path is safe — by the time we overwrite for the next sentence,
// the previous player has been remove()'d.
const TTS_CACHE_FILE = (FileSystem.cacheDirectory || '') + 'tts_chunk.mp3';

const SOFT_MIN_CHARS = 80;

let active = false;
let currentMessageId: string | null = null;
let buffer = '';                        // unconsumed text (no complete sentence yet)
let consumedSoFar = 0;                  // chars handed in via append(), used by caller
let player: Player | null = null;
let watchToken = 0;

// Sequential FIFO queue + single worker. Earlier this was a Promise.then()
// chain — each chainSentence call appended `.then(async () => fetch+play)`.
// That LOOKS sequential but Metro logs caught the chain firing multiple
// /api/speak fetches in parallel: by the time the first step hit
// `await api.speak`, subsequent steps' fetches were already in flight,
// and when a later sentence's audio arrived faster than the earlier
// one's playback finished, they overlapped audibly.
//
// Replaced with an explicit queue + worker so "fetch then play then
// fetch then play" is structural, not promise-chain-dependent. Only
// one worker drains the queue at a time; new chainSentence calls
// enqueue and kick the worker if it's idle. cancelStream clears the
// queue immediately so muted/ended sessions can't bleed audio.
type ChainItem = { text: string; myToken: number };
const chainQueue: ChainItem[] = [];
let chainWorkerActive = false;
// Chain bookkeeping for the [tts] chain complete log + duplication
// diagnostics. Scheduled increments synchronously when a sentence is
// queued; completed/played increment in the chain step's finally.
// Reset at every session boundary so each chain reports its own count
// cleanly without bleed-through.
let chainScheduled = 0;
let chainCompleted = 0;
let chainPlayed = 0;

function resetChainCounters() {
  chainScheduled = 0;
  chainCompleted = 0;
  chainPlayed = 0;
}

// Logs `[tts] chain complete — N sentences played` exactly once per
// chain session. Only fires when (a) we're still the current session,
// (b) no more text will arrive (active === false), and (c) every
// scheduled step has reported back. Resets counters after firing so a
// later cancel/restart doesn't double-log.
function maybeLogChainComplete(myToken: number) {
  if (myToken !== watchToken) return;
  if (active) return;
  if (chainScheduled === 0) return;
  if (chainCompleted < chainScheduled) return;
  console.log(`[tts] chain complete — ${chainPlayed} sentences played`);
  resetChainCounters();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)) as any,
    );
  }
  return globalThis.btoa ? globalThis.btoa(binary) : '';
}

export function isStreamingActive(): boolean { return active; }
export function getStreamingMessageId(): string | null { return currentMessageId; }

/** One-shot playback of an already-complete message. Used when the user
 *  flips the audio toggle ON and we want the most recent AI bubble to
 *  play immediately. Cancels anything currently playing, then splits
 *  the full text into sentences and chains them through the same
 *  sequential fetch+play pipeline used by the streaming path — so
 *  order is guaranteed even on a long message. */
/** One-shot playback of an already-TTS'd audio buffer (e.g. coming back
 *  from /api/self-voice). The server has already done both the
 *  Claude-generation and the tts-1-hd round trip, so we just need to
 *  play the bytes. Uses the same playOneBuffer infrastructure as the
 *  chat-streaming chain so any fixes to the audio playback layer
 *  benefit both paths automatically.
 *
 *  Cancels any in-flight chat stream first. The supplied messageId is
 *  for log identification only — the worker bookkeeping doesn't run
 *  for one-shot playback. */
export async function playPreFetchedAudio(messageId: string, buf: ArrayBuffer): Promise<void> {
  console.log(`[tts] playPreFetchedAudio ENTER — messageId=${messageId.slice(0, 8)} bytes=${buf.byteLength}`);
  cancelStream();
  // cancelStream already bumped watchToken. Use the post-bump value so
  // playOneBuffer's stale-token check passes and the play actually runs.
  await playOneBuffer(buf, watchToken);
  console.log('[tts] playPreFetchedAudio EXIT');
}

export async function playMessageNow(messageId: string, text: string): Promise<void> {
  const t = (text || '').trim();
  console.log('[tts] playMessageNow id=' + messageId.slice(0, 8) + ' chars=' + t.length);
  if (!t) return;
  cancelStream();
  active = false;
  currentMessageId = messageId;
  buffer = '';
  consumedSoFar = 0;
  watchToken++;
  resetChainCounters();
  // Same one-time session setup as startStream — playMessageNow is
  // the toggle-on path and doesn't go through startStream, so it has
  // to configure the session itself. doNotMix is what keeps the
  // previous player's tail from overlapping with the next one.
  configureAudioSessionForPlayback();
  // Split into sentences; whitespace AFTER terminal punctuation is the
  // boundary. Empty entries are filtered out. Each sentence chains
  // strictly behind the previous one's playback completion.
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  console.log('[tts] playMessageNow split into ' + sentences.length + ' sentences');
  if (sentences.length === 0) {
    chainSentence(t);
    return;
  }
  for (const s of sentences) chainSentence(s);
}

/** Begin a new streaming session for the given AI message id. Cancels
 *  any prior streaming session AND stops the single-clip ttsPlayer.
 *  Returns immediately — the caller appends text via appendStreamText
 *  as the model produces deltas. */
export async function startStream(messageId: string): Promise<void> {
  console.log(`[tts] startStream ENTER — messageId=${messageId.slice(0, 8)} prevWatchToken=${watchToken} prevActive=${active}`);
  cancelStream();
  active = true;
  currentMessageId = messageId;
  buffer = '';
  consumedSoFar = 0;
  watchToken++;
  resetChainCounters();
  // One-time audio session setup for the whole chain. Configuring
  // once (here) instead of per-buffer (inside playOneBuffer) avoids
  // the click/pop iOS produces when the session is reconfigured mid-
  // stream. Fire-and-forget — by the time the first sentence's fetch
  // returns (~2s), the session config has long since landed.
  configureAudioSessionForPlayback();
  console.log(`[tts] startStream DONE — id=${messageId.slice(0, 8)} watchToken=${watchToken} active=${active}`);
}

/** Feed cumulative cleaned text (markers stripped). Internally tracks how
 *  much we've already processed and only consumes the new tail. Caller
 *  doesn't need to slice. */
export function appendStreamText(fullCleanText: string): void {
  if (!active) return;
  if (fullCleanText.length <= consumedSoFar) return;
  const newTail = fullCleanText.slice(consumedSoFar);
  consumedSoFar = fullCleanText.length;
  buffer += newTail;
  flushReadyChunks(false);
}

/** Tell the controller the model has finished. Forces any remaining
 *  buffered text out as a final chunk. The audio queue continues to
 *  drain after this returns; cancelStream() interrupts it. */
export function finishStream(): void {
  if (!active) return;
  flushReadyChunks(true);
  active = false;
  console.log('[tts] finish — letting queue drain');
  // If the audio fetches outpaced the streaming text and every
  // scheduled step has already played, the chain is drained NOW —
  // no in-flight step will fire the chain-complete log on its own.
  // Cover that race by checking here too.
  maybeLogChainComplete(watchToken);
}

/** Stop everything. Bumps watchToken so any in-flight chain step
 *  short-circuits, releases the current player, drops the chain.
 *  Idempotent — every operation below tolerates being a no-op.
 *
 *  No early-return on (!active && !player). That state arises naturally
 *  in the GAP between sentences while the next /api/speak fetch is in
 *  flight: the previous sentence's player has been removed, finishStream
 *  has already set active=false, but a chain step is pending. Returning
 *  early there meant the audio toggle could fire here, do nothing, and
 *  the pending step would then play its sentence — audio kept playing
 *  after the user muted. Always bumping watchToken kills the chain
 *  cleanly regardless of which phase we caught it in. */
export function cancelStream(): void {
  // Capture the caller's stack so we can see WHO is cancelling. Most
  // silent-audio bugs trace to a cancelStream firing at the wrong
  // moment (mute toggle, tab unmount, end-session, route navigation,
  // a defensive cancel inside startStream/playMessageNow). The first
  // 3 stack frames are usually enough to identify the path.
  const stack = (() => {
    try {
      const s = (new Error('cancelStream caller')).stack || '';
      // First line is the message; next 4 are frames. Trim to keep
      // the log line readable.
      return s.split('\n').slice(1, 5).map(x => x.trim()).join(' | ');
    } catch { return '(stack unavailable)'; }
  })();
  console.log(`[tts] cancelStream CALLED — prevWatchToken=${watchToken} prevActive=${active} prevPlayer=${player ? 'present' : 'null'} prevQueueLen=${chainQueue.length} prevWorkerActive=${chainWorkerActive} caller=[${stack}]`);
  watchToken++;
  active = false;
  currentMessageId = null;
  buffer = '';
  consumedSoFar = 0;
  if (player) {
    try { player.pause(); player.remove(); } catch {}
    player = null;
  }
  // Drop every queued sentence. The worker, if currently mid-step,
  // sees the watchToken bump on its post-play check and `continue`s;
  // its next loop iteration finds the queue empty and exits. New
  // sessions add to the now-empty queue and a fresh worker drains it.
  chainQueue.length = 0;
  resetChainCounters();
  console.log(`[tts] cancelStream DONE — newWatchToken=${watchToken}`);
}

// ----------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------

/** Extract the longest run of complete sentences from `buffer` whose
 *  combined length is >= SOFT_MIN_CHARS, then submit it for TTS. If
 *  `force` is true (stream finished), submit whatever remains even if
 *  it doesn't meet the minimum. */
function flushReadyChunks(force: boolean): void {
  // Find complete sentences in the buffer. A "sentence" ends at . ! ? or \n.
  const re = /[^.!?\n]+[.!?\n]+/g;
  const matches: { text: string; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(buffer)) !== null) {
    matches.push({ text: m[0], end: m.index + m[0].length });
  }

  if (matches.length === 0) {
    if (force && buffer.trim()) {
      const tail = buffer.trim();
      buffer = '';
      chainSentence(tail);
    }
    return;
  }

  // Build groups of complete sentences whose combined length meets the
  // soft min. Each group becomes one TTS request. Anything past the last
  // complete sentence stays in the buffer for the next append.
  let i = 0;
  while (i < matches.length) {
    let group = '';
    let j = i;
    while (j < matches.length && (group.length < SOFT_MIN_CHARS || j - i < 1)) {
      group += matches[j].text;
      j++;
      // Stop at most after 3 sentences per chunk.
      if (j - i >= 3) break;
    }
    if (!force && group.length < SOFT_MIN_CHARS) {
      // Not enough text yet — leave it in the buffer.
      break;
    }
    const cleanGroup = group.trim();
    if (cleanGroup) chainSentence(cleanGroup);
    i = j;
  }

  // Drop everything we consumed; keep any incomplete tail (text after
  // the last complete sentence) for the next append.
  if (i > 0) {
    const lastEnd = matches[i - 1].end;
    buffer = buffer.slice(lastEnd);
  }

  if (force && buffer.trim()) {
    const tail = buffer.trim();
    buffer = '';
    chainSentence(tail);
  }
}

/** Enqueue a sentence for the sequential fetch+play worker. The
 *  worker (processChainQueue) drains items one at a time, awaiting
 *  the fetch AND the playback of each before pulling the next item
 *  off the queue. So there is exactly one /api/speak in flight and
 *  one player active at a time, in insertion order — guaranteed
 *  structurally rather than via promise-chain ordering. */
function chainSentence(text: string): void {
  const myToken = watchToken;
  chainScheduled++;
  console.log(`[tts] chainSentence ENQUEUE — chars=${text.length} myToken=${myToken} watchToken=${watchToken} queueLenBefore=${chainQueue.length} workerActive=${chainWorkerActive} active=${active}`);
  chainQueue.push({ text, myToken });
  console.log(`[tts] chainSentence pushed — queueLenAfter=${chainQueue.length} chainScheduled=${chainScheduled}`);
  // Fire-and-forget kick. The worker self-guards against double-entry
  // via chainWorkerActive, so concurrent kicks are safe — the second
  // call returns immediately and the running worker eventually picks
  // up the new item on its next loop iteration.
  processChainQueue().catch((e) => {
    console.warn('[tts] chain worker threw:', (e as Error)?.message);
  });
}

/** The single sequential worker. Pulls the head item off chainQueue,
 *  fetches its audio, plays it, and only THEN pulls the next item.
 *  Returns when the queue is empty so a later chainSentence call can
 *  re-kick the worker. */
async function processChainQueue(): Promise<void> {
  console.log(`[tts] processChainQueue called — workerActive=${chainWorkerActive} queueLen=${chainQueue.length}`);
  if (chainWorkerActive) {
    console.log('[tts] processChainQueue EARLY RETURN — worker already active, leaving the running worker to pick up new items');
    return;
  }
  chainWorkerActive = true;
  console.log('[tts] worker START — claiming chainWorkerActive=true');
  let iteration = 0;
  try {
    while (chainQueue.length > 0) {
      iteration++;
      const item = chainQueue.shift();
      console.log(`[tts] worker iter ${iteration} SHIFT — remainingQueueLen=${chainQueue.length} item=${item ? `myToken=${item.myToken} chars=${item.text.length}` : 'null'}`);
      if (!item) break;
      // Stale item from a cancelled session — drop without touching
      // counters. The cancel already zeroed them.
      if (item.myToken !== watchToken) {
        console.log(`[tts] worker iter ${iteration} STALE — item.myToken=${item.myToken} watchToken=${watchToken} — dropping without bookkeeping`);
        continue;
      }

      let stepPlayed = false;
      try {
        console.log(`[tts] worker iter ${iteration} → api.speak(chars=${item.text.length})…`);
        let buf = await api.speak(item.text);
        console.log(`[tts] worker iter ${iteration} ← api.speak returned ${buf ? `bytes=${buf.byteLength}` : 'null'} — myToken=${item.myToken} watchToken=${watchToken}`);
        if (item.myToken !== watchToken) {
          console.log(`[tts] worker iter ${iteration} STALE post-fetch — dropping`);
          continue;
        }
        if (!buf) {
          console.warn(`[tts] worker iter ${iteration} api.speak returned null — retrying once`);
          buf = await api.speak(item.text);
          console.log(`[tts] worker iter ${iteration} ← retry returned ${buf ? `bytes=${buf.byteLength}` : 'null'}`);
          if (item.myToken !== watchToken) {
            console.log(`[tts] worker iter ${iteration} STALE post-retry — dropping`);
            continue;
          }
          if (!buf) {
            console.error(`[tts] worker iter ${iteration} api.speak returned null on retry — dropping sentence`);
          }
        }
        if (buf) {
          console.log(`[tts] worker iter ${iteration} → playOneBuffer(bytes=${buf.byteLength})…`);
          await playOneBuffer(buf, item.myToken);
          console.log(`[tts] worker iter ${iteration} ← playOneBuffer returned — myToken=${item.myToken} watchToken=${watchToken}`);
          if (item.myToken !== watchToken) {
            console.log(`[tts] worker iter ${iteration} STALE post-play — dropping (cancelStream fired during playback)`);
            continue;
          }
          stepPlayed = true;
        }
      } catch (e) {
        console.warn(`[tts] worker iter ${iteration} chain step threw:`, (e as Error)?.message);
      } finally {
        if (item.myToken === watchToken) {
          chainCompleted++;
          if (stepPlayed) chainPlayed++;
          console.log(`[tts] worker iter ${iteration} BOOKKEEP — stepPlayed=${stepPlayed} chainCompleted=${chainCompleted} chainPlayed=${chainPlayed} chainScheduled=${chainScheduled} active=${active}`);
          maybeLogChainComplete(item.myToken);
        } else {
          console.log(`[tts] worker iter ${iteration} skip-bookkeep — myToken stale`);
        }
      }
    }
    console.log(`[tts] worker LOOP END — totalIterations=${iteration} queueLenFinal=${chainQueue.length}`);
  } finally {
    chainWorkerActive = false;
    console.log('[tts] worker END — releasing chainWorkerActive=false');
  }
}

/** Configure the iOS audio session for sequential playback. Called
 *  ONCE per playback session (startStream / playMessageNow), not per
 *  buffer. Per-buffer reconfiguration was producing audible clicks
 *  at sentence boundaries as iOS torn-down and re-set up the session
 *  between every fetch+play cycle.
 *
 *  interruptionMode='doNotMix' is critical: with the previous
 *  'mixWithOthers' setting, iOS would let the previous player's
 *  tail buffer continue draining out of the audio engine WHILE the
 *  next player started — producing audible overlap at every sentence
 *  boundary even though the chain itself was strictly sequential.
 *  Every other audio path in this app already uses 'doNotMix' (chat
 *  recording, map voice, guide ask, journal, etc); ttsStream.ts was
 *  the lone holdout that allowed mixing. */
async function configureAudioSessionForPlayback(): Promise<void> {
  const t0 = Date.now();
  console.log('[tts] configureAudioSession ENTER → calling setAudioModeAsync');
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
    });
    console.log(`[tts] configureAudioSession DONE — took ${Date.now() - t0}ms (playsInSilentMode=true, interruptionMode=doNotMix)`);
  } catch (e) {
    console.warn(`[tts] configureAudioSession FAILED after ${Date.now() - t0}ms:`, (e as Error)?.message);
  }
}

/** Play a single MP3 buffer to completion. Resolves only after the
 *  player reports didJustFinish (or isLoaded becomes false, or the
 *  watchToken is bumped). The worker awaits this so the next
 *  sentence's fetch doesn't start until this one is done. */
async function playOneBuffer(buf: ArrayBuffer, myToken: number): Promise<void> {
  console.log(`[tts] playOneBuffer ENTER — bytes=${buf.byteLength} myToken=${myToken} watchToken=${watchToken} priorPlayer=${player ? 'present' : 'null'}`);
  if (myToken !== watchToken) {
    console.log('[tts] playOneBuffer EARLY RETURN — myToken stale at entry');
    return;
  }
  // Defensive idempotent re-arm of the audio session right before we
  // create the player. configureAudioSessionForPlayback is also fired
  // at startStream/playMessageNow time, but on FRESH installs the
  // first call has been observed to land late or silently fail —
  // re-running here is cheap and guarantees the session is in
  // playback mode by the time createAudioPlayer runs.
  console.log('[tts] playOneBuffer → re-arming audio session…');
  await configureAudioSessionForPlayback();
  console.log(`[tts] playOneBuffer ← session re-armed; myToken=${myToken} watchToken=${watchToken}`);
  if (myToken !== watchToken) {
    console.log('[tts] playOneBuffer EARLY RETURN — myToken stale after session config');
    return;
  }

  // Write the audio bytes to a temp file, then play from a file://
  // URI. The previous data:audio/mpeg;base64 path produced silent
  // playback on iOS standalone builds (the player loaded fine, play()
  // threw nothing, didJustFinish eventually fired — but no sound).
  // file:// playback is the standard, reliable path for expo-audio.
  console.log('[tts] playOneBuffer → encoding to base64 + writing cache file…');
  const b64 = bytesToBase64(new Uint8Array(buf));
  try {
    await FileSystem.writeAsStringAsync(TTS_CACHE_FILE, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    console.log(`[tts] playOneBuffer ← wrote cache file (b64chars=${b64.length}) to ${TTS_CACHE_FILE}`);
  } catch (e) {
    console.error('[tts] playOneBuffer FAILED to write audio chunk to cache file:', (e as Error)?.message);
    return;
  }
  if (myToken !== watchToken) {
    console.log('[tts] playOneBuffer EARLY RETURN — myToken stale after file write');
    return;
  }

  // Tear down any prior player BEFORE creating the next — defensive
  // against the rare case where cancelStream missed a beat.
  if (player) {
    console.log('[tts] playOneBuffer tearing down prior player before creating new');
    try { player.pause(); player.remove(); } catch {}
    player = null;
  }
  console.log(`[tts] playOneBuffer creating player from file URI: ${TTS_CACHE_FILE}`);
  const p = createAudioPlayer({ uri: TTS_CACHE_FILE });
  player = p;
  console.log('[tts] playOneBuffer player created, setting volume=1.0');
  // Belt-and-braces volume reset, mirroring map voice's playArrayBuffer.
  try { (p as any).volume = 1.0; } catch (e) { console.warn('[tts] could not set volume:', (e as Error)?.message); }
  console.log('[tts] playOneBuffer calling p.play()…');
  try {
    p.play();
    console.log('[tts] playOneBuffer p.play() returned without throwing');
  } catch (e) {
    console.error('[tts] p.play() THREW:', (e as Error)?.message);
  }
  let pollIter = 0;
  let exitReason = 'unknown';
  while (player === p && myToken === watchToken) {
    pollIter++;
    let s: any = null;
    try {
      s = p.currentStatus;
      // Log every 10th iteration to avoid log spam, plus the first 3
      if (pollIter <= 3 || pollIter % 10 === 0) {
        console.log(`[tts] playOneBuffer poll #${pollIter} — isLoaded=${s?.isLoaded} isPlaying=${s?.playing} didJustFinish=${s?.didJustFinish} currentTime=${s?.currentTime} duration=${s?.duration}`);
      }
      if (s?.didJustFinish) { exitReason = 'didJustFinish'; break; }
      if (s?.isLoaded === false) { exitReason = 'isLoaded=false'; break; }
    } catch (e) {
      exitReason = 'currentStatus threw: ' + (e as Error)?.message;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (player !== p) exitReason = 'player swapped (someone else replaced this player)';
  if (myToken !== watchToken) exitReason = 'watchToken bumped during playback';
  console.log(`[tts] playOneBuffer LOOP EXIT — pollIter=${pollIter} reason=${exitReason} myToken=${myToken} watchToken=${watchToken}`);
  // Explicit pause() before remove() — paired with the doNotMix
  // session, this stops the current buffer's output cleanly before
  // the next createAudioPlayer takes over.
  try { p.pause(); } catch {}
  try { p.remove(); } catch {}
  if (player === p) player = null;
  console.log('[tts] playOneBuffer EXIT — player removed');
}
