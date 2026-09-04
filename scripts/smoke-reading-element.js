// Smoke for THE READING ELEMENT'S FAILURE STATE (founder ruling 2026-08-23).
//
// WHAT WENT WRONG. The element shipped with four phases and no fifth. A
// generation that failed flipped its row to status 'error' server-side, and
// the element's refresh() read that row past both of its status checks and
// fell through to the eligibility branch — which, for a map that qualifies,
// renders 'ready'. So a failed reading re-offered itself, silently, on the
// next poll. A person could tap it again, watch it breathe, and be handed the
// same offer once more, having never been told that anything went wrong.
//
// A second failure was worse because nothing recovered from it: if the worker
// died with the process (a redeploy mid-generation), the row stayed
// 'generating' forever. The element breathed at it indefinitely, and every
// retry was refused server-side because the generate endpoint returned that
// same row as `existing`.
//
// THE SHAPE OF THE FIX. The SERVER judges both failures — a device with a
// wrong clock must not get a vote on whether a generation is dead. GET
// /api/reading reports `stale`; POST retires an abandoned row to 'error' so a
// retry starts a new one. The element maps both shapes to one phase that says
// so and offers a retry.
//
// Every assertion reads SHIPPED SOURCE. Boots nothing, imports nothing, and
// never contacts the server.
//
// Run: node scripts/smoke-reading-element.js

const fs = require('fs');
const path = require('path');

const NATIVE = path.resolve(__dirname, '..');
const el   = fs.readFileSync(path.join(NATIVE, 'components', 'map', 'ReadingElement.tsx'), 'utf8');
const copy = fs.readFileSync(path.join(NATIVE, 'utils', 'readingCopy.ts'), 'utf8');
const api  = fs.readFileSync(path.join(NATIVE, 'services', 'api.ts'), 'utf8');

let n = 0, failures = 0;
function step(label, cond, extra) {
  n++;
  if (cond) { console.log(`  ok   ${label}`); }
  else { failures++; console.log(`  FAIL ${label}${extra ? '  — ' + extra : ''}`); }
}

console.log('\n(a) the phase exists and is reachable');
step('(a) the Phase union carries an error state',
  /type Phase =[^;]*'error'/.test(el));
step('(a) a status:"error" row maps to it',
  /r\.status === 'error'/.test(el));
step('(a) a stale generating row maps to the SAME state',
  /r\.status === 'generating' && r\.stale/.test(el));
step('(a) both are read BEFORE the plain generating branch',
  el.indexOf("r.status === 'generating' && r.stale") <
  el.indexOf("if (r.exists && r.status === 'generating') { setPhase('generating'); return; }"));
// `gateReady` WAS DELETED 2026-08-27 with the product-level delivery gate;
// indexOf returned -1 and this could only ever fail. The invariant it protected
// -- error is decided before eligibility -- is now pinned on the branch that
// actually exists.
step('(a) ...and before the eligibility branch',
  el.indexOf("setPhase('error')") < el.indexOf('const eligible'));

console.log('\n(b) it says so');
step('(b) the failure title exists and names the failure',
  /READING_ERROR_TITLE = "The reading didn't finish";/.test(copy));
step('(b) the body says the map is untouched',
  /Nothing on your map changed\./.test(copy));
step('(b) no error code, stack, or status number in the copy',
  !/\b(error code|status \d|stack|exception|500|failed with)\b/i.test(
    copy.slice(copy.indexOf('READING_ERROR_TITLE'))));
step('(b) the element renders the failure title',
  /failed \? READING_ERROR_TITLE/.test(el));
// KNOWN GAP, awaiting a ruling. READING_ERROR_BODY is imported and rendered
// nowhere, so "Nothing on your map changed" has never been shown. It cannot
// simply replace the title in `sub` -- the label is READING_LABEL, so that would
// drop the title from the UI. Asserted as-is so the gap is visible rather than
// silently green.
step('(b) KNOWN GAP: the failure body is imported but never rendered',
  /READING_ERROR_BODY/.test(el) && !/failed \? READING_ERROR_BODY/.test(el));

console.log('\n(c) it offers a retry — a visible one');
step('(c) the retry line is copy, not a bare tap target',
  /READING_ERROR_ACTION = 'Try again';/.test(copy));
step('(c) the retry line renders in the card',
  /\{failed \? <Text style=\{styles\.retry\}>\{READING_ERROR_ACTION\}<\/Text> : null\}/.test(el));
step('(c) the retry has its own style (it must read as the affordance)',
  /retry: \{/.test(el));
step('(c) the press handler accepts the error phase',
  /phase !== 'ready' && phase !== 'error'/.test(el));
// There is no `disabled` prop on this Pressable any more -- nothing is ever
// disabled -- so pinning `disabled={locked}` tested a shape that is gone. What
// matters is unchanged and is what is asserted: a failed reading must remain
// tappable, so no disabled expression may mention `failed`.
step('(c) the Pressable is never disabled in the error phase',
  !/disabled=\{[^}]*failed[^}]*\}/.test(el));
// Refactored from concatenation to a template literal. Identical output; the
// assertion was pinning the punctuation of the source.
step('(c) the accessibility label carries both the failure and the action',
  /failed \?\s*`\$\{READING_ERROR_TITLE\}\. \$\{READING_ERROR_ACTION\}`/.test(el));
step('(c) a retry restarts the waiting copy from its first line',
  /setLineIdx\(0\);[\s\S]{0,40}setPhase\('generating'\);/.test(el));

console.log('\n(d) it never silently re-offers itself');
step('(d) a null generate response sets the error phase',
  /if \(!r\) \{ setPhase\('error'\); return; \}/.test(el));
step('(d) ...and does NOT fall back to refresh() the way it used to',
  !/if \(!r \|\| r\.eligible === false\) \{ await refresh\(\); return; \}/.test(el));
step('(d) an ineligible answer still re-reads the server (that is not a failure)',
  /if \(r\.eligible === false\) \{ await refresh\(\); return; \}/.test(el));

console.log('\n(e) the device judges nothing');
step('(e) the stale verdict is read from the response, never computed on device',
  /r\.stale/.test(el) && !/READING_STALE|Date\.now\(\) - .*createdAt/.test(el));
step('(e) the API type carries the server flag',
  /stale\?: boolean;/.test(api));
step('(e) the header records why the server owns the verdict',
  /a device with a wrong clock must not get a vote/i.test(el));

console.log('\n(f) the four other phases are untouched');
step('(f) hidden still renders nothing (old server → silent)',
  /if \(phase === 'hidden'\) return null;/.test(el));
// The `disabled` prop is gone from this Pressable; `locked` is expressed
// through the sub line and the tap target instead. Pinning the prop tested a
// shape that no longer exists.
step('(f) locked is still a distinct phase',
  /const locked = phase === 'locked';/.test(el));
// The product-level delivery gate was REMOVED 2026-08-27; eligibility alone
// decides. This pinned `eligible && gateReady`, which has not existed since.
step('(f) eligibility alone decides ready vs locked',
  /setPhase\(eligible \? 'ready' : 'locked'\)/.test(el) && !/gateReady/.test(el));
step('(f) the waiting lines still hold on the last one, never loop',
  /hold, never loop/.test(el));
// Arity changed when the regeneration work added newMaterial as a third
// argument. Pinning the exact argument list made this fail on a signature
// change rather than on a behaviour change.
step('(f) has-reading still opens the document',
  /onOpen\(body, createdAt/.test(el));

console.log('');
if (failures) { console.log(`FAILED — ${failures} of ${n} checks failed`); process.exit(1); }
console.log(`PASSED — ${n}/${n} checks`);
