// +native-intent.ts — the SINGLE choke point for every incoming deep link.
//
// WHY THIS FILE EXISTS. app.config.js registers `scheme: 'innermap'` with no
// path restriction, and expo-router subscribes to `url` events ITSELF
// (node_modules/expo-router/build/link/linking.js), independently of the app's
// own Linking listener in app/_layout.tsx. That listener bails on
// `if (!isAuthEmail) return;`, so it never sees — and cannot stop — anything
// else. Executed against the shipped module, `innermap://settings`,
// `innermap://paywall`, `innermap://messages`, `innermap://privacy`,
// `innermap://account/delete` and friends all resolve to real routes.
//
// The age gate's other guards do not cover this:
//   - GATE 0 in _layout.tsx runs once in the boot IIFE and only sets pendingRoute
//   - the (tabs)/_layout.tsx backstop holds render for TAB routes only
// so every NON-TAB route above was reachable by a device that had already been
// told it belongs to someone under 18. This is the last door.
//
// redirectSystemPath is awaited by expo-router for BOTH the cold-start URL
// (initial: true, getLinkingConfig.js:71) and every subsequent url event
// (initial: false, linking.js:108). It is the only hook that sees all of them.
//
// SCOPE: this file decides ROUTING for a blocked device. It changes no crisis
// behavior and adds no crisis content. See the note on support-resources below.
import { isAgeGateBlocked } from '../services/onboarding';

const BLOCK_DESTINATION = '/onboarding';

// The read must not be able to hang a deep link forever. AsyncStorage stalls are
// a documented problem on Android in this app (see the withTimeout usage in
// app/_layout.tsx). expo-router AWAITS this function, so an unresolved promise
// would strand the user on a blank launch rather than merely mis-routing them.
const READ_TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: T) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(fallback), ms);
    p.then((v) => { clearTimeout(timer); done(v); })
     .catch(() => { clearTimeout(timer); done(fallback); });
  });
}

export async function redirectSystemPath(
  { path }: { path: string; initial: boolean },
): Promise<string> {
  try {
    // FAIL CLOSED on an unknown read — same direction GATE 0 takes. A blocked
    // device must not get in because storage was slow; the cost to a legitimate
    // user is landing on /onboarding, which re-reads the flag on mount and lets
    // them straight through. The magic-link token is NOT consumed on this path
    // (app/_layout.tsx checks the flag before api.authSignIn), so a retry works.
    const blocked = await withTimeout(isAgeGateBlocked(), READ_TIMEOUT_MS, true);
    if (!blocked) return path;

    // Already heading somewhere harmless — don't rewrite it into a loop.
    // expo-router hands the path with or without a leading slash depending on
    // the URL shape (extractExpoPathFromURL strips the scheme), so normalize
    // before comparing.
    const normalized = String(path || '').replace(/^\/+/, '').split('?')[0];
    if (normalized === 'onboarding') return path;

    // Everything else — settings, paywall, messages, privacy, account/delete,
    // support-resources, the tabs, deep relationship routes — goes to the block
    // screen. Nothing is special-cased.
    //
    // support-resources IS in that set, and that is a real decision rather than
    // an oversight: it is the crisis-resources screen, so a blocked minor who
    // hand-crafts innermap://support-resources is redirected away from it.
    // Counsel is mid-review on the crisis-adjacent surfaces and the founder has
    // held all changes to them, so this file does NOT carve out an exception
    // one way or the other — it applies the gate uniformly and leaves the
    // exemption question open. Flagged for that review.
    return BLOCK_DESTINATION;
  } catch {
    // Never let this throw into expo-router's linking pipeline — a thrown
    // redirect would break deep links for everyone, blocked or not.
    return BLOCK_DESTINATION;
  }
}
