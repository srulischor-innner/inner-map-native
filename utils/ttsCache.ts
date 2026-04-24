// TTS prefetch + cache for chat messages. Called from the Chat screen the
// moment an AI message finishes streaming — by the time the user taps the
// speaker icon the audio is already sitting in this module-level map, so
// playback starts instantly instead of waiting on a round-trip to /api/speak.
//
// Storage shape: messageId → base64-encoded MP3 data URI. We keep the URI
// string (not the ArrayBuffer) because expo-audio's createAudioPlayer accepts
// data URIs directly and the JS string is cheaper to hand off than a binary
// blob on every play.
//
// Bounded to the last 10 messages. When the cap is exceeded we drop the
// oldest entry (LRU-ish — we track insertion order, not access time, which
// is close enough for the "last 10 AI turns" use case).

import { api } from '../services/api';
import { stripMarkers } from './markers';

const MAX_ENTRIES = 10;
const cache = new Map<string, string>();       // messageId → data URI
const inflight = new Map<string, Promise<string | null>>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return globalThis.btoa ? globalThis.btoa(binary) : '';
}

function trim() {
  while (cache.size > MAX_ENTRIES) {
    // Map iteration order is insertion order — oldest first.
    const firstKey = cache.keys().next().value;
    if (firstKey == null) break;
    cache.delete(firstKey);
  }
}

/** Prefetch the TTS for an AI message. Fire-and-forget. Dedups concurrent
 *  requests for the same id. Safe to call on every message completion —
 *  if the user never taps the speaker, the audio just sits here until the
 *  LRU evicts it. */
export function prefetchTTS(messageId: string, rawText: string): void {
  if (cache.has(messageId)) return;
  if (inflight.has(messageId)) return;
  const text = stripMarkers(rawText || '').trim();
  if (!text) return;
  const p = (async () => {
    try {
      const buf = await api.speak(text);
      if (!buf) return null;
      const b64 = bytesToBase64(new Uint8Array(buf));
      const uri = 'data:audio/mpeg;base64,' + b64;
      cache.set(messageId, uri);
      trim();
      console.log('[tts] prefetched messageId=' + messageId.slice(0, 8), 'bytes=' + buf.byteLength);
      return uri;
    } catch (e) {
      console.warn('[tts] prefetch failed:', (e as Error)?.message);
      return null;
    } finally {
      inflight.delete(messageId);
    }
  })();
  inflight.set(messageId, p);
}

/** Synchronous read — returns the cached URI or null. Called from the
 *  MessageBubble speaker tap. */
export function getCachedTTS(messageId: string): string | null {
  return cache.get(messageId) || null;
}

/** Await the in-flight prefetch (if any) OR kick off a fresh fetch. Used as
 *  a fallback when a user taps speaker before the prefetch completed. */
export async function ensureTTS(messageId: string, rawText: string): Promise<string | null> {
  const existing = cache.get(messageId);
  if (existing) return existing;
  const pending = inflight.get(messageId);
  if (pending) return pending;
  prefetchTTS(messageId, rawText);
  return inflight.get(messageId) || null;
}

/** Clear the entire cache — called when the user ends their session so a
 *  fresh run starts with no stale audio. */
export function clearTTSCache(): void {
  cache.clear();
  inflight.clear();
}
