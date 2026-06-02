/**
 * LLM proxy routing utilities — shared between ExecuteDeepAgent and
 * ClassifyToolApprovals (and any future LLM-calling activities).
 *
 * Responsibilities:
 * 1. Infer the LLM provider from a model name string (prefix heuristics).
 * 2. Construct the correct proxy base URL for each provider, matching the
 *    path pattern expected by stigmer-cloud's LlmProxyController:
 *      - Anthropic: {proxy}/v1/proxy/llm/anthropic
 *      - OpenAI:    {proxy}/v1/proxy/llm/openai/v1
 * 3. Build authorization and scope headers for proxy requests.
 *
 * These utilities mirror the Python agent-runner's `LLMConfig.build_llm_kwargs`
 * but as composable functions rather than a config class method.
 */

export type LlmProvider = "anthropic" | "openai";

/**
 * Provider-specific path suffixes appended to `STIGMER_PROXY_ENDPOINT`.
 *
 * OpenAI's SDK includes `/v1` in its default base URL (https://api.openai.com/v1),
 * so the proxy path includes it: `/v1/proxy/llm/openai/v1`.
 *
 * Anthropic's SDK does NOT include `/v1` in its base URL (https://api.anthropic.com),
 * so the proxy path omits it: `/v1/proxy/llm/anthropic`.
 */
const PROXY_PATHS: Readonly<Record<LlmProvider, string>> = {
  anthropic: "/v1/proxy/llm/anthropic",
  openai: "/v1/proxy/llm/openai/v1",
};

const OPENAI_PREFIXES = ["gpt", "o1", "o3", "o4", "chatgpt"] as const;

/**
 * Infer the LLM provider from a model name.
 *
 * Resolution order:
 * 1. Explicit prefix syntax: "provider:model-name" (e.g. "openai:gpt-4.1")
 * 2. Name prefix heuristics (claude → anthropic, gpt/o1/o3/o4 → openai)
 *
 * Throws if the provider cannot be determined — callers should not silently
 * fall back to a default provider when an unknown model is requested.
 */
export function inferProvider(modelName: string): LlmProvider {
  if (!modelName) {
    throw new Error("Model name is required but received an empty string");
  }

  const colonIdx = modelName.indexOf(":");
  if (colonIdx > 0 && colonIdx < modelName.length - 1) {
    const prefix = modelName.slice(0, colonIdx).toLowerCase();
    if (prefix === "anthropic" || prefix === "openai") {
      return prefix;
    }
  }

  const lower = modelName.toLowerCase();

  if (lower.startsWith("claude")) {
    return "anthropic";
  }

  for (const prefix of OPENAI_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return "openai";
    }
  }

  throw new Error(
    `Cannot determine LLM provider for model "${modelName}". ` +
    `Known prefixes: claude* (anthropic), gpt*/o1*/o3*/o4*/chatgpt* (openai). ` +
    `Use explicit prefix syntax "provider:model-name" for non-standard model names.`,
  );
}

/**
 * Strip an explicit "provider:" prefix from the model name, returning
 * just the model ID portion. If no explicit prefix is present, returns
 * the original name unchanged.
 */
export function stripProviderPrefix(modelName: string): string {
  const colonIdx = modelName.indexOf(":");
  if (colonIdx > 0 && colonIdx < modelName.length - 1) {
    const prefix = modelName.slice(0, colonIdx).toLowerCase();
    if (prefix === "anthropic" || prefix === "openai") {
      return modelName.slice(colonIdx + 1);
    }
  }
  return modelName;
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
  return `${base}${PROXY_PATHS[provider]}`;
}

/**
 * Build the HTTP headers for proxy-routed LLM requests.
 *
 * Always includes Bearer authorization. Optionally includes scope headers
 * used by the proxy for FGA authorization and billing attribution.
 */
export function buildProxyHeaders(
  token: string,
  options?: { executionId?: string; mcpServerId?: string; workflowExecutionId?: string },
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
  if (options?.workflowExecutionId) {
    headers["X-Stigmer-Workflow-Execution-Id"] = options.workflowExecutionId;
  }

  return headers;
}
