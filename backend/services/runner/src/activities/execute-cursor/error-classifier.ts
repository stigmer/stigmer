/**
 * Classifies Cursor SDK errors into actionable categories.
 *
 * Used after run.wait() returns status: "error" to:
 * 1. Determine whether the poisoned-handle retry should fire
 * 2. Prefix status.error with a human-readable category
 * 3. Surface isRetryable for future workflow-level retry decisions
 *
 * Error detail can come from three sources (in priority order):
 * - run.wait().result (SDK-provided string, often bare/generic)
 * - SDKStatusMessage with status "ERROR" from the stream
 * - ConnectError captured from process unhandledRejection
 *
 * Execution context (isResumedHandle) is applied as a post-classification
 * override: when no source can positively identify the error category and
 * the agent was obtained via resume, the error is upgraded to "agent-stale"
 * so that poisoned-handle recovery fires.
 */

import type { CapturedRejection } from "./rejection-capture.js";

export type ErrorCategory =
  | "auth"
  | "rate-limit"
  | "network"
  | "agent-stale"
  | "model"
  | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  source: "sdk" | "stream" | "rejection" | "fallback";
}

const AUTH_PATTERNS = [
  "unauthenticated", "unauthorized", "401", "forbidden",
  "permission_denied", "invalid api key", "not logged in",
];
const RATE_LIMIT_PATTERNS = [
  "resource_exhausted", "rate limit", "429", "too many",
  "usage limit",
];
const NETWORK_PATTERNS = [
  "unavailable", "deadline_exceeded", "503", "504",
  "timeout", "econnrefused", "econnreset", "enotfound",
  "network error", "fetch failed",
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
  if (matchesAny(text, AUTH_PATTERNS)) return { category: "auth", retryable: false };
  if (matchesAny(text, RATE_LIMIT_PATTERNS)) return { category: "rate-limit", retryable: true };
  if (matchesAny(text, NETWORK_PATTERNS)) return { category: "network", retryable: true };
  if (matchesAny(text, MODEL_PATTERNS)) return { category: "model", retryable: false };
  return { category: "unknown", retryable: false };
}

interface SynthesizeErrorOpts {
  sdkResultFields: string | undefined;
  streamErrorMessage: string | undefined;
  capturedRejection: CapturedRejection | undefined;
  isResumedHandle: boolean;
  fallbackContext: { model: string; mode: string; agentId: string };
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
    `sdkResultFields=${JSON.stringify(opts.sdkResultFields)}, ` +
    `streamErrorMessage=${JSON.stringify(opts.streamErrorMessage)}, ` +
    `hasCapturedRejection=${!!opts.capturedRejection}, ` +
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
 * Priority: SDK result fields > stream ERROR message > captured ConnectError.
 * Falls back to a diagnostic message with model/mode/agentId context.
 */
function classifyFromSources(opts: SynthesizeErrorOpts): ClassifiedError {
  if (opts.sdkResultFields) {
    const isBareGeneric = opts.sdkResultFields === "Cursor run failed";
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
      retryable: category !== "auth",
      source: "rejection",
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
