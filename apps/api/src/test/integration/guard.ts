/**
 * The one check between these tests and a real database.
 *
 * The integration suite creates users, rides and orders, and its global setup
 * drops the `ride` schema and re-applies every migration. The monorepo's root
 * `.env` holds the real (Supabase) `DATABASE_URL`. A suite that fell back to it,
 * or that let dotenv quietly replace the test URL with it, would wipe that
 * database. So the suite refuses to start unless `TEST_DATABASE_URL` is set and
 * points at this machine, and it never reads `DATABASE_URL` from anywhere else:
 * it writes it, from `TEST_DATABASE_URL`, and checks it was not changed.
 *
 * `jest.integration.config.mjs` repeats this check in plain JavaScript, because
 * a `.mjs` config cannot import TypeScript; this copy runs in each test worker
 * and in the Prisma config used for migrations.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function throwawayDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      "TEST_DATABASE_URL is not set. The integration tests run only against a throwaway local Postgres, e.g.\n" +
        "  docker run -d --name ride-it -e POSTGRES_USER=ride -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=ride_it " +
        "-p 127.0.0.1:5453:5432 postgres:16-alpine\n" +
        "  TEST_DATABASE_URL=postgresql://ride:throwaway@127.0.0.1:5453/ride_it"
    );
  }

  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    // The host is named, never the URL: it may carry a password.
    throw new Error(`TEST_DATABASE_URL must point at localhost or 127.0.0.1, not "${host}". Refusing to run.`);
  }
  return raw;
}
