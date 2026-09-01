// THE CONTROL MUST STAY LABELLED, AND MUST STAY ABOVE THE INPUT.
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
//   3. it is rendered above ChatInput, not in the header
//   4. it is suppressed during the first session, where mode does nothing
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
check(/How we're working:/.test(CTRL),
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

// 3. above the input, inside the dock
const ctrlAt = SCREEN.indexOf('<WorkingModeControl');
const inputAt = SCREEN.indexOf('<ChatInput');
check(ctrlAt > -1, 'WorkingModeControl is not rendered in the chat screen at all');
check(inputAt > -1 && ctrlAt > -1 && ctrlAt < inputAt,
  'WorkingModeControl must render ABOVE ChatInput — it is a control you reach for mid-conversation');

// 4. suppressed during the first session
const window = ctrlAt > -1 ? SCREEN.slice(Math.max(0, ctrlAt - 600), ctrlAt) : '';
check(/firstSessionPending/.test(window),
  'WorkingModeControl is not guarded by firstSessionPending — the first session is server-routed, so a choice there does nothing');

// negative control: the assertions must actually be capable of failing
// Global, both times. Each string appears twice — once in the visible row and
// once in the accessibility label — and a non-global replace left the second
// occurrence standing, so the "broken" copy was not broken and this control
// reported that honestly on its first run.
const BROKEN = CTRL.replace(/How we're working:/g, 'x').replace(/\{MODE_LABEL\[mode\]\}/g, '{null}');
const negFails = [];
if (/How we're working:/.test(BROKEN)) negFails.push('lead-text assertion cannot fail');
if (/\{MODE_LABEL\[mode\]\}/.test(BROKEN)) negFails.push('current-state assertion cannot fail');
if (negFails.length) fails.push('NEGATIVE CONTROL: ' + negFails.join('; '));

if (fails.length) {
  console.error('check-working-mode-control: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('check-working-mode-control: OK — labelled, above the input, four modes, first session excluded');
