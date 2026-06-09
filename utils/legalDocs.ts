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
// Cloudflare; authored in the inner-map-legal repo). Last updated May 19, 2026.
export const PRIVACY_POLICY_URL = 'https://my-inner-map.com/privacy-policy.html';
export const TERMS_OF_SERVICE_URL = 'https://my-inner-map.com/terms-of-service.html';

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
