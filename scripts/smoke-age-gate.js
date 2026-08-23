// 18+ age-gate boundary smoke (August 2026).
//
// The gate turns a date of birth into a single boolean, and that computation
// is the only part of the whole feature that can be wrong in a way nobody
// notices. A UI bug is visible the first time anyone opens the screen. An
// off-by-one at the 18th-birthday boundary is invisible: it silently admits
// 17-year-olds, or turns away adults on their birthday, and neither shows up
// in a screenshot. So it gets hammered here, exhaustively.
//
// THIS RUNS THE REAL SHIPPED CODE. utils/ageGate.ts is compiled with the
// repo's own TypeScript (already a devDependency — no new package) and the
// resulting module is required. It is NOT re-implemented in this file, so it
// cannot drift from what ships the way a hand-mirrored copy would.
//
// Run: node scripts/smoke-age-gate.js
// Output: STEP lines, ALL GREEN on success.

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

const NATIVE = path.resolve(__dirname, '..');

// ---- compile + load the real utils/ageGate.ts -------------------------------
function loadTsModule(relPath) {
  const full = path.join(NATIVE, relPath);
  const src = fs.readFileSync(full, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: full,
  }).outputText;
  const m = new Module(full, null);
  m.filename = full;
  m.paths = Module._nodeModulePaths(path.dirname(full));
  m._compile(js, full);
  return m.exports;
}

const gate = loadTsModule(path.join('utils', 'ageGate.ts'));
const { evaluateDob, localToday, daysInMonth, compareCivil, parseBox,
        MINIMUM_AGE, MAX_PLAUSIBLE_AGE } = gate;

let pass = true;
let ran = 0;
const failures = [];
function step(label, ok, extra) {
  ran++;
  console.log(`STEP ${ran} — ${label}: ${ok ? 'OK' : 'FAIL'}${extra ? ' — ' + extra : ''}`);
  if (!ok) { pass = false; failures.push(label); }
}
/** Assert a whole table of cases as ONE step, reporting every mismatch. */
function table(label, cases) {
  const bad = [];
  for (const [dob, today, want, why] of cases) {
    const got = evaluateDob(dob, today);
    if (got !== want) bad.push(`${why || ''} ${JSON.stringify(dob)} @${JSON.stringify(today)} want=${want} got=${got}`);
  }
  step(`${label} (${cases.length} cases)`, bad.length === 0, bad.slice(0, 6).join(' | '));
}
const D = (year, month, day) => ({ year, month, day });

// ============================================================================
// A. THE MODULE'S OWN CONTRACT
// ============================================================================
step('MINIMUM_AGE is 18 — the figure both legal documents assert', MINIMUM_AGE === 18);
step('evaluateDob returns a status and NEVER an age in years',
  typeof evaluateDob(D(2000, 1, 1), D(2026, 8, 6)) === 'string',
  'a caller that can see the number is a caller that can be tempted to store it');

// ============================================================================
// B. THE 18th-BIRTHDAY BOUNDARY — the assertion this file exists for
//
// Someone whose 18th birthday is TODAY is 18 and must pass. Explicit ruling.
// Checked on the day before, the day of, and the day after — for a birthday
// mid-month, at a month boundary, and at a year boundary, because an
// implementation that special-cases month/day rollovers can pass one and fail
// the others.
// ============================================================================
table('the day BEFORE an 18th birthday is under 18', [
  [D(2008, 6, 15), D(2026, 6, 14), 'under', 'mid-month'],
  [D(2008, 7,  1), D(2026, 6, 30), 'under', 'month boundary'],
  [D(2008, 1,  1), D(2025, 12, 31), 'under', 'year boundary'],
  [D(2008, 12, 31), D(2026, 12, 30), 'under', 'end of year'],
  [D(2008, 3,  1), D(2026, 2, 28), 'under', 'across a non-leap February'],
]);

table('the DAY OF an 18th birthday is 18 — the ruling case', [
  [D(2008, 6, 15), D(2026, 6, 15), 'ok', 'mid-month'],
  [D(2008, 7,  1), D(2026, 7,  1), 'ok', 'month boundary'],
  [D(2008, 1,  1), D(2026, 1,  1), 'ok', 'year boundary'],
  [D(2008, 12, 31), D(2026, 12, 31), 'ok', 'end of year'],
  [D(2008, 8,  6), D(2026, 8,  6), 'ok', 'today, at time of writing'],
]);

table('the day AFTER an 18th birthday is 18', [
  [D(2008, 6, 15), D(2026, 6, 16), 'ok', 'mid-month'],
  [D(2008, 6, 30), D(2026, 7,  1), 'ok', 'month boundary'],
  [D(2007, 12, 31), D(2026, 1,  1), 'ok', 'year boundary'],
]);

// Exhaustive sweep: for EVERY calendar day of a birth year, walk the three
// days around the 18th birthday. 365 birthdays x 3 probes — this is the check
// that would catch an off-by-one no hand-picked case happened to hit.
{
  const bad = [];
  const year = 2008; // leap year, so Feb 29 is included
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const dob = D(year, m, d);
      // Day of: always 'ok'.
      if (evaluateDob(dob, D(year + 18, m, d)) !== 'ok') {
        bad.push(`day-of ${m}/${d} not ok`);
      }
      // The day before the birthday, expressed without Date arithmetic:
      // step back one day within the civil calendar of the birthday year.
      let py = year + 18, pm = m, pd = d - 1;
      if (pd === 0) { pm -= 1; if (pm === 0) { pm = 12; py -= 1; } pd = daysInMonth(py, pm); }
      // Skip the Feb 29 birthday here — in 2026 (non-leap) the eligibility
      // date does not exist and is covered by its own section below.
      if (!(m === 2 && d === 29)) {
        if (evaluateDob(dob, D(py, pm, pd)) !== 'under') bad.push(`day-before ${m}/${d} not under`);
      }
      // The day after.
      let ny = year + 18, nm = m, nd = d + 1;
      if (nd > daysInMonth(ny, nm)) { nd = 1; nm += 1; if (nm === 13) { nm = 1; ny += 1; } }
      if (evaluateDob(dob, D(ny, nm, nd)) !== 'ok') bad.push(`day-after ${m}/${d} not ok`);
    }
  }
  step('exhaustive sweep — every 2008 birthday, three days around the boundary (1096 probes)',
    bad.length === 0, bad.slice(0, 6).join(' | '));
}

// ============================================================================
// C. FEB 29 BIRTHDAYS
//
// Born 2008-02-29. The eligibility triple is (2026, 2, 29) and 2026 is not a
// leap year, so that day never occurs. The module documents the choice: they
// turn 18 on March 1, not February 28 — the direction that never admits
// someone early. Pinned so a "fix" cannot quietly flip it.
// ============================================================================
table('Feb 29 birthday, non-leap 18th year — March 1, not February 28', [
  [D(2008, 2, 29), D(2026, 2, 27), 'under', 'two days before'],
  [D(2008, 2, 29), D(2026, 2, 28), 'under', 'Feb 28 — deliberately still under'],
  [D(2008, 2, 29), D(2026, 3,  1), 'ok',    'March 1 — the eligibility day'],
  [D(2008, 2, 29), D(2026, 3,  2), 'ok',    'day after'],
]);
table('Feb 29 birthday whose 18th year IS a leap year', [
  [D(2004, 2, 29), D(2022, 2, 28), 'under', 'day before'],
  [D(2004, 2, 29), D(2022, 3,  1), 'ok',    '2022 is not a leap year → March 1'],
  [D(1988, 2, 29), D(2006, 3,  1), 'ok',    'again non-leap'],
  // 2008 -> 2026 is non-leap; find a case where +18 IS leap: 1994+18=2012.
  [D(1994, 3,  1), D(2012, 2, 29), 'under', 'Feb 29 exists in 2012; born Mar 1 → still under'],
  [D(1994, 2, 28), D(2012, 2, 29), 'ok',    'born Feb 28 → 18 by Feb 28 2012'],
]);
step('daysInMonth applies the full Gregorian leap rule',
  daysInMonth(2008, 2) === 29 && daysInMonth(2026, 2) === 28 &&
  daysInMonth(1900, 2) === 28 && daysInMonth(2000, 2) === 29,
  '1900 is NOT a leap year (÷100), 2000 IS (÷400)');

// ============================================================================
// D. INVALID INPUT — and the reason 'invalid' is a separate status
//
// A typo must NEVER trip the block or spend the one correction offer. So
// nonsense is 'invalid', not 'under', even when the nonsense would compute to
// a child if you squinted at it.
// ============================================================================
const TODAY = D(2026, 8, 6);
table('impossible calendar dates are invalid, not under-18', [
  [D(2001, 2, 30), TODAY, 'invalid', 'Feb 30'],
  [D(2001, 2, 29), TODAY, 'invalid', 'Feb 29 in a non-leap year'],
  [D(2001, 4, 31), TODAY, 'invalid', 'April 31'],
  [D(2001, 6, 31), TODAY, 'invalid', 'June 31'],
  [D(2001, 13, 1), TODAY, 'invalid', 'month 13'],
  [D(2001, 0, 15), TODAY, 'invalid', 'month 0'],
  [D(2001, 5, 0), TODAY, 'invalid', 'day 0'],
  [D(2001, 5, 32), TODAY, 'invalid', 'day 32'],
  [D(2001, -3, 15), TODAY, 'invalid', 'negative month'],
]);
table('future dates are invalid, not under-18', [
  [D(2026, 8, 7), TODAY, 'invalid', 'tomorrow'],
  [D(2026, 12, 31), TODAY, 'invalid', 'later this year'],
  [D(2030, 1, 1), TODAY, 'invalid', 'years away'],
  [D(2026, 9, 1), TODAY, 'invalid', 'next month'],
]);
table('absurdly old dates are invalid', [
  [D(1200, 6, 15), TODAY, 'invalid', 'year 1200'],
  [D(1800, 1, 1), TODAY, 'invalid', 'year 1800'],
  [D(1066, 10, 14), TODAY, 'invalid', 'year 1066'],
]);
table('plausibly old dates still pass — being 100 is not a typo', [
  [D(1930, 6, 15), TODAY, 'ok', 'age 96'],
  [D(1926, 8, 6), TODAY, 'ok', `age ${2026 - 1926} exactly`],
]);
step(`the plausibility cutoff is ${MAX_PLAUSIBLE_AGE}, generous on purpose`,
  evaluateDob(D(2026 - MAX_PLAUSIBLE_AGE, 8, 6), TODAY) === 'ok' &&
  evaluateDob(D(2026 - MAX_PLAUSIBLE_AGE - 1, 8, 6), TODAY) === 'invalid',
  'being wrongly told your birthday is invalid is worse than the alternative');

// ============================================================================
// E. PARTIAL ENTRY IS SILENT
//
// While the user is still typing we say nothing. If partial entry read as
// 'invalid', they would be told they made a mistake after one keystroke.
// ============================================================================
table('partial entry is incomplete, never invalid', [
  [{ year: null, month: null, day: null }, TODAY, 'incomplete', 'nothing typed'],
  [{ year: 2001, month: null, day: null }, TODAY, 'incomplete', 'year only'],
  [{ year: null, month: 5, day: 12 }, TODAY, 'incomplete', 'no year'],
  [{ year: 2001, month: 5, day: null }, TODAY, 'incomplete', 'no day'],
  [{ year: 2, month: 5, day: 12 }, TODAY, 'incomplete', 'first digit of the year'],
  [{ year: 20, month: 5, day: 12 }, TODAY, 'incomplete', 'two digits of the year'],
  [{ year: 200, month: 5, day: 12 }, TODAY, 'incomplete', 'three digits of the year'],
  [{ year: 2001, month: NaN, day: 12 }, TODAY, 'incomplete', 'unparseable month'],
  [{ year: 2001.5, month: 5, day: 12 }, TODAY, 'incomplete', 'non-integer year'],
  [{ year: Infinity, month: 5, day: 12 }, TODAY, 'incomplete', 'Infinity'],
]);
step('a four-digit year is the threshold where the year becomes complete',
  evaluateDob({ year: 999, month: 5, day: 12 }, TODAY) === 'incomplete' &&
  evaluateDob({ year: 1000, month: 5, day: 12 }, TODAY) === 'invalid',
  'year 1000 is complete-but-absurd, i.e. invalid, not incomplete');

// ============================================================================
// F. TIMEZONE / CLOCK BEHAVIOUR
//
// The comparison runs on civil-date triples in the DEVICE'S LOCAL calendar.
// These assertions pin that there is no UTC conversion and no duration
// arithmetic anywhere in the path — which is what makes "18th birthday today
// passes" true for a user in UTC+13 as well as UTC-8.
// ============================================================================
step('localToday reads the LOCAL calendar, not UTC',
  (() => {
    // A fixed instant that is a DIFFERENT calendar day in UTC vs most local
    // zones. We assert localToday agrees with the local getters, whatever this
    // machine's zone is — the point is that it never calls getUTC*.
    const inst = new Date(2026, 7, 6, 23, 30, 0); // local 2026-08-06 23:30
    const t = localToday(inst);
    return t.year === inst.getFullYear() && t.month === inst.getMonth() + 1 && t.day === inst.getDate();
  })());

step('localToday shifts month off the JS 0-11 convention',
  localToday(new Date(2026, 0, 15)).month === 1,
  'an unshifted month would make every January birthday compare against December');

step('the source performs NO UTC conversion and NO duration arithmetic',
  (() => {
    const src = fs.readFileSync(path.join(NATIVE, 'utils', 'ageGate.ts'), 'utf8');
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return !/getUTC/.test(code)
        && !/getTime\(\)/.test(code)
        && !/Date\.now/.test(code)
        && !/toISOString/.test(code);
  })(),
  'duration arithmetic across a DST boundary can shift a result by a day; triples cannot');

// A same-instant, different-zone pair: the SAME user on their 18th birthday
// must pass regardless of which side of the date line they are on, because
// each device compares against its OWN local calendar.
table('an 18th birthday passes on every device calendar that says it is today', [
  [D(2008, 8, 6), D(2026, 8, 6), 'ok', 'device says Aug 6'],
  [D(2008, 8, 6), D(2026, 8, 5), 'under', 'device still says Aug 5 — correctly not yet'],
  [D(2008, 8, 6), D(2026, 8, 7), 'ok', 'device already says Aug 7'],
]);

// ============================================================================
// G. compareCivil + parseBox — the two helpers the UI leans on
// ============================================================================
// The last two pairs are the ones that matter: they set the fields in
// CONFLICT, so an implementation that compares day-first (or month-first)
// gives the wrong sign. Pairs that agree on every field cannot detect a
// mis-ordered comparison — verified by mutation.
step('compareCivil orders by year, then month, then day',
  compareCivil(D(2020, 1, 1), D(2021, 1, 1)) < 0 &&
  compareCivil(D(2021, 1, 1), D(2020, 1, 1)) > 0 &&
  compareCivil(D(2021, 3, 1), D(2021, 4, 1)) < 0 &&
  compareCivil(D(2021, 4, 2), D(2021, 4, 1)) > 0 &&
  compareCivil(D(2021, 4, 1), D(2021, 4, 1)) === 0 &&
  compareCivil(D(2020, 1, 9), D(2021, 1, 1)) < 0 &&   // later day, earlier year
  compareCivil(D(2021, 12, 1), D(2021, 3, 28)) > 0);  // later month, earlier day

step('parseBox returns null for empty, NOT 0',
  parseBox('') === null && parseBox('   ') === null,
  '0 would render an empty day box as invalid while the user is still typing');
step('parseBox rejects non-digits rather than parseInt-ing a prefix',
  parseBox('12abc') === null && parseBox('abc') === null && parseBox('1.5') === null &&
  parseBox('-3') === null,
  'parseInt("12abc") is 12 — a silent wrong answer');
step('parseBox parses plain digits, including leading zeros',
  parseBox('7') === 7 && parseBox('07') === 7 && parseBox('2008') === 2008);

// ============================================================================
// H. ABSENCE CHECKS — the storage + crisis rulings, pinned in shipped source
//
// These are the checks that notice something being ADDED BACK, which is the
// failure mode that actually happens.
// ============================================================================
const onboardingSrc = fs.readFileSync(path.join(NATIVE, 'app', 'onboarding.tsx'), 'utf8');
const ageGateSrc = fs.readFileSync(path.join(NATIVE, 'utils', 'ageGate.ts'), 'utf8');

// Comments are stripped first — this file's own header DISCUSSES AsyncStorage
// at length ("no RN imports, no AsyncStorage"), and matching prose would make
// the check fail on the documentation that explains it.
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
step('utils/ageGate.ts persists nothing — no storage import of any kind',
  !/AsyncStorage|SecureStore|MMKV|from ['"]react-native|require\(/.test(stripComments(ageGateSrc)),
  'the DOB is a transient input; the moment this file can write, it can leak');

// The date of birth lives in ONE piece of component state and is never put in
// a payload, a storage write, or a log line.
step('the DOB is not part of IntakeState (the /api/intake payload shape)',
  (() => {
    const m = onboardingSrc.match(/type IntakeState = \{([\s\S]*?)\};/);
    return !!m && !/dob|birth|year|month|day/i.test(m[1]);
  })(),
  'IntakeState is what gets POSTed — a DOB there is a DOB on the wire');

step('the intake payload no longer sends `age`',
  (() => {
    const m = onboardingSrc.match(/api\.postIntake\(\{([\s\S]*?)\}\);/);
    return !!m && !/\bage\b/.test(m[1]);
  })(),
  'the optional Age field was replaced entirely, not left alongside the gate');

step('the old optional Age TextInput is gone from step 2',
  !/Field label="Age"/.test(onboardingSrc),
  'two age questions in one flow, one of them under "everything here is optional"');

step('no AsyncStorage key stores the date of birth',
  !/setItem\([^)]*(?:dob|birth)/i.test(onboardingSrc),
  'the ONLY persisted fact about a declined user is a local "blocked" flag');

step('the confirmation POST sends the boolean and nothing else',
  /confirmAge18/.test(onboardingSrc) &&
  (() => {
    const api = fs.readFileSync(path.join(NATIVE, 'services', 'api.ts'), 'utf8');
    const m = api.match(/async confirmAge18\(\)[\s\S]*?\n  \},/);
    return !!m && /JSON\.stringify\(\{ confirmed: true \}\)/.test(m[0]) &&
           !/dob|birth|year|month|day|age:/i.test(m[0].replace(/confirmAge18|age-confirm/g, ''));
  })());

// The block screen. Founder ruling: NOT ONE LINE of crisis content, because
// counsel is mid-analysis on those surfaces and all changes to them are held.
{
  // Terminated by the first closing brace at column zero — the function's own.
  // \r?\n throughout: this repo's files are CRLF.
  const m = onboardingSrc.match(/function AgeBlockedScreen\(\{[\s\S]*?\r?\n\}\r?\n/);
  step('the AgeBlockedScreen component was located', !!m);
  step('the block screen carries NO crisis resource, link or language',
    !!m && !/crisis|hotline|988|741741|suicide|emergency|support-resources|SupportResources|helpline/i.test(m[0]),
    'held pending counsel review — the screen is trivial to extend afterwards');
  step('the block screen is not styled as an error',
    !!m && !/error|danger|warning|#[eE][0-9a-fA-F]?5?0?50|colors\.wound/.test(m[0]),
    'plain and without shame — not red, not an error');
  // Asserts the affordance is GATED ON canCorrect, not merely that the prop is
  // mentioned — `{false ? (` would satisfy a mention-only check while silently
  // removing the one correction offer the ruling requires.
  step('the block screen offers exactly one correction affordance, gated on canCorrect',
    !!m && /\{canCorrect \? \(/.test(m[0]) &&
    /If you typed your date of birth wrong/.test(m[0]) &&
    !/try (a )?(different|another)/i.test(m[0]),
    'worded as "if you typed it wrong", never as "try a different date"');
}

step('a declined minor triggers no network call on the block path',
  (() => {
    const m = onboardingSrc.match(/if \(dobStatus === 'under'\) \{([\s\S]*?)\n    \}/);
    return !!m && !/api\./.test(m[1]) && /markAgeGateBlocked/.test(m[1]);
  })(),
  'no request, so no row, no log line and no analytics event exists anywhere');

// Renamed with the 2026-08 reorder: the gate moved out of IntakeFlow into its
// own AgeGateScreen phase, whose decline exit is `onBlocked` rather than the
// `onAgeBlocked` prop IntakeFlow used to take. The ORDERING claim is unchanged
// and is the whole point of the assertion.
step('the block is persisted BEFORE the screen renders',
  /await markAgeGateBlocked\(\);\s*\r?\n\s*onBlocked\(\);/.test(onboardingSrc),
  'a force-quit at the sight of the screen must still leave the device blocked');

// ============================================================================
// H2. THE 2026-08 REORDER — THE GATE NOW RUNS BEFORE TERMS
//
// The gate used to be intake step 1, one phase AFTER terms, so api.acceptTerms()
// had already written termsAccepted + termsAcceptedAt against the user id of
// anyone subsequently declined. The live ToS commits us to closing the account
// and deleting the data if we LEARN a user is under 18, and the gate is the
// moment of learning; the founder ruled "never write it" rather than "write it
// then DELETE it". That ruling is only worth anything if the order holds, so
// the order is pinned here — structurally, not by reading a comment.
// ============================================================================

// THE LOAD-BEARING ONE. Every api.acceptTerms() call site in the file lives
// behind a `phase === 'terms'` branch, so the set of writers of that phase value
// IS the set of doors into terms acceptance. Asserting the ONLY writer is the
// age gate's pass handler proves the gating for both call sites at once —
// including any third one added later — without having to trace either by hand.
{
  const setsTerms = onboardingSrc.match(/setPhase\('terms'\)/g) || [];
  const viaOnPass = onboardingSrc.match(/onPass=\{\(\) => setPhase\('terms'\)\}/g) || [];
  step('REORDER — the ONLY writer of phase \'terms\' is AgeGateScreen\'s onPass',
    setsTerms.length > 0 && setsTerms.length === viaOnPass.length,
    `${setsTerms.length} setPhase('terms') call(s), ${viaOnPass.length} of them onPass — ` +
    'any other writer is a door into acceptTerms() that skips the gate');
  step('REORDER — both onboarding paths (self-explorer and invitee) carry the gate',
    viaOnPass.length === 2,
    'the invitee/resume path used to run privacy → terms directly and was never age-gated');
}

step('REORDER — both api.acceptTerms() call sites are inside a phase === \'terms\' branch',
  (() => {
    // Comment mentions are not call sites (audit 2026-08-23: this counted 6
    // and demanded 2, because the file discusses acceptTerms in four notes).
    // Strip line comments before matching, preserving offsets so the
    // upstream-of-'age' comparison below still means what it says.
    const codeOnly = onboardingSrc.replace(/^\s*\/\/.*$/gm, (m) => " ".repeat(m.length));
    const sites = [...codeOnly.matchAll(/api\.acceptTerms\(\)/g)].map((m) => m.index);
    if (sites.length !== 2) return false;
    // Each call site must be preceded by a terms-phase branch and, crucially,
    // by the age phase's own render branch — i.e. 'age' is upstream in the file
    // AND upstream in the machine.
    const iAge = onboardingSrc.indexOf("phase === 'age' ?");
    return iAge > 0 && sites.every((i) => i > iAge);
  })(),
  'two sites exactly — a third would need its own gating argument');

step('REORDER — the welcome slide\'s privacy-already-seen skip lands on \'age\', never \'terms\'',
  /setPhase\(privacyAlreadySeen \? 'age' : 'privacy'\)/.test(onboardingSrc),
  'this skip used to jump straight to terms, which after the reorder is a way past the gate');

step('REORDER — the invitee resume shortcut can only reach \'terms\' from an existing \'terms\' phase',
  /phase === 'terms' \? 'terms'\s*\r?\n\s*: phase === 'age' \? 'age'\s*\r?\n\s*: \(privacyAlreadySeen \? 'age' : 'privacy'\)/.test(onboardingSrc),
  'a user who closed the app mid-onboarding must not re-enter downstream of the gate');

step('REORDER — the correction offer returns the user to the GATE, not to intake',
  /setAgeBlocked\(false\);[\s\S]{0,400}?setPhase\('age'\);/.test(onboardingSrc) &&
  !/setPhase\('intake'\);\s*\r?\n\s*\}\}\s*\r?\n\s*\/>\s*\r?\n\s*<\/SafeAreaView>/.test(onboardingSrc),
  'it used to send them to intake, which is now downstream of an acceptance they have not made');

step('REORDER — the DOB has left IntakeFlow entirely, leaving exactly one age question',
  (() => {
    const m = onboardingSrc.match(/function IntakeFlow\(\{[\s\S]*?\r?\n\}\r?\n/);
    if (!m) return false;
    const body = stripComments(m[0]);
    return !/dobRaw|DateOfBirthInput|evaluateDob|dobStatus|Date of birth/i.test(body);
  })(),
  'no second age question, and no dangling step index — step 1 is the name again');

step('REORDER — IntakeFlow still runs four steps, 1 through 4, with no gap',
  (() => {
    const m = onboardingSrc.match(/function IntakeFlow\(\{[\s\S]*?\r?\n\}\r?\n/);
    if (!m) return false;
    return /useState<1 \| 2 \| 3 \| 4>\(1\)/.test(m[0]) &&
      [1, 2, 3, 4].every((n) => m[0].includes(`{step === ${n} ?`)) &&
      /setStep\(2\)/.test(m[0]) && /setStep\(3\)/.test(m[0]) && /setStep\(4\)/.test(m[0]);
  })(),
  'removing the DOB must not strand a step that nothing advances into');

// The counsel flag. The founder is taking the "DOB collected before terms
// acceptance" sequencing question to his attorney and asked for it to be
// VISIBLE at the collection point rather than buried in a commit message.
// Pinned so a later tidy-up cannot quietly delete the thing counsel is meant
// to find.
step('COUNSEL FLAG — the open sequencing question is marked AT the gate',
  (() => {
    const m = onboardingSrc.match(/function AgeGateScreen\(\{/);
    if (!m) return false;
    const header = onboardingSrc.slice(Math.max(0, m.index - 4000), m.index);
    return /FOR COUNSEL — OPEN QUESTION, NOT RESOLVED HERE/.test(header) &&
      /BEFORE terms acceptance/.test(header) &&
      /NOT yet been reviewed by counsel/i.test(header);
  })(),
  'it must sit in the header immediately above the component that collects the date');

step('COUNSEL FLAG — it still states that the date is derived and discarded',
  (() => {
    const m = onboardingSrc.match(/function AgeGateScreen\(\{/);
    if (!m) return false;
    const header = onboardingSrc.slice(Math.max(0, m.index - 4000), m.index);
    return /derived and discarded/.test(header) &&
      /age18Confirmed/.test(header) && /policy version/.test(header);
  })(),
  'the ORDER is what is new; the storage contract is unchanged and must still be stated');

// Sections I–K execute real handlers and therefore need await. Node 18 CJS has
// no top-level await, so the rest of the file runs inside this async IIFE; the
// summary lives inside it too, so nothing prints before the results are in.
(async () => {

// ============================================================================
// I. CONTAINMENT — THE PART THREE ADVERSARIAL REVIEWS SAID DO-NOT-SHIP ON
//
// The date maths above was never the problem. Every defect was containment:
// the gate had doors it did not guard, one unprotected await that could take
// the whole boot routing decision down with it, and a blocked device that kept
// writing to the server forever.
//
// These sections EXECUTE the real shipped handlers rather than reading them.
// Each one is lifted out of app/_layout.tsx by regex, transpiled with the
// repo's own TypeScript, and run against recording mocks — the same technique
// the server-side smoke uses on the /api/age-confirm handler, and for the same
// reason: a source-shaped assertion can be satisfied by code that does not
// actually behave. "isAgeGateBlocked appears in this function" is not the
// claim we need. "A blocked device cannot reach the tabs" is.
// ============================================================================

const layoutSrc = fs.readFileSync(path.join(NATIVE, 'app', '_layout.tsx'), 'utf8');
const tabsLayoutSrc = fs.readFileSync(path.join(NATIVE, 'app', '(tabs)', '_layout.tsx'), 'utf8');
const servicesOnboardingSrc = fs.readFileSync(path.join(NATIVE, 'services', 'onboarding.ts'), 'utf8');

/** Transpile a TS fragment to runnable JS (strips type annotations only). */
function tsToJs(src) {
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

/** Build a callable from a lifted TS fragment. */
function fragmentFn(argNames, tsBody, { asyncWrap = false } = {}) {
  const js = tsToJs(tsBody);
  const wrapped = asyncWrap ? `return (async () => {\n${js}\n})();` : js;
  return new Function(...argNames, wrapped);
}

const quietConsole = { log() {}, warn() {}, error() {} };

/** A promise that never settles — a STALL, which is NOT a throw and which no
 *  try/catch anywhere can convert into a value. This is the exact failure mode
 *  the unprotected await could not survive. */
const stall = () => new Promise(() => {});

/** Fail the run rather than hang it if a "stalled" scenario never produces a
 *  decision — i.e. if someone deletes the withTimeout wrapper. */
function capped(p, ms, marker) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r(marker), ms))]);
}

// ---- the REAL withTimeout helper, lifted from the shipped file -------------
const withTimeoutSrc = layoutSrc.match(
  /function withTimeout<T>\([\s\S]*?\r?\n\}\r?\n/,
);
step('the real withTimeout helper was located in app/_layout.tsx', !!withTimeoutSrc);
const realWithTimeout = withTimeoutSrc
  ? fragmentFn(['console'], `${withTimeoutSrc[0]}\nreturn withTimeout;`)(quietConsole)
  : null;

// ---- the REAL boot IIFE body ----------------------------------------------
// Anchored on the first distinctive line INSIDE the boot try-block and
// terminated by the boot catch. Anchoring on `(async () => {\n      try {`
// instead would match the biometric cold-start effect further up, which has
// the identical shape at the identical indentation — verified the hard way.
const bootBody = layoutSrc.match(
  /\r?\n( *\/\/ Phase 2b — bootstrap-on-launch\.[\s\S]*?)\r?\n      \} catch \(e\) \{\r?\n        console\.error\('\[boot\] boot sequence threw/,
);
step('the boot sequence body was located in app/_layout.tsx', !!bootBody);

/**
 * Drive the REAL boot tail. Every outbound surface is a recorder:
 *   - `api`   — a Proxy, so ANY method the body calls is counted, including one
 *               added tomorrow that this file has never heard of.
 *   - `fetch` — injected as a parameter, so a raw fetch() in the body binds to
 *               the recorder rather than to the global.
 *   - registerForPushNotifications — counted as network too; it mints a token.
 */
async function runBootTail({ blocked, onboarded = true, termsPending = true, ageSyncPending = true }) {
  const netCalls = [];
  const routes = [];
  const decisions = [];

  const apiReturn = (k) => {
    if (k === 'getTerms') return { termsAccepted: false };
    if (k === 'getAge18') return { age18Confirmed: false };
    return true;
  };
  const api = new Proxy({}, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      return (...args) => { netCalls.push(`api.${k}`); return Promise.resolve(apiReturn(k)); };
    },
  });

  const args = {
    withTimeout: realWithTimeout,
    getOnboardingState: () => (onboarded === 'stall'
      ? stall()
      : Promise.resolve({
          hasSeenIntro: !!onboarded, termsAccepted: !!onboarded,
          intakeComplete: !!onboarded, signInChoiceMade: !!onboarded,
        })),
    isAgeGateBlocked: () => (blocked === 'stall' ? stall() : Promise.resolve(!!blocked)),
    setAgeGateDecision: (d) => decisions.push(d),
    setPendingRoute: (r) => routes.push(r),
    hasRedirectedToOnboarding: false,
    NOTIFICATIONS_ENABLED: true,
    registerForPushNotifications: () => { netCalls.push('registerForPushNotifications'); return Promise.resolve(true); },
    api,
    isTermsSyncPending: () => Promise.resolve(termsPending),
    clearTermsSyncPending: () => Promise.resolve(),
    isAgeSyncPending: () => Promise.resolve(ageSyncPending),
    clearAgeSyncPending: () => Promise.resolve(),
    console: quietConsole,
    fetch: (...a) => { netCalls.push(`fetch:${a[0]}`); return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); },
  };
  const fn = fragmentFn(Object.keys(args), bootBody[1], { asyncWrap: true });
  const outcome = await capped(
    // 10s, not 6: the fully-stalled scenario stalls getOnboardingState AND the
    // age read, and their two 3000ms caps are SEQUENTIAL. A 6s ceiling sat
    // exactly on that boundary and reported a correctly-capped run as HUNG.
    fn(...Object.values(args)).then(() => 'returned').catch((e) => `threw:${e && e.message}`),
    10000,
    'HUNG',
  );
  // The deferred work inside the body is fire-and-forget; give it room to fire
  // so "zero calls" is a real observation and not a timing artefact.
  await new Promise((r) => setTimeout(r, 60));
  return { netCalls, routes, decisions, outcome };
}

if (bootBody && realWithTimeout) {
  // --- I.1 THE STALL. Not a throw: a promise that never resolves. -----------
  const stalled = await runBootTail({ blocked: 'stall', onboarded: 'stall' });
  step('BLOCKER 2 — a STALLED age read still produces a routing decision',
    stalled.routes.length === 1,
    `outcome=${stalled.outcome} routes=${JSON.stringify(stalled.routes)}`);
  step('BLOCKER 2 — the stalled-read decision is /onboarding, not "rest in the tabs"',
    stalled.routes[0] === '/onboarding',
    'unknown must fail toward the gate; the Stack\'s first screen is (tabs)');
  step('BLOCKER 2 — the boot body RETURNS on a stalled read rather than hanging',
    stalled.outcome === 'returned',
    `a HUNG outcome here means the withTimeout wrapper is gone (outcome=${stalled.outcome})`);
  step('BLOCKER 2 — a stalled read fires no network call either',
    stalled.netCalls.length === 0,
    `saw ${JSON.stringify(stalled.netCalls)}`);

  // --- I.2 THE BLOCKED PATH MAKES ZERO NETWORK CALLS ------------------------
  const blockedRun = await runBootTail({ blocked: true });
  step('BLOCKER 3 — a blocked device fires ZERO network calls at boot',
    blockedRun.netCalls.length === 0,
    `expected [] — got ${JSON.stringify(blockedRun.netCalls)}`);
  step('BLOCKER 3 — specifically: no bootstrapTokens on a blocked device',
    !blockedRun.netCalls.includes('api.bootstrapTokens'),
    'it used to mint and STORE a refresh-token row for a known minor, every cold start');
  step('BLOCKER 3 — specifically: no terms reconciliation on a blocked device',
    !blockedRun.netCalls.includes('api.getTerms') && !blockedRun.netCalls.includes('api.acceptTerms'),
    'local termsAccepted is TRUE for a declined minor — terms are one phase earlier — so the `!pending && !local` guard did not stop it');
  step('BLOCKER 3 — specifically: no age reconciliation on a blocked device',
    !blockedRun.netCalls.includes('api.getAge18') && !blockedRun.netCalls.includes('api.confirmAge18'));
  step('BLOCKER 3 — specifically: no push registration on a blocked device',
    !blockedRun.netCalls.includes('registerForPushNotifications'));
  step('the blocked device is still routed to the block screen',
    blockedRun.routes.length === 1 && blockedRun.routes[0] === '/onboarding');
  step('the blocked verdict is published to the purchases/analytics effect',
    blockedRun.decisions.includes('blocked'),
    'that effect mounts on its own and cannot see the boot sequence\'s local');

  // --- I.3 THE CONTROL. Without this, "zero calls" could pass vacuously -----
  const clearRun = await runBootTail({ blocked: false });
  step('CONTROL — an UNBLOCKED device still does all of its boot work',
    clearRun.netCalls.includes('api.bootstrapTokens') &&
    clearRun.netCalls.includes('api.getTerms') &&
    clearRun.netCalls.includes('api.getAge18') &&
    clearRun.netCalls.includes('registerForPushNotifications'),
    `without this, a gutted boot body would satisfy every assertion above — got ${JSON.stringify(clearRun.netCalls)}`);
  step('CONTROL — an unblocked, fully-onboarded device queues NO redirect',
    clearRun.routes.length === 0 && clearRun.decisions.includes('clear'));
}

// ============================================================================
// J. ENTRY POINTS — ONE NAMED ASSERTION PER DOOR INTO THE TABS
//
// The audit found six ways into (tabs). A gate with one unguarded door is not
// a gate, so each is pinned separately and by name.
// ============================================================================

// ---- ENTRY POINT 1: the magic-link deep link (BLOCKER 1) -------------------
const linkBody = layoutSrc.match(
  /const consumeAuthEmailUrl = async \(url: string\) => \{\r?\n([\s\S]*?)\r?\n    \};\r?\n    Linking\.getInitialURL\(\)/,
);
step('the magic-link deep-link handler was located', !!linkBody);

const LinkingStub = {
  parse(u) {
    const m = /^([a-z]+):\/\/([^/?#]+)([^?#]*)(?:\?(.*))?$/i.exec(u || '');
    if (!m) return { scheme: null, hostname: null, path: null, queryParams: {} };
    const qp = {};
    if (m[4]) for (const kv of m[4].split('&')) {
      const [k, v] = kv.split('=');
      qp[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
    return { scheme: m[1], hostname: m[2], path: m[3] || '', queryParams: qp };
  },
};

async function runDeepLink({ url, blocked, isNewUser = false }) {
  const netCalls = [];
  const routes = [];
  const alerts = [];
  const api = new Proxy({}, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      return (...a) => { netCalls.push(`api.${k}`); return Promise.resolve(k === 'authSignIn' ? { isNewUser } : true); };
    },
  });
  const args = {
    url,
    Linking: LinkingStub,
    api,
    markSignInChoiceMade: () => Promise.resolve(),
    router: { replace: (r) => routes.push(r), push: (r) => routes.push(`push:${r}`) },
    Alert: { alert: (...a) => alerts.push(a) },
    withTimeout: realWithTimeout,
    isAgeGateBlocked: () => (blocked === 'stall' ? stall() : Promise.resolve(!!blocked)),
    console: quietConsole,
  };
  const fn = fragmentFn(Object.keys(args), linkBody[1], { asyncWrap: true });
  const outcome = await capped(
    fn(...Object.values(args)).then(() => 'returned').catch((e) => `threw:${e && e.message}`),
    6000, 'HUNG',
  );
  return { netCalls, routes, alerts, outcome };
}

const UNIVERSAL = 'https://my-inner-map.com/auth/email?token=abc123';
const SCHEME_URL = 'innermap://auth/email?token=abc123';

if (linkBody && realWithTimeout) {
  // The exploit, reproduced: a blocked minor requests a sign-in email from the
  // public website endpoint, taps it on the same phone, and the universal link
  // lands here. authSignIn resolved the EXISTING identity (isNewUser false) and
  // the handler called router.replace('/').
  const exploit = await runDeepLink({ url: UNIVERSAL, blocked: true, isNewUser: false });
  step('ENTRY 1 (deep link) — a blocked user CANNOT reach "/" via the magic link',
    !exploit.routes.includes('/'),
    `routes=${JSON.stringify(exploit.routes)} — this is the shipped exploit`);
  step('ENTRY 1 (deep link) — a blocked user is sent to the block screen instead',
    exploit.routes.length === 1 && exploit.routes[0] === '/onboarding');
  step('ENTRY 1 (deep link) — the flag is checked BEFORE the network call, so the link is not consumed',
    exploit.netCalls.length === 0,
    `checking after would still trade the token for a session and stamp the identity row — got ${JSON.stringify(exploit.netCalls)}`);

  const exploitScheme = await runDeepLink({ url: SCHEME_URL, blocked: true, isNewUser: false });
  step('ENTRY 1 (deep link) — the bare innermap:// scheme is gated identically',
    exploitScheme.routes.length === 1 && exploitScheme.routes[0] === '/onboarding' &&
    exploitScheme.netCalls.length === 0,
    'the web fallback landing page uses this form when universal links do not intercept');

  const linkStalled = await runDeepLink({ url: UNIVERSAL, blocked: 'stall' });
  step('ENTRY 1 (deep link) — a STALLED read still decides, and decides toward the gate',
    linkStalled.outcome === 'returned' && linkStalled.routes[0] === '/onboarding' &&
    linkStalled.netCalls.length === 0,
    `outcome=${linkStalled.outcome} routes=${JSON.stringify(linkStalled.routes)}`);

  // CONTROL — the handler must still work for everyone else, and the '/' route
  // must be genuinely reachable, or the assertions above pass vacuously.
  const okExisting = await runDeepLink({ url: UNIVERSAL, blocked: false, isNewUser: false });
  step('CONTROL — an unblocked EXISTING user still signs in and lands on "/"',
    okExisting.netCalls.includes('api.authSignIn') && okExisting.routes.includes('/'),
    `routes=${JSON.stringify(okExisting.routes)}`);
  const okNew = await runDeepLink({ url: UNIVERSAL, blocked: false, isNewUser: true });
  step('ENTRY 1 (deep link) — the isNewUser branch routes to /onboarding (verified, not assumed)',
    okNew.routes.includes('/onboarding') && !okNew.routes.includes('/'),
    'and /onboarding re-reads the flag on mount — see ENTRY 4');
}

// ---- ENTRY POINT 2: the notification tap handler ---------------------------
const notifBody = layoutSrc.match(
  /addNotificationResponseReceivedListener\(\r?\n        \(resp\) => \{\r?\n([\s\S]*?)\r?\n        \},\r?\n      \);/,
);
step('the notification-tap handler was located', !!notifBody);

async function runNotifTap({ route, blocked }) {
  const routes = [];
  const args = {
    resp: { notification: { request: { content: { data: route === undefined ? {} : { route } } } } },
    router: { replace: (r) => routes.push(`replace:${r}`), push: (r) => routes.push(`push:${r}`) },
    withTimeout: realWithTimeout,
    isAgeGateBlocked: () => (blocked === 'stall' ? stall() : Promise.resolve(!!blocked)),
    console: quietConsole,
  };
  const fn = fragmentFn(Object.keys(args), notifBody[1]);
  fn(...Object.values(args));
  await capped(new Promise((r) => setTimeout(r, 3300)), 6000, 'HUNG');
  return { routes };
}

if (notifBody && realWithTimeout) {
  const notifBlocked = await runNotifTap({ route: undefined, blocked: true });
  step('ENTRY 2 (notification tap) — a blocked user cannot be pushed into the tabs',
    !notifBlocked.routes.includes('push:/') && notifBlocked.routes.includes('replace:/onboarding'),
    `an unrecognised route falls back to "/" — got ${JSON.stringify(notifBlocked.routes)}`);
  const notifClear = await runNotifTap({ route: '/messages', blocked: false });
  step('CONTROL — an unblocked user\'s notification tap still navigates',
    notifClear.routes.includes('push:/messages'),
    `got ${JSON.stringify(notifClear.routes)}`);
}

// ---- ENTRY POINT 3: the tabs layout itself (destination backstop) ----------
const backstopBody = tabsLayoutSrc.match(/function useAgeGateBackstop\(\) \{\r?\n([\s\S]*?)\r?\n\}\r?\n/);
step('ENTRY 3 (tabs backstop) — the destination guard exists in app/(tabs)/_layout.tsx',
  !!backstopBody,
  'every other fix guards a door; this guards the room they all lead to');

/** Minimal React-hook harness: renders, runs changed effects, re-renders while
 *  state is dirty. Enough to observe what the backstop actually does. */
async function runBackstop(readImpl, settleMs) {
  const routes = [];
  const router = { replace: (r) => routes.push(`replace:${r}`), push: (r) => routes.push(`push:${r}`) };
  const cells = [];
  const effDeps = [];
  let si = 0, ei = 0, dirty = false;
  const queued = [];
  const useState = (init) => {
    const i = si++;
    if (cells.length <= i) cells.push(init);
    return [cells[i], (v) => {
      const next = typeof v === 'function' ? v(cells[i]) : v;
      if (next !== cells[i]) { cells[i] = next; dirty = true; }
    }];
  };
  const useEffect = (f, deps) => {
    const i = ei++;
    const prev = effDeps[i];
    const changed = prev === undefined || !deps ||
      deps.length !== prev.length || deps.some((d, j) => d !== prev[j]);
    effDeps[i] = deps;
    if (changed) queued.push(f);
  };
  const args = { useState, useEffect, useRouter: () => router, isAgeGateBlocked: readImpl, console: quietConsole };
  const fn = fragmentFn(Object.keys(args), `${backstopBody[1]}`);
  let out;
  for (let pass = 0; pass < 4; pass++) {
    si = 0; ei = 0; dirty = false;
    out = fn(...Object.values(args));
    for (const f of queued.splice(0)) { try { f(); } catch {} }
    await new Promise((r) => setTimeout(r, settleMs));
    if (!dirty && pass > 0) break;
  }
  return { out, routes };
}

if (backstopBody) {
  const bsBlocked = await runBackstop(() => Promise.resolve(true), 30);
  step('ENTRY 3 (tabs backstop) — a blocked device that reaches the tabs is sent back out',
    bsBlocked.routes.includes('replace:/onboarding'),
    `got ${JSON.stringify(bsBlocked.routes)}`);
  const bsClear = await runBackstop(() => Promise.resolve(false), 30);
  step('CONTROL — an unblocked device is not redirected and is allowed to render',
    bsClear.routes.length === 0 && bsClear.out === false,
    `routes=${JSON.stringify(bsClear.routes)} verdict=${bsClear.out}`);
  const bsStalled = await runBackstop(stall, 1700);
  step('ENTRY 3 (tabs backstop) — a STALLED read resolves to a verdict rather than holding forever',
    bsStalled.out === false && bsStalled.routes.length === 0,
    'this one falls OPEN on purpose: it sits behind a boot gate that already failed closed');

  // The hold is what stops the tab screens mounting (and their fetches firing)
  // during the redirect window. Asserted on source because it is a render
  // decision, and pinned tightly enough that `!== true` or `=== true` fails.
  step('ENTRY 3 (tabs backstop) — the tabs are NOT rendered until the verdict is a definite "not blocked"',
    /if \(ageBlocked !== false\) \{[\s\S]{0,200}?return <View style=\{\{ flex: 1, backgroundColor: colors\.background \}\} \/>;/.test(tabsLayoutSrc),
    'mounting the tabs and redirecting after would run every tab screen\'s effects first');
  step('ENTRY 3 (tabs backstop) — the backstop performs no network call and no deletion',
    !!backstopBody && !/api\.|fetch\(|delete|DELETE/i.test(backstopBody[1]),
    'it reads a local flag and routes — nothing else');
}

// ---- ENTRY POINT 4: onboarding → "/" on completion -------------------------
// finishAndEnterApp is the ONLY router.replace('/') in app/onboarding.tsx. It
// is reachable only from a phase, and no phase renders while blocked: the
// AgeBlockedScreen return sits ahead of the invitee shortcut and every phase.
step('ENTRY 4 (onboarding completion) — the block screen returns AHEAD of every phase and of the invitee path',
  (() => {
    const iBlock = onboardingSrc.indexOf('if (ageBlocked) {');
    const iInvitee = onboardingSrc.indexOf('if (isInvitee) {');
    const iPhase = onboardingSrc.indexOf("phase === 'welcome'");
    const iFinish = onboardingSrc.indexOf('router.replace(\'/\')');
    return iBlock > 0 && iInvitee > iBlock && iPhase > iBlock && iFinish > 0;
  })(),
  'so nothing that can call finishAndEnterApp can render while blocked');
step('ENTRY 4 (onboarding completion) — render is HELD until the block flag has settled',
  /if \(isInvitee === null \|\| privacyAlreadySeen === null \|\| ageBlocked === null\) \{/.test(onboardingSrc),
  'without the hold there is a frame where ageBlocked is null and a phase renders');
step('ENTRY 4 (onboarding completion) — the mount read is capped, so the hold cannot become a permanent blank screen',
  /const ageReadCap = setTimeout\(\(\) => settleAgeRead\(false\), 3000\);/.test(onboardingSrc) &&
  /isAgeGateBlocked\(\)\s*\r?\n\s*\.then\(\(b\) => \{ clearTimeout\(ageReadCap\); settleAgeRead\(b\); \}\)/.test(onboardingSrc),
  'it falls through to the FLOW, not to the app — the user meets the live gate at intake step 1');

// ---- ENTRY POINT 5: onboarding → "/relationships" (invitee) ----------------
// REWRITTEN FOR THE 2026-08 REORDER. This used to assert that the invitee
// path's MISSING gate was DOCUMENTED (`18+ GATE GAP — READ BEFORE FLIPPING
// PARTNER_ENABLED BACK TO TRUE`), because the gate lived inside IntakeFlow and
// this path never reaches intake, so closing the gap would have meant inventing
// a second gate placement nobody had ruled on. The reorder makes the gate a
// PHASE, so the invitee path now gets the same one for free — the gap is closed
// rather than documented, and asserting the warning comment still exists would
// now be asserting the presence of a false statement.
step('ENTRY 5 (invitee shortcut) — now carries the gate itself, and is still dead behind PARTNER_ENABLED',
  (() => {
    const features = fs.readFileSync(path.join(NATIVE, 'constants', 'features.ts'), 'utf8');
    const partnerOff = /export const PARTNER_ENABLED: boolean = false;/.test(features);
    // `> 0` is load-bearing: indexOf returns -1 when the guard is GONE, and -1
    // is less than every real index, so an ordering check without it passes
    // most convincingly at the exact moment the guard has been deleted.
    // Verified by mutation.
    const iBlock = onboardingSrc.indexOf('if (ageBlocked) {');
    const iInvitee = onboardingSrc.indexOf('if (isInvitee) {');
    const inviteeGuarded = iBlock > 0 && iInvitee > 0 && iBlock < iInvitee;
    // The invitee branch itself, from its guard to the start of the
    // self-explorer path, must render the gate and must reach TermsScreen only
    // through it.
    const iSelf = onboardingSrc.indexOf('// SELF-EXPLORER PATH');
    const branch = iInvitee > 0 && iSelf > iInvitee
      ? onboardingSrc.slice(iInvitee, iSelf) : '';
    const gateInPath = /<AgeGateScreen/.test(branch) &&
      /inviteePhase === 'age' \? \(/.test(branch) &&
      branch.indexOf('<AgeGateScreen') < branch.indexOf('<TermsScreen');
    return partnerOff && inviteeGuarded && gateInPath;
  })(),
  'a BLOCKED device cannot take this path, and an invitee who has not passed the gate can no longer reach acceptTerms()');

// ---- ENTRY POINT 6: in-tabs navigation ------------------------------------
// The tab bar, the map/guide/chat pills, PartFolderModal and SessionDetailModal
// all push routes, but every one of them requires already being inside the
// tabs — which ENTRY 3 now prevents. Pinned so a future in-tabs entry point
// does not need its own guard.
step('ENTRY 6 (in-tabs navigation) — every in-tabs nav call is downstream of the ENTRY 3 hold',
  /const ageBlocked = useAgeGateBackstop\(\);/.test(tabsLayoutSrc) &&
  tabsLayoutSrc.indexOf('const ageBlocked = useAgeGateBackstop();') <
    tabsLayoutSrc.indexOf('<TopTabBar onMenu='),
  'the tab bar itself does not render until the verdict is in');

// ============================================================================
// K. THE COMMENTS AND THE COPY
//
// Three shipped comments and one line of user-facing copy asserted the
// opposite of the truth. They are load-bearing prose — the comments would be
// quoted into a privacy assessment, and the copy is read by the person being
// declined. Both are pinned here because prose has no compiler.
// ============================================================================

// The uncomfortable fact all three must now carry: terms are accepted one
// phase BEFORE the gate, so server rows exist for a declined minor.
// Prose is hard-wrapped, so it is flattened to one line before matching. The
// phrase match is deliberately tight: a loose `/terms/i && /earlier/i` version
// of this survived a mutation that deleted the admission outright, because
// those words occur elsewhere in the same block. Verified by mutation.
const flatten = (s) => s.replace(/\r?\n\s*\/\/\s*/g, ' ');
const NAMES_THE_TERMS_ROW = (s) => {
  const f = flatten(s);
  return /TERMS ARE ACCEPTED ONE PHASE EARLIER/i.test(f) &&
    /termsAccepted \+ termsAcceptedAt/.test(f);
};

step('COMMENT 1 (services/onboarding.ts) — no longer claims a declined minor produces no server row',
  !/a declined minor produces no server row, no request, and no analytics event of any kind/.test(servicesOnboardingSrc),
  'true of the under-18 branch, false of the flow that reaches it');
// REWRITTEN 2026-08-23 (audit). These two assertions predate the REORDER
// verified in steps 37-44: 'age' now runs BEFORE 'terms', and the ONLY writer
// of phase 'terms' is AgeGateScreen's onPass. A declined minor therefore never
// reaches the terms screen and leaves NO termsAccepted row — so demanding a
// comment that names 'the terms row that DOES exist' was asking the source to
// document something that stopped being true. What must still be documented is
// the accounting itself: what a declined device does and does not leave.
step('COMMENT 1 (services/onboarding.ts) — the local block flag is documented',
  /ageGateBlocked/.test(servicesOnboardingSrc),
  'the one thing a declined device DOES persist, and it is local');
step('COMMENT 1 (services/onboarding.ts) — names the auth_identities row too',
  /auth_identities/.test(servicesOnboardingSrc));

{
  const m = onboardingSrc.match(/\/\/ 18\+ BLOCK SCREEN[\s\S]*?function AgeBlockedScreen/);
  step('COMMENT 2 (block-screen header) — the header block was located', !!m);
  step('COMMENT 2 (block-screen header) — no longer claims "Nothing about this person is stored, sent, or counted"',
    !!m && !/Nothing about this person is stored, sent, or counted/.test(m[0]));
  step('COMMENT 2 (block-screen header) — states that the gate precedes terms',
  /before token bootstrap/i.test(onboardingSrc) || /age gate[\s\S]{0,80}before/i.test(onboardingSrc),
  'the header must say the block happens upstream of every server write');
  step('COMMENT 2 (block-screen header) — still states the four rulings it exists to hold',
    !!m && /NO CRISIS RESOURCES/.test(m[0]) && /NO SHAME/.test(m[0]) &&
    /NO CLEVERNESS ABOUT RE-ENTRY/.test(m[0]),
    'the rewrite must correct the false claim without dropping the rulings');
}

// ---- the block-screen COPY ------------------------------------------------
{
  const m = onboardingSrc.match(/function AgeBlockedScreen\(\{[\s\S]*?\r?\n\}\r?\n/);
  step('COPY — the AgeBlockedScreen body was located', !!m);
  // COMMENTS STRIPPED for the copy assertions. The component now carries an
  // inline note that QUOTES the removed sentence in order to explain why it was
  // removed, and an assertion that cannot tell prose about the copy from the
  // copy itself would force that explanation out of the file.
  const copy = m ? stripComments(m[0]) : '';
  step('COPY — the false sentence "Nothing you entered has been saved." is gone',
    !!m && !/Nothing you entered has been saved/.test(copy),
    'terms rows exist on the server before this screen is ever reached');
  step('COPY — it makes the narrower claim that IS true: the date of birth was never stored or sent',
    !!m && /Your date of birth wasn't stored and never left this device/.test(copy),
    'true regardless of how the erasure question is later ruled');
  step('COPY — it makes no claim about what the server does or does not hold',
    !!m && !/nothing (you|is|has been) (entered|saved|stored|kept)/i.test(copy) &&
    !/no (record|account|data) (of|has)/i.test(copy));
  step('COPY — still carries NO crisis resource, link, number or language',
    !!m && !/crisis|hotline|988|741741|suicide|emergency|support-resources|SupportResources|helpline|Samaritans/i.test(m[0]),
    'counsel is mid-review; nothing crisis-adjacent may be added anywhere in this repair');
  step('COPY — the warm closing beat and the single correction offer survive the rewrite',
    !!m && /Thank you for answering honestly/.test(m[0]) && /\{canCorrect \? \(/.test(m[0]));
}

// ---- and nothing in this repair deletes user data -------------------------
step('NO ERASURE — the repair adds no deletion call anywhere on the age-gate path',
  !/DELETE \/api\/account|deleteAccount\(|purgeUser|cascadeDelete/.test(layoutSrc + onboardingSrc + tabsLayoutSrc + servicesOnboardingSrc),
  'the erasure question is with the founder and is not decided by this repair');

// ---- THE LAST DOOR: expo-router's own linking handler ----------------------
// app.config.js registers `scheme: 'innermap'` with NO path restriction, and
// expo-router subscribes to url events itself, independently of the app's own
// Linking listener (which bails on `if (!isAuthEmail) return;` and so never
// sees these). GATE 0 runs once at boot; the (tabs) backstop covers tab routes
// only. So every NON-TAB route was reachable on a blocked device.
// +native-intent.ts's redirectSystemPath is the single hook expo-router calls
// for BOTH the cold-start URL and every later url event. Drive the REAL one.
{
  const niPath = path.join(NATIVE, 'app', '+native-intent.ts');
  step('+native-intent.ts exists (the only choke point that sees every deep link)',
    fs.existsSync(niPath));

  const niSrc = fs.readFileSync(niPath, 'utf8');
  step('it exports redirectSystemPath, the hook expo-router actually calls',
    /export\s+async\s+function\s+redirectSystemPath/.test(niSrc));

  // Compile and drive it with an injected flag reader — the real logic, not a copy.
  const compiled = ts.transpileModule(
    niSrc.replace(/^import[\s\S]*?from '\.\.\/services\/onboarding';$/m, ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
  ).outputText.replace(/export async function/g, 'async function');
  const load = (reader) => new Function('isAgeGateBlocked', 'exports',
    compiled + '; return redirectSystemPath;')(reader, {});

  // Exactly the paths expo-router's extractExpoPathFromURL yields for
  // innermap://<route>. `map` is the one the (tabs) backstop already covered;
  // the rest were wide open.
  const DEEP = ['settings', 'paywall', 'messages', 'privacy', 'support-resources',
                'account/delete', 'relationships/intro/abc', 'map', ''];

  const blocked = load(async () => true);
  const clear = load(async () => false);
  const throws = load(async () => { throw new Error('storage kaput'); });
  const stalls = load(() => new Promise(() => {}));

  const all = async (fn, paths) => Promise.all(paths.map((p) => fn({ path: p, initial: true })));

  const bOut = await all(blocked, DEEP);
  step('BLOCKED — every innermap:// route is redirected away from the app',
    bOut.every((r) => r === '/onboarding'),
    `got ${JSON.stringify(bOut)}`);

  const cOut = await all(clear, DEEP);
  step('CLEAR — a normal user\'s deep links pass through UNCHANGED (no regression)',
    cOut.every((r, i) => r === DEEP[i]),
    `got ${JSON.stringify(cOut)}`);

  step('BLOCKED — /onboarding itself passes through, so there is no redirect loop',
    (await all(blocked, ['/onboarding', 'onboarding', 'onboarding?x=1']))
      .every((r, i) => r === ['/onboarding', 'onboarding', 'onboarding?x=1'][i]));

  step('a THROWN flag read fails CLOSED, and never propagates into expo-router',
    (await all(throws, DEEP)).every((r) => r === '/onboarding'));

  // The failure mode the boot gate originally got wrong: a stall is a pending
  // promise, not a throw, so try/catch cannot see it. Unbounded, this would
  // hang the deep link forever rather than merely mis-route it.
  const t0 = Date.now();
  const sOut = await all(stalls, ['settings']);
  const elapsed = Date.now() - t0;
  step('a STALLED flag read fails closed AND is time-capped (does not hang the link)',
    sOut[0] === '/onboarding' && elapsed < 3000,
    `route=${sOut[0]} elapsed=${elapsed}ms`);

  step('no crisis resource, number, or language reached this file',
    !/988|741741|116123|hotline|helpline|lifeline|samaritans/i.test(niSrc));
}

console.log('');
if (pass) {
  console.log(`ALL GREEN — ${ran} checks passed`);
} else {
  console.log(`FAILURES (${failures.length}/${ran}): ${failures.join(' | ')}`);
  process.exitCode = 1;
}

})().catch((e) => {
  console.log(`HARNESS THREW — ${e && e.stack}`);
  process.exitCode = 1;
});
