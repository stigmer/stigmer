/**
 * Real provider chat models whose transport records the request body and
 * refuses it, so a test can read exactly what a model would receive without
 * any network: the provider SDKs build the body, then this fetch keeps it
 * and answers 400, which neither the SDK nor langchain retries.
 *
 * What a wire test keeps is the part of the body that carries a schema
 * (`WIRE_SCHEMA_KEYS`); messages, sampling and token limits are other
 * tests' concern.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

/** The request-body keys a schema can travel in, across both providers. */
const WIRE_SCHEMA_KEYS = ["model", "tools", "tool_choice", "response_format", "output_config", "output_format", "parallel_tool_calls"] as const;

/** Captured request bodies, in the order they were sent. */
export type CapturedBodies = Array<Record<string, unknown>>;

function capturingFetch(sink: CapturedBodies): typeof fetch {
  return async (_input, init) => {
    sink.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "captured by the wire test" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  };
}

/** A real `ChatAnthropic` whose requests land in `sink`. */
export function capturingAnthropic(sink: CapturedBodies, model: string, thinking?: { type: "enabled"; budget_tokens: number }): ChatAnthropic {
  return new ChatAnthropic({
    model,
    apiKey: "wire-test",
    maxRetries: 0,
    ...(thinking ? { thinking } : {}),
    clientOptions: { fetch: capturingFetch(sink), maxRetries: 0 },
  });
}

/** A real `ChatOpenAI` whose requests land in `sink`; `baseURL` stands for an OpenAI-compatible endpoint. */
export function capturingOpenAI(sink: CapturedBodies, model: string, baseURL?: string): ChatOpenAI {
  return new ChatOpenAI({
    model,
    apiKey: "wire-test",
    maxRetries: 0,
    configuration: { fetch: capturingFetch(sink), maxRetries: 0, ...(baseURL ? { baseURL } : {}) },
  });
}

/** The schema-carrying part of a captured body. */
export function wireSchemaPart(body: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of WIRE_SCHEMA_KEYS) if (key in body) kept[key] = body[key];
  return kept;
}
