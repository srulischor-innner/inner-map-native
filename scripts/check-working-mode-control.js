// THE CONTROL MUST STAY LABELLED, AND MUST STAY AT THE TOP.
//
// Both properties are the mechanism, not styling, so they get a check rather
// than a comment. Measured: requests to work differently ran at 0.04% of 5,489
// real turns before anything told people they could ask. The control is the
// main correction to that, and it only corrects it while it is READABLE — the
// moment someone "tidies" it into an icon it stops teaching and becomes another
// thing nobody knows about.
//
// Guarded here:
//   1. the row prints the lead text AND the current mode's label
//   2. all four modes have a user-facing label, and none leaks our word for the
//      prompt ("Light", "Process", "Explore", "Differentiation")
//   3. it is rendered above the transcript, not down in the input dock
//   4. it is rendered during the first session TOO (reversed 2026-09-10)
//
// Carries a negative control, per the house rule that a checker which cannot
// fail is not a checker.
//
//   node scripts/check-working-mode-control.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CTRL = fs.readFileSync(path.join(ROOT, 'components', 'WorkingModeControl.tsx'), 'utf8');
const SCREEN = fs.readFileSync(path.join(ROOT, 'app', '(tabs)', 'index.tsx'), 'utf8');

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// 1. labelled with the current state
check(/Mode: /.test(CTRL),
  'the row no longer prints "How we\'re working:" — it has become an unlabelled control');
check(/\{MODE_LABEL\[mode\]\}/.test(CTRL),
  'the row no longer renders MODE_LABEL[mode] — the current state is not shown');

// 2. four labels, none of them our internal prompt names
const labelBlock = (CTRL.match(/MODE_LABEL[\s\S]*?\};/) || [''])[0];
for (const m of ['light', 'process', 'explore', 'differentiation']) {
  check(new RegExp(`\\b${m}:`).test(labelBlock), `MODE_LABEL is missing "${m}"`);
}
for (const leak of ['Light', 'Process', 'Explore', 'Differentiation']) {
  check(!new RegExp(`['"\`][^'"\`]*\\b${leak}\\b`).test(labelBlock),
    `MODE_LABEL leaks our internal prompt name "${leak}" to the user`);
}

// 3. AT THE TOP of the screen, above the transcript.
// It moved there after the first phone round. Mode is a STATE, not an action,
// and a state belongs where you look to find out what is happening — not where
// your thumb rests to act. It spent exactly one build above the input.
const ctrlAt = SCREEN.indexOf('<WorkingModeControl');
// The JSX element, at the start of a line — NOT the type parameter in
// `useRef<ScrollView | null>` near the top of the file, which a plain indexOf
// finds first and which made this assertion fail against correct code.
const scrollAt = SCREEN.search(/^\s*<ScrollView\b/m);
check(ctrlAt > -1, 'WorkingModeControl is not rendered in the chat screen at all');
check(scrollAt > -1 && ctrlAt > -1 && ctrlAt < scrollAt,
  'WorkingModeControl must render ABOVE the transcript — it is a state, not an action');

// 4. RENDERED IN THE FIRST SESSION TOO — the guard reversed on 2026-09-10.
//
// This assertion used to be its exact inverse: the row had to be wrapped in
// `firstSessionPending === true ? null : (...)`, and the reason given was "the
// first session is server-routed, so a choice there does nothing". That was
// true, and it was the bug. /api/chat replaced whatever mode the person picked
// with the starter-map arc, so the one screen that teaches modes exist was
// hidden from the one person who has never seen them — one turn after the
// orientation promised "you can change it whenever ... I'll follow", and one
// turn after four boxes asked them which way they wanted to work.
//
// The server now honours the pick in the first session (server.js
// firstSessionBodyFor + the first-session route; scripts/smoke-first-session.js
// steps 14–14.15 in the server repo). So the state has to be visible, and it has
// to be reachable a second time: the four boxes are shown once and never again,
// which left a first-session person who picked wrong with no way back.
//
// A window, not a whole-file search, because `firstSessionPending` appears all
// over this screen legitimately — the banner directly above this row is one.
const window = ctrlAt > -1 ? SCREEN.slice(Math.max(0, ctrlAt - 600), ctrlAt) : '';
check(!/firstSessionPending === true \? null :/.test(window),
  'WorkingModeControl has been hidden during the first session again — the server now honours the mode chosen there, so hiding the control hides live state and removes the only second chance to change it');
// Negative control for the assertion above: prove the window is actually
// looking at the ternary's old position, not at empty space somewhere else.
const RESTORED = SCREEN.slice(0, ctrlAt) + '{firstSessionPending === true ? null : (' + SCREEN.slice(ctrlAt);
const restoredWindow = RESTORED.slice(Math.max(0, ctrlAt - 600 + 39), ctrlAt + 39);
if (!/firstSessionPending === true \? null :/.test(restoredWindow)) {
  fails.push('NEGATIVE CONTROL: the first-session assertion cannot fail — restoring the ternary does not land inside the window it searches');
}

// negative control: the assertions must actually be capable of failing
// Global, both times. Each string appears twice — once in the visible row and
// once in the accessibility label — and a non-global replace left the second
// occurrence standing, so the "broken" copy was not broken and this control
// reported that honestly on its first run.
const BROKEN = CTRL.replace(/Mode: /g, 'x').replace(/\{MODE_LABEL\[mode\]\}/g, '{null}');
const negFails = [];
if (/Mode: /.test(BROKEN)) negFails.push('lead-text assertion cannot fail');
if (/\{MODE_LABEL\[mode\]\}/.test(BROKEN)) negFails.push('current-state assertion cannot fail');
if (negFails.length) fails.push('NEGATIVE CONTROL: ' + negFails.join('; '));

if (fails.length) {
  console.error('check-working-mode-control: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('check-working-mode-control: OK — labelled, at the top, four modes, shown in the first session too');
