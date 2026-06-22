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
      'expo-router',
      'expo-secure-store',
      'expo-font',
      'expo-asset',
      'expo-local-authentication',
      // Build 11 — Apple Sign-In runtime + entitlement plumbing.
      'expo-apple-authentication',
      // Sentry crash reporting (June 2026). The Expo config plugin wires the
      // native SDK + auto-uploads JS source maps + iOS dSYMs during EAS build
      // so crashes are symbolicated with no user opt-in. Build-time upload
      // auth is the SENTRY_AUTH_TOKEN EAS secret — NOT in this file. This
      // path needs NO useFrameworks:static / Podfile patch (unlike
      // Crashlytics), so it doesn't perturb the Skia/Reanimated/New-Arch pods.
      ['@sentry/react-native/expo', { organization: 'innermap', project: 'react-native' }],
    ],
    extra: {
      apiBaseUrl: 'https://inner-map-production.up.railway.app',
      // Sentry DSN — the public client ingest key (safe to ship in config;
      // it is NOT a secret). Read at runtime by app/_layout.tsx's Sentry.init.
      // The source-map upload AUTH TOKEN is the secret and lives in EAS only.
      sentryDsn: 'https://416df2827990254e90410d555fd22faf@o4511603923353600.ingest.us.sentry.io/4511603945570304',
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
  const profile = process.env.EAS_BUILD_PROFILE || 'production';
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
