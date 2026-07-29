import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

/**
 * End-to-end HTTP tests. These hit a real server over the network and expect a
 * seeded database, so they are NOT part of `npm test` and are not run in CI.
 *
 * Usage:
 *   npm run dev          # in apps/api, serves http://localhost:3000
 *   npm run test:e2e     # in another shell
 *
 * Override the target with API_BASE_URL if the server is elsewhere.
 */
// See jest.config.ts for why this is not annotated with jest's `Config`.
const config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  testMatch: ["<rootDir>/src/test/e2e/**/*.e2e.test.ts"],
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
  testTimeout: 15_000,
};

export default createJestConfig(config);
