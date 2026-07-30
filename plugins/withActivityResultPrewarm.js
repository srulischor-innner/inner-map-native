// Config plugin — ANR fix (July 2026).
//
// Root cause: Expo Modules Core's ActivityResult registry restores pending-
// result state from a SharedPreferences file on every foreground. On the FIRST
// foreground after process start, `onHostResume → AppContextActivityResultRegistry
// .restoreInstanceState → DataPersistor.retrieveData` calls
// `sharedPreferences.getLong(EXPIRE_KEY, 0)` on the MAIN (UI) thread. That first
// access blocks on the SharedPreferences load barrier (awaitLoadedLocked) until
// the file's async load completes — and under slow cold-start disk I/O (or a
// device/emulator under I/O pressure) that wait can exceed the 5s ANR watchdog
// and crash the app. Seen in production on release 1.1.0+35 (Pixel 6 Pro / A12),
// stack: SharedPreferencesImpl.awaitLoadedLocked → getLong, caller
// expo.modules.kotlin.activityresult.DataPersistor.
//
// Fix (caller-agnostic, no library update): pre-warm the EXACT file DataPersistor
// reads — "expo.modules.kotlin.PersistentDataManager" — on a BACKGROUND thread at
// Application.onCreate. Android caches SharedPreferencesImpl by file name across
// the app, so when DataPersistor later opens the same name it gets the already-
// loaded instance and the main-thread getLong returns instantly (no barrier).
//
// Why this covers the onHostResume path even though it isn't cold-start init:
// awaitLoadedLocked only BLOCKS on the FIRST access before the load finishes;
// every later foreground hits the in-memory cache. onCreate always precedes the
// first onResume, so the background pre-warm started here races to finish the
// (tiny — usually empty) file's load before that first read. It is a head start,
// not a hard guarantee on the very slowest devices — pair with the boot-I/O
// drain (multiGet + deferred bootstrap) so the pre-warm thread gets disk time.

const { withMainApplication } = require('@expo/config-plugins');

const PREWARM_MARKER = 'expo.modules.kotlin.PersistentDataManager';

// The Kotlin injected into MainApplication.onCreate (Expo SDK 54 template is
// Kotlin). getSharedPreferences is a Context method (Application IS a Context),
// so it's called unqualified; MODE_PRIVATE is fully qualified to avoid needing
// an import. `.all` forces the load. Wrapped so a failure can never break boot.
const PREWARM_SNIPPET = `
    // ANR fix (July 2026): pre-warm the Expo ActivityResult SharedPreferences off
    // the main thread so the first onHostResume's DataPersistor.getLong doesn't
    // block the UI thread on the SharedPreferences load barrier. See
    // plugins/withActivityResultPrewarm.js.
    Thread {
      try {
        getSharedPreferences("expo.modules.kotlin.PersistentDataManager", android.content.Context.MODE_PRIVATE).all
      } catch (t: Throwable) { /* best-effort pre-warm; never break boot */ }
    }.start()`;

/**
 * Pure transform — inject the pre-warm snippet immediately after the first
 * `super.onCreate()` inside MainApplication. Idempotent: if the marker is
 * already present, returns the input unchanged. Throws if the anchor is missing
 * so a template change fails the build loudly rather than silently no-op'ing.
 * Exported for unit testing without a full prebuild.
 */
function injectPrewarm(contents) {
  if (contents.includes(PREWARM_MARKER)) return contents; // already injected
  const anchor = 'super.onCreate()';
  const idx = contents.indexOf(anchor);
  if (idx === -1) {
    throw new Error(
      '[withActivityResultPrewarm] could not find "super.onCreate()" in MainApplication — ' +
      'the Expo template changed; update this plugin.',
    );
  }
  const insertAt = idx + anchor.length;
  return contents.slice(0, insertAt) + '\n' + PREWARM_SNIPPET + contents.slice(insertAt);
}

const withActivityResultPrewarm = (config) =>
  withMainApplication(config, (cfg) => {
    cfg.modResults.contents = injectPrewarm(cfg.modResults.contents);
    return cfg;
  });

module.exports = withActivityResultPrewarm;
module.exports.injectPrewarm = injectPrewarm;
module.exports.PREWARM_MARKER = PREWARM_MARKER;
