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
      buildNumber: '2',
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
      versionCode: 2,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0a0a0f',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: ['RECORD_AUDIO'],
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
    ],
    extra: {
      apiBaseUrl: 'https://inner-map-production.up.railway.app',
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
