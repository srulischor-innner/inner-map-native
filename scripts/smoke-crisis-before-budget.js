// ============================================================================
// smoke-crisis-before-budget.js
//
// REGRESSION TEST for a safety-critical invariant:
//
//     On EVERY chat transport in services/api.ts, a CRISIS response takes
//     precedence over a BUDGET refusal. If a single turn ever carries both
//     signals, the deterministic referral text must land on screen AND
//     onCrisis must fire (which gates the composer and surfaces the
//     resources card). A billing sheet can NEVER displace a crisis response.
//
// The server guarantees its crisis gate returns ahead of its budget gate.
// The client does not get to rely on that. This test is the client-side
// half of the guarantee.
//
// WHAT WENT WRONG (fixed; this test is the fence around the fix):
//   In the buffered `text/event-stream` fallback inside streamChat's JSON
//   path, the `if (budgetRaw)` branch returned BEFORE the crisis emission.
//   A turn carrying both frames rendered the billing sheet, dropped the
//   referral text, and never fired onCrisis — composer unlocked, resources
//   card hidden, on a turn the server had already classified as a crisis.
//
// ---------------------------------------------------------------------------
// HOW IT WORKS
//
// services/api.ts is TypeScript with React Native imports, so it cannot be
// require()d from plain Node. This test does NOT re-implement the logic
// (a mirror would drift silently). Instead it takes the REAL source text of
// the relevant blocks out of services/api.ts using unique anchors, strips
// the types with the repo's own TypeScript transpiler, and EXECUTES those
// blocks against stub callbacks. The budget parser used by those blocks is
// likewise the real `parseBudgetRefusal` lifted from the same file.
//
// Where a block cannot be lifted and run (branches keyed on an HTTP status,
// which are unreachable for a crisis turn by transport construction), the
// test falls back to STATIC assertions on the source text, plus tripwires
// that fire if someone later introduces a crisis signal into a branch that
// has no ordering defense.
//
// ---------------------------------------------------------------------------
// WHAT THIS TEST PROVES
//   • Buffered-SSE fallback: with BOTH a crisis frame and a budget frame in
//     one response body, in EITHER frame order, the real code fires onCrisis,
//     delivers the referral, and never fires onBudgetExhausted. (Executed.)
//   • Live XHR frame dispatcher (handleFrame/pump): once a crisis frame is
//     dispatched, the terminal latch stops every later frame in that stream,
//     so a trailing budget frame cannot displace it. (Executed.)
//   • Plain-JSON path: a body carrying crisis_detected plus budget markers
//     delivers the referral and gates. (Executed.)
//   • Budget-only turns on those same paths still raise the billing sheet —
//     so the crisis checks above are not passing because budget is broken.
//     (Executed. This is the anti-vacuity control.)
//   • The source ordering itself: crisis guard/emission lexically precedes
//     the budget branch on the buffered path, the crisis case sets the
//     terminal latch before emitting, and pump honors that latch. (Static —
//     these fail loudly if the branches are ever reordered.)
//
// WHAT THIS TEST DOES NOT PROVE
//   • Nothing about the SERVER's ordering. This is client-side only.
//   • Nothing about the screen. It does not verify that app/(tabs)/index.tsx
//     actually locks the composer or clears a pending refusal on onCrisis;
//     it only proves the callback fires with the referral in hand.
//   • The HTTP-402 branches (fetch path and XHR onload) are NOT executed.
//     A crisis turn is a 200 by server contract, so those branches are
//     unreachable for a crisis turn — the test asserts they remain
//     crisis-free rather than asserting an ordering they do not have.
//     If crisis handling is ever added there, check 12/13 fires.
//   • The live XHR dispatcher is order-DEPENDENT: it defends crisis-then-
//     budget (latch), not budget-then-crisis (a budget frame is terminal,
//     so a crisis frame written after it would be dropped). The server
//     never writes that sequence — it ends the stream on the budget frame.
//     The buffered path, by contrast, is order-independent. Check 4 pins
//     the property that is actually true; the residual is documented here
//     rather than asserted away.
//
// Run:  node scripts/smoke-crisis-before-budget.js
// Env:  API_TS=<path>  — analyze a different copy of api.ts (used to verify
//                        this test actually detects the bug, by pointing it
//                        at a scratch copy with the branches reordered).
// Exit: 0 = all green, 1 = any failure.
// No new dependencies — Node + the repo's existing `typescript`.
// ============================================================================

const fs = require('fs');
const path = require('path');

const API_TS = process.env.API_TS || path.join(__dirname, '..', 'services', 'api.ts');

let pass = true;
let passCount = 0;
let failCount = 0;

function step(n, label, ok, detail) {
  if (ok) {
    passCount += 1;
    console.log(`  [${String(n).padStart(2)}] PASS  ${label}`);
  } else {
    failCount += 1;
    pass = false;
    console.log(`  [${String(n).padStart(2)}] FAIL  ${label}`);
    if (detail) {
      for (const line of String(detail).split('\n')) console.log(`         ${line}`);
    }
  }
}

// ============================================================================
// Source extraction — unique anchors into services/api.ts.
// Every helper throws with a loud, specific message when an anchor moves,
// so a restructure of api.ts surfaces as a failure here rather than as a
// silently-skipped check.
// ============================================================================

function readSource() {
  if (!fs.existsSync(API_TS)) {
    throw new Error(`cannot find api.ts at ${API_TS}`);
  }
  // Normalize CRLF -> LF so multi-line anchors match regardless of how the
  // working copy was checked out.
  return fs.readFileSync(API_TS, 'utf8').replace(/\r\n/g, '\n');
}

/** Slice from `startAnchor` up to (not including) `endAnchor`, searching for
 *  endAnchor only after startAnchor. Both anchors must be present. */
function slice(src, startAnchor, endAnchor, name) {
  const a = src.indexOf(startAnchor);
  if (a === -1) throw new Error(`[${name}] start anchor not found in api.ts: ${JSON.stringify(startAnchor)}`);
  const b = src.indexOf(endAnchor, a + startAnchor.length);
  if (b === -1) throw new Error(`[${name}] end anchor not found after start in api.ts: ${JSON.stringify(endAnchor)}`);
  return src.slice(a, b);
}

/** Slice from `startAnchor` through the end of the line containing the FIRST
 *  `throughAnchor` that follows it (inclusive). */
function sliceThrough(src, startAnchor, throughAnchor, name) {
  const a = src.indexOf(startAnchor);
  if (a === -1) throw new Error(`[${name}] start anchor not found in api.ts: ${JSON.stringify(startAnchor)}`);
  const b = src.indexOf(throughAnchor, a + startAnchor.length);
  if (b === -1) throw new Error(`[${name}] through anchor not found after start in api.ts: ${JSON.stringify(throughAnchor)}`);
  const eol = src.indexOf('\n', b + throughAnchor.length);
  return src.slice(a, eol === -1 ? src.length : eol);
}

/** Build an executable module out of the lifted TypeScript blocks. */
function buildLiveModule(src) {
  const ts = require('typescript');

  // -- The REAL budget parser + its helper, verbatim. --------------------
  const asAction = slice(src, 'function asAction(raw: any,', '/** Normalise a budget refusal', 'asAction');
  const parser = slice(src, 'export function parseBudgetRefusal', 'export const api = {', 'parseBudgetRefusal')
    .replace(/^export /, '');

  // -- PATH 2: buffered text/event-stream fallback (inside runJson). ------
  //    From the frame-accumulator declarations through the final
  //    `cb.onError('empty reply'); return;`.
  const bufferedSse = sliceThrough(src, "let fullText = '';", "cb.onError('empty reply');", 'bufferedSse')
    + '\n      return;';

  // -- PATH 1: live XHR frame dispatcher — emitRateLimit / -----------------
  //    emitBudgetRefusal / handleFrame / pump, verbatim.
  const dispatcher = slice(
    src,
    'const emitRateLimit = (evt: any) => {',
    "xhr.open('POST', `${BASE_URL}/api/chat`, true);",
    'dispatcher',
  );

  // -- PATH 3: plain-JSON body handling (inside runJson). ------------------
  const jsonBody = slice(
    src,
    "const reply = (j && (j.reply || j.text)) || '';",
    "} catch (e) {\n        if ((e as any)?.name === 'AbortError') return;",
    'jsonBody',
  );

  const moduleSrc = `
${asAction}

${parser}

// Buffered text/event-stream fallback, lifted verbatim.
function runBufferedSse(raw: any, cb: any) {
${bufferedSse}
}

// Plain-JSON body handling, lifted verbatim.
function runJsonBody(j: any, cb: any) {
${jsonBody}
}

// Live XHR SSE dispatcher, lifted verbatim, with its closure state
// re-declared exactly as streamChat declares it.
function makeLiveDispatcher(cb: any, xhr: any) {
  let consumed = 0;
  let buffer = '';
  let acc = '';
  let finished = false;
  let gotDelta = false;
  let fellBack = false;
${dispatcher}
  return {
    handleFrame,
    pump,
    state: () => ({ finished, acc, gotDelta, fellBack }),
  };
}

module.exports = { parseBudgetRefusal, runBufferedSse, runJsonBody, makeLiveDispatcher };
`;

  const js = ts.transpileModule(moduleSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: false,
  }).outputText;

  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'console', js)(mod, mod.exports, require, console);
  return mod.exports;
}

// ============================================================================
// Fixtures
// ============================================================================

const REFERRAL =
  'If you are in immediate danger, call or text 988 to reach the Suicide and Crisis Lifeline.';

const CRISIS_FRAME = { type: 'crisis', reply: REFERRAL, crisis_tier: 2 };
const BUDGET_FRAME = {
  type: 'budget_exhausted',
  budget_exhausted: true,
  error: 'budget-exhausted',
  title: 'Usage limit reached.',
  body: 'Your map stays exactly as it is.',
  reset: 'Resets next cycle.',
};
const DONE_FRAME = { type: 'done', text: 'ordinary model text' };

function sse(frames) {
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
}

function spy() {
  const calls = {
    delta: [], done: [], crisis: [], budget: [], error: [], rateLimit: [],
    savedBeliefs: [], messageIds: [],
  };
  return {
    calls,
    cb: {
      onDelta: (t) => calls.delta.push(t),
      onDone: (t) => calls.done.push(t),
      onError: (e) => calls.error.push(e),
      onCrisis: (i) => calls.crisis.push(i),
      onBudgetExhausted: (r, raw) => calls.budget.push({ r, raw }),
      onRateLimit: (i) => calls.rateLimit.push(i),
      onSavedBeliefs: (r) => calls.savedBeliefs.push(r),
      onMessageIds: (m) => calls.messageIds.push(m),
    },
  };
}

const WHY =
  'WHY THIS MATTERS: a turn the server classified as a crisis must reach the user as\n' +
  'the deterministic referral, with onCrisis firing so the screen gates. If the budget\n' +
  'branch runs first it returns, the referral is dropped, the composer stays unlocked\n' +
  'and the user sees a billing sheet instead of a hotline. Crisis before budget.';

// ============================================================================
// Run
// ============================================================================

(function main() {
  console.log('');
  console.log('smoke-crisis-before-budget — CRISIS takes precedence over BUDGET');
  console.log(`source: ${API_TS}`);
  console.log('');

  let src;
  let live;
  try {
    src = readSource();
    live = buildLiveModule(src);
    step(1, 'lift + transpile + execute the real transport blocks out of api.ts', true);
  } catch (e) {
    step(1, 'lift + transpile + execute the real transport blocks out of api.ts', false,
      `${(e && e.message) || e}\nThe anchors this test uses no longer match api.ts. Re-anchor them\nand re-verify the invariant by hand before trusting a green run.`);
    console.log('');
    console.log(`SUMMARY: ${passCount} passed, ${failCount} failed — cannot continue without the source blocks.`);
    process.exit(1);
  }

  const { parseBudgetRefusal, runBufferedSse, runJsonBody, makeLiveDispatcher } = live;

  // ---- 2: sanity — the real parser recognizes the budget fixture. -------
  //      Without this, checks that assert "no budget callback" could pass
  //      simply because the fixture was not a refusal at all.
  {
    const r = parseBudgetRefusal(BUDGET_FRAME);
    step(2, 'real parseBudgetRefusal() recognizes the budget fixture (anti-vacuity)',
      !!r && r.title === 'Usage limit reached.',
      `parseBudgetRefusal returned ${JSON.stringify(r)}\nIf the fixture is not a real refusal, every "budget did not fire" assertion below is meaningless.`);
  }

  // ======================= PATH 2 — buffered SSE ========================
  // The path that regressed.

  // ---- 3: crisis frame FIRST, budget frame after. ----------------------
  {
    const s = spy();
    runBufferedSse(sse([CRISIS_FRAME, BUDGET_FRAME]), s.cb);
    const ok =
      s.calls.crisis.length === 1 &&
      s.calls.crisis[0].tier === 2 &&
      s.calls.budget.length === 0 &&
      s.calls.done.join('') === REFERRAL;
    step(3, 'buffered-SSE: crisis frame + budget frame (crisis first) -> crisis wins', ok,
      `onCrisis=${s.calls.crisis.length} onBudgetExhausted=${s.calls.budget.length} onDone=${JSON.stringify(s.calls.done)}\n${WHY}`);
  }

  // ---- 4: budget frame FIRST, crisis frame after. ----------------------
  //      The buffered path accumulates all frames before deciding, so it
  //      must be order-independent. This is the exact shape the old bug
  //      lost: the budget branch returned before crisis was consulted.
  {
    const s = spy();
    runBufferedSse(sse([BUDGET_FRAME, CRISIS_FRAME]), s.cb);
    const ok =
      s.calls.crisis.length === 1 &&
      s.calls.budget.length === 0 &&
      s.calls.done.join('') === REFERRAL;
    step(4, 'buffered-SSE: budget frame + crisis frame (budget first) -> crisis STILL wins', ok,
      `onCrisis=${s.calls.crisis.length} onBudgetExhausted=${s.calls.budget.length} onDone=${JSON.stringify(s.calls.done)}\nThe buffered path parses every frame before deciding, so frame order must not\nmatter. A failure here means the budget branch is short-circuiting again.\n${WHY}`);
  }

  // ---- 5: the referral TEXT lands, not just the gate. ------------------
  {
    const s = spy();
    runBufferedSse(sse([{ type: 'delta', text: 'partial…' }, CRISIS_FRAME, BUDGET_FRAME]), s.cb);
    const ok =
      s.calls.delta.length === 1 &&
      s.calls.delta[0] === REFERRAL &&
      s.calls.done[0] === REFERRAL &&
      s.calls.budget.length === 0;
    step(5, 'buffered-SSE: the deterministic referral is what renders (crisis reply replaces deltas)', ok,
      `onDelta=${JSON.stringify(s.calls.delta)} onDone=${JSON.stringify(s.calls.done)}\nGating the screen without showing the referral is still a failure — the user\nmust see the resources, not an empty bubble.`);
  }

  // ---- 6: control — budget alone still raises the sheet. ---------------
  {
    const s = spy();
    runBufferedSse(sse([BUDGET_FRAME]), s.cb);
    const ok = s.calls.budget.length === 1 && s.calls.crisis.length === 0 && s.calls.error.length === 0;
    step(6, 'buffered-SSE control: budget alone (no crisis) still raises the billing sheet', ok,
      `onBudgetExhausted=${s.calls.budget.length} onCrisis=${s.calls.crisis.length} onError=${JSON.stringify(s.calls.error)}\nIf this fails, checks 3-5 are green only because budget handling is broken.`);
  }

  // ---- 7: static — source ordering on the buffered path. ---------------
  {
    const region = sliceThrough(src, "let fullText = '';", "cb.onError('empty reply');", 'bufferedSse-static');
    const iGuard = region.indexOf('if (crisisTier !== undefined) {');
    const iEmit = region.indexOf('cb.onCrisis?.({ tier: crisisTier });');
    const iBranch = region.indexOf('if (budgetRaw) {');
    const iBudgetEmit = region.indexOf('cb.onBudgetExhausted(refusal, budgetRaw)');
    const between = iGuard >= 0 && iBranch > iGuard ? region.slice(iGuard, iBranch) : '';
    const ok =
      iGuard >= 0 && iEmit >= 0 && iBranch >= 0 && iBudgetEmit >= 0 &&
      iGuard < iBranch && iEmit < iBudgetEmit && between.includes('return;');
    step(7, 'buffered-SSE static: crisis guard + emission precede the budget branch, and return', ok,
      `crisisGuard@${iGuard} crisisEmit@${iEmit} budgetBranch@${iBranch} budgetEmit@${iBudgetEmit}\nThe crisis block must come first AND return, so control can never reach the\nbudget branch on a crisis turn. This is the exact ordering that regressed.\n${WHY}`);
  }

  // =================== PATH 1 — live XHR dispatcher =====================

  // ---- 8: crisis frame then budget frame over the live stream. ---------
  {
    const s = spy();
    const xhr = { responseText: sse([{ type: 'delta', text: 'partial…' }, CRISIS_FRAME, BUDGET_FRAME]) };
    const d = makeLiveDispatcher(s.cb, xhr);
    d.pump();
    const ok =
      s.calls.crisis.length === 1 &&
      s.calls.crisis[0].tier === 2 &&
      s.calls.budget.length === 0 &&
      s.calls.done[s.calls.done.length - 1] === REFERRAL &&
      d.state().finished === true;
    step(8, 'live XHR: crisis frame latches terminal — a trailing budget frame is never dispatched', ok,
      `onCrisis=${s.calls.crisis.length} onBudgetExhausted=${s.calls.budget.length} onDone=${JSON.stringify(s.calls.done)} finished=${d.state().finished}\nThe dispatcher must stop consuming frames the moment crisis fires. If the\nbudget frame still gets through, the billing sheet lands on top of the\nreferral and the gate is undone.\n${WHY}`);
  }

  // ---- 9: control — budget alone over the live stream. -----------------
  {
    const s = spy();
    const xhr = { responseText: sse([BUDGET_FRAME]) };
    const d = makeLiveDispatcher(s.cb, xhr);
    d.pump();
    const ok = s.calls.budget.length === 1 && s.calls.crisis.length === 0 && s.calls.error.length === 0;
    step(9, 'live XHR control: budget alone (no crisis) still raises the billing sheet', ok,
      `onBudgetExhausted=${s.calls.budget.length} onCrisis=${s.calls.crisis.length} onError=${JSON.stringify(s.calls.error)}\nIf this fails, check 8 is green only because budget handling is broken.`);
  }

  // ---- 10: crisis_replace (post-delta model-output scan) behaves the ----
  //          same as crisis and still beats a trailing budget frame.
  {
    const s = spy();
    const xhr = {
      responseText: sse([
        { type: 'delta', text: 'model text the scan later rejects' },
        { type: 'crisis_replace', reply: REFERRAL, crisis_tier: 1 },
        BUDGET_FRAME,
        DONE_FRAME,
      ]),
    };
    const d = makeLiveDispatcher(s.cb, xhr);
    d.pump();
    const ok =
      s.calls.crisis.length === 1 &&
      s.calls.crisis[0].tier === 1 &&
      s.calls.budget.length === 0 &&
      s.calls.done[s.calls.done.length - 1] === REFERRAL;
    step(10, 'live XHR: crisis_replace also beats a trailing budget frame and replaces shown text', ok,
      `onCrisis=${JSON.stringify(s.calls.crisis)} onBudgetExhausted=${s.calls.budget.length} onDone=${JSON.stringify(s.calls.done)}\ncrisis_replace fires AFTER deltas have rendered — the referral must overwrite\nwhat is already on screen, and nothing may run after it.`);
  }

  // ---- 11: static — the latch and the loops that honor it. -------------
  {
    const region = slice(src, 'const emitRateLimit = (evt: any) => {',
      "xhr.open('POST', `${BASE_URL}/api/chat`, true);", 'dispatcher-static');
    const iCrisisCase = region.indexOf("case 'crisis':");
    const iBudgetCase = region.indexOf("case 'budget_exhausted':");
    const iErrorCase = region.indexOf("case 'error':");
    const crisisBody = iCrisisCase >= 0 && iBudgetCase > iCrisisCase ? region.slice(iCrisisCase, iBudgetCase) : '';
    const budgetBody = iBudgetCase >= 0 && iErrorCase > iBudgetCase ? region.slice(iBudgetCase, iErrorCase) : '';
    const iLatch = crisisBody.indexOf('finished = true;');
    const iCrisisCb = crisisBody.indexOf('cb.onCrisis?.(');
    const ok =
      iCrisisCase >= 0 && iBudgetCase > iCrisisCase &&
      iLatch >= 0 && iCrisisCb > iLatch &&
      budgetBody.includes('finished = true;') &&
      region.includes('while (!finished && (idx = buffer.indexOf(') &&
      region.includes('if (finished) break;');
    step(11, 'live XHR static: crisis case latches before emitting; pump honors the latch on both loops', ok,
      `crisisCase@${iCrisisCase} budgetCase@${iBudgetCase} latch@${iLatch} onCrisis@${iCrisisCb}\nlatchInBudgetCase=${budgetBody.includes('finished = true;')} whileGuard=${region.includes('while (!finished && (idx = buffer.indexOf(')} innerBreak=${region.includes('if (finished) break;')}\nThe crisis case must set the terminal latch BEFORE calling back, and pump must\ncheck it on both the event loop and the per-line loop. Drop either guard and a\nbudget frame sitting later in the same buffer gets dispatched over the crisis.`);
  }

  // ======================= PATH 3 — plain JSON ==========================

  // ---- 12: a JSON body carrying crisis_detected AND budget markers. ----
  {
    const s = spy();
    runJsonBody({
      reply: REFERRAL,
      crisis_detected: true,
      crisis_tier: 2,
      budget_exhausted: true,
      error: 'budget-exhausted',
      savedBeliefs: [{ part_id: 'p1', part_name: 'x', belief: 'y' }],
    }, s.cb);
    const ok =
      s.calls.crisis.length === 1 &&
      s.calls.crisis[0].tier === 2 &&
      s.calls.budget.length === 0 &&
      s.calls.delta[0] === REFERRAL &&
      s.calls.done[0] === REFERRAL &&
      s.calls.savedBeliefs.length === 0;
    step(12, 'plain-JSON: body with crisis_detected + budget markers -> referral renders, screen gates', ok,
      `onCrisis=${s.calls.crisis.length} onBudgetExhausted=${s.calls.budget.length} onDelta=${JSON.stringify(s.calls.delta)} savedBeliefs=${s.calls.savedBeliefs.length}\nThe crisis check must return, so nothing additive (belief cards, message ids,\nor any future budget handling) runs after the gate on this path.\n${WHY}`);
  }

  // ================= PATH 4/5 — HTTP 402 tripwires ======================
  // A crisis turn is a 200 by server contract, so these branches are
  // unreachable for a crisis turn and carry no ordering. The tripwire
  // holds that assumption still true.

  {
    const region = slice(src, 'if (res.status === 402) {', 'if (!res.ok) {', 'fetch-402');
    const ok = !/crisis/i.test(region);
    step(13, 'HTTP 402 (fetch path): branch is crisis-free — tripwire on the "402 is never a crisis turn" assumption', ok,
      `Found a crisis reference inside the 402 branch of the JSON transport.\nThat branch returns the billing sheet unconditionally. If a 402 body can now\ncarry a crisis signal, the crisis check MUST be added ahead of the refusal\nemission and this check must be replaced with a real ordering assertion.\n${WHY}`);
  }

  {
    const region = slice(src, 'if (xhr.status === 402) {', 'if (xhr.status >= 200 && xhr.status < 300) {', 'xhr-402');
    const ok = !/crisis/i.test(region);
    step(14, 'HTTP 402 (XHR onload): branch is crisis-free — same tripwire on the streaming request', ok,
      `Found a crisis reference inside the streaming 402 branch. Same rule as check 13:\nthis branch emits the refusal and returns with no crisis consultation, so a\ncrisis-carrying 402 would be silently swallowed by the billing sheet.\n${WHY}`);
  }

  {
    const region = slice(src, 'async streamGuide(', 'async mapVoiceTurn(', 'streamGuide');
    const ok = !/crisis/i.test(region);
    step(15, 'guide-chat transport: crisis-free — tripwire (it handles budget but has no crisis surface)', ok,
      `streamGuide now references crisis but has only a budget refusal path and no\nonCrisis callback. Any crisis signal added there needs the same ordering\ndefense as the main chat transports before this check is relaxed.\n${WHY}`);
  }

  // ================= Whole-file sweep — new call sites ==================
  // Pins the number of emission sites so a NEW transport cannot be added
  // without someone landing here and extending the test.
  {
    const budgetSites = (src.match(/cb\.onBudgetExhausted\(/g) || []).length;
    const crisisSites = (src.match(/cb\.onCrisis\?\.\(/g) || []).length;
    const ok = budgetSites === 4 && crisisSites === 3;
    step(16, 'sweep: emission-site counts unchanged (4 budget, 3 crisis) — new transports must extend this test', ok,
      `onBudgetExhausted call sites=${budgetSites} (expected 4)\nonCrisis call sites=${crisisSites} (expected 3)\nA new budget emission site is a new transport that can displace a crisis, and a\nnew crisis site is a new path that must win. Either way: add a case above,\nthen update these counts. Do not just bump the numbers.\n${WHY}`);
  }

  console.log('');
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed — ${pass ? 'ALL GREEN (crisis before budget on every transport)' : 'INVARIANT VIOLATED'}`);
  console.log('');
  process.exit(pass ? 0 : 1);
})();
