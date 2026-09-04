// RevenueCat wrapper — the ONLY place the app touches react-native-purchases.
//
// Contract for every caller: nothing in this module throws. Ever. A store
// outage, a missing native module, an unconfigured SDK, a user who taps
// Cancel — all of it resolves to a value, never a rejection. Purchases are
// adjacent to a mental-health surface; a StoreKit hiccup must not take the
// app down with it.
//
// PLATFORM: iOS only for now. There is no Android RevenueCat key yet, so
// configurePurchases() no-ops on Android instead of configuring with a key
// that doesn't exist. Every other function then no-ops too (they all check
// `configured` first), which is exactly the behavior we want: on Android the
// billing UI simply never reports an entitlement.
//
// The SDK is loaded LAZILY via dynamic import rather than a top-level import.
// If the native module ever fails to register (the react-native-purchases
// #1747/#1739 class of bug), a top-level import takes the whole bundle with
// it at module-eval time. A lazy import turns that same failure into a warn
// and a null.
//
// KEY HANDLING: the iOS key is read from app.config.js extra as
// extra.revenueCatApiKeyIos, matching the Sentry DSN read idiom in
// app/_layout.tsx. Its VALUE is never logged — not at any log level, not in
// an error path. We log presence (`true`/`false`) only.

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type {
  CustomerInfo,
  PurchasesPackage,
  PurchasesStoreProduct,
} from 'react-native-purchases';

// peekUserId, never getUserId — see ensureIdentified() below. services/user.ts
// imports nothing from here, so this edge introduces no cycle.
import { peekUserId } from './user';

// The full module namespace, typed without importing it at runtime. `sdk.default`
// is the Purchases class (all methods are static); the enums (PRODUCT_CATEGORY,
// LOG_LEVEL) come across as real runtime values on the same object.
type PurchasesModule = typeof import('react-native-purchases');

/** Anything this module knows how to put through the store. A membership
 *  arrives as a PurchasesPackage (it lives in an offering); the top-up
 *  arrives as a bare PurchasesStoreProduct (it is deliberately NOT in any
 *  offering and NOT attached to an entitlement — the server credits the
 *  usage pool from its purchase webhook). purchase() accepts either. */
export type Purchasable = PurchasesPackage | PurchasesStoreProduct;

/** Entitlement identifier configured in the RevenueCat dashboard. If this is
 *  ever renamed, hasActiveEntitlement() still resolves correctly: we fall
 *  back to "any active entitlement", since this project has exactly one. */
const ENTITLEMENT_ID = 'Innermap Pro';

/** App Store product id for the usage top-up. NOTE the id is a misnomer that
 *  cannot be fixed (Apple ids are permanent): the `_10` encodes the USAGE
 *  GRANTED, not the price. Never derive display copy from this string —
 *  read the localized price off product.priceString instead. */
const TOPUP_PRODUCT_ID = 'innermap_topup_10';

let _sdk: PurchasesModule | null = null;
let _sdkLoadFailed = false;
let _configured = false;
let _configureInFlight: Promise<void> | null = null;
/** Latched when configure can NEVER succeed in this process: wrong platform,
 *  or no key in app.config extra. Both are static for the process lifetime,
 *  and readySdk() now retries configure on every call — without this latch
 *  those two paths would re-run (and re-warn) on every single store call on
 *  Android. A transient failure (SDK import, native throw) deliberately does
 *  NOT latch, so it stays retryable. */
let _configureImpossible = false;
/** The user id currently bound by logIn(). Lets identifyUser() skip a
 *  redundant round trip, and lets ensureIdentified() notice an identity that
 *  CHANGED mid-process (setUserId during sign-in / account recovery) and
 *  re-bind before money moves. */
let _identifiedUserId: string | null = null;

/** Lazy, cached, non-throwing module load. */
async function loadSdk(): Promise<PurchasesModule | null> {
  if (_sdk) return _sdk;
  if (_sdkLoadFailed) return null;
  try {
    _sdk = await import('react-native-purchases');
    return _sdk;
  } catch (e) {
    _sdkLoadFailed = true;
    console.warn('[purchases] SDK import failed:', (e as Error)?.message);
    return null;
  }
}

/** Resolves the SDK ONLY when configure() has actually run. Every public
 *  function funnels through this so an unconfigured SDK is a quiet no-op
 *  rather than a rejected promise ("The promise will be rejected if
 *  configure has not been called yet" — v10 docs, on nearly every method).
 *
 *  SELF-CONFIGURING. `!_configured` used to be a hard bail, which quietly made
 *  every public function a coin flip on boot ordering. configure() is kicked
 *  off by an effect in app/_layout.tsx and takes a dynamic import plus two
 *  native round trips to settle; anything that asked before then got null.
 *  On the paywall that is not a soft failure — a null offering renders the
 *  permanent "Membership isn't available right now" state with no retry, so a
 *  user who opened Settings → Membership quickly saw a dead paywall while the
 *  store was perfectly healthy, and had to relaunch the app to clear it.
 *  Restore had the same shape ("Purchases are unavailable right now") at the
 *  exact moment an already-paying user needs it.
 *
 *  configurePurchases() is idempotent and coalescing, so awaiting it here
 *  either returns instantly (already configured) or joins the in-flight one.
 *  The platform guard and the missing-key guard still leave `_configured`
 *  false, so those two cases keep no-opping exactly as before. */
async function readySdk(): Promise<PurchasesModule | null> {
  if (!_configured) await configurePurchases();
  if (!_configured) return null;
  return loadSdk();
}

/** Configure the RevenueCat SDK. Safe to call more than once — the second
 *  call returns immediately. Never throws: a failure here leaves the app in
 *  the "no entitlement" state, which is the correct fail-closed default. */
export async function configurePurchases(): Promise<void> {
  if (_configured) return;
  if (_configureImpossible) return;
  if (_configureInFlight) return _configureInFlight;

  const run = (async () => {
    try {
      // PLATFORM GUARD, now per-platform. Android was refused outright
      // because there was no key for it; there is a slot for one now, and the
      // guard moved from "which platform is this" to "is there a key".
      //
      // The reason the old guard existed still holds and is why the key check
      // below is unchanged: configuring with an empty or placeholder key mints
      // a bogus anonymous id against a project that cannot serve it, which is
      // worse than not configuring. So an Android build with no key pasted
      // behaves exactly as Android did before this change.
      const extra = (Constants.expoConfig?.extra as any) || {};
      const keyForPlatform =
        Platform.OS === 'ios' ? (extra.revenueCatApiKeyIos as string)
        : Platform.OS === 'android' ? (extra.revenueCatApiKeyAndroid as string)
        : '';
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
        _configureImpossible = true;
        console.warn(`[purchases] skipping configure — unsupported platform "${Platform.OS}"`);
        return;
      }

      const apiKey = keyForPlatform || '';
      // A key that is present but obviously not a key is treated as absent.
      // RevenueCat keys are prefixed by platform, so this is checkable without
      // ever logging the value.
      const expectedPrefix = Platform.OS === 'ios' ? 'appl_' : 'goog_';
      if (!apiKey || !apiKey.startsWith(expectedPrefix)) {
        _configureImpossible = true;
        // Presence and shape only. The value is never logged.
        console.warn(
          `[purchases] skipping configure — extra.revenueCatApiKey${Platform.OS === 'ios' ? 'Ios' : 'Android'} ` +
          `is ${apiKey ? `not a ${expectedPrefix}… key` : 'empty'}`,
        );
        return;
      }

      const sdk = await loadSdk();
      if (!sdk) return;
      const Purchases = sdk.default;

      // Another code path (or a fast double-mount) may have configured
      // already — the SDK is the source of truth, not our flag.
      const already = await Purchases.isConfigured().catch(() => false);
      if (already) {
        _configured = true;
        console.log('[purchases] already configured — reusing existing instance');
        return;
      }

      // Keep the SDK quiet. INFO level echoes the configuration back, and we
      // do not want the key value anywhere near a log sink.
      await Purchases.setLogLevel(__DEV__ ? sdk.LOG_LEVEL.WARN : sdk.LOG_LEVEL.ERROR)
        .catch(() => { /* log level is cosmetic — never block configure on it */ });

      Purchases.configure({ apiKey });
      _configured = true;
      console.log('[purchases] configured ✓ (ios)');
    } catch (e) {
      // A missing key, a dead native module, a malformed config — none of it
      // may crash boot.
      console.warn('[purchases] configure threw:', (e as Error)?.message);
    }
  })();

  // The slot is released HERE, after the assignment — not in a `finally`
  // inside the body. Two of the body's exits (the platform guard and the
  // empty-key guard) are reached with NO await in between, so they run
  // synchronously during the call above; a `finally` inside would therefore
  // fire BEFORE `_configureInFlight = run` and leave the module pinned to a
  // settled promise that every later call would return instead of retrying.
  // Invisible on iOS with a real key (the first await defers the finally past
  // the assignment) and permanent on every other path.
  _configureInFlight = run;
  const release = () => { if (_configureInFlight === run) _configureInFlight = null; };
  // Two-arg form: the body never rejects, but this bookkeeping chain must not
  // be the thing that surfaces an unhandled rejection if it ever does.
  run.then(release, release);

  return run;
}

/** Bind the RevenueCat app-user-id to our own user id so the purchase
 *  webhook lands on the right server-side account. No-op when the SDK was
 *  never configured or the id is falsy. Never throws. */
export async function identifyUser(userId: string): Promise<void> {
  if (!userId) return;
  // Already bound to this exact id — logIn again would be a wasted native
  // round trip on a path that can sit in front of a purchase.
  if (_identifiedUserId === userId) return;
  const sdk = await readySdk();
  if (!sdk) return;
  try {
    await sdk.default.logIn(userId);
    _identifiedUserId = userId;
    console.log(`[purchases] identified user=${userId.slice(0, 8)}…`);
  } catch (e) {
    console.warn('[purchases] logIn threw:', (e as Error)?.message);
  }
}

/** Last-moment identity binding, run immediately before anything that moves
 *  money. The boot wiring in app/_layout.tsx is the primary binding, but it
 *  can legitimately miss:
 *
 *    • GENUINE FIRST LAUNCH — boot peeks rather than mints (so it can't burn a
 *      UUID ahead of the sign-in migration branch), so on a first-ever launch
 *      there is no id to bind yet and the whole session would otherwise run
 *      under a RevenueCat anonymous id.
 *    • IDENTITY CHANGE MID-PROCESS — setUserId() during sign-in / account
 *      recovery can replace the id after boot already bound the old one.
 *
 *  Either way the purchase webhook would arrive keyed to an app_user_id with
 *  no server-side account behind it, which is precisely the failure the
 *  ungated boot logIn exists to prevent. By the time a user is buying, the id
 *  is on disk (and usually in the module cache), so this is near-free.
 *
 *  Still peekUserId, never getUserId: this must not be the thing that mints.
 *  A null id changes nothing — we proceed exactly as before. Never throws. */
async function ensureIdentified(): Promise<void> {
  try {
    const userId = await peekUserId();
    if (!userId || userId === _identifiedUserId) return;
    console.log('[purchases] binding identity before store call');
    await identifyUser(userId);
  } catch (e) {
    console.warn('[purchases] ensureIdentified threw:', (e as Error)?.message);
  }
}

/** The membership package to present. Prefers the dashboard's current
 *  offering, falls back to the `default` offering by name, then prefers the
 *  monthly package and finally the first available one. Returns null when
 *  the SDK is unconfigured, the fetch fails, or the offering is empty. */
export async function getMembershipOffering(): Promise<PurchasesPackage | null> {
  const sdk = await readySdk();
  if (!sdk) return null;
  try {
    const offerings = await sdk.default.getOfferings();
    const offering = offerings.current ?? offerings.all?.['default'] ?? null;
    if (!offering) {
      console.warn('[purchases] no current offering configured');
      return null;
    }
    const pkg =
      offering.monthly ??
      offering.availablePackages?.find((p) => p.packageType === sdk.PACKAGE_TYPE.MONTHLY) ??
      offering.availablePackages?.[0] ??
      null;
    if (!pkg) console.warn(`[purchases] offering "${offering.identifier}" has no packages`);
    return pkg;
  } catch (e) {
    console.warn('[purchases] getOfferings threw:', (e as Error)?.message);
    return null;
  }
}

/** The usage top-up, as a store product.
 *
 *  Returns PurchasesStoreProduct rather than PurchasesPackage on purpose:
 *  the top-up is a consumable that is deliberately NOT in any offering, so
 *  the offering API can't reach it and getProducts() is the correct v10
 *  call. If it is ever added to an offering we still return the same type
 *  (the package's `.product`), so callers never have to change.
 *
 *  Read display price off the returned product's `priceString` — it is
 *  localized and store-authoritative. */
export async function getTopUpProduct(): Promise<PurchasesStoreProduct | null> {
  const sdk = await readySdk();
  if (!sdk) return null;
  const Purchases = sdk.default;

  // Offering-first, in case the catalog changes under us later.
  try {
    const offerings = await Purchases.getOfferings();
    const all = Object.values(offerings.all || {});
    for (const offering of all) {
      const match = offering.availablePackages?.find(
        (p) => p.product?.identifier === TOPUP_PRODUCT_ID,
      );
      if (match?.product) return match.product;
    }
  } catch {
    // Expected today — the top-up isn't in an offering. Fall through.
  }

  try {
    const products = await Purchases.getProducts(
      [TOPUP_PRODUCT_ID],
      sdk.PRODUCT_CATEGORY.NON_SUBSCRIPTION,
    );
    const product = products?.[0] ?? null;
    if (!product) console.warn(`[purchases] top-up product "${TOPUP_PRODUCT_ID}" not returned by the store`);
    return product;
  } catch (e) {
    console.warn('[purchases] getProducts threw:', (e as Error)?.message);
    return null;
  }
}

function isPackage(item: Purchasable): item is PurchasesPackage {
  return typeof (item as PurchasesPackage).packageType === 'string';
}

/** True when the rejection we caught is the user backing out of the store
 *  sheet. v10 exposes this two ways: `code === PURCHASE_CANCELLED_ERROR`
 *  (the current form) and the deprecated `userCancelled` boolean. We accept
 *  either, because which one arrives depends on the native layer's
 *  serialization and both are still populated in 10.4.x. */
function isUserCancellation(e: unknown, sdk: PurchasesModule): boolean {
  const err = e as { userCancelled?: boolean | null; code?: unknown } | null;
  if (!err) return false;
  if (err.userCancelled === true) return true;
  try {
    const cancelCode = sdk.default.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
    return String(err.code) === String(cancelCode);
  } catch {
    return false;
  }
}

/** Put a package or product through the store.
 *
 *  A user cancellation is NOT an error — it returns
 *  { ok: false, cancelled: true } with no message, so the UI can stay
 *  completely silent. Only genuine failures carry a message. */
export async function purchase(
  item: Purchasable,
): Promise<{ ok: true } | { ok: false; cancelled: boolean; message?: string }> {
  const sdk = await readySdk();
  if (!sdk) {
    return { ok: false, cancelled: false, message: 'Purchases are unavailable right now.' };
  }
  if (!item) {
    return { ok: false, cancelled: false, message: 'Nothing to purchase.' };
  }
  // Bind identity BEFORE the transaction — the app_user_id on the receipt is
  // whatever the SDK holds at purchase time, and it is not revisable after.
  await ensureIdentified();
  try {
    if (isPackage(item)) await sdk.default.purchasePackage(item);
    else await sdk.default.purchaseStoreProduct(item);
    return { ok: true };
  } catch (e) {
    if (isUserCancellation(e, sdk)) {
      // Silent by design. Not logged as a warning — it isn't a fault.
      console.log('[purchases] purchase cancelled by user');
      return { ok: false, cancelled: true };
    }
    const message = (e as Error)?.message || 'The purchase could not be completed.';
    console.warn('[purchases] purchase failed:', message);
    return { ok: false, cancelled: false, message };
  }
}

/** Reads the active entitlements off a CustomerInfo. Prefers the known
 *  entitlement id, falls back to "any active entitlement". */
function customerHasEntitlement(info: CustomerInfo | null | undefined): boolean {
  const active = info?.entitlements?.active;
  if (!active) return false;
  if (active[ENTITLEMENT_ID]) return true;
  return Object.keys(active).length > 0;
}

/** Restore purchases made on another device / after a reinstall.
 *  `ok` is whether the restore CALL succeeded; `hasEntitlement` is whether
 *  it actually turned anything up — the UI needs both, because a successful
 *  restore that finds nothing needs different copy from a failed restore. */
export async function restore(): Promise<{ ok: boolean; hasEntitlement: boolean; message?: string }> {
  const sdk = await readySdk();
  if (!sdk) {
    return { ok: false, hasEntitlement: false, message: 'Purchases are unavailable right now.' };
  }
  // Same reasoning as purchase(): a restore re-attributes the transactions to
  // whichever app_user_id is current, so bind ours first rather than let them
  // land on an anonymous id.
  await ensureIdentified();
  try {
    const info = await sdk.default.restorePurchases();
    const hasEntitlement = customerHasEntitlement(info);
    console.log(`[purchases] restore ✓ hasEntitlement=${hasEntitlement}`);
    return { ok: true, hasEntitlement };
  } catch (e) {
    const message = (e as Error)?.message || 'Restore could not be completed.';
    console.warn('[purchases] restore failed:', message);
    return { ok: false, hasEntitlement: false, message };
  }
}

/** Client-side entitlement read. Convenience only — the SERVER is the
 *  authority on access (see api.getBillingStatus). Returns false whenever
 *  we cannot answer, which is the safe direction. */
export async function hasActiveEntitlement(): Promise<boolean> {
  const sdk = await readySdk();
  if (!sdk) return false;
  try {
    const info = await sdk.default.getCustomerInfo();
    return customerHasEntitlement(info);
  } catch (e) {
    console.warn('[purchases] getCustomerInfo threw:', (e as Error)?.message);
    return false;
  }
}
