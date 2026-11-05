import path from "node:path";
import { defineConfig } from "prisma/config";
import { throwawayDatabaseUrl } from "./guard";

/**
 * Prisma config for migrating the integration database, passed with `--config`.
 *
 * Not `packages/db/prisma.config.ts`, because that one loads the root `.env`,
 * which holds the real database URL. dotenv does not override a variable that is
 * already set, so it would probably be harmless; "probably" is not good enough
 * for the one command in this suite that changes a schema. This file loads no
 * `.env` at all and takes the URL from the guard.
 */
const repoRoot = path.resolve(__dirname, "../../../../..");

export default defineConfig({
  schema: path.join(repoRoot, "packages/db/prisma/schema.prisma"),
  migrations: { path: path.join(repoRoot, "packages/db/prisma/migrations") },
  datasource: { url: throwawayDatabaseUrl() },
});
