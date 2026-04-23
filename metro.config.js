// Metro bundler config for Expo SDK 54 + expo-router.
// Uses @expo/metro-config's default, which wires up the expo-router resolver so
// files under app/ register as routes automatically. Without this file the bundler
// still builds, but expo-router's entry fails to resolve its virtual route tree —
// which is the cause of the "Could not connect to development server" red screen
// fetching /node_modules/expo-router/entry.bundle on a fresh project.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
