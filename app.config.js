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
      // PR B: associatedDomains array intentionally empty.
      // The only universal-link surface this app ever claimed was
      // /connect/* for the deep-link invite hand-off, and that flow
      // was retired in PR B in favor of text-based code sharing.
      // The empty array is preserved (rather than the key being
      // removed) so the field stays visible — when a new universal-
      // link surface is introduced in the future, adding the entry
      // here is a one-line change.
      associatedDomains: [],
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
      // PR B: intentFilters left empty. The only auto-verify deep
      // link this app declared was https://…/connect/* for the
      // invite-link hand-off, which was retired in PR B (text-based
      // code sharing has no link to intercept). Property kept (as an
      // empty array) rather than removed so future deep links can
      // be added here without re-introducing the field shape.
      intentFilters: [],
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
    ],
    extra: {
      apiBaseUrl: 'https://inner-map-production.up.railway.app',
      eas: {
        projectId: '14bce05f-41e2-42f3-aa6c-3c153023894f',
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
