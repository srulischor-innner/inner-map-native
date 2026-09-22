// DOES THE ARTIFACT ON THE STORE ACTUALLY CARRY THE MAGIC-LINK FIX?
//
// WHY THIS IS NOT "check the commit". EAS records a gitCommitHash per build and
// it is worth checking — but it proves what was CHECKED OUT, not what was
// COMPILED. A stale cache, a wrong profile, a bundler that resolved a different
// file, all produce a build whose recorded commit is right and whose bundle is
// not. Build 49 was cut before d9321c2 and a fresh install of it cannot complete
// email sign-in now that the Team ID validates; the whole point of this file is
// to prove the replacement is different, from the bytes that ship.
//
// THE DISCRIMINATOR, and why it is this exact string. The fix changed one regex:
//
//   before   /\/auth\/email\/?$/        <- requires a leading slash
//   after    /^\/?auth\/email\/?$/      <- accepts both, which is what
//                                          expo-linking actually produces
//
// Hermes stores a regex literal's SOURCE in the bytecode string table, so the
// pattern text survives compilation. The substring "?auth" appears in the new
// pattern and in neither the old one nor anywhere else in the bundle — it is
// the "\/?" that was added. Searching for it is therefore a direct yes/no on
// whether the compiled bundle carries the fix.
//
// The negative control matters as much: this also asserts the bundle contains
// the OTHER magic-link strings, so a download that produced an empty or
// truncated file cannot read as "no match, therefore old build". Absence of
// evidence is not evidence here unless the file is known good.
//
//   node scripts/verify-build-carries-magic-link-fix.js <path-to.aab|.ipa|.apk>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const artifact = process.argv[2];
if (!artifact || !fs.existsSync(artifact)) {
  console.error('usage: node scripts/verify-build-carries-magic-link-fix.js <artifact>');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};

// Unzip to a scratch dir. .aab/.ipa/.apk are all zips.
const out = path.join(process.env.TEMP || '/tmp', 'verify-artifact-' + path.basename(artifact).replace(/\W/g, ''));
fs.mkdirSync(out, { recursive: true });
try {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${artifact.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`],
  { stdio: 'pipe' });
} catch (e) {
  console.error('could not expand the artifact: ' + (e.stderr ? String(e.stderr).slice(0, 300) : e.message));
  process.exit(2);
}

// Collect every candidate bundle: Hermes bytecode, plain JS, anything large.
const candidates = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(hbc|bundle|js|jsbundle)$/.test(e.name) || /index\.android\.bundle|main\.jsbundle/.test(e.name)) candidates.push(full);
  }
})(out);

ok('CONTROL — at least one JS/Hermes bundle was found inside the artifact',
  candidates.length > 0, `expanded to ${out}`);
if (!candidates.length) { console.log('\nFAILURES'); process.exit(1); }

const blobs = candidates.map((f) => ({ f, buf: fs.readFileSync(f) }));
const has = (needle) => blobs.some((b) => b.buf.includes(Buffer.from(needle, 'latin1')));
const biggest = blobs.sort((a, b) => b.buf.length - a.buf.length)[0];
console.log(`  ..   ${blobs.length} bundle file(s), largest ${path.basename(biggest.f)} (${(biggest.buf.length / 1e6).toFixed(1)} MB)`);

// NEGATIVE CONTROL FIRST. If these are missing the download is not a bundle we
// can conclude anything from, and "the fix is absent" would be a lie.
ok('CONTROL — the bundle contains the magic-link host, so it is the real app bundle',
  has('my-inner-map.com'),
  'no host string found — this is not an app bundle, or it is compressed in a way this cannot read');
ok('CONTROL — the bundle contains the auth/email route at all',
  has('auth/email') || has('auth\\/email'),
  'the deep-link route is absent entirely');

// THE ACTUAL QUESTION.
const fixed = has('?auth');
ok('THE FIX IS IN THE SHIPPED BUNDLE — the regex accepts a path with no leading slash',
  fixed,
  'the compiled bundle carries the OLD pattern. A fresh install cannot complete email sign-in: '
  + 'expo-linking hands the handler "auth/email" and the old regex requires "/auth/email". DO NOT ATTACH THIS BUILD.');

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
