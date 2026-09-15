// Config plugin — strip the two foreground-service permissions expo-audio
// merges in, because this app does not use a foreground service.
//
// WHY THIS EXISTS. Google Play has an OVERDUE policy declaration against this
// app: "Foreground service permissions", compliance deadline 31 January 2024,
// with the console saying "To keep releasing app updates, complete one of the
// following required actions." It blocks the Play track.
//
// Google offers exactly two actions:
//   1. if the use is not permitted by policy, REMOVE the permission
//   2. if the app has a legitimate reason, COMPLETE the declaration
//
// This app has no reason at all, which makes (1) the honest answer and (2) a
// false statement to a store. node_modules/expo-audio/android/src/main/
// AndroidManifest.xml declares FOREGROUND_SERVICE and
// FOREGROUND_SERVICE_MEDIA_PLAYBACK, and the manifest merger pulls both into
// our APK whether or not we ever start a service. We never do: every call site
// that configures the audio session passes `shouldPlayInBackground: false`
// (utils/ttsStream.ts, components/guide/GuideAskModal.tsx,
// components/journal/JournalEntryModal.tsx), nothing anywhere passes
// useForegroundService, and expo-audio only starts a media service when one of
// those is on. The permissions have been dead weight in the manifest, and the
// dead weight is what Play is asking about.
//
// A REMOVED PERMISSION IS A PROMISE ABOUT THE CODE, so it is guarded rather
// than remembered: scripts/check-no-foreground-service.js fails if any source
// file asks for background playback or a foreground service, which is the one
// change that would make this plugin wrong. Remove that check and the next
// person to type `shouldPlayInBackground: true` ships a crash instead of a
// finding — Android kills a process that starts a typed foreground service
// without the matching permission.
//
// tools:node="remove" is the manifest merger's own instruction for "a library
// asked for this and we decline". It is not a filter on android.permissions in
// app.config.js — that array adds, and cannot subtract a library's merge.

const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const REMOVE = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
];

module.exports = function withNoForegroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // The tools namespace has to be declared on <manifest> or the merger
    // ignores the attribute silently — which would look exactly like success.
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    manifest['uses-permission'] = manifest['uses-permission'] || [];

    for (const name of REMOVE) {
      // Drop any positive declaration of our own first, then add the removal
      // marker. Leaving both would be ambiguous.
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (p) => p.$ && p.$['android:name'] === name ? p.$['tools:node'] === 'remove' : true
      );
      const already = manifest['uses-permission'].some(
        (p) => p.$ && p.$['android:name'] === name && p.$['tools:node'] === 'remove'
      );
      if (!already) {
        manifest['uses-permission'].push({
          $: { 'android:name': name, 'tools:node': 'remove' },
        });
      }
    }

    return cfg;
  });
};
