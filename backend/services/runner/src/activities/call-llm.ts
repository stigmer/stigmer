/**
 * CallLLM Temporal activity — executes LLM API calls for workflow
 * `call: llm` tasks.
 *
 * Supports two modes:
 * 1. Proxy mode (cloud): routes through Stigmer's LLM proxy
 * 2. Direct mode (OSS): uses API keys from environment
 *
 * Leverages shared/llm-proxy.ts for provider inference and proxy
 * URL resolution. Uses native fetch for API calls — lighter than
 * LangChain for simple prompt-response workflows.
 *
 * Activity contract:
 *   Name:   "CallLlm"
 *   Input:  (config: LlmCallConfig, runtimeEnv: Record<string, unknown>, executionId: string)
 *   Output: LlmCallResult
 */

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

async function callOpenAI(
  config: LlmCallConfig,
  modelId: string,
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<LlmCallResult> {
  const messages: { role: string; content: string }[] = [];

  if (config.system_prompt) {
    messages.push({ role: "system", content: config.system_prompt });
  }
  messages.push({ role: "user", content: config.prompt });

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
  };

  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.max_tokens !== undefined) body.max_tokens = config.max_tokens;
  if (config.response_schema) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OpenAI API returned ${response.status}: ${errorText.slice(0, 500)}`,
    );
  }

  const json = await response.json() as Record<string, unknown>;
  const usage = json.usage as Record<string, number> | undefined;
  const choices = json.choices as { message: { content: string } }[] | undefined;
  const textContent = choices?.[0]?.message?.content ?? "";

  const { result, parseError } = parseResultContent(textContent, config.response_schema);

  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    result,
    model: modelId,
    provider: "openai",
    ...(parseError ? { parse_error: parseError } : {}),
  };
}

async function callAnthropic(
  config: LlmCallConfig,
  modelId: string,
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<LlmCallResult> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: config.max_tokens ?? 4096,
    messages: [{ role: "user", content: config.prompt }],
  };

  if (config.system_prompt) body.system = config.system_prompt;
  if (config.temperature !== undefined) body.temperature = config.temperature;

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Anthropic API returned ${response.status}: ${errorText.slice(0, 500)}`,
    );
  }

  const json = await response.json() as Record<string, unknown>;
  const usage = json.usage as Record<string, number> | undefined;
  const content = json.content as { type: string; text: string }[] | undefined;
  const textContent = content?.find(c => c.type === "text")?.text ?? "";

  const { result, parseError } = parseResultContent(textContent, config.response_schema);

  return {
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    result,
    model: modelId,
    provider: "anthropic",
    ...(parseError ? { parse_error: parseError } : {}),
  };
}

function parseResultContent(
  text: string,
  responseSchema: Record<string, unknown> | undefined,
): { result: unknown; parseError?: string } {
  if (!responseSchema) {
    return { result: text };
  }

  try {
    return { result: JSON.parse(text) };
  } catch {
    return {
      result: text,
      parseError: `Expected JSON response per schema, but content is not valid JSON`,
    };
  }
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
  const timeoutMs = (config.timeout ?? 60) * 1000;
  const callStart = Date.now();

  let result: LlmCallResult;

  const proxyEndpoint = process.env.STIGMER_PROXY_ENDPOINT;
  const stigmerToken = process.env.STIGMER_TOKEN;

  if (proxyEndpoint && stigmerToken) {
    const baseUrl = resolveProxyBaseUrl(proxyEndpoint, provider);
    const headers = buildProxyHeaders(stigmerToken, { executionId });

    if (provider === "openai") {
      result = await callOpenAI(config, modelId, baseUrl, headers, timeoutMs);
    } else {
      result = await callAnthropic(config, modelId, baseUrl, headers, timeoutMs);
    }
  } else if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set and no proxy configured");
    const headers = { Authorization: `Bearer ${apiKey}` };
    result = await callOpenAI(config, modelId, "https://api.openai.com/v1", headers, timeoutMs);
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set and no proxy configured");
    const headers = { "x-api-key": apiKey };
    result = await callAnthropic(config, modelId, "https://api.anthropic.com", headers, timeoutMs);
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
