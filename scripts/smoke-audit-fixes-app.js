// THE APP-SIDE AUDIT FIXES (founder rulings 2026-09-06).
//
//   1. the age-gate bypass — a slow storage read waived the terms screen
//   2. the frozen paywall — nothing parsed the trial 402
//   3. the opening mode boxes (retired 2026-11-09: M2 is the app, one prompt)
//   4. the in-app privacy summary cited a policy version that never existed
//   5. the journal is the only ENCRYPTED store on the device — the code-side
//      guard behind a Privacy Policy correction
//      (4 and 5 added 2026-09-10; not among the 09-06 rulings)
//
// Every assertion here is WRITTEN to fail when its fix is reverted. The lesson
// being applied is the trial-freeze smoke, whose headline check greped for a
// string that also appeared in nine unrelated crisis-logging calls and so could
// not detect the deletion of the three gates it claimed to guard.
//
// WHAT HAS ACTUALLY BEEN REVERT-CHECKED, as opposed to written to be. This
// header used to claim all of them and that was not true -- the audit found it,
// which is the same defect the file exists to prevent, one level up.
//
//   checked  the anti-drift pair, two mutations. (a) Reword MODE_BLURB.light
//            and paste the NEW wording into ModeBoxes: this file goes red,
//            while the previous hardcoded-literal version found 0 copies and
//            passed. (b) Rename the MODE_BLURB export: the parse guard goes
//            red, so the pair can never silently measure an empty list.
//   checked  the age-gate unknown-state default (2026-09-06).
//   checked  section 4, two mutations (2026-09-10). (a) LEGAL_DOCS_LAST_UPDATED
//            back to 'July 1, 2026' in utils/legalDocs.ts: the first assertion
//            goes red. (b) The literal date back into the rendered Text --
//            even the CORRECT date: the second assertion goes red on the digit
//            guard, which is the point. The defect was a second copy of the
//            fact, not a wrong character in it.
//   checked  section 5, one mutation (2026-09-10). A second createMMKV call in
//            utils/encryptedStorage.ts: the instance-count clause goes red.
//   NOT YET  the remaining assertions in sections 1 and 2. They are written to
//            be falsifiable and are believed to be, but believed is not
//            measured. Do not read a green run here as proof of more than the
//            two above until each has been reverted and seen to go red.
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

// ALL THREE 402 transports. Counted, so removing one is caught.
//
// This asserted 2 until 2026-09-10 and was RIGHT about the two it knew: the
// chat JSON fallback and the guide xhr. It could not see the one that
// mattered most -- the STREAMING chat transport, which is what actually runs
// (STREAMING_ENABLED, api.ts:29). Its 402 branch only ever called
// parseBudgetRefusal, which returns null for a trial payload, so day 8 in
// main chat rendered "Something went wrong on my end" with a retry pill. The
// third site is emitPaymentRequired(), which tries trial first and falls back
// to budget.
{
  // Counted on the exact argument names so the sites cannot overlap --
  // /parseTrialFreeze\(raw/ matches `rawBody` too.
  const calls = (API.match(/const trial = parseTrialFreeze\(raw\);/g) || []).length
    + (API.match(/const trial = parseTrialFreeze\(rawBody\);/g) || []).length;
  ok(`all three 402 sites parse the trial payload (found ${calls})`, calls === 3,
    'expected 3 — the chat fetch path, the guide xhr path, and the streaming transport');
  // And the streaming 402 branch must route through it rather than going
  // straight to the budget parser, which is the bug this replaced.
  ok('the streaming 402 branch routes through emitPaymentRequired',
    /if \(!emitPaymentRequired\(raw\)\) cb\.onError\('chat 402'\);/.test(API),
    'a budget-only parse here is what produced the generic error on day 8');
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
console.log('\n=== 3. the opening mode boxes (retired in 1.4.0) ===');
// ===========================================================================
// The boxes and the mode control were deleted when M2 became the app (founder,
// 2026-11-09): one prompt, no way of working to pick. Their absence is owned
// by check-opening-question-withdrawn.js and check-working-mode-control.js;
// this section only records that the fix it guarded has nothing left to guard.
ok('the boxes and the control are gone, so there is no second copy of the mode wording to drift',
  !fs.existsSync(path.join(__dirname, '..', 'components', 'ModeBoxes.tsx'))
    && !fs.existsSync(path.join(__dirname, '..', 'components', 'WorkingModeControl.tsx')));

// ===========================================================================
console.log('\n=== 4. the in-app summary cites a policy version that exists ===');
// ===========================================================================
// app/privacy.tsx read "Reflects the policy last updated: July 1, 2026" while
// both published documents read "Last Updated: July 3, 2026" and the server
// stamps every age attestation with AGE_POLICY_VERSION = "2026-07-03". July 1
// is not a version of anything. That line is the ONLY thing in the app that
// would ever tell a reader the summary had fallen behind the binding document,
// and it named text that has never existed — so it could not have told them
// however far the summary drifted. Nothing asserted it, which is why it was
// wrong from the day the screen shipped.
//
// THE DATE IS PINNED HERE ON PURPOSE, and that is a trade. A shape-only check
// ("any Month D, YYYY") would have stayed green through the whole defect. The
// cost is that a legitimate re-dating of the policy turns this red; the BUMP
// list in utils/legalDocs.ts names this file so whoever re-dates it is told.
const LEGALDOCS = read('utils/legalDocs.ts');
const PRIVACY = read('app/privacy.tsx');

// RE-DATED 2026-11-09 (policy finding F2): counsel's rewrite (inner-map-legal
// 883967e) dated both documents 13 October 2026, and the app said July 3 for
// four weeks. The literal is the documents' own form now.
// RE-DATED AGAIN 2026-11-09: the documents were republished "Last Updated:
// 9 November 2026" for two corrections (the timezone lines removed,
// ElevenLabs narrowed), Effective Date still 13 October 2026. Not a material
// change: the notice's date and the acceptance version stay 13 October (F2
// block below).
ok('the date is declared once, and matches the published documents',
  /export const LEGAL_DOCS_LAST_UPDATED = '9 November 2026';/.test(LEGALDOCS),
  'privacy-policy.html:55 and terms-of-service.html:49 both read "Last Updated: 9 November 2026"');

// NARROW SLICE, on purpose, and over EVERY occurrence rather than the first.
// The constant's own header comment quotes the WRONG date in order to explain
// what was wrong with it, so a whole-file assertion over either file would be
// measuring the rationale rather than the copy. matchAll rather than match
// because a second styles.updated Text added above line 163 would otherwise be
// the one measured, and a re-hardcoded date below it would go unseen.
{
  const lines = [...PRIVACY.matchAll(/<Text style=\{styles\.updated\}>[^<]*<\/Text>/g)].map((m) => m[0]);
  ok('the summary screen renders the constant, never a literal date',
    lines.length > 0 &&
    lines.every((l) => /\{LEGAL_DOCS_LAST_UPDATED\}/.test(l) && !/\d/.test(l)),
    lines.length
      ? `rendered: ${lines.join(' | ')}`
      : 'the "Reflects the policy last updated" line is gone entirely');
}

ok('...and it is imported, not shadowed by a local re-declaration',
  /import \{[^}]*LEGAL_DOCS_LAST_UPDATED[^}]*\} from '\.\.\/utils\/legalDocs';/.test(PRIVACY) &&
  !/const LEGAL_DOCS_LAST_UPDATED/.test(PRIVACY),
  'a local const would re-open exactly the drift the shared constant closes');

// ---- F2 (2026-11-09): the version accepted, and the notice when it changes ----
{
  ok('the policy version is the last MATERIAL change, as a key',
    /export const LEGAL_POLICY_VERSION = '2026-10-13';/.test(LEGALDOCS));
  ok('...and the notice names that change in words, apart from the Last Updated date',
    /export const LEGAL_POLICY_CHANGED_ON = '13 October 2026';/.test(LEGALDOCS));
  const LEGAL = path.join(__dirname, '..', '..', 'inner-map-legal');
  const LEGAL_ALT = path.join(__dirname, '..', '..', '..', '..', '..', 'inner-map-legal');
  const dir = [LEGAL, LEGAL_ALT].find((d) => fs.existsSync(path.join(d, 'privacy-policy.html')));
  if (dir) {
    const pp = fs.readFileSync(path.join(dir, 'privacy-policy.html'), 'utf8');
    const tos = fs.readFileSync(path.join(dir, 'terms-of-service.html'), 'utf8');
    ok('...and the published documents carry the Last Updated date, with 13 October 2026 still the Effective Date',
      /Last Updated:<\/strong> 9 November 2026/.test(pp) && /Last Updated:<\/strong> 9 November 2026/.test(tos)
        && /Effective Date:<\/strong> 13 October 2026/.test(pp) && /Effective Date:<\/strong> 13 October 2026/.test(tos),
      'read from ' + dir);
  } else {
    console.log('  SKIP inner-map-legal not beside this checkout; the documents were not compared');
  }
  const ONB = read('services/onboarding.ts');
  const m = ONB.match(/export function policyNoticeDue\(([^)]*)\): boolean \{\s*return ([^;]+);\s*\}/);
  let due = null;
  if (m) {
    const params = m[1].split(',').map((p) => p.trim().split(':')[0].trim());
    due = new Function(...params, `return (${m[2]});`);
  }
  const V = '2026-10-13';
  // Founder ruling 2026-11-09: "The policy "Continue" is stored as
  // acceptance." Having seen the notice no longer stops it; only an
  // acceptance of the current version does.
  ok('the notice is due for someone who accepted terms under an older version, until the current one is accepted',
    !!due && due.length === 3 && due(true, null, V) === true && due(true, '2026-07-03', V) === true
      && due(true, V, V) === false && due(false, null, V) === false,
    m ? '' : 'policyNoticeDue not found');
  ok('accepting the terms stores the version they were accepted under',
    /export async function markTermsAccepted\(\): Promise<void> \{\s*await setBool\(KEYS\.termsAccepted, true\);\s*try \{ await AsyncStorage\.setItem\(KEYS\.acceptedPolicyVersion, LEGAL_POLICY_VERSION\); \} catch \{\}/.test(ONB));
  ok('...and the notice\'s Continue keeps the accepted version only through markPolicyAccepted',
    /export async function markPolicyAccepted\([^)]*\): Promise<void> \{\s*try \{ await AsyncStorage\.setItem\(KEYS\.acceptedPolicyVersion, version\); \} catch \{\}\s*\}/.test(ONB)
      && !/markPolicyNoticeSeen/.test(ONB) && !/markPolicyNoticeSeen/.test(LAYOUT));
  ok('the accept POST carries the version',
    /body: JSON\.stringify\(policyVersion \? \{ policyVersion \} : \{\}\)/.test(API));
  const ONBOARD = read('app/onboarding.tsx');
  ok('both onboarding acceptances send the current version',
    (ONBOARD.match(/await api\.acceptTerms\(LEGAL_POLICY_VERSION\);/g) || []).length === 2
      && !/await api\.acceptTerms\(\);/.test(ONBOARD));
  ok('the boot re-POST sends the version they ACCEPTED, never the current one',
    /await api\.acceptTerms\(await getAcceptedPolicyVersion\(\)\);/.test(LAYOUT));
  ok('the notice is rendered over the app once it is unlocked, and only when due',
    /needsPolicyNotice\(\)\.then\(\(due\) => \{ if \(live && due\) setPolicyNotice\(true\); \}\)/.test(LAYOUT)
      && /<PolicyUpdateNotice\s*visible=\{policyNotice\}/.test(LAYOUT));
  ok('...and its Continue closes it at once and hands the acceptance to the background',
    /onContinue=\{\(\) => \{ setPolicyNotice\(false\); acceptPolicyFromNotice\(\)\.catch\(\(\) => \{\}\); \}\}/.test(LAYOUT));
  const NOTICE = read('components/legal/PolicyUpdateNotice.tsx');
  ok('its sentence takes the date of the last material change from the one constant, never a literal',
    /`Our Privacy Policy and Terms of Service were updated on \$\{LEGAL_POLICY_CHANGED_ON\}\.`/.test(NOTICE)
      && !/POLICY_NOTICE_SENTENCE =[^;]*\d{4}/.test(NOTICE)
      && !/LEGAL_DOCS_LAST_UPDATED/.test(NOTICE.replace(/^\s*\/\/.*$/gm, '')));
  // The acceptance is kept on the device ONLY after the server said it stored
  // that version: the order inside acceptPolicyFromNotice, and the echo check
  // inside api.acceptPolicyVersion.
  const accFn = (NOTICE.match(/export async function acceptPolicyFromNotice\([\s\S]*?\r?\n\}\r?\n/) || [''])[0];
  ok('Continue is stored as acceptance: POST the current version, keep it on the device only once the server stored it',
    /stored = await api\.acceptPolicyVersion\(version\)/.test(accFn)
      && /if \(stored\) \{\s*await markPolicyAccepted\(version\);\s*return true;\s*\}/.test(accFn)
      && accFn.indexOf('api.acceptPolicyVersion') < accFn.indexOf('markPolicyAccepted')
      && /version: string = LEGAL_POLICY_VERSION/.test(accFn),
    accFn ? '' : 'acceptPolicyFromNotice not found');
  const apv = (API.match(/async acceptPolicyVersion\(policyVersion: string\): Promise<boolean> \{[\s\S]*?\r?\n  \},/) || [''])[0];
  ok('...and the server has stored it only when it echoes that version back',
    /'\/api\/terms\/accept'/.test(apv) && /body: JSON\.stringify\(\{ policyVersion \}\)/.test(apv)
      && /if \(!res\.ok\) return false;/.test(apv) && /return !!j && j\.policyVersion === policyVersion;/.test(apv),
    apv ? '' : 'api.acceptPolicyVersion not found');
}

// ===========================================================================
console.log('\n=== 5. the journal is the only ENCRYPTED store on the device ===');
// ===========================================================================
// The published Privacy Policy lists "Your cached chat history (for offline
// reading)" under "On your device (encrypted, never transmitted to us)". No
// such store has ever been written: chat lives in React state for the life of
// the screen (app/(tabs)/index.tsx) and is re-fetched from the server on
// resume, and the only encrypted on-device store is the journal. That policy
// sentence is being corrected with counsel.
//
// WHAT THIS DOES AND DOES NOT MEASURE — read this before quoting it. It pins
// the single MMKV instance, which is the HEADING's claim: the encrypted store
// is the journal and nothing else. It does NOT and CANNOT prove "there is no
// offline copy of your chat history on the phone" — a chat cache would arrive
// through AsyncStorage or expo-file-system and would never touch this file, so
// this step could not go red on that regression. That absence was established
// by hand on 2026-09-10 by reading every AsyncStorage.setItem and every
// createMMKV call site in the app repo (exactly one createMMKV; no chat,
// message, transcript or history key anywhere) and is recorded in the counsel
// note. A second ENCRYPTED store is what has to come through here.
//
// Comments are stripped before counting so that a future paragraph explaining
// MMKV instance ids cannot turn this red, and the instance-id match is
// whitespace-tolerant so a formatter cannot either.
const ENCSTORE = read('utils/encryptedStorage.ts');
const ENCSTORE_CODE = ENCSTORE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
{
  const instances = (ENCSTORE_CODE.match(/createMMKV\(/g) || []).length;
  ok('the only encrypted on-device store is the journal, and there is exactly one',
    /MMKV_INSTANCE_ID\s*=\s*'journal'/.test(ENCSTORE_CODE) && instances === 1,
    `createMMKV call sites found: ${instances} — a second instance would be a second ` +
    'encrypted store, which the Privacy Policy does not describe');
}

console.log(`\nsmoke-audit-fixes-app: ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
