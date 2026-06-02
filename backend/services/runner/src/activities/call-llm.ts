/**
 * CallLLM Temporal activity — executes LLM API calls for workflow
 * `call: llm` tasks.
 *
 * Uses LangChain ChatModel with streaming for proxy metering compatibility.
 * Supports structured output via `withStructuredOutput()` when a
 * `response_schema` is provided.
 *
 * Supports two modes:
 * 1. Proxy mode (cloud): routes through Stigmer's LLM proxy
 * 2. Direct mode (OSS): uses API keys from environment
 *
 * Activity contract:
 *   Name:   "CallLlm"
 *   Input:  (config: LlmCallConfig, runtimeEnv: Record<string, unknown>, executionId: string)
 *   Output: LlmCallResult
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessageChunk } from "@langchain/core/messages";
import { z } from "zod";
import { ApplicationFailure } from "@temporalio/activity";
import { jsonSchemaToZod } from "../shared/json-schema-to-zod.js";

import {
  inferProvider,
  stripProviderPrefix,
  resolveProxyBaseUrl,
  buildProxyHeaders,
  type LlmProvider,
} from "../shared/llm-proxy.js";
import { computeLlmCostMicros, ensureLoaded as ensurePricingLoaded } from "../shared/model-pricing.js";
import { resolveToApiModelId } from "../shared/model-registry.js";

export interface LlmCallConfig {
  readonly model: string;
  readonly prompt: string;
  readonly system_prompt?: string;
  readonly response_schema?: Record<string, unknown>;
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly timeout?: number;
}

export interface LlmCallResult {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly result: unknown;
  readonly model: string;
  readonly provider: LlmProvider;
  readonly parse_error?: string;
}

function constructModel(
  provider: LlmProvider,
  modelId: string,
  config: LlmCallConfig,
  baseUrl?: string,
  headers?: Record<string, string>,
): BaseChatModel {
  if (provider === "openai") {
    const apiKey = baseUrl
      ? (headers?.Authorization?.replace("Bearer ", "") ?? "proxy-managed")
      : (process.env.OPENAI_API_KEY ?? "");

    return new ChatOpenAI({
      model: modelId,
      temperature: config.temperature ?? 0,
      maxTokens: config.max_tokens,
      ...(baseUrl || headers
        ? {
            configuration: {
              ...(baseUrl ? { baseURL: baseUrl } : {}),
              ...(headers ? { defaultHeaders: headers } : {}),
            },
          }
        : {}),
      apiKey,
    });
  }

  const apiKey = baseUrl
    ? (headers?.Authorization?.replace("Bearer ", "") ?? "proxy-managed")
    : (process.env.ANTHROPIC_API_KEY ?? "");

  return new ChatAnthropic({
    model: modelId,
    temperature: config.temperature ?? 0,
    maxTokens: config.max_tokens ?? 4096,
    ...(baseUrl || headers
      ? {
          clientOptions: {
            ...(baseUrl ? { baseURL: baseUrl } : {}),
            ...(headers ? { defaultHeaders: headers } : {}),
          },
        }
      : {}),
    apiKey,
  });
}

/**
 * Stream a chat model invocation and collect the response.
 *
 * Streaming ensures the proxy's SSE usage extractors can meter the
 * request properly. The full response is collected from chunks.
 */
async function streamAndCollect(
  model: BaseChatModel,
  messages: (HumanMessage | SystemMessage)[],
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const stream = await model.stream(messages);

  let content = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const messageChunk = chunk as BaseMessageChunk;
    if (typeof messageChunk.content === "string") {
      content += messageChunk.content;
    }

    // Usage is split across stream chunks: Anthropic reports input_tokens in
    // the message_start chunk and the (cumulative) output_tokens in the
    // message_delta chunk — which also carries input_tokens: 0. Take the max
    // per field so a later zero never clobbers an earlier non-zero count, and
    // so cumulative output totals are preserved. (OpenAI reports both in a
    // single final chunk, where max is equivalent.)
    const usage = (messageChunk as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
    if (usage) {
      if (typeof usage.input_tokens === "number") {
        inputTokens = Math.max(inputTokens, usage.input_tokens);
      }
      if (typeof usage.output_tokens === "number") {
        outputTokens = Math.max(outputTokens, usage.output_tokens);
      }
    }
  }

  return { content, inputTokens, outputTokens };
}

/**
 * Classify an LLM call error and re-throw as a Temporal ApplicationFailure
 * with correct retryability semantics and a user-facing message.
 *
 * Both OpenAI and Anthropic SDKs throw typed error subclasses of APIError
 * with a `.status` property. We duck-type on `.status` to avoid importing
 * either SDK's error classes directly.
 *
 * Retryability policy:
 *   - 4xx (except 429): nonRetryable — client/config errors won't self-heal
 *   - 429: nonRetryable at Temporal level — the SDK already retries internally
 *          with exponential backoff; Temporal retrying on top causes duplicates
 *   - 5xx: retryable — transient provider outages
 *   - Connection/timeout: retryable — transient network issues
 *   - ZodError: nonRetryable — schema mismatch won't self-heal
 */
function classifyAndThrowLlmError(
  err: unknown,
  modelId: string,
  provider: LlmProvider,
): never {
  const status = typeof (err as { status?: unknown }).status === "number"
    ? (err as { status: number }).status
    : undefined;

  const rawMessage = err instanceof Error ? err.message : String(err);
  const providerLabel = provider === "anthropic" ? "Anthropic" : "OpenAI";

  if (err instanceof z.ZodError) {
    throw ApplicationFailure.nonRetryable(
      `Structured output from model "${modelId}" (${providerLabel}) did not match the expected schema. ` +
      `Validation errors: ${err.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "LLM_SCHEMA_VALIDATION",
    );
  }

  if (status !== undefined) {
    const context = `model "${modelId}" (${providerLabel})`;

    switch (status) {
      case 401:
        throw ApplicationFailure.nonRetryable(
          `Authentication failed for ${context}. Check that your API key is valid and not expired.`,
          "LLM_AUTHENTICATION_ERROR",
        );
      case 403:
        throw ApplicationFailure.nonRetryable(
          `Access denied for ${context}. Verify that your API key has permission to use this model.`,
          "LLM_PERMISSION_DENIED",
        );
      case 404:
        throw ApplicationFailure.nonRetryable(
          `Model not found: ${context}. Verify the model name is correct and available in your account.`,
          "LLM_MODEL_NOT_FOUND",
        );
      case 400:
        throw ApplicationFailure.nonRetryable(
          `Invalid request to ${context}: ${rawMessage}`,
          "LLM_BAD_REQUEST",
        );
      case 422:
        throw ApplicationFailure.nonRetryable(
          `Unprocessable request to ${context}: ${rawMessage}`,
          "LLM_UNPROCESSABLE_REQUEST",
        );
      case 429:
        throw ApplicationFailure.nonRetryable(
          `Rate limit exceeded for ${context}. The provider's built-in retry was exhausted. ` +
          `Try again later or reduce request frequency.`,
          "LLM_RATE_LIMIT",
        );
      default:
        if (status >= 500) {
          throw new Error(
            `${providerLabel} provider error (HTTP ${status}) for ${context}: ${rawMessage}`,
          );
        }
        throw ApplicationFailure.nonRetryable(
          `${providerLabel} API error (HTTP ${status}) for ${context}: ${rawMessage}`,
          "LLM_API_ERROR",
        );
    }
  }

  const errName = err instanceof Error ? err.constructor.name : "";
  if (errName.includes("Timeout") || errName.includes("ConnectionTimeout")) {
    throw new Error(
      `Connection timed out for model "${modelId}" (${providerLabel}): ${rawMessage}`,
    );
  }
  if (errName.includes("Connection")) {
    throw new Error(
      `Connection failed for model "${modelId}" (${providerLabel}): ${rawMessage}`,
    );
  }

  throw ApplicationFailure.nonRetryable(
    `LLM call failed for model "${modelId}" (${providerLabel}): ${rawMessage}`,
    "LLM_UNKNOWN_ERROR",
  );
}

export async function callLlmAction(
  config: LlmCallConfig,
  runtimeEnv: Record<string, unknown>,
  executionId: string,
): Promise<LlmCallResult> {
  if (!config.model) {
    throw new Error("LLM call requires 'model' in config");
  }
  if (!config.prompt) {
    throw new Error("LLM call requires 'prompt' in config");
  }

  const resolvedModel = await resolveToApiModelId(config.model);
  const provider = inferProvider(resolvedModel);
  const modelId = stripProviderPrefix(resolvedModel);
  const callStart = Date.now();

  await ensurePricingLoaded().catch(() => {});

  const proxyEndpoint = process.env.STIGMER_PROXY_ENDPOINT;
  const stigmerToken = process.env.STIGMER_TOKEN;
  const proxyActive = !!(proxyEndpoint && stigmerToken);

  console.log(
    `[call-llm] model=${modelId} provider=${provider} proxy=${proxyActive} ` +
    `structured=${!!config.response_schema} execution=${executionId}`,
  );

  let baseUrl: string | undefined;
  let headers: Record<string, string> | undefined;

  if (proxyActive) {
    baseUrl = resolveProxyBaseUrl(proxyEndpoint!, provider);
    headers = buildProxyHeaders(stigmerToken!, { workflowExecutionId: executionId });
  } else if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw ApplicationFailure.nonRetryable(
        `OPENAI_API_KEY is not set and no proxy is configured. ` +
        `Set the API key in your environment or connect to a Stigmer Cloud deployment.`,
        "LLM_MISSING_API_KEY",
      );
    }
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw ApplicationFailure.nonRetryable(
        `ANTHROPIC_API_KEY is not set and no proxy is configured. ` +
        `Set the API key in your environment or connect to a Stigmer Cloud deployment.`,
        "LLM_MISSING_API_KEY",
      );
    }
  }

  const model = constructModel(provider, modelId, config, baseUrl, headers);

  const messages: (HumanMessage | SystemMessage)[] = [];
  if (config.system_prompt) {
    messages.push(new SystemMessage(config.system_prompt));
  }
  messages.push(new HumanMessage(config.prompt));

  let result: LlmCallResult;

  try {
    if (config.response_schema) {
      const zodSchema = jsonSchemaToZod(config.response_schema);
      const structured = model.withStructuredOutput(zodSchema, { includeRaw: true });
      const response = await structured.invoke(messages);

      const rawUsage = (response.raw as unknown as {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      }).usage_metadata;

      result = {
        input_tokens: rawUsage?.input_tokens ?? 0,
        output_tokens: rawUsage?.output_tokens ?? 0,
        result: response.parsed,
        model: modelId,
        provider,
      };
    } else {
      const { content, inputTokens, outputTokens } = await streamAndCollect(model, messages);

      result = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        result: content,
        model: modelId,
        provider,
      };
    }
  } catch (err) {
    classifyAndThrowLlmError(err, modelId, provider);
  }

  const costMicros = computeLlmCostMicros(config.model, result.input_tokens, result.output_tokens);
  const enrichedResult = costMicros > 0
    ? { ...result, __stigmer_cost_micros: costMicros }
    : result;

  recordLlmMetrics(Date.now() - callStart, result);
  return enrichedResult as LlmCallResult;
}

async function recordLlmMetrics(durationMs: number, result: LlmCallResult): Promise<void> {
  try {
    const { getInstruments } = await import("../otel-metrics.js");
    const mi = await getInstruments();
    const attrs = {
      "stigmer.llm.provider": result.provider,
      "stigmer.llm.model": result.model,
    };
    mi.llmCallDuration.record(durationMs, attrs);
    mi.llmCallCount.add(1, attrs);
    if (result.input_tokens) mi.llmTokensInput.add(result.input_tokens, attrs);
    if (result.output_tokens) mi.llmTokensOutput.add(result.output_tokens, attrs);
  } catch {
    // OTel not initialized — silently skip
  }
}

export function createCallLlmActivities() {
  return {
    CallLlm: async (
      config: LlmCallConfig,
      runtimeEnv: Record<string, unknown>,
      executionId: string,
    ): Promise<LlmCallResult> => {
      return callLlmAction(config, runtimeEnv, executionId);
    },
  };
}
