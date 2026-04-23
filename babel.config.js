// Babel config for Expo SDK 54 + expo-router.
// Just babel-preset-expo — the preset handles JSX, TypeScript, and the transforms
// expo-router needs (routes are resolved at build time via its metro plugin, not via
// a babel plugin, so nothing extra is required here).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin MUST be the last plugin in the list. It rewrites
    // the worklets used by useSharedValue / useDerivedValue / useAnimatedStyle etc.
    // Without it, Reanimated animations fail silently with "Reanimated 2 failed to
    // create a worklet" at runtime.
    plugins: ['react-native-reanimated/plugin'],
  };
};
