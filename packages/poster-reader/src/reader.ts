/**
 * One poster read: ask the model, check the answer, and describe the call
 * (docs/PLAN.md 4.3 and 4.5, PRACTICES ML-7).
 *
 * The caller stores `call` whatever happened, so a day's latency, tokens and
 * cost can be totalled (scripts/day-cost.ts), and shows `result` to an admin.
 *
 * Each read is also an OpenTelemetry span carrying the GenAI semantic
 * convention attributes. CONFIGURED, not WIRED: nothing registers an
 * OpenTelemetry SDK or exporter yet, so today the span is a no-op. Sending
 * spans to Cloud Trace is Phase 5.
 */
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { checkAnswer, type CheckResult } from "./check";
import { callCost } from "./config";
import { PROMPT_VERSION } from "./fields";
import { ModelError, type PosterModel } from "./model";

export type CallOutcome = "OK" | "INVALID" | "ERROR";

export interface CallRecord {
  feature: "poster.read";
  model: string;
  promptVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** US dollars, to six places; null when no price is configured. */
  costUsd: string | null;
  outcome: CallOutcome;
  errorKind: string | null;
}

export interface ReadResult {
  call: CallRecord;
  /** Present when the model answered; `ok: false` when the answer was discarded. */
  result: CheckResult | null;
  /** For the admin when there is no result. */
  error: string | null;
}

const tracer = trace.getTracer("@ride/poster-reader");

/** Today in South Africa (UTC+2 all year), for posters that print no year. */
export function sastToday(now: Date): string {
  return new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

export async function readPoster(input: {
  model: PosterModel;
  image: Uint8Array;
  mimeType: string;
  now?: Date;
  price?: { inputPerMillion: number; outputPerMillion: number } | null;
  clock?: () => number;
}): Promise<ReadResult> {
  const now = input.now ?? new Date();
  const clock = input.clock ?? (() => performance.now());

  return tracer.startActiveSpan("poster.read", async (span) => {
    span.setAttributes({
      "gen_ai.operation.name": "generate_content",
      "gen_ai.system": "vertex_ai",
      "gen_ai.request.model": input.model.name,
      "ride.prompt.version": PROMPT_VERSION,
    });
    const started = clock();
    const call: CallRecord = {
      feature: "poster.read",
      model: input.model.name,
      promptVersion: PROMPT_VERSION,
      latencyMs: 0,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      outcome: "ERROR",
      errorKind: null,
    };
    try {
      const answer = await input.model.answer(input.image, input.mimeType, sastToday(now));
      call.latencyMs = Math.round(clock() - started);
      call.model = answer.model;
      call.inputTokens = answer.inputTokens;
      call.outputTokens = answer.outputTokens;
      call.costUsd = callCost(input.price ?? null, answer.inputTokens, answer.outputTokens);
      const result = checkAnswer(answer.text, now);
      call.outcome = result.ok ? "OK" : "INVALID";
      span.setAttributes({
        "gen_ai.response.model": answer.model,
        ...(answer.inputTokens !== null ? { "gen_ai.usage.input_tokens": answer.inputTokens } : {}),
        ...(answer.outputTokens !== null ? { "gen_ai.usage.output_tokens": answer.outputTokens } : {}),
        "ride.poster.outcome": call.outcome,
        "ride.poster.set_aside": result.ok ? result.setAside.length : 0,
      });
      return { call, result, error: result.ok ? null : result.reason };
    } catch (error) {
      call.latencyMs = Math.round(clock() - started);
      call.errorKind = error instanceof ModelError ? error.kind : "unexpected";
      span.setStatus({ code: SpanStatusCode.ERROR, message: call.errorKind });
      return { call, result: null, error: error instanceof ModelError ? error.message : "The poster could not be read" };
    } finally {
      span.end();
    }
  });
}
