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

/** WAV header info parsed from a recording. */
export type WavInfo = {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  audioFormat: number;     // 1 = PCM
  dataOffset: number;      // byte offset of the PCM data within the file
  dataSize: number;        // byte length of the PCM data
  totalBytes: number;      // total file size
};

/** Parse the RIFF/WAVE chunk table to locate the `data` chunk. expo-audio
 *  sometimes writes a non-canonical header (extra LIST/INFO chunks, FACT
 *  chunks, padding) so we can't assume the data chunk starts at offset 44.
 *  Walks chunks until it finds 'data' and reads fmt fields along the way. */
export function parseWavHeader(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 12) return null;
  // Must start with "RIFF" and "WAVE"
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return null;
  if (bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45) return null;

  let sampleRate = 0, numChannels = 0, bitsPerSample = 0, audioFormat = 0;
  let dataOffset = -1, dataSize = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size =
      bytes[offset + 4] |
      (bytes[offset + 5] << 8) |
      (bytes[offset + 6] << 16) |
      (bytes[offset + 7] << 24);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16) {
      audioFormat  =  bytes[body]       | (bytes[body + 1] << 8);
      numChannels  =  bytes[body + 2]   | (bytes[body + 3] << 8);
      sampleRate   =  bytes[body + 4]   | (bytes[body + 5] << 8) | (bytes[body + 6] << 16) | (bytes[body + 7] << 24);
      bitsPerSample = bytes[body + 14]  | (bytes[body + 15] << 8);
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
      break;
    }
    // Chunks are word-aligned — round odd sizes up.
    const pad = size % 2 === 0 ? 0 : 1;
    offset = body + size + pad;
  }
  if (dataOffset < 0) return null;
  return { sampleRate, numChannels, bitsPerSample, audioFormat, dataOffset, dataSize, totalBytes: bytes.length };
}

/** Strip the RIFF/WAVE header and return the raw PCM16 payload as base64.
 *  Uses chunk-table parsing (not a fixed 44-byte strip) because expo-audio
 *  can emit non-canonical headers on some device/OS combos.
 *  Logs the parsed header metadata so the Metro console shows sample rate,
 *  channel count, data offset, and PCM size — critical when diagnosing
 *  format mismatches against OpenAI Realtime's 24kHz/mono/pcm16 requirement. */
export function stripWavHeaderToPcm16Base64(wavBase64: string): string {
  const bytes = base64ToBytes(wavBase64);
  const info = parseWavHeader(bytes);
  if (!info) {
    console.warn('[realtime] WAV header parse failed — falling back to offset 44');
    if (bytes.length <= 44) return '';
    return bytesToBase64(bytes.subarray(44));
  }
  console.log(
    '[realtime] WAV header:',
    'sampleRate=' + info.sampleRate,
    'channels=' + info.numChannels,
    'bitsPerSample=' + info.bitsPerSample,
    'audioFormat=' + info.audioFormat + (info.audioFormat === 1 ? ' (PCM ✓)' : ' (NOT PCM ✗)'),
    'dataOffset=' + info.dataOffset,
    'dataSize=' + info.dataSize,
    'totalBytes=' + info.totalBytes,
    'headerBytes=' + (info.totalBytes - info.dataSize),
  );
  if (info.sampleRate !== 24000) {
    console.warn('[realtime] ⚠ sampleRate is ' + info.sampleRate + ' — OpenAI Realtime expects 24000Hz. Audio will be garbled or rejected.');
  }
  if (info.numChannels !== 1) {
    console.warn('[realtime] ⚠ channels=' + info.numChannels + ' — OpenAI expects mono');
  }
  if (info.bitsPerSample !== 16) {
    console.warn('[realtime] ⚠ bitsPerSample=' + info.bitsPerSample + ' — OpenAI expects 16');
  }
  const end = Math.min(info.dataOffset + info.dataSize, bytes.length);
  const pcm = bytes.subarray(info.dataOffset, end);
  return bytesToBase64(pcm);
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
