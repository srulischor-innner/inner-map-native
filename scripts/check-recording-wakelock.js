#!/usr/bin/env node
// RULES EVERY SURFACE THAT OPENS THE MIC MUST FOLLOW.
//
//   1. hold the screen awake for the length of the take
//   2. reach a record-ready audio session through ensureRecordingMode() —
//      and reach NO OTHER record-mode set, in the surface OR in any module
//      the surface imports
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
// RULE 2 IS A GRAPH QUESTION AND WAS ONCE ASKED AS A FILE QUESTION. Until
// 2026-09-10 the negative half of RULE 2 was `/allowsRecording:\s*true/`
// tested against each recording surface's OWN bytes. Every record-mode set in
// this app lives in utils/ttsStream.ts — one import away — and utils/ was not
// even in DIRS, so that regex never had a candidate to match and this script
// printed "never a bare audio-mode set" while verifyCaptureLive() was setting
// exactly that, mid-capture, on every silent verdict. A rule whose subject is
// one file and whose target is a module that file imports is not a weak rule;
// it is a rule that CANNOT FAIL. RULE 2 now walks one import level, names the
// module and the enclosing function, and has its own negative control.
//
// ONE CONTROL PER RULE, NOT ONE PER FILE. The single old control mutated the
// wake-lock hook call only. It proved RULE 1 could fail and was then read as
// covering the whole script — which is precisely how the dead rule survived.
//
//   node scripts/check-recording-wakelock.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Wide enough that a recording surface's direct imports resolve INSIDE the
// corpus — 'utils' above all, which is where every record-mode set lives.
// Anything that still fails to resolve is counted and printed at the end, so
// the next corpus gap shows up in the output instead of silently shrinking
// RULE 2 back down to a substring test.
const DIRS = ['components', 'app', 'utils', 'constants', 'services', 'hooks', 'lib'];
const STARTS_RECORDING = /recorder\.record\(\)/;
const HOOK_CALL = /useRecordingWakeLock\(\s*([^,]+),\s*WAKE_TAG\.(\w+)\s*\)/;
const HOOK_IMPORT = /import\s*\{[^}]*useRecordingWakeLock[^}]*\}\s*from/;
// RULE 2 (founder ruling 2026-08-28). A bare setAudioModeAsync before capture
// is the shape that produced the "every other message" silent-capture bug: it
// does not tear down a live player, does not retry, and returns nothing to
// check — so recording could begin while the session was still parked in
// playback mode, and capture silence. ChatInput was hardened in June; the
// other four were not. Map Voice PARKS the session for its own spoken
// replies, so on that bar the crossing was one tap away.
const USES_HANDOFF = /ensureRecordingMode\s*\(/;
const RECORD_MODE_SET = /allowsRecording:\s*true/g;   // global: we want OFFSETS
const LOCAL_IMPORT = /\bfrom\s*['"](\.[^'"]+)['"]/g;

// The ONLY functions allowed to set a record-ready session, each with the
// reason it is exempt written next to it. Printed on every pass, so this list
// cannot grow without the growth appearing in the output.
const SANCTIONED_SETTERS = new Map([
  ['ensureRecordingMode',
   'the awaited + retried + checked handoff — the only path a surface may use'],
  ['resetAudioSessionForRecording',
   "cancelStream's hand-back — cannot route through ensureRecordingMode, whose first statement is cancelStream(false), so calling it here would recurse"],
]);

// Column-0 declarations only. An INDENTED `const x =` is a local inside some
// function and must not be mistaken for the enclosing scope; a column-0
// `const RECORD_MODE = { allowsRecording: true }` must not be swallowed by the
// function above it and inherit that function's exemption.
const TOP_LEVEL_DECL = [
  /(?:^|[\r\n])(?:export[ \t]+)?(?:async[ \t]+)?function[ \t]+(\w+)/g,
  /(?:^|[\r\n])(?:export[ \t]+)?(?:const|let|var)[ \t]+(\w+)/g,
];

// RULE 3 (2026-09-10). verifyCaptureLive samples a recorder for 400ms and its
// callers do not await it, so the sampler routinely outlives the take: the
// resume paths read isRecording off the SAME recorder on the very next line
// and can show "Can't resume" while the sampler keeps reading a recorder that
// never started. Every call site must hand it the surface's own liveness
// signal. The import line has no paren after the name, so it never matches.
const VERIFY_CALL = /verifyCaptureLive\s*\(/g;
const TAKE_TOKEN = /\bisCurrent\s*:/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const relPath = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

/** Every column-0 declaration in a source, with its offset, in source order. */
function topLevelDecls(src) {
  const decls = [];
  for (const re of TOP_LEVEL_DECL) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) decls.push({ at: m.index, name: m[1] });
  }
  return decls.sort((a, b) => a.at - b.at);
}

/** The named top-level thing a byte offset sits inside, or null for module
 *  scope. Null is NOT an exemption — an unattributable set still fails. */
function enclosing(decls, offset) {
  let name = null;
  for (const d of decls) {
    if (d.at >= offset) break;
    name = d.name;
  }
  return name;
}

/** Line comments blanked byte for byte — same length, same line count, so
 *  every reported line number stays true. Deliberately NOT a general comment
 *  stripper: it blanks only lines whose first non-space is a double slash, so
 *  the ONLY thing it can hide is a set that was ALREADY commented out, and a
 *  commented-out set is not a live set. A block-comment stripper has no such
 *  guarantee — one string literal carrying the opening delimiter and it eats
 *  live code, a false NEGATIVE in exactly the class this check exists to
 *  close. Blanking is needed at all because the rule is documented in prose
 *  that quotes the token it forbids, directly above the deletion in
 *  utils/ttsStream.ts. */
function blankLineComments(src) {
  return src.replace(/^[ \t]*\/\/[^\r\n]*/gm, (m) => ' '.repeat(m.length));
}

/** Every `allowsRecording: true` in a source, with line and enclosing name. */
function recordModeSets(src) {
  const clean = blankLineComments(src);
  const decls = topLevelDecls(clean);
  const hits = [];
  RECORD_MODE_SET.lastIndex = 0;
  let m;
  while ((m = RECORD_MODE_SET.exec(clean))) {
    hits.push({ line: clean.slice(0, m.index).split('\n').length, fn: enclosing(decls, m.index) });
  }
  return hits;
}

/** Every call matching `re`, with its line and its full parenthesised text,
 *  paren-balanced so a multi-line options object is one span. Comments are
 *  blanked first so a commented-out call is not audited as a real one. */
function callSpans(src, re) {
  const clean = blankLineComments(src);
  const spans = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(clean))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < clean.length; i++) {
      if (clean[i] === '(') depth++;
      else if (clean[i] === ')' && --depth === 0) break;
    }
    spans.push({ line: clean.slice(0, m.index).split('\n').length, text: clean.slice(m.index, i + 1) });
  }
  return spans;
}

/** Resolve a relative import against the corpus. Returns a path, or null when
 *  the target is outside DIRS — which the caller reports rather than ignores. */
function resolveLocal(fromFile, spec, byPath) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.ts', base + '.tsx',
                   path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (byPath.has(c)) return c;
  }
  return null;
}

/** The surface plus every module it imports DIRECTLY. One level, deliberately:
 *  that is the claim the pass line makes, and one level is what the bug needed
 *  (ttsStream is a direct import of all five surfaces). */
function reachOf(file, src, byPath) {
  const reach = [{ file, src }];
  const unresolved = [];
  const seen = new Set([file]);
  LOCAL_IMPORT.lastIndex = 0;
  let m;
  while ((m = LOCAL_IMPORT.exec(src))) {
    const target = resolveLocal(file, m[1], byPath);
    if (!target) { unresolved.push(m[1]); continue; }
    if (seen.has(target)) continue;
    seen.add(target);
    reach.push({ file: target, src: byPath.get(target) });
  }
  return { reach, unresolved };
}

/** The rule, applied to a set of {file, source} pairs. Pure, so the negative
 *  controls below can run it over mutated sources without touching disk. */
function audit(files) {
  const failures = [];
  const tags = new Map();
  // RULE 2 reads the corpus THROUGH the array it was handed, never off disk —
  // otherwise the negative controls below would mutate a copy nothing reads.
  const byPath = new Map(files.map((f) => [f.file, f.src]));
  // "module:line fn()" -> the surfaces that reach it, so one bad setter is
  // reported once and names everyone exposed to it.
  const offenders = new Map();
  const modules = new Set();
  const unresolved = new Set();
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

    // RULE 2a — the handoff. File-local, and correctly so: the SURFACE is the
    // thing that must call it. NOT an `else if`: a surface can both skip the
    // handoff and carry a bare set, and hiding the second behind the first
    // means fixing one reveals a failure the previous run never mentioned.
    if (!USES_HANDOFF.test(src)) {
      failures.push(`${rel} starts a recorder without ensureRecordingMode() — a bare audio-mode set can begin capture in playback mode and record silence`);
    }

    // RULE 2b — no unsanctioned record-mode set anywhere the surface REACHES.
    // The question is about the graph, so the subject is the graph.
    const { reach, unresolved: missed } = reachOf(file, src, byPath);
    for (const u of missed) unresolved.add(u);
    for (const node of reach) {
      modules.add(node.file);
      for (const hit of recordModeSets(node.src)) {
        if (hit.fn && SANCTIONED_SETTERS.has(hit.fn)) continue;
        const where = `${relPath(node.file)}:${hit.line} ${hit.fn ? hit.fn + '()' : '<module scope>'}`;
        if (!offenders.has(where)) offenders.set(where, new Set());
        offenders.get(where).add(rel);
      }
    }

    // RULE 3 — every verifyCaptureLive call carries a take token. Unawaited
    // and uncancellable, the sampler otherwise runs its whole window over a
    // recorder the surface has already finished with.
    for (const span of callSpans(src, VERIFY_CALL)) {
      if (TAKE_TOKEN.test(span.text)) continue;
      const excerpt = span.text.replace(/\s+/g, ' ').slice(0, 72);
      failures.push(`${rel}:${span.line} calls verifyCaptureLive without isCurrent — the sampler outlives the take and reports a verdict about a recording that is over: ${excerpt}`);
    }
  }

  for (const [where, reachedBy] of offenders) {
    failures.push(
      `unsanctioned record-mode set at ${where} — in the import reach of ${[...reachedBy].sort().join(', ')}. ` +
      `Only ${[...SANCTIONED_SETTERS.keys()].join('() and ')}() may set allowsRecording:true`,
    );
  }
  return { failures, checked, modules: modules.size, unresolved: [...unresolved] };
}

const files = DIRS
  .map((d) => path.join(ROOT, d))
  .filter(fs.existsSync)
  .flatMap((d) => walk(d))
  .map((file) => ({ file, src: fs.readFileSync(file, 'utf8') }));

// ---- the real check ----
const { failures, checked, modules, unresolved } = audit(files);

// ---- NEGATIVE CONTROLS, ONE PER RULE ----
// A check that cannot fail is not a check, and a check with one live rule and
// one dead rule under a single "✓ negative control" line is worse than no
// control at all, because the pass is read as covering both.
//
// Each control asserts the SPECIFIC failure its mutation implies. The old
// `failures.length > 0` was already one unrelated failure away from being
// vacuous itself: any other rule going red would have satisfied it while the
// mutation went unnoticed.
const byPath = new Map(files.map((f) => [f.file, f.src]));
const surfaces = files.filter((f) => STARTS_RECORDING.test(f.src));

// CONTROL 1 — RULE 1. Cut the hook call out of one recording surface.
const victim = surfaces.find((f) => HOOK_CALL.test(f.src));
let control1Ok = false;
if (victim) {
  const mutated = files.map((f) =>
    f === victim ? { ...f, src: f.src.replace(HOOK_CALL, 'void 0') } : f,
  );
  control1Ok = audit(mutated).failures.some((x) => /never calls it with a WAKE_TAG/.test(x));
}

// CONTROL 2 — RULE 2b. Plant an unsanctioned setter in an audio module a
// surface actually IMPORTS. If the reach walk is broken in any way — utils/
// dropped from DIRS, an import that stops resolving, the enclosing-name
// resolver mis-attributing to an exempt function — this planted setter goes
// unseen and the control says so instead of the script printing an all-clear.
// The module is DERIVED from the reach, never hardcoded: this asserts the
// rule, not today's file list.
const CONTROL_FN = '__wakelockControlSetter';
const CONTROL_SRC = `\r\nasync function ${CONTROL_FN}() {\r\n  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });\r\n}\r\n`;
let control2Ok = false;
let control2Where = null;
for (const s of surfaces) {
  const { reach } = reachOf(s.file, s.src, byPath);
  const mod = reach.find((n) => n.file !== s.file && /setAudioModeAsync/.test(n.src));
  if (!mod) continue;
  const mutated = files.map((f) =>
    f.file === mod.file ? { ...f, src: f.src + CONTROL_SRC } : f,
  );
  control2Ok = audit(mutated).failures.some((x) => x.includes(CONTROL_FN));
  control2Where = `${relPath(mod.file)} (reached from ${relPath(s.file)})`;
  break;
}

// CONTROL 3 — RULE 3. PLANT a token-less call rather than stripping a good
// one, so the control works whether or not the call sites have been fixed yet.
const CONTROL_CALL_FN = '__wakelockControlTake';
const CONTROL_CALL = `\r\nvoid verifyCaptureLive(() => ${CONTROL_CALL_FN}());\r\n`;
let control3Ok = false;
let control3Where = null;
if (surfaces.length) {
  const s = surfaces[0];
  const mutated = files.map((f) => (f === s ? { ...f, src: f.src + CONTROL_CALL } : f));
  control3Ok = audit(mutated).failures.some((x) => x.includes(CONTROL_CALL_FN));
  control3Where = relPath(s.file);
}

console.log(`[wakelock-check] recording surfaces found: ${checked}`);
if (!victim) {
  console.error('  ✗ RULE 1 control could not run — no surface both records and holds a lock');
  process.exit(1);
}
if (!control1Ok) {
  console.error('  ✗ RULE 1 NEGATIVE CONTROL FAILED — removing a wake lock did not trip this check.');
  console.error('    The check is not checking anything. Fix the check before trusting it.');
  process.exit(1);
}
console.log('  ✓ RULE 1 control: stripping a wake lock trips the check');
if (!control2Where) {
  console.error('  ✗ RULE 2 control could not run — no recording surface imports a module that calls setAudioModeAsync.');
  console.error('    Either the import reach is broken or the audio module moved. Fix the check before trusting it.');
  process.exit(1);
}
if (!control2Ok) {
  console.error(`  ✗ RULE 2 NEGATIVE CONTROL FAILED — a record-mode set planted in ${control2Where} was not seen.`);
  console.error('    RULE 2 is decoration again. Fix the check before trusting it.');
  process.exit(1);
}
console.log(`  ✓ RULE 2 control: a record-mode set planted in ${control2Where} trips the check`);
if (!control3Where) {
  console.error('  ✗ RULE 3 control could not run — no recording surface found');
  process.exit(1);
}
if (!control3Ok) {
  console.error(`  ✗ RULE 3 NEGATIVE CONTROL FAILED — a verifyCaptureLive call with no isCurrent, planted in ${control3Where}, was not seen.`);
  console.error('    RULE 3 is decoration. Fix the check before trusting it.');
  process.exit(1);
}
console.log(`  ✓ RULE 3 control: a token-less verifyCaptureLive planted in ${control3Where} trips the check`);

if (failures.length) {
  console.error(`\n[wakelock-check] ${failures.length} FAILURE(S):`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`  ✓ all ${checked} recording surfaces hold a uniquely-tagged screen-sleep lock`);
console.log(`  ✓ all ${checked} reach the mic through ensureRecordingMode()`);
console.log(`  ✓ ${modules} reachable module(s) scanned one import deep; ${[...SANCTIONED_SETTERS.keys()].join(' + ')} are the only record-mode setters`);
console.log(`  ✓ every verifyCaptureLive call passes isCurrent — no sampler outlives its take`);
if (unresolved.length) {
  console.log(`  · ${unresolved.length} local import(s) resolved to nothing in DIRS and were NOT scanned: ${unresolved.slice(0, 8).join(', ')}${unresolved.length > 8 ? ' …' : ''}`);
}
