// THE LOCKED CARD MUST SPEAK ABOUT THIS MAP, NOT ABOUT THE RULE.
//
// Founder ruling 2026-08-27: the card has two jobs — say what a reading IS
// (the person has never seen one), then say what THIS map is waiting for. The
// second job is the one that is easy to fake: "it needs both sides" is true
// for every locked state and useless to someone who already has one side and
// cannot tell whether they are close or nowhere.
//
// So this runs the real function over every reachable gate state and checks
// that each answer is genuinely about that state. It imports the module and
// executes it rather than grepping the source, because the failure mode worth
// catching is a branch that returns the WRONG sentence, not a missing string.
//
//   node scripts/check-reading-locked-copy.mjs
import {
  READING_LEAD, READING_LABEL, readingWaitingLine,
} from '../utils/readingCopy.ts';

let pass = 0;
const failures = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
};

// Every state the gate can actually be in while locked. Mirrors the priority
// chain in computeReadingEligibility (server.js) — if that chain grows a
// condition, this list is where the omission shows up.
const STATES = [
  { name: 'no wound belief',        e: { eligible: false, woundBelief: false, fixerPattern: false, skepticPattern: false, protCount: 0, protectorFloor: 3 } },
  { name: 'wound only, no poles',   e: { eligible: false, woundBelief: true,  fixerPattern: false, skepticPattern: false, protCount: 0, protectorFloor: 3 } },
  { name: 'skeptic only',           e: { eligible: false, woundBelief: true,  fixerPattern: false, skepticPattern: true,  protCount: 0, protectorFloor: 3 } },
  { name: 'fixer only',             e: { eligible: false, woundBelief: true,  fixerPattern: true,  skepticPattern: false, protCount: 0, protectorFloor: 3 } },
  { name: 'both poles, 0 protectors', e: { eligible: false, woundBelief: true, fixerPattern: true, skepticPattern: true,  protCount: 0, protectorFloor: 3 } },
  { name: 'both poles, 2 protectors', e: { eligible: false, woundBelief: true, fixerPattern: true, skepticPattern: true,  protCount: 2, protectorFloor: 3 } },
];

const lines = STATES.map((s) => ({ ...s, line: readingWaitingLine(s.e) }));

console.log('[locked-copy] ' + STATES.length + ' reachable locked states\n');
for (const { name, line } of lines) {
  console.log('  ' + name);
  console.log('    ' + line.slice(0, 96) + (line.length > 96 ? '…' : ''));
}
console.log('');

// 1. SPECIFICITY. Two different maps must not get the same sentence — that is
//    exactly the failure this rewrite was ordered to fix.
const seen = new Map();
for (const { name, line } of lines) {
  if (seen.has(line)) failures.push(`"${name}" and "${seen.get(line)}" produce IDENTICAL copy`);
  else seen.set(line, name);
}
ok('every state gets its own sentence', seen.size === STATES.length);

// 2. NAMES WHAT IS THERE AND WHAT IS NOT, by the words printed on the map.
const byName = Object.fromEntries(lines.map((l) => [l.name, l.line]));
ok('one-pole copy names the side they HAVE (skeptic only)',
  /Skeptic/.test(byName['skeptic only']), byName['skeptic only']);
ok('one-pole copy names the side they LACK (skeptic only → Fixer)',
  /Fixer is not/.test(byName['skeptic only']), byName['skeptic only']);
ok('one-pole copy names the side they HAVE (fixer only)',
  /Fixer/.test(byName['fixer only']), byName['fixer only']);
ok('one-pole copy names the side they LACK (fixer only → Skeptic)',
  /Skeptic is not/.test(byName['fixer only']), byName['fixer only']);
ok('no-poles copy names BOTH missing sides',
  /Fixer/.test(byName['wound only, no poles']) && /Skeptic/.test(byName['wound only, no poles']));
ok('protector copy names the everyday parts',
  /Managers/.test(byName['both poles, 0 protectors']) && /Firefighters/.test(byName['both poles, 0 protectors']));
ok('having SOME protectors is not described as having none',
  !/What is not there is the day-to-day/.test(byName['both poles, 2 protectors']),
  'a person looking at two protectors would be told they have none');
ok('no-wound copy leads with the belief, not with the poles',
  /belief at the centre/.test(byName['no wound belief']) && !/Fixer/.test(byName['no wound belief']));

// 3. NO COUNTS, NO DISTANCE. Mechanically enforced, because this is the rule
//    that erodes first when someone tries to be helpful.
const BANNED = /\b(\d+|one more|two more|almost|nearly|halfway|progress|complete|remaining|left to go|of \w+ required)\b/i;
for (const { name, line } of lines) {
  ok(`no count or distance in "${name}"`, !BANNED.test(line), line.match(BANNED)?.[0]);
}

// 4. THE FALLBACK NEVER RENDERS for a locked map. If it does, the server grew
//    a gate condition this copy does not know about.
for (const { name, line } of lines) {
  ok(`"${name}" is not the unreachable fallback`, !/Give it a moment to catch up/.test(line));
}

// 5. JOB ONE EXISTS AND COMES FIRST. The lead is a separate constant rendered
//    above the waiting line, so the only thing to assert here is that it says
//    what a reading is and draws the contrast with chat.
ok('the lead says what a reading is', /A reading is a page written back to you/.test(READING_LEAD));
ok('the lead draws the contrast with chat', /conversation cannot do/.test(READING_LEAD));
ok('the lead says everything at once, not part by part', /everything at once/.test(READING_LEAD));
ok('no waiting line repeats the lead', lines.every((l) => !l.line.includes(READING_LEAD.slice(0, 40))));
ok('the label names the thing', READING_LABEL === 'THE WHOLE PICTURE');

// ---- NEGATIVE CONTROL ----
// A check that cannot fail is not a check. Prove assertion 1 — the one doing
// the real work — actually trips when two states share copy.
const generic = STATES.map(() => 'A reading needs the wound, both sides, and your everyday parts.');
const controlTripped = new Set(generic).size !== STATES.length;
ok('NEGATIVE CONTROL: identical copy across states would be caught', controlTripped);

console.log(failures.length === 0
  ? `  ✓ ${pass} checks passed`
  : `  ✗ ${failures.length} FAILURE(S):\n    ` + failures.join('\n    '));
process.exit(failures.length === 0 ? 0 : 1);
