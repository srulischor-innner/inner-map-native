// CHECK — nothing in this app asks for background audio or a foreground service.
//
// plugins/withNoForegroundService.js strips FOREGROUND_SERVICE and
// FOREGROUND_SERVICE_MEDIA_PLAYBACK out of the merged manifest, because
// expo-audio declares both and this app never starts a service. That removal is
// a PROMISE ABOUT THE CODE, and this is the thing that keeps it true.
//
// The failure it prevents is not a lint warning. Android kills a process that
// starts a typed foreground service without the matching permission. So the day
// someone types `shouldPlayInBackground: true` to fix a podcast-interruption
// complaint, the app would crash on that path in release and nowhere else — and
// the cause would be three files away, in a config plugin nobody was reading.
//
// It also keeps a store declaration honest. Play's overdue "Foreground service
// permissions" declaration was answered by removing the permission rather than
// claiming a use. If the code quietly acquires that use, the answer on file
// becomes false.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['app', 'components', 'utils', 'services', 'hooks', 'contexts'];

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
ok('the source sweep found files at all', files.length > 50, `found ${files.length}`);

// Strip // and /* */ so the long explanations in ttsStream.ts — which quote
// these very identifiers while explaining why they are off — do not read as
// violations. A check that fires on its own documentation gets disabled.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const offenders = [];
const backgroundOn = [];
for (const f of files) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  if (/useForegroundService/.test(src)) offenders.push(`${path.relative(ROOT, f)} — useForegroundService`);
  const m = src.match(/shouldPlayInBackground\s*:\s*true/);
  if (m) backgroundOn.push(`${path.relative(ROOT, f)} — shouldPlayInBackground: true`);
}

ok('no source file requests a foreground service', offenders.length === 0, offenders.join('\n         '));
ok('no source file turns background playback on', backgroundOn.length === 0,
  backgroundOn.length
    ? backgroundOn.join('\n         ') +
      '\n         Background playback needs FOREGROUND_SERVICE_MEDIA_PLAYBACK, which\n' +
      '         plugins/withNoForegroundService.js removes. Turning this on without\n' +
      '         removing that plugin crashes the process on Android, in release only.'
    : '');

// The positive half: the call sites that configure the session must still be
// turning it OFF explicitly. "Nobody sets it to true" is also satisfied by
// nobody setting it at all, and the library's default is not ours to rely on.
const CONFIGURERS = ['utils/ttsStream.ts'];
for (const rel of CONFIGURERS) {
  const p = path.join(ROOT, rel);
  const src = fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf8')) : '';
  ok(`${rel} still sets shouldPlayInBackground: false explicitly`,
    /shouldPlayInBackground\s*:\s*false/.test(src),
    src ? 'the explicit false is gone — the default is not ours to rely on' : 'file missing');
}

// And the plugin has to still be registered, or the permissions come back with
// nothing saying so.
const cfg = fs.readFileSync(path.join(ROOT, 'app.config.js'), 'utf8');
ok('the plugin is registered in app.config.js',
  /withNoForegroundService/.test(cfg),
  'without it expo-audio merges both permissions back in and the Play declaration on file becomes false');

// ---- the iOS half of the same claim ----------------------------------------
// UIBackgroundModes: ['audio'] was the iOS twin of these permissions and was
// left behind when they went. It is guarded HERE rather than in its own file
// because it is one claim — "this app does nothing in the background" — and
// splitting it across two checks is how the iOS half got forgotten the first
// time. Declaring a background mode the app does not use is Guideline 2.5.4,
// and a reviewer tests it by backgrounding the app and listening.
//
// Evaluated, not grepped: app.config.js is a function export, so reading it as
// text would pass on a commented-out key and fail on one inside a comment. The
// first version of this verification did exactly that and proved nothing.
{
  let ip = null;
  try {
    const mod = require(path.join(ROOT, 'app.config.js'));
    const cfg = typeof mod === 'function' ? mod({ config: {} })
      : (typeof mod.default === 'function' ? mod.default({ config: {} }) : mod);
    const expo = cfg.expo || cfg;
    ip = (expo.ios || {}).infoPlist || null;
  } catch (e) {
    ip = null;
  }
  ok('the evaluated iOS infoPlist was readable', !!ip && Object.keys(ip).length > 0,
    'app.config.js would not evaluate — this check cannot see anything');
  ok('iOS declares no background modes', !!ip && ip.UIBackgroundModes === undefined,
    ip ? `UIBackgroundModes = ${JSON.stringify(ip.UIBackgroundModes)} — nothing in this app runs in the background` : '');
  ok('iOS keeps App Transport Security on', !!ip && ip.NSAppTransportSecurity === undefined,
    ip ? `NSAppTransportSecurity = ${JSON.stringify(ip.NSAppTransportSecurity)} — every URL in this app is https, and the privacy policy promises TLS 1.2+` : '');
}

const plugin = path.join(ROOT, 'plugins', 'withNoForegroundService.js');
ok('the plugin still removes BOTH permissions',
  fs.existsSync(plugin) &&
  /FOREGROUND_SERVICE'/.test(fs.readFileSync(plugin, 'utf8')) &&
  /FOREGROUND_SERVICE_MEDIA_PLAYBACK/.test(fs.readFileSync(plugin, 'utf8')));

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
