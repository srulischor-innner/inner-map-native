// DOES THE ARTIFACT CARRY THIS WEEK'S WORK? — the companion discriminator.
//
// verify-build-carries-magic-link-fix.js proves a fix from 22 September is in
// the bundle. It would pass just as happily on build 51, which is exactly the
// problem: 51 and 47 were cut from 4837982 and contain none of the work done
// between 22 September and 13 October. A check that cannot tell the new build
// from the old one is not evidence that the new build is new.
//
// So this looks for strings that exist ONLY in commits 28bb333, 7676604 and
// 19655e3 — the paywall account note, and the two in-app privacy strings that
// contradicted the policy. Each is user-facing copy, so it survives into the
// Hermes string table the same way the regex source does.
//
// Negative control: it also asserts the SUPERSEDED strings are gone. Finding the
// new text proves the new code is present; finding the old text alongside it
// would mean the bundler resolved both, which is the stale-cache signature.
//
//   node verify-build-carries-this-weeks-copy.js <path-to.aab|.ipa|.apk>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const artifact = process.argv[2];
if (!artifact || !fs.existsSync(artifact)) {
  console.error('usage: node verify-build-carries-this-weeks-copy.js <artifact>');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};

const out = path.join(process.env.TEMP || '/tmp',
  'verify-copy-' + path.basename(artifact).replace(/\W/g, ''));
fs.mkdirSync(out, { recursive: true });
// Expand-Archive refuses any extension but .zip, so an .ipa or .aab has to be
// handed to it under a .zip name. Copy rather than rename: the artifact is the
// evidence and must not be altered on disk.
const zipCopy = path.join(out, '__artifact.zip');
try {
  fs.copyFileSync(artifact, zipCopy);
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`],
  { stdio: 'pipe' });
  fs.unlinkSync(zipCopy);
} catch (e) {
  console.error('could not expand the artifact: ' + (e.stderr ? String(e.stderr).slice(0, 300) : e.message));
  process.exit(2);
}

const candidates = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(hbc|bundle|js|jsbundle)$/.test(e.name)
      || /index\.android\.bundle|main\.jsbundle/.test(e.name)) candidates.push(full);
  }
})(out);

ok('CONTROL — at least one JS/Hermes bundle was found inside the artifact',
  candidates.length > 0, `expanded to ${out}`);
if (!candidates.length) { console.log('\nFAILURES'); process.exit(1); }

const blobs = candidates.map((f) => ({ f, buf: fs.readFileSync(f) }));
// HERMES STORES A STRING AS ASCII *OR* UTF-16, and picks per string: anything
// with a non-ASCII character — an em dash is enough — goes in the UTF-16 table,
// two bytes per character. An ASCII-only search therefore cannot see most of the
// app's user-facing copy, because most of it contains a dash.
//
// This is not a theoretical gap. Searching only latin1 reported the paywall note
// and the corrected journal sentence as ABSENT from a build that contains both,
// and — the worse half — it reported the SUPERSEDED strings as absent too, so the
// negative controls passed vacuously. A control that cannot see the thing it is
// controlling for is not a control.
const has = (needle) => blobs.some((b) =>
  b.buf.includes(Buffer.from(needle, 'latin1')) ||
  b.buf.includes(Buffer.from(needle, 'utf16le')));
const biggest = blobs.sort((a, b) => b.buf.length - a.buf.length)[0];
console.log(`  ..   ${blobs.length} bundle file(s), largest ${path.basename(biggest.f)} (${(biggest.buf.length / 1e6).toFixed(1)} MB)`);

// CONTROL — a string that is in every build, old and new. If this is missing the
// bundle is unreadable to us and no absence below means anything.
ok('CONTROL — the bundle contains known app copy, so absences are meaningful',
  has('Privacy, Data & Safety') || has('Delete My Account') || has('Inner Map'),
  'no known app copy found — cannot conclude anything from this file');

// 28bb333 — the paywall account note the founder asked for.
ok('28bb333 — the paywall account note is in the bundle',
  has('Your account lives on this device'),
  'the paywall line added on 12 October is absent: this build predates it');

// 19655e3 — the journal string that used to claim per-entry control.
ok('19655e3 — the corrected journal copy is in the bundle',
  has('One setting decides this'),
  'the corrected journal sentence is absent: this build still tells the user they control each entry');

// 19655e3 — the third-party heading, rescoped.
ok('19655e3 — the rescoped third-party heading is in the bundle',
  has('Third parties that see what you write'),
  'the rescoped heading is absent: this build still presents four providers as the whole list');

// NEGATIVE CONTROLS — the superseded strings must be GONE, not merely
// outnumbered. Both present at once is the stale-bundler signature.
ok('the superseded "You control each entry" is NOT in the bundle',
  !has('You control each entry'),
  'both the old and the new journal copy are present — the bundler resolved a stale module');
ok('the superseded "Third parties we use" heading is NOT in the bundle',
  !has('Third parties we use'),
  'both the old and the new heading are present — the bundler resolved a stale module');

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
