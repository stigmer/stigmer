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

import {
  inferProvider,
  stripProviderPrefix,
  resolveProxyBaseUrl,
  buildProxyHeaders,
  type LlmProvider,
} from "../shared/llm-proxy.js";

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
 * Convert a JSON Schema to a Zod schema for use with `withStructuredOutput()`.
 *
 * Handles the subset of JSON Schema used by workflow output schemas:
 * object types with required fields, string/number/boolean/array primitives,
 * and enum constraints.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string | undefined;

  if (type === "object") {
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    const required = new Set(schema.required as string[] | undefined ?? []);

    if (!properties) return z.object({}).passthrough();

    const shape: Record<string, z.ZodType> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      let fieldType = jsonSchemaToZod(propSchema);
      if (!required.has(key)) {
        fieldType = fieldType.optional();
      }
      shape[key] = fieldType;
    }
    return z.object(shape).passthrough();
  }

  if (type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    return z.array(items ? jsonSchemaToZod(items) : z.unknown());
  }

  if (type === "string") {
    const enumValues = schema.enum as string[] | undefined;
    if (enumValues && enumValues.length > 0) {
      return z.enum(enumValues as [string, ...string[]]);
    }
    return z.string();
  }

  if (type === "number" || type === "integer") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "null") return z.null();

  return z.unknown();
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

    const usage = messageChunk.usage_metadata;
    if (usage) {
      inputTokens = usage.input_tokens ?? inputTokens;
      outputTokens = usage.output_tokens ?? outputTokens;
    }
  }

  return { content, inputTokens, outputTokens };
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

  const provider = inferProvider(config.model);
  const modelId = stripProviderPrefix(config.model);
  const callStart = Date.now();

  const proxyEndpoint = process.env.STIGMER_PROXY_ENDPOINT;
  const stigmerToken = process.env.STIGMER_TOKEN;

  let baseUrl: string | undefined;
  let headers: Record<string, string> | undefined;

  if (proxyEndpoint && stigmerToken) {
    baseUrl = resolveProxyBaseUrl(proxyEndpoint, provider);
    headers = buildProxyHeaders(stigmerToken, { workflowExecutionId: executionId });
  } else if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set and no proxy configured");
  } else {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set and no proxy configured");
  }

  const model = constructModel(provider, modelId, config, baseUrl, headers);

  const messages: (HumanMessage | SystemMessage)[] = [];
  if (config.system_prompt) {
    messages.push(new SystemMessage(config.system_prompt));
  }
  messages.push(new HumanMessage(config.prompt));

  let result: LlmCallResult;

  if (config.response_schema) {
    const zodSchema = jsonSchemaToZod(config.response_schema);
    const structured = model.withStructuredOutput(zodSchema);
    const structuredResult = await structured.invoke(messages);

    result = {
      input_tokens: 0,
      output_tokens: 0,
      result: structuredResult,
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

  recordLlmMetrics(Date.now() - callStart, result);
  return result;
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
