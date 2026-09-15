// THE MEMBERSHIP DOOR — WHERE IT STANDS, AND EVERYWHERE IT DOES NOT.
//
//   node scripts/smoke-membership-door.mjs
//
// WHAT THIS FILE IS FOR. Two previous designs put a paywall in front of the app
// and were rejected because a lapsed subscriber's own map and journal ended up
// behind it. The door now has exactly two call sites, both inside
// app/onboarding.tsx's terminal exits. Sections 6 and 7 are the ones that matter:
// they are a CENSUS, not a vibe, and they go red if a third call site appears
// anywhere in app/, services/, components/, utils/ or constants/.
//
// EVERY CENSUS RUNS OVER COMMENT-STRIPPED SOURCE. The previous smoke counted a
// literal that its own patch's comments also contained, so it was RED on
// arrival on the gate's most important invariant. The stripper carries two
// CONTROLs (it removed something; it did not remove code) and a probe.
//
// THE DECISION AND THE COMPOSITION ARE EXECUTED, not grepped:
// services/membershipDecision.ts has zero imports, so this file imports it with
// Node's own type stripping — the same idiom check-guide-matches-app.mjs already
// uses green in this suite — and drives resolveDoor with counting stubs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const req = createRequire(import.meta.url);
const { orderedIn } = req('./lib/order.js');

let pass = 0, fail = 0;
const step = (label, cond, why) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${why ? '\n         ' + why : ''}`); }
};
function die(msg) {
  console.error(`\nsmoke-membership-door: CANNOT RUN — ${msg}`);
  console.error('A lift that finds nothing makes every rule below vacuous, so this exits 2 rather than passing.');
  process.exit(2);
}
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

const stripComments = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/([^:"'`])\/\/[^\n]*/g, '$1');

function fnBody(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return '';
  const open = src.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  return '';
}
function between(src, a, b) {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i + a.length);
  return j > i ? src.slice(i, j) : '';
}

let D, X, FEAT;
try { D = await import('../services/membershipDecision.ts'); }
catch (e) { die(`could not load services/membershipDecision.ts — ${e && e.message}`); }
try { X = await import('../constants/doorExits.ts'); }
catch (e) { die(`could not load constants/doorExits.ts — ${e && e.message}`); }
try { FEAT = await import('../constants/features.ts'); }
catch (e) { die(`could not load constants/features.ts — ${e && e.message}`); }
for (const n of ['decideDoor', 'resolveDoor', 'doorRouteFor', 'normalizeDoorThen', 'awaitWithin',
                 'isMembershipRefusal', 'sellablePlatform', 'MEMBERSHIP_402_CODES', 'STORE_KEY_PREFIXES',
                 'DOOR_REASONS', 'DOOR_NOT_READY'])
  if (D[n] === undefined) die(`services/membershipDecision.ts does not export ${n}`);

console.log('\n=== 0. the decision module stays loadable ===');
const DEC = stripComments(read('services/membershipDecision.ts'));
step('CONTROL — the stripper removes comments and keeps code', (() => {
  const s = stripComments("const a = 1; // gone\n/* gone */ const b = 'http://kept';\n");
  return !s.includes('gone') && s.includes('const a = 1;') && s.includes('http://kept');
})());
step('the decision module has no imports', !/^\s*import\s/m.test(DEC),
  'an import makes it unloadable here and the composition goes back to being asserted as text');
step('...and no syntax Node can strip but not transform',
  !/\benum\s+\w/.test(DEC) && !/\bnamespace\s+\w/.test(DEC) && !/\bdeclare\s/.test(DEC),
  'an enum or a namespace turns every section below into a silent skip');
step('the not-ready fallback cannot open a door', D.DOOR_NOT_READY.show === false,
  'a typo here would be a paywall on every slow cold launch');

console.log('\n=== 1. the decision, over every input it can be given ===');
const STATES = ['none', 'active', 'trialing', 'grace', 'frozen', 'cancelled', 'expired', 'active_capped'];
const BILLINGS = [null];
for (const known of [true, false])
  for (const entitled of [true, false])
    for (const state of STATES) BILLINGS.push({ known, entitled, state });

// A RESTATEMENT, NOT AN ORACLE — and that distinction is the point of this note.
// It is the same ten rules transposed into a second file. It catches a typo, a
// swapped pair, a rule dropped on one side. It CANNOT catch a rule that is wrong
// in both copies, because one reading wrote both. The assertion below it — that
// exactly ONE of the 1584 inputs opens the door, and that it is this exact input
// — is the independent one: it does not restate the rules at all, and it is what
// would survive if the restatement and the module were both wrong together.
function want(i) {
  if (!i.enabled) return 'door-disabled';
  if (i.alreadyShown) return 'already-shown';
  if (!i.storeConfigurable) return 'store-not-configurable';
  if (!i.offeringAvailable) return 'no-offering';
  if (i.storeEntitled === true) return 'store-entitled';
  if (typeof i.storeEntitled !== 'boolean') return 'store-unknown';
  if (!i.billing || i.billing.known !== true) return 'billing-unknown';
  if (i.billing.entitled === true) return 'server-entitled';
  if (i.billing.state !== 'none') return 'has-billing-history';
  return 'never-subscribed';
}

let n = 0;
const openers = [];
const seen = new Map();
const bad = [];
for (const enabled of [true, false])
  for (const alreadyShown of [true, false])
    for (const storeConfigurable of [true, false])
      for (const offeringAvailable of [true, false])
        for (const storeEntitled of [true, false, null])
          for (const billing of BILLINGS) {
            const input = { enabled, alreadyShown, storeConfigurable, offeringAvailable, storeEntitled, billing };
            const got = D.decideDoor(input);
            const wr = want(input);
            n++;
            if (got.show) openers.push(input);
            seen.set(got.reason, (seen.get(got.reason) || 0) + 1);
            if (got.reason !== wr || got.show !== (wr === 'never-subscribed'))
              if (bad.length < 5) bad.push(`${JSON.stringify(input)} → ${JSON.stringify(got)}, wanted ${wr}`);
          }
step(`the decision agrees with a transposition of the same rules on all ${n} inputs`, bad.length === 0,
  bad.join('\n         '));
step('CONTROL — the sweep is the size it claims', n === 1584, `swept ${n}`);
// THE INDEPENDENT STATEMENT. Not "the rules are these" but "the opening set is a
// single point": any single-field change to the input below — any of them, in
// any direction the sweep covers — closes the door, because there is nothing
// else in the sweep that opens it. A rule that is wrong in both the module and
// the restatement above would still have to move or widen this point.
const THE_ONE_OPENER = {
  enabled: true, alreadyShown: false, storeConfigurable: true, offeringAvailable: true,
  storeEntitled: false, billing: { known: true, entitled: false, state: 'none' },
};
step('CONTROL — exactly ONE input out of 1584 opens the door', openers.length === 1,
  `${openers.length} inputs returned show:true — a sweep that never opens proves nothing`);
step('...and it is precisely the never-subscribed device, so every single-field change closes it',
  openers.length === 1 && JSON.stringify(openers[0]) === JSON.stringify(THE_ONE_OPENER),
  JSON.stringify(openers[0]));
step('...and every reason the module can return was exercised, and no other',
  [...seen.keys()].sort().join(',') === [...D.DOOR_REASONS].sort().join(','),
  `saw: ${[...seen.keys()].sort().join(',')}`);

const base = THE_ONE_OPENER;
step('a person who has never subscribed meets the door', D.decideDoor(base).show === true);
for (const state of STATES.slice(1))
  step(`a ${state} subscriber is NEVER doored`,
    D.decideDoor({ ...base, billing: { known: true, entitled: false, state } }).show === false,
    'reads stay open — the refusal copy promises everything they made is still theirs');
step('a status read that threw doors nobody',
  D.decideDoor({ ...base, billing: { known: false, entitled: false, state: 'none' } }).reason === 'billing-unknown',
  'server.js:8049-8060 answers 200 with no entitlementActive key — that must not read as "unsubscribed"');
step('an offline device doors nobody', D.decideDoor({ ...base, billing: null }).reason === 'billing-unknown');
step('an Android build with an empty key doors nobody',
  D.decideDoor({ ...base, storeConfigurable: false }).reason === 'store-not-configurable');
step('a store with nothing purchasable doors nobody',
  D.decideDoor({ ...base, offeringAvailable: false }).reason === 'no-offering');
step('the store saying yes outranks the server saying no',
  D.decideDoor({ ...base, storeEntitled: true }).reason === 'store-entitled',
  'the entitlements table is empty until a writer secret is set, so the store is the only source that can say yes');
step('A STORE THAT DID NOT ANSWER IS NOT A STORE THAT SAID NO',
  D.decideDoor({ ...base, storeEntitled: null }).reason === 'store-unknown'
  && D.decideDoor({ ...base, storeEntitled: null }).show === false,
  'this is the rule that stops a StoreKit hiccup putting a paywall in front of somebody who has already paid');
step('...and that holds even when the server also says it has never heard of them',
  D.decideDoor({ enabled: true, alreadyShown: false, storeConfigurable: true, offeringAvailable: true,
    storeEntitled: null, billing: { known: true, entitled: false, state: 'none' } }).show === false,
  'with both entitlement writers inert the server says state:none for a payer too — the two unknowns must not add up to a sale');

console.log('\n=== 2. the composition, driven for real ===');
// Every outcome below is RECORDED as it is produced, so the closing assertion of
// this section reads real results rather than re-checking a list of strings.
const composed = new Map();
const note = (out) => { composed.set(out.reason, out.show); return out; };
function mk(over) {
  const calls = { hasShown: 0, configurable: 0, offering: 0, billing: 0, storeEnt: 0 };
  const deps = {
    enabled: true, capMs: 60,
    hasShown: async () => { calls.hasShown++; return false; },
    storeConfigurable: async () => { calls.configurable++; return true; },
    offeringAvailable: async () => { calls.offering++; return true; },
    getBilling: async () => { calls.billing++; return { known: true, entitled: false, state: 'none' }; },
    storeEntitled: async () => { calls.storeEnt++; return false; },
    ...over,
  };
  return { deps, calls };
}
{
  const { deps, calls } = mk({});
  const out = note(await D.resolveDoor(deps));
  step('the composition opens the door for a never-subscribed device',
    out.show === true && out.reason === 'never-subscribed', JSON.stringify(out));
  step('...and it really asked all four sources',
    calls.configurable === 1 && calls.offering === 1 && calls.billing === 1 && calls.storeEnt === 1,
    JSON.stringify(calls));
}
{
  const { deps, calls } = mk({ hasShown: async () => true });
  const out = note(await D.resolveDoor(deps));
  step('a device that already met the door does NO I/O at all',
    out.show === false && out.reason === 'already-shown'
    && calls.configurable === 0 && calls.offering === 0 && calls.billing === 0 && calls.storeEnt === 0,
    JSON.stringify(calls));
}
{
  const { deps, calls } = mk({ storeConfigurable: async () => false });
  const out = note(await D.resolveDoor(deps));
  step('an unreachable store short-circuits BEFORE the billing read',
    out.reason === 'store-not-configurable'
    && calls.offering === 0 && calls.billing === 0 && calls.storeEnt === 0,
    JSON.stringify(calls));
}
{
  const { deps, calls } = mk({ enabled: false });
  const out = note(await D.resolveDoor(deps));
  step('the flag off means no door, no flag read and no request',
    out.reason === 'door-disabled' && calls.hasShown === 0 && calls.billing === 0, JSON.stringify(calls));
}
{
  const { deps } = mk({ getBilling: async () => { throw new Error('boom'); } });
  const out = note(await D.resolveDoor(deps));
  step('a source that THROWS fails open, and says so',
    out.show === false && out.reason === 'resolve-threw', JSON.stringify(out));
}
{
  const t0 = Date.now();
  const { deps } = mk({ capMs: 40, getBilling: () => new Promise(() => {}) });
  const out = note(await D.resolveDoor(deps));
  const ms = Date.now() - t0;
  step('a source that HANGS fails open inside its own cap',
    out.show === false && out.reason === 'resolve-timeout' && ms < 2000, `${ms}ms ${JSON.stringify(out)}`);
}
{
  const { deps } = mk({ getBilling: async () => ({ known: true, entitled: false, state: 'frozen' }) });
  const out = note(await D.resolveDoor(deps));
  step('a LAPSED subscriber is not doored by the composition either',
    out.show === false && out.reason === 'has-billing-history');
}
{
  const { deps } = mk({ storeEntitled: async () => null });
  const out = note(await D.resolveDoor(deps));
  step('a store read that answers "I do not know" is not a sale',
    out.show === false && out.reason === 'store-unknown', JSON.stringify(out));
}
// This used to assert three string literals were absent from a list written
// fifteen lines away, under a label promising it had checked show:false. It now
// reads the RECORDED outcome of each one and the exported fallback value.
step('every composition-only outcome was produced by RUNNING it, and not one of them shows a door',
  composed.get('resolve-threw') === false
  && composed.get('resolve-timeout') === false
  && D.DOOR_NOT_READY.show === false && D.DOOR_NOT_READY.reason === 'not-ready',
  `recorded: ${JSON.stringify([...composed])}`);
step('...and none of the three is a DECISION reason, so the sweep above covers a disjoint set',
  !D.DOOR_REASONS.includes('resolve-threw') && !D.DOOR_REASONS.includes('resolve-timeout')
  && !D.DOOR_REASONS.includes('not-ready'));

console.log('\n=== 3. the patience cap ===');
step('awaitWithin(null) answers the fallback', (await D.awaitWithin(null, 60, 'F')) === 'F');
step('...a promise that resolves in time wins', (await D.awaitWithin(Promise.resolve('V'), 60, 'F')) === 'V');
step('...a promise that rejects lands on the fallback',
  (await D.awaitWithin(Promise.reject(new Error('x')), 60, 'F')) === 'F');
{
  const t0 = Date.now();
  const v = await D.awaitWithin(new Promise(() => {}), 40, 'F');
  step('...a promise that hangs lands on the fallback inside the cap',
    v === 'F' && (Date.now() - t0) < 2000, `${Date.now() - t0}ms`);
}

console.log('\n=== 4. where the door sends people ===');
const DESTS = ['/', '/relationships', '/settings', '', '/paywall?door=1', 'https://example.com/x', '//evil.test', '/../x'];
for (const dest of DESTS) {
  const norm = D.normalizeDoorThen(dest);
  step(`normalizeDoorThen(${JSON.stringify(dest)}) is on the allow-list`,
    norm === '/' || norm === '/relationships', norm);
  step('...a shut door routes straight there', D.doorRouteFor({ show: false, reason: 'x' }, dest) === norm);
  const open = D.doorRouteFor({ show: true, reason: 'never-subscribed' }, dest);
  step('...an open door routes to the paywall carrying it',
    open === `/paywall?door=1&then=${encodeURIComponent(norm)}`, open);
  step('...and the destination round-trips back out of the param',
    D.normalizeDoorThen(new URLSearchParams(open.split('?')[1]).get('then')) === norm);
}
step('CONTROL — only two destinations survive normalisation', new Set(DESTS.map(D.normalizeDoorThen)).size === 2);

console.log('\n=== 5. the 402, against the payload the server actually sends ===');
const SERVER = path.resolve(APP, '..', 'Inner world', 'server.js');
let SRC = null;
if (!fs.existsSync(SERVER)) {
  console.log('  [5] SKIP  server coverage — ../Inner world is not on disk; this half runs in the server repo');
} else {
  SRC = fs.readFileSync(SERVER, 'utf8');
  const pi = SRC.indexOf('function subscriptionRequiredPayload(verdict) {');
  const payload = pi >= 0 ? SRC.slice(pi, SRC.indexOf('\n}', pi)) : '';
  step('CONTROL — subscriptionRequiredPayload was located', payload.length > 400, `${payload.length} chars`);
  const lift = (k) => {
    const m = payload.match(new RegExp(`\\b${k}:\\s*("([^"]*)"|true|false)`));
    return m ? (m[2] !== undefined ? m[2] : m[1]) : null;
  };
  const errCode = lift('error'), typeCode = lift('type'), subFlag = lift('subscriptionRequired');
  step('CONTROL — the three keys were LIFTED from the server, not retyped here',
    !!errCode && !!typeCode && subFlag === 'true', `${errCode} / ${typeCode} / ${subFlag}`);
  step('the client parses the payload the server actually sends',
    D.isMembershipRefusal({ error: errCode, type: typeCode, subscriptionRequired: true }) === true);
  step('...and would still parse it with the compatibility shim deleted',
    D.isMembershipRefusal({ error: errCode, subscriptionRequired: true }) === true,
    'the server marks type:"trial_expired" for deletion; this build must not be what keeps it alive');
  step('...and parses a server that has not redeployed yet, on the shim alone',
    D.isMembershipRefusal({ type: typeCode }) === true);
  // EACH BRANCH ON ITS OWN. Driving a payload that carries all three keys proves
  // only that at least one branch fired; these three name which. Without them,
  // deleting the honest-key branch — the whole point of the parser rewrite — is
  // a change nothing notices.
  step('...the honest key ALONE is enough', D.isMembershipRefusal({ subscriptionRequired: true }) === true,
    'this is the key the server wants read, and the one that lets the shim be deleted');
  step('...the error code ALONE is enough', D.isMembershipRefusal({ error: errCode }) === true);
  step('...and the shim ALONE is enough', D.isMembershipRefusal({ type: typeCode }) === true);
  step('a budget refusal is NOT a membership refusal',
    D.isMembershipRefusal({ error: 'budget-exhausted', title: 'x' }) === false,
    'the two sheets have different remedies — top up a spent pool vs. start a membership');
  for (const junk of [null, undefined, 'string', 42, {}, { type: 'something' }, { subscriptionRequired: false }])
    step(`...and neither is ${JSON.stringify(junk)}`, D.isMembershipRefusal(junk) === false);
  step('the retired third shape is gone server-side and is NOT re-added here',
    !/error:\s*"subscription-frozen"/.test(SRC) && !D.MEMBERSHIP_402_CODES.includes('subscription-frozen'),
    'a matcher for a code nothing emits is dead weight that reads as coverage');

  const ri = SRC.indexOf('function refuseIfUnentitled(');
  const refuse = ri >= 0 ? SRC.slice(ri, SRC.indexOf('\n}', ri)) : '';
  step('CONTROL — refuseIfUnentitled was located', refuse.length > 200, `${refuse.length} chars`);
  const ro = orderedIn(refuse, 'if (crisisTurn) return false;', 'entitlementVerdict(req)');
  step('crisis short-circuits above the flag and above every lookup', ro.ok, ro.why);
  step('GET /api/crisis/resources needs no account and no subscription',
    /app\.get\("\/api\/crisis\/resources",\s*\(req, res\)/.test(SRC),
    'a requireUserId on that route puts a login in front of a hotline');

  const surfaces = [...SRC.matchAll(/refuseIfUnentitled\(req, res, \{[^}]*surface: "([a-z-]+)"/g)].map((m) => m[1]).sort();
  step('CONTROL — the gated-surface census found the call sites', surfaces.length >= 10, surfaces.join(','));
  const EXPECTED = ['chat', 'gather-noticed', 'guide', 'journal-write', 'map-voice',
    'partner-session-end', 'partner-session-start', 'partner-session-summary', 'partner-share-summary',
    'reading', 'self-voice', 'session-summary', 'shared-contribute', 'shared-respond'];
  step('every gated surface STARTS new work, and the list has not grown',
    surfaces.join(',') === EXPECTED.join(','), surfaces.join(','));

  // THE READS STAY OPEN — derived from the ROUTE TABLE, not from the surface
  // names above. Each refusal is attributed to the nearest route declaration
  // that precedes it, which turns "fourteen surfaces" into "fourteen endpoints"
  // and lets the five endpoints constraint (d) depends on be named and checked.
  // The previous version of this assertion re-tested the surface-name list one
  // line after it had already been pinned exactly, and could not fail on its own.
  const routes = [...SRC.matchAll(/app\.(get|post|put|delete|patch)\(\s*"([^"]+)"/g)].map((m) => ({ i: m.index, p: m[2] }));
  const calls = [...SRC.matchAll(/if \(refuseIfUnentitled\(req, res/g)].map((m) => m.index);
  const gated = new Set();
  for (const c of calls) {
    let last = null;
    for (const r of routes) { if (r.i < c) last = r; else break; }
    if (last) gated.add(last.p);
  }
  step('CONTROL — the route table and the refusals were both found',
    routes.length > 50 && calls.length === surfaces.length, `${routes.length} routes / ${calls.length} refusals`);
  step('each refusal belongs to its own endpoint — fourteen surfaces, fourteen endpoints',
    gated.size === EXPECTED.length, `${gated.size} endpoints: ${[...gated].sort().join(' ')}`);
  const READS = ['/api/sessions', '/api/latest-map', '/api/reading', '/api/account/export', '/api/account'];
  step('CONTROL — the five endpoints a lapsed subscriber lives on all exist',
    READS.every((r) => routes.some((x) => x.p === r)), READS.join(' '));
  step('...and NOT ONE of them is gated: history, map, reading, export, deletion',
    READS.every((r) => !gated.has(r)), READS.filter((r) => gated.has(r)).join(' '));
}

console.log('\n=== 6. WHERE THE DOOR STANDS — the census ===');
const files = [];
(function walkAll() {
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(APP, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(child); }
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(child);
    }
  };
  for (const d of ['app', 'services', 'components', 'utils', 'constants']) walk(d);
})();
step('CONTROL — the source walk found the app',
  files.length > 60 && files.includes('app/onboarding.tsx') && files.includes('app/paywall.tsx')
  && files.includes('app/_layout.tsx'), `${files.length} files`);
const CODE = new Map(files.map((f) => [f, stripComments(read(f))]));
step('CONTROL — stripping removed comments and left the code behind',
  CODE.get('app/onboarding.tsx').includes('async function finishAndEnterApp()')
  && CODE.get('app/onboarding.tsx').length < read('app/onboarding.tsx').length);

const callers = files.filter((f) => f !== 'services/membershipDoor.ts' && /\bdoorForExit\(/.test(CODE.get(f)));
step('doorForExit is called from exactly ONE file', callers.length === 1 && callers[0] === 'app/onboarding.tsx',
  callers.join(',') || 'nowhere');
const nCalls = (CODE.get('app/onboarding.tsx').match(/\bdoorForExit\(/g) || []).length;
step('...exactly twice, once per terminal exit', nCalls === 2, `${nCalls} calls`);
const primers = files.filter((f) => f !== 'services/membershipDoor.ts' && /\bprimeDoor\(/.test(CODE.get(f)));
step('primeDoor is called from exactly one file, the same one',
  primers.length === 1 && primers[0] === 'app/onboarding.tsx', primers.join(',') || 'nowhere');

const DOOR_WORDS = /membershipDoor|doorForExit|primeDoor|decideDoor|resolveDoor/;
step('CONTROL — app/_layout.tsx was read and still carries its boot routing',
  CODE.get('app/_layout.tsx').includes('setPendingRoute('));
step('NOTHING IN THE BOOT PATH CAN OPEN THE DOOR', !DOOR_WORDS.test(CODE.get('app/_layout.tsx')),
  'a door at boot is a door in front of a lapsed subscriber\'s own map — the defect that killed the last two designs');
const tabs = files.filter((f) => f.startsWith('app/(tabs)/'));
step('CONTROL — the tab screens were found', tabs.length >= 6, tabs.join(','));
step('no tab screen can open the door', !tabs.some((f) => DOOR_WORDS.test(CODE.get(f))),
  'the map, journal, journey, guide and chat are reads and stay reads');
step('CONTROL — the deep-link choke point still gates on the age flag',
  CODE.get('app/+native-intent.ts').includes('isAgeGateBlocked')
  && CODE.get('app/+native-intent.ts').includes("const BLOCK_DESTINATION = '/onboarding';"));
step('deep links are not membership-gated, deliberately', !DOOR_WORDS.test(CODE.get('app/+native-intent.ts')),
  'every deep-link destination is a read, a crisis surface, /privacy, /account/delete, or a surface the server refuses');

const ONB = CODE.get('app/onboarding.tsx');
const F1 = fnBody(ONB, 'async function finishAndEnterApp()');
const F2 = fnBody(ONB, 'async function finishAsInvitee()');
step('CONTROL — both terminal exits were sliced',
  F1.length > 80 && F1.length < 2500 && F2.length > 80 && F2.length < 2500, `${F1.length}/${F2.length} chars`);
step('CONTROL — the two slices are different functions',
  F1 !== F2 && !F1.includes('finishAsInvitee') && !F2.includes('finishAndEnterApp'));
for (const [name, body, dest] of [['the full-path exit', F1, "'/'"], ['the invitee exit', F2, "'/relationships'"]]) {
  const r = orderedIn(body, `await doorForExit(${dest})`, 'router.replace(');
  step(`${name} resolves the door BEFORE it navigates`, r.ok, r.why);
  step(`...and it makes exactly one navigation`, (body.match(/router\.replace\(/g) || []).length === 1,
    'a second replace is a second exit the door does not cover');
}
const gi = ONB.indexOf('if (ageBlocked !== false) return;');
const pj = ONB.indexOf('primeDoor();');
step('CONTROL — the age guard and the prime are both present', gi >= 0 && pj >= 0, `${gi} / ${pj}`);
step('the prime is guarded by the age read, in the same block, above it',
  gi >= 0 && pj > gi && !ONB.slice(gi, pj).includes('}'),
  'app/_layout.tsx hard-returns before token bootstrap for a blocked device; an ungated prime here would configure RevenueCat and read /api/billing/status for exactly that person');
// The answer is computed once per process and bound to whatever identity exists
// at MOUNT. services/membershipDoor.ts says so out loud and says what to do if
// this stops being true; this is the assertion that makes it stop being silent.
step('CONTROL — onboarding still runs the phase machine it is built around',
  /setPhase\(/.test(ONB), 'if this is gone the negative below is negative about the wrong file');
step('nothing inside onboarding can change identity mid-flow',
  !/sign-in|signIn\(/.test(ONB),
  'the door answer is computed once, at mount; a sign-in inside this flow would bind it to the wrong person');

console.log('\n=== 7. the door screen, and every way off it ===');
const PW = CODE.get('app/paywall.tsx');
const HEADER = between(PW, '<View style={styles.headerRow}>', '<ScrollView');
step('CONTROL — the header row was sliced', HEADER.length > 100 && HEADER.length < 3000, `${HEADER.length} chars`);
step('the way out is in the header, in door mode, LABELLED',
  HEADER.includes('isDoor ?') && HEADER.includes('Not now'));
// THE UNCONDITIONALITY PROOF, COUNTED RATHER THAN BLOCKLISTED. The previous
// version named two identifiers and asserted their absence from a region that
// had never contained them. This counts what is actually there: one ternary, the
// door one, and no other branch of any kind. Wrap the control in anything —
// a status test, a new flag, a && — and the counts move.
const qs = (HEADER.match(/\?/g) || []).length;
const ands = (HEADER.match(/&&/g) || []).length;
step('...and it is UNCONDITIONAL: exactly one branch in the whole row, and it is the door one',
  qs === 1 && ands === 0 && (HEADER.match(/\bisDoor\b/g) || []).length === 1,
  `${qs} ternaries, ${ands} &&, ${(HEADER.match(/\bisDoor\b/g) || []).length} isDoor`);
// A SECOND, LIFTED NEGATIVE. The gate names are not typed here: they are read
// out of the screen's own state comparisons at run time, so a new gate added
// tomorrow is covered without anybody remembering to add it.
const gateNames = [...new Set([...PW.matchAll(/\b([A-Za-z_$][\w$]*)\s*===\s*'/g)].map((m) => m[1]))]
  .filter((g) => g !== 'firstParam' && g !== 'isDoor');
step('CONTROL — the screen\'s own state comparisons were lifted', gateNames.length >= 1, gateNames.join(','));
step('...and not one of them reaches the way out', !gateNames.some((g) => new RegExp(`\\b${g}\\b`).test(HEADER)),
  gateNames.filter((g) => new RegExp(`\\b${g}\\b`).test(HEADER)).join(','));
const MEMBER = between(PW, 'showMemberState ?', 'accessibilityLabel="Restore purchases"');
step('CONTROL — the already-a-member branch was sliced', MEMBER.length > 400 && MEMBER.length < 8000, `${MEMBER.length} chars`);
// THE COMPLIANCE SURFACE IS ONE VERSION, NOT TWO. The price, the disclosure and
// the call to action are the same bytes in both modes, and this is the proof:
// the door flag does not occur anywhere inside that region, so there is nothing
// there that could differ.
const PRICE = between(PW, '<Text style={styles.title}>', 'accessibilityLabel="Restore purchases"');
step('CONTROL — the price and disclosure region was sliced, and the door flag exists elsewhere',
  PRICE.length > 800 && PRICE.length < 12000 && (PW.match(/\bisDoor\b/g) || []).length >= 4,
  `${PRICE.length} chars, ${(PW.match(/\bisDoor\b/g) || []).length} isDoor in file`);
step('door mode cannot change the price, the disclosure or the call to action',
  !/\bisDoor\b/.test(PRICE),
  'a second version of a compliance surface is a second thing to keep true');
const EXITS = between(PW, 'accessibilityLabel="Restore purchases"', '<View style={styles.legalRow}>');
step('CONTROL — the region between the restore control and the legal links was sliced',
  EXITS.length > 60 && EXITS.length < 3000, `${EXITS.length} chars`);
step('the crisis and data exits render in that region', EXITS.includes('DOOR_EXITS.map('));
step('...exactly once in the file', (PW.match(/DOOR_EXITS\.map\(/g) || []).length === 1);
step('...and never inside the already-a-member branch', !MEMBER.includes('DOOR_EXITS'));
const ONP = fnBody(PW, 'const onPurchase = useCallback(async ()');
const ONR = fnBody(PW, 'const onRestore = useCallback(async ()');
step('CONTROL — onPurchase and onRestore were sliced',
  ONP.length > 200 && ONP.length < 4000 && ONR.length > 300 && ONR.length < 6000, `${ONP.length}/${ONR.length}`);
step('a cancellation still cannot be mistaken for a failure', ONP.includes('if (res.cancelled) return;'));
for (const [name, body] of [['a successful purchase', ONP], ['a successful restore', ONR]]) {
  step(`${name} tells the server about it`, body.includes('api.billingSync()'),
    'POST /api/billing/sync (server.js:7918) is the only way a row gets written while the webhook is 503-walled');
  const r = orderedIn(body, 'api.billingSync()', 'router.replace(');
  step(`...before it leaves the screen`, r.ok, r.why);
}
// THE REMEDY CAN SILENTLY NOT RUN, SO THE SCREEN SAYS WHICH HALVES WORKED.
// billingSync is a 503 until RC_SECRET_API_KEY is set — the same configuration
// that leaves a payer with no row. An alert that says "restored" to somebody who
// is about to be refused again is the failure this pins.
step('the restore path WAITS for the server answer rather than assuming it',
  ONR.includes('await awaitWithin(api.billingSync(), BILLING_SYNC_WAIT_MS, false)'),
  'fire-and-forget here would mean the alert below is written before the answer exists');
step('...and the alert it shows depends on that answer',
  /applied \? 'Membership restored' : /.test(ONR) && ONR.includes('applied'),
  'one sentence for "the store and the server both agree" and a different one for "only this device knows"');
step('...while the purchase path deliberately does NOT wait',
  !ONP.includes('await awaitWithin(api.billingSync()') && ONP.includes('api.billingSync().catch('),
  'a person who has just paid must not be held behind a billing call');
step('a restore that finds NOTHING does not navigate anywhere',
  ONR.includes("'Nothing to restore'") && !between(ONR, "'Nothing to restore'", 'return;').includes('router.'),
  'the escape from that state is the unconditional header control, not a second navigation');
// THE STALE-CLOSURE PATH THE LAST REVIEW FOUND: onPurchase and onRestore read
// isDoor and thenRoute, so both must declare them. If either went stale in door
// mode a paid-for purchase would call router.back(), which no-ops on a screen
// arrived at by replace() — the person pays and the screen does not move.
function depsOf(src, head) {
  const body = fnBody(src, head);
  if (!body) return null;
  const at = src.indexOf(body) + body.length;
  const m = src.slice(at, at + 400).match(/^\s*,\s*\[([^\]]*)\]/);
  return m ? m[1] : null;
}
for (const [name, head] of [['onPurchase', 'const onPurchase = useCallback(async ()'],
                            ['onRestore', 'const onRestore = useCallback(async ()'],
                            ['close', 'const close = useCallback(']]) {
  const deps = depsOf(PW, head);
  step(`CONTROL — ${name}'s dependency array was found`, deps !== null && deps.includes('router'), String(deps));
  step(`${name} declares the door values it reads`,
    !!deps && /\bisDoor\b/.test(deps) && /\bthenRoute\b/.test(deps), `deps: [${deps}]`);
}

console.log('\n=== 8. the exits are data, and they lead somewhere ===');
const EX = X.DOOR_EXITS;
step('CONTROL — the exits list loaded and is not empty', Array.isArray(EX) && EX.length >= 2, JSON.stringify(EX));
const crisis = EX.filter((e) => e.kind === 'crisis');
const data = EX.filter((e) => e.kind === 'data');
step('exactly one crisis exit', crisis.length === 1);
step('exactly one export/deletion exit', data.length === 1);
step('the crisis exit goes to the resources screen and says where it came from',
  crisis.length === 1 && crisis[0].href === '/support-resources?from=door');
step('the data exit goes to the screen that owns BOTH export and deletion',
  data.length === 1 && data[0].href === '/privacy');
for (const e of EX) {
  const name = String(e.href).replace(/^\//, '').split('?')[0];
  step(`${e.href} is a real route`, fs.existsSync(path.join(APP, 'app', `${name}.tsx`)), `app/${name}.tsx`);
  step(`...a ROOT route, so it renders with the tabs unmounted`,
    !fs.existsSync(path.join(APP, 'app', '(tabs)', `${name}.tsx`)));
  step(`...with a label a person can read`, typeof e.label === 'string' && e.label.length > 3, e.label);
}
const SRS = read('components/safety/SupportResourcesScreen.tsx');
step('the crisis screen carries its numbers as compiled-in literals',
  /const LIFELINE_NUMBER = '988';/.test(SRS)
  && /const SAMARITANS_NUMBER = '116 123';/.test(SRS)
  && /const HELPLINE_HOST = 'findahelpline\.com';/.test(SRS),
  'a hotline fetched over the network is a hotline that is missing exactly when it is needed');
step('...and it makes no API call of any kind', !/services\/api|apiFetch|fetch\(/.test(SRS));
const PRIV = CODE.get('app/privacy.tsx');
step('the data screen carries export, deletion and a crisis card',
  PRIV.includes('api.exportAccount()') && PRIV.includes("router.push('/account/delete'")
  && PRIV.includes('<CrisisResourcesCard'));
step('...and nothing on it reads an entitlement',
  !/getBillingStatus|hasActiveEntitlement|entitlementActive/.test(PRIV));

console.log('\n=== 9. the header that makes the server wall reachable at all ===');
const USER = CODE.get('services/user.ts');
step('CONTROL — there is exactly one header injector',
  (USER.match(/export async function buildIdentityHeaders/g) || []).length === 1);
const CLIENT_HEADER = (USER.match(/headers\['([A-Za-z-]+)'\] = clientPlatform;/) || [])[1] || '';
step('every outbound request declares which store it can buy from', !!CLIENT_HEADER,
  'without this header the server answers platform-unknown and the wall is OPEN for every request this app will ever make');
const uo = orderedIn(USER, "headers['X-User-Id'] = userId;", `headers['${CLIENT_HEADER}'] = clientPlatform;`);
step('...from that one injector, beside the user id', uo.ok, uo.why);
// THE ANDROID EXPOSURE, CLOSED IN THE CLIENT RATHER THAN LEFT TO AN ENV VAR.
// A bare Platform.OS would announce a platform that cannot purchase and leave
// one ENTITLEMENT_PLATFORMS edit between an Android user and a 402 they have no
// way to pay past. The value is derived from the key slot instead, so the header
// appears exactly when purchasing becomes possible.
step('...and the value is DERIVED FROM THE STORE KEY, never from the OS alone',
  !/headers\['[A-Za-z-]+'\]\s*=\s*Platform\.OS/.test(USER) && USER.includes('sellablePlatform('),
  'a bare Platform.OS deletes the one protection standing between an Android user and a refusal they cannot pay past');
step('...and it is not sent at all when there is nothing to buy',
  /if \(clientPlatform\) headers\[/.test(USER),
  'an empty value is what keeps interlock 2 answering platform-unknown, which is OPEN');
for (const [os, ios, android, expect] of [
  ['ios', 'appl_live', '', 'ios'],
  ['ios', '', '', ''],
  ['ios', 'goog_wrong', '', ''],
  ['android', 'appl_live', '', ''],
  ['android', 'appl_live', 'goog_live', 'android'],
  ['android', 'appl_live', 'not_a_key', ''],
  ['web', 'appl_live', 'goog_live', ''],
  ['windows', 'appl_live', 'goog_live', ''],
]) step(`sellablePlatform(${os}, ios=${ios || 'none'}, android=${android || 'none'}) is ${JSON.stringify(expect)}`,
  D.sellablePlatform(os, ios, android) === expect, D.sellablePlatform(os, ios, android));
step('TODAY, with the Android slot empty, Android announces nothing',
  D.sellablePlatform('android', 'appl_live', '') === '',
  'that absence is the protection; the day a Play key is pasted it becomes a decision instead');
if (SRC) {
  // CROSS-REPO, AND THE POINT IS THAT NEITHER SIDE CAN BE RENAMED ALONE. Both
  // spellings are lifted from their own file; a rename on either side is red.
  const gate = SRC.slice(SRC.indexOf('function entitlementPlatformEnforced(req)'));
  const body = gate.slice(0, gate.indexOf('\n}'));
  const SERVER_HEADER = (body.match(/req\.headers\["([a-z0-9-]+)"\]/) || [])[1] || '';
  step('CONTROL — interlock 2 was located and it reads a header', !!SERVER_HEADER && body.length > 200,
    `${SERVER_HEADER} (${body.length} chars)`);
  step('the header this client sends is the header that server reads',
    !!CLIENT_HEADER && CLIENT_HEADER.toLowerCase() === SERVER_HEADER,
    `client ${CLIENT_HEADER} vs server ${SERVER_HEADER}`);
  step('...and an ABSENT value is still OPEN there, which is what protects Android',
    /if \(!p\) return \{ enforce: false, key: "platform-unknown"/.test(body),
    'if this ever became a refusal, an Android build would be walled with no way to pay');
} else {
  console.log('  [9] SKIP  the cross-repo header check — ../Inner world is not on disk; this half runs in the server repo');
}

console.log('\n=== 10. the one device flag ===');
const OB = CODE.get('services/onboarding.ts');
step('the door has exactly one device flag',
  OB.includes("const MEMBERSHIP_DOOR_SHOWN = 'membership.doorShown';"));
step('...with a setter, a reader, and a clear that only the dev reset reaches',
  (OB.match(/MEMBERSHIP_DOOR_SHOWN/g) || []).length === 4,
  `${(OB.match(/MEMBERSHIP_DOOR_SHOWN/g) || []).length} references — declaration, setter, reader, resetOnboarding`);
step('...and resetOnboarding clears it with everything else',
  fnBody(OB, 'export async function resetOnboarding()').includes('MEMBERSHIP_DOOR_SHOWN'));

console.log('\n=== 11. the suite knows about both new scripts ===');
const CI = read('scripts/ci-run-all.js');
const m = CI.match(/const EXPECTED_TOTAL = (\d+);/);
step('CONTROL — EXPECTED_TOTAL was found', !!m);
const discovered = fs.readdirSync(path.join(APP, 'scripts'))
  .filter((f) => /^(smoke|check)-.*\.(js|mjs)$/.test(f));
step('both new scripts are discovered by the runner',
  discovered.includes('smoke-membership-door.mjs') && discovered.includes('check-membership-door-open.mjs'),
  discovered.join(','));
// BOTH NUMBERS ARE READ FROM THE FILES. Three designs in a row carried an
// arithmetic answer forward and three in a row were wrong; nothing here is typed.
step('EXPECTED_TOTAL equals what the runner actually discovers',
  !!m && Number(m[1]) === discovered.length,
  `EXPECTED_TOTAL=${m && m[1]}, discovered=${discovered.length}`);

console.log('\n=== 12. the rollout flag, as it will actually ship ===');
step('CONTROL — the rollout flag is a boolean', typeof FEAT.MEMBERSHIP_DOOR_ENABLED === 'boolean',
  String(FEAT.MEMBERSHIP_DOOR_ENABLED));
{
  // DRIVEN WITH THE REAL VALUE, not a stub. Shipping it either way is now a
  // stated, tested fact instead of a composition nobody ever ran with it.
  const { deps, calls } = mk({ enabled: FEAT.MEMBERSHIP_DOOR_ENABLED });
  const out = await D.resolveDoor(deps);
  step('the composition, driven with the flag as it ships, does exactly what the flag says',
    FEAT.MEMBERSHIP_DOOR_ENABLED
      ? (out.show === true && out.reason === 'never-subscribed' && calls.billing === 1)
      : (out.show === false && out.reason === 'door-disabled' && calls.hasShown === 0 && calls.billing === 0),
    `${JSON.stringify(out)} ${JSON.stringify(calls)}`);
}
console.log(`  [12] SKIP  the door ships ${FEAT.MEMBERSHIP_DOOR_ENABLED ? 'ON' : 'OFF'} — the value above is read from constants/features.ts and reported, not asserted, because which way it ships is a founder decision and not a property of this code.`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
