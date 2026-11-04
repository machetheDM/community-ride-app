/**
 * React Native UI for the maps service.
 *
 * Isolated behind its own subpath export on purpose. The Expo apps pin React 18.3.1
 * (and `@types/react` ~18.3 via their own tsconfig `paths`) while the Next.js API is
 * on React 19 — a shared package with React in its main entry point drags one
 * version's types into the other's type-check. Only the Expo apps import this path;
 * the API imports "@ride/maps-service" and never sees React at all.
 *
 * `react`, `react-native` and `react-native-maps` are optional peer dependencies for
 * the same reason: the API installs the package without pulling any of them in.
 */

export { AddressAutocomplete } from "./AddressAutocomplete";
export type { AddressAutocompleteProps } from "./AddressAutocomplete";

export { RouteMap } from "./RouteMap";
export type { RouteMapProps } from "./RouteMap";
