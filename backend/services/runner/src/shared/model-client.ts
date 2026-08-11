/**
 * Single construction point for LangChain chat models in the runner.
 *
 * This is the only place that translates a Stigmer registry model ID
 * (dot-notation, e.g. "claude-haiku-4.5") into the provider's API model ID
 * (e.g. "claude-haiku-4-5-20251001") before a client is built — so no
 * activity can bypass the translation and 404 the provider.
 *
 * Layering: `llm-proxy.ts` and `llm-backend.ts` stay pure routing utilities
 * (no LangChain dependency); this module is the LangChain-aware layer above
 * them that owns the resolve -> infer-provider -> strip-prefix ->
 * proxy-or-backend-wire -> construct sequence that used to be copy-pasted
 * across every LLM activity.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  inferProvider,
  stripProviderPrefix,
  resolveProxyBaseUrl,
  buildProxyHeaders,
  type LlmProvider,
} from "./llm-proxy.js";
import {
  resolveAnthropicBackend,
  checkVertexPrerequisites,
  checkBedrockPrerequisites,
  toVertexModelId,
  toBedrockModelId,
} from "./llm-backend.js";
import { resolveToApiModelId } from "./model-registry.js";

export interface BuildChatModelOptions {
  /** Registry id ("claude-haiku-4.5"), "provider:model", or a provider API id. */
  readonly modelName: string;
  /** When set, requests route through the Stigmer proxy at the provider path. */
  readonly proxyEndpoint?: string;
  readonly stigmerToken?: string;
  /** Scope headers for proxy FGA/billing attribution. */
  readonly headerScope?: {
    executionId?: string;
    mcpServerId?: string;
    workflowExecutionId?: string;
  };
  /** Defaults to 0. */
  readonly temperature?: number;
  /**
   * Pass-through only; intentionally no default. Anthropic requires a value,
   * but callers differ (setup omits it, call-llm uses 4096), so the default
   * stays the caller's decision to avoid silently changing behavior.
   */
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface BuiltChatModel {
  readonly model: BaseChatModel;
  readonly provider: LlmProvider;
  /**
   * The canonical provider API id the registry resolved to — what pricing
   * and usage metrics key on. A backend adapter may translate it for the
   * wire (Vertex separates the snapshot date with `@`), but the translated
   * form never leaves the adapter: this field stays canonical (the
   * canonical-id invariant in design decision 001-provider-backends).
   */
  readonly apiModelId: string;
}

/**
 * Build a configured chat model, resolving the registry id to a provider API
 * id first. The resolution MUST precede provider inference and prefix
 * stripping — that ordering is the invariant each per-site copy kept dropping,
 * surfacing as `404 model: claude-haiku-4.5` at the provider.
 */
export async function buildChatModel(opts: BuildChatModelOptions): Promise<BuiltChatModel> {
  const resolved = await resolveToApiModelId(opts.modelName);
  const provider = inferProvider(resolved);
  const apiModelId = stripProviderPrefix(resolved);

  // Backend precedence by construction: a proxied call never consults the
  // backend var — the proxy owns provider routing (the factories' preflight
  // warns when both are configured). Selection is deployment-static and read
  // here the same way provider API keys are, not plumbed through Config.
  const anthropicBackend =
    provider === "anthropic" && !opts.proxyEndpoint
      ? resolveAnthropicBackend()
      : "public";

  // Backend SDKs (and their auth subtrees: google-auth-library, AWS smithy)
  // load lazily so deployments that never configure a backend never
  // evaluate them — cheap cold starts stay cheap, and bundle-slim's CJS
  // output preserves exactly this deferred evaluation (see
  // scripts/bundle-slim.mjs). The factory is invoked lazily by
  // ChatAnthropic once per cached client (batch + streaming), so the class
  // is captured here, in async context.
  //
  // Each factory MUST honor options.maxRetries: LangChain owns retrying and
  // hands the factory maxRetries: 0 — a factory that drops it nests the
  // SDK's default 2 retries inside LangChain's retry loop, multiplying
  // every transient failure. Pinned by vertex-seam.test.ts and
  // bedrock-seam.test.ts. Prerequisites are re-checked here (not only in
  // the factories' preflight) so paths that construct models without a
  // runner factory still fail at dispatch with the catalog message instead
  // of mid-request. Credentials are read natively by each SDK from its
  // standard conventions (GCP: CLOUD_ML_REGION + ADC; AWS: AWS_REGION +
  // the credential chain / AWS_BEARER_TOKEN_BEDROCK).
  let backendCreateClient: ((options: { maxRetries?: number }) => unknown) | undefined;
  let wireModelId = apiModelId;
  let maxTokens = opts.maxTokens;
  if (anthropicBackend === "vertex") {
    const prereq = checkVertexPrerequisites();
    if (prereq !== null) throw new Error(prereq);
    const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
    backendCreateClient = (options) =>
      new AnthropicVertex({ maxRetries: options.maxRetries });
    wireModelId = toVertexModelId(apiModelId);
  } else if (anthropicBackend === "bedrock") {
    const prereq = checkBedrockPrerequisites();
    if (prereq !== null) throw new Error(prereq);
    const { AnthropicBedrock } = await import("@anthropic-ai/bedrock-sdk");
    backendCreateClient = (options) =>
      new AnthropicBedrock({ maxRetries: options.maxRetries });
    wireModelId = toBedrockModelId(apiModelId);
    if (maxTokens === undefined) {
      // LangChain's per-model maxTokens table prefix-matches the model
      // name. Vertex's translated ids still match their canonical prefix;
      // Bedrock's `anthropic.…` ids match nothing and silently fall back
      // to 4096 — a silent output cap. Probe the CANONICAL id with a
      // throwaway construction (pure field assignment, no I/O; the key is
      // never used) so bedrock inherits exactly the default the public API
      // and vertex get for the same model — including models the table
      // doesn't know yet, where all backends agree on the fallback.
      // Pinned by the canonical-parity test in bedrock-adapter.test.ts.
      maxTokens = new ChatAnthropic({ model: apiModelId, apiKey: "max-tokens-probe" }).maxTokens;
    }
  }

  const baseUrl = opts.proxyEndpoint
    ? resolveProxyBaseUrl(opts.proxyEndpoint, provider)
    : undefined;
  const headers = opts.proxyEndpoint && opts.stigmerToken
    ? buildProxyHeaders(opts.stigmerToken, opts.headerScope ?? {})
    : undefined;

  // Proxy mode authenticates with the Stigmer token; direct mode falls back to
  // the provider's own env-var key.
  const apiKey = opts.proxyEndpoint
    ? (opts.stigmerToken ?? "proxy-managed")
    : provider === "openai"
      ? (process.env.OPENAI_API_KEY ?? "")
      : (process.env.ANTHROPIC_API_KEY ?? "");

  const common = {
    temperature: opts.temperature ?? 0,
    apiKey,
    ...(maxTokens ? { maxTokens } : {}),
    ...(opts.timeoutMs ? { maxRetries: opts.maxRetries ?? 0, timeout: opts.timeoutMs } : {}),
  };

  // The two SDKs name the transport-override block differently (OpenAI:
  // `configuration`, Anthropic: `clientOptions`) — encapsulating that here is
  // the whole point, since the shape mismatch is where bugs used to hide.
  const model: BaseChatModel = provider === "openai"
    ? new ChatOpenAI({
        model: apiModelId,
        ...common,
        ...(baseUrl || headers
          ? {
              configuration: {
                ...(baseUrl ? { baseURL: baseUrl } : {}),
                ...(headers ? { defaultHeaders: headers } : {}),
              },
            }
          : {}),
      })
    : backendCreateClient
      ? // Backend adapter: the translated id is wire detail only — each
        // client moves it from the JSON body into its URL path. The waiver
        // in ChatAnthropic (an API key is not required when createClient is
        // provided) is what lets this construct with no ANTHROPIC_API_KEY.
        new ChatAnthropic({
          model: wireModelId,
          ...common,
          createClient: backendCreateClient,
        })
      : new ChatAnthropic({
          model: apiModelId,
          ...common,
          ...(baseUrl || headers
            ? {
                clientOptions: {
                  ...(baseUrl ? { baseURL: baseUrl } : {}),
                  ...(headers ? { defaultHeaders: headers } : {}),
                },
              }
            : {}),
        });

  return { model, provider, apiModelId };
}
