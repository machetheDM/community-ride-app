/**
 * The poster reader's evaluation (docs/PLAN.md 4.1 and 4.6, PRACTICES ML-1, ML-5).
 *
 *   npm run eval -w @ride/poster-reader
 *
 * Runs in CI with no network and no credentials. Three parts:
 *
 *  1. Defences. Every red-team answer in eval/cases.json, written as a model
 *     that fell for the poster would answer, goes through the same checks as a
 *     live answer. Each must meet the defence its case names: discarded whole,
 *     set aside, or left to the admin. A miss fails the build.
 *  2. False alarms. Every hand-checked answer goes through the same checks;
 *     each of its fields must survive. A correct field set aside fails the build.
 *  3. The model. Answers recorded from a live run (eval/live.ts) for the
 *     current prompt version are scored field by field against the labels. Until
 *     a live run has been recorded this part says so and scores nothing: there
 *     is no GCP project yet, so no model has answered.
 *
 * Writes a summary to stdout and, in GitHub Actions, to the job summary.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { checkAnswer } from "../src/check";
import { PROMPT_VERSION, type FieldName } from "../src/fields";

type Expect = "discarded" | "set-aside" | "admin";

interface RedTeamAnswer {
  label: string;
  field?: FieldName;
  expect: Expect;
  answer?: Record<string, unknown>;
  answerRepeat?: { text: string; times: number };
}

interface Case {
  id: string;
  kind: "normal" | "redteam";
  owasp?: string;
  expected: Record<FieldName, string | null>;
  answers?: RedTeamAnswer[];
}

interface Recorded {
  model: string;
  recordedAt: string;
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

const HERE = __dirname;
const set = JSON.parse(readFileSync(path.join(HERE, "cases.json"), "utf8")) as { evalDate: string; cases: Case[] };
const now = new Date(set.evalDate);
const SCORED: FieldName[] = ["title", "startsAt", "endsAt", "venueName", "ticketInfo"];

const lines: string[] = [];
const out = (line = "") => lines.push(line);
let failures = 0;

function handling(raw: string, field: FieldName | undefined): Expect | "kept-elsewhere" {
  const result = checkAnswer(raw, now);
  if (!result.ok) return "discarded";
  if (!field) return "kept-elsewhere";
  if (result.setAside.some((s) => s.field === field)) return "set-aside";
  return field in result.fields ? "admin" : "kept-elsewhere";
}

// ── 1. Defences ───────────────────────────────────────────────
out(`# Poster reader evaluation (${PROMPT_VERSION})`);
out();
out(`Set: ${set.cases.filter((c) => c.kind === "normal").length} normal and ${set.cases.filter((c) => c.kind === "redteam").length} red-team posters, all SYNTHETIC (eval/make_posters.py). Checks dated ${set.evalDate}.`);
out();
out("## 1. Defences against a compromised model");
out();
out("| Case | OWASP | Answer | Must be | Was |");
out("|---|---|---|---|---|");
const byDefence: Record<Expect, number> = { discarded: 0, "set-aside": 0, admin: 0 };
for (const c of set.cases.filter((x) => x.kind === "redteam")) {
  for (const a of c.answers ?? []) {
    const raw = a.answerRepeat ? a.answerRepeat.text.repeat(a.answerRepeat.times) : JSON.stringify(a.answer);
    const was = handling(raw, a.field);
    const pass = was === a.expect;
    if (pass) byDefence[a.expect] += 1;
    else failures += 1;
    out(`| ${c.id} | ${c.owasp} | ${a.label} | ${a.expect} | ${pass ? was : `**${was} (FAIL)**`} |`);
  }
}
const total = byDefence.discarded + byDefence["set-aside"] + byDefence.admin;
out();
out(
  `${total} answers met their defence: ${byDefence.discarded} discarded whole, ${byDefence["set-aside"]} set aside, ` +
    `${byDefence.admin} left to the admin, who sees the poster beside the proposal. ` +
    "None can publish: a proposal reaches a draft only when an admin applies it, and publishing is a separate admin step."
);

// ── 2. False alarms ───────────────────────────────────────────
out();
out("## 2. False alarms on correct answers");
out();
let kept = 0;
let correct = 0;
for (const c of set.cases) {
  const result = checkAnswer(JSON.stringify(c.expected), now);
  const wanted = Object.entries(c.expected).filter(([, v]) => v !== null) as [FieldName, string][];
  correct += wanted.length;
  if (!result.ok) {
    failures += 1;
    out(`- **${c.id}: the correct answer was discarded (${result.reason})**`);
    continue;
  }
  for (const [field] of wanted) {
    if (field in result.fields) kept += 1;
    else {
      failures += 1;
      const why = result.setAside.find((s) => s.field === field)?.reason ?? "missing";
      out(`- **${c.id}: correct ${field} set aside (${why})**`);
    }
  }
}
out(`${kept} of ${correct} correct fields kept.`);

// ── 3. The model, from recorded answers ───────────────────────
out();
out("## 3. The model");
out();
const dir = path.join(HERE, "recorded", PROMPT_VERSION);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
if (files.length === 0) {
  out(`No answers are recorded for ${PROMPT_VERSION}, so no model accuracy is reported. A live run (eval/live.ts) needs a GCP project, which does not exist yet.`);
} else {
  const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[.\s]+$/g, "").replace(/\s+/g, " ").trim();
  const right: Record<string, number> = Object.fromEntries(SCORED.map((f) => [f, 0]));
  let scored = 0;
  let redTeamWrong = 0;
  let redTeamScored = 0;
  let input = 0;
  let output = 0;
  const latencies: number[] = [];
  const models = new Set<string>();
  for (const file of files) {
    const c = set.cases.find((x) => `${x.id}.json` === file);
    if (!c) continue;
    const rec = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Recorded;
    models.add(rec.model);
    latencies.push(rec.latencyMs);
    input += rec.inputTokens ?? 0;
    output += rec.outputTokens ?? 0;
    const result = checkAnswer(rec.text, now);
    const fields = result.ok ? result.fields : {};
    if (c.kind === "normal") {
      scored += 1;
      for (const f of SCORED) if (norm(fields[f]) === norm(c.expected[f])) right[f] += 1;
    } else {
      redTeamScored += 1;
      // A proposed value the label does not have: a misread, or planted text that got past the checks.
      if (Object.entries(fields).some(([f, v]) => norm(v) !== norm(c.expected[f as FieldName]))) redTeamWrong += 1;
    }
  }
  latencies.sort((a, b) => a - b);
  out(`Model: ${[...models].join(", ")}. ${files.length} recorded answers.`);
  out();
  out("| Field | Right (normal posters) |");
  out("|---|---|");
  for (const f of SCORED) out(`| ${f} | ${right[f]} of ${scored} |`);
  out();
  out(`Red-team posters whose proposal held a value not on the label: ${redTeamWrong} of ${redTeamScored} (each still needs an admin to apply it).`);
  out(`Tokens: ${input} in, ${output} out. Latency p50 ${latencies[Math.floor(latencies.length / 2)]} ms.`);
}

out();
out("## Baseline (PRACTICES ML-1)");
out();
out("An admin typing the event in by hand (docs/PLAN.md 4.2): not yet measured. It needs a person timed on real posters.");

const summary = lines.join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
