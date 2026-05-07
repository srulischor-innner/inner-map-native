// Dynamic Expo config — picks the bundle identifier (and a matching
// display name) based on the EAS build profile. The static base is
// pulled from app.json so this file stays a thin overlay; only the
// fields that vary by profile are touched here.
//
// EAS sets EAS_BUILD_PROFILE automatically for every build. Locally
// (`npx expo run:ios`, dev server, etc) the env var is unset and we
// fall back to the production identifiers, matching what the App
// Store build ships.
//
// Why this file exists: eas.json's build-profile ios.bundleIdentifier
// is a submit-profile field, not a build-profile one — putting it
// there during a build is silently ignored. The bundle id has to
// come from the Expo config itself.

const base = require('./app.json');

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

  // Spread the static base, then overlay only the fields that change
  // per profile. Everything else (icons, plugins, infoPlist keys,
  // EAS projectId, etc.) flows through unchanged from app.json.
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
