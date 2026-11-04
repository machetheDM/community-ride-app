import { config } from "dotenv";
import path from "path";

// Load the monorepo root .env when present. Absent in CI, which supplies env directly.
config({ path: path.resolve(__dirname, "../../../../.env"), quiet: true });

// Deterministic defaults so unit tests never depend on a developer's local .env.
// Written through a widened alias because @types/node declares NODE_ENV readonly.
const env = process.env as Record<string, string | undefined>;
env.JWT_SECRET ??= "test-secret-not-used-in-production";
env.NODE_ENV ??= "test";

/**
 * Fail loudly on any real network call from a unit test.
 *
 * This is not hypothetical: a maps test whose module mock silently failed to apply
 * fell through to the real client and issued a live request to Google, which came
 * back REQUEST_DENIED and turned into a confusing assertion failure about error
 * types. The test was "passing through" to the internet and nothing said so.
 *
 * Unit tests inject their own fetch — `MapsConfig.fetchImpl` for the maps package,
 * explicit mocks elsewhere. Anything reaching this stub is a wiring mistake, and a
 * blunt error naming the URL is far easier to diagnose than a network response.
 *
 * The e2e suite runs under jest.e2e.config.mjs and does not load this file, so real
 * HTTP there is unaffected.
 */
global.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
  throw new Error(
    `Unit tests must not make real network calls. Something tried to fetch: ${url}\n` +
      "Inject a fetch implementation (e.g. MapsConfig.fetchImpl) or mock the caller."
  );
}) as typeof fetch;
