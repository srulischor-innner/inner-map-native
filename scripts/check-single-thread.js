// ONE TRANSCRIPT, AND NOTHING THAT SWITCHES MODE CAN TOUCH IT.
//
// The thread collapse has one failure mode that a person actually feels: their
// conversation disappears mid-session. It came back two ways before:
//
//   1. a second transcript is reintroduced, and the screen shows one while
//      turns are written to the other
//   2. a mode change clearing state — handleModeChange USED to wipe both
//      threads and mint a new session id
//
// 1.4.0 (founder, 2026-11-09): there is no mode change at all any more. The
// control, the boxes and handleModeChange are gone (check-working-mode-control.js
// owns that), so (2) is now asserted as "no mode switch exists in the screen".
//
//   node scripts/check-single-thread.js
const fs = require('fs');
const path = require('path');

const SCREEN = path.join(__dirname, '..', 'app', '(tabs)', 'index.tsx');
const src = fs.readFileSync(SCREEN, 'utf8');
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// 1. no second transcript, in any of its old names
for (const dead of ['processMessages', 'exploreMessages', 'processHistoryRef', 'exploreHistoryRef']) {
  check(!new RegExp(`\\b${dead}\\b`).test(src),
    `"${dead}" is back — a second transcript means the screen can show one while turns go to the other`);
}

// 2. exactly one bubble-list state
const lists = (src.match(/useState<ChatMsg\[\]>/g) || []).length;
check(lists === 1, `expected exactly 1 useState<ChatMsg[]>, found ${lists}`);

// 3. NO MODE SWITCH (1.4.0). Nothing in the screen changes the mode mid-
// conversation: no handler, no setter, no server-driven switch.
for (const [needle, what] of [
  ['function handleModeChange(', 'handleModeChange is back'],
  ['setWorkingMode(', 'a working-mode setter is back'],
  ['onModeSwitch:', 'the server-driven mode switch is handled again'],
]) {
  check(!src.includes(needle), what + ' — a mode switch is how a conversation was wiped before');
}

// 4. the blank-screen backstop still exists
{
  const bsAt = src.indexOf('// BLANK-SCREEN BACKSTOP');
  const bsEnd = bsAt > -1 ? src.indexOf('}, [firstSessionPending, messages.length]);', bsAt) : -1;
  const bs = bsAt > -1 && bsEnd > -1 ? src.slice(bsAt, bsEnd) : '';
  check(/BACKSTOP seeded the transcript/.test(bs)
    && /if \(messages\.length > 0\) return;/.test(bs)
    && /setMessages\(\(prev\) => \[\.\.\.prev, \{ id, role: 'assistant', text: opener \}\]\)/.test(bs),
    'the blank-screen backstop is gone — if boot and resume both fail to seed, the user gets an empty chat with no way back');
}

// negative control — these assertions must be able to fail
{
  const injected = src + '\nconst processMessages = [];\n';
  if (!/\bprocessMessages\b/.test(injected)) fails.push('NEGATIVE CONTROL: a second transcript cannot be detected');
  const switched = src + '\n  function handleModeChange(x) {}\n';
  if (!switched.includes('function handleModeChange(')) fails.push('NEGATIVE CONTROL: a returned mode handler cannot be detected');
}

if (fails.length) {
  console.error('check-single-thread: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('check-single-thread: OK — one transcript; no mode switch exists; backstop present');
