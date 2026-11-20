const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

/**
 * Metro configuration for this app inside the npm-workspaces monorepo.
 *
 * Since SDK 52, `expo/metro-config` detects the workspace itself: it watches the
 * workspace packages and resolves hoisted dependencies from the root node_modules,
 * and since SDK 53 it honours package `exports`, so subpath imports such as
 * "@ride/maps-service/client" resolve. The manual `watchFolders`,
 * `nodeModulesPaths` and `disableHierarchicalLookup` this file used to set are
 * gone: `expo-doctor` flags them, and `disableHierarchicalLookup` stopped Metro
 * finding dependencies npm nests inside another package (for example
 * react-native's own @react-native/virtualized-lists), so the bundle failed.
 *
 * One override remains. The Next.js apps use a different React from this app, and
 * npm may hoist either copy to the workspace root. Code outside this app (the
 * hoisted react-native and expo-router, and @ride/maps-service/native) would then
 * bind to the root copy while the app binds to its own, and two Reacts in one
 * bundle break hooks with the "invalid hook call" error. So `react` and
 * `react-dom` are always resolved as if imported from this app's directory.
 */
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

const SINGLETONS = ["react", "react-dom"];
const fromApp = path.join(projectRoot, "package.json");
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned = SINGLETONS.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
  const ctx = pinned ? { ...context, originModulePath: fromApp } : context;
  return (upstreamResolveRequest ?? context.resolveRequest)(ctx, moduleName, platform);
};

module.exports = config;
