// Babel config for Expo SDK 54 + expo-router.
// Just babel-preset-expo — the preset handles JSX, TypeScript, and the transforms
// expo-router needs (routes are resolved at build time via its metro plugin, not via
// a babel plugin, so nothing extra is required here).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
