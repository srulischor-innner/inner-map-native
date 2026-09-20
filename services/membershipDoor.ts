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
// THE ANSWER IS SCOPED TO ONE RUN OF ONBOARDING, NOT TO THE PROCESS. It used to
// be the process: primeDoor() returned early if _inFlight was set, and nothing
// ever cleared it. The declared justification was that "there is no sign-in
// affordance anywhere inside app/onboarding.tsx", which is true and is also not
// the question — the identity can change with onboarding UNMOUNTED and the flow
// then re-entered in the same process. app/settings.tsx's SIGN OUT does exactly
// that: clearUserId() + resetOnboarding() + replace('/sign-in'), and the next
// person to finish onboarding on that device got the previous person's verdict.
// So: primeDoor() always starts a FRESH resolve, and doorForExit() drops the
// answer once it has used it. The window a cached answer lives in is now the
// window it was always meant for — this screen's mount to this screen's exit.
//
// ONE THING THIS FILE STILL DOES THAT IS FAIL-OPEN AND IS DECLARED RATHER THAN
// GUARDED, because guarding it would cost more than it buys:
//
//   THE DEVICE FLAG IS WRITTEN ON THE DECISION, NOT ON THE SCREEN BEING SEEN.
//      If the navigation below failed after the flag landed, that device would
//      never be offered the door again. That is the fail-open direction — they
//      get the app instead of a paywall — and it is one screen, once, on a
//      surface that refuses nothing. Writing it on the paywall's own mount would
//      move the write onto a screen a person can kill mid-render, which trades
//      a rare missed courtesy for a repeatable one.

import { MEMBERSHIP_DOOR_ENABLED } from '../constants/features';
import { api } from './api';
import { getMembershipOffering, hasActiveEntitlement, storeConfigurable } from './purchases';
import {
  hasMembershipDoorBeenShown, markMembershipDoorShown, hasCompletedIntakeBefore,
} from './onboarding';
import {
  resolveDoor, doorRouteFor, awaitWithin,
  DOOR_READ_CAP_MS, DOOR_PATIENCE_MS, DOOR_NOT_READY,
  type DoorOutcome,
} from './membershipDecision';

let _inFlight: Promise<DoorOutcome> | null = null;

function startResolve(): Promise<DoorOutcome> {
  return resolveDoor({
    enabled: MEMBERSHIP_DOOR_ENABLED,
    capMs: DOOR_READ_CAP_MS,
    hasShown: hasMembershipDoorBeenShown,
    // Rule 1b. Read HERE, on the mount, because both terminal exits call
    // markIntakeComplete() before they call doorForExit() — an exit-time read
    // would be true for a first-time user too and would shut the door on
    // everybody.
    hasOnboardedBefore: hasCompletedIntakeBefore,
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

/** Starts a FRESH resolve. Called once, from app/onboarding.tsx's mount effect,
 *  when the age read has come back NOT BLOCKED — so it runs once per run of
 *  onboarding, which is the scope the answer is valid over. */
export function primeDoor(): void {
  _inFlight = startResolve();
}

// ===========================================================================
// DOOR MODE IS NOT A URL CLAIM
// ===========================================================================
// app/paywall.tsx read door=1 straight off useLocalSearchParams, so
// innermap://paywall?door=1 put any user — a subscriber of two years — into the
// one-time end-of-onboarding screen, where "Not now" REPLACES the stack instead
// of popping and takes their place in the app with it. The destination was
// already allow-listed (normalizeDoorThen); the MODE was not guarded at all.
//
// The guard is in memory on purpose. A URL cannot set it, only the return of a
// real decision below can, and a cold start from a link begins with it false.
// The paywall reads it on mount and drops it on unmount, so it covers exactly
// one transit: this file's replace() to the paywall, and the person's exit.
let _doorArmed = false;
export function isDoorModeArmed(): boolean { return _doorArmed; }
export function disarmDoorMode(): void { _doorArmed = false; }

export async function doorForExit(dest: string): Promise<string> {
  // The safety net for an exit reached without a prime (a phase pushed straight
  // to a terminal screen, a future flow change). It costs the full patience wait
  // rather than being free, and that is the whole difference between priming and
  // not. It does NOT re-prime over a live one — that would throw away the head
  // start this screen's mount bought.
  if (!_inFlight) _inFlight = startResolve();
  const outcome = await awaitWithin(_inFlight, DOOR_PATIENCE_MS, DOOR_NOT_READY);
  // USED, SO DROPPED. Onboarding runs to exactly one of its two terminal exits,
  // so the answer has no reader after this line — and leaving it behind is what
  // let one person's verdict outlive their session on a shared device.
  _inFlight = null;
  console.log(`[door] ${outcome.show ? 'OPEN' : 'shut'} (${outcome.reason}) dest=${dest}`);
  // NOT AWAITED, ON PURPOSE. The flag is idempotence, not a legal gate:
  // onboarding runs once, so a lost write costs nothing — while an AsyncStorage
  // stall sitting between a person and the app they have just finished setting
  // up costs everything. setBool already swallows its own throw.
  if (outcome.show) markMembershipDoorShown().catch(() => {});
  // Armed only on the branch that actually navigates to the door.
  if (outcome.show) _doorArmed = true;
  return doorRouteFor(outcome, dest);
}
