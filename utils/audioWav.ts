// Audio conversion helpers for the OpenAI Realtime path.
//
// The Realtime API speaks in base64-encoded PCM16 (24kHz mono, little-endian).
// expo-audio records a WAV file on disk that already contains PCM16 data after
// a 44-byte header. For playback we accumulate PCM16 deltas from the server
// and have to wrap them in a WAV header before handing off to expo-audio.
//
// Everything here runs on the JS thread — small buffers only, one turn at a
// time. No dep on node Buffer.

/** Base64 encode a raw Uint8Array. Uses global btoa when available, falls
 *  back to a manual encoder for older Hermes builds. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return globalThis.btoa ? globalThis.btoa(binary) : legacyBtoa(binary);
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob ? globalThis.atob(b64) : legacyAtob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Strip a 44-byte RIFF/WAVE header and return the raw PCM16 payload as
 *  base64. The expo-audio recording format is exactly that — standard
 *  Microsoft WAVE, 16-bit PCM, the sample rate we specified in the preset.
 *  We assume 44-byte header here; a more defensive implementation would
 *  parse the chunk table, but every expo-audio recording uses the canonical
 *  header layout. */
export function stripWavHeaderToPcm16Base64(wavBase64: string): string {
  const bytes = base64ToBytes(wavBase64);
  if (bytes.length <= 44) return '';
  return bytesToBase64(bytes.subarray(44));
}

/** Wrap raw PCM16 bytes in a canonical RIFF/WAVE header so expo-audio's
 *  createAudioPlayer can play the data URI back.
 *  Returns base64 of the full WAV file. */
export function pcm16ToWavBase64(pcmBase64: string, sampleRate = 24000, numChannels = 1): string {
  const pcm = base64ToBytes(pcmBase64);
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  // "RIFF"
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
  view.setUint32(4, 36 + dataSize, true);
  // "WAVE"
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);
  // "fmt "
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
  view.setUint32(16, 16, true);          // Subchunk1Size
  view.setUint16(20, 1, true);           // AudioFormat = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // "data"
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(header.length + pcm.length);
  out.set(header, 0);
  out.set(pcm, header.length);
  return bytesToBase64(out);
}

// ---- fallbacks ----
function legacyBtoa(str: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < str.length; ) {
    const c1 = str.charCodeAt(i++);
    const c2 = str.charCodeAt(i++);
    const c3 = str.charCodeAt(i++);
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (c2 >> 4);
    const e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (c3 >> 6);
    const e4 = isNaN(c3) ? 64 : c3 & 63;
    out += chars[e1] + chars[e2] + chars[e3] + chars[e4];
  }
  return out;
}
function legacyAtob(b64: string): string {
  // atob is present on React Native Hermes since 0.72 — legacy fallback for safety
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) table[chars[i]] = i;
  let out = '';
  const clean = b64.replace(/=+$/, '');
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = table[clean[i]] || 0;
    const e2 = table[clean[i + 1]] || 0;
    const e3 = table[clean[i + 2]] || 0;
    const e4 = table[clean[i + 3]] || 0;
    const n = (e1 << 18) | (e2 << 12) | (e3 << 6) | e4;
    out += String.fromCharCode((n >> 16) & 0xff);
    if (clean[i + 2]) out += String.fromCharCode((n >> 8) & 0xff);
    if (clean[i + 3]) out += String.fromCharCode(n & 0xff);
  }
  return out;
}
