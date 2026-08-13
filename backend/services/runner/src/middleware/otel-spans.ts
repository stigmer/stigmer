/**
 * OpenTelemetry spans and metrics middleware for deep-agent execution.
 *
 * Creates stigmer.llm.call and stigmer.mcp.tool_call spans with
 * attributes matching the span schema inherited from the retired Go
 * workflow-runner (kept stable so dashboards survived the migration).
 * Also records metrics (histograms + counters) for aggregate dashboards.
 *
 * Graceful no-op when no TracerProvider/MeterProvider is configured.
 */

import type { StigmerMiddleware, OtelSpansConfig } from "./types.js";

const SPAN_LLM_CALL = "stigmer.llm.call";
const SPAN_MCP_TOOL = "stigmer.mcp.tool_call";

const ATTR_LLM_PROVIDER = "stigmer.llm.provider";
const ATTR_LLM_MODEL = "stigmer.llm.model";
const ATTR_LLM_INPUT_TOKENS = "stigmer.llm.input_tokens";
const ATTR_LLM_OUTPUT_TOKENS = "stigmer.llm.output_tokens";
const ATTR_MCP_TOOL_NAME = "stigmer.mcp.tool_name";
const ATTR_MCP_SERVER_NAME = "stigmer.mcp.server_name";

const METRIC_LLM_CALL_DURATION = "stigmer.llm.call.duration";
const METRIC_LLM_CALL_COUNT = "stigmer.llm.call.count";
const METRIC_LLM_TOKENS_INPUT = "stigmer.llm.tokens.input";
const METRIC_LLM_TOKENS_OUTPUT = "stigmer.llm.tokens.output";
const METRIC_MCP_TOOL_CALL_DURATION = "stigmer.mcp.tool_call.duration";
const METRIC_MCP_TOOL_CALL_COUNT = "stigmer.mcp.tool_call.count";

const TRACER_NAME = "stigmer-runner";
const METER_NAME = "stigmer-runner";

function inferProvider(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (lower.startsWith("claude")) return "anthropic";
  if (lower.startsWith("gpt") || lower.startsWith("o1") || lower.startsWith("o3") || lower.startsWith("o4")) return "openai";
  if (["qwen", "llama", "deepseek", "codellama", "mistral", "phi"].some(p => lower.startsWith(p))) return "ollama";
  return "unknown";
}

/**
 * Lazy OTel accessor. Returns null-object implementations when
 * @opentelemetry/api is not available or no provider is configured.
 */
async function getOtel() {
  try {
    const api = await import("@opentelemetry/api");
    return api;
  } catch {
    return null;
  }
}

export function createOtelSpansMiddleware(
  config: Partial<OtelSpansConfig> = {},
): StigmerMiddleware {
  const toolServerMap = config.toolServerMap ?? new Map();

  // Metric instruments are created lazily on first use
  let metricsInitialized = false;
  let llmCallDuration: { record(v: number, attrs?: Record<string, unknown>): void } | null = null;
  let llmCallCount: { add(v: number, attrs?: Record<string, unknown>): void } | null = null;
  let llmTokensInput: { add(v: number, attrs?: Record<string, unknown>): void } | null = null;
  let llmTokensOutput: { add(v: number, attrs?: Record<string, unknown>): void } | null = null;
  let mcpToolDuration: { record(v: number, attrs?: Record<string, unknown>): void } | null = null;
  let mcpToolCount: { add(v: number, attrs?: Record<string, unknown>): void } | null = null;

  async function ensureMetrics(): Promise<void> {
    if (metricsInitialized) return;
    metricsInitialized = true;

    const api = await getOtel();
    if (!api) return;

    try {
      const meter = api.metrics.getMeter(METER_NAME);
      llmCallDuration = meter.createHistogram(METRIC_LLM_CALL_DURATION, {
        unit: "ms",
        description: "Duration of LLM API calls in milliseconds",
      });
      llmCallCount = meter.createCounter(METRIC_LLM_CALL_COUNT, {
        description: "Total number of LLM API calls",
      });
      llmTokensInput = meter.createCounter(METRIC_LLM_TOKENS_INPUT, {
        unit: "{token}",
        description: "Total input tokens consumed across LLM calls",
      });
      llmTokensOutput = meter.createCounter(METRIC_LLM_TOKENS_OUTPUT, {
        unit: "{token}",
        description: "Total output tokens produced across LLM calls",
      });
      mcpToolDuration = meter.createHistogram(METRIC_MCP_TOOL_CALL_DURATION, {
        unit: "ms",
        description: "Duration of MCP tool calls in milliseconds",
      });
      mcpToolCount = meter.createCounter(METRIC_MCP_TOOL_CALL_COUNT, {
        description: "Total number of MCP tool calls",
      });
    } catch {
      // Metrics not available
    }
  }

  return {
    name: "OtelSpansMiddleware",

    async wrapModelCall(request, handler) {
      const api = await getOtel();
      await ensureMetrics();

      if (!api) return handler(request);

      const invocationParams = (request.model as { model?: string; model_name?: string }) ?? {};
      const modelName = invocationParams.model ?? invocationParams.model_name ?? "";
      const provider = inferProvider(modelName);

      const tracer = api.trace.getTracer(TRACER_NAME);
      const span = tracer.startSpan(SPAN_LLM_CALL, {
        attributes: {
          [ATTR_LLM_PROVIDER]: provider,
          [ATTR_LLM_MODEL]: modelName,
        },
      });

      const startTime = performance.now();
      try {
        const response = await api.context.with(
          api.trace.setSpan(api.context.active(), span),
          () => handler(request),
        );

        const elapsedMs = performance.now() - startTime;

        const usage = (response as unknown as {
          usage_metadata?: {
            input_tokens?: number;
            output_tokens?: number;
          };
        }).usage_metadata;

        const inputTokens = usage?.input_tokens ?? 0;
        const outputTokens = usage?.output_tokens ?? 0;

        if (inputTokens) span.setAttribute(ATTR_LLM_INPUT_TOKENS, inputTokens);
        if (outputTokens) span.setAttribute(ATTR_LLM_OUTPUT_TOKENS, outputTokens);
        span.end();

        const attrs = { [ATTR_LLM_PROVIDER]: provider, [ATTR_LLM_MODEL]: modelName };
        llmCallDuration?.record(elapsedMs, attrs);
        llmCallCount?.add(1, attrs);
        if (inputTokens) llmTokensInput?.add(inputTokens, attrs);
        if (outputTokens) llmTokensOutput?.add(outputTokens, attrs);

        return response;
      } catch (err) {
        span.setStatus({ code: api.SpanStatusCode.ERROR, message: String(err) });
        if (err instanceof Error) span.recordException(err);
        span.end();
        throw err;
      }
    },

    async wrapToolCall(request, handler) {
      const toolName = request.toolCall.name;
      const serverName = toolServerMap.get(toolName);

      if (!serverName) return handler(request);

      const api = await getOtel();
      await ensureMetrics();

      if (!api) return handler(request);

      const tracer = api.trace.getTracer(TRACER_NAME);
      const span = tracer.startSpan(SPAN_MCP_TOOL, {
        attributes: {
          [ATTR_MCP_TOOL_NAME]: toolName,
          [ATTR_MCP_SERVER_NAME]: serverName,
        },
      });

      const startTime = performance.now();
      try {
        const result = await api.context.with(
          api.trace.setSpan(api.context.active(), span),
          () => handler(request),
        );

        const elapsedMs = performance.now() - startTime;
        span.end();

        const attrs = { [ATTR_MCP_TOOL_NAME]: toolName, [ATTR_MCP_SERVER_NAME]: serverName };
        mcpToolDuration?.record(elapsedMs, attrs);
        mcpToolCount?.add(1, attrs);

        return result;
      } catch (err) {
        span.setStatus({ code: api.SpanStatusCode.ERROR, message: String(err) });
        if (err instanceof Error) span.recordException(err);
        span.end();
        throw err;
      }
    },
  };
}
