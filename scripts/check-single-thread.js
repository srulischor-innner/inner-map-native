// ONE TRANSCRIPT, AND CHANGING MODE MUST NEVER TOUCH IT.
//
// The thread collapse has one failure mode that a person actually feels: their
// conversation disappears mid-session. Two ways that can come back:
//
//   1. a second transcript is reintroduced, and the screen shows one while
//      turns are written to the other
//   2. handleModeChange starts clearing state again — it USED to wipe both
//      threads and mint a new session id when you switched away from a resumed
//      mode, which was correct when a mode was a conversation and is a
//      data-loss bug now that a mode is a style of reply
//
// Both are cheap to assert and expensive to discover on a phone.
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

// 3. handleModeChange must not mutate the conversation
const mc = /function handleModeChange\([\s\S]*?\n  \}/.exec(src);
check(!!mc, 'handleModeChange not found');
if (mc) {
  const body = mc[0];
  const forbidden = [
    ['setMessages(', 'it writes to the transcript'],
    ['historyRef.current =', 'it replaces the wire history'],
    ['sessionIdRef.current =', 'it mints a new session id'],
    ['hasEngagedRef.current =', 'it resets engagement'],
  ];
  for (const [needle, why] of forbidden) {
    check(!body.includes(needle),
      `handleModeChange must not change the conversation — ${why}. Changing how we work is not starting over.`);
  }
}

// 4. the blank-screen backstop still exists
check(/BACKSTOP seeded the transcript/.test(src),
  'the blank-screen backstop is gone — if boot and resume both fail to seed, the user gets an empty chat with no way back');

// 5. the first session is still routed untouched
check(/firstSessionPending === true \? null :/.test(src),
  'the working-mode control is no longer hidden during the first session');

// negative control — these assertions must be able to fail
{
  const broken = src.replace('function handleModeChange(', 'function handleModeChange(\n    sessionIdRef.current = 1;');
  const bm = /function handleModeChange\([\s\S]*?\n  \}/.exec(broken);
  if (!bm || !bm[0].includes('sessionIdRef.current =')) {
    fails.push('NEGATIVE CONTROL: the handleModeChange body scan cannot detect an injected mutation');
  }
}

if (fails.length) {
  console.error('check-single-thread: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('check-single-thread: OK — one transcript; mode changes do not touch it; backstop present');
