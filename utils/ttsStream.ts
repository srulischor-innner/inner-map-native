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
import { api } from '../services/api';
type Player = ReturnType<typeof createAudioPlayer>;

const SOFT_MIN_CHARS = 80;

let active = false;
let currentMessageId: string | null = null;
let buffer = '';                        // unconsumed text (no complete sentence yet)
let consumedSoFar = 0;                  // chars handed in via append(), used by caller
let player: Player | null = null;
let watchToken = 0;
// Single sequential chain — every enqueueFetch appends to this so
// fetch + play happen strictly one-at-a-time in insertion order.
let activeChain: Promise<void> = Promise.resolve();
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
export async function playMessageNow(messageId: string, text: string): Promise<void> {
  const t = (text || '').trim();
  console.log('[tts-stream] playMessageNow id=' + messageId.slice(0, 8) + ' chars=' + t.length);
  if (!t) return;
  cancelStream();
  active = false;
  currentMessageId = messageId;
  buffer = '';
  consumedSoFar = 0;
  watchToken++;
  resetChainCounters();
  // Split into sentences; whitespace AFTER terminal punctuation is the
  // boundary. Empty entries are filtered out. Each sentence chains
  // strictly behind the previous one's playback completion.
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  console.log('[tts-stream] playMessageNow split into ' + sentences.length + ' sentences');
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
  cancelStream();
  active = true;
  currentMessageId = messageId;
  buffer = '';
  consumedSoFar = 0;
  watchToken++;
  activeChain = Promise.resolve();
  resetChainCounters();
  console.log('[tts-stream] start id=' + messageId.slice(0, 8));
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
  console.log('[tts-stream] finish — letting queue drain');
  // If the audio fetches outpaced the streaming text and every
  // scheduled step has already played, the chain is drained NOW —
  // no in-flight step will fire the chain-complete log on its own.
  // Cover that race by checking here too.
  maybeLogChainComplete(watchToken);
}

/** Stop everything. Bumps watchToken so any in-flight chain step
 *  short-circuits, releases the current player, drops the chain.
 *  Idempotent. */
export function cancelStream(): void {
  if (!active && !player) return;
  watchToken++;
  active = false;
  currentMessageId = null;
  buffer = '';
  consumedSoFar = 0;
  if (player) {
    try { player.pause(); player.remove(); } catch {}
    player = null;
  }
  // Replace the chain with a fresh resolved promise — any pending
  // .then() callbacks already attached will still run on the OLD
  // chain reference, but each one checks watchToken and bails.
  activeChain = Promise.resolve();
  resetChainCounters();
  console.log('[tts-stream] cancel');
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

/** Append a sentence to the sequential fetch+play chain. Each chain
 *  step waits for the PREVIOUS sentence's playback to fully finish
 *  before starting its own /api/speak request — so there is exactly
 *  one fetch in flight and one playback at a time, in insertion
 *  order. This is what guarantees "read first sentence then second
 *  then third" instead of "whichever fetch resolved first." */
function chainSentence(text: string): void {
  const myToken = watchToken;
  chainScheduled++;
  console.log('[tts-stream] chain sentence chars=' + text.length);
  activeChain = activeChain.then(async () => {
    let stepPlayed = false;
    try {
      if (myToken !== watchToken) return;     // cancelled while we were waiting
      // One retry on null buffer — ElevenLabs / OpenAI sometimes drops
      // the connection mid-stream and the second attempt usually
      // succeeds. Without this, a single transient failure produced
      // a permanently-cut-off mid-message read-aloud.
      let buf = await api.speak(text);
      if (myToken !== watchToken) return;
      if (!buf) {
        console.warn('[tts-stream] api.speak returned null — retrying once');
        buf = await api.speak(text);
        if (myToken !== watchToken) return;
        if (!buf) {
          console.error('[tts-stream] api.speak returned null on retry — dropping sentence');
          return;
        }
      }
      await playOneBuffer(buf, myToken);
      // Post-play re-check — if cancelStream fired during playback,
      // playOneBuffer's polling loop already broke out and the audio
      // is silent. We must NOT count this as played, otherwise the
      // chain-complete log lies and any future "did it play?"
      // diagnostics are misleading.
      if (myToken !== watchToken) return;
      stepPlayed = true;
    } catch (e) {
      console.warn('[tts-stream] chain step failed:', (e as Error)?.message);
    } finally {
      // Bookkeep completion only if we still belong to the current
      // chain session. Stale steps from a cancelled session have
      // already had their counters zeroed — touching them here would
      // corrupt the next session's count.
      if (myToken === watchToken) {
        chainCompleted++;
        if (stepPlayed) chainPlayed++;
        maybeLogChainComplete(myToken);
      }
    }
  }).catch(() => {});
}

/** Play a single MP3 buffer to completion. Resolves only after the
 *  player reports didJustFinish (or isLoaded becomes false, or the
 *  watchToken is bumped). The chain.then() above awaits this so the
 *  next sentence's fetch doesn't start until this one is done. */
async function playOneBuffer(buf: ArrayBuffer, myToken: number): Promise<void> {
  if (myToken !== watchToken) return;
  const uri = 'data:audio/mpeg;base64,' + bytesToBase64(new Uint8Array(buf));
  try {
    await setAudioModeAsync({
      allowsRecording: false, playsInSilentMode: true,
      interruptionMode: 'mixWithOthers', shouldPlayInBackground: false,
    });
  } catch {}
  if (myToken !== watchToken) return;
  // Tear down any prior player BEFORE creating the next — defensive
  // against the rare case where cancelStream missed a beat.
  if (player) {
    try { player.pause(); player.remove(); } catch {}
    player = null;
  }
  const p = createAudioPlayer({ uri });
  player = p;
  try { p.play(); } catch {}
  while (player === p && myToken === watchToken) {
    try {
      const s = p.currentStatus;
      if (s?.didJustFinish) break;
      if (s?.isLoaded === false) break;
    } catch { break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  // Explicit pause() before remove() — defense against the audio
  // engine continuing to drain the last buffer briefly after the
  // player handle is released. Cheap; only matters in the edge
  // case where the next chain step (or session) starts a new
  // player before the previous buffer has fully cleared.
  try { p.pause(); } catch {}
  try { p.remove(); } catch {}
  if (player === p) player = null;
}
