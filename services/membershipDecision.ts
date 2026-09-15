// THE MEMBERSHIP DOOR — THE DECISION, WITH NO I/O IN IT.
//
// WHAT THE DOOR IS. The one-time screen a person who has never subscribed meets
// at the END of onboarding, before their first conversation (founder ruling
// 2026-09-15). It is NOT a wall in front of the app. Two previous designs put
// one there and both were rejected for the same reason: a lapsed subscriber's
// own map, journal, history and reading would have been behind it, and the
// shipped refusal copy promises the opposite.
//
// THE DIVISION OF LABOUR, STATED ONCE HERE SO NOTHING HAS TO GUESS IT.
//   THE SERVER ENFORCES. refuseIfUnentitled (server.js:7878) answers 402 on the
//   fourteen surfaces that START NEW WORK. Reads are not gated: GET
//   /api/sessions (4988), GET /api/latest-map (5220), GET /api/reading (21467),
//   GET /api/account/export (22772) and DELETE /api/account (23028) carry
//   requireUserId and nothing else, and the journal is read from the device's
//   own encrypted store with no request at all.
//   THIS CLIENT SHOWS THE PRICE AND REFUSES NOTHING. Every failure here is a
//   fail-OPEN: the person walks in and meets the server's 402 the first time
//   they start something. Fail-open costs one unseen paywall. Fail-closed costs
//   a locked door in front of somebody's own writing.
//
// ZERO IMPORTS, DELIBERATELY. scripts/smoke-membership-door.mjs imports THIS
// FILE with Node's own type stripping and EXECUTES every function in it,
// including the composition below. The previous design's composition layer had
// imports, could not be loaded, and was asserted only as source text — so
// inverting a guard in it would have been green. Do not add an import, and do
// not use enum / namespace / declare / parameter properties: Node STRIPS types,
// it does not TRANSFORM them, and any of those stops the smoke running at all.
// The smoke asserts their absence so that becomes a red, not a silent skip.

export type DoorBilling = { known: boolean; entitled: boolean; state: string } | null;

export type DoorInput = {
  enabled: boolean;
  alreadyShown: boolean;
  storeConfigurable: boolean;
  offeringAvailable: boolean;
  /** null means "the store could not answer" — never false. services/purchases.ts
   *  returns null on every path where it does not know, and rule 5 below refuses
   *  to read that as "not a member". */
  storeEntitled: boolean | null;
  billing: DoorBilling;
};

export type DoorOutcome = { show: boolean; reason: string };

/** Every reason decideDoor can return. Exported as DATA so the smoke can assert
 *  the sweep exercised all of them and produced no others, instead of restating
 *  the list and drifting from it. */
export const DOOR_REASONS: readonly string[] = [
  'door-disabled',
  'already-shown',
  'store-not-configurable',
  'no-offering',
  'store-entitled',
  'store-unknown',
  'billing-unknown',
  'server-entitled',
  'has-billing-history',
  'never-subscribed',
];

/** Per-read cap. services/onboarding.ts's own docblock is explicit that its
 *  readers swallow a THROW and cannot swallow a STALL, and that every caller
 *  must impose its own cap and choose its own direction. This is that cap; the
 *  direction is always "unknown means the door stays shut". */
export const DOOR_READ_CAP_MS = 4000;

/** How long a TERMINAL EXIT will wait for an answer that was primed on the
 *  onboarding screen's mount — screens or minutes earlier. It is NOT a shadow
 *  over DOOR_READ_CAP_MS: the reads keep running under their own caps, and this
 *  is only the patience of the person standing at the end of onboarding. The
 *  previous design stacked 16s of sequential inner caps under a 3s outer cap,
 *  which made every inner cap dead. */
export const DOOR_PATIENCE_MS = 1200;

/** How long the paywall's RESTORE path waits for the server to confirm what the
 *  store has just confirmed, before it tells the person which halves succeeded.
 *  See the note on api.billingSync: that confirmation is a 503 until
 *  RC_SECRET_API_KEY is set, and a restore alert claiming more than actually
 *  happened is how a payer ends up looping through the same screen. */
export const BILLING_SYNC_WAIT_MS = 4000;

/** The fallback when the prime has not settled in time. Exported as a VALUE so
 *  the smoke can assert show===false: a typo here would be a paywall on every
 *  slow cold launch, and it is the one place a literal could do that. */
export const DOOR_NOT_READY: DoorOutcome = { show: false, reason: 'not-ready' };

/** THE DECISION. Ten rules, in order; the first that fires wins. Exactly ONE
 *  combination of inputs reaches the bottom. */
export function decideDoor(i: DoorInput): DoorOutcome {
  // 0. The rollout flip. Off is genuinely inert — resolveDoor returns before it
  //    reads the device flag or touches the store or the network.
  if (!i || i.enabled !== true) return { show: false, reason: 'door-disabled' };
  // 1. ONE-TIME. The flag is idempotence, not enforcement.
  if (i.alreadyShown === true) return { show: false, reason: 'already-shown' };
  // 2. CONSTRAINT 4 — a build that cannot reach a store cannot show a price, and
  //    a mandatory paywall on it is a locked door with no handle. Android's key
  //    slot is empty (app.config.js:324-325) and nothing is set.
  if (i.storeConfigurable !== true) return { show: false, reason: 'store-not-configurable' };
  // 3. A store with nothing purchasable is the same dead screen one step later.
  //    The Play products are all DRAFT, so this is live, not hypothetical.
  if (i.offeringAvailable !== true) return { show: false, reason: 'no-offering' };
  // 4. THE STORE OUTRANKS THE SERVER ON "YES". setEntitlement's only writers are
  //    both inert without a secret, so the entitlements table is EMPTY and the
  //    server says state:'none' for a paying customer too. The store is the only
  //    source that can currently say yes.
  if (i.storeEntitled === true) return { show: false, reason: 'store-entitled' };
  // 5. A STORE THAT DID NOT ANSWER IS NOT A STORE THAT SAID NO, and this is the
  //    rule that stops the wrongly-doored payer from being created at all. A
  //    StoreKit hiccup, a CustomerInfo throw, an SDK that never loaded — all of
  //    them resolve to null here. With both entitlement writers inert the SERVER
  //    also says 'none' for a real payer, so without this rule one transient
  //    store error would put a paywall in front of somebody who has already
  //    paid, whose way back in is a Restore whose server half may be a 503.
  if (typeof i.storeEntitled !== 'boolean') return { show: false, reason: 'store-unknown' };
  const b = i.billing;
  // 6. UNKNOWN IS NOT "NO", THE SERVER-SIDE HALF. GET /api/billing/status's catch
  //    path answers HTTP 200 with state:"none" and NO entitlementActive key
  //    (server.js:8049-8060), which a naive reader turns into something
  //    byte-identical to "brand new". entitlementKnown is the whole defence and
  //    it is checked BEFORE either billing field is read.
  if (!b || b.known !== true) return { show: false, reason: 'billing-unknown' };
  if (b.entitled === true) return { show: false, reason: 'server-entitled' };
  // 8. ANY billing history at all — frozen, grace, cancelled, expired,
  //    active_capped — is never doored. This covers a population of roughly zero
  //    until a writer secret is set, and it is NOT what carries constraint 1:
  //    what carries it is that this function has two call sites, both inside
  //    onboarding's terminal exits, which a lapsed subscriber never re-enters.
  if (String(b.state) !== 'none') return { show: false, reason: 'has-billing-history' };
  return { show: true, reason: 'never-subscribed' };
}

// ===========================================================================
// WHICH STORE THIS BUILD CAN ACTUALLY BUY FROM
// ===========================================================================
// THE ONE FACT THE SERVER'S INTERLOCK 2 IS ASKING FOR, AND THE REASON THE
// HEADER IS NOT SIMPLY Platform.OS.
//
// Before this work the app sent no platform header at all, so
// entitlementPlatformEnforced (server.js:7733) answered platform-unknown for
// every request — which is OPEN — and the server wall was not merely disarmed,
// it was unreachable from this client. Sending the header is what makes arming
// it possible at all.
//
// BUT A BARE Platform.OS WOULD REMOVE A PROTECTION THAT IS DOING REAL WORK
// TODAY. Android is currently protected TWICE over: the RevenueCat Android key
// slot is empty, so there is no client door and no way to purchase; and there is
// no platform header, so interlock 2 holds the wall open whatever
// ENTITLEMENT_PLATFORMS says. A bare Platform.OS deletes the second protection
// and leaves ONE env-var edit between an Android user and a 402 on all fourteen
// surfaces, on a device with no purchase path anywhere on it.
//
// SO THE HEADER CARRIES THE STORE, NOT THE OS. It is sent only for a platform
// this build holds a usable key for. Today that is iOS and only iOS, so:
//   - iOS sends 'ios', and the wall becomes reachable for exactly the population
//     that can pay;
//   - Android sends nothing, stays platform-unknown, and keeps the structural
//     protection it has today;
//   - the day a Play key is pasted, Android starts sending 'android' on its own,
//     which is the same moment purchasing becomes possible. Client and server
//     stop being able to disagree about whether a platform can buy, because they
//     are reading the same fact.
//
// WHAT IS LOAD-BEARING AFTER THIS, NAMED PLAINLY: for Android it is THE EMPTY
// KEY SLOT, singular. ENTITLEMENT_PLATFORMS is no longer a second guard for
// Android, because the header it sends is absent rather than wrong. Pasting a
// Play key therefore arms two things at once and is a founder decision, not a
// config tweak — and MEMORY records the Play products as ALL DRAFT, so a key on
// its own still leaves getMembershipOffering() empty and rule 3 above still
// closes the client door.
//
// The prefixes are the same rule services/purchases.ts uses to decide whether to
// configure at all. scripts/check-membership-door-open.mjs lifts both spellings
// out of both files and asserts they agree, so the two cannot drift apart.
export const STORE_KEY_PREFIXES: { ios: string; android: string } = { ios: 'appl_', android: 'goog_' };

/** The value for the platform header, or '' meaning "send nothing". Never
 *  throws and never guesses: a key that is missing, blank or the wrong shape is
 *  the same answer as no key at all. */
export function sellablePlatform(os: unknown, iosKey: unknown, androidKey: unknown): string {
  const keyed = (k: unknown, prefix: string) => typeof k === 'string' && k.trim().startsWith(prefix);
  if (os === 'ios') return keyed(iosKey, STORE_KEY_PREFIXES.ios) ? 'ios' : '';
  if (os === 'android') return keyed(androidKey, STORE_KEY_PREFIXES.android) ? 'android' : '';
  return '';
}

// ===========================================================================
// THE 402 MATCHER
// ===========================================================================
// It lives here rather than in services/api.ts so the smoke can RUN it against
// a payload assembled from the server's own literals, lifted out of server.js
// at run time. A regex over api.ts would only prove the source contains a
// string; this proves the two halves agree.
//
// `subscription-frozen` IS NOT IN THIS LIST AND MUST NOT BE ADDED. The journal
// write used to answer with it and no shipped parser matched it at all; it now
// goes through refuseIfUnentitled (server.js:22012) like everything else, and
// the literal is emitted nowhere in server.js. A matcher for a code nothing
// sends is dead weight that reads as coverage.
export const MEMBERSHIP_402_CODES: readonly string[] = ['subscription-required', 'trial-expired'];

export function isMembershipRefusal(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  // The honest key first (server.js:7847). It is the one the server wants read,
  // and reading it is what lets the compatibility shim below be deleted.
  if (r.subscriptionRequired === true) return true;
  if (typeof r.error === 'string' && MEMBERSHIP_402_CODES.indexOf(r.error) >= 0) return true;
  // THE SHIM (server.js:7846). The only key the currently shipped build matches,
  // kept so this parser also works against a server that has not redeployed.
  if (r.type === 'trial_expired') return true;
  return false;
}

// ===========================================================================
// WHERE THE DOOR SENDS PEOPLE
// ===========================================================================
// The destination rides in a route param and is ALLOW-LISTED, not trusted:
// innermap://paywall?door=1&then=<anything> is reachable through expo-router's
// own url subscription, and a replace() onto an arbitrary string is not
// something this screen should be able to be talked into.
const DOOR_DESTINATIONS: readonly string[] = ['/', '/relationships'];

export function normalizeDoorThen(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return DOOR_DESTINATIONS.indexOf(s) >= 0 ? s : '/';
}

export function doorRouteFor(outcome: DoorOutcome, dest: string): string {
  const then = normalizeDoorThen(dest);
  if (!outcome || outcome.show !== true) return then;
  return '/paywall?door=1&then=' + encodeURIComponent(then);
}

/** Wait for `p`, but not forever, and never throw. A null promise is the
 *  "nothing was primed" case and answers immediately. The timer is cleared on
 *  both settle paths so a resolved read leaves nothing pending. */
export function awaitWithin<T>(p: Promise<T> | null, ms: number, fallback: T): Promise<T> {
  if (!p) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (v: T) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(fallback), ms);
    p.then(
      (v) => { clearTimeout(timer); done(v); },
      () => { clearTimeout(timer); done(fallback); },
    );
  });
}

// ===========================================================================
// THE COMPOSITION — INJECTABLE, SO IT IS ACTUALLY TESTED
// ===========================================================================
// Every source is a dependency rather than an import. services/membershipDoor.ts
// supplies the real ones; the smoke supplies counting stubs and asserts by CALL
// COUNT that an already-shown device does no I/O and that an unconfigurable
// store short-circuits before the billing read. That is the half the last
// review said was never executed.
export type DoorDeps = {
  enabled: boolean;
  capMs: number;
  hasShown: () => Promise<boolean>;
  storeConfigurable: () => Promise<boolean>;
  offeringAvailable: () => Promise<boolean>;
  getBilling: () => Promise<DoorBilling>;
  storeEntitled: () => Promise<boolean | null>;
};

export async function resolveDoor(d: DoorDeps): Promise<DoorOutcome> {
  if (!d || d.enabled !== true) return { show: false, reason: 'door-disabled' };
  const cap = typeof d.capMs === 'number' && d.capMs > 0 ? d.capMs : DOOR_READ_CAP_MS;
  // Object identity, so no legitimate value can ever collide with it.
  const SENTINEL: any = {};
  let failReason = '';

  // A CAP THAT FIRES IS A FAIL-OPEN, NOT A VALUE — and a THROW and a STALL are
  // told apart, because "the server errored" and "the network is gone" are
  // different operational facts and the log line has to say which.
  const read = async (fn: () => Promise<any>): Promise<any> => {
    let localThrew = false;
    const p = Promise.resolve().then(fn).catch(() => { localThrew = true; return SENTINEL; });
    const v = await awaitWithin<any>(p, cap, SENTINEL);
    if (v === SENTINEL && !failReason) failReason = localThrew ? 'resolve-threw' : 'resolve-timeout';
    return v;
  };

  try {
    const alreadyShown = await read(d.hasShown);
    if (failReason) return { show: false, reason: failReason };
    if (alreadyShown === true) return { show: false, reason: 'already-shown' };

    const configurable = await read(d.storeConfigurable);
    if (failReason) return { show: false, reason: failReason };
    if (configurable !== true) return { show: false, reason: 'store-not-configurable' };

    const offering = await read(d.offeringAvailable);
    if (failReason) return { show: false, reason: failReason };
    if (offering !== true) return { show: false, reason: 'no-offering' };

    // THE LAST TWO RUN TOGETHER. They are the slow pair — a StoreKit CustomerInfo
    // read and a server round trip — and neither depends on the other, so running
    // them in sequence would put two caps end to end under one patience budget.
    const pair = await Promise.all([read(d.storeEntitled), read(d.getBilling)]);
    if (failReason) return { show: false, reason: failReason };

    return decideDoor({
      enabled: true,
      alreadyShown: false,
      storeConfigurable: true,
      offeringAvailable: true,
      // A non-boolean here is the store declining to answer, and rule 5 keeps
      // that out of the "never subscribed" bucket.
      storeEntitled: typeof pair[0] === 'boolean' ? pair[0] : null,
      billing: pair[1] && typeof pair[1] === 'object' ? (pair[1] as DoorBilling) : null,
    });
  } catch {
    // Belt and braces: `read` already catches, so reaching here means the
    // composition itself threw. Same direction as everything else.
    return { show: false, reason: 'resolve-threw' };
  }
}
