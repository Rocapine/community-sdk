// Expo's default config detects this npm workspace and watches the repo root.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The SDK packages ship CommonJS (`lib/`), the app ESM: @tanstack's dual package then
// resolves to two files ("require" vs "import" export conditions), so two React
// contexts and "No QueryClient set" at runtime. Resolve every @tanstack import the
// CommonJS way so all of them land on one file.
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    moduleName.startsWith("@tanstack/") ? { ...context, isESMImport: false } : context,
    moduleName,
    platform,
  );

module.exports = config;
