import { config } from "dotenv";
import path from "path";

// Load the monorepo root .env when present. Absent in CI, which supplies env directly.
config({ path: path.resolve(__dirname, "../../../../.env"), quiet: true });

// Deterministic defaults so unit tests never depend on a developer's local .env.
// Written through a widened alias because @types/node declares NODE_ENV readonly.
const env = process.env as Record<string, string | undefined>;
env.JWT_SECRET ??= "test-secret-not-used-in-production";
env.NODE_ENV ??= "test";
