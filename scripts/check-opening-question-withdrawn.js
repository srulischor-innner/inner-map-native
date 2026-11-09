// CHECK — the opening mode question is gone, and cannot come back.
//
// History. From 2026-09-06 the chat asked a returning person, under the second
// reply, "How do you want me to be here today?" with four boxes and a "just keep
// talking" footnote. This file pinned that answering it withdrew it (reported
// from a phone 2026-09-15: "After I tap a box, the question stays on screen"),
// and then that it never showed in a first session (ruling 2026-09-18) or on M2.
//
// 1.4.0 (founder, 2026-11-09): M2 is the app. It has one prompt, so there is no
// way of working to ask about. The boxes are deleted (check-working-mode-control.js
// owns that the component and its imports are gone). What THIS file keeps is the
// promise it always made: once nothing answers the question, the question is
// not on screen. So it scans every app source for the question's own words and
// for anything that would render boxes, with a negative control.
//
// The server half — the prose append — is pinned in the server repo
// (smoke-ease-declared.js asserts maybeAppendOpeningQuestion has no caller).
//
//   node scripts/check-opening-question-withdrawn.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
};

function sources(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}
// Comments may tell the history; only code counts.
const codeOnly = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const FILES = ['app', 'components', 'utils', 'services', 'constants'].flatMap((d) => sources(d));
const CODE = FILES.map((f) => [f, codeOnly(fs.readFileSync(path.join(ROOT, f), 'utf8'))]);

// The question's own words, and the footnote that went with it.
const PHRASES = ['How do you want me to be here today?', 'Or just keep talking'];
function findings(code) {
  const out = [];
  for (const [f, src] of code) {
    for (const p of PHRASES) if (src.includes(p)) out.push(`${f}: "${p}"`);
    if (/<ModeBoxes\b/.test(src)) out.push(`${f}: <ModeBoxes`);
    if (/setModeBoxesDismissed|modeBoxesDismissed/.test(src)) out.push(`${f}: the boxes' dismissal state`);
  }
  return out;
}

const found = findings(CODE);
ok('no app source asks the mode question or renders the boxes', found.length === 0, found.join('\n         '));
ok('the boxes component is deleted', !fs.existsSync(path.join(ROOT, 'components', 'ModeBoxes.tsx')));
ok(`control: the scan covered the app (${FILES.length} files, including the chat screen)`,
  FILES.length > 50 && FILES.some((f) => f.replace(/\\/g, '/') === 'app/(tabs)/index.tsx'));

// NEGATIVE CONTROL — put the question back into a copy of the chat screen.
{
  const chat = CODE.find(([f]) => f.replace(/\\/g, '/') === 'app/(tabs)/index.tsx');
  const planted = CODE.map(([f, src]) => [f, src === chat[1] ? src + '\n<Text>How do you want me to be here today?</Text>' : src]);
  ok('negative control: the question planted back in the chat screen is found', findings(planted).length === 1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`} — ${pass + fail} checks`);
process.exit(fail === 0 ? 0 : 1);
