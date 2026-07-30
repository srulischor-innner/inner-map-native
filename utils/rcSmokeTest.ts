// RevenueCat configure() smoke test — dev-client only (__DEV__ guard at the
// call site keeps it out of every production bundle).
//
// VERDICT 2026-07-30: ✅ PASS on Expo SDK 54 / RN 0.81 / New Architecture /
// managed prebuild. configure() completed and the native module resolved; the
// "Invalid API Key" 401 that follows is the placeholder key behaving exactly
// as the note below predicts, NOT a failure. The null-module issue in the
// reports below does NOT reproduce on this stack.
//
// KEPT (not deleted) as the reproducible probe behind that verdict: if a
// future Expo/RN/New-Arch bump breaks module registration again, this is the
// fastest way to re-answer the question. Costs nothing in production.
//
// What it tests: the open GitHub reports (react-native-purchases
// #1747/#1739) claim NativeModules.RNPurchases is null on exactly this
// stack — Expo SDK 54 / RN 0.81 / New Architecture / managed prebuild.
// If the interop layer registered the module, configure() completes and
// PASS logs; if the reports reproduce, the import or configure throws
// (or the module probe logs false) and FAIL logs with the reason.
//
// The API key is a deliberate placeholder: module registration and
// configure() are exercised fully before any network use; later network
// calls would 401, which is out of scope for this test.
import { NativeModules } from 'react-native';

export async function runRcSmokeTest(): Promise<void> {
  console.log('=== [rc-smoke] RevenueCat configure() smoke test ===');
  console.log('[rc-smoke] NativeModules.RNPurchases present:', NativeModules.RNPurchases != null);
  try {
    const mod = await import('react-native-purchases');
    const Purchases = mod.default;
    Purchases.setLogLevel(mod.LOG_LEVEL.VERBOSE);
    Purchases.configure({ apiKey: 'appl_SMOKETESTPLACEHOLDER' });
    const configured = await Purchases.isConfigured();
    const appUserId = await Purchases.getAppUserID();
    console.log(`[rc-smoke] ✅ PASS — configure() completed. isConfigured=${configured} appUserID=${appUserId}`);
  } catch (e) {
    console.log('[rc-smoke] ❌ FAIL —', (e as Error)?.message || String(e));
  }
}
