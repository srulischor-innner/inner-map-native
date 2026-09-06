// THE APP-SIDE AUDIT FIXES (founder rulings 2026-09-06).
//
//   1. the age-gate bypass — a slow storage read waived the terms screen
//   2. the frozen paywall — nothing parsed the trial 402
//   3. the opening mode boxes
//
// EVERY ASSERTION IS WRITTEN TO FAIL WHEN ITS FIX IS REVERTED, and each was
// checked by actually reverting it. The lesson being applied is the trial-freeze
// smoke, whose headline check greped for a string that also appeared in nine
// unrelated crisis-logging calls and so could not detect the deletion of the
// three gates it claimed to guard.
//
//   node scripts/smoke-audit-fixes-app.js
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n         ' + detail : ''}`); }
};
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const LAYOUT = read('app/_layout.tsx');
const API = read('services/api.ts');
const CHAT = read('app/(tabs)/index.tsx');
const BOXES = read('components/ModeBoxes.tsx');
const CONTROL = read('components/WorkingModeControl.tsx');

// ===========================================================================
console.log('\n=== 1. a slow storage read cannot waive the terms screen ===');
// ===========================================================================
// The boot read had ONE 3s attempt whose fallback asserted termsAccepted:true.
// On a fresh install with slow storage that made `complete` true and the device
// fell through to the tabs having seen neither the terms screen nor the age
// question — isAgeGateBlocked() cannot catch that, because it is true only for
// a device that was explicitly DECLINED and a never-asked device reports false.
ok('the boot read is retried before anything is assumed',
  /getOnboardingState\(\), 2000, null, 'getOnboardingState\(retry\)'/.test(LAYOUT),
  'without a retry, one slow read is treated as an answer');

ok('the first attempt yields a null SENTINEL, not a completed-looking state',
  /withTimeout<OnboardingState \| null>\(\s*getOnboardingState\(\), 3000, null, 'getOnboardingState'\)/.test(LAYOUT),
  'passing `fallback` here is the bug: it makes "unknown" indistinguishable from "done"');

// THE LOAD-BEARING LINE. On a still-unknown read the legal flag must go FALSE.
ok('an unknown answer routes to onboarding (termsAccepted goes FALSE)',
  /state = \{ \.\.\.fallback, termsAccepted: false \}/.test(LAYOUT),
  'a legal gate must fail toward SHOWING the screen, never toward waiving it');

// ...and the loop-breakers must NOT have been dragged false with it, or a
// stalled device gets trapped on /sign-in — the thing the original fallback
// existed to prevent.
{
  const i = LAYOUT.indexOf('const fallback: OnboardingState = {');
  const decl = LAYOUT.slice(i, LAYOUT.indexOf('};', i));
  ok('...while the loop-breakers stay TRUE so nobody is trapped on sign-in',
    /hasSeenIntro: true/.test(decl) && /signInChoiceMade: true/.test(decl),
    'the fix must not swap one trap for another');
}

// The worst-case splash time is the sum of three SEQUENTIAL caps. 3+2+3 = 8s,
// under the age-gate smoke's 10s ceiling. A longer retry silently regresses
// boot time on exactly the devices this fix is for.
{
  const m = LAYOUT.match(/getOnboardingState\(\), (\d+), null, 'getOnboardingState\(retry\)'/);
  const retryMs = m ? Number(m[1]) : Infinity;
  ok(`the retry window is bounded (${retryMs}ms, must be <= 2000)`, retryMs <= 2000,
    '3000 + retry + 3000 must stay under the 10s ceiling smoke-age-gate.js enforces');
}

// ===========================================================================
console.log('\n=== 2. a frozen user is told their trial ended ===');
// ===========================================================================
// parseTrialFreeze and refusalFromResponse existed with ZERO call sites. The
// 402 fell through parseBudgetRefusal — which matches `budget-exhausted` and
// returns null for this payload — to a generic error with a retry pill.
ok('parseTrialFreeze is actually CALLED somewhere',
  /\bparseTrialFreeze\(/.test(API.replace(/export function parseTrialFreeze\(/, '')),
  'an exported parser nothing calls is the "looks like it works" failure');

// Both 402 transports. Counted, so removing one is caught.
{
  // Counted on the exact argument names so the two sites cannot overlap --
  // /parseTrialFreeze\(raw/ matches `rawBody` too, which counted 3 for 2 sites.
  const calls = (API.match(/const trial = parseTrialFreeze\(raw\);/g) || []).length
    + (API.match(/const trial = parseTrialFreeze\(rawBody\);/g) || []).length;
  ok(`both 402 sites parse the trial payload (found ${calls})`, calls === 2,
    'expected 2 — the chat fetch path and the guide xhr path');
}

// ORDERING. parseBudgetRefusal returns null for a trial payload, so trying it
// first is harmless — but only if the trial branch RETURNS. Assert the trial
// check precedes the budget check at both sites.
// Windowed from the trial call to its own fallthrough, so an unrelated
// parseBudgetRefusal earlier in the file cannot be mistaken for this site's.
for (const [label, anchor, arg] of [
  ['chat', "cb.onError('chat 402')", 'rawBody'],
  ['guide', "cb.onError('guide-chat 402')", 'raw'],
]) {
  // Anchor on the CALL and search forward to the fallthrough — not the other
  // way round. api.ts's own explanatory comment quotes "cb.onError('chat 402')"
  // four hundred lines above the real handler, so indexOf(anchor) found prose
  // and the window came out empty. Finding the code first cannot hit a comment,
  // because no comment contains the assignment.
  const start = API.indexOf(`const trial = parseTrialFreeze(${arg});`);
  const end = start >= 0 ? API.indexOf(anchor, start) : -1;
  const window = start >= 0 && end > start ? API.slice(start, end) : '';
  ok(`${label}: the trial check runs BEFORE the budget check`,
    start >= 0 && window.includes('parseBudgetRefusal') && /if \(cb\.onTrialExpired\)/.test(window),
    start < 0 ? 'no parseTrialFreeze precedes this fallthrough' : 'trial branch must return before budget is tried');
}

ok('the callback type carries onTrialExpired, separately from onBudgetExhausted',
  /onTrialExpired\?: \(refusal: TrialFreezeRefusal, raw: unknown\) => void;/.test(API));

ok('the reading path surfaces a refusal instead of returning null',
  /const refusal = await refusalFromResponse\(res\);\s*\r?\n\s*if \(refusal\) return \{ refusal \};/.test(API),
  'a 402 that returns null renders as a spinner that stops, with no sentence anywhere');

// THE SCREEN. A parser wired to nothing on the UI side is the same defect one
// layer up, so assert the chat screen both handles and RENDERS it.
ok('the chat screen implements onTrialExpired', /onTrialExpired: \(refusal\) => \{/.test(CHAT));
ok('...and it holds its own state, not budgetRefusal',
  /const \[trialRefusal, setTrialRefusal\] = useState<TrialFreezeRefusal \| null>\(null\);/.test(CHAT));
ok('...and a sheet actually renders it', /visible=\{!!trialRefusal && !crisisGated\}/.test(CHAT),
  'state set but never rendered is a paywall nobody sees');
ok('...whose primary action goes to the paywall, not a top-up purchase',
  /router\.push\('\/paywall'\)/.test(CHAT),
  'a week that ran out is not a pool that was spent');
ok('...and it is suppressed while a crisis owns the screen',
  (CHAT.match(/&& !crisisGated\}/g) || []).length >= 2
  && /trial refusal suppressed — crisis owns this turn/.test(CHAT));

// ===========================================================================
console.log('\n=== 3. the opening mode boxes ===');
// ===========================================================================
ok('the boxes render the sheet\'s own copy, not a second version of it',
  /import \{ MODE_LABEL, MODE_BLURB, type WorkingMode \} from '\.\/WorkingModeControl'/.test(BOXES));
ok('MODE_BLURB is exported so there is one copy of those four sentences',
  /export const MODE_BLURB: Record<WorkingMode, string>/.test(CONTROL));

// THE ANTI-DRIFT CHECK, and the reason this file exists at all: the labels have
// drifted twice. Assert the boxes contain NO literal mode wording of their own.
{
  const blurbs = ['I listen.', 'We stay with how it feels', 'We look at the pattern',
                  'We look at one belief'];
  const copied = blurbs.filter((b) => BOXES.includes(b));
  ok('the boxes hardcode none of the four blurbs', copied.length === 0,
    copied.length ? 'copied verbatim: ' + copied.join(' | ') : '');
  const labels = ['Saying it', 'Sitting with it', 'Understanding it', 'Leading it'];
  const copiedL = labels.filter((l) => BOXES.includes(l));
  ok('...and none of the four labels', copiedL.length === 0,
    copiedL.length ? 'copied verbatim: ' + copiedL.join(' | ') : '');
}

ok('there are four boxes, in the sheet\'s order',
  /const ORDER: WorkingMode\[\] = \['light', 'process', 'explore', 'differentiation'\]/.test(BOXES));
ok('each box has its own info control', /accessibilityLabel=\{`What \$\{MODE_LABEL\[m\]\} means`\}/.test(BOXES));
ok('the info tap cannot fall through and change the mode',
  /e\.stopPropagation\(\);/.test(BOXES),
  'a mis-tap on a 16pt glyph would otherwise silently switch how the conversation works');
ok('the info control has a hitSlop (the glyph is under 44pt on its own)',
  /hitSlop=\{\{ top: 12, bottom: 12, left: 12, right: 12 \}\}/.test(BOXES));

// SKIPPABLE, BY RULING. Two halves: it says so, and nothing blocks.
ok('the boxes say out loud that they can be ignored',
  /Or just keep talking/.test(BOXES));
{
  // Strip comments first: this file's own header explains why a REQUIRED tap
  // was rejected, and a naive /required/i over the whole source matched that
  // sentence -- a check failing on its own rationale.
  const code = BOXES.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('...and picking is the ONLY thing that dismisses them (no required gate)',
    !/disabled=\{/.test(code) && !/\brequired\b/i.test(code),
    'any disabled/required branch here would make the opening question a form');
}

// PLACEMENT. Second assistant message, and never over a crisis.
ok('shown only after the greeting AND one reply',
  /return users >= 1 && assistants === 2;/.test(CHAT),
  'assistants===2 is greeting + the reply to what they actually said');
ok('...and never while a crisis owns the screen',
  /if \(modeBoxesDismissed \|\| crisisGated \|\| typing \|\| sending\) return false;/.test(CHAT));
ok('picking writes the ref synchronously, like the control does',
  /workingModeRef\.current = next;\s*\r?\n\s*setWorkingMode\(next\);\s*\r?\n\s*handleModeChange\(wireModeFor\(next\)\);/.test(CHAT),
  'a turn started in the same tick must read the new mode, not the stale one');

console.log(`\nsmoke-audit-fixes-app: ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
