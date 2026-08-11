/**
 * Classifies Cursor SDK errors into actionable categories.
 *
 * Used after run.wait() returns status: "error" to:
 * 1. Determine whether the poisoned-handle retry should fire
 * 2. Prefix status.error with a human-readable category
 * 3. Surface isRetryable for future workflow-level retry decisions
 *
 * Error detail can come from several sources (in priority order):
 * - Structured fields, either from a thrown CursorSdkError or lifted from a
 *   structured run.wait() error value (highest fidelity)
 * - run.wait() error text (SDK-provided string, often bare/generic)
 * - SDKStatusMessage with status "ERROR" from the stream
 * - ConnectError captured from process unhandledRejection
 * - Text extracted from the failing run.conversation() turn
 *
 * Execution context (isResumedHandle) is applied as a post-classification
 * override: when no source can positively identify the error category and
 * the agent was obtained via resume, the error is upgraded to "agent-stale"
 * so that poisoned-handle recovery fires.
 */

import type { CapturedRejection } from "./rejection-capture.js";

export type ErrorCategory =
  | "auth"
  | "billing"
  | "rate-limit"
  | "network"
  | "agent-stale"
  | "model"
  | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  source: "sdk" | "stream" | "rejection" | "conversation" | "fallback";
}

/**
 * Structured fields lifted from a thrown CursorSdkError (errors.d.ts:
 * { code, status, isRetryable, cause, endpoint, requestId, operation }) or
 * from a structured run.wait() error value (see extractRunErrorSources).
 * Only the fields used for classification are retained.
 */
export interface SdkErrorFields {
  code?: string;
  status?: number;
  message?: string;
}

/**
 * What String() produces for any plain object. Carries zero signal, so it is
 * refused everywhere: extraction never emits it, and classifyFromSources
 * treats it as absent should any other producer leak it through.
 */
const OBJECT_JUNK_STRING = "[object Object]";

/**
 * Error detail lifted from a run.wait() result, split by fidelity: structured
 * values land in sdkError, plain text in sdkResultFields. At most one of the
 * two is set; both undefined means the result carried nothing usable and the
 * classifier's lower-priority sources should decide.
 */
export interface RunErrorSources {
  sdkError: SdkErrorFields | undefined;
  sdkResultFields: string | undefined;
}

const NO_RUN_ERROR_SOURCES: RunErrorSources = {
  sdkError: undefined,
  sdkResultFields: undefined,
};

/**
 * Lift error detail from a run.wait() result whose status is "error".
 *
 * The SDK types RunResult.result as `string`, but structured values (Error
 * instances, { code, message } objects) have been observed at runtime, both
 * in `result` and in the undeclared error/message/reason fields (oss#299).
 * A bare String() on those yields "[object Object]", which both destroys the
 * message users see and — worse — shadows the lower-priority classifier
 * sources (stream, rejection, conversation introspection) that often hold
 * the real reason.
 *
 * Walks the candidate fields in order and answers from the FIRST one that
 * yields usable content: strings keep flowing to the string channel
 * (sdkResultFields), structured values are lifted into the same structured
 * channel a thrown CursorSdkError uses (sdkError), and hopeless values are
 * skipped so a later candidate — or the classifier's fallback sources — can
 * win. (The previous `??` chain stopped at the first non-nullish value, so a
 * hopeless object or empty string hid usable text one field later.)
 *
 * Deliberately NO JSON.stringify fallback for unrecognized object shapes:
 * the error arm already logs the raw result in full server-side, and a JSON
 * blob shown to the user would shadow the introspection sources that exist
 * precisely to recover the real reason.
 */
export function extractRunErrorSources(result: unknown): RunErrorSources {
  if (result === null || typeof result !== "object") return NO_RUN_ERROR_SOURCES;
  const r = result as Record<string, unknown>;
  for (const candidate of [r.result, r.error, r.message, r.reason]) {
    const extracted = extractFromCandidate(candidate);
    if (extracted) return extracted;
  }
  return NO_RUN_ERROR_SOURCES;
}

function extractFromCandidate(v: unknown): RunErrorSources | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") {
    if (v.length === 0 || v === OBJECT_JUNK_STRING) return undefined;
    return { sdkError: undefined, sdkResultFields: v };
  }
  if (typeof v === "object") {
    // Covers Error instances too: their message (and, on SDK/Node error
    // shapes, code/status) are readable as plain properties.
    const o = v as Record<string, unknown>;
    const fields: SdkErrorFields = {};
    if (typeof o.code === "string" && o.code.length > 0) fields.code = o.code;
    if (typeof o.status === "number") fields.status = o.status;
    if (typeof o.message === "string" && o.message.length > 0) fields.message = o.message;
    if (fields.code !== undefined || fields.status !== undefined || fields.message !== undefined) {
      return { sdkError: fields, sdkResultFields: undefined };
    }
    return undefined;
  }
  // Remaining primitives (number, boolean, ...) stringify losslessly.
  const text = String(v);
  return text.length > 0 ? { sdkError: undefined, sdkResultFields: text } : undefined;
}

const AUTH_PATTERNS = [
  "unauthenticated", "unauthorized", "401", "forbidden",
  "permission_denied", "invalid api key", "not logged in",
];
// Billing/quota exhaustion is terminal, unlike a transient rate limit —
// retrying cannot succeed until someone adds credits. "usage limit" moved
// here from RATE_LIMIT_PATTERNS (it previously classified as retryable,
// which burned retries against an exhausted account). Includes the platform
// sentinel (see shared/model-error.ts) so a platform-attributed rewrite
// relayed through Cursor infrastructure is also diagnosed as billing.
const BILLING_PATTERNS = [
  "credit balance is too low", "insufficient_quota",
  "no credits remaining", "exceeded your current quota",
  "usage limit", "stigmer_platform_model_capacity",
];
const RATE_LIMIT_PATTERNS = [
  "resource_exhausted", "rate limit", "429", "too many",
];
const NETWORK_PATTERNS = [
  "unavailable", "deadline_exceeded", "503", "504",
  "timeout", "econnrefused", "econnreset", "enotfound",
  "network error", "fetch failed", "refused_stream",
];
const MODEL_PATTERNS = [
  "invalid model", "model not found", "model.*not available",
  "unsupported model",
];

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function classifyText(text: string): { category: ErrorCategory; retryable: boolean } {
  // Billing before auth/rate-limit: billing prose can carry "429" or quota
  // wording that would otherwise match the transient rate-limit patterns.
  if (matchesAny(text, BILLING_PATTERNS)) return { category: "billing", retryable: false };
  if (matchesAny(text, AUTH_PATTERNS)) return { category: "auth", retryable: false };
  if (matchesAny(text, RATE_LIMIT_PATTERNS)) return { category: "rate-limit", retryable: true };
  if (matchesAny(text, NETWORK_PATTERNS)) return { category: "network", retryable: true };
  if (matchesAny(text, MODEL_PATTERNS)) return { category: "model", retryable: false };
  return { category: "unknown", retryable: false };
}

interface SynthesizeErrorOpts {
  /** Structured fields from a thrown CursorSdkError — highest-fidelity source. */
  sdkError?: SdkErrorFields;
  sdkResultFields: string | undefined;
  streamErrorMessage: string | undefined;
  capturedRejection: CapturedRejection | undefined;
  /** Text extracted from the failing run.conversation() turn, if any. */
  conversationErrorText?: string;
  isResumedHandle: boolean;
  fallbackContext: { model: string; mode: string; agentId: string };
  /** Duration of the SDK run in ms — used for transport timeout heuristic. */
  durationMs?: number;
  /** Number of messages received from the stream (0 = no response at all). */
  messageCount?: number;
}

/**
 * Synthesize a classified error from up to three sources, then apply
 * execution context.
 *
 * Two-step process:
 * 1. Classify from the best available source (SDK > stream > rejection > fallback).
 * 2. Apply execution context: on resumed handles, "unknown" from any source
 *    is upgraded to "agent-stale" so poisoned-handle recovery can fire.
 *
 * The override only applies to "unknown" — specific diagnoses (auth,
 * rate-limit, network, model) are never overridden, even on resumed handles.
 */
export function synthesizeError(opts: SynthesizeErrorOpts): ClassifiedError {
  console.log(
    `[error-classifier] synthesizeError diagnostic: ` +
    `sdkError=${JSON.stringify(opts.sdkError)}, ` +
    `sdkResultFields=${JSON.stringify(opts.sdkResultFields)}, ` +
    `streamErrorMessage=${JSON.stringify(opts.streamErrorMessage)}, ` +
    `hasCapturedRejection=${!!opts.capturedRejection}, ` +
    `conversationErrorText=${JSON.stringify(opts.conversationErrorText)}, ` +
    `isResumedHandle=${opts.isResumedHandle}, ` +
    `model=${opts.fallbackContext.model}, mode=${opts.fallbackContext.mode}`,
  );

  const classified = classifyFromSources(opts);

  if (classified.category === "unknown" && opts.isResumedHandle) {
    return { ...classified, category: "agent-stale", retryable: true };
  }

  return classified;
}

/**
 * Classify from the best available error source.
 *
 * Priority: thrown CursorSdkError > SDK result fields > stream ERROR message >
 * captured ConnectError > conversation error turn > transport-timeout heuristic.
 * Falls back to a diagnostic message with model/mode/agentId context.
 */
function classifyFromSources(opts: SynthesizeErrorOpts): ClassifiedError {
  if (opts.sdkError) {
    const { code, status, message } = opts.sdkError;
    // Classify across all structured fields so a code/status alone (no message
    // text) still resolves a category.
    const text = [code, status != null ? String(status) : undefined, message]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(" ");
    if (text.trim().length > 0) {
      const { category, retryable } = classifyText(text);
      return {
        category,
        message: message ?? text,
        retryable,
        source: "sdk",
      };
    }
  }

  if (opts.sdkResultFields) {
    // "Cursor run failed" is the SDK's bare generic; "[object Object]" is
    // String()-coerced junk from any producer that bypassed the shape-aware
    // extraction. Neither carries signal — fall through to better sources.
    const isBareGeneric = opts.sdkResultFields === "Cursor run failed"
      || opts.sdkResultFields === OBJECT_JUNK_STRING;
    if (!isBareGeneric) {
      const { category, retryable } = classifyText(opts.sdkResultFields);
      return {
        category,
        message: opts.sdkResultFields,
        retryable,
        source: "sdk",
      };
    }
  }

  if (opts.streamErrorMessage) {
    const { category, retryable } = classifyText(opts.streamErrorMessage);
    return {
      category,
      message: opts.streamErrorMessage,
      retryable,
      source: "stream",
    };
  }

  if (opts.capturedRejection) {
    const { category } = classifyText(
      `${opts.capturedRejection.code} ${opts.capturedRejection.message}`,
    );
    return {
      category: category === "unknown" ? "network" : category,
      message: `[${opts.capturedRejection.code}] ${opts.capturedRejection.message}`,
      // Rejections default to retryable (transport flakes), except the two
      // terminal diagnoses that cannot self-heal on retry.
      retryable: category !== "auth" && category !== "billing",
      source: "rejection",
    };
  }

  // The SDK frequently swallows the real reason in run.wait() but retains it on
  // the failing conversation turn. Surface that text even when it does not match
  // a known pattern — a specific message beats the generic fallback.
  if (opts.conversationErrorText) {
    const { category, retryable } = classifyText(opts.conversationErrorText);
    return {
      category,
      message: opts.conversationErrorText,
      retryable,
      source: "conversation",
    };
  }

  // Transport timeout heuristic: SDK returned error with 0 messages and
  // duration ~30s (default SDK timeout). This indicates the proxy connection
  // was degraded and the agent stream could not be established at all.
  if (
    opts.messageCount === 0
    && opts.durationMs != null
    && opts.durationMs >= 25000
    && opts.durationMs <= 35000
    && !opts.isResumedHandle
  ) {
    const { model, mode, agentId } = opts.fallbackContext;
    return {
      category: "network",
      message: `Transport timeout (${opts.durationMs}ms, 0 messages received). Model=${model}, mode=${mode}, agentId=${agentId}`,
      retryable: true,
      source: "fallback",
    };
  }

  if (opts.isResumedHandle) {
    return {
      category: "agent-stale",
      message: "Cursor run failed (no detail from SDK, resumed agent handle may be stale)",
      retryable: true,
      source: "fallback",
    };
  }

  const { model, mode, agentId } = opts.fallbackContext;
  return {
    category: "unknown",
    message: `Cursor run failed (no detail from SDK). Model=${model}, mode=${mode}, agentId=${agentId}`,
    retryable: false,
    source: "fallback",
  };
}

export function formatClassifiedError(err: ClassifiedError): string {
  return `${err.message} [category=${err.category}, source=${err.source}, retryable=${err.retryable}]`;
}

export function shouldRetryWithFreshAgent(err: ClassifiedError): boolean {
  return err.category === "agent-stale" || err.category === "network";
}
