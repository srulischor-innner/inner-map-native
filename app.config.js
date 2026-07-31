// Single source of truth for the Expo config.
//
// Previously this file was a thin overlay that did `require('./app.json')`
// and only varied bundleIdentifier / name per EAS build profile. Recent
// versions of `expo doctor` flag having both app.json AND app.config.js
// as a conflict (the dual-file pattern is technically supported but
// "doctor"-noisy and easy to misread when one file silently wins).
//
// Resolution (May 2026 incident — first production build at 1.1.0
// errored on `expo doctor` mid-prebuild): delete app.json entirely
// and inline its full expo object here as `base.expo`. Variant overlay
// logic at the bottom is unchanged.
//
// EAS sets EAS_BUILD_PROFILE automatically for every build. Locally
// (`npx expo run:ios`, dev server, etc) the env var is unset and we
// fall back to the production identifiers, matching what the App
// Store build ships.

// ===========================================================================
// Google Sign-In — iOS reversed-client-ID URL scheme (fatal-crash guard).
//
// On iOS, GIDSignIn requires the app's Info.plist to register the iOS OAuth
// client ID with its host components reversed as a CFBundleURLTypes scheme:
//   254307488325-fd5a8p59nsop2aev70uht1spd956k1ul.apps.googleusercontent.com
//     -> com.googleusercontent.apps.254307488325-fd5a8p59nsop2aev70uht1spd956k1ul
// (it is the OAuth redirect target the SDK hands to the auth session). If the
// scheme is absent, -[GIDSignIn signInWithOptions:] throws
// NSInvalidArgumentException and HARD-CRASHES the app on the FIRST tap of
// "Sign in with Google" — there is no JS layer to catch it. This was the
// 1.1.0 production crash (Sentry, iOS 26.5.1). The value is NOT a secret: it
// is embedded in the shipped IPA's Info.plist by design — that is exactly
// where the SDK reads it from.
//
// We derive the scheme from the SAME env var the SDK's iosClientId comes from
// (EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID — see extra.googleClientIds below +
// AuthButtonRow.tsx's GoogleSignin.configure) so the registered scheme and the
// runtime SDK config can never drift out of sync. The hardcoded fallback is
// the known production iOS client ID, so a missing/garbled env var at build
// time can never silently re-introduce the crash. NOTE: a native config
// change — requires a NEW build to take effect.
const KNOWN_GOOGLE_IOS_CLIENT_ID =
  '254307488325-fd5a8p59nsop2aev70uht1spd956k1ul.apps.googleusercontent.com';

function reversedIosClientScheme(clientId) {
  const m = /^(.+)\.apps\.googleusercontent\.com$/.exec(String(clientId || '').trim());
  return m ? `com.googleusercontent.apps.${m[1]}` : null;
}

// Always resolves to a valid scheme: build-time env value first, the known
// production client ID as the floor.
const GOOGLE_IOS_URL_SCHEME =
  reversedIosClientScheme(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) ||
  reversedIosClientScheme(KNOWN_GOOGLE_IOS_CLIENT_ID);

const base = {
  expo: {
    name: 'Inner Map',
    slug: 'inner-map',
    scheme: 'innermap',
    version: '1.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0a0a0f',
    },
    ios: {
      bundleIdentifier: 'com.srulischor.innermap',
      buildNumber: '3',
      supportsTablet: false,
      // Apple Sign-In capability — required for Build 11 account
      // recovery. Apple's policy requires that any iOS app offering
      // third-party social login (Google) also offer Sign in with
      // Apple. expo-apple-authentication wires up the runtime; this
      // flag adds the entitlement at build time.
      usesAppleSignIn: true,
      // Build 11 — magic-link universal link. The /auth/email path on
      // my-inner-map.com is the landing the user's email link points
      // at; iOS handles the universal-link match before the browser
      // renders it, opening the app directly and routing through our
      // deep-link handler. The host must serve a matching
      // /.well-known/apple-app-site-association file pointing at this
      // bundle.
      associatedDomains: ['applinks:my-inner-map.com'],
      infoPlist: {
        NSMicrophoneUsageDescription:
          'Inner Map uses the microphone for voice notes and voice conversations.',
        NSSpeechRecognitionUsageDescription:
          'Inner Map uses speech recognition to transcribe your voice notes.',
        UIBackgroundModes: ['audio'],
        NSFaceIDUsageDescription:
          'Inner Map uses Face ID to keep your conversations private.',
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
        },
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.srulischor.innermap',
      // Bump to 4: main-chat keyboard layout fix (build 13) requires
      // a new artifact for Android Internal Testing to pick up the
      // softwareKeyboardLayoutMode change below.
      versionCode: 4,
      // ANDROID WINDOW BACKGROUND — the white nav-bar band fix (July 2026).
      //
      // Under edgeToEdgeEnabled the OS draws NO real navigation-bar
      // background: on API 35+ gesture nav is fully transparent (both
      // Window#setNavigationBarColor and R.attr#navigationBarColor are
      // deprecated AND disabled for gesture nav), and 3-button nav is only an
      // 80%-alpha scrim that "matches the window background by default".
      // So the bar's apparent color IS android:windowBackground.
      //
      // @expo/prebuild-config's withAndroidRootViewBackgroundColor reads
      // `config.android?.backgroundColor || config.backgroundColor`, writes
      // <color name="activityBackground"> and points AppTheme's
      // android:windowBackground at it. We previously set NEITHER key, so
      // android:windowBackground was never written and fell through to
      // Theme.AppCompat.DayNight's default — which resolves LIGHT (white).
      // That white was the band under the nav bar.
      //
      // Scoped under `android` deliberately, NOT top-level: the top-level key
      // would also feed withIosRootViewBackgroundColor and write
      // RCTRootViewBackgroundColor into Info.plist. This is an Android fix;
      // iOS stays byte-identical.
      //
      // Requires expo-system-ui to be installed (it is) and a NEW native
      // build — this is a generated res/values resource, not something an OTA
      // update can ship.
      backgroundColor: '#0a0a0f',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0a0a0f',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      // ANDROID KEYBOARD LAYOUT MODE — "resize" (Expo's default, made
      // explicit). With edgeToEdgeEnabled the OS shrinks the window to
      // the area above the IME when the keyboard opens, so a bottom-
      // docked input naturally sits above the keyboard. This app has NO
      // bottom tab bar (the tab bar is a custom TOP bar — see
      // app/(tabs)/_layout.tsx), so "resize"'s usual downside (pushing
      // bottom tabs up above the keyboard) does not apply here.
      //
      // The prior value was "pan" + a manual kbHeight paddingBottom lift
      // on every screen. "pan" + edge-to-edge does NOT deliver a reliable
      // IME inset across OEM keyboards — it worked on the AOSP emulator
      // but left the chat input COVERED by the keyboard on Samsung One UI.
      // We now let the OS resize do the lift on Android normal screens
      // and apply the manual lift only where resize can't reach: iOS
      // (never resizes the RN view) and inside RN <Modal>s (a Modal is a
      // separate window that doesn't inherit the activity's resize). That
      // split lives in utils/useKeyboardInset.ts. Keep this value and the
      // hook in sync.
      softwareKeyboardLayoutMode: 'resize',
      // ANDROID PERMISSIONS — must include INTERNET explicitly.
      //
      // May 2026 incident: Android Internal Testing builds shipped
      // with permissions: ['RECORD_AUDIO'] only. Production users
      // saw zero requests land at Railway from ua=okhttp/4.12.0 —
      // every fetch failed before leaving the device. Email sign-in
      // AND Google sign-in both broke; iOS was unaffected (different
      // permission model). Browser on the same phone reached the
      // server, ruling out connectivity / TLS / DNS.
      //
      // Root cause: when android.permissions is set to an explicit
      // array, Expo's prebuild merges it with autolinked module
      // permissions, but it can ALSO act as a filter on the
      // permission tags emitted into AndroidManifest.xml — and the
      // default INTERNET tag (which RN's networking module declares
      // via its manifest merge) gets stripped in some prebuild paths
      // (especially with newArchEnabled: true). Being explicit is
      // the reliable fix.
      //
      // ACCESS_NETWORK_STATE is bundled with INTERNET as the standard
      // pair so any future "is the user online?" check doesn't trip
      // the same class of bug.
      permissions: ['RECORD_AUDIO', 'INTERNET', 'ACCESS_NETWORK_STATE'],
      // Build 11 — magic-link Android App Link. Same role as the iOS
      // associatedDomains entry above. The host must serve a matching
      // /.well-known/assetlinks.json with this package + the SHA-256
      // fingerprint of the production signing cert. autoVerify=true
      // enables the silent OS interception so the email link opens
      // the app directly rather than the browser.
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            { scheme: 'https', host: 'my-inner-map.com', pathPrefix: '/auth/' },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      // expo-system-ui (July 2026) — makes `userInterfaceStyle: 'dark'` above
      // actually bind on Android and applies android.backgroundColor to
      // android:windowBackground. Its Activity lifecycle listener calls
      // AppCompatDelegate.MODE_NIGHT_YES at onCreate from a generated string
      // resource, before any JS runs, so the OS stops picking the LIGHT nav-bar
      // scrim + light icons. Strictly this line is redundant — prebuild-config's
      // createLegacyPlugin auto-applies the package's own app.plugin.js once it
      // is autolinked — but it matches the official docs and createRunOncePlugin
      // dedupes, so listing it explicitly is free.
      'expo-system-ui',
      'expo-router',
      'expo-secure-store',
      'expo-font',
      'expo-asset',
      'expo-local-authentication',
      // expo-notifications config plugin. The library is a dependency + used
      // at runtime (services/push.ts) for the opt-in inbox push, but the
      // plugin was unregistered. Registering it is the recommended setup: it
      // wires the native notifications module config into the build. The iOS
      // aps-environment entitlement + APNs key are provisioned via EAS
      // credentials (eas credentials → iOS → Push Notifications) at build time.
      'expo-notifications',
      // Build 11 — Apple Sign-In runtime + entitlement plumbing.
      'expo-apple-authentication',
      // Build 13 fatal-crash fix (June 2026): the Google Sign-In config
      // plugin registers the REVERSED iOS OAuth client ID as a
      // CFBundleURLTypes scheme in Info.plist. Without it,
      // -[GIDSignIn signInWithOptions:] throws NSInvalidArgumentException
      // ("missing support for the following URL schemes …") and HARD-CRASHES
      // the moment a user taps "Sign in with Google" on iOS. The scheme MUST
      // live in the static native config; GoogleSignin.configure({iosClientId})
      // at runtime does NOT register it. See GOOGLE_IOS_URL_SCHEME above for
      // how the value is derived (and why it cannot drift from the SDK config).
      ['@react-native-google-signin/google-signin', { iosUrlScheme: GOOGLE_IOS_URL_SCHEME }],
      // Sentry crash reporting (June 2026). The Expo config plugin wires the
      // native SDK + auto-uploads JS source maps + iOS dSYMs during EAS build
      // so crashes are symbolicated with no user opt-in. Build-time upload
      // auth is the SENTRY_AUTH_TOKEN EAS secret — NOT in this file. This
      // path needs NO useFrameworks:static / Podfile patch (unlike
      // Crashlytics), so it doesn't perturb the Skia/Reanimated/New-Arch pods.
      ['@sentry/react-native/expo', { organization: 'innermap', project: 'react-native' }],
      // ANR fix (July 2026) — pre-warm the Expo ActivityResult SharedPreferences
      // off the main thread so the first onHostResume's DataPersistor.getLong
      // doesn't block the UI thread on the load barrier and ANR-crash under slow
      // cold-start disk I/O. Local plugin; see the file header for the full
      // mechanism. Must run after any plugin that rewrites MainApplication.
      './plugins/withActivityResultPrewarm',
    ],
    extra: {
      apiBaseUrl: 'https://inner-map-production.up.railway.app',
      // Sentry DSN — the public client ingest key (safe to ship in config;
      // it is NOT a secret). Read at runtime by app/_layout.tsx's Sentry.init.
      // The source-map upload AUTH TOKEN is the secret and lives in EAS only.
      sentryDsn: 'https://416df2827990254e90410d555fd22faf@o4511603923353600.ingest.us.sentry.io/4511603945570304',
      // RevenueCat PUBLIC SDK keys — safe to ship in a committed config, by
      // design: they identify the app to RC and can only do what the SDK can
      // do on behalf of a user. The SECRET API key and RC_WEBHOOK_AUTH are
      // the real secrets and live server-side / in Railway env only, never
      // here. Same rule as sentryDsn above.
      //
      // Project "Innermap" (61addd09) · bundle com.srulischor.innermap
      //   App Store app id: app59d360e6a1
      //   Play Store app id: app1d14531c80  (key not yet fetched — iOS first)
      revenueCatApiKeyIos: 'appl_ewysvfFZFWSmDXeLyHqTgXxXscf',
      eas: {
        projectId: '14bce05f-41e2-42f3-aa6c-3c153023894f',
      },
      // Build 11 — Google Sign-In OAuth Client IDs. Set at build time
      // via EAS secrets (or in .env for local dev). The web client
      // id is the one whose audience the server JWT verifier expects
      // when @react-native-google-signin/google-signin is configured
      // with serverClientId — that's the recommended pattern for
      // backend ID-token verification. iOS / Android client IDs are
      // referenced by the native SDK; web is what the audience
      // ultimately resolves to in the issued idToken.
      googleClientIds: {
        ios:     process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
        android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
        web:     process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
      },
      router: {},
    },
    owner: 'srulischor',
  },
};

const VARIANTS = {
  development: {
    bundleIdentifier: 'com.srulischor.innermap.dev',
    androidPackage:   'com.srulischor.innermap.dev',
    name:             'Inner Map Dev',
  },
  preview: {
    // Preview profile reuses the dev identifiers so internal QA
    // builds also install alongside the App Store install. Adjust
    // here if QA ever needs its own slot.
    bundleIdentifier: 'com.srulischor.innermap.dev',
    androidPackage:   'com.srulischor.innermap.dev',
    name:             'Inner Map Dev',
  },
  production: {
    bundleIdentifier: 'com.srulischor.innermap',
    androidPackage:   'com.srulischor.innermap',
    name:             'Inner Map',
  },
};

module.exports = () => {
  // Variant selection MUST use APP_VARIANT (set per-profile in eas.json
  // "env"), not EAS_BUILD_PROFILE. EAS_BUILD_PROFILE exists only on the
  // EAS builder — the local eas-cli evaluating this config at submit time
  // doesn't set it, so it resolved 'production' locally while the builder
  // resolved 'development': submitted metadata/credentials said target
  // "InnerMap" (com.srulischor.innermap), the builder's prebuild generated
  // target "InnerMapDev" (.dev), and the Configure Xcode project phase
  // failed with "Could not find target 'InnerMap' in project.pbxproj"
  // (dev builds 9ffc38ce + bc8fed8b, July 20 2026 — the variant map's
  // first-ever non-production runs). eas.json profile env is applied in
  // BOTH evaluations, so both sides agree. EAS_BUILD_PROFILE kept as a
  // builder-side fallback only.
  const profile = process.env.APP_VARIANT || process.env.EAS_BUILD_PROFILE || 'production';
  const variant = VARIANTS[profile] || VARIANTS.production;

  // Spread the inlined base, then overlay only the fields that change
  // per profile. Everything else (icons, plugins, infoPlist keys,
  // EAS projectId, deep-link associatedDomains / intentFilters, etc.)
  // flows through unchanged from `base`.
  const expo = {
    ...base.expo,
    name: variant.name,
    ios: {
      ...base.expo.ios,
      bundleIdentifier: variant.bundleIdentifier,
    },
    android: {
      ...base.expo.android,
      package: variant.androidPackage,
    },
  };

  return { expo };
};
