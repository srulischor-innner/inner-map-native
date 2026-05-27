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

console.log(pass ? '[prebuild-check] ALL CHECKS PASSED' : '[prebuild-check] FAILURES — aborting build');
process.exit(pass ? 0 : 1);
