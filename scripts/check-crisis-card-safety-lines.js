// THE CRISIS CARD SAYS WHAT safety.md SAYS (2026-11-09).
//
// The five-screens audit (package-test-prompts/five-screens-2026-11-08.md,
// section 3) found the Map tab's crisis card missing four of safety.md's lines,
// and its lede never naming a real person as the next step. They are now on
// the shared card (components/safety/CrisisResourcesCard.tsx SAFETY_LINES),
// word for word, and the Map lede is built from safety.md l.21's own phrases.
//
// This holds:
//   1. each SAFETY_LINES entry is in safety.md, word for word (allowing only a
//      capitalised first letter and a closing full stop);
//   2. the card renders every one of them, and 88788 and both organisations'
//      names are in visible text, not only in an accessibility label;
//   3. the Map lede says the next step is a real person and no longer says the
//      AI is "with you";
// with a negative control. safety.md is read from the founder's file or the
// server's copy (prompts/m2/safety.md), whichever is on disk; with neither,
// the phrases are checked against the copy pinned below.
//
//   node scripts/check-crisis-card-safety-lines.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CANDIDATES = [
  process.env.SAFETY_MD,
  path.join(HOME, 'Downloads', 'safety (5).md'),
  path.join(ROOT, '..', 'Inner world', 'prompts', 'm2', 'safety.md'),
  path.join(HOME, 'Inner world', '.claude', 'worktrees', 'm2-chat-stack-b14563', 'prompts', 'm2', 'safety.md'),
].filter(Boolean);
const SAFETY_PATH = CANDIDATES.find((p) => fs.existsSync(p));
// Pinned from safety.md (l.21, l.28, l.42) for a machine without it.
const PINNED = [
  "that the next step is a real person",
  "the National Domestic Violence Hotline, 1-800-799-7233, text START to 88788, or thehotline.org",
  "the National Alliance for Eating Disorders, 1-866-662-1235 (weekdays 9am–7pm ET), and 988 after hours",
  "For psychosis or mania: a doctor, a psychiatrist or 988.",
  "saying that 988 also serves people worried about someone",
].join('\n');
const SAFETY = SAFETY_PATH ? fs.readFileSync(SAFETY_PATH, 'utf8') : PINNED;

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const card = read('components/safety/CrisisResourcesCard.tsx');
const linesSrc = (card.match(/export const SAFETY_LINES = (\{[\s\S]*?\}) as const;/) || [])[1];
let LINES = null;
try { LINES = linesSrc ? new Function(`return (${linesSrc});`)() : null; } catch {}
check(!!LINES, 'SAFETY_LINES not found in CrisisResourcesCard.tsx');

// A card line is "in safety.md" if, after dropping a closing full stop and
// lower-casing its first letter, it appears there verbatim.
const inSafety = (line, text) => {
  const core = line.replace(/\.$/, '');
  const variants = [core, core[0].toLowerCase() + core.slice(1)];
  return variants.some((v) => text.includes(v));
};
if (LINES) {
  for (const [k, v] of Object.entries(LINES)) {
    check(inSafety(v, SAFETY), `SAFETY_LINES.${k} is not safety.md's wording: "${v}"`);
    check(new RegExp(`\\{SAFETY_LINES\\.${k}\\}`).test(card), `the card does not render SAFETY_LINES.${k}`);
  }
  check(Object.keys(LINES).length === 4, `expected the four missing lines, found ${Object.keys(LINES).length}`);
  const visible = Object.values(LINES).join(' ');
  for (const must of ['88788', 'National Domestic Violence Hotline', 'National Alliance for Eating Disorders', 'worried about someone', 'psychosis or mania']) {
    check(visible.includes(must), `"${must}" is not in the card's visible text`);
  }
}

// The Map lede.
{
  const bar = read('components/map/MapVoiceBar.tsx');
  const lede = (bar.match(/const MAP_CRISIS_LEDE =\s*"([^"]+)";/) || [])[1] || '';
  check(/the next step is a real person/.test(lede) && inSafety('the next step is a real person', SAFETY),
    'the Map lede does not say the next step is a real person');
  check(/this space isn't the right one for something this heavy/i.test(lede),
    'the Map lede does not say this space isn\'t the right one for something this heavy');
  check(!/with you|The AI here/.test(lede), 'the Map lede says the AI is "with you" again');
  check(/lede=\{MAP_CRISIS_LEDE\}/.test(bar), 'the Map card does not use MAP_CRISIS_LEDE');
}

// NEGATIVE CONTROL — a paraphrase must not pass as safety.md's wording.
if (inSafety('For psychosis or mania, see a doctor or call 988.', SAFETY)) {
  fails.push('NEGATIVE CONTROL: a paraphrase passes as safety.md\'s wording');
}

if (fails.length) {
  console.error('check-crisis-card-safety-lines: FAIL');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-crisis-card-safety-lines: OK — 4 lines word for word from ${SAFETY_PATH ? path.basename(SAFETY_PATH) : 'the pinned copy (safety.md not on disk)'}; the Map lede names a real person`);
