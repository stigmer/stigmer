/**
 * The kind of a turn's ending, named once for both engines: the
 * `StigmerStopDetail` a failed or stopped turn carries beside its
 * `stop_cause`, so a client picks its words from data rather than from an
 * error's text.
 *
 * The built-in engine names a model failure by the classifier's stable code
 * (`model-error.ts`); the Claude engine by its SDK's typed assistant error,
 * then by the result's HTTP status. Both land on the same kinds here, and a
 * kind this table does not know degrades to `internal` (a fault of the
 * platform), never to the raw text.
 *
 * Who a model failure belongs to decides its surface: a failure of the
 * provider (a refused key, a busy provider, a model the key can't use) is
 * the engine's, stop cause `model_error`; the platform's own token refused
 * on a proxied call (a 401 or 403 with no organization-key sentinel) is the
 * platform's, stop cause `failed`, kind `internal` (stigmer#2151).
 *
 * A connected app (MCP server) that would not connect is named by the
 * failing server's slug on the error the MCP client raised: its
 * `serverName` field, or an `OAuthRequiredError`'s `serverSlug`. No text is
 * read.
 */

import type { SDKAssistantMessageError } from "@anthropic-ai/claude-agent-sdk";

import { causeChainOf } from "./error-chain.js";
import {
  ORGANIZATION_PROVIDER_KEY_SENTINEL,
  PROVIDER_KEY_REQUIRED_SENTINEL,
  classifyModelCallError,
  describeExecutionError,
  type ClassifiedModelError,
  type ModelErrorContext,
} from "./model-error.js";

/** The kinds of `StigmerStopDetail.kind` (`apis/ai/stigmer/agentic/session/v1/event_content.proto`). Wire vocabulary. */
export type StopKind =
  | "provider_key_rejected"
  | "provider_key_missing"
  | "provider_out_of_credit"
  | "provider_rate_limited"
  | "provider_overloaded"
  | "model_unavailable"
  | "provider_unreachable"
  | "request_rejected"
  | "cost_cap"
  | "tool_call_limit"
  | "stalled"
  | "operation_limit"
  | "workspace_busy"
  | "agent_setup"
  | "app_unreachable"
  | "app_needs_sign_in"
  | "internal"
  | "runner_lost";

/** What a turn's ending names: its kind, and the model or connected app involved. */
export interface StopDetail {
  readonly kind: StopKind;
  /** The model the turn called, for the model kinds. */
  readonly model?: string;
  /** The connected app's slug, for the app kinds. */
  readonly app?: string;
}

/** A model failure's kind, and whose it is: the provider's (`engine`) or the platform's (`internal`). */
export interface ModelStop {
  readonly surface: "engine" | "internal";
  readonly kind: StopKind;
}

/** The built-in engine's classifier codes, by kind. A code missing here is the platform's. */
const KIND_OF_CODE: Readonly<Record<string, StopKind>> = {
  LLM_PROVIDER_KEY_REQUIRED: "provider_key_missing",
  LLM_PROVIDER_BILLING: "provider_out_of_credit",
  LLM_BACKEND_CREDENTIALS: "provider_key_rejected",
  LLM_AUTHENTICATION_ERROR: "provider_key_rejected",
  LLM_PERMISSION_DENIED: "model_unavailable",
  LLM_MODEL_NOT_FOUND: "model_unavailable",
  LLM_BACKEND_MODEL_ROUTING: "model_unavailable",
  LLM_BAD_REQUEST: "request_rejected",
  LLM_UNPROCESSABLE_REQUEST: "request_rejected",
  LLM_API_ERROR: "request_rejected",
  LLM_RATE_LIMIT: "provider_rate_limited",
  LLM_PROVIDER_ERROR: "provider_overloaded",
  LLM_CONNECTION_TIMEOUT: "provider_unreachable",
  LLM_CONNECTION_ERROR: "provider_unreachable",
};

/** The codes a proxied call reports when the platform refused its own token (`model-error.ts`, the proxy-mode wording). */
const PLATFORM_REFUSAL_CODES: ReadonlySet<string> = new Set(["LLM_AUTHENTICATION_ERROR", "LLM_PERMISSION_DENIED"]);

/**
 * A classified model failure's kind (the built-in engine). `platformRefused`
 * is the classifier's own reading that a proxied call's 401 or 403 was the
 * platform's token, not the organization's key.
 */
export function modelStopOfClassified(classified: ClassifiedModelError): ModelStop {
  if (classified.platformRefused === true && PLATFORM_REFUSAL_CODES.has(classified.code)) return { surface: "internal", kind: "internal" };
  const kind = KIND_OF_CODE[classified.code];
  return kind === undefined ? { surface: "internal", kind: "internal" } : { surface: "engine", kind };
}

/** The Claude SDK's assistant-message error kinds, by kind. `unknown` is left to the result's HTTP status. */
const KIND_OF_SDK_ERROR: Readonly<Partial<Record<SDKAssistantMessageError, StopKind>>> = {
  authentication_failed: "provider_key_rejected",
  oauth_org_not_allowed: "provider_key_rejected",
  verification_required: "provider_key_rejected",
  cloud_credential_error: "provider_key_rejected",
  billing_error: "provider_out_of_credit",
  account_on_hold: "provider_out_of_credit",
  rate_limit: "provider_rate_limited",
  overloaded: "provider_overloaded",
  server_error: "provider_overloaded",
  model_not_found: "model_unavailable",
  invalid_request: "request_rejected",
  max_output_tokens: "request_rejected",
};

/** An HTTP status, by kind, as the built-in engine's `classifyByStatus` reads it. */
function kindOfStatus(status: number): StopKind | undefined {
  if (status === 401) return "provider_key_rejected";
  if (status === 402) return "provider_out_of_credit";
  if (status === 403 || status === 404) return "model_unavailable";
  if (status === 400 || status === 413 || status === 422) return "request_rejected";
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_overloaded";
  return undefined;
}

/** What the Claude engine reported about a failed model call. */
export interface ClaudeFailure {
  /** The last main-thread assistant message's typed error, when it carried one. */
  readonly sdkError?: SDKAssistantMessageError;
  /** The result's HTTP status from the provider, when it gave one. */
  readonly apiErrorStatus?: number | null;
  /** The failure's text: the cloud proxy's sentinels ride in it, as on the built-in engine. */
  readonly text: string;
  /** Whether the call went through the platform's model proxy. */
  readonly proxyMode: boolean;
}

/**
 * A Claude engine failure's kind, or undefined when it names no model
 * failure at all (an engine that stopped for its own reason). The proxy's
 * sentinels speak first, as in `classifyModelCallError`: a call refused for
 * want of a key is the missing key, and a refused key on a proxied call is
 * the organization's only when the proxy marked it so.
 */
export function modelStopOfClaude(failure: ClaudeFailure): ModelStop | undefined {
  if (failure.text.includes(PROVIDER_KEY_REQUIRED_SENTINEL)) return { surface: "engine", kind: "provider_key_missing" };
  const fromSdk = failure.sdkError === undefined ? undefined : KIND_OF_SDK_ERROR[failure.sdkError];
  const status = typeof failure.apiErrorStatus === "number" ? failure.apiErrorStatus : undefined;
  const kind = fromSdk ?? (status === undefined ? undefined : kindOfStatus(status));
  if (kind === undefined) return failure.sdkError === undefined && status === undefined ? undefined : { surface: "internal", kind: "internal" };
  const keyRefusal = kind === "provider_key_rejected" || (kind === "model_unavailable" && status === 403);
  if (keyRefusal && failure.proxyMode && !failure.text.includes(ORGANIZATION_PROVIDER_KEY_SENTINEL)) return { surface: "internal", kind: "internal" };
  return { surface: "engine", kind };
}

/**
 * The connected app a failure names, when it is an MCP server's connect
 * failure: the MCP client's error carries the server's name, an OAuth
 * challenge its slug. Undefined for every other failure.
 */
export function appStopOf(err: unknown): StopDetail | undefined {
  for (const link of causeChainOf(err)) {
    const slug = (link as { serverSlug?: unknown }).serverSlug;
    if (link.name === "OAuthRequiredError" && typeof slug === "string") return { kind: "app_needs_sign_in", app: slug };
  }
  for (const link of causeChainOf(err)) {
    const serverName = (link as { serverName?: unknown }).serverName;
    if (typeof serverName === "string" && serverName !== "") return { kind: "app_unreachable", app: serverName };
  }
  return undefined;
}

/** A thrown failure, settled: the surface its copy takes, its sentence, and its kind. */
export interface ThrownFailure {
  readonly surface: "engine" | "internal";
  readonly message: string;
  readonly stopDetail: StopDetail;
}

/**
 * An exception that escaped an engine's turn, settled the same way on both
 * engines: a connected app's connect failure names the app; a model failure
 * the classifier recognises is the provider's (`engine`, so the stop cause
 * reads `model_error`) unless it was the platform's own token; anything else
 * is the platform's fault. The sentence is `describeExecutionError`'s, as
 * before, so `status.error` keeps its bytes. `stopModel` is the model the
 * detail names, by the registry's own id (`registryIdOf`).
 */
export function settleThrown(err: unknown, ctx: ModelErrorContext, stopModel: string | undefined = ctx.modelId): ThrownFailure {
  const { errorType, errorMessage } = describeExecutionError(err, ctx);
  const message = `[${errorType}] ${errorMessage}`;
  const app = appStopOf(err);
  if (app !== undefined) return { surface: "internal", message, stopDetail: app };
  const classified = classifyModelCallError(err, ctx);
  if (classified === undefined) return { surface: "internal", message, stopDetail: { kind: "internal" } };
  const stop = modelStopOfClassified(classified);
  return { surface: stop.surface, message, stopDetail: stop.kind === "internal" ? { kind: "internal" } : withModel(stop.kind, stopModel) };
}

/** A detail naming the model when one is known. */
export function withModel(kind: StopKind, model: string | undefined): StopDetail {
  return model === undefined || model === "" ? { kind } : { kind, model };
}

const STOP_KINDS: ReadonlySet<string> = new Set<StopKind>([
  "provider_key_rejected",
  "provider_key_missing",
  "provider_out_of_credit",
  "provider_rate_limited",
  "provider_overloaded",
  "model_unavailable",
  "provider_unreachable",
  "request_rejected",
  "cost_cap",
  "tool_call_limit",
  "stalled",
  "operation_limit",
  "workspace_busy",
  "agent_setup",
  "app_unreachable",
  "app_needs_sign_in",
  "internal",
  "runner_lost",
]);

/** Whether a string is a kind of this vocabulary (a detail read from the agent host's pipe). */
export function isStopKind(value: string): value is StopKind {
  return STOP_KINDS.has(value);
}
