/**
 * OpenTelemetry spans and metrics middleware for deep-agent execution: a
 * `chat {model}` span per model call and an `execute_tool {tool}` span per
 * tool call, in OpenTelemetry's GenAI conventions (`gen-ai-conventions.ts`),
 * so a tracing tool that reads them shows each call of a run with its
 * model, provider, tokens and, when the operator switches content on, its
 * text.
 *
 * Innermost in the stack (`middleware/index.ts`), so a span covers the call
 * itself: a held or denied tool call never reaches here and gets no span.
 * Every tool the graph executes gets one, the built-in ones (`task`,
 * `execute`, `read_file`, ...) as much as an MCP server's, which is an
 * `extension` tool with `mcp.method.name=tools/call`, one span per call.
 * A sub-agent runs inside its `task` call's span (`subagent-transformer.ts`
 * opens its `invoke_agent` span there), so its calls nest where they
 * happened; the sub-agent stacks carry this middleware too
 * (`subagent-wiring.ts`).
 *
 * The provider and model come from the facts `buildChatModel` recorded for
 * the request's model instance (`shared/model-facts.ts`), never from the
 * model's name, so one middleware serves the parent's graph and every
 * sub-agent's. Input tokens include cached ones, with the cache's reads
 * and writes beside them, as the conventions ask. The conversation's text
 * is set only with content on, and never shows more than the saved
 * conversation does (`shared/telemetry-content.ts`).
 *
 * Metrics keep the names and attributes the dashboards read (histograms
 * and counters, MCP tool counts MCP-only); the provider is now the real one.
 *
 * Graceful no-op when no TracerProvider/MeterProvider is configured.
 */

import { isGraphBubbleUp } from "@langchain/langgraph";
import type { Span } from "@opentelemetry/api";

import {
  ERROR_TYPE,
  GEN_AI_AGENT_NAME,
  GEN_AI_INPUT_MESSAGES,
  GEN_AI_OPERATION_NAME,
  GEN_AI_OUTPUT_MESSAGES,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_FINISH_REASONS,
  GEN_AI_RESPONSE_ID,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_SYSTEM_INSTRUCTIONS,
  GEN_AI_TOOL_CALL_ARGUMENTS,
  GEN_AI_TOOL_CALL_ID,
  GEN_AI_TOOL_CALL_RESULT,
  GEN_AI_TOOL_NAME,
  GEN_AI_TOOL_TYPE,
  GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
  GEN_AI_USAGE_CACHE_WRITE_INPUT_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  MCP_METHOD_NAME,
  MCP_METHOD_TOOLS_CALL,
  METRIC_ATTR_LLM_MODEL,
  METRIC_ATTR_LLM_PROVIDER,
  METRIC_ATTR_MCP_SERVER_NAME,
  METRIC_ATTR_MCP_TOOL_NAME,
  METRIC_LLM_CALL_COUNT,
  METRIC_LLM_CALL_DURATION,
  METRIC_LLM_TOKENS_INPUT,
  METRIC_LLM_TOKENS_OUTPUT,
  METRIC_MCP_TOOL_CALL_COUNT,
  METRIC_MCP_TOOL_CALL_DURATION,
  OP_CHAT,
  OP_EXECUTE_TOOL,
  OP_INVOKE_AGENT,
  STIGMER_MCP_SERVER_NAME,
  TOOL_TYPE_EXTENSION,
  TOOL_TYPE_FUNCTION,
  TRACER_NAME,
} from "../gen-ai-conventions.js";
import { telemetrySettings } from "../otel-export.js";
import { chatModelFacts } from "../shared/model-facts.js";
import { chatContent, exportedResult, toolCallContent } from "../shared/telemetry-content.js";
import type { StigmerMiddleware, OtelSpansConfig, ModelCallRequest } from "./types.js";

/** The usage LangChain reports on a model's answer. */
interface UsageMetadata {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly input_token_details?: { readonly cache_read?: number; readonly cache_creation?: number };
}

/** The fields of a model's answer this middleware reads, structurally. */
interface ModelAnswer {
  readonly id?: unknown;
  readonly usage_metadata?: UsageMetadata;
  readonly response_metadata?: Record<string, unknown>;
  readonly additional_kwargs?: Record<string, unknown>;
}

/**
 * Lazy OTel accessor. Returns null when @opentelemetry/api is not
 * available; with no provider configured its tracer and meter are no-ops.
 */
async function getOtel() {
  try {
    const api = await import("@opentelemetry/api");
    return api;
  } catch {
    return null;
  }
}

/** The model name a model instance carries, for a model `buildChatModel` did not build. */
function modelNameOf(model: unknown): string {
  const named = (model ?? {}) as { model?: unknown; model_name?: unknown };
  if (typeof named.model === "string") return named.model;
  if (typeof named.model_name === "string") return named.model_name;
  return "";
}

/** Why the model stopped, as its provider said it: Anthropic's `stop_reason`, OpenAI's `finish_reason`. */
function finishReasonOf(answer: ModelAnswer): string | undefined {
  for (const source of [answer.response_metadata, answer.additional_kwargs]) {
    const reason = source?.stop_reason ?? source?.finish_reason;
    if (typeof reason === "string" && reason !== "") return reason;
  }
  return undefined;
}

/** The system prompt a model call was given. */
function systemTextOf(request: ModelCallRequest): string | undefined {
  if (request.systemPrompt) return request.systemPrompt;
  const content: unknown = request.systemMessage?.content;
  if (typeof content === "string") return content || undefined;
  if (Array.isArray(content)) {
    const text = content
      .map((block: unknown) => (typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : ""))
      .join("");
    return text || undefined;
  }
  return undefined;
}

function setUsage(span: Span, usage: UsageMetadata | undefined): void {
  if (usage === undefined) return;
  if (usage.input_tokens !== undefined) span.setAttribute(GEN_AI_USAGE_INPUT_TOKENS, usage.input_tokens);
  if (usage.output_tokens !== undefined) span.setAttribute(GEN_AI_USAGE_OUTPUT_TOKENS, usage.output_tokens);
  const details = usage.input_token_details;
  if (details?.cache_read !== undefined) span.setAttribute(GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, details.cache_read);
  if (details?.cache_creation !== undefined) span.setAttribute(GEN_AI_USAGE_CACHE_WRITE_INPUT_TOKENS, details.cache_creation);
}

function errorTypeOf(err: unknown): string {
  return err instanceof Error ? err.name || "Error" : "Error";
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
      const meter = api.metrics.getMeter(TRACER_NAME);
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

      const facts = chatModelFacts(request.model);
      const requestModel = facts?.requestModel ?? modelNameOf(request.model);
      const tracer = api.trace.getTracer(TRACER_NAME);
      const span = tracer.startSpan(`${OP_CHAT} ${requestModel}`, {
        kind: api.SpanKind.CLIENT,
        attributes: {
          [GEN_AI_OPERATION_NAME]: OP_CHAT,
          [GEN_AI_REQUEST_MODEL]: requestModel,
          ...(facts ? { [GEN_AI_PROVIDER_NAME]: facts.providerName, [GEN_AI_RESPONSE_MODEL]: facts.responseModel } : {}),
        },
      });

      const startTime = performance.now();
      try {
        const response = await api.context.with(
          api.trace.setSpan(api.context.active(), span),
          () => handler(request),
        );

        const elapsedMs = performance.now() - startTime;
        const answer = response as unknown as ModelAnswer;
        const usage = answer.usage_metadata;
        const finishReason = finishReasonOf(answer);
        setUsage(span, usage);
        if (typeof answer.id === "string" && answer.id !== "") span.setAttribute(GEN_AI_RESPONSE_ID, answer.id);
        if (finishReason !== undefined) span.setAttribute(GEN_AI_RESPONSE_FINISH_REASONS, [finishReason]);
        if (telemetrySettings().content && span.isRecording()) {
          const content = chatContent({ system: systemTextOf(request), messages: request.messages, response, finishReason });
          if (content.systemInstructions !== undefined) span.setAttribute(GEN_AI_SYSTEM_INSTRUCTIONS, content.systemInstructions);
          span.setAttribute(GEN_AI_INPUT_MESSAGES, content.inputMessages);
          span.setAttribute(GEN_AI_OUTPUT_MESSAGES, content.outputMessages);
        }
        span.end();

        const inputTokens = usage?.input_tokens ?? 0;
        const outputTokens = usage?.output_tokens ?? 0;
        const attrs = { [METRIC_ATTR_LLM_PROVIDER]: facts?.providerName ?? "unknown", [METRIC_ATTR_LLM_MODEL]: requestModel };
        llmCallDuration?.record(elapsedMs, attrs);
        llmCallCount?.add(1, attrs);
        if (inputTokens) llmTokensInput?.add(inputTokens, attrs);
        if (outputTokens) llmTokensOutput?.add(outputTokens, attrs);

        return response;
      } catch (err) {
        span.setStatus({ code: api.SpanStatusCode.ERROR, message: String(err) });
        span.setAttribute(ERROR_TYPE, errorTypeOf(err));
        if (err instanceof Error) span.recordException(err);
        span.end();
        throw err;
      }
    },

    async wrapToolCall(request, handler) {
      const api = await getOtel();
      await ensureMetrics();

      if (!api) return handler(request);

      const { id, name, args } = request.toolCall;
      const serverName = toolServerMap.get(name);
      const tracer = api.trace.getTracer(TRACER_NAME);
      const span = tracer.startSpan(`${OP_EXECUTE_TOOL} ${name}`, {
        kind: api.SpanKind.INTERNAL,
        attributes: {
          [GEN_AI_OPERATION_NAME]: OP_EXECUTE_TOOL,
          [GEN_AI_TOOL_NAME]: name,
          ...(id ? { [GEN_AI_TOOL_CALL_ID]: id } : {}),
          ...(serverName
            ? { [GEN_AI_TOOL_TYPE]: TOOL_TYPE_EXTENSION, [MCP_METHOD_NAME]: MCP_METHOD_TOOLS_CALL, [STIGMER_MCP_SERVER_NAME]: serverName }
            : { [GEN_AI_TOOL_TYPE]: TOOL_TYPE_FUNCTION }),
        },
      });
      const content = telemetrySettings().content && span.isRecording() ? toolCallContent(name, args ?? {}) : undefined;
      if (content !== undefined) span.setAttribute(GEN_AI_TOOL_CALL_ARGUMENTS, content.arguments);

      const startTime = performance.now();
      try {
        const result = await api.context.with(
          api.trace.setSpan(api.context.active(), span),
          () => handler(request),
        );

        const elapsedMs = performance.now() - startTime;
        const message = result as { status?: unknown; content?: unknown };
        if (message.status === "error") {
          span.setStatus({ code: api.SpanStatusCode.ERROR });
          span.setAttribute(ERROR_TYPE, "tool_error");
        }
        if (content !== undefined && typeof message.content === "string") {
          const exported = exportedResult(message.content, content.withheld);
          if (exported !== null) span.setAttribute(GEN_AI_TOOL_CALL_RESULT, exported);
        }
        span.end();

        if (serverName) {
          const attrs = { [METRIC_ATTR_MCP_TOOL_NAME]: name, [METRIC_ATTR_MCP_SERVER_NAME]: serverName };
          mcpToolDuration?.record(elapsedMs, attrs);
          mcpToolCount?.add(1, attrs);
        }

        return result;
      } catch (err) {
        // A pause bubbling up from a sub-agent's approval (or a parent
        // command) is LangGraph's control flow, not the tool failing.
        if (!isGraphBubbleUp(err)) {
          span.setStatus({ code: api.SpanStatusCode.ERROR, message: String(err) });
          span.setAttribute(ERROR_TYPE, errorTypeOf(err));
          if (err instanceof Error) span.recordException(err);
        }
        span.end();
        throw err;
      }
    },
  };
}

/**
 * Run one sub-agent invocation inside an `invoke_agent {name}` span: the
 * child of whatever span is active, which for a delegation is the parent's
 * `execute_tool task` span, so the sub-agent's own model and tool calls
 * nest under the step that started them. A pause bubbling up from the
 * sub-agent's approval is not a failure.
 */
export async function withSubAgentSpan<T>(name: string, run: () => Promise<T>): Promise<T> {
  const api = await getOtel();
  if (!api) return run();
  const span = api.trace.getTracer(TRACER_NAME).startSpan(`${OP_INVOKE_AGENT} ${name}`, {
    kind: api.SpanKind.INTERNAL,
    attributes: { [GEN_AI_OPERATION_NAME]: OP_INVOKE_AGENT, [GEN_AI_AGENT_NAME]: name },
  });
  try {
    return await api.context.with(api.trace.setSpan(api.context.active(), span), run);
  } catch (err) {
    if (!isGraphBubbleUp(err)) {
      span.setStatus({ code: api.SpanStatusCode.ERROR, message: String(err) });
      span.setAttribute(ERROR_TYPE, errorTypeOf(err));
      if (err instanceof Error) span.recordException(err);
    }
    throw err;
  } finally {
    span.end();
  }
}
