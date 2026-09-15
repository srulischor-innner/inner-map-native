// THE MEMBERSHIP DOOR — THE WIRING, AND NOTHING ELSE.
//
// The decision and the composition live in services/membershipDecision.ts,
// which has no imports so the smoke can load it and RUN it. This file is the
// twenty lines that hand that composition the real world. Logic added here is
// logic nothing executes; put it next door.
//
// TWO ENTRY POINTS, AND THEY ARE THE WHOLE PUBLIC SURFACE:
//
//   primeDoor()        Fire-and-forget. Called ONCE, from app/onboarding.tsx,
//                      when the age read has come back NOT BLOCKED. Starts the
//                      reads so the answer is sitting there by the time the
//                      person finishes. Nothing on that screen waits for it.
//
//   doorForExit(dest)  Called by each of onboarding's two terminal exits and
//                      AWAITED before they navigate. Returns the route to
//                      replace to: `dest` if the door stays shut, or the paywall
//                      in door mode carrying `dest` if it opens.
//
// WHY AWAITED, AND WHY THAT IS THE WHOLE FIX. The previous design armed a device
// flag and fired a prefetch in the same tick; the prefetch read the flag before
// the write landed, so the verdict was always 'unknown' and the paywall first
// appeared on the SECOND cold launch. There is no flag to arm here. The exit
// awaits an ANSWER, and the ordering is a single await on the line above the
// navigation, which the smoke pins with orderedIn over a brace-matched slice of
// each exit.
//
// THE DOOR HAS EXACTLY TWO CALL SITES AND THEY ARE BOTH IN ONBOARDING. That is
// what keeps it off the boot path and out of the tabs, and it is what makes a
// lapsed subscriber structurally unable to meet it: onboarding is unreachable
// once intakeComplete is set. The smoke asserts the census over comment-stripped
// source across app/, services/, components/, utils/ and constants/.
//
// TWO THINGS THIS FILE DOES THAT ARE FAIL-OPEN AND ARE DECLARED RATHER THAN
// GUARDED, because guarding either would cost more than it buys:
//
//   1. THE ANSWER IS COMPUTED ONCE PER PROCESS and is bound to whatever identity
//      exists when onboarding MOUNTS. That is correct today because there is no
//      sign-in affordance anywhere inside app/onboarding.tsx — the smoke asserts
//      that, so the day somebody adds one this note stops being true out loud
//      rather than quietly. If a sign-in ever lands mid-flow, clear _inFlight on
//      the identity change; a stale answer would be one wrongly-shut door, never
//      a wrongly-open one, because the store read is the only source that can
//      say yes and a shut door lets the person straight in.
//
//   2. THE DEVICE FLAG IS WRITTEN ON THE DECISION, NOT ON THE SCREEN BEING SEEN.
//      If the navigation below failed after the flag landed, that device would
//      never be offered the door again. That is the fail-open direction — they
//      get the app instead of a paywall — and it is one screen, once, on a
//      surface that refuses nothing. Writing it on the paywall's own mount would
//      move the write onto a screen a person can kill mid-render, which trades
//      a rare missed courtesy for a repeatable one.

import { MEMBERSHIP_DOOR_ENABLED } from '../constants/features';
import { api } from './api';
import { getMembershipOffering, hasActiveEntitlement, storeConfigurable } from './purchases';
import { hasMembershipDoorBeenShown, markMembershipDoorShown } from './onboarding';
import {
  resolveDoor, doorRouteFor, awaitWithin,
  DOOR_READ_CAP_MS, DOOR_PATIENCE_MS, DOOR_NOT_READY,
  type DoorOutcome,
} from './membershipDecision';

let _inFlight: Promise<DoorOutcome> | null = null;

export function primeDoor(): void {
  if (_inFlight) return;
  _inFlight = resolveDoor({
    enabled: MEMBERSHIP_DOOR_ENABLED,
    capMs: DOOR_READ_CAP_MS,
    hasShown: hasMembershipDoorBeenShown,
    storeConfigurable,
    offeringAvailable: async () => !!(await getMembershipOffering()),
    getBilling: async () => {
      const b = await api.getBillingStatus();
      // getBillingStatus returns null on ANY failure and never throws, so null
      // here means "unknown" and decideDoor treats it as such.
      return b ? { known: b.entitlementKnown, entitled: b.entitlementActive, state: b.state } : null;
    },
    // Returns null — not false — whenever the store could not answer. Rule 5 of
    // decideDoor is what turns that into a shut door rather than into a paywall
    // in front of somebody who has already paid.
    storeEntitled: hasActiveEntitlement,
  });
}

export async function doorForExit(dest: string): Promise<string> {
  // Idempotent — this is the safety net for an exit reached without a prime
  // (a phase pushed straight to a terminal screen, a future flow change). It
  // costs the full patience wait rather than being free, and that is the whole
  // difference between priming and not.
  primeDoor();
  const outcome = await awaitWithin(_inFlight, DOOR_PATIENCE_MS, DOOR_NOT_READY);
  console.log(`[door] ${outcome.show ? 'OPEN' : 'shut'} (${outcome.reason}) dest=${dest}`);
  // NOT AWAITED, ON PURPOSE. The flag is idempotence, not a legal gate:
  // onboarding runs once, so a lost write costs nothing — while an AsyncStorage
  // stall sitting between a person and the app they have just finished setting
  // up costs everything. setBool already swallows its own throw.
  if (outcome.show) markMembershipDoorShown().catch(() => {});
  return doorRouteFor(outcome, dest);
}
