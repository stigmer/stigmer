/**
 * Model-call error unwrapping and classification, shared by every harness.
 *
 * Two problems this module solves (stigmer/stigmer#330):
 *
 * 1. LangChain wraps any error thrown inside a middleware-wrapped model call
 *    in `MiddlewareError`, so `err.constructor.name` reads "MiddlewareError"
 *    regardless of what actually failed. The wrapper preserves the original
 *    error on the standard `cause` property — `unwrapModelError` walks that
 *    chain back to the root SDK error (which carries `.status` and the
 *    provider's parsed body).
 *
 * 2. Raw provider error prose is wrong for the user in proxy mode: billing
 *    errors from the PLATFORM's provider account told customers to top up
 *    consoles they don't own. The cloud proxy rewrites those to a 503
 *    carrying PLATFORM_CAPACITY_SENTINEL (the contract lives in
 *    stigmer-cloud's PlatformProviderErrorClassifier and the DD at
 *    _projects/2026-08/20260801.02.provider-error-attribution/); this module
 *    is the runner-side half that recognizes the sentinel and, in direct
 *    (BYO-key) mode, attributes billing errors to the user's own account
 *    with actionable wording.
 *
 * Classification order is load-bearing: the sentinel check must precede
 * status mapping, otherwise the proxy's 503 would classify as a retryable
 * 5xx and waste Temporal retries against a dead platform account.
 */

import type { LlmProvider } from "./llm-proxy.js";

/**
 * Machine-readable code the cloud proxy embeds in rewritten platform-fault
 * error messages. The message text is the contract carrier — it is the one
 * field proven to survive provider SDK → LangChain → runner intact.
 * Duplicated in stigmer-cloud's PlatformProviderErrorClassifier.SENTINEL_CODE;
 * change both or neither.
 */
export const PLATFORM_CAPACITY_SENTINEL = "STIGMER_PLATFORM_MODEL_CAPACITY";

export interface ClassifiedModelError {
  /** Stable machine-readable code (doubles as the Temporal failure type). */
  readonly code: string;
  /** User-facing message; never raw provider prose in proxy mode. */
  readonly message: string;
  /** Temporal retry semantics: false = will not self-heal, fail fast. */
  readonly retryable: boolean;
}

export interface ModelErrorContext {
  /** True when model calls route through the Stigmer platform proxy. */
  readonly proxyMode: boolean;
  /** Provider, when the caller knows it — sharpens the message wording. */
  readonly provider?: LlmProvider;
  /** Model id, when the caller knows it. */
  readonly modelId?: string;
  /**
   * True when the caller's catch can only see model-call failures (e.g. the
   * call-llm activity). Enables the loose connection/timeout class-name
   * heuristics ("Timeout"/"Connection" substrings, catching undici transport
   * errors). Broad catch blocks (deep-agent, Cursor) must leave this false:
   * a WorkspaceLockTimeoutError is not a model connection timeout, and only
   * the SDKs' own APIConnection* class names are positive signal there.
   */
  readonly assumeModelCall?: boolean;
}

/**
 * Walk the `cause` chain to the root error. LangChain's MiddlewareError (and
 * anything else that chains causes) preserves the original SDK error there.
 * Depth-capped so a pathological cause cycle cannot spin forever.
 */
export function unwrapModelError(err: unknown): unknown {
  let current = err;
  for (let depth = 0; depth < 10; depth++) {
    if (current instanceof Error && current.cause instanceof Error) {
      current = current.cause;
    } else {
      return current;
    }
  }
  return current;
}

/**
 * Classify a model-call failure into a stable code with a user-facing
 * message, or return undefined when there is no positive signal that the
 * error came from a model call at all.
 *
 * The undefined arm matters for callers whose catch blocks see more than
 * model errors (the deep-agent activity wraps tools, MCP, and workspace
 * operations too): only positively-identified model errors get relabeled;
 * everything else keeps its own identity.
 */
export function classifyModelCallError(
  err: unknown,
  ctx: ModelErrorContext,
): ClassifiedModelError | undefined {
  const root = unwrapModelError(err);
  const message = root instanceof Error ? root.message : String(root);

  // 1. Platform sentinel — before status mapping (see module doc).
  if (message.includes(PLATFORM_CAPACITY_SENTINEL)) {
    return {
      code: "LLM_PLATFORM_CAPACITY",
      retryable: false,
      message: platformCapacityMessage(ctx),
    };
  }

  // 2. Provider billing prose. In direct mode this is the user's own
  //    account and the fix is theirs. In proxy mode these patterns should
  //    never appear (the proxy rewrites them), but a version-skewed proxy
  //    could still relay them — attribute to the platform, never tell a
  //    proxied customer to top up someone else's account.
  if (isProviderBillingMessage(message)) {
    if (ctx.proxyMode) {
      return {
        code: "LLM_PLATFORM_CAPACITY",
        retryable: false,
        message: platformCapacityMessage(ctx),
      };
    }
    return {
      code: "LLM_PROVIDER_BILLING",
      retryable: false,
      message:
        `Your ${ctx.provider ? providerLabel(ctx) : "model provider"} account is out of credits or over quota. ` +
        `Add credits to your provider account or switch to a different model. ` +
        `Provider message: ${message}`,
    };
  }

  // 3. HTTP status duck-typing. Both provider SDKs throw APIError subclasses
  //    exposing `.status`; duck-typing avoids importing either SDK's classes.
  const status = typeof (root as { status?: unknown }).status === "number"
    ? (root as { status: number }).status
    : undefined;
  if (status !== undefined) {
    return classifyByStatus(status, message, ctx);
  }

  // 4. Connection/timeout heuristics on the root error's class name. Strict
  //    (SDK class names only) unless the caller vouches that every error it
  //    sees is a model-call error — see ModelErrorContext.assumeModelCall.
  const errName = root instanceof Error ? root.constructor.name : "";
  const isTimeout = errName.includes("APIConnectionTimeout")
    || (ctx.assumeModelCall === true && errName.includes("Timeout"));
  if (isTimeout) {
    return {
      code: "LLM_CONNECTION_TIMEOUT",
      retryable: true,
      message: `Connection timed out for ${modelLabel(ctx)}: ${message}`,
    };
  }
  const isConnection = errName.includes("APIConnection")
    || (ctx.assumeModelCall === true && errName.includes("Connection"));
  if (isConnection) {
    return {
      code: "LLM_CONNECTION_ERROR",
      retryable: true,
      message: `Connection failed for ${modelLabel(ctx)}: ${message}`,
    };
  }

  return undefined;
}

/**
 * Retryability policy (unchanged from the original call-llm classifier):
 *   - 4xx (except 429): nonRetryable — client/config errors won't self-heal
 *   - 429: nonRetryable at the Temporal level — the SDK already retried
 *     internally with backoff; retrying on top causes duplicates
 *   - 5xx: retryable — transient provider outages
 */
function classifyByStatus(
  status: number,
  rawMessage: string,
  ctx: ModelErrorContext,
): ClassifiedModelError {
  const context = modelLabel(ctx);

  switch (status) {
    case 401:
      return {
        code: "LLM_AUTHENTICATION_ERROR",
        retryable: false,
        message: ctx.proxyMode
          ? `The Stigmer platform rejected this model call (authentication, HTTP 401) for ${context}. ` +
            `Your session token may have expired — retry the execution, and contact support if it persists.`
          : `Authentication failed for ${context}. Check that your API key is valid and not expired.`,
      };
    case 403:
      return {
        code: "LLM_PERMISSION_DENIED",
        retryable: false,
        message: ctx.proxyMode
          ? `The Stigmer platform denied this model call (authorization, HTTP 403) for ${context}. ` +
            `Verify this execution is permitted to use the model, and contact support if it persists.`
          : `Access denied for ${context}. Verify that your API key has permission to use this model.`,
      };
    case 404:
      return {
        code: "LLM_MODEL_NOT_FOUND",
        retryable: false,
        message: `Model not found: ${context}. Verify the model name is correct and available in your account.`,
      };
    case 400:
      return {
        code: "LLM_BAD_REQUEST",
        retryable: false,
        message: `Invalid request to ${context}: ${rawMessage}`,
      };
    case 422:
      return {
        code: "LLM_UNPROCESSABLE_REQUEST",
        retryable: false,
        message: `Unprocessable request to ${context}: ${rawMessage}`,
      };
    case 429:
      return {
        code: "LLM_RATE_LIMIT",
        retryable: false,
        message:
          `Rate limit exceeded for ${context}. The provider's built-in retry was exhausted. ` +
          `Try again later or reduce request frequency.`,
      };
    default:
      if (status >= 500) {
        return {
          code: "LLM_PROVIDER_ERROR",
          retryable: true,
          message: `${providerSubject(ctx)} returned a server error (HTTP ${status}) for ${context}: ${rawMessage}`,
        };
      }
      return {
        code: "LLM_API_ERROR",
        retryable: false,
        message: `${providerSubject(ctx)} returned an API error (HTTP ${status}) for ${context}: ${rawMessage}`,
      };
  }
}

/**
 * Describe an arbitrary activity failure for the execution's user-visible
 * error field: model-call errors get classified codes and messages; anything
 * else keeps the ROOT error's identity (never a wrapper's class name).
 */
export function describeExecutionError(
  err: unknown,
  ctx: ModelErrorContext,
): { errorType: string; errorMessage: string } {
  const classified = classifyModelCallError(err, ctx);
  if (classified) {
    return { errorType: classified.code, errorMessage: classified.message };
  }

  const root = unwrapModelError(err);
  return {
    errorType: root instanceof Error ? root.constructor.name : "UnknownError",
    errorMessage: root instanceof Error ? root.message : String(root),
  };
}

/**
 * Provider billing-exhaustion prose, matched against the raw message. Narrow
 * by design: these phrases are pinned to real provider wordings (Anthropic's
 * 400 billing prose; OpenAI's insufficient_quota / no-credits 429s). A miss
 * falls through to status classification — never worse than today.
 */
function isProviderBillingMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("credit balance is too low")
    || lower.includes("insufficient_quota")
    || lower.includes("exceeded your current quota")
    || lower.includes("no credits remaining")
  );
}

function platformCapacityMessage(ctx: ModelErrorContext): string {
  return (
    `The Stigmer platform's model capacity for ${providerLabel(ctx)} is temporarily unavailable. ` +
    `This is a platform-side issue — your organization's credits were not charged for this call. ` +
    `Please retry shortly, or contact support if it persists. [code: ${PLATFORM_CAPACITY_SENTINEL}]`
  );
}

function providerLabel(ctx: ModelErrorContext): string {
  if (ctx.provider === "anthropic") return "Anthropic";
  if (ctx.provider === "openai") return "OpenAI";
  return "the model provider";
}

/** Sentence-initial form: "Anthropic" / "The model provider". */
function providerSubject(ctx: ModelErrorContext): string {
  return ctx.provider ? providerLabel(ctx) : "The model provider";
}

function modelLabel(ctx: ModelErrorContext): string {
  if (ctx.modelId && ctx.provider) return `model "${ctx.modelId}" (${providerLabel(ctx)})`;
  if (ctx.modelId) return `model "${ctx.modelId}"`;
  if (ctx.provider) return `the model (${providerLabel(ctx)})`;
  return "the model";
}
