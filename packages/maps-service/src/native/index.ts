/**
 * React Native UI for the maps service.
 *
 * Isolated behind its own subpath export on purpose. The Expo apps pin the React
 * their SDK expects (19.3.0 on SDK 58) while the Next.js apps choose their own — a
 * shared package with React in its main entry point drags one app's React and its
 * types into the other's build. Only the Expo apps import this path; the API imports
 * "@ride/maps-service" and never sees React at all. The apps' metro.config.js resolves
 * `react` from the app's directory, so these components bind to the app's copy.
 *
 * `react`, `react-native` and `react-native-maps` are optional peer dependencies for
 * the same reason: the API installs the package without pulling any of them in.
 */

export { AddressAutocomplete } from "./AddressAutocomplete";
export type { AddressAutocompleteProps } from "./AddressAutocomplete";

export { RouteMap } from "./RouteMap";
export type { RouteMapProps } from "./RouteMap";
