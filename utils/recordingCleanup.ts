// VOICE RECORDINGS DO NOT OUTLIVE THEIR TRANSCRIPT (founder, 2026-11-09).
//
// Every mic in the app records to a file in the recorder's cache folder, sends
// it to the server to be transcribed (or answered), and used to leave the file
// there: the chat kept it for its voice-note bubble's play button, and every
// other mic simply never deleted it. A spoken entry, a map-voice turn or a
// Guide question therefore sat on the device as audio long after it had become
// text. Now each surface deletes its file the moment the server has had it —
// whether the transcription worked or not, since nothing retries from the file
// — and a take that is cancelled or too short is deleted without being sent.
//
// expo-audio writes recordings to <Caches>/ExpoAudio on iOS
// (ios/AudioUtils.swift createRecordingUrl) and <cacheDir>/Audio on Android
// (AudioRecorder.kt), and recreates that folder for every new recording
// (ensureDirExists), so emptying it whole is safe whenever nothing is
// recording. That is what account deletion and sign-out do, for anything a
// crash or a killed app left behind.
//
// scripts/check-recordings-deleted.js holds every recording site to this.

import * as FileSystem from 'expo-file-system/legacy';

/** Delete one recording. Never throws; a missing file is already the goal. */
export async function deleteRecording(uri: string | null | undefined): Promise<void> {
  if (!uri || typeof uri !== 'string') return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (e) {
    console.warn('[recording] delete failed:', (e as Error)?.message);
  }
}

/** The recorder's own cache folders, one per platform's expo-audio. */
export const RECORDER_CACHE_DIRS = ['ExpoAudio', 'Audio'] as const;

/** Empty the recorder's cache folders. For account deletion and sign-out,
 *  when nothing is recording. Never throws. */
export async function clearRecorderCaches(): Promise<void> {
  const base = FileSystem.cacheDirectory;
  if (!base) return;
  for (const dir of RECORDER_CACHE_DIRS) {
    try {
      await FileSystem.deleteAsync(`${base}${dir}`, { idempotent: true });
    } catch (e) {
      console.warn(`[recording] clearing ${dir} failed:`, (e as Error)?.message);
    }
  }
}
