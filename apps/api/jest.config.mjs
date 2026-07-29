import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

/**
 * Unit tests only — pure logic, no network, no database.
 * This is what CI runs on every push.
 *
 * The HTTP tests under src/test/e2e require a running API server and a seeded
 * database, so they are excluded here and run via `npm run test:e2e`.
 *
 * Deliberately .mjs rather than .ts. A TypeScript Jest config makes jest-config
 * load ts-node, which it resolves from its own location inside
 * node_modules/@jest/core/. In an npm workspace ts-node often lands nested under
 * apps/api/node_modules instead of the root, where that lookup cannot reach it —
 * so the suite passed locally and failed in CI. A .mjs config needs no
 * transpiler, so the dependency disappears rather than being papered over.
 */
const config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  testMatch: ["<rootDir>/src/test/unit/**/*.test.ts"],
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
  collectCoverageFrom: ["src/lib/**/*.ts", "!src/lib/prisma.ts"],
};

export default createJestConfig(config);
