/**
 * Totals one day of language-model calls (docs/PLAN.md 4.5, PRACTICES ML-7).
 *
 *   $env:DATABASE_URL = "<the database to read>"
 *   npm run model-cost -w @ride/db -- 2026-11-19
 *
 * The day is a South African calendar day (UTC+2). Reads only. Does not load
 * .env: the database to read is named on the command line's environment, so it
 * is never the wrong one by default.
 *
 * Cost is the sum of what each call recorded at the price configured when it
 * ran; calls made with no price configured are counted, and their tokens are
 * in the totals, but they add nothing to the cost, and the report says how many.
 */
import { prisma } from "../src/index";

function dayBounds(day: string): { from: Date; to: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Give the day as YYYY-MM-DD, not "${day}"`);
  const from = new Date(`${day}T00:00:00+02:00`);
  if (Number.isNaN(from.getTime())) throw new Error(`"${day}" is not a date`);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the database to read");
  const day = process.argv[2] ?? new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
  const { from, to } = dayBounds(day);

  const calls = await prisma.modelCall.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { feature: true, model: true, promptVersion: true, outcome: true, latencyMs: true, inputTokens: true, outputTokens: true, costUsd: true },
  });

  const groups = new Map<string, typeof calls>();
  for (const call of calls) {
    const key = `${call.feature} | ${call.model} | ${call.promptVersion}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }

  console.log(`Language-model calls on ${day} (SAST): ${calls.length}`);
  let dayCost = 0;
  for (const [key, group] of groups) {
    const latency = group.map((c) => c.latencyMs).sort((a, b) => a - b);
    const tokensIn = group.reduce((n, c) => n + (c.inputTokens ?? 0), 0);
    const tokensOut = group.reduce((n, c) => n + (c.outputTokens ?? 0), 0);
    const priced = group.filter((c) => c.costUsd !== null);
    // A call that used tokens but has no cost ran with no price configured; a failed call used none.
    const unpriced = group.filter((c) => c.costUsd === null && (c.inputTokens ?? 0) + (c.outputTokens ?? 0) > 0).length;
    const cost = priced.reduce((n, c) => n + Number(c.costUsd), 0);
    dayCost += cost;
    const outcomes = ["OK", "INVALID", "ERROR"].map((o) => `${o} ${group.filter((c) => c.outcome === o).length}`).join(", ");
    console.log(`\n${key}`);
    console.log(`  calls ${group.length} (${outcomes})`);
    console.log(`  latency p50 ${percentile(latency, 50)} ms, p95 ${percentile(latency, 95)} ms`);
    console.log(`  tokens ${tokensIn} in, ${tokensOut} out`);
    console.log(`  cost $${cost.toFixed(6)}${unpriced ? ` (${unpriced} call(s) used tokens with no price configured, so are not in this)` : ""}`);
  }
  console.log(`\nDay total: $${dayCost.toFixed(6)}`);
}

main()
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
