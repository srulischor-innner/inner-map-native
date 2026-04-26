// Streaming TTS controller. When audio mode is ON and a new AI message
// begins streaming, instead of waiting for the whole reply before fetching
// audio (the old "play after onDone" path), we fetch and play in chunks
// of 1-3 sentences as they complete. The user starts hearing audio
// shortly after the first sentence finishes streaming, while later
// sentences are being fetched in the background.
//
// Design constraints:
//  - Only ONE streaming session active at a time. Starting a new one
//    cancels the prior one (queue, in-flight fetches, current player).
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
import { stopAll as stopSingleClipPlayer, onAudioModeOff } from './ttsPlayer';

// Whenever the user flips audio mode OFF (long-press on a speaker, end
// of session, tab unmount), cancel any in-flight streaming queue too.
// Registered once at module-load — no React lifecycle involved.
onAudioModeOff(() => { cancelStream(); });

type Player = ReturnType<typeof createAudioPlayer>;

const SOFT_MIN_CHARS = 80;
type Chunk = { uri: string };

let active = false;
let currentMessageId: string | null = null;
let buffer = '';                        // unconsumed text (no complete sentence yet)
let consumedSoFar = 0;                  // chars handed in via append(), used by caller
let queue: Chunk[] = [];
let player: Player | null = null;
let watchToken = 0;

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
  queue = [];
  watchToken++;
  // Tap-to-replay player must be silent while streaming TTS is producing.
  await stopSingleClipPlayer();
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
}

/** Stop everything. Cancels pending fetches (best effort), drops the
 *  queue, releases the player. Idempotent. */
export function cancelStream(): void {
  if (!active && !player && queue.length === 0) return;
  watchToken++;
  active = false;
  currentMessageId = null;
  buffer = '';
  consumedSoFar = 0;
  queue = [];
  if (player) {
    try { player.pause(); player.remove(); } catch {}
    player = null;
  }
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
      enqueueFetch(tail);
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
    if (cleanGroup) enqueueFetch(cleanGroup);
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
    enqueueFetch(tail);
  }
}

async function enqueueFetch(text: string): Promise<void> {
  const myToken = watchToken;
  console.log('[tts-stream] fetch chars=' + text.length + ' (queue=' + queue.length + ')');
  try {
    const buf = await api.speak(text);
    if (myToken !== watchToken) return; // cancelled
    if (!buf) return;
    const uri = 'data:audio/mpeg;base64,' + bytesToBase64(new Uint8Array(buf));
    if (myToken !== watchToken) return;
    queue.push({ uri });
    if (!player) playNext();
  } catch (e) {
    console.warn('[tts-stream] fetch failed:', (e as Error)?.message);
  }
}

async function playNext(): Promise<void> {
  if (queue.length === 0) {
    player = null;
    return;
  }
  const next = queue.shift()!;
  const myToken = watchToken;
  try {
    await setAudioModeAsync({
      allowsRecording: false, playsInSilentMode: true,
      interruptionMode: 'mixWithOthers', shouldPlayInBackground: false,
    });
  } catch {}
  if (myToken !== watchToken) return;
  const p = createAudioPlayer({ uri: next.uri });
  player = p;
  try { p.play(); } catch {}
  // Watch for finish — poll cheaply, then advance.
  while (player === p && myToken === watchToken) {
    try {
      const s = p.currentStatus;
      if (s?.didJustFinish) break;
      if (s?.isLoaded === false) break;
    } catch { break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  try { p.remove(); } catch {}
  if (player === p && myToken === watchToken) {
    player = null;
    playNext();
  }
}
