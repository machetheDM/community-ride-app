/**
 * Where an answer comes from. Two sources share one shape:
 *
 *  - VertexGemini calls Gemini on Vertex AI (GCP only, ADR 0007). CONFIGURED,
 *    not WIRED: no GCP project exists yet, so it has never answered a real
 *    request. Its request is checked by a unit test against a stand-in fetch.
 *  - RecordedModel replays answers saved from a live run, keyed by the poster's
 *    SHA-256. The evaluation in CI and the tests use it; it never reaches the
 *    network.
 */
import { GoogleAuth } from "google-auth-library";
import { RESPONSE_SCHEMA } from "./fields";
import { SYSTEM_INSTRUCTION, userInstruction } from "./prompt";

export interface ModelAnswer {
  /** The model's text, expected to be JSON; check.ts decides what is used. */
  text: string;
  inputTokens: number | null;
  /** Output and thinking tokens together: both are billed as output. */
  outputTokens: number | null;
  model: string;
}

export interface PosterModel {
  readonly name: string;
  answer(image: Uint8Array, mimeType: string, today: string): Promise<ModelAnswer>;
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "timeout" | "http" | "blocked" | "empty" | "missing"
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Answers are short; this caps what one call can cost (OWASP LLM10). */
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 30_000;

export class VertexGemini implements PosterModel {
  readonly name: string;
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly settings: { project: string; location: string; model: string },
    deps: { getToken?: () => Promise<string>; fetch?: FetchLike } = {}
  ) {
    this.name = settings.model;
    // Application Default Credentials: on Cloud Run, the service's own account
    // (Workload Identity, no key file); on a laptop, `gcloud auth application-default login`.
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    this.getToken =
      deps.getToken ??
      (async () => {
        const token = await auth.getAccessToken();
        if (!token) throw new ModelError("No Google credentials were found", "auth");
        return token;
      });
    this.fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init));
  }

  endpoint(): string {
    const { project, location, model } = this.settings;
    const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  }

  async answer(image: Uint8Array, mimeType: string, today: string): Promise<ModelAnswer> {
    const token = await this.getToken();
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: Buffer.from(image).toString("base64") } },
            { text: userInstruction(today) },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    };

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = (error as Error).name === "TimeoutError" || (error as Error).name === "AbortError";
      throw new ModelError(timedOut ? "The model did not answer in 30 seconds" : "The model could not be reached", timedOut ? "timeout" : "http");
    }
    if (!res.ok) throw new ModelError(`The model answered HTTP ${res.status}`, "http");

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      modelVersion?: string;
    };
    const usage = json.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? null;
    const outputTokens = usage ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) : null;
    if (json.promptFeedback?.blockReason) throw new ModelError(`The model refused the poster (${json.promptFeedback.blockReason})`, "blocked");
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new ModelError(`The model gave no answer (${json.candidates?.[0]?.finishReason ?? "no reason given"})`, "empty");
    return { text, inputTokens, outputTokens, model: json.modelVersion ?? this.settings.model };
  }
}

/** Replays saved answers. An unknown poster is an error, never an invented answer. */
export class RecordedModel implements PosterModel {
  constructor(
    readonly name: string,
    private readonly answers: Map<string, ModelAnswer>,
    private readonly hash: (image: Uint8Array) => string
  ) {}

  async answer(image: Uint8Array): Promise<ModelAnswer> {
    const found = this.answers.get(this.hash(image));
    if (!found) throw new ModelError("No recorded answer for this poster", "missing");
    return found;
  }
}
