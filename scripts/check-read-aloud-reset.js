// CHECK — a fresh start is actually silent.
//
// Read-aloud defaults OFF and the hydration only turns it on for a literal
// '1', so a genuinely fresh install has never spoken first. But the key was a
// private const inside app/(tabs)/index.tsx, and neither the account wipe nor
// the dev reset knew it existed — so "delete my account" and "reset
// onboarding" both left the speaker armed, and the next brand-new account on
// that device talked out loud on its first reply.
//
// Reported from a phone on 2026-09-15 as "the audio toggle is on by default".
// It is not. It was on because the device remembered, and nothing a person
// could do inside the app made it forget.
//
// THE SHAPE OF THE BUG IS THE POINT: a constant owned by the screen that
// writes it, and two other files that have to clear it. This check pins the
// three to one value and pins the default, so the next key with the same shape
// fails here instead of on someone's phone.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};

const onboarding = read('services/onboarding.ts');
const cleanup = read('utils/localCleanup.ts');
const chat = read('app/(tabs)/index.tsx');

// ---- one source for the string ---------------------------------------------
const m = onboarding.match(/export const READ_ALOUD_PREF_KEY = '([^']+)'/);
ok('services/onboarding.ts exports the key', !!m,
  'it went back to being a private const somewhere, which is the original bug');
const KEY = m ? m[1] : '__not-found__';

ok('the chat screen IMPORTS it rather than re-declaring it',
  /import\s*\{[^}]*READ_ALOUD_PREF_KEY[^}]*\}\s*from/.test(chat) &&
  !/const READ_ALOUD_PREF_KEY\s*=/.test(chat),
  'a second copy is how the wipe and the reset came to not know about it');

// ---- both clearers actually clear it ---------------------------------------
ok('the account wipe clears it', cleanup.includes(`'${KEY}'`),
  `utils/localCleanup.ts does not list ${KEY} — deleting an account leaves the speaker armed`);
ok('the dev reset clears it', /removeItem\(READ_ALOUD_PREF_KEY\)/.test(onboarding),
  'resetOnboarding does not clear it — "start again" leaves the speaker armed');

// ---- and the default is still off ------------------------------------------
// The positive half. "Nothing sets it true" is also satisfied by the hydration
// being deleted, so this asserts the guard is present AND that it is a strict
// equality against '1' rather than a truthiness test — `if (v)` would turn the
// string '0' into ON, which is exactly the fail-open this comment exists for.
ok('hydration only turns it on for a literal 1',
  /v\s*!==\s*'1'\s*\)\s*return/.test(chat),
  "the strict check is gone — a stored '0', or any non-empty string, would read as ON");
ok('the state still initialises false',
  /useState\(false\)[\s\S]{0,200}audioEnabledRef/.test(chat) ||
  /const \[audioEnabled, setAudioEnabled\] = useState\(false\)/.test(chat),
  'audioEnabled no longer starts false');

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
