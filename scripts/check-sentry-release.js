// EVERY SENTRY EVENT NAMES THE EXACT BINARY IT CAME FROM (2026-11-09).
//
// Sentry was initialised with no release and no dist, so an event's version
// was whatever the SDK derived. The Expo manifest still carries app.config.js's
// ios.buildNumber and android.versionCode, which EAS remote versioning ignores
// (it said so at 2026-11-09: "ios.buildNumber field in app config is ignored
// ... this value will still be in the manifest"), and the staging builds shared
// the 1.3.0 version string. A crash on the map could not be tied to a build.
//
// The fix reads the RUNNING BINARY (expo-application), and builds the release
// in the exact shape sentry-cli uses when the EAS build uploads source maps and
// dSYMs — `${bundleId}@${version}+${build}`, dist = build — so symbolication
// keeps matching. This check holds:
//   1. Sentry.init passes release, dist and environment;
//   2. they come from expo-application's native values, never Constants
//      (the manifest) and never a literal;
//   3. the release has sentry-cli's shape, and dist is the build;
//   4. expo-application is a direct dependency, not borrowed transitively;
// with a negative control.
//
//   node scripts/check-sentry-release.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s) => s.split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

function problems(src) {
  const out = [];
  const code = codeOnly(src);
  const initAt = code.indexOf('Sentry.init({');
  const init = initAt < 0 ? '' : code.slice(initAt, code.indexOf('beforeBreadcrumb', initAt));
  if (!init) out.push('Sentry.init({ not found');
  for (const [k, v] of [['release', 'SENTRY_RELEASE'], ['dist', 'SENTRY_BUILD'], ['environment', 'SENTRY_ENVIRONMENT']]) {
    if (!new RegExp(`\\b${k}: ${v},`).test(init)) out.push(`Sentry.init does not pass ${k}: ${v}`);
  }
  if (!/import \* as Application from 'expo-application';/.test(code)) out.push('expo-application is not imported');
  const want = {
    SENTRY_APP_ID: /const SENTRY_APP_ID = Application\.applicationId \|\| '[^']+';/,
    SENTRY_VERSION: /const SENTRY_VERSION = Application\.nativeApplicationVersion \|\| '[^']+';/,
    SENTRY_BUILD: /const SENTRY_BUILD = Application\.nativeBuildVersion \|\| '[^']+';/,
    SENTRY_RELEASE: /const SENTRY_RELEASE = `\$\{SENTRY_APP_ID\}@\$\{SENTRY_VERSION\}\+\$\{SENTRY_BUILD\}`;/,
  };
  for (const [name, re] of Object.entries(want)) if (!re.test(code)) out.push(`${name} is not read from the running binary in sentry-cli's shape`);
  const sentryLines = code.split('\n').filter((l) => /SENTRY_(APP_ID|VERSION|BUILD|RELEASE)\s*=/.test(l));
  if (sentryLines.some((l) => /Constants\.|expoConfig/.test(l))) out.push('a release input reads the Expo manifest, which carries the ignored build number');
  if (!/initialScope: \{ tags: \{ 'app\.version': SENTRY_VERSION, 'app\.build': SENTRY_BUILD \} \}/.test(init)) out.push('the version and build are not tagged on every event');
  return out;
}

const fails = problems(read('app/_layout.tsx'));
const pkg = JSON.parse(read('package.json'));
if (!(pkg.dependencies && pkg.dependencies['expo-application'])) fails.push('expo-application is not a direct dependency in package.json');
const lock = JSON.parse(read('package-lock.json'));
const rootDeps = (lock.packages && lock.packages[''] && lock.packages[''].dependencies) || {};
if (rootDeps['expo-application'] !== (pkg.dependencies || {})['expo-application']) fails.push('package-lock.json\'s root does not list expo-application as package.json does (npm ci would fail)');

// NEGATIVE CONTROL: the manifest's build number in place of the binary's.
{
  const broken = read('app/_layout.tsx').replace(
    "const SENTRY_BUILD = Application.nativeBuildVersion || 'unknown-build';",
    "const SENTRY_BUILD = String(Constants.expoConfig?.ios?.buildNumber || 'unknown-build');",
  );
  if (problems(broken).length === 0) fails.push('NEGATIVE CONTROL: reading the manifest build number does not turn this red');
}

if (fails.length) {
  console.error('check-sentry-release: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('check-sentry-release: OK — release bundleId@version+build and dist from the running binary, environment set, version and build tagged');
