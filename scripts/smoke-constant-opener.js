// Smoke for THE CONSTANT SESSION OPENER.
//
// Replaces scripts/smoke-explore-first-session-handoff.js (~1740 lines), which
// was almost entirely an assertion suite for the DYNAMIC greeting: the length
// cap, the structural JSON-leak guards, the tense-separated part-label refs,
// the counted opener gate, the first-session handoff, the contextual chips.
// The founder killed the dynamic greeting; that machinery is deleted, so those
// assertions have nothing left to assert. The handful of checks in it that
// covered something OTHER than the greeting are carried over here — the
// first-session status contract, the one-attempt rule on the boot critical
// path, the fail-toward-first-ever derivation, the chip fallback, and the boot
// promise's finally.
//
// Boots nothing and imports nothing. Every assertion slices SHIPPED SOURCE
// (app/(tabs)/index.tsx, services/api.ts, components/ConversationStarters.tsx)
// and, where it can, evaluates the real expressions lifted out of it, so
// nothing here can drift from what actually runs. The server is never
// contacted and server.js is never required — requiring it would connect to
// production Postgres.
//
// THE INVARIANT THIS FILE EXISTS TO HOLD:
//
//   The opening bubble has exactly TWO possible values, both compile-time
//   constants in index.tsx, on BOTH threads, for EVERY cohort:
//     ORIENTATION_MESSAGE — first-ever session
//     STANDARD_OPENER     — everyone else
//   Nothing off the wire, no template interpolation, no clock, no counter.
//   No cohort is told about a prior session, a session count, or a date.
//
// The bulk of what follows is therefore ABSENCE checks. That is deliberate:
// the greeting grew back four times because each round left a hook in place
// "just in case", and an absence check is the only kind that notices a hook
// being re-added.
//
// Run: node scripts/smoke-constant-opener.js

const fs = require('fs');
const path = require('path');

const NATIVE = path.resolve(__dirname, '..');
const idxPath = path.join(NATIVE, 'app', '(tabs)', 'index.tsx');
const apiPath = path.join(NATIVE, 'services', 'api.ts');
const chipPath = path.join(NATIVE, 'components', 'ConversationStarters.tsx');

let pass = true;
let ran = 0;
const failures = [];
function step(n, label, ok, extra) {
  ran++;
  console.log(`STEP ${n} — ${label}: ${ok ? 'OK' : 'FAIL'}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { pass = false; failures.push(`${n} ${label}${extra ? ` — ${extra}` : ''}`); }
}
function note(msg) { console.log(`  ..  ${msg}`); }

for (const p of [idxPath, apiPath, chipPath]) {
  if (!fs.existsSync(p)) {
    console.log(`RESULT: FAIL — client source not found: ${p}`);
    process.exit(1);
  }
}
const idxSrc = fs.readFileSync(idxPath, 'utf8');
const apiSrc = fs.readFileSync(apiPath, 'utf8');
const chipSrc = fs.readFileSync(chipPath, 'utf8');

// NB: no `\n` anchors in any regex below — this checkout is CRLF, so `;\n`
// never matches and an assertion would silently vanish rather than fail.

// Structural counts must not trip on prose that merely NAMES a deleted symbol:
// the comments in index.tsx explain what was removed and why, in English, and
// they spell out `capGreeting`, `getReturningGreeting`, `bootGreetingReady`.
// Those comments are the record of this decision and must survive. Drop
// whole-line comments before counting; a trailing comment after real code is
// left alone (and never contains call syntax here).
const codeOnly = (src) => src.split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const idxCode = codeOnly(idxSrc);
const apiCode = codeOnly(apiSrc);

// Extract `const <name> = <expr>;`, where the expression may span lines.
// Stops at the first semicolon that is not inside a string, template or
// bracket.
function extractAssignment(src, name, from) {
  // Tolerates a TypeScript annotation between the name and the `=`
  // (`const FALLBACK_STARTERS: string[] = [...]`).
  const decl = new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*`, 'g');
  decl.lastIndex = from || 0;
  const m = decl.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  const startExpr = i;
  let depth = 0, q = null, tpl = 0;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '`') { tpl = tpl ? 0 : 1; continue; }
    if (tpl) continue;
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(startExpr, i).trim();
  }
  return null;
}

// Brace-match a block starting at `decl`.
function sliceBlock(src, decl) {
  const start = src.indexOf(decl);
  if (start === -1) return null;
  let depth = 0, i = src.indexOf('{', start), started = false;
  for (; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

function compile(expr, params) {
  return new Function(...params, `return (${expr});`);
}

const stripTypes = (s) => s
  .replace(/:\s*boolean\s*\|\s*undefined/g, '')
  .replace(/:\s*string\s*\|\s*null/g, '')
  .replace(/:\s*string/g, '')
  .replace(/:\s*any/g, '');

const norm = (s) => (s == null ? s : String(s).replace(/\s+/g, ' ').trim());

// ===========================================================================
// PART 1 — THE TWO CONSTANTS, AND THE SELECTOR
// ===========================================================================

const orientationExpr = extractAssignment(idxSrc, 'ORIENTATION_MESSAGE');
const standardExpr = extractAssignment(idxSrc, 'STANDARD_OPENER');
step(1, 'both opener constants exist at module scope',
  !!orientationExpr && !!standardExpr,
  `orientation=${orientationExpr ? 'yes' : 'NO'} standard=${standardExpr ? 'yes' : 'NO'}`);

let ORIENTATION = null, STANDARD = null;
if (orientationExpr && standardExpr) {
  ORIENTATION = compile(orientationExpr, [])();
  STANDARD = compile(standardExpr, [])();
  step(1.1, 'both are plain string literals — no concatenated variable, no template hole',
    typeof ORIENTATION === 'string' && typeof STANDARD === 'string'
      && !/\$\{/.test(orientationExpr) && !/\$\{/.test(standardExpr)
      && !/[A-Za-z_$][\w$]*\s*\+/.test(orientationExpr.replace(/"(?:[^"\\]|\\.)*"/g, '""'))
      && !/[A-Za-z_$][\w$]*\s*\+/.test(standardExpr.replace(/"(?:[^"\\]|\\.)*"/g, '""')),
    `orientation=${ORIENTATION.length}ch standard=${STANDARD.length}ch`);

  // The bar the founder set: no cohort gets anything asserting a prior
  // session, a session count, or a date. Checked on the STRINGS, not on the
  // code that picks them, because this is the claim a user actually reads.
  const BOUNDARY_CLAIMS = [
    /last time/i, /when we (?:last )?spoke/i, /since you (?:were|last)/i,
    /welcome back/i, /good to see you again/i, /previous session/i,
    /\blast session\b/i, /we just (?:mapped|named)/i, /\byesterday\b/i,
    /\bearlier today\b/i, /\bthis week\b/i, /\bsessions?\b.*\bago\b/i,
    /picking up (?:where|with)/i, /\bagain\b/i,
  ];
  const offenders = [];
  for (const s of [['ORIENTATION_MESSAGE', ORIENTATION], ['STANDARD_OPENER', STANDARD]]) {
    for (const re of BOUNDARY_CLAIMS) if (re.test(s[1])) offenders.push(`${s[0]} ~ ${re}`);
  }
  step(1.2, 'NEITHER constant asserts a prior session, a count or a date',
    offenders.length === 0, offenders.join('; ') || `${BOUNDARY_CLAIMS.length} patterns checked`);
}

// The selector is the single choke point. If it lifts and runs, and it returns
// only these two constants across every input the flag can hold, then the
// opener is provably a constant for every cohort — there is no third answer to
// find by reading call sites.
const selectorSrc = sliceBlock(idxSrc, 'function openerFor(');
step(2, 'the opener selector exists and lifts', !!selectorSrc,
  selectorSrc ? `len=${selectorSrc.length}` : 'not found');

if (selectorSrc && ORIENTATION && STANDARD) {
  const openerFor = new Function('ORIENTATION_MESSAGE', 'STANDARD_OPENER',
    `${stripTypes(selectorSrc)}; return openerFor;`)(ORIENTATION, STANDARD);
  step(2.1, 'the selector lifts as a function', typeof openerFor === 'function');

  // Every value `firstSessionPending: boolean | undefined` can hold, plus the
  // shapes a future refactor could accidentally pass.
  const inputs = [true, false, undefined, null, 0, 1, '', 'true', {}, []];
  const results = inputs.map((v) => openerFor(v));
  const outsideTheSet = results.filter((r) => r !== ORIENTATION && r !== STANDARD);
  step(2.2, 'EVERY input maps to one of the two constants — no third value exists',
    outsideTheSet.length === 0,
    outsideTheSet.length ? `escaped: ${JSON.stringify(outsideTheSet)}` : `${inputs.length} inputs`);

  step(2.3, 'only firstSessionPending===true gets the orientation; everything else is standard',
    openerFor(true) === ORIENTATION
      && openerFor(false) === STANDARD
      && openerFor(undefined) === STANDARD,
    'true→orientation, false/undefined→standard');

  step(2.4, 'the selector is PURE — no ref, no state, no fetch, no clock',
    !/\.current/.test(selectorSrc)
      && !/\bapi\./.test(selectorSrc)
      && !/\bawait\b/.test(selectorSrc)
      && !/\bDate\b/.test(selectorSrc)
      && !/use[A-Z]/.test(selectorSrc),
    'body is one ternary over one boolean');

  // A first-ever user must NEVER get a blank bubble or a callback. Both halves
  // of the founder's floor, asserted on the real function.
  step(2.5, 'a first-ever user gets ORIENTATION_MESSAGE, never blank',
    openerFor(true) === ORIENTATION && ORIENTATION.trim().length > 100,
    `${ORIENTATION.length}ch`);
}

// ===========================================================================
// PART 2 — EVERY OPENER PLACEMENT GOES THROUGH THE SELECTOR
// ===========================================================================
// The invariant is only worth anything if no call site builds its own string.
// There are four places that push an opening assistant bubble: boot (Process),
// the Explore seed effect, the End Session reset, and the resume-lock break.

const openerForCalls = (idxCode.replace(/function openerFor\(/, '').match(/openerFor\(/g) || []).length;
step(3, 'the selector is called at all four placement sites', openerForCalls === 4,
  `openerFor( × ${openerForCalls} calls (expected 4: boot, explore seed, end session, resume-lock break)`);

// Every assignment feeding an opening bubble must be `= openerFor(...)`. If a
// call site ever reintroduces a ladder — a ternary, a `||` fallback, a ref —
// this is where it shows up.
const openerAssignments = idxCode.match(/const\s+(?:opener|greeting|finalGreeting)\s*=\s*[^;]+;/g) || [];
const badAssignments = openerAssignments.filter((a) => !/=\s*openerFor\(/.test(a));
step(3.1, 'no opener assignment builds its own string — all are bare openerFor(...)',
  openerAssignments.length >= 4 && badAssignments.length === 0,
  badAssignments.length ? badAssignments.join(' | ') : `${openerAssignments.length} assignments, all via the selector`);

// ===========================================================================
// PART 3 — THE DYNAMIC MACHINERY IS GONE, NOT DISABLED
// ===========================================================================
// This is the part that matters in six months. Every symbol below existed for
// exactly one purpose — making a model-authored opening bubble safe — and a
// re-appearance means the dynamic greeting is coming back with it.

const DEAD = [
  // the fetch itself
  ['getReturningGreeting', 'the returning-greeting API method'],
  ['returning-greeting', 'the returning-greeting endpoint path'],
  // the length cap + structural leak guards
  ['capGreeting', 'the opener length cap'],
  ['OPENER_MAX_CHARS', 'the opener length ceiling'],
  ['capPartLabel', 'the part-label cap'],
  ['RECENT_PART_LABEL_MAX_CHARS', 'the part-label ceiling'],
  ['topPartLabel', 'the part-label derivation'],
  // the opener sources
  ['exploreGreetingRef', 'the server-callback ref'],
  ['mostRecentPartRef', 'the "last time we explored X" ref'],
  ['sameSessionPartRef', 'the same-session part ref'],
  ['starterMapSameSessionRef', 'the same-session flag'],
  ['SAME_SESSION_EXPLORE_OPENER', 'the same-session opener constant'],
  // the gate
  ['openerGateHolds', 'the opener-gate hold count'],
  ['bootGreetingReady', 'the readiness flag'],
  ['withExploreOpenerGate', 'the opener gate helper'],
  ['refreshBoundaryOpenerSources', 'the boundary refresh'],
  ['releaseBootHold', 'the boot hold release'],
  ['bootHoldReleasedRef', 'the boot hold idempotence ref'],
  // the handoff
  ['completeFirstSession', 'the first-session handoff'],
  ['firstSessionHandoffRef', 'the handoff one-shot'],
  // the chips
  ['setStarters', 'the contextual-chip setter'],
  // the old process fallback, which only existed because the fetch could fail
  ['FALLBACK_GREETING', 'the transport-failure greeting'],
];
const resurrected = [];
for (const [sym, what] of DEAD) {
  const re = new RegExp(sym.replace(/[-]/g, '\\-'));
  if (re.test(idxCode)) resurrected.push(`index.tsx: ${sym} (${what})`);
  if (re.test(apiCode)) resurrected.push(`api.ts: ${sym} (${what})`);
}
step(4, 'NONE of the dynamic-greeting machinery survives in shipped code',
  resurrected.length === 0,
  resurrected.length ? resurrected.join('; ') : `${DEAD.length} symbols checked in 2 files`);

// The comments that record WHY it was removed must survive — they are the only
// thing standing between the next reader and rebuilding it. Assert against the
// raw source (comments included) that the decision is still documented.
step(4.1, 'the removal is still documented in prose (the record survives the code)',
  /THE OPENING BUBBLE IS A CONSTANT/.test(idxSrc)
    && /getReturningGreeting is GONE/.test(apiSrc),
  'index.tsx block comment + api.ts note present');

// Nothing may fetch a greeting under a new name either. The screen is allowed
// exactly the two boot calls plus the map/session calls it already had; assert
// no api method with "greet" in its name is reachable from anywhere.
step(4.2, 'no api method with "greet" in its name exists at all',
  !/\bgreet[A-Za-z]*\s*[(:]/i.test(apiCode) && !/api\.[A-Za-z]*[Gg]reet/.test(idxCode),
  'no greeting method on the api surface');

// ===========================================================================
// PART 4 — THE EXPLORE SEED EFFECT
// ===========================================================================
// Carried over in spirit from the old PART 5: the seed effect's guards are the
// only thing between a mode toggle and an empty Explore thread. The readiness
// gate is gone; the first-session guard is not, and must still return WITHOUT
// latching so the effect re-runs when the flag lands.

// sliceBlock stops at the arrow body's closing brace, so the dep array sits
// just past it — take a window from the section marker to the section that
// follows, which contains both.
const seedIdx = idxSrc.indexOf('===== EXPLORE OPENING BUBBLE =====');
const seedWindow = seedIdx === -1 ? null : idxSrc.slice(seedIdx, idxSrc.indexOf('Manual keyboard-height lift', seedIdx));
const seedEffect = seedIdx === -1 ? null : codeOnly(sliceBlock(idxSrc.slice(seedIdx), 'useEffect(') || '');
step(5, 'the Explore seed effect is located', !!seedEffect && !!seedWindow,
  seedEffect ? `len=${seedEffect.length}` : 'not found');

if (seedEffect) {
  const guards = (seedEffect.match(/if \([^)]*\) return;/g) || []).map(norm);
  step(5.1, 'the first-session guard returns BEFORE the latch is set',
    seedEffect.indexOf('firstSessionPending === undefined') < seedEffect.indexOf('exploreGreetedRef.current = true')
      && /if \(firstSessionPending === undefined\) return;/.test(norm(seedEffect)),
    `${guards.length} guards, latch after all of them`);

  step(5.2, 'the effect re-runs when the flag lands — firstSessionPending is a dep',
    /\}, \[chatMode, firstSessionPending\]\)/.test(norm(codeOnly(seedWindow))),
    'deps = [chatMode, firstSessionPending]');

  step(5.3, 'the effect awaits nothing and fetches nothing',
    !/\bawait\b/.test(seedEffect) && !/\bapi\./.test(seedEffect) && !/async/.test(seedEffect),
    'fully synchronous');

  // The old effect had a five-rung ladder. A second ternary here is the shape
  // that grows one back.
  const ternaries = (seedEffect.match(/\?/g) || []).length;
  step(5.4, 'no opener ladder — the seed effect branches on nothing of its own',
    ternaries <= 1, `${ternaries} '?' in the effect body (the one in the log line)`);
}

// The latch itself SURVIVES the revert and is not greeting machinery: it is
// the synchronous guard against double-seeding, since setExploreMessages is
// async and the length check can still read stale on a same-batch re-run.
//
// It must never be RE-ARMED. The old design cleared the Explore thread at a
// boundary, re-armed this ref and let the seed effect refill it — which only
// worked because the gate's hold count was a third dep and flipped 0→1→0 on
// every boundary. With the gate gone, a session that ENDED in Explore re-sets
// chatMode to the value it already had, no dep changes, the effect never fires
// and the thread stays empty for the whole next session. Both boundary resets
// therefore seed both threads by hand and leave this true.
step(5.5, 'the seed latch is never re-armed — every emptier of the thread refills it',
  !/exploreGreetedRef\.current = false/.test(idxCode)
    && (idxCode.match(/exploreGreetedRef\.current = true/g) || []).length === 4,
  `${(idxCode.match(/exploreGreetedRef\.current = true/g) || []).length} set-true sites (seed effect, resume consumer, End Session, resume-lock break), 0 re-arms`);

// ===========================================================================
// PART 5 — THE BOUNDARY RESETS ARE SYNCHRONOUS
// ===========================================================================
// The opener gate existed because both boundary resets did:
//   re-arm the latch → publish a state change → AWAIT a fetch → write refs
// and the await always yielded, letting the seed effect run and latch on stale
// refs. With the fetch gone the shape must be gone too. An await reappearing
// between the re-arm and the opener is the exact defect, and there is no gate
// left to catch it.

// codeOnly on both slices: the comments here NARRATE the deleted shape
// ("then AWAITED a fresh /api/returning-greeting"), and that prose is the
// record of why the gate existed. Counting it as code would fail the very
// assertions it explains.
const continuation = codeOnly(sliceBlock(idxSrc, 'continueAfterSummaryRef.current = async () => {') || '');
step(6, 'the End Session continuation is located', !!continuation,
  continuation ? `len=${continuation.length}` : 'not found');

// Both resets must: source the opener from the selector, fill BOTH threads
// (bubbles AND wire history), and do it with nothing awaited in between.
function assertBoundaryReset(n, label, block) {
  const openerAt = block.indexOf('openerFor(');
  const lastFill = Math.max(block.lastIndexOf('exploreHistoryRef.current = ['),
    block.lastIndexOf('processHistoryRef.current = ['));
  const between = openerAt >= 0 && lastFill > openerAt ? block.slice(openerAt, lastFill) : null;
  step(n, `${label}: nothing is awaited between the opener and the last thread fill`,
    between !== null && !/\bawait\b/.test(between),
    between === null ? 'ordering not found' : `${between.length}ch between, no await`);
  step(`${n}a`, `${label}: the opener comes from the selector, never from a payload`,
    /const greeting = openerFor\(firstSessionPending\);/.test(block) && !/\bapi\./.test(block),
    'greeting = openerFor(firstSessionPending), no api call in the block');
  // THE REGRESSION THIS CATCHES: leaving the Explore thread empty and relying
  // on the seed effect to refill it. The effect's deps cannot be trusted to
  // change at a boundary (End Session re-sets chatMode to 'explore' when the
  // session already ended in Explore), so both threads are filled here.
  step(`${n}b`, `${label}: BOTH threads get a bubble AND wire history`,
    /setProcessMessages\(\[\{ id: uuidv4\(\), role: 'assistant', text: greeting \}\]\)/.test(block)
      && /setExploreMessages\(\[\{ id: uuidv4\(\), role: 'assistant', text: greeting \}\]\)/.test(block)
      && /processHistoryRef\.current = \[\{ role: 'assistant', content: greeting \}\]/.test(block)
      && /exploreHistoryRef\.current = \[\{ role: 'assistant', content: greeting \}\]/.test(block),
    'process + explore, messages + history');
  step(`${n}c`, `${label}: the latch is left TRUE (the thread it guards is non-empty)`,
    /exploreGreetedRef\.current = true/.test(block) && !/exploreGreetedRef\.current = false/.test(block));
}

if (continuation) assertBoundaryReset(6.1, 'End Session', continuation);

const modeChange = codeOnly(sliceBlock(idxSrc, 'function handleModeChange(') || '');
step(7, 'the resume-lock break is located', !!modeChange);
if (modeChange) assertBoundaryReset(7.1, 'resume-lock break', modeChange);

// ===========================================================================
// PART 6 — BOOT (carried over from the old PARTS 7 + 10)
// ===========================================================================
// Two things here are NOT greeting machinery and survive the revert:
//   - the fail-toward-first-ever derivation, which decides ORIENTATION vs
//     STANDARD and is the one thing a genuinely new user cannot be denied;
//   - the promise's .catch/.finally, because setTyping(false) sits behind an
//     await and a throw in the synchronous derivation after it would otherwise
//     leave the app spinning forever on an empty thread. That is a real
//     blank-launch path with no greeting in it.

const bootIdx = idxSrc.indexOf('// ===== BOOT =====');
const bootEffect = bootIdx === -1 ? null : sliceBlock(idxSrc.slice(bootIdx), 'useEffect(');
step(8, 'the boot effect is located', !!bootEffect, bootEffect ? `len=${bootEffect.length}` : 'not found');

if (bootEffect) {
  const bootCode = codeOnly(bootEffect);
  step(8.1, 'boot fetches exactly two things, and neither is a greeting',
    /api\.getLatestMap\(\)/.test(bootCode)
      && /api\.getFirstSessionStatus\(\)/.test(bootCode)
      && (bootCode.match(/api\.[A-Za-z]+\(/g) || []).length === 2,
    (bootCode.match(/api\.[A-Za-z]+\(/g) || []).join(', '));

  // Carried from old STEP 21.1: ONE attempt. This sits on the critical path of
  // a blank app; a retry here is added directly to launch latency.
  step(8.2, 'the first-session status is called exactly once — no retry on the critical path',
    (idxCode.match(/getFirstSessionStatus\(/g) || []).length === 1,
    'one call site, inside the boot Promise.all');

  // Carried from old STEP 23.x / 22: the derivation reads the STATUS and
  // nothing else. A map-content fallback ("infer returning from parts rows")
  // cannot hold — parts rows exist through the back half of every first
  // session — and must not come back.
  step(8.3, 'the first-ever derivation reads the status payload and nothing else',
    /const isFirstSession = firstStatus\?\.completedAt == null;/.test(bootCode)
      && !/hasReturningEvidence/.test(bootCode)
      && !/isFirstSession = [^;]*\bmap\b/.test(bootCode),
    'isFirstSession = firstStatus?.completedAt == null');

  // Carried from old STEP 23.2: an unresolved status keeps the user on the
  // orientation. Replayed on the real expression.
  const derivFn = compile('(firstStatus) => (firstStatus?.completedAt == null)', []);
  const deriv = derivFn();
  step(8.4, 'a RESOLVED status is believed, both ways',
    deriv({ completedAt: null, ok: true }) === true
      && deriv({ completedAt: '2026-01-01', ok: true }) === false,
    'completedAt drives it when the endpoint answered');
  step(8.5, 'an UNRESOLVED status FAILS TOWARD FIRST-EVER (orientation, not a cold open)',
    deriv({ completedAt: null, ok: false }) === true,
    'placeholder → isFirstSession true → ORIENTATION_MESSAGE');

  // The publish must sit immediately after the try/catch with nothing that can
  // throw in between: it is the only thing standing between a mode toggle and
  // a permanently empty Explore thread (the seed effect's sole remaining
  // guard is `firstSessionPending === undefined`).
  const catchEnd = bootCode.indexOf("console.warn('[chat] boot fetch failed:");
  const publishAt = bootCode.indexOf('setFirstSessionPending(isFirstSession)');
  const derivAt = bootCode.indexOf('const md =');
  step(8.6, 'firstSessionPending is published BEFORE any map/mode derivation',
    catchEnd >= 0 && publishAt > catchEnd && derivAt > publishAt,
    'publish sits between the catch and the derivation');

  // Carried from old STEP 27.3, re-pointed at what it is actually for now.
  const tail = bootEffect.slice(bootEffect.lastIndexOf('})()'));
  step(8.7, 'the boot promise has BOTH a .catch and a .finally',
    /\.catch\(/.test(tail) && /\.finally\(/.test(tail),
    'catch + finally present on the async IIFE');
  step(8.8, 'the finally clears the typing spinner on EVERY exit path',
    /\.finally\(\(\) => \{[\s\S]*setTyping\(false\);[\s\S]*\}\)/.test(tail),
    'setTyping(false) in the finally — the surviving blank-launch guard');
  step(8.9, 'the finally does nothing else — the boot-hold release is gone with the gate',
    !/setOpenerGateHolds/.test(tail) && !/releaseBootHold/.test(tail),
    'spinner only');
}

// ===========================================================================
// PART 7 — THE CHIPS ARE STATIC (carried from the old PART 8)
// ===========================================================================
// The chips were the THIRD field off the same model completion, written under
// the prompt rule "grounded in the last session's themes… one that reconnects
// to a theme from before". Rendered directly under the opening bubble, they
// were a boundary claim in chip form. They must now come from
// ConversationStarters' own list and from nowhere else.

step(9, 'the Chat tab passes NO starters prop — which selects FALLBACK_STARTERS',
  /<ConversationStarters onPick=\{handleSend\} \/>/.test(idxCode)
    && !/starters=\{/.test(idxCode),
  'ConversationStarters onPick={handleSend}');

step(9.1, 'no starter list was invented in the screen — the source is one file over',
  !/STARTERS/.test(idxCode) && !/\bstarters\b/.test(idxCode),
  'no chip strings and no chip state in index.tsx');

const fallbackExpr = extractAssignment(chipSrc, 'FALLBACK_STARTERS');
step(9.2, 'ConversationStarters still owns FALLBACK_STARTERS', !!fallbackExpr);
if (fallbackExpr) {
  const FALLBACK = compile(fallbackExpr.replace(/^:\s*string\[\]\s*=\s*/, ''), [])();
  step(9.3, 'the fallback list is non-empty and present-tense',
    Array.isArray(FALLBACK) && FALLBACK.length >= 3
      && FALLBACK.every((s) => typeof s === 'string' && s.trim())
      && !FALLBACK.some((s) => /last time|again|since|previous|we (?:just|spoke)/i.test(s)),
    `${FALLBACK.length} chips, none asserting a prior sitting`);

  // Carried from old STEP 24.2: an empty/absent array must fall through to
  // this list rather than rendering nothing.
  step(9.4, 'an absent or empty starters prop falls through to that list',
    /const items = starters && starters\.length > 0 \? starters : FALLBACK_STARTERS;/.test(chipSrc),
    'absent → FALLBACK_STARTERS');
}

// ===========================================================================
// PART 8 — WHOLE-COHORT SWEEP
// ===========================================================================
// The founder's requirement, restated as an executable claim: enumerate every
// cohort and every thread, and assert the set of strings the app can open with
// has exactly two members.

if (ORIENTATION && STANDARD && selectorSrc) {
  const openerFor = new Function('ORIENTATION_MESSAGE', 'STANDARD_OPENER',
    `${stripTypes(selectorSrc)}; return openerFor;`)(ORIENTATION, STANDARD);

  // Third column is what this cohort MUST get. Enumerating the cohort is only
  // half the claim; the other half is that the right one of the two constants
  // reaches it.
  //
  // The 7th row used to be ['returning user, status unresolved at a boundary',
  // undefined] — UNREACHABLE, and it hid a reachable case behind itself.
  // firstSessionPending can never be undefined at a boundary: boot publishes it
  // on EVERY path including transport failure (setFirstSessionPending is the
  // first write after the derivation, ahead of all map/mode work), and both
  // boundaries — End Session → Continue, and the resume-lock break — are user
  // actions that can only happen post-render. The genuinely interesting case is
  // the one below it: a RETURNING user whose boot status call failed. The
  // fail-toward-first-ever derivation gives him firstSessionPending === true, so
  // every opener he sees — boot, Explore seed, and both boundaries — is the
  // ORIENTATION message, not the standard one. That is the cost of failing
  // toward first-ever and it is accepted (re-orienting a returning user is the
  // mild wrong answer; hiding orientation from a genuinely new one is not). The
  // invariant is untouched: he still gets one of the two constants, the same one
  // on both threads, and never a blank thread.
  const cohorts = [
    ['first-ever user, status resolved', true, 'orientation'],
    ['first-ever user, status UNRESOLVED (fails toward first-ever)', true, 'orientation'],
    ['user mid-first-session who just hit STARTER_MAP_COMPLETE', false, 'standard'],
    ['returning user, boot', false, 'standard'],
    ['returning user, after End Session → Continue', false, 'standard'],
    ['returning user, after a resume-lock break', false, 'standard'],
    ['RETURNING user whose boot status FAILED — re-orientated, not greeted: '
      + 'fail-toward-first-ever hands him ORIENTATION at every boundary', true, 'orientation'],
  ];
  const seen = new Set();
  const rows = [];
  for (const [label, flag, expected] of cohorts) {
    // Both threads, same selector, same flag — that is the point.
    const processOpener = openerFor(flag);
    const exploreOpener = openerFor(flag);
    seen.add(processOpener); seen.add(exploreOpener);
    const got = processOpener === ORIENTATION ? 'orientation' : 'standard';
    rows.push([label, processOpener === exploreOpener, got, got === expected]);
  }
  const disagreed = rows.filter((r) => !r[1]);
  step(10, 'Process and Explore agree for EVERY cohort',
    disagreed.length === 0, disagreed.map((r) => r[0]).join('; ') || `${rows.length} cohorts`);
  step(10.1, 'the whole app can open with exactly TWO distinct strings',
    seen.size === 2, `${seen.size} distinct openers across ${rows.length} cohorts × 2 threads`);
  const wrongOne = rows.filter((r) => !r[3]);
  step(10.15, 'and each cohort gets the RIGHT one of the two',
    wrongOne.length === 0, wrongOne.map((r) => r[0]).join('; ') || `${rows.length} cohorts matched`);
  for (const r of rows) note(`${r[2].padEnd(11)} ← ${r[0]}`);

  step(10.2, 'no cohort is greeted with a callback, and none is left blank',
    [...seen].every((s) => typeof s === 'string' && s.trim().length > 40),
    'every reachable opener is a real, non-empty sentence');
}

// ===========================================================================
// PART 9 — THE ONE PATH OUT OF "EVERY COHORT GETS A BUBBLE"
// ===========================================================================
// The sweep above proves the SELECTOR always returns a real string. It cannot
// prove a bubble reaches the screen, and there is exactly one path where it
// does not — and it is not an opener path at all. It is the session-resume
// consumer.
//
// SessionDetailModal.handleContinue strips markers, trims, and filters empties
// before arming the handoff. A past session whose stored rows were all markers
// or whitespace therefore arms a VALID, EMPTY array. The consumer's guard only
// checked Array.isArray, so that payload got through and then: cleared BOTH
// threads, latched exploreGreetedRef true (so the seed effect will never
// refill Explore), set resumeLockedModeRef (which is what suppresses boot's
// opener) — and hydrated nothing. Result: a completely blank chat on both
// threads for the whole session, escapable only by toggling mode.
//
// Pre-existing, not a revert regression — but the revert is the thing that
// made "every cohort gets a bubble" the load-bearing claim, so it is asserted
// here, next to the sweep that states it.
const resumeStart = idxSrc.indexOf('===== PENDING SESSION RESUME CONSUMER =====');
const resumeEnd = resumeStart === -1 ? -1
  : idxSrc.indexOf('===== EXPLORE OPENING BUBBLE =====', resumeStart);
const resumeConsumer = resumeStart === -1 || resumeEnd === -1 ? null
  : codeOnly(idxSrc.slice(resumeStart, resumeEnd));
step(11, 'the session-resume consumer is located', !!resumeConsumer,
  resumeConsumer ? `len=${resumeConsumer.length}` : 'not found');

if (resumeConsumer) {
  step(11.1, 'an EMPTY resume payload is rejected — LENGTH, not just shape',
    /\|\| resume\.messages\.length === 0\) return;/.test(norm(resumeConsumer)),
    'guard includes resume.messages.length === 0');

  const consumeAt = resumeConsumer.indexOf('consumePendingSessionResume()');
  const returnAt = resumeConsumer.indexOf('return;');
  const clearAt = resumeConsumer.indexOf('setProcessMessages([])');
  const latchAt = resumeConsumer.indexOf('exploreGreetedRef.current = true');
  const lockAt = resumeConsumer.indexOf('resumeLockedModeRef.current = mode');
  step(11.2, 'the bail precedes every irreversible write it would otherwise cause',
    consumeAt >= 0 && returnAt > consumeAt
      && clearAt > returnAt && latchAt > returnAt && lockAt > returnAt,
    'return before the thread clears, the seed latch and the mode-lock');

  // Belt and braces: if the guard is ever weakened again, the three writes
  // above are what turn it into a blank screen. Assert they are still the
  // three, so a future one added ABOVE the guard cannot slip in unnoticed.
  step(11.3, 'the consumer still suppresses the boot opener (why an empty payload was fatal)',
    lockAt > 0 && /resumeLockedModeRef\.current = mode/.test(resumeConsumer)
      && /if \(!resumeLockedModeRef\.current\)/.test(codeOnly(bootEffect || '')),
    'resume lock set here, read by boot before it places the opener');
}

console.log('');
console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'} — ${ran} assertions run${failures.length ? `, ${failures.length} failed` : ''}`);
if (failures.length) failures.forEach((f) => console.log(`  FAILED: ${f}`));
process.exit(pass ? 0 : 1);
