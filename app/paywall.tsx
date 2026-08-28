// Paywall — Inner Map Membership.
//
// Reached via router.push('/paywall'). A full screen (not a sheet): the App
// Review guidelines want the billing terms readable in one place without a
// gesture, and a dismissible sheet makes the disclosure block easy to miss.
//
// THREE THINGS ON THIS SCREEN ARE COMPLIANCE SURFACE, not design choices:
//
//   1. PRICE PROMINENCE (3.1.2(a)). The billing amount is the largest,
//      highest-contrast pricing element on the screen — 44pt serif in cream.
//      The trial line is deliberately subordinate (13pt sans). Inverting that
//      hierarchy — making "Free for the first week" the headline and the price
//      a footnote — is a documented rejection cause. If anyone ever asks to
//      "lead with the free week," the answer is no.
//
//   2. THE PRICE STRING COMES FROM STOREKIT. `pkg.product.priceString` is the
//      store-localized, store-authoritative amount for the user's actual
//      storefront. It is NEVER hardcoded here: a hardcoded "$24.99" renders
//      the wrong currency and the wrong number for every non-US storefront,
//      which is both a rejection cause and a consumer-law problem. While the
//      offering is loading we render a neutral em-dash rather than guessing —
//      a wrong currency on screen for 400ms is still a wrong currency.
//
//   3. RESTORE + TERMS + PRIVACY LIVE ON THIS SCREEN. Restore is required by
//      the HIG on any screen that sells a subscription (having it in Settings
//      is not sufficient); the two legal links are required by Schedule 2
//      §3.8(b). All three route through existing shared helpers.
//
//   4. THE FREE TRIAL IS CONDITIONAL AND MUST BE PROVEN BEFORE IT IS CLAIMED.
//      An introductory offer existing on the product is NOT the same as this
//      Apple ID still being allowed to use it. A lapsed subscriber, or anyone
//      who already consumed the intro offer anywhere in the "Inner Map
//      Membership" subscription group, is ineligible — StoreKit charges them
//      the full price immediately. Rendering "Start free week" to that user is
//      a 3.1.2(a) misrepresentation and a real user-harm case. So the trial
//      line, the trial half of the disclosure, and the CTA label are all
//      derived from resolveTrialOffer() below, and every ambiguous answer
//      (UNKNOWN eligibility, unparseable period, a thrown check) resolves to
//      the NO-TRIAL copy. Under-claiming a trial is a pleasant surprise;
//      over-claiming one is a refund request and a rejection.
//
//      AUTO-RENEWAL is disclosed explicitly ("Renews monthly until
//      cancelled."). "/ month" alone does not say the subscription recurs,
//      and 3.1.2 wants renewal stated in the binary, not only in the Terms.
//
// COPY RULE — NO VOLUME CLAIMS. The capability list names what the membership
// lets you DO. It must never say "unlimited", never state a message/session
// count, and never show a remaining balance. The server enforces a spend cap;
// any volume language on this screen is a live 3.1.2 exposure. Add capabilities
// here freely — never quantities.
//
//   5. AN ACTIVE MEMBER IS NEVER OFFERED THE THING THEY ALREADY HOLD.
//      Settings routes an entitled user to subscription management instead of
//      here, so in the normal flow this screen is unreachable while subscribed.
//      This guard is for every OTHER route in: a deep link, back navigation, a
//      stale render behind a completed purchase. StoreKit does catch it with
//      its own "you're already subscribed" sheet, so this is not a rejection
//      cause — but presenting a live Subscribe CTA to a paying member is a bad
//      seam and the kind of thing that reads as a double charge.
//
//      The authority is the SERVER (/api/billing/status → entitlementActive),
//      the same source the Settings row already trusts — not the client-side
//      RevenueCat read. The check NEVER GATES THE SCREEN: `alreadyMember`
//      starts false, the paywall paints immediately, and only a definite yes
//      from a successful read ever flips it. Unknown, failed, slow, or a state
//      this build doesn't recognise all leave the normal paywall up — a
//      subscriber then meets StoreKit's own guard, which is the safe
//      direction. Fail-closed here would be far worse: a status outage would
//      lock every non-subscriber out of buying.
//
//      RESTORE AND THE LEGAL LINKS SURVIVE THIS STATE. They live outside the
//      branch entirely. Restore especially: an existing subscriber landing on
//      this screen from a NEW DEVICE is exactly the restore case, and the HIG
//      requires Restore to be reachable wherever the subscription is sold.
//
// FAILURE POSTURE. services/purchases.ts never throws, so every path here is a
// value check, not a try/catch. getMembershipOffering() returns null in three
// real situations we must survive without looking broken: local StoreKit
// testing with no configuration file enabled, production before the Paid Apps
// Agreement is active, and any store outage. All three land on the same quiet
// "isn't available right now" state — with Restore still reachable, because a
// user who ALREADY paid needs it most exactly when the catalog won't load.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { PurchasesPackage } from 'react-native-purchases';

import { colors, fonts, radii, spacing } from '../constants/theme';
import { api } from '../services/api';
import {
  getMembershipOffering, purchase as purchaseItem, restore as restorePurchases,
} from '../services/purchases';
import {
  PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, openLegalDoc,
} from '../utils/legalDocs';

// Capabilities, not quantities. See the COPY RULE note above before editing.
const CAPABILITIES = [
  'Mapping conversations that build your parts map',
  "Healing work with the parts you've mapped",
  'Map Voice — speak to Self, and lead from your own ground',
  'Journal, Guide, and your full history',
];

// Neutral stand-in shown until StoreKit answers. Deliberately not a number and
// not a currency symbol — see note 2 in the header.
const PRICE_PLACEHOLDER = '—';

/** Everything the trial-eligible copy needs, all of it derived from the offer
 *  the store actually returned. `period` is the duration as it appears inside
 *  the founder-locked disclosure sentence ("7 days free, then …"). */
type TrialCopy = {
  /** e.g. "7 days" — the duration token in the disclosure sentence. */
  period: string;
  /** e.g. "Free for the first week" — the amber line above the disclosure. */
  headline: string;
  /** e.g. "Start free week" — CTA label and accessibility label. */
  cta: string;
};

/** Turns an introductory offer's period into copy.
 *
 *  Apple reports a one-week trial as either WEEK/1 or DAY/7 depending on how
 *  the offer was configured in App Store Connect, so WEEK is normalised to
 *  days and both shapes land on the same sentence. An unrecognised unit or a
 *  non-positive count returns null: we would rather show no trial claim than
 *  a duration we cannot state accurately. */
function describeTrial(periodUnit: string, numberOfUnits: number): TrialCopy | null {
  let unit = String(periodUnit || '').toUpperCase();
  let n = Math.round(Number(numberOfUnits));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'WEEK') { n *= 7; unit = 'DAY'; }

  const noun = unit === 'DAY' ? 'day' : unit === 'MONTH' ? 'month' : unit === 'YEAR' ? 'year' : '';
  if (!noun) return null;

  const period = `${n} ${noun}${n === 1 ? '' : 's'}`;

  // The shipped offer: seven days. Character-for-character the founder copy.
  if (unit === 'DAY' && n === 7) {
    return { period, headline: 'Free for the first week', cta: 'Start free week' };
  }
  if (n === 1 && (unit === 'MONTH' || unit === 'YEAR')) {
    return { period, headline: `Free for the first ${noun}`, cta: `Start free ${noun}` };
  }
  return { period, headline: `Free for the first ${period}`, cta: 'Start free trial' };
}

/** How long the eligibility round trip gets before we stop waiting on it.
 *  This is a fast call when StoreKit is healthy; anything past this is a stall,
 *  and a stall must not strand the screen — see the TIMEOUT note below. */
const ELIGIBILITY_TIMEOUT_MS = 4000;

/** Race marker. A unique symbol so it can never collide with an eligibility
 *  status value. */
const ELIGIBILITY_TIMED_OUT = Symbol('eligibility-timed-out');

/** Resolves whether THIS user may actually start a free trial on this package,
 *  and what to call it. Returns null whenever the answer is anything other
 *  than a definite yes.
 *
 *  ARCHITECTURE NOTE: services/purchases.ts is meant to be the only module
 *  that touches react-native-purchases. Eligibility has no wrapper there yet
 *  and this task is scoped to this file, so the call is made here — through a
 *  dynamic import and a try/catch, mirroring the wrapper's own posture so a
 *  native-module registration failure cannot take the screen down. Lift this
 *  into services/purchases.ts as getTrialEligibility() when that file is next
 *  open. */
async function resolveTrialOffer(pkg: PurchasesPackage): Promise<TrialCopy | null> {
  const productId = pkg?.product?.identifier;
  const intro = pkg?.product?.introPrice;
  if (!productId || !intro) return null;

  // A non-zero introductory price is still an introductory offer, but it is a
  // DISCOUNT, not a free trial. Calling it "free" is the same misstatement
  // arriving from the other direction.
  if (Number(intro.price) !== 0) return null;

  const copy = describeTrial(intro.periodUnit, intro.periodNumberOfUnits);
  if (!copy) return null;

  // TIMEOUT. checkTrialOrIntroductoryPriceEligibility is a StoreKit round trip
  // with no abort of its own, and a hang there is not a throw — the try/catch
  // below would never fire. An unbounded await leaves the caller stuck in
  // `loading` forever: a real price on screen, NO disclosure block at all, and
  // an inert CTA. So the check (dynamic import included, since that can stall
  // too) races a timer, and a timeout resolves to the NO-TRIAL copy — already
  // the correct conservative default, and the same branch an ineligible user
  // gets. Under-claiming is a pleasant surprise; over-claiming is a rejection.
  //
  // The race also settles this function exactly once, so an eligibility answer
  // that lands AFTER the timeout is discarded rather than flipping the copy
  // back under a user who is already reading the no-trial disclosure.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const check = (async () => {
      const sdk = await import('react-native-purchases');
      const map = await sdk.default.checkTrialOrIntroductoryPriceEligibility([productId]);
      return map?.[productId]?.status === sdk.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
    })();

    const timeout = new Promise<typeof ELIGIBILITY_TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(ELIGIBILITY_TIMED_OUT), ELIGIBILITY_TIMEOUT_MS);
    });

    const eligible = await Promise.race([check, timeout]);
    if (eligible === ELIGIBILITY_TIMED_OUT) {
      console.warn('[paywall] intro eligibility check timed out; showing no-trial copy');
      return null;
    }
    // ELIGIBLE and nothing else. INELIGIBLE and NO_INTRO_OFFER_EXISTS are
    // clear noes; UNKNOWN (missing subscription-group info, and every Android
    // call) is RevenueCat's own "show the non-intro pricing" case.
    return eligible ? copy : null;
  } catch (e) {
    console.warn('[paywall] intro eligibility check failed:', (e as Error)?.message);
    return null;
  } finally {
    // Cleared on every exit, so a pending timer cannot fire late. It could not
    // stomp state either way (the race is already settled), but a stray 4s
    // timer holding the closure alive after unmount is avoidable noise.
    if (timer !== undefined) clearTimeout(timer);
  }
}

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pkg, setPkg] = useState<PurchasesPackage | null>(null);
  // null = no trial to claim (ineligible, no offer, or not yet proven).
  const [trialOffer, setTrialOffer] = useState<TrialCopy | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // Server-confirmed membership. ONE-WAY and pessimistic: false until
  // /api/billing/status affirmatively says entitlementActive. Every other
  // answer — a failed read, an unknown state, a read still in flight — leaves
  // this false and the normal paywall up. See note 5 in the header.
  const [alreadyMember, setAlreadyMember] = useState(false);

  // Guards every post-await setState. The user can close this screen mid-flight
  // (the store sheet is modal but restore is not), and a state write after
  // unmount is a warning we don't need in a payments path.
  // Re-armed on mount (not just cleared on unmount) so a remount — Fast
  // Refresh, or a future StrictMode double-invoke — can't leave it latched
  // false and silently swallow every later setState. Latched false here is the
  // worst case in the app: both guards below bail, `status` never leaves
  // 'loading', and the CTA is a permanently spinning disabled button with no
  // price and no disclosure.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    (async () => {
      const found = await getMembershipOffering();
      if (!alive.current) return;
      if (!found) {
        setStatus('unavailable');
        return;
      }
      // The price can paint as soon as the offering lands. `ready` waits for
      // the eligibility answer as well, because the disclosure block is
      // unstatable until we know whether a trial applies — see note 4.
      setPkg(found);
      const offer = await resolveTrialOffer(found);
      if (!alive.current) return;
      setTrialOffer(offer);
      setStatus('ready');
    })();
  }, []);

  // Entitlement read. Deliberately a SEPARATE effect from the offering load,
  // with no shared state and no ordering between them: the price/trial path
  // must not wait on billing, and billing must not wait on the store. Neither
  // can strand the other, and `status` is never touched here — a hung or
  // failed billing read cannot leave this screen loading.
  //
  // getBillingStatus() never throws (null on any failure) and carries its own
  // timeout, so there is nothing to catch and nothing to race.
  useEffect(() => {
    (async () => {
      const billing = await api.getBillingStatus();
      if (!alive.current) return;
      // Only a definite yes. `null` (read failed) and every non-entitled state
      // land on false, which is the normal paywall.
      if (billing?.entitlementActive) setAlreadyMember(true);
    })();
  }, []);

  const close = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    router.back();
  }, [router]);

  const onPurchase = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    // `alreadyMember` also removes the CTA from the tree, so this is the
    // belt-and-braces case: a tap already in flight when the entitlement
    // answer lands must not open a store sheet for a subscription the user
    // holds.
    if (!pkg || purchasing || alreadyMember) return;
    setPurchasing(true);
    const res = await purchaseItem(pkg);
    if (!alive.current) return;
    setPurchasing(false);
    if (res.ok) {
      router.back();
      return;
    }
    // A cancellation is not a failure. The user closed the store sheet on
    // purpose; an alert here would be scolding them for it.
    if (res.cancelled) return;
    Alert.alert('Purchase not completed', res.message || 'The purchase could not be completed.');
  }, [pkg, purchasing, router]);

  const onRestore = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    if (restoring) return;
    setRestoring(true);
    const res = await restorePurchases();
    if (!alive.current) return;
    // Cleared before any alert — the button must never be left spinning behind
    // a dialog the user then dismisses.
    setRestoring(false);
    if (res.ok && res.hasEntitlement) {
      Alert.alert(
        'Membership restored',
        'Your Inner Map membership is active on this device.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
      return;
    }
    if (res.ok) {
      Alert.alert(
        'Nothing to restore',
        // "Apple Account" — Apple's current name for what used to be the
        // Apple ID, and the same wording Settings' Restore row already uses.
        // The second sentence matters: the single most common cause of an
        // empty restore is being signed into a different Apple Account than
        // the one that paid, and without it this dead-ends.
        'We didn’t find a membership on this Apple Account. If you subscribed with a different Apple Account, sign in to that one and try again.',
      );
      return;
    }
    Alert.alert('Restore not completed', res.message || 'Restore could not be completed.');
  }, [restoring, router]);

  const openDoc = useCallback((url: string) => {
    Haptics.selectionAsync().catch(() => {});
    openLegalDoc(url);
  }, []);

  // Store-authoritative, storefront-localized. Never a literal.
  const priceString = pkg?.product?.priceString || PRICE_PLACEHOLDER;

  // Falls to "Subscribe" for every non-trial state, including while loading.
  const ctaLabel = trialOffer ? trialOffer.cta : 'Subscribe';

  // The CTA must never render as a live button while it is inert. Before the
  // store answers, the label already falls through to "Subscribe" — so without
  // these two flags the biggest control on the screen looks exactly as it will
  // when it works and does nothing when tapped, which reads as a broken
  // purchase button on a review device. Label text is untouched; the spinner
  // and the dimming carry the state.
  const ctaBusy = purchasing || status === 'loading';
  const ctaDisabled = purchasing || status !== 'ready';

  // The member state replaces the price + disclosure + CTA block. Gated on
  // !purchasing so an entitlement answer arriving mid-purchase cannot swap the
  // screen out from under an open store sheet: if that purchase succeeds we
  // router.back() anyway, and if the user cancels it, this renders on return.
  const showMemberState = alreadyMember && !purchasing;

  // SafeAreaView edges: TOP ONLY. The bottom inset is carried by the ScrollView
  // content below. Listing 'bottom' here too would apply it a second time at
  // the root and leave a home-indicator-sized dead band under the legal links —
  // and push Terms/Privacy off-reach on short screens. journey/journal/guide all
  // let content carry the inset; this screen now matches them.
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={close}
          hitSlop={10}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={22} color={colors.creamFaint} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: spacing.xl + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Inner Map Membership</Text>

        <View style={styles.capabilities}>
          {CAPABILITIES.map((line) => (
            <View key={line} style={styles.capabilityRow}>
              <Text style={styles.bullet}>◆</Text>
              <Text style={styles.capabilityText}>{line}</Text>
            </View>
          ))}
        </View>

        {showMemberState ? (
          // ALREADY A MEMBER. No price, no disclosure, no CTA — the price
          // block and the trial/renewal sentences describe a purchase this
          // user is not making, and the largest control on screen must not
          // offer them a second copy of what they hold. Restore and the legal
          // links below are outside this branch and stay live. Management is
          // named rather than deep-linked: Settings owns that link, and a
          // second entry point to Apple would be a second thing to keep true.
          <View style={styles.memberBlock}>
            <Text style={styles.memberTitle}>You’re already a member.</Text>
            {/* No "on this Apple Account" — the entitlement we just read is
                the SERVER's, tied to the Inner Map account, and the user may
                well be signed into a different Apple Account than the one that
                paid. That is precisely why Restore below still matters. */}
            <Text style={styles.memberBody}>
              Your Inner Map membership is active. To change or cancel it, go to
              Settings › Your Plan › Manage subscription.
            </Text>
          </View>
        ) : status === 'unavailable' ? (
          // Quiet, non-alarming, and not a dead end: Restore and the legal
          // links below stay live.
          <Text style={styles.unavailable}>Membership isn’t available right now.</Text>
        ) : (
          <>
            {/* PRICE BLOCK — the most prominent pricing element on screen.
                Do not shrink this relative to the trial line. */}
            <View style={styles.priceRow}>
              <Text style={styles.price}>{priceString}</Text>
              <Text style={styles.pricePeriod}>/ month</Text>
            </View>

            {/* The whole disclosure block is gated on `ready`. Until the store
                has answered on BOTH price and trial eligibility there is no
                honest sentence to write — a half-known disclosure is worse
                than a beat of nothing. */}
            {status === 'ready' ? (
              <>
                {trialOffer ? (
                  <Text style={styles.trial}>{trialOffer.headline}</Text>
                ) : null}

                {/* Founder-locked disclosure. Character-exact; the only
                    substitutions are the store-localized price and the
                    store-declared trial duration. */}
                {trialOffer ? (
                  <Text style={styles.disclosure}>{trialOffer.period} free, then {priceString}/month.</Text>
                ) : (
                  <Text style={styles.disclosure}>{priceString}/month.</Text>
                )}
                <Text style={styles.disclosure}>Renews monthly until cancelled.</Text>
                {trialOffer ? (
                  <Text style={styles.disclosure}>
                    Cancel anytime in Settings at least 24 hours before the trial ends.
                  </Text>
                ) : (
                  <Text style={styles.disclosure}>Cancel anytime in Settings.</Text>
                )}
              </>
            ) : null}

            <Pressable
              onPress={onPurchase}
              disabled={ctaDisabled}
              style={[styles.cta, ctaDisabled ? styles.ctaDisabled : null]}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              accessibilityState={{ disabled: ctaDisabled, busy: ctaBusy }}
            >
              {ctaBusy ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text style={styles.ctaText}>{ctaLabel}</Text>
              )}
            </Pressable>
          </>
        )}

        {/* Restore lives OUTSIDE the status branch on purpose: it is the one
            control that must survive the unavailable state, because a user
            who already paid needs it most exactly when the catalog won't
            load. */}
        <Pressable
          onPress={onRestore}
          disabled={restoring}
          style={styles.restoreBtn}
          accessibilityRole="button"
          accessibilityLabel="Restore purchases"
          accessibilityState={{ disabled: restoring, busy: restoring }}
        >
          {restoring ? (
            <ActivityIndicator size="small" color={colors.creamDim} />
          ) : (
            <Text style={styles.restoreText}>Restore purchases</Text>
          )}
        </Pressable>

        <View style={styles.legalRow}>
          <Pressable onPress={() => openDoc(TERMS_OF_SERVICE_URL)} hitSlop={8}>
            <Text style={styles.legalLink}>Terms of Use</Text>
          </Pressable>
          <Text style={styles.legalDot}> · </Text>
          <Pressable onPress={() => openDoc(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

  title: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 30,
    letterSpacing: 0.3,
  },

  capabilities: { marginTop: spacing.lg },
  capabilityRow: { flexDirection: 'row', marginBottom: spacing.sm },
  bullet: {
    color: colors.amber,
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 22,
    marginRight: spacing.sm,
  },
  capabilityText: {
    flex: 1,
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
  },

  // --- Price block ---------------------------------------------------------
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.xl,
  },
  price: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 44,
    letterSpacing: 0.3,
  },
  pricePeriod: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  // Subordinate to the price by design — see note 1 in the header.
  trial: {
    color: colors.amber,
    fontFamily: fonts.sans,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  disclosure: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 19,
    marginTop: spacing.sm,
  },

  // --- Actions -------------------------------------------------------------
  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amber,
    borderRadius: radii.pill,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    minHeight: 52,
  },
  // A disabled CTA must be visibly distinct from a live one. Dimmed rather
  // than recoloured, so the amber still reads as the primary action once the
  // store answers and this style drops away.
  ctaDisabled: { opacity: 0.45 },
  ctaText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 15,
  },
  restoreBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    minHeight: 44,
  },
  restoreText: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
  },

  // --- Already-a-member state ----------------------------------------------
  memberBlock: { marginTop: spacing.xl },
  memberTitle: {
    color: colors.cream,
    fontFamily: fonts.serifBold,
    fontSize: 20,
    letterSpacing: 0.2,
  },
  memberBody: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
  },

  unavailable: {
    color: colors.creamDim,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.xl,
  },

  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  legalLink: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  legalDot: {
    color: colors.creamFaint,
    fontFamily: fonts.sans,
    fontSize: 12,
  },
});
