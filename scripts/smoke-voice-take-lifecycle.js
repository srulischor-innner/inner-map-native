// Smoke for THE VOICE-NOTE TAKE LIFECYCLE (August 2026).
//
// THE INVARIANT THIS FILE EXISTS TO HOLD:
//
//   EVERY exit from a voice-note take resets EVERY take-scoped ref.
//
// A "take" is one recording attempt in components/ChatInput.tsx, from the
// moment a hold claims it to the moment it is sent, discarded or abandoned.
// Nine places can end one, and before this file they each cleared their own
// hand-picked subset. One of them — the finalizeAndSend early-return —
// cleared `locked` and nothing else, so an `interrupted` latch set during our
// own teardown survived it. The interrupted UI routes its send button back
// into that exact early-return, ChatInput is not remounted in normal chat use
// (app/(tabs)/index.tsx renders it with no key; only the crisis gate swaps it
// out), and the mic gesture is unmounted while interrupted — so the component
// was dead until the app restarted. The class of bug is SUBSET DRIFT, not the
// one line, and that is what is asserted here.
//
// Also asserted, because they shipped in the same pass and each fixes the
// same user-visible symptom independently:
//   • utils/recorderWatch.ts — the recordingStatusUpdate listener carries the
//     same stoppingRef suppression its sibling poll already had, so a
//     teardown-time encode error cannot re-set the latch after we cleared it.
//   • components/ChatInput.tsx — every abort that has already called
//     prepareToRecordAsync() releases the native handle before returning, or
//     Android's AudioRecorderAlreadyPreparedException poisons the recorder
//     for the rest of the process.
//   • ccfe8cb's behaviour: a LOCKED recording still survives a released hold.
//
// ============================ THE CEILING ================================
//
// BE CLEAR ABOUT WHAT THIS CANNOT DO. There is no React renderer here, no
// device, no expo-audio, no gesture handler and no native MediaRecorder. The
// component cannot be mounted, so it cannot be DRIVEN: this file cannot press
// the mic, cannot let a start race a release, cannot make Android emit
// onError during teardown, and cannot observe a single value of `interrupted`
// at runtime. Every assertion below is therefore STRUCTURAL — it reads the
// real shipped source and asserts things about its shape.
//
// The alternative was a mock harness that re-implements the take lifecycle in
// JavaScript and then tests that re-implementation. That would pass against
// itself forever while the shipped component drifted, which is exactly the
// failure this file is supposed to catch. A structural test that can be
// honestly described is worth more than a behavioural one that is a fiction.
//
// WHAT THIS CATCHES:
//   • a NEW take-exit added without a reset (the returns are derived from
//     source, not listed here);
//   • a NEW take-scoped ref or state added without being classified;
//   • a take-scoped field quietly dropped from the reset;
//   • a take-scoped field hand-written at a site that is not an approved
//     writer — i.e. subset drift growing back;
//   • the listener guard, the release call, or the lock behaviour being
//     removed or weakened.
//
// WHAT STILL NEEDS A HUMAN ON A REAL ANDROID DEVICE (nothing below covers
// any of it):
//   1. Record → release → send, repeatedly. The mic must still work on the
//      20th take, not just the first. That is the prepared-handle leak.
//   2. Start a hold and release it DURING the permission prompt / the
//      audio-session handoff / prepare (a fast tap on a cold start). Then
//      record normally. The second take must work.
//   3. Force an interruption mid-take (lock the screen, take a call), then
//      send. The pill must show Paused, then the take must send, and the mic
//      must be usable again immediately afterwards.
//   4. Swipe-up-to-lock, lift the finger, keep talking, tap send. The
//      recording must survive the release (ccfe8cb).
//   5. Swipe-left-to-cancel, then record again.
//   6. Whether the 250ms of "Paused" now shown during STOP_GRACE_MS on an
//      interrupted take reads correctly or as a stutter.
//
// Run: node scripts/smoke-voice-take-lifecycle.js
// Output: STEP lines, ALL GREEN on success, exit code 1 on any failure.

const fs = require('fs');
const path = require('path');

const NATIVE = path.resolve(__dirname, '..');
const chatPath = path.join(NATIVE, 'components', 'ChatInput.tsx');
const watchPath = path.join(NATIVE, 'utils', 'recorderWatch.ts');
const idxPath = path.join(NATIVE, 'app', '(tabs)', 'index.tsx');

let pass = true;
let ran = 0;
const failures = [];
function step(label, ok, extra) {
  ran++;
  console.log(`STEP ${ran} — ${label}: ${ok ? 'OK' : 'FAIL'}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { pass = false; failures.push(`${label}${extra ? ` — ${extra}` : ''}`); }
}
function note(msg) { console.log(`  ..  ${msg}`); }

for (const p of [chatPath, watchPath, idxPath]) {
  if (!fs.existsSync(p)) {
    console.log(`RESULT: FAIL — source not found: ${p}`);
    process.exit(1);
  }
}
const chatSrc = fs.readFileSync(chatPath, 'utf8');
const watchSrc = fs.readFileSync(watchPath, 'utf8');
const idxSrc = fs.readFileSync(idxPath, 'utf8');

// NB: no `\n` anchors in any regex below — this checkout is CRLF for
// ChatInput.tsx and LF for recorderWatch.ts, so a `;\n` pattern would match
// in one file and silently never match in the other.

// ---------------------------------------------------------------------------
// A tiny scanner. Everything structural below runs on a COMMENT-FREE copy, so
// prose that merely NAMES a symbol (and this codebase's comments name a lot of
// them, deliberately — they are the record of these decisions) can never
// satisfy or break an assertion. Comments are replaced by spaces so that every
// byte offset still lines up with the original file.
// ---------------------------------------------------------------------------
function stripComments(src) {
  const out = src.split('');
  let i = 0, q = null, tpl = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      if (c === '\\') { i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (tpl > 0) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { tpl--; i++; continue; }
      i++; continue;
    }
    if (c === '"' || c === "'") { q = c; i++; continue; }
    if (c === '`') { tpl++; i++; continue; }
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (let k = i; k < stop; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
      i = stop; continue;
    }
    i++;
  }
  return out.join('');
}

const chat = stripComments(chatSrc);
const watch = stripComments(watchSrc);

/** Brace-match a block starting at the first `{` at or after `from`. */
function blockAt(src, from) {
  const open = src.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0, i = open, q = null, tpl = 0;
  while (i < src.length) {
    const c = src[i];
    if (q) { if (c === '\\') { i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (tpl > 0) { if (c === '\\') { i += 2; continue; } if (c === '`') tpl--; i++; continue; }
    if (c === '"' || c === "'") { q = c; i++; continue; }
    if (c === '`') { tpl++; i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { start: open, end: i + 1, body: src.slice(open, i + 1) }; }
    i++;
  }
  return null;
}

/** Slice a named function declaration's body out of `src`. */
function fnBody(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return null;
  const close = src.indexOf(')', m.index + m[0].length - 1);
  const b = blockAt(src, close);
  return b ? { name, ...b } : null;
}

// ===========================================================================
// SECTION A — ITEM 1: the recordingStatusUpdate listener guard.
// utils/recorderWatch.ts. Fixes the symptom on its own; depends on nothing
// in ChatInput.
// ===========================================================================
console.log('');
console.log('== A. LISTENER GUARD (utils/recorderWatch.ts) ==');

const addIdx = watch.indexOf("addListener('recordingStatusUpdate'");
const listener = addIdx === -1 ? null : blockAt(watch, watch.indexOf('=>', addIdx));
step('the recordingStatusUpdate subscription is located', !!listener,
  listener ? `len=${listener.body.length}` : 'not found');

// The sibling poll's guard, quoted from source — the semantics the listener
// has to match. Derived, not retyped, so if the poll's guard ever changes
// shape the comparison changes with it.
const pollGuard = /if\s*\(\s*o\.stoppingRef\.current\s*\)\s*return;/.test(watch);
step('the sibling POLL still guards on stoppingRef (the semantics being matched)', pollGuard);

if (listener) {
  step('the listener consults stoppingRef BEFORE calling onEncodeError',
    /stoppingRef\.current\s*\)\s*return;/.test(listener.body)
      && listener.body.indexOf('stoppingRef') < listener.body.indexOf('onEncodeError'),
    'guard precedes the callback');

  step('the guard reads the LIVE ref through cbRef, like the poll does',
    /cbRef\.current\.stoppingRef\.current/.test(listener.body),
    'not a stale closure capture of opts');

  // The whole reason the subscription exists. A "fix" that deletes the call
  // also "fixes" the bug, and would silently re-open the iOS truncation hole.
  step('a GENUINE mid-take encode error still reaches onEncodeError',
    /onEncodeError\(status\.error\s*\?\?\s*null\)/.test(listener.body),
    'the callback is guarded, not removed');

  step('hasError is still the trigger — the guard did not widen the filter',
    /status\.hasError/.test(listener.body));
}

// Independence: item 1 must not reach into ChatInput's fix.
step('item 1 is self-contained — recorderWatch names nothing from items 2 or 3',
  !/resetTake|clearTakeSignals|releaseAbandonedRecorder/.test(watchSrc));

// The watch is shared with ChatInput AND JournalEntryModal, so its options
// shape is load-bearing for two call sites. Adding a guard must not have
// changed it. The keys are DERIVED from the options type in source and
// compared as a set — a rename, an addition or a removal all fail, which a
// bag-of-words search for each name would not (the name usually survives at
// its call site).
{
  const optsIdx = watch.indexOf('opts: {');
  const optsBlock = optsIdx === -1 ? null : blockAt(watch, optsIdx);
  const got = optsBlock
    ? [...optsBlock.body.matchAll(/(?:^|[{;])\s*(\w+)\??\s*:/g)].map((m) => m[1]).sort()
    : [];
  const want = ['active', 'interruptedRef', 'onAutoResumed', 'onCapturedMs',
    'onEncodeError', 'onInterrupted', 'startTimeRef', 'stoppingRef'].sort();
  step('the useRecorderWatch options contract is unchanged (both call sites still compile)',
    !!optsBlock && got.join(',') === want.join(','),
    got.join(',') === want.join(',') ? `${got.length} options` : `got [${got}] want [${want}]`);
}

// ===========================================================================
// SECTION B — ITEM 2: every take-exit resets every take-scoped ref.
// components/ChatInput.tsx. Fixes the symptom on its own; depends on nothing
// in recorderWatch.
// ===========================================================================
console.log('');
console.log('== B. TAKE-SCOPED RESET (components/ChatInput.tsx) ==');

const resetTake = fnBody(chat, 'resetTake');
const clearSignals = fnBody(chat, 'clearTakeSignals');
step('resetTake() exists', !!resetTake);
step('clearTakeSignals() exists', !!clearSignals);
step('resetTake() composes clearTakeSignals() — one reset, not two that can drift',
  !!resetTake && /clearTakeSignals\(\)/.test(resetTake.body));

const resetAll = (resetTake ? resetTake.body : '') + (clearSignals ? clearSignals.body : '');

// ---- B.1 THE INVENTORY CONTROL --------------------------------------------
// Derive EVERY ref / state / shared value the component declares, straight
// from source, and require each to be classified. A ref added later — the
// realistic way a tenth take-scoped field appears — fails here until a human
// decides which bucket it belongs in. Without this, "reset every take-scoped
// ref" is only ever checked against the list that was true the day this was
// written.
const declaredRefs = [...chat.matchAll(/const\s+(\w+)\s*=\s*useRef[<(]/g)].map((m) => m[1]);
const declaredState = [...chat.matchAll(/const\s*\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*useState[<(]/g)]
  .map((m) => ({ value: m[1], setter: m[2] }));
const declaredShared = [...chat.matchAll(/const\s+(\w+)\s*=\s*useSharedValue\(/g)].map((m) => m[1]);

// TAKE-SCOPED: must be reset by resetTake (directly or via clearTakeSignals).
const TAKE_SCOPED_REFS = {
  recordingRef: 'a take is in progress',
  holdActiveRef: 'a hold owns this take',
  startPromiseRef: 'an in-flight start belongs to this take',
  interruptedRef: 'the interrupted latch (the stuck bit)',
  stoppingRef: 'whether the watch may reconcile this take',
  capturedMsRef: "the recorder's own captured duration for this take",
  gapNoteTimer: 'the pending auto-resume note for this take',
};
// NOT take-scoped, each with the reason it is exempt.
const OTHER_REFS = {
  startTimeRef: 'write-on-entry only; read for gap estimates, never a latch',
  lastPrefillRef: 'text prefill, unrelated to recording',
  inputRef: 'the TextInput handle',
  tapHintHoldTimer: 'teaching tooltip',
  tapHintFadeTimer: 'teaching tooltip',
  pulse: 'the recording-dot Animated.Value; driven by its own effect',
  gestureHandlersRef: 'the stable trampoline target (ccfe8cb)',
};
const TAKE_SCOPED_STATE = {
  recording: 'the pill and the mic gesture are gated on it',
  seconds: 'the visible timer',
  interrupted: 'the Paused UI (the stuck bit)',
  gapNote: 'the auto-resume notice',
  locked: 'hands-free mode',
};
const OTHER_STATE = {
  text: 'the composer',
  inputHeight: 'Android multiline growth',
};

const unclassifiedRefs = declaredRefs.filter((r) => !(r in TAKE_SCOPED_REFS) && !(r in OTHER_REFS));
step('every useRef in ChatInput is classified take-scoped or exempt',
  unclassifiedRefs.length === 0,
  unclassifiedRefs.length ? `UNCLASSIFIED: ${unclassifiedRefs.join(', ')} — decide if it is take-scoped and add it to resetTake` : `${declaredRefs.length} refs`);

const unclassifiedState = declaredState.filter((s) => !(s.value in TAKE_SCOPED_STATE) && !(s.value in OTHER_STATE));
step('every useState in ChatInput is classified take-scoped or exempt',
  unclassifiedState.length === 0,
  unclassifiedState.length ? `UNCLASSIFIED: ${unclassifiedState.map((s) => s.value).join(', ')}` : `${declaredState.length} states`);

const missingRefDecl = Object.keys(TAKE_SCOPED_REFS).filter((r) => !declaredRefs.includes(r));
step('every ref this file calls take-scoped still exists in the component',
  missingRefDecl.length === 0, missingRefDecl.join(', '));

// ---- B.2 THE RESET IS TOTAL ------------------------------------------------
{
  const missing = Object.keys(TAKE_SCOPED_REFS).filter((r) => !new RegExp(`${r}\\.current\\s*=|${r}\\.current\\)`).test(resetAll));
  step(`resetTake writes EVERY take-scoped ref (${Object.keys(TAKE_SCOPED_REFS).length})`,
    missing.length === 0, missing.length ? `NOT RESET: ${missing.join(', ')}` : Object.keys(TAKE_SCOPED_REFS).join(', '));
}
{
  const setters = declaredState.filter((s) => s.value in TAKE_SCOPED_STATE);
  const missing = setters.filter((s) => !new RegExp(`${s.setter}\\(`).test(resetAll)).map((s) => s.value);
  step(`resetTake writes EVERY take-scoped state (${setters.length})`,
    missing.length === 0, missing.length ? `NOT RESET: ${missing.join(', ')}` : setters.map((s) => s.value).join(', '));
}

// ---- B.3 THE SELF-DEFEAT GUARD --------------------------------------------
// stoppingRef's idle value is `true`, not `false`. It does not mean "a stop is
// running", it means "the watch must not reconcile" — and between takes that
// is correct. A reset that set it FALSE would hand the still-live poll a
// window to call markInterrupted immediately after the reset (the watch effect
// tears down a render later, not synchronously), re-creating the exact latch
// the reset exists to clear. That would make item 2 undo item 1.
step('resetTake leaves the watch SUPPRESSED (stoppingRef = true), never armed',
  !!resetTake && /stoppingRef\.current\s*=\s*true/.test(resetTake.body)
    && !/stoppingRef\.current\s*=\s*false/.test(resetTake.body),
  'setting it false here would re-open the window item 1 closes');

step('stoppingRef is re-armed on ENTRY instead, in startRecording',
  /stoppingRef\.current\s*=\s*false/.test(fnBody(chat, 'startRecording')?.body || ''));

// ---- B.4 EVERY EXIT IS COVERED — DERIVED FROM SOURCE ----------------------
// The exits are NOT listed here. They are found by walking every `return` in
// the three lifecycle functions, so an exit added later is picked up
// automatically and fails until it resets. THIS IS THE CONTROL — the whole
// point is to catch the class, not the one instance that was fixed.
//
// The rule per return: some call to resetTake() must DOMINATE it — sit
// earlier in the source, in a block that encloses the return (or in the
// return's own block). A resetTake inside a SIBLING `if` does not count,
// because control that reached this return never went through it. That is
// what makes a newly added abort branch fail: nothing dominates it.
//
// The one legal uncovered return is the START path's success return, which
// deliberately leaves a take running; it must instead be dominated by the
// ENTRY (clearTakeSignals + claiming recordingRef).
//
// Limits, stated plainly: this is straight-line dominance over `if`/`try`
// nesting, which is all these three functions contain. It does not model a
// reset inside a `try` dominating a return inside the matching `catch`, and
// there are no loops or labelled jumps here to get wrong.
function scanOccurrences(body, re) {
  const out = [];
  const stack = [];
  let i = 0, q = null, tpl = 0;
  while (i < body.length) {
    const c = body[i];
    if (q) { if (c === '\\') { i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (tpl > 0) { if (c === '\\') { i += 2; continue; } if (c === '`') tpl--; i++; continue; }
    if (c === '"' || c === "'") { q = c; i++; continue; }
    if (c === '`') { tpl++; i++; continue; }
    if (c === '{') { stack.push(i); i++; continue; }
    if (c === '}') { stack.pop(); i++; continue; }
    re.lastIndex = i;
    const m = re.exec(body);
    if (m && m.index === i) {
      out.push({ idx: i, text: m[0].trim(), ancestors: [...stack] });
      i += m[0].length; continue;
    }
    i++;
  }
  return out;
}
const isPrefix = (a, b) => a.length <= b.length && a.every((v, k) => v === b[k]);
function dominates(call, ret) { return call.idx < ret.idx && isPrefix(call.ancestors, ret.ancestors); }

function auditExits(fnName) {
  const fn = fnBody(chat, fnName);
  if (!fn) { step(`${fnName} is located`, false); return 0; }
  const rets = scanOccurrences(fn.body, /\breturn\b[^;]*;/g);
  const resets = scanOccurrences(fn.body, /resetTake\(\)/g);
  const entryClears = scanOccurrences(fn.body, /clearTakeSignals\(\)/g);
  const entryClaims = scanOccurrences(fn.body, /recordingRef\.current\s*=\s*true/g);
  const bodyAt = chat.indexOf(fn.body);
  const bad = [];
  for (const r of rets) {
    const covered = resets.some((c) => dominates(c, r));
    const isEntry = entryClears.some((c) => dominates(c, r)) && entryClaims.some((c) => dominates(c, r));
    if (!covered && !isEntry) {
      const line = chatSrc.slice(0, bodyAt + r.idx).split(/\r?\n/).length;
      bad.push(`${r.text} @line~${line}`);
    }
  }
  step(`${fnName}: every exit resets the take (${rets.length} returns derived from source)`,
    bad.length === 0,
    bad.length ? `UNCOVERED BY ANY DOMINATING resetTake(): ${bad.join(' | ')}`
      : `${resets.length} reset call(s) dominate them`);
  return rets.length;
}
const nStart = auditExits('startRecording');
const nFinal = auditExits('finalizeAndSend');
const nCancel = auditExits('cancelRecording');

// Sanity floor on the derivation itself: if the walker silently found nothing
// (a refactor to arrow functions, say), the three steps above would pass
// vacuously. The founder enumerated nine exits; the returns that implement
// them must still be there.
step('the exit walker actually found the take-exits (not vacuously green)',
  nStart >= 6 && nFinal >= 3 && nCancel >= 1,
  `startRecording=${nStart} finalizeAndSend=${nFinal} cancelRecording=${nCancel}`);
note('9 founder-enumerated exits: 5 start aborts + the start catch, finalize early-return');
note('+ finalize send/no-uri/too-short/catch, cancel early-return + cancel full.');

// ---- B.5 NO SUBSET DRIFT ANYWHERE ELSE ------------------------------------
// The bug was nine sites each hand-clearing their own subset. Assert that
// take-scoped fields are written ONLY by approved writers. A new exit that
// hand-clears two of them instead of calling resetTake shows up here as a new
// (field, function) pair.
const namedFns = [...chat.matchAll(/\bfunction\s+(\w+)\s*\(/g)].map((m) => {
  const b = blockAt(chat, chat.indexOf(')', m.index));
  return b ? { name: m[1], start: b.start, end: b.end } : null;
}).filter(Boolean);
const arrowProps = [...chat.matchAll(/(\w+):\s*\([^)]*\)\s*=>\s*\{/g)].map((m) => {
  const b = blockAt(chat, m.index + m[0].length - 1);
  return b ? { name: m[1], start: b.start, end: b.end } : null;
}).filter(Boolean);
const scopes = [...namedFns, ...arrowProps];
function scopeOf(idx) {
  let best = null;
  for (const s of scopes) if (idx >= s.start && idx < s.end && (!best || s.start > best.start)) best = s;
  return best ? best.name : '<component-body>';
}

// field -> the ONLY functions allowed to write it, and why.
const APPROVED_WRITERS = {
  'recordingRef.current': ['resetTake', 'startRecording'],
  'holdActiveRef.current': ['resetTake', 'startRecording', 'finalizeAndSend', 'cancelRecording'],
  'startPromiseRef.current': ['resetTake', 'startRecording'],
  'interruptedRef.current': ['clearTakeSignals', 'markInterrupted', 'resumeRecording', 'onAutoResumed'],
  'stoppingRef.current': ['resetTake', 'startRecording', 'finalizeAndSend'],
  'capturedMsRef.current': ['clearTakeSignals', 'onCapturedMs'],
  'gapNoteTimer.current': ['clearTakeSignals', 'onAutoResumed'],
  'setRecording': ['resetTake', 'startRecording'],
  'setLocked': ['resetTake', 'onLockCrossed'],
  'setInterrupted': ['clearTakeSignals', 'markInterrupted', 'resumeRecording', 'onAutoResumed'],
  'setSeconds': ['clearTakeSignals', 'onCapturedMs'],
  'setGapNote': ['clearTakeSignals', 'onAutoResumed'],
};
{
  const strays = [];
  for (const [field, allowed] of Object.entries(APPROVED_WRITERS)) {
    const re = field.endsWith('.current')
      ? new RegExp(`${field.replace('.', '\\.')}\\s*=[^=]`, 'g')
      : new RegExp(`\\b${field}\\(`, 'g');
    for (const m of chat.matchAll(re)) {
      const where = scopeOf(m.index);
      if (!allowed.includes(where)) strays.push(`${field} written in ${where}`);
    }
  }
  step('no take-scoped field is written outside its approved writers (subset drift cannot grow back)',
    strays.length === 0,
    strays.length ? `STRAY: ${[...new Set(strays)].join(' | ')}` : `${Object.keys(APPROVED_WRITERS).length} fields checked`);
}

// ---- B.6 THE ENTRY IS NOT AN EXIT -----------------------------------------
step('the start SUCCESS path does NOT call resetTake (it would clear the take it just claimed)',
  !/clearTakeSignals\(\)[\s\S]{0,400}?resetTake\(\)[\s\S]{0,200}?return true;/.test(fnBody(chat, 'startRecording')?.body || ''));

step('item 2 is self-contained — resetTake touches no recorder API and no watch symbol',
  !!resetTake && !/recorder\.|useRecorderWatch|onEncodeError/.test(resetTake.body));

// ===========================================================================
// SECTION C — ITEM 3: the prepared-handle release.
// components/ChatInput.tsx. Fixes the Android symptom on its own; depends on
// nothing in items 1 or 2.
// ===========================================================================
console.log('');
console.log('== C. PREPARED-HANDLE RELEASE (components/ChatInput.tsx) ==');

const release = fnBody(chat, 'releaseAbandonedRecorder');
step('a release helper exists', !!release);

if (release) {
  // Derived from expo-audio, not guessed: AudioModule.kt binds stop() to
  // AudioRecorder.stopRecording(), whose `finally { reset() }` is the ONLY
  // reachable path that clears `recorder`/`isPrepared` — the four fields
  // prepareRecording() throws on.
  step('the release call is recorder.stop() — the only JS call that reaches expo-audio reset()',
    /await\s+recorder\.stop\(\)/.test(release.body));

  // Matched on the CALL, not on `recorder.` — an `(recorder as any).remove()`
  // cast is exactly how this would be smuggled back in, and it is the same
  // mistake with a type assertion in front of it.
  step('it is NOT release()/remove() — destroying the SharedObject breaks every later call',
    !/\b(release|remove)\s*\(/.test(release.body));

  step('the release is AWAITED (an unawaited stop() would be an unhandled rejection)',
    /await\s+recorder\.stop\(\)/.test(release.body));

  // "Handle the case where the release itself throws — that must not become a
  // new swallowed failure." On Android the throw is EXPECTED and means the
  // release worked; it is logged with its call site rather than dropped.
  const cat = /catch\s*\((\w+)\)\s*\{([\s\S]*?)\}\s*$/.exec(release.body.trim());
  step('a throw from the release is caught', !!cat);
  step('the catch is not silent — it logs, with the call site',
    !!cat && /console\.(log|warn)/.test(cat[2]) && /\$\{where\}/.test(release.body),
    'an empty catch here would be the same swallow that hid the original bug');
  step('the release names WHERE it was called from (so the log identifies the abort path)',
    /releaseAbandonedRecorder\(\s*where/.test(`releaseAbandonedRecorder(where`) && /where:\s*string/.test(chat.slice(release.start - 120, release.start)));
}

// ---- C.1 EVERY POST-PREPARE ABORT RELEASES — DERIVED ----------------------
// Split startRecording at prepareToRecordAsync(). Everything after it can be
// reached with the handle prepared, so every return there must release first.
// A new abort added below prepare fails this until it does.
{
  const fn = fnBody(chat, 'startRecording');
  const prep = fn ? fn.body.indexOf('prepareToRecordAsync(') : -1;
  step('prepareToRecordAsync() is located inside startRecording', prep > -1);
  if (fn && prep > -1) {
    // Same dominance rule as B.4: the release must sit on the path this
    // return actually took, not in a sibling branch.
    const post = fn.body.slice(prep);
    const rets = scanOccurrences(post, /\breturn\b[^;]*;/g);
    const rels = scanOccurrences(post, /releaseAbandonedRecorder\(/g);
    const bad = rets
      .filter((r) => !/return true;/.test(r.text))
      .filter((r) => !rels.some((c) => dominates(c, r)))
      .map((r) => r.text);
    step(`every POST-prepare abort releases the handle before returning (${rets.length} returns below prepare)`,
      bad.length === 0, bad.length ? `NO DOMINATING RELEASE: ${bad.join(' | ')}` : 'covered');

    // The pre-prepare aborts must NOT release — calling stop() there is
    // pointless noise, and if they DID it would mean the split above is
    // meaningless and the assertion is not actually testing anything.
    const pre = fn.body.slice(0, prep);
    step('the PRE-prepare aborts do not release (so the split above is a real boundary)',
      !/releaseAbandonedRecorder\(/.test(pre),
      `${[...pre.matchAll(/\breturn false;/g)].length} pre-prepare aborts`);
  }
}

step('the startRecording catch releases too — record() can throw with the handle prepared',
  /catch\s*\(err\)[\s\S]{0,600}?releaseAbandonedRecorder\(/.test(fnBody(chat, 'startRecording')?.body || ''));

step('item 3 is self-contained — the release helper does not call resetTake',
  !!release && !/resetTake\(\)/.test(release.body));

// ===========================================================================
// SECTION D — ccfe8cb MUST NOT REGRESS: a LOCKED recording survives a
// released hold. resetTake clears holdActiveRef and `locked`, so this is the
// behaviour most at risk from item 2.
// ===========================================================================
console.log('');
console.log('== D. LOCKED RECORDING SURVIVES A RELEASED HOLD (ccfe8cb) ==');

const onEnd = (() => {
  const i = chat.indexOf('.onEnd(');
  return i === -1 ? null : blockAt(chat, chat.indexOf('=>', i));
})();
step("the pan's onEnd is located", !!onEnd);
if (onEnd) {
  const lockIdx = onEnd.body.indexOf('lockArmedSV.value === 1');
  const lockBranch = lockIdx === -1 ? null : blockAt(onEnd.body, lockIdx);
  step('onEnd has a locked branch that RETURNS', !!lockBranch && /return;/.test(lockBranch.body));
  step('the locked branch calls NEITHER finalize NOR cancel — the take outlives the finger',
    !!lockBranch && !/callFinalizeAndSend|callCancelRecording|resetTake/.test(lockBranch.body),
    'a reset here would end the hands-free recording the moment the finger lifted');
}

step('onLockCrossed does not touch holdActiveRef (a lock keeps the hold claimed — ccfe8cb)',
  !/holdActiveRef/.test(fnBody(chat, 'onLockCrossed')?.body || ''));
step('onLockCrossed does not reset the take',
  !/resetTake\(\)|clearTakeSignals\(\)/.test(fnBody(chat, 'onLockCrossed')?.body || ''));

// The start ENTRY must not clear these two, or a lock crossed while the start
// was still awaiting would be dropped and the recorder stranded.
{
  const fn = fnBody(chat, 'startRecording');
  const entryIdx = fn ? fn.body.indexOf('clearTakeSignals()') : -1;
  const entry = entryIdx > -1 ? fn.body.slice(entryIdx, fn.body.indexOf('return true;', entryIdx)) : '';
  step('the start ENTRY clears neither holdActiveRef nor `locked`',
    entryIdx > -1 && !/holdActiveRef\.current\s*=\s*false/.test(entry) && !/setLocked\(false\)/.test(entry),
    'a lock crossed during the start awaits must survive into the take');
}

step('clearTakeSignals (which the ENTRY calls) never touches ownership state',
  !!clearSignals && !/holdActiveRef|setLocked|recordingRef|startPromiseRef/.test(clearSignals.body),
  'this is what makes it safe to share between entry and exit');

// ===========================================================================
// SECTION E — BLAST RADIUS. Three independent changes, two files, and one
// frozen path that must be untouched.
// ===========================================================================
console.log('');
console.log('== E. BLAST RADIUS ==');

step('CRISIS IS UNTOUCHED — neither changed file names the crisis path',
  !/crisisGated|crisisAcking|CrisisResourcesCard|crisis_detected/.test(chatSrc)
  && !/crisis/i.test(watchSrc));

step('the crisis gate still swaps ChatInput out rather than re-keying it',
  /crisisGated \? \(/.test(idxSrc) && !/<ChatInput[\s\S]{0,200}key=/.test(idxSrc),
  'ChatInput is not remounted in normal chat use — which is why a stuck latch was terminal');

step('the three changes name each other nowhere — each stands alone',
  // item 1 lives only in the watch; items 2 and 3 only in ChatInput; and
  // neither ChatInput helper reaches into the watch's internals.
  !/stoppingRef\.current\s*\)\s*return;/.test(chat)
  && !/addListener\(/.test(chat)
  && !/resetTake|releaseAbandonedRecorder/.test(watchSrc));

console.log('');
if (pass) {
  console.log(`ALL GREEN — ${ran} checks passed`);
} else {
  console.log(`FAILURES (${failures.length}/${ran}):`);
  failures.forEach((f) => console.log(`  FAILED: ${f}`));
  process.exitCode = 1;
}
