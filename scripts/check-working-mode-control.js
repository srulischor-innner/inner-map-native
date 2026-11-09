// THE MODE CONTROL IS GONE, AND STAYS GONE (1.4.0, founder 2026-11-09).
//
// History, kept because it is why this file exists under this name. This used
// to guard the four-mode control ("Mode: Sitting with it ▾") at the top of the
// chat: labelled, at the top, live in the first session. Then M2 became the
// app. M2 is one prompt; the M2 server reads the chat's chatMode only to tell
// Partner and the map voices apart from the chat (lib/m2/index.js
// shouldServeChat). A control that names a state nothing implements is a false
// statement on screen, and its label used to flash at launch before the
// account's stack was known.
//
// So the file now guards the other direction:
//   1. the control and the opening boxes are deleted, and nothing imports them
//   2. the chat screen renders no mode row and no "Mode:" label (the flash)
//   3. every turn and every saved session sends the one wire mode, 'explore',
//      which is what M2 sent underneath the hidden control all along
//   4. the map-folder handoff no longer carries a mode
// with a negative control for each scan.
//
//   node scripts/check-working-mode-control.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// Every app source file, for the import scan.
function sources(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const FILES = ['app', 'components', 'services', 'utils', 'constants'].flatMap((d) => sources(d));
const codeOnly = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// 1. deleted, and nothing reaches for them
check(!fs.existsSync(path.join(ROOT, 'components', 'WorkingModeControl.tsx')),
  'components/WorkingModeControl.tsx is back');
check(!fs.existsSync(path.join(ROOT, 'components', 'ModeBoxes.tsx')),
  'components/ModeBoxes.tsx is back');
const IMPORT = /from ['"][./]*(?:components\/)?(?:WorkingModeControl|ModeBoxes)['"]/;
const importers = FILES.filter((f) => IMPORT.test(read(f)));
check(importers.length === 0, 'still imported by: ' + importers.join(', '));

// 2. no mode row on the chat screen
const chat = codeOnly(read('app/(tabs)/index.tsx'));
for (const [needle, why] of [
  ['<WorkingModeControl', 'the mode control is rendered again'],
  ['<ModeBoxes', 'the opening mode boxes are rendered again'],
  ['>Mode: <', 'a "Mode:" label is back on the chat screen (the launch flash)'],
  ['showModeBoxes', 'the boxes\' visibility rule is back'],
]) check(!chat.includes(needle), why);

// 3. one wire mode
check(/const WIRE_MODE: ChatMode = 'explore';/.test(chat), 'WIRE_MODE is not the constant \'explore\'');
const turnModes = [...chat.matchAll(/const turnMode = ([^;]+);/g)].map((m) => m[1].trim());
check(turnModes.length >= 3 && turnModes.every((v) => v === 'WIRE_MODE'),
  'a turn or a save sends something other than WIRE_MODE: ' + JSON.stringify(turnModes));

// 4. the handoff carries text only
const pending = codeOnly(read('utils/pendingChatMessage.ts'));
check(/export function armPendingChatMessage\(text: string\): void/.test(pending),
  'armPendingChatMessage takes a mode again');

// negative controls — each scan must be able to fail
{
  const back = "import { WorkingModeControl } from '../../components/WorkingModeControl';";
  if (!IMPORT.test(back)) fails.push('NEGATIVE CONTROL: the import scan cannot see the control coming back');
  const flashed = chat + '\n<Text style={styles.rowLead}>Mode: </Text>';
  if (!flashed.includes('>Mode: <')) fails.push('NEGATIVE CONTROL: the launch-flash scan cannot fail');
  const drift = chat.replace("const turnMode = WIRE_MODE;", "const turnMode = workingModeRef.current;");
  const dm = [...drift.matchAll(/const turnMode = ([^;]+);/g)].map((m) => m[1].trim());
  if (dm.every((v) => v === 'WIRE_MODE')) fails.push('NEGATIVE CONTROL: a turn sending another mode cannot be detected');
}

if (fails.length) {
  console.error('check-working-mode-control: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-working-mode-control: OK — no mode control, no boxes, no "Mode:" label; ${turnModes.length} sends all say WIRE_MODE ('explore')`);
