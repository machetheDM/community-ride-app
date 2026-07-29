import { config } from "dotenv";
import path from "path";
import { Client } from "pg";

config({ path: path.resolve(__dirname, "../../.env") });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  await client.query('CREATE SCHEMA IF NOT EXISTS "ride"');
  const res = await client.query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'ride'"
  );
  console.log(res.rowCount === 1 ? '✅ "ride" schema ready' : '❌ schema not found');
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
