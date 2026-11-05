import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";
import { throwawayDatabaseUrl } from "./guard";

/**
 * Gives the suite a fresh schema: drop what the last run left, then apply every
 * migration with `prisma migrate deploy`, the same command a deployment runs, so
 * the tests also prove the migrations build the schema the code expects.
 *
 * Every destructive step here runs only after the guard has confirmed the URL
 * is a local throwaway database.
 */
export default async function globalSetup(): Promise<void> {
  const url = throwawayDatabaseUrl();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS "ride" CASCADE');
    await client.query('DROP TABLE IF EXISTS public."_prisma_migrations"');
  } finally {
    await client.end();
  }

  const repoRoot = path.resolve(__dirname, "../../../../..");
  const prismaCli = require.resolve("prisma/build/index.js", { paths: [path.join(repoRoot, "packages/db")] });
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--config", path.join(__dirname, "prisma.config.ts")], {
    cwd: path.join(repoRoot, "packages/db"),
    // Only what the CLI needs, and DATABASE_URL set to the guarded URL in case
    // anything in Prisma reads it despite the explicit config.
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
}
