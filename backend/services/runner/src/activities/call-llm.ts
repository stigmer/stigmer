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

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessageChunk } from "@langchain/core/messages";
import { z } from "zod";
import { ApplicationFailure } from "@temporalio/activity";
import { jsonSchemaToZod } from "../shared/json-schema-to-zod.js";

import {
  inferProvider,
  stripProviderPrefix,
  type LlmProvider,
} from "../shared/llm-proxy.js";
import { computeLlmCostMicros, ensureLoaded as ensurePricingLoaded } from "../shared/model-pricing.js";
import { resolveToApiModelId } from "../shared/model-registry.js";
import { buildChatModel } from "../shared/model-client.js";
import { checkDirectCredentials } from "../shared/llm-backend.js";
import { classifyModelCallError } from "../shared/model-error.js";

export interface LlmCallConfig {
  readonly model: string;
  readonly prompt: string;
  readonly system_prompt?: string;
  readonly response_schema?: Record<string, unknown>;
  readonly temperature?: number;
  readonly max_tokens?: number;
  /**
   * Author-declared call budget in seconds (proto: LlmCallTaskConfig.timeout,
   * 1-600). Bounds the provider request via buildChatModel's timeout seam;
   * a breach fails non-retryably with LLM_TIMEOUT (#686). The engine widens
   * the activity's startToClose to fit values above the default 5m.
   */
  readonly timeout?: number;
  /**
   * Schema-validation policy (proto: LlmCallTaskConfig.on_invalid). The
   * retry/fallback ORCHESTRATION lives in the workflow engine
   * (call-function.ts, mirroring call-agent.ts); this activity only reads
   * it to pick the failure channel: soft policies get a `parse_error`
   * result the engine can act on, the default throws LLM_SCHEMA_VALIDATION.
   */
  readonly on_invalid?: string;
  /** Engine-owned (see on_invalid); accepted here so config passes through. */
  readonly max_retries?: number;
  /** Engine-owned (see on_invalid); accepted here so config passes through. */
  readonly fallback_task?: string;
}

export interface LlmCallResult {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly result: unknown;
  readonly model: string;
  readonly provider: LlmProvider;
  readonly parse_error?: string;
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
 * The classification itself lives in the shared model-error module (also
 * used by the deep-agent harness); this wrapper translates its verdict into
 * Temporal failure types: retryable → plain Error (Temporal may retry),
 * non-retryable → ApplicationFailure with the classified code.
 *
 * ZodError stays here rather than in the shared classifier: schema
 * validation of structured output is this activity's concern (it built the
 * schema), not a model transport error.
 */
function classifyAndThrowLlmError(
  err: unknown,
  modelId: string,
  provider: LlmProvider,
  proxyMode: boolean,
): never {
  if (err instanceof z.ZodError) {
    const providerLabel = provider === "anthropic" ? "Anthropic" : "OpenAI";
    throw ApplicationFailure.nonRetryable(
      `Structured output from model "${modelId}" (${providerLabel}) did not match the expected schema. ` +
      `Validation errors: ${err.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      "LLM_SCHEMA_VALIDATION",
    );
  }

  // assumeModelCall: this catch only ever sees model invocation failures, so
  // the loose connection/timeout heuristics are safe (and preserve the
  // pre-migration behavior for undici transport errors).
  const classified = classifyModelCallError(err, { proxyMode, provider, modelId, assumeModelCall: true });
  if (classified) {
    if (classified.retryable) {
      throw new Error(classified.message);
    }
    throw ApplicationFailure.nonRetryable(classified.message, classified.code);
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const providerLabel = provider === "anthropic" ? "Anthropic" : "OpenAI";
  throw ApplicationFailure.nonRetryable(
    `LLM call failed for model "${modelId}" (${providerLabel}): ${rawMessage}`,
    "LLM_UNKNOWN_ERROR",
  );
}

/**
 * Matches the request-timeout errors the provider SDKs raise when
 * buildChatModel's timeout bound fires (OpenAI: APIConnectionTimeoutError
 * "Request timed out."; Anthropic mirrors the shape). Only consulted when
 * the task declared an explicit `timeout`, so the loose message match
 * cannot reclassify errors on unbudgeted calls.
 */
function isRequestTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "APIConnectionTimeoutError" || /timed?\s*out/i.test(err.message);
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

  // Direct mode (no proxy) requires a usable credential path — the provider's
  // own API key, or a configured model backend that authenticates itself
  // (vertex uses Google ADC; requiring an Anthropic key there would reject a
  // correctly-configured deployment). Validated here rather than in
  // buildChatModel so the shared module stays free of Temporal failure types.
  if (!proxyActive) {
    const missing = checkDirectCredentials(provider);
    if (missing !== null) {
      throw ApplicationFailure.nonRetryable(missing, "LLM_MISSING_API_KEY");
    }
  }

  // Anthropic requires an explicit maxTokens; preserve the 4096 default here
  // (buildChatModel intentionally imposes none). resolvedModel is already an
  // API id, so buildChatModel's resolve step is a no-op for it.
  //
  // maxRetries: 0 — Temporal owns retries for this activity (callProxy
  // retries up to 5x). LangChain's default retry loop underneath would
  // multiply that, and it also blind-retries schema-validation failures:
  // before this was pinned to 0, one non-conforming structured response
  // burned ~7 identical model calls before surfacing (#686).
  const { model } = await buildChatModel({
    modelName: resolvedModel,
    proxyEndpoint: proxyActive ? proxyEndpoint : undefined,
    stigmerToken: proxyActive ? stigmerToken : undefined,
    headerScope: { workflowExecutionId: executionId },
    temperature: config.temperature,
    maxTokens: provider === "anthropic" ? (config.max_tokens ?? 4096) : config.max_tokens,
    // The author's per-call budget rides the same seam as the operator's
    // STIGMER_LLM_REQUEST_TIMEOUT_MS (#468); an explicit value wins there.
    timeoutMs: config.timeout ? config.timeout * 1000 : undefined,
    maxRetries: 0,
  });

  const messages: (HumanMessage | SystemMessage)[] = [];
  if (config.system_prompt) {
    messages.push(new SystemMessage(config.system_prompt));
  }
  messages.push(new HumanMessage(config.prompt));

  // Soft schema-failure channel: when the engine will orchestrate
  // ON_INVALID_RETRY / ON_INVALID_FALLBACK, a validation miss is a signal
  // (parse_error result), not a failure — the engine re-prompts or
  // branches. ON_INVALID_FAIL (and unset) keeps the throwing contract.
  const softSchemaFailure =
    config.on_invalid === "ON_INVALID_RETRY" ||
    config.on_invalid === "ON_INVALID_FALLBACK";

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
    if (softSchemaFailure && err instanceof z.ZodError) {
      // Usage is unrecoverable here — the structured runnable throws
      // before exposing the raw response (same loss as the throwing path).
      result = {
        input_tokens: 0,
        output_tokens: 0,
        result: undefined,
        model: modelId,
        provider,
        parse_error: err.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; "),
      };
    } else if (config.timeout && isRequestTimeoutError(err)) {
      // The author declared this budget in the task config; breaching it is
      // a task failure they can catch, not a transient to retry — Temporal
      // re-running the same over-budget call 5x would multiply the wait.
      throw ApplicationFailure.nonRetryable(
        `LLM call for model "${modelId}" timed out after ${config.timeout}s (task timeout)`,
        "LLM_TIMEOUT",
        { timeoutSeconds: config.timeout },
      );
    } else {
      classifyAndThrowLlmError(err, modelId, provider, proxyActive);
    }
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
