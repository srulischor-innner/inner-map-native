// A PROMISE ON ANY SURFACE MUST BE MATCHED BY A CONTROL.
//
// THE HISTORY, BECAUSE IT IS THE WHOLE POINT OF THIS FILE.
// Four surfaces once told the person the journal privacy choice was theirs PER
// ENTRY: the first-launch privacy screen ("or mark it private"), the Guide's
// Journal card, the caption on the Journal tab, and the published privacy
// policy ("You decide, per journal entry"). The control those four described
// was deleted on 2026-06-29 (3e92a67) in favour of a single global Settings
// switch that defaults to ON. For ten weeks the compose screen showed nothing
// about where an entry was going, every entry was POSTed and embedded, and
// every check in both repos was green — because nothing held the copy and the
// mechanism to each other.
//
// TWO WAYS OUT, AND THE SECOND ONE IS NOW TAKEN. Either rebuild the per-entry
// control, or rewrite the copy to describe the control that actually exists.
// The control was rebuilt on 2026-09-15 and the founder reversed that the same
// day: "change the copy, don't build it. The control is a global on/off toggle
// in Settings, so the onboarding screen, the Guide and the privacy policy
// should all say that — not per-entry."
//
// The previous version of this file anticipated that branch and said of it:
// "the obligations that branch takes on instead (each surface naming Settings
// and stating the default out loud) are NOT asserted here, because that branch
// has not been taken. Anyone taking it must write them." This is them.
//
// SO THE ASSERTION INVERTS. It is no longer "there must be a control given that
// something promises one". It is now BOTH halves of the taken branch:
//   (a) no surface may promise a per-entry choice, and
//   (b) every surface must name the global control instead.
// Half (b) is the half that is easy to skip, and skipping it is how copy ends
// up merely vague rather than actually wrong — which is the state the ten weeks
// of false promises were never caught in.
//
//   node scripts/check-journal-privacy-promise.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEGAL = path.join(ROOT, '..', 'inner-map-legal');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

let fail = 0;
const check = (n, ok, d) => {
  if (ok) console.log('  ok   ' + n);
  else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); }
};

const modal    = read(path.join(ROOT, 'components', 'journal', 'JournalEntryModal.tsx'));
const onboard  = read(path.join(ROOT, 'app', 'onboarding.tsx'));
const guide    = read(path.join(ROOT, 'utils', 'guideContent.ts'));
const tab      = read(path.join(ROOT, 'app', '(tabs)', 'journal.tsx'));
const policy   = read(path.join(LEGAL, 'privacy-policy.html'));
const svc      = read(path.join(ROOT, 'services', 'journal.ts'));
const settings = read(path.join(ROOT, 'app', 'settings.tsx'));

if (!modal || !onboard || !guide || !tab || !svc || !settings) {
  console.log('  FAIL could not read one of the app files this check depends on');
  process.exit(1);
}
if (!policy) {
  // The legal repo is a sibling checkout. Missing it must not silently reduce
  // the number of surfaces examined, which would weaken every assertion below.
  console.log('  FAIL inner-map-legal/privacy-policy.html not readable — cannot check the published copy');
  process.exit(1);
}

// Comments are ours, not the person's. A comment explaining why a phrase was
// removed must not read as the phrase still being there. Handles //, /* */,
// {/* */} and <!-- -->.
const prose = (s) => s
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|#)/.test(l)).join('\n');

const SURFACES = [
  ['first-launch privacy screen', prose(onboard)],
  ['Guide, Journal card',         prose(guide)],
  ['Journal tab caption',         prose(tab)],
  ['published privacy policy',    policy],
];

console.log('journal privacy — the copy describes the control that exists');

// ---- (a) NOBODY PROMISES A PER-ENTRY CHOICE ANY MORE ----------------------
// The exact phrases that were false for ten weeks, plus the two the rebuilt
// control introduced. Listed per surface so a failure names the file.
const PER_ENTRY = [
  'mark it private',
  'per journal entry',
  'keep it private and it stays on your device',
  'Share entries with the AI, or keep them private',
  'mark a journal entry as shared',
  'each new entry OPENS',
  'change any single entry',
];
for (const [name, src] of SURFACES.concat([['Settings row', prose(settings)]])) {
  const found = PER_ENTRY.filter((ph) => src.includes(ph));
  check(`${name} makes no per-entry promise`, found.length === 0,
    'still says: ' + found.join(' / '));
}

// ---- (b) EVERY SURFACE NAMES THE CONTROL THAT DOES EXIST ------------------
// The obligation the taken branch carries. "Settings" by name, because a
// person who cannot find the switch has not been told where it is.
for (const [name, src] of SURFACES) {
  check(`${name} names Settings as where the control is`, /Settings/.test(src),
    'no longer promises per-entry, but does not say where the real control lives — vague, not true');
}

// ---- ...and says which way it is set by default ---------------------------
// Out loud, on the two surfaces a person meets BEFORE writing anything.
// Shared-by-default is the fact that makes this whole file necessary; copy
// that omits it is accurate and still leaves someone surprised.
check('the first-launch screen states the default out loud',
  /New journal entries are shared/.test(prose(onboard)),
  'the privacy screen does not say entries are shared by default');
check('the published policy states the default out loud',
  /shared with the AI unless you turn sharing off/.test(policy),
  'the policy does not say entries are shared unless the switch is turned off');

// ---- the compose screen shows where THIS entry is going -------------------
// TRUE UNDER BOTH BRANCHES, which is why it survived the reversal: someone
// writing something they may not want read has to be able to see which way it
// is going without leaving the screen they are writing on.
const rowAt  = modal.indexOf('styles.shareRow');
const rowEnd = modal.indexOf('{/* Recording / transcribing', rowAt < 0 ? 0 : rowAt);
const rowRaw = (rowAt > -1 && rowEnd > rowAt) ? modal.slice(rowAt, rowEnd) : '';
const row    = prose(rowRaw);

check('compose modal SHOWS which way this entry is going',
  row.includes('Shared with the AI') && row.includes('Private to this device'),
  rowAt < 0 ? 'no privacy row found in the compose modal at all' : 'the row is there but does not say which way it is set');
check('...and points at Settings rather than leaving it a mystery',
  /Settings/.test(row),
  'the indicator states where the entry goes but not how to change it');

// ---- and it is an INDICATOR, not a second control -------------------------
// The direct assertion of the ruling. A Switch here is the thing that was
// reversed; if one comes back, the copy on four surfaces is wrong again and
// this is the file that has to say so.
check('the compose modal offers NO per-entry control',
  rowRaw !== '' && !/<Switch/.test(rowRaw) && !/onValueChange/.test(rowRaw)
    && !/accessibilityRole="switch"/.test(rowRaw),
  'a per-entry control is back in the compose modal — the ruling of 2026-09-15 is that the control is the global Settings toggle, and four surfaces now say so');
// WHERE, not how many. A count would have to be bumped every time an
// unrelated line moved, and a bumped count is a check nobody trusts. Each
// mention of the setter must sit on either the useState declaration or the
// one effect that hydrates it from the global default (including that
// effect's catch arm, which falls back to the same shared-on default).
{
  const strays = modal.split('\n')
    .map((l, k) => [k + 1, l])
    .filter(([, l]) => /setShared/.test(l))
    .filter(([, l]) => !/const \[shared, setShared\] = useState/.test(l)
                    && !/getJournalShareDefault\(\)/.test(l));
  check('...and the setter is only reachable from the initial read of the global default',
    strays.length === 0,
    'setShared is called somewhere else: ' + strays.map(([k, l]) => k + ': ' + l.trim()).join(' | '));
}

// ---- the wire. Standing guards, green before this change and after. --------
check('the flag still reaches the save path (standing guard)',
  /onSave\(t, shared\)/.test(modal));
check('unshared entries are never synced — services/journal.ts gate intact (standing guard)',
  /if \(entry\.shared !== false\) \{[\s\S]{0,200}syncJournalEntry/.test(svc),
  'the sync gate is gone; the global default sets a flag nothing reads');
check('the global default still reads shared-on when unset (standing guard)',
  /v === null \? true : v === 'true'/.test(svc),
  'the default changed — every surface above states shared-by-default out loud');

// ---- negative control: half (b) must be capable of failing. ---------------
// Half (a) fails loudly by construction: a phrase is present or it is not.
// Half (b) is a PRESENCE test, and a presence test that can never fail is the
// exact defect this file exists to prevent. Strip "Settings" out of a copy of
// the smallest surface and confirm the assertion would go red against it.
{
  const stripped = prose(tab).split('Settings').join('Settingz');
  if (/Settings/.test(stripped)) {
    fail++; console.log('  FAIL NEGATIVE CONTROL: the names-Settings assertion cannot fail');
  } else {
    console.log('  ok   negative control: removing "Settings" from a surface turns half (b) red');
  }
}

console.log('\ncheck-journal-privacy-promise: ' + (fail === 0 ? 'OK' : 'FAILURES'));
process.exit(fail === 0 ? 0 : 1);
