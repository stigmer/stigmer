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
import {
  parseAnthropicBackend,
  BACKEND_DOC_URL,
  BEDROCK_INFERENCE_PREFIX_ENV,
  FOUNDRY_DEPLOYMENT_MAP_ENV,
  FOUNDRY_RESOURCE_ENV,
  type AnthropicBackend,
} from "./llm-backend.js";

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
  const backend = resolveDirectBackend(ctx);

  // 1. Platform sentinel — before status mapping (see module doc).
  if (message.includes(PLATFORM_CAPACITY_SENTINEL)) {
    return {
      code: "LLM_PLATFORM_CAPACITY",
      retryable: false,
      message: platformCapacityMessage(ctx),
    };
  }

  // 1b. Backend credential acquisition — also before status mapping: these
  //     failures come from the auth library (thrown while adapting the
  //     request, usually with no HTTP status) and won't self-heal on retry.
  //     Raw, they read like library internals ("Could not load the default
  //     credentials"); the operator needs to hear "fix your cloud
  //     credentials".
  if (backend === "vertex" && isGoogleCredentialMessage(message)) {
    return {
      code: "LLM_BACKEND_CREDENTIALS",
      retryable: false,
      message:
        `The vertex backend could not acquire Google credentials for ${modelLabel(ctx)}. ` +
        `Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key, or run on a GCP ` +
        `identity (workload identity / metadata server). ANTHROPIC_VERTEX_PROJECT_ID is ` +
        `only needed when the credentials don't carry a project. See ${BACKEND_DOC_URL}. ` +
        `Underlying error: ${message}`,
    };
  }
  if (backend === "bedrock" && isAwsCredentialMessage(message)) {
    return {
      code: "LLM_BACKEND_CREDENTIALS",
      retryable: false,
      message:
        `The bedrock backend could not acquire AWS credentials for ${modelLabel(ctx)}. ` +
        `Provide credentials through the standard AWS chain (environment keys, an IAM ` +
        `role / IRSA, config files) or set AWS_BEARER_TOKEN_BEDROCK. See ${BACKEND_DOC_URL}. ` +
        `Underlying error: ${message}`,
    };
  }
  if (backend === "foundry" && isFoundryCredentialMessage(message)) {
    // Only the keyless Entra path can land here: API-key failures arrive
    // as HTTP 401s (status arm below), while a failing token provider
    // throws statusless from inside the Foundry SDK's authHeaders.
    return {
      code: "LLM_BACKEND_CREDENTIALS",
      retryable: false,
      message:
        `The foundry backend could not acquire a Microsoft Entra ID token for ${modelLabel(ctx)}. ` +
        `Give the runner an Azure identity the credential chain can resolve (workload ` +
        `identity / managed identity, service-principal env vars, or az login), or set ` +
        `ANTHROPIC_FOUNDRY_API_KEY to use API-key auth instead. See ${BACKEND_DOC_URL}. ` +
        `Underlying error: ${message}`,
    };
  }

  // 1c. Bedrock's inference-profile rejection — a config condition, not a
  //     bad request: newer Claude models cannot be invoked by bare model id
  //     (AWS lists their in-region endpoint as N/A). The operator remedy is
  //     one env var, so say exactly that instead of relaying AWS prose that
  //     talks about ARNs and provisioned throughput.
  if (backend === "bedrock" && isBedrockInferenceProfileMessage(message)) {
    return {
      code: "LLM_BACKEND_MODEL_ROUTING",
      retryable: false,
      message:
        `Bedrock requires an inference profile for ${modelLabel(ctx)} — the bare model ` +
        `id cannot be invoked on-demand. Set ${BEDROCK_INFERENCE_PREFIX_ENV} to your ` +
        `deployment's geography (e.g. "us", "eu", or "global"), or map this model ` +
        `explicitly in STIGMER_BEDROCK_MODEL_MAP. See ${BACKEND_DOC_URL}. ` +
        `Underlying error: ${message}`,
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
    return classifyByStatus(status, message, ctx, backend);
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
  backend: AnthropicBackend,
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
          // On a cloud backend the credential is a cloud identity — "check
          // your API key" would send the operator hunting for a key that
          // isn't in play.
          : backend === "vertex"
            ? `Google rejected this Vertex AI call (authentication, HTTP 401) for ${context}. ` +
              `The credentials are expired or not valid for this project — check ` +
              `GOOGLE_APPLICATION_CREDENTIALS or the runner's GCP identity. See ${BACKEND_DOC_URL}.`
          : backend === "bedrock"
            ? `AWS rejected this Bedrock call (authentication, HTTP 401) for ${context}. ` +
              `The credentials are expired or invalid — check the runner's AWS identity ` +
              `(environment keys, IAM role / IRSA) or AWS_BEARER_TOKEN_BEDROCK. See ${BACKEND_DOC_URL}.`
          : backend === "foundry"
            ? `Azure rejected this Microsoft Foundry call (authentication, HTTP 401) for ${context}. ` +
              `The credential is expired or not valid for this Foundry resource — check ` +
              `ANTHROPIC_FOUNDRY_API_KEY (find it on the deployment's Details tab) or the ` +
              `runner's Azure identity. See ${BACKEND_DOC_URL}.`
            : `Authentication failed for ${context}. Check that your API key is valid and not expired.`,
      };
    case 403:
      return {
        code: "LLM_PERMISSION_DENIED",
        retryable: false,
        message: ctx.proxyMode
          ? `The Stigmer platform denied this model call (authorization, HTTP 403) for ${context}. ` +
            `Verify this execution is permitted to use the model, and contact support if it persists.`
          : backend === "vertex"
            ? `Vertex AI denied this call (HTTP 403) for ${context}. Grant the runner's ` +
              `service account the "Vertex AI User" role (aiplatform.endpoints.predict) ` +
              `in the target project. See ${BACKEND_DOC_URL}.`
          : backend === "bedrock"
            // The most common Bedrock setup mistake: Anthropic models must
            // be enabled per account ("Model access" in the Bedrock console,
            // including the use-case submission), on top of IAM.
            ? `Bedrock denied this call (HTTP 403) for ${context}. Enable this Claude model ` +
              `under "Model access" in the Bedrock console (Anthropic models require a ` +
              `use-case submission), and grant the runner's identity bedrock:InvokeModel ` +
              `for the model and its inference profile. See ${BACKEND_DOC_URL}.`
          : backend === "foundry"
            ? `Microsoft Foundry denied this call (HTTP 403) for ${context}. Grant the ` +
              `runner's Azure identity the "Foundry User" (or "Cognitive Services User") ` +
              `RBAC role on the Foundry resource. See ${BACKEND_DOC_URL}.`
            : `Access denied for ${context}. Verify that your API key has permission to use this model.`,
      };
    case 404:
      return {
        code: "LLM_MODEL_NOT_FOUND",
        retryable: false,
        // The most common Vertex setup mistake: Claude models must be enabled
        // per project in Model Garden, and availability varies by region.
        message: backend === "vertex"
          ? `Model not found on Vertex AI: ${context}. Enable this Claude model for your ` +
            `project in the Vertex AI Model Garden, and confirm it is available in ` +
            `${describeVertexRegion()} — availability varies by region. See ${BACKEND_DOC_URL}.`
          : backend === "bedrock"
            ? `Model not found on Bedrock: ${context}. Confirm the model is available in ` +
              `${describeBedrockRegion()} — availability varies by region — and that the ` +
              `resolved Bedrock id is right for your deployment (STIGMER_BEDROCK_MODEL_MAP ` +
              `overrides, ${BEDROCK_INFERENCE_PREFIX_ENV} for inference profiles). See ${BACKEND_DOC_URL}.`
          : backend === "foundry"
            // The most common Foundry setup mistake: Foundry routes by
            // DEPLOYMENT NAME, and deployments are created one by one in
            // the portal — a model with no deployment (or a custom name)
            // 404s even though the model itself exists on Foundry.
            ? `Model deployment not found on Microsoft Foundry: ${context}. Foundry routes ` +
              `by deployment name — confirm a deployment for this model exists in ` +
              `${describeFoundryResource()} (default deployment names are the dateless ` +
              `model ids), or map it to your custom deployment name in ` +
              `${FOUNDRY_DEPLOYMENT_MAP_ENV}. See ${BACKEND_DOC_URL}.`
            : `Model not found: ${context}. Verify the model name is correct and available in your account.`,
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
 * The backend serving this direct-mode Anthropic call — the only condition
 * under which a backend's specific arms may speak. Proxied calls and other
 * providers read as "public" (no backend wording applies). The backend is
 * resolved from env here (deployment-static, like the API keys
 * model-client reads) rather than threaded through every activity's
 * ModelErrorContext; an invalid var value also reads as public, since
 * classification must never throw and invalid values are already fatal at
 * the factories' preflight and at model construction.
 */
function resolveDirectBackend(ctx: ModelErrorContext): AnthropicBackend {
  if (ctx.proxyMode || ctx.provider !== "anthropic") return "public";
  const parsed = parseAnthropicBackend();
  return parsed.ok ? parsed.backend : "public";
}

/**
 * Google credential-acquisition prose, matched against the raw message.
 * Narrow by design (mirrors isProviderBillingMessage): pinned to
 * google-auth-library's ADC failure, its project-detection failure, the
 * Vertex SDK's own projectId error, and OAuth's invalid_grant (expired or
 * revoked service-account key). A miss falls through to status
 * classification — never worse than the raw error.
 */
function isGoogleCredentialMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not load the default credentials")
    || lower.includes("unable to detect a project id")
    || lower.includes("no projectid was given")
    || lower.includes("invalid_grant")
  );
}

/**
 * AWS credential-acquisition prose, matched against the raw message.
 * Narrow by design (mirrors isGoogleCredentialMessage): pinned to the AWS
 * credential provider chain's terminal failure
 * (@aws-sdk/credential-providers' CredentialsProviderError wordings) and
 * the SigV4 signer's invalid-shape error. A miss falls through to status
 * classification — never worse than the raw error.
 */
function isAwsCredentialMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not load credentials from any providers")
    || lower.includes("credential is missing")
    || lower.includes("resolved credential object is not valid")
  );
}

/**
 * Bedrock's bare-model-id rejection prose (HTTP 400 ValidationException):
 * "Invocation of model ID … with on-demand throughput isn't supported.
 * Retry your request with the ID or ARN of an inference profile …".
 * Matched narrowly on the phrase that only this condition carries.
 */
function isBedrockInferenceProfileMessage(message: string): boolean {
  return message.toLowerCase().includes("on-demand throughput isn't supported");
}

/**
 * Entra ID token-acquisition prose, matched against the raw message.
 * Narrow by design (mirrors the Google/AWS matchers), and narrower than it
 * looks: the Foundry SDK wraps EVERY token-provider failure — whatever
 * @azure/identity's credential chain threw — in this one prefix before
 * rethrowing (pinned by foundry-seam.test.ts), so a single phrase covers
 * the whole family. A miss falls through to status classification — never
 * worse than the raw error.
 */
function isFoundryCredentialMessage(message: string): boolean {
  return message.toLowerCase().includes("failed to get token from azureadtokenprovider");
}

/** "region {value}" when CLOUD_ML_REGION is set, else a pointer to the var. */
function describeVertexRegion(): string {
  const region = process.env.CLOUD_ML_REGION?.trim();
  return region ? `region "${region}"` : "your CLOUD_ML_REGION";
}

/** "region {value}" when AWS_REGION is set, else a pointer to the var. */
function describeBedrockRegion(): string {
  const region = process.env.AWS_REGION?.trim();
  return region ? `region "${region}"` : "your AWS_REGION";
}

/** `resource "{value}"` when the resource var is set, else a generic label. */
function describeFoundryResource(): string {
  const resource = process.env[FOUNDRY_RESOURCE_ENV]?.trim();
  return resource ? `resource "${resource}"` : "your Foundry resource";
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
