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

// ---- AND NOT IN THE FIRST SESSION AT ALL (founder ruling 2026-09-18) --------
// The first session was asking a person who has been here ninety seconds to
// pick between four ways of working they have no way to tell apart yet — and
// the orientation the model reads out no longer offers the choice. It says the
// map gets sketched first and the question comes once there is something in
// it, and that what CAN be changed right now is how it talks. Boxes offering
// the mode contradicted that sentence on the same screen.
//
// THE PREDICATE IS RUN, NOT READ. A regex over this source would pass on
// `firstSessionPending !== undefined`, which is the wrong test and is one
// character away from the right one. So the memo body is lifted out of the
// screen and EXECUTED against a truth table. The two rows that matter are the
// tri-state's two non-false values: unknown must suppress exactly as pending
// does, because the boot path resolves unknown to TRUE when the status
// endpoint cannot answer, and showing boxes in that window would show them to
// precisely the cohort this ruling removes them from.
{
  const head = chat.indexOf('const showModeBoxes = useMemo(() => {');
  const open = chat.indexOf('{', chat.indexOf('=> ', head));
  const close = chat.indexOf('\n  }, [', open);
  const BODY = (head < 0 || close < 0) ? '' : chat.slice(open + 1, close);
  ok('control: the visibility rule was lifted out of the screen',
    BODY.length > 100 && BODY.length < 2500 && /return users >= 1/.test(BODY),
    `len=${BODY.length}`);

  let showModeBoxes = null;
  try {
    // eslint-disable-next-line no-new-func
    showModeBoxes = new Function(
      'modeBoxesDismissed', 'crisisGated', 'typing', 'sending', 'firstSessionPending', 'messages',
      BODY,
    );
  } catch (e) {
    ok('control: the lifted rule is runnable', false, e.message);
  }
  if (showModeBoxes) {
    ok('control: the lifted rule is runnable', true);
    // Greeting + one reply, and the person has spoken: the one shape that shows.
    const OPENING = [{ role: 'assistant' }, { role: 'user' }, { role: 'assistant' }];
    const call = (over) => showModeBoxes(
      over.dismissed ?? false, over.crisis ?? false, over.typing ?? false, over.sending ?? false,
      over.first, over.messages ?? OPENING,
    );
    ok('CONTROL — a returning user at the opening shape DOES see the boxes',
      call({ first: false }) === true,
      'if this is false the three negatives below are negative about nothing');
    ok('a FIRST-SESSION user never sees them', call({ first: true }) === false,
      'the ruling of 2026-09-18 — the orientation promises style, not mode');
    ok('...and nor does one whose first-session status has not answered yet',
      call({ first: undefined }) === false,
      'boot resolves unknown to TRUE when the status endpoint fails, so unknown is the same cohort');
    ok('...and the existing dismissal still wins on its own',
      call({ first: false, dismissed: true }) === false);
    ok('...and a crisis still suppresses them',
      call({ first: false, crisis: true }) === false,
      'nothing that asks a person to choose how to work may sit over a referral');
  }
}
// THE DEPENDENCY, which is the other half. A memo that reads the flag but does
// not list it returns the value computed when boot had not answered — and boot
// answering is the only event that ever changes it.
ok('the memo re-runs when the first-session answer lands',
  /\}, \[modeBoxesDismissed[^\]]*firstSessionPending[^\]]*\]/.test(chat),
  'firstSessionPending is missing from the dependency list, so the suppression is frozen at its boot-time value');

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
