import { throwawayDatabaseUrl } from "./guard";

/**
 * Runs in every test worker before any test file is loaded, so before the
 * Prisma client that reads `DATABASE_URL` exists.
 *
 * Deliberately does not load any `.env` file (unlike `../setup.ts`, which the
 * unit suite uses and which reads the root `.env`). Everything this suite needs
 * is set here.
 */

const url = throwawayDatabaseUrl();
const env = process.env as Record<string, string | undefined>;

// The config process set this already. If anything between there and here
// replaced it, stop rather than guess which database the client would open.
if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== url) {
  throw new Error("DATABASE_URL differs from TEST_DATABASE_URL in the test worker. Refusing to run.");
}
env.DATABASE_URL = url;

env.JWT_SECRET = "integration-test-secret-not-a-real-one";
env.NODE_ENV = "test";

// No Maps key: every Maps path answers 503 and nothing is billed. No analytics,
// no push credentials. A test that needs one of these mocks the module instead.
delete env.GOOGLE_MAPS_SERVER_KEY;
delete env.BIGQUERY_DATASET;
delete env.GOOGLE_CLOUD_PROJECT;
delete env.FIREBASE_SERVICE_ACCOUNT;
delete env.EXPO_PUSH_ACCESS_TOKEN;

/**
 * No test may reach the network. The database is reached over a TCP socket by
 * `pg`, not through fetch, so this stub stops Google, Expo and BigQuery calls
 * without touching the database.
 */
global.fetch = (async (input: RequestInfo | URL) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
  // Straight to stderr as well: the push and analytics code catch and log
  // failures, and Jest can swallow console output from passing files, so a
  // blocked call would otherwise go unseen.
  process.stderr.write(`[integration] blocked a network call to ${target}\n`);
  throw new Error(`Integration tests must not make network calls. Something tried to fetch: ${target}`);
}) as typeof fetch;
