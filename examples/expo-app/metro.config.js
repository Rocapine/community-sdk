// @generated: Expo's default config already detects this pnpm workspace and
// watches its root — the only override needed is below.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Metro's package.json "exports" resolution (on by default since Metro
// 0.83) is only partially spec-compliant: for a dual CJS/ESM package like
// @tanstack/react-query, different require sites across this monorepo can
// resolve to two DIFFERENT physical files (one via the "require" exports
// condition, one via "import") — two files means two separate
// `React.createContext(...)` calls, so `<QueryClientProvider>` (App.tsx)
// and @rocapine/community-core's compiled `useQueryClient()` calls end up
// reading from two unrelated contexts. Symptom: "No QueryClient set, use
// QueryClientProvider to set one" thrown at runtime even though the
// provider tree is wired correctly. Falling back to plain "main"/"browser"
// field resolution collapses every require of a package back onto one file.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
