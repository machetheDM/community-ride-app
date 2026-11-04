const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

/**
 * Metro configuration for this app inside the npm-workspaces monorepo.
 *
 * Without this file Metro only looks at the app directory, so it cannot resolve
 * `@ride/*` workspace packages at all — they live at the repo root and are
 * symlinked into node_modules. Type-checking would pass and the bundle would fail,
 * which is the worst order to find out.
 *
 * Three things are required:
 *   - watchFolders so Metro reads (and hot-reloads) source outside the app dir
 *   - nodeModulesPaths so it finds hoisted dependencies at the workspace root
 *   - package exports so subpath imports like "@ride/maps-service/client" resolve
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// The maps package exposes "." , "./client" and "./native" as separate subpaths so
// the React Native components never reach the API's bundle. Metro must honour the
// exports map for those to resolve.
config.resolver.unstable_enablePackageExports = true;

// Prefer the app's own copy of React. The workspace root hoists React 19 for the
// Next.js apps while Expo pins 18.3.1 — resolving two Reacts into one bundle breaks
// hooks with the "invalid hook call" error.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
