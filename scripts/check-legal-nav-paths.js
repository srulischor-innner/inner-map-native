// THE PUBLISHED LEGAL TEXT NAMES A ROUTE THROUGH THIS APP. PIN IT.
//
// The privacy policy and the terms tell people exactly where to tap to export
// their data and to delete their account. Those sentences are published on
// my-inner-map.com, they are what an App Store or Play reviewer follows, and
// they are drafted by counsel — nobody editing a screen in here is going to
// remember they exist. They have already gone stale once: both documents sent
// people to "Settings -> Privacy -> Delete My Account" for months after the IA
// pass moved deletion to Settings -> ACCOUNT -> "Delete account" and the data
// controls to the side menu's "Privacy, Data & Safety".
//
// This check is the tripwire. Each entry below is a hop in a route a published
// document names. If a hop stops existing, the run goes red and says which
// sentence in which document just became false — so the choice is a deliberate
// one: restore the row, or send counsel the new wording.
//
// It does NOT read the legal repo. That repo is deliberately dependency-free
// static HTML with no build, and a check that reaches across two working
// copies is a check that fails on every machine that only cloned one. The
// sentences are transcribed here instead, and the transcription is the thing a
// person updates in the same commit as the wording.
//
// WHAT `sentence` MEANS. Hops 1-4 quote the REPLACEMENT wording sent to
// counsel on 2026-09-10 (NOTES-FOR-COUNSEL-privacy-policy-2026-09-08.md,
// item 7). Until counsel lands it, the live document still says
// "Settings -> Privacy -> ...", which is wrong in a different way — see
// item 12 of the audit. Hop 5 quotes text that is already live and correct.
//
// Carries a negative control over EVERY hop, per the house rule that a checker
// which cannot fail is not a checker.
//
//   node scripts/check-legal-nav-paths.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

const MENU     = read('components/HamburgerMenu.tsx');
const SETTINGS = read('app/settings.tsx');
const PRIVACY  = read('app/privacy.tsx');

// Narrow slices, not whole files. "Delete account" appears in a comment in
// settings.tsx and "Export my data" appears in an accessibilityLabel — a
// whole-file substring test would pass on either while the visible control was
// gone.
const ACCOUNT_SECTION = (SETTINGS.match(/function AccountSection\(\)[\s\S]*$/) || [''])[0];
const PRIVACY_DATA_SECTION = (PRIVACY.match(/<Text style=\{styles\.h2\}>Your data<\/Text>[\s\S]*?<\/>\s*\);/) || [''])[0];

// Each hop: the sentence that depends on it, the slice it must live in, and
// the thing that must be there. Keep `sentence` in lockstep with the published
// wording — it is what the failure message quotes back.
const HOPS = [
  {
    doc: 'privacy-policy.html — Access',
    sentence: 'Settings -> Privacy, Data & Safety -> Export My Data',
    hop: 'the side menu has a "Privacy, Data & Safety" row that opens /privacy',
    slice: MENU,
    test: (s) => /label="Privacy, Data & Safety"/.test(s) && /go\('\/privacy'\)/.test(s),
  },
  {
    doc: 'privacy-policy.html — Access',
    sentence: '...then Export My Data',
    hop: '/privacy renders a control reading EXPORT MY DATA',
    slice: PRIVACY_DATA_SECTION,
    test: (s) => /'EXPORTING…' : 'EXPORT MY DATA'/.test(s),
  },
  {
    doc: 'privacy-policy.html — Deletion / terms-of-service.html — Suspension and termination',
    sentence: 'Tap Settings, then Delete account under ACCOUNT',
    hop: 'Settings renders a "Delete account" row inside the ACCOUNT section',
    slice: ACCOUNT_SECTION,
    test: (s) => /<Text style=\{styles\.rowTitle\}>Delete account<\/Text>/.test(s)
              && /router\.push\('\/account\/delete' as any\)/.test(s),
  },
  {
    doc: 'privacy-policy.html — Deletion',
    sentence: '...or open the menu, tap Privacy, Data & Safety, and use Delete My Account there',
    hop: '/privacy renders a control reading DELETE MY ACCOUNT',
    slice: PRIVACY_DATA_SECTION,
    test: (s) => /DELETE MY ACCOUNT/.test(s),
  },
  {
    doc: 'delete-account.html — How to delete your account (LIVE TEXT, already correct)',
    sentence: 'Tap the menu icon (top-left) / Tap Settings',
    hop: 'the side menu has a row that opens /settings',
    slice: MENU,
    test: (s) => /go\('\/settings'\)/.test(s),
  },
  {
    doc: 'privacy-policy.html — Access / How to exercise your rights',
    sentence: 'The fastest way is in-app: Settings -> Privacy, Data & Safety has export and deletion buttons',
    hop: 'Settings renders a "Privacy, Data & Safety" row that opens /privacy',
    slice: SETTINGS,
    // Anchored on the PLAIN route. `/privacy` on its own is not enough: the
    // crisis pointer row at the top of Settings pushes '/privacy?focus=crisis',
    // so a looser test passes with no data row on the screen at all.
    test: (s) => /<Text style=\{styles\.rowTitle\}>Privacy, Data & Safety<\/Text>/.test(s)
              && /router\.push\('\/privacy' as any\)/.test(s),
  },
];

const fails = [];
for (const h of HOPS) {
  if (!h.slice || !h.test(h.slice)) {
    fails.push(
      `${h.hop}\n      -> gone, which makes this sentence false: "${h.sentence}"\n      -> published in ${h.doc}`
    );
  }
}

// Negative controls — EVERY matcher must be able to go red, not just the
// first. A hop whose regex degenerates into always-true is a hop that has
// stopped guarding its sentence, and it would otherwise look identical to a
// hop that passes honestly.
const DECOY = 'nothing here resembles a menu row, a settings screen, or a data control';
for (let i = 0; i < HOPS.length; i++) {
  if (HOPS[i].test(DECOY)) {
    fails.push(
      `NEGATIVE CONTROL PASSED for hop ${i + 1} (${HOPS[i].hop})\n      -> that matcher cannot fail, so its green means nothing`
    );
  }
}

if (fails.length) {
  console.error('check-legal-nav-paths: FAIL\n');
  for (const f of fails) console.error('  - ' + f + '\n');
  console.error('  Either restore the hop, or send counsel the replacement wording BEFORE this ships.');
  process.exit(1);
}
console.log(`check-legal-nav-paths: OK — ${HOPS.length} published navigation hops still exist`);
