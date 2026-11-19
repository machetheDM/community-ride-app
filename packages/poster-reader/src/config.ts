/**
 * The poster reader's switch (docs/PLAN.md 4.4, PRACTICES ML-4).
 *
 * Off unless every setting is present: POSTER_READER_ENABLED=true, and a GCP
 * project, a Vertex AI location and a model name. There are no defaults for
 * the last three. A default model name or region would be a guess written into
 * code, and which region serves Gemini closest to South Africa is still to be
 * confirmed (ADR 0008). When it is off, the portal shows the manual event form
 * only, which is how every event is made today.
 *
 * Prices are optional. Without them every call still records its tokens, and
 * its cost is left empty rather than estimated from a number nobody checked.
 */
export type ReaderConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      project: string;
      location: string;
      model: string;
      /** US dollars per million input and output tokens, when configured. */
      price: { inputPerMillion: number; outputPerMillion: number } | null;
    };

const NAME = /^[a-z0-9][a-z0-9.\-_]{1,62}$/;

export function readerConfig(env: Record<string, string | undefined> = process.env): ReaderConfig {
  if (env.POSTER_READER_ENABLED !== "true") return { enabled: false, reason: "Poster reading is switched off" };
  const project = env.POSTER_READER_GCP_PROJECT?.trim() ?? "";
  const location = env.POSTER_READER_LOCATION?.trim() ?? "";
  const model = env.POSTER_READER_MODEL?.trim() ?? "";
  for (const [setting, value] of [
    ["POSTER_READER_GCP_PROJECT", project],
    ["POSTER_READER_LOCATION", location],
    ["POSTER_READER_MODEL", model],
  ] as const) {
    if (!NAME.test(value)) return { enabled: false, reason: `Poster reading is on, but ${setting} is not set` };
  }
  const input = Number(env.POSTER_READER_PRICE_INPUT_PER_MTOK);
  const output = Number(env.POSTER_READER_PRICE_OUTPUT_PER_MTOK);
  const price =
    env.POSTER_READER_PRICE_INPUT_PER_MTOK && env.POSTER_READER_PRICE_OUTPUT_PER_MTOK && input >= 0 && output >= 0
      ? { inputPerMillion: input, outputPerMillion: output }
      : null;
  return { enabled: true, project, location, model, price };
}

/** Dollars for one call, to six places, or null when no price is configured. */
export function callCost(
  price: { inputPerMillion: number; outputPerMillion: number } | null,
  inputTokens: number | null,
  outputTokens: number | null
): string | null {
  if (!price || inputTokens === null || outputTokens === null) return null;
  const dollars = (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000;
  return dollars.toFixed(6);
}
