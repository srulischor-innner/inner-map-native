// Legal documents — single source of truth for the app.
//
// CONSOLIDATION (Option A): the legally-binding Privacy Policy and Terms of
// Service live as canonical HTML documents at my-inner-map.com (the
// inner-map-legal repo, served via Cloudflare). The in-app privacy screen and
// the onboarding notices are deliberately NON-binding plain-language
// summaries — they must never be treated as the authoritative text. Wherever
// the app links a user to "the full document," it routes here so the live
// canonical version is the only legally-operative copy.
//
// Keeping the URLs + open behavior in ONE module means:
//   - the canonical URLs are defined exactly once (no per-screen drift), and
//   - the open mechanism is swappable in a single place (see openLegalDoc).

import { Linking } from 'react-native';

// Canonical, legally-binding documents (hosted at my-inner-map.com via
// Cloudflare; authored in the inner-map-legal repo).
export const PRIVACY_POLICY_URL = 'https://my-inner-map.com/privacy-policy.html';
export const TERMS_OF_SERVICE_URL = 'https://my-inner-map.com/terms-of-service.html';

// The "Last Updated" date carried by BOTH canonical documents. They are
// versioned in lockstep and both read "Last Updated: 9 November 2026" from the
// 2026-11-09 republication: two small corrections (the timezone lines removed,
// ElevenLabs narrowed to the "Hear what Self would say" message), with the
// Effective Date still 13 October 2026. Before that they read 13 October 2026,
// counsel's rewrite (inner-map-legal 883967e); the app read "July 3, 2026" for
// four weeks after it — policy finding F2, fixed 2026-11-09 — and is in the
// documents' own form since, so the two can be compared by eye.
//
// A Last Updated date is NOT by itself a material change. Only a material
// change moves LEGAL_POLICY_CHANGED_ON and LEGAL_POLICY_VERSION below (and
// re-prompts everyone who accepted an older text); a correction like
// 9 November's moves this constant alone.
//
// THIS IS THE ONLY PLACE IN THE APP WHERE THE DATE MAY BE WRITTEN.
// app/privacy.tsx renders it; nothing else may hardcode a date. Both this
// comment and that screen carried "July 1, 2026" from the day the summary
// shipped — a version of the policy that has never existed. That line is the
// single thing in the app that would ever tell a reader the non-binding
// summary had fallen behind the binding document, and because it named a
// version that does not exist it could not have told them, however far behind
// the summary drifted. Nothing asserted it, which is how it stayed wrong.
//
// BUMP THIS whenever either document's Last Updated date changes, in the SAME
// change as the date pinned in scripts/smoke-audit-fixes-app.js section 4,
// which asserts this constant exactly and goes red until it is updated too.
// That step pins the literal on purpose: a shape-only check ("any Month D,
// YYYY") would have stayed green through the July 1 defect.
export const LEGAL_DOCS_LAST_UPDATED = '9 November 2026';

// THE LAST MATERIAL CHANGE, in the documents' words: the date the
// policy-change notice (components/legal/PolicyUpdateNotice.tsx) says the
// documents were updated on. Split from LEGAL_DOCS_LAST_UPDATED on 2026-11-09,
// when the documents were re-dated for corrections that re-prompt nobody: the
// notice still names the change people are asked to accept. Moves with
// LEGAL_POLICY_VERSION, never without it.
export const LEGAL_POLICY_CHANGED_ON = '13 October 2026';

// THE SAME FACT AS A VERSION KEY (F2, 2026-11-09). Stored with the person's
// terms acceptance (services/onboarding.ts markTermsAccepted) and sent with
// it (api.acceptTerms), so it is known WHICH text they accepted. When this
// moves past what a person accepted, the app shows an in-app notice before
// they continue (components/legal/PolicyUpdateNotice.tsx) — the Terms
// promise "For material changes, we will provide notice in-app" — and its
// Continue is stored as acceptance of this version (founder ruling
// 2026-11-09). The server holds the same version as AGE_POLICY_VERSION and
// stamps it on every age attestation, so if the two ever disagree the audit
// trail points at a version of the text nobody was shown. Bump it, with
// LEGAL_POLICY_CHANGED_ON and AGE_POLICY_VERSION in the server's server.js,
// only for a material change.
export const LEGAL_POLICY_VERSION = '2026-10-13';

/**
 * Open one of the live legal documents.
 *
 * MECHANISM — currently `Linking.openURL` (hands off to the system browser).
 *
 * The preferred pattern for legal docs is an in-app browser
 * (`WebBrowser.openBrowserAsync` — SFSafariViewController on iOS / Custom Tabs
 * on Android), which keeps the user in-context and is the pattern Apple
 * prefers. We did NOT adopt it here because `expo-web-browser` is not yet a
 * dependency, and adding a native module requires a new dev/EAS build — out of
 * scope for a copy/consolidation change.
 *
 * TO UPGRADE to the in-app browser later (one place, app-wide):
 *   1. `npx expo install expo-web-browser`  (then rebuild the dev client)
 *   2. `import * as WebBrowser from 'expo-web-browser';`
 *   3. swap the body below to:
 *        `return WebBrowser.openBrowserAsync(url).then(() => {});`
 * No call sites change — they all go through this function.
 */
export function openLegalDoc(url: string): Promise<void> {
  return Linking.openURL(url).catch((e) => {
    console.warn('[legalDocs] openURL threw:', (e as Error)?.message);
  });
}
