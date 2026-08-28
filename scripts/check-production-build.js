#!/usr/bin/env node
// EAS production-build pre-flight check.
//
// Runs the bare minimum sanity checks that, if missed, ship a build
// that can't even reach the server. May 2026 Android outage post-
// mortem: an Android Internal Testing build went out with no INTERNET
// permission AND an unverified API base URL — neither caught at build
// time, both caught only when real users couldn't sign in.
//
// What this enforces (production profile only):
//   1. app.config.js evaluates without throwing.
//   2. extra.apiBaseUrl is set, non-empty, and looks like an absolute
//      HTTPS URL (no localhost / 127.0.0.1 / expo:// / file://).
//   3. android.permissions includes INTERNET — the actual root cause
//      of the May 2026 outage.
//   4. NSAppTransportSecurity OR HTTPS-only URL — iOS won't load HTTP
//      without ATS exemption; we either need HTTPS or arbitrary loads.
//
// How to wire:
//   - eas.json: "prebuildCommand": "node scripts/check-production-build.js"
//     under build.production. EAS appends "--platform <ios|android>" to
//     whatever you set here when it runs the prebuild step (one prebuild
//     per platform in a multi-platform build). The script tolerates the
//     extra args — argv is checked below, no flags are required.
//   - DO NOT prefix with "npx expo" — Expo's CLI rejects unknown flags,
//     so "npx expo node ... --platform android" fails with
//     "unknown or unexpected option: --platform" and EAS aborts the
//     build. Invoke node directly. (May 2026 build-pipeline incident
//     where the wrong prebuildCommand shape broke every Android prod
//     build; the eas.json comment + argv log below document the fix.)
//   - Or invoke manually before pushing a new build:
//     node scripts/check-production-build.js
//
// Exit code: 0 if all green, 1 if any check fails. EAS aborts the
// build on non-zero exit, so a misconfigured prod can never reach
// Internal Testing again.

const path = require('path');

// EAS injects --platform <ios|android> when running prebuildCommand.
// We don't need to act on it (the same config checks apply to both
// platforms — each enforces its own platform's requirements), but
// logging which platform fired the check makes the EAS build log
// self-explanatory and confirms the script ran in the expected
// wrapper. Extra argv entries are silently tolerated by Node.
const argvPlatformIdx = process.argv.indexOf('--platform');
const argvPlatform =
  argvPlatformIdx >= 0 && argvPlatformIdx + 1 < process.argv.length
    ? process.argv[argvPlatformIdx + 1]
    : null;
if (argvPlatform) {
  console.log(`[prebuild-check] --platform=${argvPlatform} (passed by EAS)`);
}

// Profile resolution order (highest precedence first):
//   1. --profile <name> CLI flag (used by the build:*:prod npm scripts
//      so a developer's shell EAS_BUILD_PROFILE=development can't
//      silently skip the check before a production build).
//   2. EAS_BUILD_PROFILE env var (set by EAS during a real prebuild).
//   3. Default to 'production'.
// Cross-platform — no inline env-var prefix needed, so the same npm
// script line works on macOS, Linux, and Windows cmd.
const argvProfileIdx = process.argv.indexOf('--profile');
const argvProfile =
  argvProfileIdx >= 0 && argvProfileIdx + 1 < process.argv.length
    ? process.argv[argvProfileIdx + 1]
    : null;
const profile = argvProfile || process.env.EAS_BUILD_PROFILE || 'production';
// Only enforce in production. Dev / preview builds may legitimately
// point at localhost or a staging URL.
if (profile !== 'production') {
  console.log(`[prebuild-check] profile=${profile} — skipping (production-only)`);
  process.exit(0);
}

console.log('[prebuild-check] profile=production — running checks');

let pass = true;
function check(label, ok, hint) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${hint || 'FAIL'}`}`);
  if (!ok) pass = false;
}

let config;
try {
  // app.config.js exports a function; calling it with no args returns
  // the resolved expo config for the active EAS_BUILD_PROFILE.
  const fn = require(path.join(__dirname, '..', 'app.config.js'));
  config = typeof fn === 'function' ? fn() : fn;
} catch (e) {
  console.error('[prebuild-check] app.config.js threw on load:', e?.message || e);
  process.exit(1);
}

const expo = config?.expo;
check('app.config.js exports an .expo object', !!expo,
  'app.config.js did not return { expo: { ... } }');

// ---- apiBaseUrl ----
const apiBaseUrl = expo?.extra?.apiBaseUrl;
check('extra.apiBaseUrl is defined', typeof apiBaseUrl === 'string' && apiBaseUrl.length > 0,
  'set apiBaseUrl in app.config.js extra block');
if (typeof apiBaseUrl === 'string') {
  check('extra.apiBaseUrl is absolute HTTPS',
    /^https:\/\//i.test(apiBaseUrl),
    `production must use https:// — got "${apiBaseUrl}"`);
  check('extra.apiBaseUrl is not a localhost / dev URL',
    !/localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|192\.168\.|exp:\/\//i.test(apiBaseUrl),
    `production points at a dev URL — got "${apiBaseUrl}"`);
}

// ---- Android INTERNET permission (the May 2026 outage root cause) ----
const androidPerms = Array.isArray(expo?.android?.permissions) ? expo.android.permissions : null;
if (androidPerms === null) {
  // No permissions array set means Expo will use the autolinked
  // defaults — historically those include INTERNET, but the safer
  // pattern is to declare it explicitly.
  check('android.permissions is explicit (recommended)', false,
    'set android.permissions: [\'RECORD_AUDIO\', \'INTERNET\', \'ACCESS_NETWORK_STATE\'] to avoid the May 2026 missing-INTERNET regression');
} else {
  check('android.permissions includes INTERNET',
    androidPerms.includes('INTERNET'),
    'add "INTERNET" to android.permissions — without it ALL fetch() calls fail silently on Android prod (May 2026 outage)');
  check('android.permissions includes ACCESS_NETWORK_STATE (recommended)',
    androidPerms.includes('ACCESS_NETWORK_STATE'),
    'add "ACCESS_NETWORK_STATE" alongside INTERNET so future "are we online?" checks don\'t hit the same class of bug');
}

// ---- iOS HTTPS / ATS ----
const ats = expo?.ios?.infoPlist?.NSAppTransportSecurity;
const allowsArbitraryLoads = !!(ats && ats.NSAllowsArbitraryLoads);
const httpsOnly = typeof apiBaseUrl === 'string' && /^https:\/\//i.test(apiBaseUrl);
check('iOS will accept the API URL (HTTPS or ATS exemption)',
  httpsOnly || allowsArbitraryLoads,
  'either apiBaseUrl must be https:// OR ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads must be true');

// ---- Google OAuth client IDs (Build 13 Android-Google-Sign-In fix) ----
// EAS auto-injects EAS secrets into the build environment, so any
// secret named EXPO_PUBLIC_GOOGLE_*_CLIENT_ID will be available to
// app.config.js at build time. The user-facing failure mode when
// the WEB client ID is missing is silent: GoogleSignin.configure()
// runs without webClientId, signIn() returns no idToken, and the
// user sees "Google didn't return a sign-in token. Try again."
//
// We verify by listing EAS secrets via the CLI. Skipped (warning,
// not failure) when the eas CLI is unavailable or not authenticated
// — operator might be running the local check without EAS access,
// and we don't want to block that flow.
// 2026-08-25: this had been silently skipping for an unknown length of time.
// `eas secret:list` is deprecated and NO LONGER HONOURS --json — it prints the
// human table regardless, JSON.parse throws, and the catch below turned that
// into "CLI unavailable, continuing without verification". The CLI was
// installed and logged in the whole time. A check that cannot fail is not a
// check, and this one guards a SILENT failure mode: without the WEB client ID,
// Android sign-in returns no idToken and the user just sees an error.
//
// `eas env:list` replaces it and has no JSON output at all (--format is
// long|short), so the names are parsed from the text. --environment is required
// or the command tries to prompt and dies on a non-interactive stdin.
function listEasSecrets(profile) {
  const { execSync } = require('child_process');
  const run = (cmd) => {
    try {
      return execSync(cmd, {
        cwd: path.join(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 20000,
      });
    } catch (e) {
      return null;
    }
  };

  // Current path: env:list, text output, NAME=value per line.
  const env = String(profile || 'production').toLowerCase();
  const out = run(`eas env:list --scope project --environment ${env} --format short`);
  if (out) {
    const names = [];
    for (const line of out.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=/.exec(line.trim());
      if (m) names.push({ name: m[1] });
    }
    if (names.length) return names;
  }

  // Fallback: the deprecated command, parsed as text rather than JSON.
  const legacy = run('eas secret:list');
  if (legacy) {
    const names = [];
    for (const line of legacy.split(/\r?\n/)) {
      const m = /^Name\s+([A-Z0-9_]+)\s*$/.exec(line.trim());
      if (m) names.push({ name: m[1] });
    }
    if (names.length) return names;
  }

  return null; // CLI genuinely unavailable or not authenticated
}
// ---- package.json vs package-lock.json (2026-08-25) ----
// The EAS builder's first real step is `npm ci`, and `npm ci` REFUSES to run
// when package.json and package-lock.json disagree. It does not resolve, it
// does not warn, it exits.
//
// That is what killed the 1.3.0 launch attempt: a commit added
// react-native-web and @expo/metro-runtime to devDependencies without running
// an install, so neither reached the lock file. Both platforms died 16 seconds
// in, at "Install dependencies", with the useless message "Unknown error. See
// logs of the Install dependencies build phase."
//
// It is checked HERE because this is the cheapest possible place: a lock file
// is a local file, the answer takes a millisecond, and the alternative is
// finding out from a remote builder after an upload and a queue.
//
// No network, no npm invocation — just the two files. Every dependency named
// in package.json must have a node_modules/<name> entry in the lock file.
// That is the exact condition npm ci enforces, minus transitive resolution.
function checkLockfileInSync() {
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    check('package-lock.json exists', false,
      'EAS runs `npm ci`, which cannot run without a lock file');
    return;
  }
  let pkg, lock;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (e) {
    check('package.json + package-lock.json parse', false, e.message);
    return;
  }
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const inLock = lock.packages || {};
  const missing = Object.keys(declared).filter((name) => inLock[`node_modules/${name}`] === undefined);
  check(
    `package-lock.json is in sync with package.json (${Object.keys(declared).length} direct deps)`,
    missing.length === 0,
    missing.length
      ? `MISSING FROM LOCK FILE: ${missing.join(', ')}. ` +
        '`npm ci` on the EAS builder will refuse to install and the build dies at ' +
        '"Install dependencies" in ~15s. Fix locally with `npm install --package-lock-only`, ' +
        'then COMMIT package-lock.json.'
      : undefined,
  );
}
checkLockfileInSync();

// EVERY MIC SURFACE HOLDS THE SCREEN AWAKE (founder ruling 2026-08-27).
// Delegated to its own script so the rule can be run on its own during
// development; run here because the failure it guards is invisible until a
// real person records hands-free on a real phone and loses the take.
function checkRecordingWakeLock() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'check-recording-wakelock.js')],
      { stdio: 'pipe', encoding: 'utf8' });
    check('every recording surface holds a screen-sleep lock', true);
  } catch (e) {
    const out = String((e && (e.stdout || '')) + (e && (e.stderr || ''))).trim();
    check('every recording surface holds a screen-sleep lock', false,
      (out || 'check-recording-wakelock.js failed') +
      ' — without it expo-audio pauses the recorder at iOS auto-lock (~30s) and a hands-free take dies silently.');
  }
}
checkRecordingWakeLock();

// THE LOCKED READING CARD SPEAKS ABOUT THIS MAP, NOT THE RULE (2026-08-27).
// Executes the copy function over every reachable gate state. Guards the
// regression that is easy to make and invisible on a healthy account: copy
// that reverts to one generic sentence for every locked map.
function checkReadingLockedCopy() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'check-reading-locked-copy.mjs')],
      { stdio: 'pipe', encoding: 'utf8' });
    check('the locked reading card names what THIS map is missing', true);
  } catch (e) {
    const out = String((e && (e.stdout || '')) + (e && (e.stderr || ''))).trim();
    check('the locked reading card names what THIS map is missing', false,
      out || 'check-reading-locked-copy.mjs failed');
  }
}
checkReadingLockedCopy();

const easSecrets = listEasSecrets(profile);
if (easSecrets === null) {
  console.log('  ⚠ EAS secret check skipped — neither `eas env:list` nor `eas secret:list` ' +
              'returned anything. Run `eas login` (or `npm install -g eas-cli`) for ' +
              'full pre-flight coverage. Continuing without verification.');
} else {
  const secretNames = new Set(easSecrets.map((s) => s.name));
  // The WEB client ID is the hard requirement — without it Android
  // signIn returns no idToken. iOS + Android client IDs are
  // technically optional for the SDK call (iOS still works via the
  // info.plist URL scheme + bundle ID match; Android verifies via
  // package + SHA-1 fingerprint), but documenting them as expected
  // keeps the setup discoverable.
  check('EAS secret EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is set (Android Google-Sign-In gating)',
    secretNames.has('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'),
    'create with `eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value "<web-client-id>.apps.googleusercontent.com"`. Without this Android Google Sign-In silently fails (no idToken).');
  check('EAS secret EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is set (iOS Google-Sign-In)',
    secretNames.has('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'),
    'create with `eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value "<ios-client-id>.apps.googleusercontent.com"`');
  check('EAS secret EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID is set (Android OAuth client — passed to SDK for completeness)',
    secretNames.has('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID'),
    'create with `eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID --value "<android-client-id>.apps.googleusercontent.com"`');
}

console.log(pass ? '[prebuild-check] ALL CHECKS PASSED' : '[prebuild-check] FAILURES — aborting build');
process.exit(pass ? 0 : 1);
