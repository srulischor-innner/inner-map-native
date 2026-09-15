// CHECK — once the mode question is answered, nothing that asked it is left.
//
// Reported from a phone on 2026-09-15: "After I tap a box, the question stays
// on screen. It's been answered." THREE things asked it at once —
//
//   1. the PROSE copy, appended to the assistant's reply by the server
//      (maybeAppendOpeningQuestion),
//   2. the HEADER above the boxes, "How do you want me to be here today?",
//   3. the four BOXES themselves.
//
// Tapping a box could only ever retract 2 and 3. The prose copy is already a
// sentence inside a delivered message bubble, and a message cannot be
// unsaid — so the question stayed on screen no matter what the person picked.
// That is why the ruling was "keep the boxes, drop it from the prose": not a
// tidying preference, but the only one of the three that CAN be withdrawn.
// The server half is pinned in the server repo (smoke-ease-declared.js, which
// asserts the append has no caller). This file pins the app half.
//
// WHAT WOULD BREAK IT AGAIN, in order of likelihood:
//
//   * The dismissal moving BELOW the same-mode early return. The currently
//     active box is drawn highlighted, which makes it the most attractive
//     target on the screen; if `next === workingMode` returns before the
//     dismissal runs, the single most likely tap is the one that leaves the
//     question up. An ordering assertion, not a presence one, because both
//     lines would still be there.
//   * The header or the footnote being hoisted out of ModeBoxes into the
//     screen, where the dismissal cannot reach them.

const fs = require('fs');
const path = require('path');
const { orderedIn } = require('./lib/order');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};

const boxes = read('components/ModeBoxes.tsx');
const chat = read('app/(tabs)/index.tsx');

// ---- the question and the footnote belong to the component ------------------
// Both must be rendered BY ModeBoxes, so that unmounting it takes them with it.
const QUESTION = 'How do you want me to be here today?';
ok('ModeBoxes owns the header question', boxes.includes(QUESTION),
  'the header moved or was reworded — if it moved into the screen, the dismissal no longer reaches it');
ok('ModeBoxes owns the "just keep talking" footnote', /Or just keep talking/.test(boxes));

// The screen must NOT render either of them itself. This is the hoist that
// would survive the unmount and put the question back on screen for good.
ok('the chat screen does not render the header itself', !chat.includes(QUESTION),
  'a second copy outside ModeBoxes cannot be dismissed by picking a box');
ok('the chat screen does not render the footnote itself', !/Or just keep talking/.test(chat));

// ---- the pick dismisses, and dismisses FIRST --------------------------------
// Slice-scoped: `setModeBoxesDismissed` appears at its useState too, so a
// whole-file ordering test would compare the wrong occurrence.
const i = chat.indexOf('<ModeBoxes');
const PICK = i < 0 ? '' : chat.slice(i, chat.indexOf('/>', i) + 2);
ok('control: the ModeBoxes call site was found and is one element',
  PICK.length > 200 && PICK.length < 2000, `len=${PICK.length}`);

ok('picking a box dismisses them', /setModeBoxesDismissed\(true\)/.test(PICK));
{
  // THE ORDERING. Not decoration: the active box is highlighted, so "pick the
  // mode already in force" is the likeliest tap of the four, and it is exactly
  // the branch the early return short-circuits.
  const r = orderedIn(PICK, 'setModeBoxesDismissed(true)', 'if (next === workingMode) return;');
  ok('...BEFORE the same-mode early return, so re-picking the active mode still dismisses',
    r.ok, r.why);
}

// ---- and the flag is actually what hides them -------------------------------
// The positive half: "the pick sets a flag" is worth nothing if nothing reads it.
ok('the visibility rule consults that flag',
  /const showModeBoxes = useMemo\(\(\) => \{[\s\S]{0,200}modeBoxesDismissed/.test(chat),
  'showModeBoxes no longer reads modeBoxesDismissed — the pick sets a flag nothing observes');
ok('the boxes render only when that rule says so',
  /\{showModeBoxes \? \(\s*<ModeBoxes/.test(chat),
  'ModeBoxes is rendered unconditionally, or behind a different condition');

// ---- the mode stays visible after they go -----------------------------------
// The founder offered two acceptable endings: everything goes, OR it collapses
// to something showing what was picked. Both happen — the boxes go AND the
// always-present control at the top of the screen names the mode in force. If
// that control were ever removed, the first ending would be the only one left,
// and a person would have no way to see what their tap did.
ok('a persistent control still names the mode in force',
  /<WorkingModeControl/.test(chat),
  'nothing on screen would show what the tap chose');

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
