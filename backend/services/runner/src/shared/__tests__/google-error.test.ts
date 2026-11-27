/**
 * Google's failures, thrown as LangChain's Google client throws them (its
 * own `RequestError`, built from a `Response` with Google's error body), and
 * what the runner makes of each: whether it is tried again
 * (`model-retry.ts`) and what the person reads (`model-error.ts`).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { geminiError } from "@stigmer/test-support/llm-wire";

import { classifyModelCallError, ORGANIZATION_PROVIDER_KEY_SENTINEL } from "../model-error.js";
import { retryDecisionOf } from "../model-retry.js";
import { googleErrorOf, httpStatusOf } from "../google-error.js";
import { buildChatModel } from "../model-client.js";
import { _resetRegistryCache } from "../model-registry.js";
import { setRunnerSecret, resetRunnerSecretsForTests } from "../runner-credential-store.js";

beforeAll(async () => {
  _resetRegistryCache();
  setRunnerSecret("GEMINI_API_KEY", "test-key");
  // The registry answers empty, so the name passes through; Google answers 400.
  vi.stubGlobal("fetch", async (input: Request | string | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/model-registry")) return Response.json({ models: [] });
    return Response.json(geminiError(400, "INVALID_ARGUMENT", "refused"), { status: 400 });
  });
  try {
    const { model } = await buildChatModel({ modelName: "google:gemini-3-flash" });
    const raised = await model.invoke("Hello").then(() => undefined, (err: unknown) => err as Error);
    RequestError = raised?.constructor as unknown as typeof RequestError;
  } finally {
    vi.unstubAllGlobals();
  }
});

afterAll(() => {
  _resetRegistryCache();
  resetRunnerSecretsForTests();
});

/** The class the client raises for a Google answer, found by making the runner's Google model fail once. */
let RequestError: { fromResponse(response: Response): Promise<Error> };

/**
 * A fresh error of that class for an answer, as the client's handlers build
 * one (`RequestError.fromResponse`), before any retry hook has seen it.
 */
async function clientError(status: number, body: unknown, headers: Record<string, string> = {}): Promise<Error> {
  return RequestError.fromResponse(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));
}

const PER_MINUTE = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "You exceeded your current quota, please check your plan and billing details. Please retry in 31.2s.",
    details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "31s" },
    ],
  },
};

const PER_DAY = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "You exceeded your current quota, please check your plan and billing details.",
    details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
  },
};

const CONTEXT = { proxyMode: false, provider: "google" as const, modelId: "gemini-3-flash" };

describe("a Google failure", () => {
  it("reads its status from statusCode and its reason, limits and wait from the body", async () => {
    const err = await clientError(429, PER_MINUTE);

    expect(httpStatusOf(err)).toBe(429);
    expect(googleErrorOf(err)).toEqual({
      status: 429,
      rpcStatus: "RESOURCE_EXHAUSTED",
      reason: undefined,
      quotaIds: ["GenerateRequestsPerMinutePerProjectPerModel-FreeTier"],
      retryDelayMs: 31_000,
    });
  });

  it("a refused key stops at once and reads as the key's fault", async () => {
    const err = await clientError(400, geminiError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", "API_KEY_INVALID"));

    expect(retryDecisionOf(err).retry).toBe(false);
    expect(classifyModelCallError(err, CONTEXT)).toEqual({
      code: "LLM_AUTHENTICATION_ERROR",
      message: 'Google refused the API key (API_KEY_INVALID) for model "gemini-3-flash" (Google). Check that GEMINI_API_KEY holds a valid Gemini API key.',
    });
  });

  it("a per-minute limit waits the delay Google asks for, though Google words it as billing", async () => {
    const err = await clientError(429, PER_MINUTE);

    expect(retryDecisionOf(err)).toEqual({ retry: true, reason: "rate_limited", status: 429, retryAfterMs: 31_000 });
    expect(classifyModelCallError(err, CONTEXT)?.code).toBe("LLM_RATE_LIMIT");
  });

  it("a daily limit stops and reads as the key's quota", async () => {
    const err = await clientError(429, PER_DAY);

    expect(retryDecisionOf(err)).toEqual({ retry: false, reason: "quota", status: 429 });
    expect(classifyModelCallError(err, CONTEXT)?.code).toBe("LLM_PROVIDER_BILLING");
  });

  it("an overloaded model is retried and, once the retries are spent, reads as Google's server error", async () => {
    const err = await clientError(503, geminiError(503, "UNAVAILABLE", "The model is overloaded. Please try again later."));

    expect(retryDecisionOf(err)).toEqual({ retry: true, reason: "server_error", status: 503 });
    expect(classifyModelCallError(err, CONTEXT)).toMatchObject({ code: "LLM_PROVIDER_ERROR", message: expect.stringContaining("Google returned a server error (HTTP 503)") });
  });

  it("a retry-after header Google's relay sets wins over the body's delay", async () => {
    const err = await clientError(429, PER_MINUTE, { "retry-after": "5" });

    expect(retryDecisionOf(err)).toMatchObject({ retry: true, retryAfterMs: 5_000 });
  });
});

describe("a Google failure on an organization's own key", () => {
  const ORG = `(${ORGANIZATION_PROVIDER_KEY_SENTINEL})`;

  it("a refused key names the organization's key", async () => {
    const err = await clientError(400, geminiError(400, "INVALID_ARGUMENT", `API key not valid. ${ORG}`, "API_KEY_INVALID"));

    expect(classifyModelCallError(err, { ...CONTEXT, proxyMode: true })).toMatchObject({
      code: "LLM_AUTHENTICATION_ERROR",
      message: expect.stringContaining("Google refused your organization's own key (API_KEY_INVALID)"),
    });
  });

  it("a daily limit names the organization's key, not a passing rate limit", async () => {
    const body = { error: { ...PER_DAY.error, message: `${PER_DAY.error.message} ${ORG}` } };

    expect(classifyModelCallError(await clientError(429, body), { ...CONTEXT, proxyMode: true })).toMatchObject({
      code: "LLM_PROVIDER_BILLING",
      message: expect.stringContaining("Your organization's own Google key has used its daily quota"),
    });
  });
});

describe("what is not a Google failure", () => {
  it("a status with a body that carries no Google error", () => {
    expect(googleErrorOf(Object.assign(new Error("x"), { statusCode: 500, data: "Bad gateway" }))).toBeUndefined();
  });

  it("a status error with no headers decides by its status alone", () => {
    expect(retryDecisionOf(Object.assign(new Error("unavailable"), { statusCode: 503 }))).toEqual({ retry: true, reason: "server_error", status: 503 });
  });
});
