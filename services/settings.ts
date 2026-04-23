// User-facing preferences stored on device. Simple boolean flags gated by the
// hamburger menu toggles. Both default ON when unset — the user has to opt out.
//
// audioEnabled   — whether the app plays TTS audio for AI replies
// pushEnabled    — whether push notifications are allowed

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  audio: 'settings.audio',
  push:  'settings.push',
} as const;

export type Settings = { audioEnabled: boolean; pushEnabled: boolean };

async function getBool(key: string, def: boolean): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return def;
    return raw === '1';
  } catch { return def; }
}
async function setBool(key: string, v: boolean): Promise<void> {
  try { await AsyncStorage.setItem(key, v ? '1' : '0'); } catch {}
}

export async function getSettings(): Promise<Settings> {
  const [a, p] = await Promise.all([
    getBool(KEYS.audio, true),
    getBool(KEYS.push, true),
  ]);
  return { audioEnabled: a, pushEnabled: p };
}
export const setAudioEnabled = (v: boolean) => setBool(KEYS.audio, v);
export const setPushEnabled  = (v: boolean) => setBool(KEYS.push, v);
