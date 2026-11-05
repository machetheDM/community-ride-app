import nextJest from "next/jest.js";

/**
 * Integration tests: the route handlers called in-process against a throwaway
 * Postgres, with real SQL, real transactions and real migrations.
 *
 *   docker run -d --name ride-it -e POSTGRES_USER=ride -e POSTGRES_PASSWORD=throwaway \
 *     -e POSTGRES_DB=ride_it -p 127.0.0.1:5453:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgresql://ride:throwaway@127.0.0.1:5453/ride_it npm run test:integration
 *
 * The suite refuses to start unless TEST_DATABASE_URL is set and points at
 * localhost or 127.0.0.1. The root .env holds the real DATABASE_URL; this suite
 * drops a schema, so it must never be able to reach that database. The check is
 * repeated in src/test/integration/guard.ts for the workers and the migration
 * config, because this .mjs file cannot import TypeScript.
 *
 * See jest.config.mjs for why this is .mjs and not .ts.
 */

const raw = process.env.TEST_DATABASE_URL;
if (!raw) {
  throw new Error("TEST_DATABASE_URL is not set. The integration tests need a throwaway local Postgres.");
}
let host;
try {
  host = new URL(raw).hostname;
} catch {
  throw new Error("TEST_DATABASE_URL is not a valid URL.");
}
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error(`TEST_DATABASE_URL must point at localhost or 127.0.0.1, not "${host}". Refusing to run.`);
}

// Set before next/jest loads any .env file. Neither @next/env nor dotenv
// overrides a variable that is already set, and the workers inherit this one.
process.env.DATABASE_URL = raw;

const createJestConfig = nextJest({ dir: "./" });

/**
 * Modules replaced by offline fakes, put in front of next/jest's own mappers
 * (below) because Jest uses the first pattern that matches.
 *
 * The notifications pattern also matches relative requests: next/jest's SWC
 * transform rewrites tsconfig paths, so by the time Jest resolves it,
 * `@/lib/notifications` reads `../../../lib/notifications` (or `./notifications`
 * from inside lib/). A pattern for the alias alone never matched, the real
 * module ran, and a test tried to reach Expo, stopped only by the fetch stub.
 */
const FAKES = {
  "^(@/|(\\.\\.?/)+)(lib/)?notifications$": "<rootDir>/src/test/integration/fakes/notifications.ts",
  "^@ride/maps-service$": "<rootDir>/src/test/integration/fakes/maps-service.ts",
};

const config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // setupFiles, not setupFilesAfterEnv: it must run before any test module,
  // and so before the Prisma client reads DATABASE_URL.
  setupFiles: ["<rootDir>/src/test/integration/setup-env.ts"],
  globalSetup: "<rootDir>/src/test/integration/global-setup.ts",
  // A glob without <rootDir>: on Windows a rootDir under a dot-directory (such
  // as a .claude/worktrees checkout) makes a <rootDir> glob match nothing.
  testMatch: ["**/src/test/integration/**/*.int.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
  // One database, so one worker: files run one after another and each test
  // creates the rows it needs.
  maxWorkers: 1,
  testTimeout: 30_000,
};

export default async function integrationConfig() {
  const built = await createJestConfig(config)();
  return { ...built, moduleNameMapper: { ...FAKES, ...built.moduleNameMapper } };
}
