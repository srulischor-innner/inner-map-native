// Encrypted on-device storage for journal entries.
//
// Backed by react-native-mmkv (v4 nitro-modules build, synchronous, fast,
// AES-256 encrypted when an encryptionKey is supplied). The key itself is
// generated on first launch and persisted in expo-secure-store (Keychain
// on iOS, EncryptedSharedPreferences on Android). The MMKV files are
// stored in the app sandbox; without the key — which lives in
// hardware-backed secure storage — they are unreadable.
//
// Threat model this solves:
//   - iCloud / Google Drive backups: MMKV files travel with the backup
//     but the key does NOT (SecureStore items default to
//     ACL kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly on iOS;
//     EncryptedSharedPreferences on Android is similarly
//     non-backupable by default). Backup attacker sees ciphertext.
//   - Physical-access extraction without the device passcode:
//     SecureStore protects the key behind device-passcode-derived
//     keychain encryption.
//
// Threat model this DOES NOT solve:
//   - Jailbreak / root + unlocked device: an attacker with that level
//     of access can read SecureStore + MMKV both. This is the same
//     exposure ceiling any client-side encryption has.
//
// The MMKV instance id `'journal'` is unique to this storage. If
// another feature ever adopts MMKV it must use its own instance id
// to keep the encryption-key blast radius bounded.

import 'react-native-get-random-values';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

const SECURE_STORE_KEY  = 'mmkv.encryptionKey';
const MMKV_INSTANCE_ID  = 'journal';
const ENTRIES_KEY       = 'entries';

// Encryption-key alphabet — 64 printable ASCII chars (base64url-style,
// without padding). Each character maps from 6 random bits via the
// lower-6 mask below; 32 chars × 6 bits = 192 bits of entropy.
// Storing the key as a 32-char ASCII string means the UTF-8 byte
// length equals the character length, which is what MMKV's
// encryptionKey config expects when paired with AES-256 (max
// 32-byte key length).
const KEY_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// ----- Shared types (re-exported by services/journal.ts) -----

export type JournalKind = 'freeflow' | 'deepdive';
export type DetectedPart =
  | 'wound' | 'fixer' | 'skeptic' | 'self' | 'self-like'
  | 'manager' | 'firefighter';
export type JournalEntry = {
  id: string;
  kind: JournalKind;
  createdAt: string;
  content: string;
  prompt?: string;
  detectedParts?: DetectedPart[];
};

// ----- Singleton MMKV instance, lazy-initialised -----

let _instance: MMKV | null = null;
let _initPromise: Promise<MMKV> | null = null;

/** Generate a 32-byte AES-256 key as a 32-char ASCII string.
 *  192 bits of entropy (32 chars × 6 bits/char from a 64-char
 *  alphabet). Stored in SecureStore so the key follows the device,
 *  not the backup. */
function generateKey(): string {
  const arr = new Uint8Array(32);
  // crypto.getRandomValues polyfilled by react-native-get-random-values.
  (global as { crypto: { getRandomValues: (a: Uint8Array) => void } }).crypto
    .getRandomValues(arr);
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    // Lower 6 bits → index into the 64-char alphabet.
    out += KEY_ALPHABET[arr[i] & 0x3F];
  }
  return out;
}

async function loadOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SECURE_STORE_KEY);
  if (existing && existing.length >= 16) return existing;
  // First launch (or key was wiped) — mint and persist. NEVER log
  // the value; only the fact of minting.
  const fresh = generateKey();
  await SecureStore.setItemAsync(SECURE_STORE_KEY, fresh);
  console.log('[encrypted-store] minted fresh AES-256 encryption key');
  return fresh;
}

function getInstance(): Promise<MMKV> {
  if (_instance) return Promise.resolve(_instance);
  if (_initPromise) return _initPromise;
  _initPromise = (async (): Promise<MMKV> => {
    const key = await loadOrCreateKey();
    const inst = createMMKV({
      id: MMKV_INSTANCE_ID,
      encryptionKey: key,
      encryptionType: 'AES-256',
    });
    _instance = inst;
    return inst;
  })();
  return _initPromise;
}

// ----- Public API (consumed by services/journal.ts) -----

export async function getAllEntries(): Promise<JournalEntry[]> {
  const mmkv = await getInstance();
  const raw = mmkv.getString(ENTRIES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addEntry(entry: JournalEntry): Promise<void> {
  const mmkv = await getInstance();
  const all = await getAllEntries();
  all.push(entry);
  mmkv.set(ENTRIES_KEY, JSON.stringify(all));
}

export async function updateEntry(
  id: string,
  partial: Partial<JournalEntry>,
): Promise<void> {
  const mmkv = await getInstance();
  const all = await getAllEntries();
  const idx = all.findIndex((e) => e.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...partial };
  mmkv.set(ENTRIES_KEY, JSON.stringify(all));
}

export async function deleteEntry(id: string): Promise<void> {
  const mmkv = await getInstance();
  const all = await getAllEntries();
  mmkv.set(ENTRIES_KEY, JSON.stringify(all.filter((e) => e.id !== id)));
}

/** Used by future account-deletion feature. Drops just the entries
 *  array; the encryption key itself stays in SecureStore so a
 *  subsequent re-add doesn't trip over a missing key. */
export async function clear(): Promise<void> {
  const mmkv = await getInstance();
  mmkv.remove(ENTRIES_KEY);
}

// ----- Migration helpers (used only by services/journalMigration.ts) -----
// Underscore-prefixed to signal "not part of the consumer surface."
// Keeping them inside the wrapper means the migration module never
// touches MMKV directly — easier to mock in the smoke test, and the
// MMKV-instance lifecycle stays here in one place.

export async function _migrationGetFlag(name: string): Promise<boolean> {
  const mmkv = await getInstance();
  return mmkv.getBoolean(name) === true;
}

export async function _migrationSetFlag(name: string, value: boolean): Promise<void> {
  const mmkv = await getInstance();
  mmkv.set(name, value);
}

/** Bulk-replace the entries array. Used by the migration to seed
 *  MMKV from the AsyncStorage payload as a single JSON write — same
 *  shape as the historical AsyncStorage representation, so the
 *  verify-on-read step compares like-for-like. */
export async function _migrationBulkWrite(entries: JournalEntry[]): Promise<void> {
  const mmkv = await getInstance();
  mmkv.set(ENTRIES_KEY, JSON.stringify(entries));
}
