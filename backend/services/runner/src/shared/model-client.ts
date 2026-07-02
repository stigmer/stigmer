/**
 * Single construction point for LangChain chat models in the runner.
 *
 * This is the only place that translates a Stigmer registry model ID
 * (dot-notation, e.g. "claude-haiku-4.5") into the provider's API model ID
 * (e.g. "claude-haiku-4-5-20251001") before a client is built — so no
 * activity can bypass the translation and 404 the provider.
 *
 * Layering: `llm-proxy.ts` stays pure routing utilities (no LangChain
 * dependency); this module is the LangChain-aware layer above it that owns
 * the resolve -> infer-provider -> strip-prefix -> proxy-wire -> construct
 * sequence that used to be copy-pasted across every LLM activity.
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
  /** The resolved id actually handed to the provider. */
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
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
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
