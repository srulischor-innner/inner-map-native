// LOOK AT THE READING ELEMENT — a local web preview of the real components.
//
//   node scripts/preview-reading-web.js      then open http://localhost:8081
//
// WHY THIS EXISTS. The reading element shipped without anyone having seen it
// run (founder, 2026-08-23: "nobody has seen it work"). There is no iOS
// simulator on this machine, so the only way to look at a React Native
// component here is to render it for the web.
//
// WHAT IS REAL: components/map/ReadingElement.tsx and ReadingModal.tsx exactly
// as they ship, their copy, their animations, their phase machine.
// WHAT IS STUBBED: the transport, and only the transport — preview-app/index.tsx
// swaps api.getReading / api.generateReading for functions returning the exact
// JSON shapes server.js returns. The element cannot tell the difference.
//
// HOW IT AVOIDS TOUCHING THE APP. expo-router picks its route root from
// exp.extra.router.root, so this script writes a small env-guarded hook into
// app.config.js, runs, and REMOVES the hook again on exit — including on
// Ctrl-C. app.config.js is a shipped file; it must not carry preview
// scaffolding into a build, and it does not.
//
// Requires react-native-web + @expo/metro-runtime, which are NOT in
// package.json (this is a look-at-it tool, not part of the app):
//   npx expo install react-native-web @expo/metro-runtime
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'app.config.js');
const ANCHOR = '  return { expo };';
const HOOK = [
  '',
  '  // LOCAL PREVIEW ONLY — written by scripts/preview-reading-web.js and',
  '  // removed again when it exits. If you are reading this in a committed',
  '  // file, something went wrong: it is not meant to be here.',
  '  if (process.env.INNERMAP_PREVIEW_ROOT) {',
  '    expo.extra = { ...(expo.extra || {}), router: { root: process.env.INNERMAP_PREVIEW_ROOT } };',
  '  }',
  '',
  ANCHOR,
].join('\n');

const original = fs.readFileSync(CONFIG, 'utf8');
if (original.indexOf(ANCHOR) < 0) {
  console.error('app.config.js does not have the expected `return { expo };` — refusing to edit it.');
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, 'node_modules', 'react-native-web'))) {
  console.error('react-native-web is not installed. Run:\n  npx expo install react-native-web @expo/metro-runtime');
  process.exit(1);
}

let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  try { fs.writeFileSync(CONFIG, original); console.log('\n[preview] app.config.js restored.'); } catch {}
};
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { restore(); process.exit(0); });
process.on('uncaughtException', (e) => { restore(); throw e; });

fs.writeFileSync(CONFIG, original.replace(ANCHOR, HOOK));
console.log('[preview] app.config.js hooked (removed again on exit)');
console.log('[preview] open http://localhost:8081 — states are also selectable by URL,');
console.log('[preview]   e.g. ?case=error, ?case=has-reading&open=1');

const child = spawn('npx expo start --web --port 8081', {
  stdio: 'inherit',
  cwd: ROOT,
  shell: true,
  env: { ...process.env, INNERMAP_PREVIEW_ROOT: 'preview-app', EXPO_NO_TELEMETRY: '1' },
});
child.on('exit', (code) => { restore(); process.exit(code || 0); });
