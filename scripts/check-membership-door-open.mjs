// THE DOOR MUST NOT EXIST ON A BUILD THAT CANNOT SELL ANYTHING.
//
//   node scripts/check-membership-door-open.mjs
//
// CONSTRAINT 4, AS A CHECK RATHER THAN A DISCOVERY ON A DEVICE. The RevenueCat
// Android key slot in app.config.js is EMPTY and nothing is set in the
// environment, so configurePurchases() latches _configureImpossible and every
// store call no-ops. A mandatory paywall on that build is a locked door with no
// handle. MEMORY also records the Play products as ALL DRAFT, so even with a key
// pasted the offering can come back empty and land on the same dead screen.
//
// AND SINCE 2026-09-15 IT GUARDS A SECOND THING, WHICH IS WHY IT MATTERS MORE
// THAN IT DID. This app now sends a platform header, which is what makes the
// server's entitlement wall reachable at all — it had never been reachable,
// because an absent header answers platform-unknown and that is OPEN. For iOS
// that is the whole point. For Android it would have been an exposure: announce
// 'android' and the only thing left between an Android user and a 402 on all
// fourteen surfaces, with no way to pay anywhere on the device, is one
// ENTITLEMENT_PLATFORMS edit. So the header carries the STORE and not the OS,
// and the same empty key slot that closes the client door also keeps Android
// silent. THE EMPTY KEY SLOT IS THEREFORE LOAD-BEARING TWICE OVER, and the two
// halves of it are asserted together below so neither can be removed alone.
//
// WHAT THIS PROVES BY MEASUREMENT: across every input combination in which the
// store cannot be configured, the decision opens the door ZERO times — with a
// configurable-store CONTROL sweep asserting it opens some, so this cannot pass
// by never opening at all.
//
// WHAT IT REPORTS RATHER THAN ASSERTS: the LIVE key state, as a SKIP line.
// ci-run-all.js prints it inline, repeats it under "half-check(s) skipped — this
// green does not cover them", and writes it to the GitHub step summary. A live
// environment fact cannot be revert-checked, and it is declared as such.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${why ? '\n         ' + why : ''}`); }
};
function die(msg) {
  console.error(`\ncheck-membership-door-open: CANNOT RUN — ${msg}`);
  process.exit(2);
}
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

let D;
try { D = await import('../services/membershipDecision.ts'); }
catch (e) { die(`could not load services/membershipDecision.ts — ${e && e.message}`); }
if (typeof D.decideDoor !== 'function') die('services/membershipDecision.ts does not export decideDoor');
if (typeof D.sellablePlatform !== 'function') die('services/membershipDecision.ts does not export sellablePlatform');

console.log('\n=== an unconfigurable store can never produce a door ===');
const STATES = ['none', 'active', 'trialing', 'grace', 'frozen', 'cancelled', 'expired', 'active_capped'];
const BILLINGS = [null];
for (const known of [true, false])
  for (const entitled of [true, false])
    for (const state of STATES) BILLINGS.push({ known, entitled, state });

function sweep(storeConfigurable) {
  let n = 0, shown = 0;
  for (const enabled of [true, false])
    for (const alreadyShown of [true, false])
      for (const offeringAvailable of [true, false])
        for (const storeEntitled of [true, false, null])
          for (const billing of BILLINGS) {
            n++;
            if (D.decideDoor({ enabled, alreadyShown, storeConfigurable, offeringAvailable, storeEntitled, billing }).show) shown++;
          }
  return { n, shown };
}
const blocked = sweep(false);
const control = sweep(true);
ok('CONTROL — the sweep is the size it claims', blocked.n === 792 && control.n === 792, `${blocked.n} / ${control.n}`);
ok('CONTROL — a configurable store DOES open the door sometimes', control.shown > 0,
  'a sweep that never opens proves nothing about one that must not');
ok('an unconfigurable store opens it ZERO times out of 792', blocked.shown === 0, `${blocked.shown} opened`);
ok('...and an empty offering does the same on a configurable store',
  D.decideDoor({ enabled: true, alreadyShown: false, storeConfigurable: true, offeringAvailable: false,
    storeEntitled: false, billing: { known: true, entitled: false, state: 'none' } }).show === false,
  'the Play products are all DRAFT — a paywall with no price is a dead screen');

console.log('\n=== the store guard that feeds it ===');
const PUR = read('services/purchases.ts');
ok('storeConfigurable() exists and reports the latch, not a guess',
  /export async function storeConfigurable\(\): Promise<boolean> \{/.test(PUR)
  && /return _configured && !_configureImpossible;/.test(PUR));
ok('configure still refuses a key that is absent or the wrong shape',
  /const expectedPrefix = Platform\.OS === 'ios' \? 'appl_' : 'goog_';/.test(PUR)
  && /if \(!apiKey \|\| !apiKey\.startsWith\(expectedPrefix\)\) \{/.test(PUR),
  'configuring with a placeholder mints an anonymous id against a project that cannot serve it');

// NEVER LOGS KEY MATERIAL — REWRITTEN, BECAUSE THE PREVIOUS SHAPE OF THIS
// ASSERTION WAS RED ON ARRIVAL AGAINST A FILE NOBODY HAD TOUCHED. It matched
// `console.<method>( ... apiKey<non-letter>` with a character class that crosses
// newlines, so the existing, correct, presence-only warning tripped it: there is
// no `)` between the call and the identifier, and `apiKey ?` satisfied the tail.
// It accused a line that leaks nothing.
//
// What actually has to be true is narrower and says itself: the VALUE is never
// interpolated, never handed to a logger, and never partially printed. A
// presence test that reads the variable in a condition is fine and is what the
// code correctly does today.
const warn = PUR.slice(PUR.indexOf('const expectedPrefix'), PUR.indexOf('const expectedPrefix') + 700);
ok('CONTROL — the presence-only warning is still there to be checked',
  /console\.warn\(/.test(warn) && /is \$\{apiKey \? /.test(warn),
  'if the warning is gone, the three negatives below are negative about nothing');
ok('...and the key VALUE is never interpolated into a string',
  !/\$\{\s*(apiKey|keyForPlatform)\s*\}/.test(PUR),
  'the shape of the key is loggable; the key is not');
ok('...never handed straight to a logger',
  !/console\.[a-z]+\(\s*(apiKey|keyForPlatform)\b/.test(PUR));
ok('...and never printed in part, which is the same leak more slowly',
  !/\$\{\s*(apiKey|keyForPlatform)\s*\.\s*(slice|substring|substr|charAt|at)\b/.test(PUR));

// UNKNOWN IS NOT NO. This is the rule that stops a StoreKit hiccup creating a
// payer who is shown a paywall — the one lockout scenario the last review could
// not close, because the remedy for it is a server call that is currently a 503.
ok('the client entitlement read can say "I do not know"',
  /export async function hasActiveEntitlement\(\): Promise<boolean \| null> \{/.test(PUR),
  'returning false on a failure tells every caller the person is not a member');
{
  const i = PUR.indexOf('export async function hasActiveEntitlement()');
  const body = PUR.slice(i, PUR.indexOf('\n}', i));
  ok('CONTROL — hasActiveEntitlement was sliced', body.length > 150 && body.length < 900, `${body.length} chars`);
  ok('...and BOTH of its non-answers are null, not false',
    (body.match(/return null;/g) || []).length === 2 && !/return false;/.test(body),
    body.replace(/\s+/g, ' ').slice(0, 240));
  ok('the client entitlement read binds our identity first, like purchase and restore',
    /await ensureIdentified\(\);/.test(body),
    'a CustomerInfo read on an anonymous id returns "no entitlement" for a person who has one');
}
{
  const u = D.decideDoor({
    enabled: true, alreadyShown: false, storeConfigurable: true, offeringAvailable: true,
    storeEntitled: null, billing: { known: true, entitled: false, state: 'none' },
  });
  ok('...and the decision turns that into a shut door rather than a sale',
    u.show === false && u.reason === 'store-unknown', JSON.stringify(u));
}

console.log('\n=== the key slot is load-bearing twice: the door AND the platform header ===');
// ONE RULE, TWO FILES, LIFTED FROM BOTH. services/purchases.ts decides whether to
// configure the SDK; services/membershipDecision.ts decides whether this build
// announces a platform to the server. They must agree about what a usable key
// looks like, or the app could configure a store it does not declare, or declare
// one it cannot use. Neither spelling is typed here.
const iosPrefix = (PUR.match(/Platform\.OS === 'ios' \? '([a-z_]+)' : '([a-z_]+)';/) || [])[1];
const androidPrefix = (PUR.match(/Platform\.OS === 'ios' \? '([a-z_]+)' : '([a-z_]+)';/) || [])[2];
ok('CONTROL — both prefixes were lifted out of services/purchases.ts',
  !!iosPrefix && !!androidPrefix, `${iosPrefix} / ${androidPrefix}`);
ok('the header and the SDK agree about what a usable key looks like',
  D.STORE_KEY_PREFIXES.ios === iosPrefix && D.STORE_KEY_PREFIXES.android === androidPrefix,
  `${JSON.stringify(D.STORE_KEY_PREFIXES)} vs ${iosPrefix}/${androidPrefix}`);

// THE ANDROID PAIR, ASSERTED TOGETHER. With no Play key: the door cannot open
// AND nothing is announced to the server. Either half alone would leave a person
// who cannot buy anything facing something they cannot get past.
ok('with no Play key, an Android build shows no door',
  D.decideDoor({ enabled: true, alreadyShown: false, storeConfigurable: false, offeringAvailable: true,
    storeEntitled: false, billing: { known: true, entitled: false, state: 'none' } }).show === false);
ok('...and announces no platform, so the server wall stays open for it too',
  D.sellablePlatform('android', `${iosPrefix}live`, '') === ''
  && D.sellablePlatform('android', `${iosPrefix}live`, 'placeholder') === '',
  'platform-unknown is OPEN at server.js:7733 — that is the protection a bare Platform.OS would have deleted');
ok('...while iOS, which CAN buy, does announce itself',
  D.sellablePlatform('ios', `${iosPrefix}live`, '') === 'ios',
  'without this the server wall is unreachable for the only platform that can pay');
ok('...and pasting a Play key arms both halves at once, deliberately',
  D.sellablePlatform('android', '', `${androidPrefix}live`) === 'android',
  'the client stops being silent at the same moment purchasing becomes possible — one decision, not two');
ok('a platform with no store at all is never announced',
  D.sellablePlatform('web', `${iosPrefix}a`, `${androidPrefix}b`) === ''
  && D.sellablePlatform(undefined, `${iosPrefix}a`, `${androidPrefix}b`) === '');

console.log('\n=== the live key state — reported, not asserted ===');
const CFG = read('app.config.js');
ok('CONTROL — the Android key slot was located',
  /revenueCatApiKeyAndroid:\s*\r?\n?\s*process\.env\.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY \|\| '',/.test(CFG),
  'if this stops matching, the SKIP line below is reporting on nothing');
const envKey = String(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '').trim();
const cfgKey = (CFG.match(/revenueCatApiKeyAndroid:\s*\r?\n?\s*'([^']*)'/) || [])[1] || '';
const liveKey = envKey || cfgKey;
if (!liveKey) {
  console.log(`  [4] SKIP  the Android membership key is EMPTY in this environment — Android configures no store, shows no door, and announces no platform, so it meets no server wall either. Android is free until a key is pasted, and pasting one is a founder decision because it arms both halves.`);
} else if (!liveKey.startsWith(androidPrefix || 'goog_')) {
  console.log(`  [4] SKIP  an Android key is set but does not carry the ${androidPrefix} prefix — purchases.ts treats it as absent and no platform is announced.`);
} else {
  console.log(`  [4] SKIP  an Android key IS set, so this build both shows a door and announces 'android' to the server. Whether the Play products are purchasable is not checkable from here (MEMORY records them ALL DRAFT as of 2026-08-26), and whether ENTITLEMENT_PLATFORMS names android is a server-side fact.`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
