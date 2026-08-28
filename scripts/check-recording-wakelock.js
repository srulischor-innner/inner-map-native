#!/usr/bin/env node
// EVERY SURFACE THAT OPENS THE MIC MUST HOLD THE SCREEN AWAKE.
//
// The bug this protects (founder ruling 2026-08-27): expo-audio pauses the
// native recorder when the screen locks, so a hands-free take dies after
// iOS's 30-second auto-lock. utils/recordingWakeLock.ts fixes it — but only
// on surfaces that actually call the hook, and the next voice surface
// somebody adds will not call it unless something says so.
//
// So this asserts the RULE, not today's file list: any file that starts a
// recorder must also hold a wake lock, with its own tag.
//
// WHAT IT WOULD MISS, said plainly: this reads source text. It proves the
// hook is called with the surface's recording flag; it cannot prove that
// flag is true for the whole take. The release path needs no such check —
// it is the effect's own cleanup, so it cannot be forgotten per-surface.
//
//   node scripts/check-recording-wakelock.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['components', 'app'];
const STARTS_RECORDING = /recorder\.record\(\)/;
const HOOK_CALL = /useRecordingWakeLock\(\s*([^,]+),\s*WAKE_TAG\.(\w+)\s*\)/;
const HOOK_IMPORT = /import\s*\{[^}]*useRecordingWakeLock[^}]*\}\s*from/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The rule, applied to a set of {file, source} pairs. Pure, so the negative
 *  control below can run it over mutated sources without touching disk. */
function audit(files) {
  const failures = [];
  const tags = new Map();
  let checked = 0;

  for (const { file, src } of files) {
    if (!STARTS_RECORDING.test(src)) continue;
    checked++;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');

    if (!HOOK_IMPORT.test(src)) {
      failures.push(`${rel} starts a recorder but never imports useRecordingWakeLock`);
      continue;
    }
    const m = HOOK_CALL.exec(src);
    if (!m) {
      failures.push(`${rel} imports useRecordingWakeLock but never calls it with a WAKE_TAG`);
      continue;
    }
    const [, flag, tag] = m;
    if (/^\s*(true|false)\s*$/.test(flag)) {
      failures.push(`${rel} passes a literal \`${flag.trim()}\` — the lock must track the live recording flag`);
    }
    if (tags.has(tag)) {
      failures.push(`${rel} reuses WAKE_TAG.${tag}, already held by ${tags.get(tag)} — one surface would release the other's lock`);
    } else {
      tags.set(tag, rel);
    }
  }
  return { failures, checked };
}

const files = DIRS
  .map((d) => path.join(ROOT, d))
  .filter(fs.existsSync)
  .flatMap((d) => walk(d))
  .map((file) => ({ file, src: fs.readFileSync(file, 'utf8') }));

// ---- the real check ----
const { failures, checked } = audit(files);

// ---- NEGATIVE CONTROL ----
// A check that cannot fail is not a check. Re-run the identical rule over a
// copy of the sources with the hook call cut out of one recording surface;
// if that still passes, this file is decoration and says so.
const victim = files.find((f) => STARTS_RECORDING.test(f.src) && HOOK_CALL.test(f.src));
let controlOk = false;
if (victim) {
  const mutated = files.map((f) =>
    f === victim ? { ...f, src: f.src.replace(HOOK_CALL, 'void 0') } : f,
  );
  controlOk = audit(mutated).failures.length > 0;
}

console.log(`[wakelock-check] recording surfaces found: ${checked}`);
if (!victim) {
  console.error('  ✗ negative control could not run — no surface both records and holds a lock');
  process.exit(1);
}
if (!controlOk) {
  console.error('  ✗ NEGATIVE CONTROL FAILED — removing a wake lock did not trip this check.');
  console.error('    The check is not checking anything. Fix the check before trusting it.');
  process.exit(1);
}
console.log('  ✓ negative control: stripping a wake lock trips the check');

if (failures.length) {
  console.error(`\n[wakelock-check] ${failures.length} FAILURE(S):`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`  ✓ all ${checked} recording surfaces hold a uniquely-tagged screen-sleep lock`);
