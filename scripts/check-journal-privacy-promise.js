// A PROMISE ON ANY SURFACE MUST BE MATCHED BY A CONTROL.
//
// Four surfaces tell the person the journal privacy choice is theirs, per
// entry: the first-launch privacy screen ("or mark it private"), the Guide's
// Journal card, the caption at the top of the Journal tab, and the published
// privacy policy, which says "You decide, per journal entry" and describes
// "when you mark a journal entry as shared".
//
// The control those four describe was deleted on 2026-06-29 (3e92a67) in favour
// of a single global Settings switch that defaults to ON. For ten weeks the
// compose screen showed nothing at all about where an entry was going, every
// entry was POSTed and embedded, and every check in both repos was green —
// because nothing anywhere held the copy and the mechanism to each other.
// services/journal.ts even carries a comment saying the guarantee no longer
// held and that "user-facing copy is being updated in a separate pass". A
// comment is not a check, and the separate pass did not happen.
//
// THE SHAPE OF THIS CHECK IS THE POINT. It does not assert "there must be a
// Switch". It asserts "there must be a control GIVEN that something promises
// one". Delete every promise and it legitimately falls to its else-arm — that
// is the other branch, rewriting the copy instead of rebuilding the control,
// and it is allowed. What is not allowed is a promise with nothing behind it.
//
// Modelled on the server repo's scripts/check-one-story.js, which is the
// existing precedent for holding copy surfaces across the two repos together.
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
  // the number of promises found, which would weaken every assertion below.
  console.log('  FAIL inner-map-legal/privacy-policy.html not readable — cannot count the published promise');
  process.exit(1);
}

// Comments are ours, not the person's. A comment explaining why a phrase was
// removed must not read as the phrase still being there — same rule as
// check-one-story.js. Handles //, /* */, {/* */} and <!-- -->.
const prose = (s) => s
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|#)/.test(l)).join('\n');

const PROMISES = [
  ['first-launch privacy screen', prose(onboard), 'mark it private'],
  ['Guide, Journal card',         prose(guide),   'keep it private and it stays on your device'],
  ['Journal tab caption',         prose(tab),     'keep them private'],
  ['published privacy policy',    policy,         'You decide, per journal entry'],
];
const promised = PROMISES.filter(([, src, phrase]) => src.includes(phrase));

console.log('journal privacy — promise vs mechanism');
console.log('  ' + promised.length + '/4 surfaces currently promise a per-entry choice');

// ---- the compose screen's privacy row, sliced. ----------------------------
// A whole-file substring over this file would pass for the wrong reason: it is
// the one file this change also adds a fifteen-line comment to, and any future
// comment quoting either label would satisfy it with the JSX deleted.
const rowAt  = modal.indexOf('styles.shareRow');
const rowEnd = modal.indexOf('{/* Recording / transcribing', rowAt < 0 ? 0 : rowAt);
const rowRaw = (rowAt > -1 && rowEnd > rowAt) ? modal.slice(rowAt, rowEnd) : '';
const row    = prose(rowRaw);

if (promised.length > 0) {
  const names = promised.map(([n]) => n).join(', ');
  check('compose modal renders a per-entry privacy control (promised by: ' + names + ')',
    row !== '' && /<Switch/.test(row) && /value=\{shared\}/.test(row)
      && /(onValueChange=\{setShared\}|setShared\()/.test(row),
    'the modal has no control the person can reach; the flag is set once from the global default at open');
  check('the whole row is the hit target, not just the switch',
    /accessibilityRole="switch"/.test(row) && /onPress=/.test(row),
    'the 51pt switch is the only thing tappable — the sentence explaining it is what people aim at');
} else {
  // The other branch. If every promise is gone the control is not required —
  // but the obligations that branch takes on instead (each surface naming
  // Settings and stating the default out loud) are NOT asserted here, because
  // that branch has not been taken. Anyone taking it must write them.
  check('no surface promises per-entry privacy, so no control is required', true);
}

// True under BOTH branches, which is why it sits outside the if: a person
// writing something they may not want read has to be able to see which way
// this entry is going without leaving the screen they are writing on.
check('compose modal SHOWS which way this entry is going',
  row.includes('Shared with the AI') && row.includes('Private to this device'),
  rowAt < 0 ? 'no privacy row found in the compose modal at all' : 'the row is there but does not say which way it is set');

// ---- the wire. Standing guards, green before this change and after. --------
// They are here because a control that sets a flag nothing reads would pass
// everything above. They are NOT evidence the control exists.
check('the choice still reaches the save path (standing guard)',
  /onSave\(t, shared\)/.test(modal));
check('private entries are never synced — services/journal.ts gate intact (standing guard)',
  /if \(entry\.shared !== false\) \{[\s\S]{0,200}syncJournalEntry/.test(svc),
  'the sync gate is gone; the per-entry choice sets a flag nothing reads');

// ---- Settings must describe itself as the default, never as the only control.
check('Settings row does not claim to be the only control',
  !prose(settings).includes('Turn off to keep new entries private'),
  'that wording is false once the per-entry control exists');

// ---- negative control: the assertions above must be capable of failing. ----
// Rebuild the "before" state of this file — the row deleted — and confirm the
// two promise-gated checks would have gone red against it.
{
  const negFails = [];
  if (rowAt < 0) {
    // Nothing to simulate: the row is already gone, which is the failure the
    // assertions above have already reported. Do NOT count this twice.
    console.log('  note negative control skipped — the row is already absent, which is what the checks above are red about');
  } else {
    const BROKEN = modal.slice(0, rowAt) + modal.slice(rowEnd);
    const bAt = BROKEN.indexOf('styles.shareRow');
    const bRow = bAt > -1 ? prose(BROKEN.slice(bAt, BROKEN.indexOf('{/* Recording / transcribing', bAt))) : '';
    if (/<Switch/.test(bRow)) negFails.push('the control assertion cannot fail — a Switch survives the row being deleted');
    if (bRow.includes('Shared with the AI')) negFails.push('the visible-state assertion cannot fail');
    if (negFails.length) { fail++; console.log('  FAIL NEGATIVE CONTROL: ' + negFails.join('; ')); }
    else console.log('  ok   negative control: deleting the row turns the assertions above red');
  }
}

console.log('\ncheck-journal-privacy-promise: ' + (fail === 0 ? 'OK' : 'FAILURES'));
process.exit(fail === 0 ? 0 : 1);
