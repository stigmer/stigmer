/**
 * LLM proxy routing utilities — shared by every runner activity that calls
 * a model (ExecuteDeepAgent, session titling, structured extraction).
 *
 * Responsibilities:
 * 1. Infer the LLM provider from a model name string (prefix heuristics).
 * 2. Construct the correct proxy base URL for each provider, matching the
 *    path pattern expected by stigmer-cloud's LlmProxyController:
 *      - Anthropic: {proxy}/v1/proxy/llm/anthropic
 *      - OpenAI:    {proxy}/v1/proxy/llm/openai/v1
 *      - Google:    {proxy}/v1/proxy/llm/google
 * 3. Build authorization and scope headers for proxy requests.
 *
 * Every per-provider fact lives in one table, {@link LLM_PROVIDERS}, and
 * every other per-provider table in the runner is typed over
 * {@link LlmProvider}, so a provider added here is a compile error at each
 * site that must say something about it.
 *
 * These utilities mirror the Python agent-runner's `LLMConfig.build_llm_kwargs`
 * but as composable functions rather than a config class method.
 */

import { turnKeyHeader } from "./execution-context.js";

/** The providers the runner builds a chat model for; each is its own explicit prefix (`google:gemini-3-flash`). */
export type LlmProvider = "anthropic" | "openai" | "google";

/** What the runner knows about one provider. */
export interface LlmProviderRow {
  /**
   * The name prefixes a bare model id is placed by (`claude-sonnet-4-6`).
   * A bare id reaches the runner from a catalog row, which resolves to its
   * provider's API id (`model-registry.ts` `resolveToApiModelId`).
   */
  readonly namePrefixes: readonly string[];
  /**
   * The platform proxy's path for the provider, appended to
   * `STIGMER_PROXY_ENDPOINT`. Each is where the provider's client appends its
   * own API path: OpenAI's SDK includes `/v1` in its default base URL
   * (https://api.openai.com/v1), so its path does too; Anthropic's SDK does
   * not (https://api.anthropic.com); Google's client puts its API version
   * (`/v1beta`) after the endpoint itself.
   */
  readonly proxyPath: string;
  /** The variable the operator's direct-mode key is read from (`runner-credential-keys.ts` captures each at boot). */
  readonly keyVariable: string;
}

export const LLM_PROVIDERS: Readonly<Record<LlmProvider, LlmProviderRow>> = Object.freeze({
  anthropic: { namePrefixes: ["claude"], proxyPath: "/v1/proxy/llm/anthropic", keyVariable: "ANTHROPIC_API_KEY" },
  openai: { namePrefixes: ["gpt", "o1", "o3", "o4", "chatgpt"], proxyPath: "/v1/proxy/llm/openai/v1", keyVariable: "OPENAI_API_KEY" },
  google: { namePrefixes: ["gemini"], proxyPath: "/v1/proxy/llm/google", keyVariable: "GEMINI_API_KEY" },
});

const PROVIDER_NAMES = Object.keys(LLM_PROVIDERS) as LlmProvider[];

/** Whether `name` is a provider the runner builds a chat model for. */
export function isLlmProvider(name: string): name is LlmProvider {
  return Object.hasOwn(LLM_PROVIDERS, name);
}

/** The explicit prefix of a `provider:model` name, when it names a known provider. */
function explicitProviderOf(modelName: string): LlmProvider | undefined {
  const colonIdx = modelName.indexOf(":");
  if (colonIdx <= 0 || colonIdx >= modelName.length - 1) return undefined;
  const prefix = modelName.slice(0, colonIdx).toLowerCase();
  return isLlmProvider(prefix) ? prefix : undefined;
}

/**
 * Infer the LLM provider from a model name.
 *
 * Resolution order:
 * 1. Explicit prefix syntax: "provider:model-name" (e.g. "openai:gpt-4.1")
 * 2. Name prefix heuristics ({@link LLM_PROVIDERS}' `namePrefixes`)
 *
 * Throws if the provider cannot be determined — callers should not silently
 * fall back to a default provider when an unknown model is requested.
 */
export function inferProvider(modelName: string): LlmProvider {
  if (!modelName) {
    throw new Error("Model name is required but received an empty string");
  }

  const explicit = explicitProviderOf(modelName);
  if (explicit !== undefined) return explicit;

  const lower = modelName.toLowerCase();
  const placed = PROVIDER_NAMES.find((provider) => LLM_PROVIDERS[provider].namePrefixes.some((prefix) => lower.startsWith(prefix)));
  if (placed !== undefined) return placed;

  const known = PROVIDER_NAMES.map((provider) => `${LLM_PROVIDERS[provider].namePrefixes.map((prefix) => `${prefix}*`).join("/")} (${provider})`).join(", ");
  throw new Error(
    `Cannot determine LLM provider for model "${modelName}". ` +
    `Known prefixes: ${known}. ` +
    `Use explicit prefix syntax "provider:model-name" for non-standard model names.`,
  );
}

/**
 * {@link inferProvider}, returning null instead of throwing on an unknown
 * prefix. For credential pre-checks that must not preempt the construction
 * path: when the provider cannot be determined here, the caller proceeds and
 * lets `buildChatModel` raise inferProvider's precise message inside its own
 * error handling, instead of a guess being made up front.
 */
export function tryInferProvider(modelName: string): LlmProvider | null {
  try {
    return inferProvider(modelName);
  } catch {
    return null;
  }
}

/**
 * Strip an explicit "provider:" prefix from the model name, returning
 * just the model ID portion. If no explicit prefix is present, returns
 * the original name unchanged.
 */
export function stripProviderPrefix(modelName: string): string {
  return explicitProviderOf(modelName) === undefined ? modelName : modelName.slice(modelName.indexOf(":") + 1);
}

/**
 * Construct the proxy base URL for a given provider.
 *
 * The returned URL is what gets passed as `baseURL` / `clientOptions.baseURL`
 * to the LangChain model constructor. The LangChain SDK appends provider-
 * specific API paths (e.g. `/v1/messages` for Anthropic, `/chat/completions`
 * for OpenAI).
 *
 * Example:
 *   resolveProxyBaseUrl("https://api.stigmer.ai", "openai")
 *   → "https://api.stigmer.ai/v1/proxy/llm/openai/v1"
 */
export function resolveProxyBaseUrl(
  proxyEndpoint: string,
  provider: LlmProvider,
): string {
  const base = proxyEndpoint.replace(/\/+$/, "");
  return `${base}${LLM_PROVIDERS[provider].proxyPath}`;
}

/**
 * Build the HTTP headers for proxy-routed LLM requests.
 *
 * Always includes Bearer authorization. Optionally includes scope headers
 * used by the proxy for FGA authorization and billing attribution.
 */
export function buildProxyHeaders(
  token: string,
  options?: { executionId?: string; mcpServerId?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (options?.executionId) {
    headers["X-Stigmer-Execution-Id"] = options.executionId;
  }
  if (options?.mcpServerId) {
    headers["X-Stigmer-Mcp-Server-Id"] = options.mcpServerId;
  }

  // In the agent host: the turn's key, which the runner's local proxy checks
  // (`execution-context.ts`). Built inside the turn, so the client carries it.
  return { ...headers, ...turnKeyHeader() };
}
