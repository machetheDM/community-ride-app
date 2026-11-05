#!/usr/bin/env node
/**
 * Dependency gate: fails on any high or critical npm advisory in runtime
 * dependencies, unless security/audit-exceptions.json accepts it with a reason and
 * an expiry date (PRACTICES ALL-4, DSO-2).
 *
 * A plain `npm audit --audit-level=high` cannot be used here: the Expo SDK 52
 * build tooling carries advisories that only the SDK upgrade clears, so the job
 * would be red on every run, and a check that is always red is ignored as surely
 * as one that never runs. An exception file keeps the gate blocking for anything
 * new, makes every accepted risk visible in review, and turns red again on the
 * day an exception expires.
 *
 *   node scripts/audit-gate.mjs            uses `npm audit --omit=dev --json`
 *   node scripts/audit-gate.mjs report.json   reads a saved report instead
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BLOCKING = new Set(["high", "critical"]);

function loadReport() {
  const saved = process.argv[2];
  if (saved) return JSON.parse(readFileSync(saved, "utf8"));
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--omit=dev", "--json"], { cwd: root, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    // npm audit exits non-zero whenever it finds anything; the report is still on stdout.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

const report = loadReport();
const { exceptions } = JSON.parse(readFileSync(path.join(root, "security", "audit-exceptions.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const byPackage = new Map(exceptions.map((e) => [e.package, e]));

const blocking = Object.entries(report.vulnerabilities ?? {}).filter(([, v]) => BLOCKING.has(v.severity));
const failures = [];
const accepted = [];

for (const [name, vuln] of blocking) {
  const exception = byPackage.get(name);
  if (!exception) {
    failures.push(`${vuln.severity.toUpperCase()} ${name}: not in security/audit-exceptions.json`);
  } else if (exception.expires < today) {
    failures.push(`${vuln.severity.toUpperCase()} ${name}: exception expired on ${exception.expires} (${exception.fix})`);
  } else {
    accepted.push(`${vuln.severity} ${name} until ${exception.expires}: ${exception.fix}`);
  }
}

const flagged = new Set(blocking.map(([name]) => name));
const stale = exceptions.filter((e) => !flagged.has(e.package)).map((e) => e.package);

console.log(`npm audit (runtime dependencies): ${JSON.stringify(report.metadata?.vulnerabilities ?? {})}`);
for (const line of accepted) console.log(`  accepted  ${line}`);
for (const name of stale) console.log(`  stale     ${name}: no longer flagged, remove its exception`);

if (failures.length) {
  for (const line of failures) console.error(`::error::${line}`);
  process.exit(1);
}
console.log(`Gate passed: ${accepted.length} accepted exception(s), nothing new.`);
