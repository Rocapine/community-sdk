// react-native-reanimated/plugin is added automatically by babel-preset-expo
// when react-native-reanimated is installed — no explicit plugins entry needed.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
