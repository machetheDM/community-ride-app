/**
 * A live run of the evaluation set against Gemini on Vertex AI (docs/PLAN.md 4.6).
 * It costs money and needs Google credentials, so it is never run by CI and
 * asks for --yes:
 *
 *   gcloud auth application-default login
 *   $env:POSTER_READER_ENABLED = "true"
 *   $env:POSTER_READER_GCP_PROJECT = "<project>"
 *   $env:POSTER_READER_LOCATION = "<region>"
 *   $env:POSTER_READER_MODEL = "<model>"
 *   npm run eval:live -w @ride/poster-reader -- --yes
 *
 * Each answer is saved to eval/recorded/<prompt version>/<case>.json exactly as
 * the model gave it, with its tokens and latency. Commit them: CI then scores
 * the model from them (eval/run.ts) on every push, at no cost, until the prompt
 * version changes and a new live run is needed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readerConfig } from "../src/config";
import { PROMPT_VERSION } from "../src/fields";
import { VertexGemini } from "../src/model";
import { sastToday } from "../src/reader";

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("A live run calls a paid model once per poster. Run again with --yes.");
    process.exit(2);
  }
  const config = readerConfig();
  if (!config.enabled) {
    console.error(config.reason);
    process.exit(2);
  }
  const set = JSON.parse(readFileSync(path.join(__dirname, "cases.json"), "utf8")) as { evalDate: string; cases: { id: string }[] };
  // The labels assume the evaluation date as "today", so the model is told the same day.
  const today = sastToday(new Date(set.evalDate));
  const model = new VertexGemini(config);
  const dir = path.join(__dirname, "recorded", PROMPT_VERSION);
  mkdirSync(dir, { recursive: true });

  let input = 0;
  let output = 0;
  for (const c of set.cases) {
    const image = readFileSync(path.join(__dirname, "posters", `${c.id}.png`));
    const started = performance.now();
    try {
      const answer = await model.answer(image, "image/png", today);
      const latencyMs = Math.round(performance.now() - started);
      input += answer.inputTokens ?? 0;
      output += answer.outputTokens ?? 0;
      writeFileSync(
        path.join(dir, `${c.id}.json`),
        JSON.stringify({ model: answer.model, recordedAt: new Date().toISOString(), text: answer.text, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, latencyMs }, null, 2) + "\n"
      );
      console.log(`${c.id}: ${latencyMs} ms, ${answer.inputTokens} in, ${answer.outputTokens} out`);
    } catch (error) {
      console.error(`${c.id}: ${(error as Error).message}`);
    }
  }
  console.log(`\nRecorded into ${dir}. Tokens: ${input} in, ${output} out.`);
  if (config.price) {
    const dollars = (input * config.price.inputPerMillion + output * config.price.outputPerMillion) / 1_000_000;
    console.log(`Cost at the configured price: $${dollars.toFixed(4)}`);
  }
}

void main();
