/**
 * The kind of a turn's ending, named once for both engines: every
 * classifier code of the built-in engine and every typed error of the Claude
 * engine lands on the kind a client picks its words from, a proxied call's
 * refused token is the platform's (stigmer#2151), a connected app's
 * connect failure names the app by the field the MCP client set, and a
 * checkpoint the platform refused as too large is a rejected request
 * (stigmer#3091).
 */

import { describe, expect, it } from "vitest";
import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";

import { ORGANIZATION_PROVIDER_KEY_SENTINEL, PROVIDER_KEY_REQUIRED_SENTINEL } from "../model-error.js";
import { CheckpointTooLargeError } from "../checkpointer/http-saver.js";
import { OAuthRequiredError } from "../mcp-oauth-detect.js";
import { appStopOf, isStopKind, modelStopOfClassified, modelStopOfClaude, settleThrown, type StopKind } from "../stop-kind.js";

function sdkError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe("modelStopOfClassified", () => {
  const cases: readonly (readonly [string, StopKind])[] = [
    ["LLM_PROVIDER_KEY_REQUIRED", "provider_key_missing"],
    ["LLM_PROVIDER_BILLING", "provider_out_of_credit"],
    ["LLM_BACKEND_CREDENTIALS", "provider_key_rejected"],
    ["LLM_AUTHENTICATION_ERROR", "provider_key_rejected"],
    ["LLM_PERMISSION_DENIED", "model_unavailable"],
    ["LLM_MODEL_NOT_FOUND", "model_unavailable"],
    ["LLM_BACKEND_MODEL_ROUTING", "model_unavailable"],
    ["LLM_BAD_REQUEST", "request_rejected"],
    ["LLM_UNPROCESSABLE_REQUEST", "request_rejected"],
    ["LLM_API_ERROR", "request_rejected"],
    ["LLM_RATE_LIMIT", "provider_rate_limited"],
    ["LLM_PROVIDER_ERROR", "provider_overloaded"],
    ["LLM_CONNECTION_TIMEOUT", "provider_unreachable"],
    ["LLM_CONNECTION_ERROR", "provider_unreachable"],
  ];

  it.each(cases)("names %s as the provider's %s", (code, kind) => {
    expect(modelStopOfClassified({ code, message: "m" })).toEqual({ surface: "engine", kind });
  });

  it("names a gateway that could not reach the provider as unreachable, not busy", () => {
    expect(modelStopOfClassified({ code: "LLM_PROVIDER_ERROR", message: "m" }, 502)).toEqual({ surface: "engine", kind: "provider_unreachable" });
    expect(modelStopOfClassified({ code: "LLM_PROVIDER_ERROR", message: "m" }, 504)).toEqual({ surface: "engine", kind: "provider_unreachable" });
    expect(modelStopOfClassified({ code: "LLM_PROVIDER_ERROR", message: "m" }, 529)).toEqual({ surface: "engine", kind: "provider_overloaded" });
    expect(settleThrown(sdkError(502, "the upstream could not be reached: socket hang up"), { proxyMode: true, provider: "anthropic", modelId: "m" }).stopDetail).toEqual({
      kind: "provider_unreachable",
      model: "m",
    });
  });

  it("names a code it does not know as the platform's fault", () => {
    expect(modelStopOfClassified({ code: "LLM_SOMETHING_NEW", message: "m" })).toEqual({ surface: "internal", kind: "internal" });
  });

  it("names the platform's own refused token as the platform's fault, not the organization's key", () => {
    expect(modelStopOfClassified({ code: "LLM_AUTHENTICATION_ERROR", message: "m", platformRefused: true })).toEqual({ surface: "internal", kind: "internal" });
    expect(modelStopOfClassified({ code: "LLM_PERMISSION_DENIED", message: "m", platformRefused: true })).toEqual({ surface: "internal", kind: "internal" });
  });
});

describe("settleThrown", () => {
  it("settles a direct call's refused key on the engine surface, naming the model", () => {
    const failure = settleThrown(sdkError(401, "invalid x-api-key"), { proxyMode: false, provider: "anthropic", modelId: "claude-sonnet-4-6" });
    expect(failure.surface).toBe("engine");
    expect(failure.stopDetail).toEqual({ kind: "provider_key_rejected", model: "claude-sonnet-4-6" });
    expect(failure.message).toMatch(/^\[LLM_AUTHENTICATION_ERROR\] /);
  });

  it("settles a proxied call's 401 as the platform's fault", () => {
    const failure = settleThrown(sdkError(401, "token expired"), { proxyMode: true, provider: "anthropic", modelId: "claude-sonnet-4-6" });
    expect(failure.surface).toBe("internal");
    expect(failure.stopDetail).toEqual({ kind: "internal" });
  });

  it("settles a proxied call the organization's key failed as the organization's", () => {
    const failure = settleThrown(sdkError(401, `${ORGANIZATION_PROVIDER_KEY_SENTINEL} invalid key`), { proxyMode: true, provider: "anthropic", modelId: "m" });
    expect(failure).toMatchObject({ surface: "engine", stopDetail: { kind: "provider_key_rejected", model: "m" } });
  });

  it("settles the proxy's missing-key refusal as the missing key", () => {
    const failure = settleThrown(sdkError(403, `${PROVIDER_KEY_REQUIRED_SENTINEL}`), { proxyMode: true, provider: "openai", modelId: "gpt-5" });
    expect(failure).toMatchObject({ surface: "engine", stopDetail: { kind: "provider_key_missing", model: "gpt-5" } });
  });

  it("settles a connected app's connect failure naming the app, before any model reading", () => {
    const err = Object.assign(new Error('Failed to connect to streamable HTTP server "issues"'), { serverName: "issues" });
    expect(settleThrown(err, { proxyMode: false })).toMatchObject({ surface: "internal", stopDetail: { kind: "app_unreachable", app: "issues" } });
  });

  it("settles a checkpoint refused as too large as a rejected request: start a new session, never Run again", () => {
    const failure = settleThrown(new CheckpointTooLargeError("Checkpoint PUT", 413), { proxyMode: true, provider: "anthropic", modelId: "claude-sonnet-4-6" });
    expect(failure.surface).toBe("engine");
    expect(failure.stopDetail).toEqual({ kind: "request_rejected", model: "claude-sonnet-4-6" });
    expect(failure.message).toMatch(/^\[CheckpointTooLargeError\] .*start a new session/i);
  });

  it("settles anything else as the platform's fault", () => {
    expect(settleThrown(new Error("ENOSPC: disk full"), { proxyMode: false })).toEqual({
      surface: "internal",
      message: "[Error] ENOSPC: disk full",
      stopDetail: { kind: "internal" },
    });
  });
});

describe("modelStopOfClaude", () => {
  const sdkCases: readonly (readonly [SDKAssistantMessageError, StopKind])[] = [
    ["authentication_failed", "provider_key_rejected"],
    ["oauth_org_not_allowed", "provider_key_rejected"],
    ["verification_required", "provider_key_rejected"],
    ["cloud_credential_error", "provider_key_rejected"],
    ["billing_error", "provider_out_of_credit"],
    ["account_on_hold", "provider_out_of_credit"],
    ["rate_limit", "provider_rate_limited"],
    ["overloaded", "provider_overloaded"],
    ["server_error", "provider_overloaded"],
    ["model_not_found", "model_unavailable"],
    ["invalid_request", "request_rejected"],
    ["max_output_tokens", "request_rejected"],
  ];

  it.each(sdkCases)("names the SDK's %s as %s", (sdkError, kind) => {
    expect(modelStopOfClaude({ sdkError, text: "API Error", proxyMode: false })).toEqual({ surface: "engine", kind });
  });

  it("reads every HTTP status the provider names when no SDK kind came", () => {
    const kindOf = (apiErrorStatus: number) => modelStopOfClaude({ apiErrorStatus, text: "x", proxyMode: false });
    expect(kindOf(401)).toEqual({ surface: "engine", kind: "provider_key_rejected" });
    expect(kindOf(402)).toEqual({ surface: "engine", kind: "provider_out_of_credit" });
    expect(kindOf(403)).toEqual({ surface: "engine", kind: "model_unavailable" });
    expect(kindOf(413)).toEqual({ surface: "engine", kind: "request_rejected" });
    expect(kindOf(429)).toEqual({ surface: "engine", kind: "provider_rate_limited" });
    expect(kindOf(503)).toEqual({ surface: "engine", kind: "provider_overloaded" });
    expect(kindOf(502)).toEqual({ surface: "engine", kind: "provider_unreachable" });
    expect(kindOf(418)).toEqual({ surface: "internal", kind: "internal" });
  });

  it("reads the HTTP status when the SDK's kind is unknown", () => {
    expect(modelStopOfClaude({ sdkError: "unknown", apiErrorStatus: 529, text: "overloaded", proxyMode: false })).toEqual({ surface: "engine", kind: "provider_overloaded" });
    expect(modelStopOfClaude({ apiErrorStatus: 404, text: "x", proxyMode: false })).toEqual({ surface: "engine", kind: "model_unavailable" });
  });

  it("names an unknown kind with no status as the platform's fault, and no signal at all as nothing", () => {
    expect(modelStopOfClaude({ sdkError: "unknown", text: "x", proxyMode: false })).toEqual({ surface: "internal", kind: "internal" });
    expect(modelStopOfClaude({ text: "The Claude Agent SDK failed: error_during_execution", proxyMode: false })).toBeUndefined();
  });

  it("names a proxied call's refused token as the platform's, and the organization's key only when the proxy marked it", () => {
    expect(modelStopOfClaude({ sdkError: "authentication_failed", text: "API Error: 401", proxyMode: true })).toEqual({ surface: "internal", kind: "internal" });
    expect(modelStopOfClaude({ sdkError: "authentication_failed", text: `API Error: 401 ${ORGANIZATION_PROVIDER_KEY_SENTINEL}`, proxyMode: true })).toEqual({
      surface: "engine",
      kind: "provider_key_rejected",
    });
  });

  it("names the proxy's missing-key refusal first", () => {
    expect(modelStopOfClaude({ sdkError: "authentication_failed", text: `API Error: 403 ${PROVIDER_KEY_REQUIRED_SENTINEL}`, proxyMode: true })).toEqual({
      surface: "engine",
      kind: "provider_key_missing",
    });
  });
});

describe("appStopOf", () => {
  it("names the app an OAuth challenge refused", () => {
    expect(appStopOf(new Error("wrapped", { cause: new OAuthRequiredError("crm") }))).toEqual({ kind: "app_needs_sign_in", app: "crm" });
  });

  it("names nothing for a failure that is not an app's", () => {
    expect(appStopOf(new Error("boom"))).toBeUndefined();
  });
});

describe("isStopKind", () => {
  it("knows the wire's kinds and nothing else", () => {
    expect(isStopKind("runner_lost")).toBe(true);
    expect(isStopKind("model_error")).toBe(false);
  });
});
