// A VOICE RECORDING DOES NOT OUTLIVE ITS TRANSCRIPT (founder, 2026-11-09).
//
// Every mic records to a file in expo-audio's cache folder and sends it to the
// server. The chat kept the file for its voice-note bubble's play button; every
// other mic never deleted it. Now (utils/recordingCleanup.ts):
//   1. every file that reads a recorder's uri or sends audio to the server
//      imports deleteRecording and calls it — the chat, journal dictation, the
//      map's Self and Leading mics, the Guide's mic, and Partner's two;
//   2. the voice-note bubble has no player left to need the file;
//   3. account deletion and sign-out empty the recorder's cache folders
//      (iOS <Caches>/ExpoAudio, Android <cacheDir>/Audio), which are the folder
//      names expo-audio itself uses;
// with a negative control for the scan.
//
//   node scripts/check-recordings-deleted.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
function sources(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel.replace(/\\/g, '/'));
  }
  return out;
}
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// A file "records" if it reads a recorder's uri, or sends audio to the server,
// or receives a recording's uri from a mic component (onSendVoice handlers).
const RECORDS = /recorder\.uri|api\.transcribe\(|api\.mapVoiceTurn\(|handleSendVoice/;
const DELETES = (code) => /import \{ deleteRecording \} from '[./]+(?:utils\/)?recordingCleanup';/.test(code)
  && /\bdeleteRecording\(/.test(code.replace(/import \{ deleteRecording \}[^\n]*\n/, ''));
function offenders(files) {
  return files.filter(([, code]) => RECORDS.test(code) && !DELETES(code)).map(([f]) => f);
}
const FILES = ['app', 'components'].flatMap((d) => sources(d)).map((f) => [f, codeOnly(read(f))]);
const recorders = FILES.filter(([, c]) => RECORDS.test(c)).map(([f]) => f);
const EXPECTED = [
  'app/(tabs)/index.tsx', 'components/ChatInput.tsx', 'components/journal/JournalEntryModal.tsx',
  'components/map/MapVoiceBar.tsx', 'components/guide/GuideAskModal.tsx',
  'components/relationships/PartnerContributionInput.tsx', 'components/relationships/RelationshipChat.tsx',
];
const missing = EXPECTED.filter((f) => !recorders.includes(f));
check(missing.length === 0, 'the scan no longer sees these recording files (renamed? then update EXPECTED): ' + missing.join(', '));
const bad = offenders(FILES);
check(bad.length === 0, 'records without deleting the recording: ' + bad.join(', '));

// Each mic deletes AFTER the server has had the file, not before.
{
  const chat = codeOnly(read('app/(tabs)/index.tsx'));
  const at = chat.indexOf('async function handleSendVoice');
  const body = chat.slice(at, chat.indexOf('\n  }\n', at));
  const t = body.indexOf('api.transcribe(');
  const d = body.indexOf('void deleteRecording(uri);');
  check(t > -1 && d > t, 'the chat deletes its voice note before transcribing it, or not at all');
  const map = codeOnly(read('components/map/MapVoiceBar.tsx'));
  check(/api\.mapVoiceTurn\(uri, mime, mode\)\.finally\(\(\) => \{ void deleteRecording\(uri\); \}\)/.test(map),
    'the map mics no longer delete once the turn has been sent');
  const journal = codeOnly(read('components/journal/JournalEntryModal.tsx'));
  check(/\} finally \{\s*void deleteRecording\(uri \?\? recorder\.uri\);\s*\}/.test(journal),
    'journal dictation no longer deletes on every exit (finally)');
  const guide = codeOnly(read('components/guide/GuideAskModal.tsx'));
  check(/\} finally \{\s*void deleteRecording\(uri \?\? recorder\.uri\);\s*\}/.test(guide),
    'the Guide mic no longer deletes on every exit (finally)');
}

// 2. Nothing left to play.
{
  const bubble = codeOnly(read('components/MessageBubble.tsx'));
  const at = bubble.indexOf('function VoiceNoteBubble(');
  const body = bubble.slice(at, bubble.indexOf('function formatDuration(', at));
  check(at > -1 && !/createManagedPlayer|createAudioPlayer|useAudioPlayer|playManaged|onPress=/.test(body),
    'the voice-note bubble plays something again, from a file that is deleted');
}

// 3. The wipes.
{
  const rc = read('utils/recordingCleanup.ts');
  check(/export const RECORDER_CACHE_DIRS = \['ExpoAudio', 'Audio'\] as const;/.test(rc),
    'RECORDER_CACHE_DIRS is not expo-audio\'s two folders');
  const audioRoot = path.join(ROOT, '..', '..', '..', 'node_modules', 'expo-audio');
  const local = path.join(ROOT, 'node_modules', 'expo-audio');
  const lib = fs.existsSync(local) ? local : audioRoot;
  if (fs.existsSync(lib)) {
    const ios = fs.readFileSync(path.join(lib, 'ios', 'AudioUtils.swift'), 'utf8');
    const android = fs.readFileSync(path.join(lib, 'android', 'src', 'main', 'java', 'expo', 'modules', 'audio', 'AudioRecorder.kt'), 'utf8');
    check(/appendingPathComponent\("ExpoAudio"\)/.test(ios) && /File\(context\.cacheDir, "Audio"\)/.test(android),
      'expo-audio no longer records into <Caches>/ExpoAudio and <cacheDir>/Audio — update RECORDER_CACHE_DIRS');
  } else {
    console.log('  SKIP expo-audio not on disk here; folder names not compared with the library');
  }
  check(/await clearRecorderCaches\(\);/.test(codeOnly(read('utils/localCleanup.ts'))),
    'account deletion no longer empties the recorder caches');
  const settings = codeOnly(read('app/settings.tsx'));
  const so = settings.indexOf('const handleSignOut = useCallback(');
  check(so > -1 && /try \{ await clearRecorderCaches\(\); \} catch \{\}/.test(settings.slice(so, so + 1500)),
    'sign-out no longer empties the recorder caches');
}

// NEGATIVE CONTROL — a recording file that never deletes is caught.
{
  const planted = [['components/NewMic.tsx', "const uri = recorder.uri;\nawait api.transcribe(uri, 'audio/m4a');\n"]];
  if (offenders(planted).length !== 1) fails.push('NEGATIVE CONTROL: a mic that keeps its file is not caught');
}

if (fails.length) {
  console.error('check-recordings-deleted: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-recordings-deleted: OK — ${recorders.length} recording files all delete; the bubble has no player; both wipes empty the recorder caches`);
