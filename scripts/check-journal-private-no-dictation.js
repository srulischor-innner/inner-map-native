// A PRIVATE JOURNAL ENTRY IS NEVER DICTATED (founder, 2026-11-08).
//
// The journal compose screen offered "Or speak" on every entry. Speaking sends
// the audio to /api/transcribe and on to OpenAI. The privacy policy says a
// private journal entry is never transmitted to OpenAI and never reaches our
// servers, and the compose screen itself says "Private to this device". So for
// a private entry the mic and its label are not rendered at all, and the two
// functions behind them refuse to run.
//
// The setting is read once when compose opens, from the global default
// (services/journal.ts getJournalShareDefault). `shared` starts TRUE while that
// read is in flight, so the gate is `shareKnown && shared`: no mic until the
// read has answered.
//
// This reads components/journal/JournalEntryModal.tsx with comments removed.
// Each assertion is one that fails if the gate is taken away, and the last
// block proves that by removing it from a copy.
//
//   node scripts/check-journal-private-no-dictation.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'components', 'journal', 'JournalEntryModal.tsx');
let raw = '';
try { raw = fs.readFileSync(SRC, 'utf8'); } catch {}
if (!raw) { console.log('  FAIL could not read ' + SRC); process.exit(1); }

let fail = 0;
const check = (n, ok, d) => {
  if (ok) console.log('  ok   ' + n);
  else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); }
};

// Comments are ours, not the code's: a comment naming the gate must not count
// as the gate.
const codeOnly = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// The block a `{micAllowed ? (` opens, up to its `) : null}`, by bracket depth.
function gatedBlock(code) {
  const open = code.indexOf('{micAllowed ? (');
  if (open < 0) return null;
  let depth = 0;
  for (let i = open + '{micAllowed ? '.length; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        const rest = code.slice(i, i + 20);
        return /^\)\s*:\s*null\s*\}/.test(rest) ? { start: open, end: i, text: code.slice(open, i + 1) } : null;
      }
    }
  }
  return null;
}

// Everything that makes up the mic, as the screen draws it.
const MIC_PIECES = [
  ['the mic dock', 'styles.micDock'],
  ['the "Or speak" label', "'Or speak'"],
  ['the hold-to-record gesture', '<GestureDetector gesture={micPan}>'],
  ['the mic icon', 'name="mic"'],
];

function micIsGated(code) {
  const b = gatedBlock(code);
  if (!b) return { ok: false, why: 'no {micAllowed ? ( … ) : null} block' };
  const outside = code.slice(0, b.start) + code.slice(b.end + 1);
  const missing = MIC_PIECES.filter(([, s]) => !b.text.includes(s)).map(([n]) => n);
  const leaked = MIC_PIECES.filter(([, s]) => outside.includes(s)).map(([n]) => n);
  if (missing.length) return { ok: false, why: 'not inside the gate: ' + missing.join(', ') };
  if (leaked.length) return { ok: false, why: 'also rendered outside the gate: ' + leaked.join(', ') };
  return { ok: true };
}

const code = codeOnly(raw);
console.log('journal privacy — a private entry is never dictated');

// ---- the gate is shareKnown && shared -------------------------------------
const decl = code.match(/const micAllowed = ([^;]+);/);
let gateFn = null;
try { gateFn = decl ? new Function('shareKnown', 'shared', `return (${decl[1]});`) : null; } catch {}
check('micAllowed is false for a private entry, and false until the setting has been read',
  !!gateFn && gateFn(true, false) === false && gateFn(false, false) === false
    && gateFn(false, true) === false && gateFn(true, true) === true,
  decl ? 'micAllowed = ' + decl[1] : 'no `const micAllowed = …;`');
check('shareKnown starts false',
  /const \[shareKnown, setShareKnown\] = useState\(false\);/.test(code));
{
  const lines = code.split('\n');
  const known = lines.filter((l) => /setShareKnown\(true\)/.test(l));
  check('shareKnown turns true only where the global default has been read',
    known.length > 0 && known.every((l) => /getJournalShareDefault\(\)/.test(l)),
    known.map((l) => l.trim()).join(' | ') || 'never set true');
  check('...and goes back to false each time compose opens, before that read',
    /setShareKnown\(false\);\s*\n\s*getJournalShareDefault\(\)/.test(code));
}

// ---- nothing of the mic renders outside the gate --------------------------
const gated = micIsGated(code);
check('the mic, its "Or speak" label and its gesture render only inside {micAllowed ? …}',
  gated.ok, gated.why);

// ---- the functions behind it refuse too -----------------------------------
check('startRecording refuses first thing for a private entry',
  /async function startRecording\(\) \{\s*if \(!micAllowed\) return;/.test(code));
{
  const endAt = code.indexOf('async function endRecording');
  const calls = [...code.matchAll(/api\.transcribe\(/g)].map((m) => m.index);
  const guardAt = code.indexOf('if (!micAllowed)', endAt);
  check('the one call to /api/transcribe sits behind a micAllowed guard in endRecording',
    endAt > -1 && calls.length === 1 && guardAt > endAt && guardAt < calls[0],
    `${calls.length} transcribe call(s); guard ${guardAt > endAt && guardAt < (calls[0] || 0) ? 'before' : 'not before'} it`);
}

// ---- negative control: take the gate away and this goes red ---------------
{
  const b = gatedBlock(code);
  const ungated = b ? code.slice(0, b.start) + b.text.replace(/^\{micAllowed \? \(/, '').replace(/\)$/, '') + code.slice(b.end + 1 + (code.slice(b.end + 1).match(/^\s*:\s*null\s*\}/) || [''])[0].length) : code;
  const shouldFail = micIsGated(ungated);
  if (shouldFail.ok) { fail++; console.log('  FAIL NEGATIVE CONTROL: removing the gate does not turn this red'); }
  else console.log('  ok   negative control: with the gate removed, the render check fails (' + shouldFail.why + ')');
  // And a second mic label drawn outside the gate, gate left in place.
  const leaked = b ? code.slice(0, b.start) + "<Text>{'Or speak'}</Text>" + code.slice(b.start) : code;
  const shouldFail2 = micIsGated(leaked);
  if (shouldFail2.ok) { fail++; console.log('  FAIL NEGATIVE CONTROL: a mic label outside the gate does not turn this red'); }
  else console.log('  ok   negative control: a mic label outside the gate fails it too (' + shouldFail2.why + ')');
}

console.log('\ncheck-journal-private-no-dictation: ' + (fail === 0 ? 'OK' : 'FAILURES'));
process.exit(fail === 0 ? 0 : 1);
