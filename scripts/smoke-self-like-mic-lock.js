// Smoke for THE SELF-LIKE MIC LOCK COPY (Aug 2026).
//
// WHAT WENT WRONG. The Self-like mic is gated on the user having established a
// Self-belief (MapVoiceBar.tsx:248 — `hasBelief = !!selfLike.belief`), which is
// 82 of the 88 users who have a self-like row. Tapping it opened a modal titled
// "Not yet available".
//
// That title describes the wrong thing. The voice is fully built; what is
// missing is the user's belief for it to speak FROM. "Not yet available" reads
// as unfinished software — to a user, and to an App Store reviewer under
// Guideline 2.1 (Performance: App Completeness), which is specifically about
// placeholder and non-functional UI. A designed lock that is worded like an
// unbuilt feature is a submission risk on a screen 93% of users can reach.
//
// The fix is copy only: state the CONDITION rather than an absence, in the
// app's own vocabulary, and stop giving directions (EXPLAINER_FOOTNOTE already
// carries the "tap the SELF-LIKE part on your map" pointer — repeating it here
// turned a warm gate into a two-step instruction).
//
// Every assertion reads SHIPPED SOURCE. Boots nothing, imports nothing, and
// never contacts the server.
//
// Run: node scripts/smoke-self-like-mic-lock.js

const fs = require('fs');
const path = require('path');

const NATIVE = path.resolve(__dirname, '..');
const barPath     = path.join(NATIVE, 'components', 'map', 'MapVoiceBar.tsx');
const folderPath  = path.join(NATIVE, 'components', 'map', 'PartFolderModal.tsx');

const bar    = fs.readFileSync(barPath, 'utf8');
const folder = fs.readFileSync(folderPath, 'utf8');

let failures = 0, n = 0;
function step(name, ok, detail) {
  n++;
  console.log(`${ok ? '  ok' : 'FAIL'}  ${n}. ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ---- the two copy constants, lifted from source ---------------------------
function constValue(src, name) {
  const m = new RegExp(`const ${name} =\\s*\\r?\\n?\\s*"((?:[^"\\\\]|\\\\.)*)";`).exec(src);
  if (!m) throw new Error(`could not lift ${name} out of MapVoiceBar.tsx`);
  return m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
}
const TITLE = constValue(bar, 'SELF_LIKE_DISABLED_TITLE');
const BODY  = constValue(bar, 'SELF_LIKE_DISABLED_BODY');

// Comments stripped: the rationale block above the copy constants QUOTES the
// old title on purpose (a reader needs to know what was replaced and why), and
// the absence check below is about what reaches a USER, not about what the file
// says. Stripping is the honest scope, not a workaround.
const barCode = bar
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

// ===== (a) the unfinished-software wording is gone ========================
step('(a) the literal "Not yet available" no longer appears in any USER-FACING string',
  !barCode.includes('Not yet available'),
  'this is the Guideline 2.1 string — an absence check, because it grows back');
step('(a) the strip did not defeat the check (the code body is still substantial)',
  barCode.length > bar.length * 0.5 && barCode.includes('SELF_LIKE_DISABLED_TITLE'),
  `${barCode.length} of ${bar.length} chars survived stripping`);
step('(a) the copy does not describe the feature as missing, coming, or unbuilt',
  !/not (yet )?available|coming soon|under construction|placeholder|unavailable/i
    .test(`${TITLE} ${BODY}`),
  `${TITLE} | ${BODY}`);
step('(a) the code comment no longer calls the modal a placeholder either',
  !/Phase 1 placeholder/.test(bar),
  'a comment that says placeholder invites the next person to re-word it as one');

// ===== (b) the title states the unlock CONDITION ==========================
step('(b) the title names the unlock rather than the absence',
  /unlocks/i.test(TITLE), TITLE);
step('(b) the title uses the app\'s own phrase, "what you stand on"',
  /what you stand on/i.test(TITLE), TITLE);
step('(b) the title is short enough for a modal heading',
  TITLE.length <= 40, `${TITLE.length} chars: ${TITLE}`);

// ===== (c) the body states the condition, warmly, without instructing =====
step('(c) the body says the voice OPENS on a condition, not that it is missing',
  /\bopens\b/i.test(BODY) && /once you'?ve established/i.test(BODY), BODY);
step('(c) the body names what unlocks it in the app\'s vocabulary',
  /what you stand on/i.test(BODY) && /separate from what your parts believe/i.test(BODY),
  BODY);
step('(c) the body is NON-INSTRUCTIONAL — no tap/go/first/get started directions',
  !/\btap\b|\bget started\b|\bfirst,? \b|\bgo to\b|\bhead to\b/i.test(BODY), BODY);
step('(c) the body stays short (two sentences)',
  BODY.length <= 220 && BODY.split(/(?<=[.!?])\s+/).length <= 2,
  `${BODY.length} chars, ${BODY.split(/(?<=[.!?])\s+/).length} sentences`);
step('(c) the body keeps the ground metaphor the map itself renders',
  /ground/i.test(BODY), BODY);

// ===== (d) the copy is WIRED, not a dead constant =========================
step('(d) the modal renders the title constant, not a hardcoded string',
  /<Text style=\{styles\.cardTitle\}>\{SELF_LIKE_DISABLED_TITLE\}<\/Text>/.test(bar));
step('(d) the modal renders the body constant',
  /<Text style=\{styles\.cardBody\}>\{SELF_LIKE_DISABLED_BODY\}<\/Text>/.test(bar));
step('(d) the modal it renders in is still the selfLikeDisabled one',
  /visible=\{modal === 'selfLikeDisabled'\}/.test(bar));

// ===== (e) the vocabulary is the app's, verified against the other screens =
// The point of matching vocabulary is that a user meets the SAME words in the
// modal and on the screen that resolves it. Checked against those files rather
// than asserted, so a rename over there fails here.
step('(e) "what you stand on" is the phrase the You folder actually shows',
  /What do you stand on\?/.test(folder) && /What you stand on/.test(folder),
  'the belief band was removed 2026-08-27; these phrases live in the You folder now');
step('(e) "separate from what your parts believe" is PartFolderModal\'s own line',
  /separate from what your parts believe/.test(folder));
step('(e) the belief-establishment button is still "Establish your belief"',
  /Establish your belief/.test(folder),
  'if the button is renamed, this modal\'s wording should follow it');

// ===== (e2) THE RENAME: SELF-LIKE -> YOU (founder ruling 2026-08-27) ======
// The label names the STATE, not the entity: the diamond on the map is YOU,
// and this mic is what You sounds like when leading. "LEADING" rather than
// "YOU, LEADING" on a measurement — the longer form overflows the column at
// 1.36x text scaling, inside iOS's normal (non-accessibility) range.
step('(e2) the mic label names the state',
  /const SELF_LIKE_LABEL = 'LEADING';/.test(bar));
step('(e2) no user-visible "Self-like" survives in the mic bar',
  !/(cardTitle}>|Text>)[^<]*Self-like/i.test(bar) && !/'SELF-LIKE'/.test(bar),
  'the stored category may say self-like; nothing a person READS may');
step('(e2) the pointer sends people to YOU on the map, not to a Self-like part',
  /Tap YOU on your map/.test(bar));
step('(e2) the map diamond is labelled YOU',
  /label="YOU"/.test(fs.readFileSync(path.join(NATIVE, 'components', 'map', 'InnerMapCanvas.tsx'), 'utf8')));
step('(e2) the stored category is UNTOUCHED — the database keeps its name',
  /'self-like'/.test(bar),
  'renaming the category would orphan every existing row');

// ===== (f) COPY-ONLY: the gate itself is untouched ========================
// The risk in a copy fix is quietly changing who sees the modal.
step('(f) the gate is still driven by the user having a belief',
  /const hasBelief = !!\(selfLike && selfLike\.belief && selfLike\.belief\.trim\(\)\);/.test(bar));
step('(f) ...and it still sets the enabled flag from exactly that',
  /setSelfLikeEnabled\(hasBelief\);/.test(bar));
step('(f) ...and the disabled tap still opens this modal',
  /setModal\('selfLikeDisabled'\);/.test(bar));

console.log('');
if (failures) { console.log(`FAILED — ${failures} of ${n} checks failed`); process.exit(1); }
console.log(`PASSED — ${n}/${n} checks`);
