// Metro bundler config for Expo SDK 54 + expo-router.
// Uses @expo/metro-config's default, which wires up the expo-router resolver so
// files under app/ register as routes automatically. Without this file the bundler
// still builds, but expo-router's entry fails to resolve its virtual route tree —
// which is the cause of the "Could not connect to development server" red screen
// fetching /node_modules/expo-router/entry.bundle on a fresh project.
// Sentry (June 2026): getSentryExpoConfig wraps Expo's getDefaultConfig (the
// expo-router resolver is preserved) AND adds the source-map upload hooks so
// JS bundles + maps ship to Sentry during EAS build for symbolicated traces.
// Drop-in replacement for getDefaultConfig — no other config change needed.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

module.exports = config;
