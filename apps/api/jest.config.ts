import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

/**
 * Unit tests only — pure logic, no network, no database.
 * This is what CI runs on every push.
 *
 * The HTTP tests under src/test/e2e require a running API server and a seeded
 * database, so they are excluded here and run via `npm run test:e2e`.
 */
// Intentionally not annotated with jest's `Config`: react-native pins jest 29
// at the workspace root, so next/jest.js is typed against v29 option types while
// `jest` here is v30. Letting the literal infer keeps both sides satisfied.
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
