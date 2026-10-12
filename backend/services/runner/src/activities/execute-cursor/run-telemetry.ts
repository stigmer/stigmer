/**
 * A Cursor turn as a trace shows it: an `invoke_agent Cursor` span under
 * the run's span, with an `execute_tool` span for each tool call the
 * Cursor agent made.
 *
 * The shape is what OpenTelemetry's GenAI conventions say a call to a
 * remote agent is. The Cursor engine's model calls happen inside Cursor's
 * service; what the runner sees is the run's stream (tool calls, text) and
 * its usage reports, so the span carries the run's model and its tokens
 * summed over every `turn-ended` report, never per call. A tool reading the
 * conventions shows those tokens; Langfuse prices no `invoke_agent` span,
 * to avoid counting a call twice, so a Cursor run shows tokens but no cost
 * there. Cursor reports cache reads and writes beside its input tokens;
 * the span's input tokens include them, as the conventions ask.
 *
 * The tool spans are built from the transcript facts the harness's
 * translator already derives from the stream (`translator.ts`): a call's
 * first `tool_started` opens its span (the translator restates the start on
 * every event of the call), its `tool_finished` or `tool_error` ends it, an
 * MCP call already unpacked from Cursor's `mcp` envelope. A call still open
 * when the turn ends (one waiting for approval) is ended with the turn. The
 * conversation's text follows the content switch and the saved
 * conversation's rules (`shared/telemetry-content.ts`).
 *
 * Replaces the coarse `stigmer.cursor.turn` span, which was never the
 * active context, so nothing nested under it. The turn's metrics are
 * recorded beside it as before (`otel.ts` `recordTurnMetrics`).
 */

import { SpanKind, SpanStatusCode, context, trace, type Span } from "@opentelemetry/api";

import {
  ERROR_TYPE,
  GEN_AI_AGENT_NAME,
  GEN_AI_OPERATION_NAME,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
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
  OP_EXECUTE_TOOL,
  OP_INVOKE_AGENT,
  PROVIDER_CURSOR,
  STIGMER_CURSOR_MODE,
  STIGMER_MCP_SERVER_NAME,
  TOOL_TYPE_EXTENSION,
  TOOL_TYPE_FUNCTION,
  TRACER_NAME,
} from "../../gen-ai-conventions.js";
import type { TurnOutcome } from "../../harness/types.js";
import type { TranscriptEvent } from "../../harness/transcript/events.js";
import { telemetrySettings } from "../../otel-export.js";
import { exportedResult, toolCallContent } from "../../shared/telemetry-content.js";
import type { TurnUsage } from "./usage-pricing.js";

/** The agent name a Cursor run's span carries. */
export const CURSOR_AGENT_NAME = "Cursor";

/** What the stream loop hands the telemetry: the facts it folds, and each usage report. */
export interface CursorTurnObserver {
  observe(facts: readonly TranscriptEvent[]): void;
  usage(report: TurnUsage): void;
}

interface OpenTool {
  readonly span: Span;
  readonly withheld: boolean;
}

export class CursorRunTelemetry implements CursorTurnObserver {
  private readonly tools = new Map<string, OpenTool>();
  private readonly finished = new Set<string>();
  private readonly content = telemetrySettings().content;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private ended = false;

  private constructor(private readonly span: Span) {}

  /** Open the run's span under the active context (the run's `invoke_agent` span). */
  static start(args: { readonly model: string; readonly mode: string }): CursorRunTelemetry {
    const span = trace.getTracer(TRACER_NAME).startSpan(`${OP_INVOKE_AGENT} ${CURSOR_AGENT_NAME}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        [GEN_AI_OPERATION_NAME]: OP_INVOKE_AGENT,
        [GEN_AI_PROVIDER_NAME]: PROVIDER_CURSOR,
        [GEN_AI_AGENT_NAME]: CURSOR_AGENT_NAME,
        [GEN_AI_REQUEST_MODEL]: args.model,
        [STIGMER_CURSOR_MODE]: args.mode,
      },
    });
    return new CursorRunTelemetry(span);
  }

  observe(facts: readonly TranscriptEvent[]): void {
    if (this.ended || !this.span.isRecording()) return;
    for (const fact of facts) {
      switch (fact.kind) {
        case "tool_started":
          this.open(fact.callId, fact.name, fact.mcpServerSlug, fact.input);
          break;
        case "tool_finished": {
          const tool = this.close(fact.callId);
          if (tool === undefined) break;
          if (this.content) {
            const result = exportedResult(fact.result, tool.withheld);
            if (result !== null) tool.span.setAttribute(GEN_AI_TOOL_CALL_RESULT, result);
          }
          tool.span.end();
          break;
        }
        case "tool_error": {
          const tool = this.close(fact.callId);
          if (tool === undefined) break;
          tool.span.setStatus({ code: SpanStatusCode.ERROR, message: fact.message });
          tool.span.setAttribute(ERROR_TYPE, "tool_error");
          tool.span.end();
          break;
        }
        default:
          break;
      }
    }
  }

  usage(report: TurnUsage): void {
    this.inputTokens += report.inputTokens ?? 0;
    this.outputTokens += report.outputTokens ?? 0;
    this.cacheReadTokens += report.cacheReadTokens ?? 0;
    this.cacheWriteTokens += report.cacheWriteTokens ?? 0;
  }

  /** End every open tool span and the run's span, with the run's tokens and how it ended. Idempotent. */
  end(outcome: TurnOutcome | undefined): void {
    if (this.ended) return;
    this.ended = true;
    for (const tool of this.tools.values()) tool.span.end();
    this.tools.clear();
    this.span.setAttributes({
      [GEN_AI_USAGE_INPUT_TOKENS]: this.inputTokens + this.cacheReadTokens + this.cacheWriteTokens,
      [GEN_AI_USAGE_OUTPUT_TOKENS]: this.outputTokens,
      [GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]: this.cacheReadTokens,
      [GEN_AI_USAGE_CACHE_WRITE_INPUT_TOKENS]: this.cacheWriteTokens,
    });
    if (outcome?.kind === "failed") {
      this.span.setStatus({ code: SpanStatusCode.ERROR, message: outcome.message });
      this.span.setAttribute(ERROR_TYPE, outcome.surface);
    }
    this.span.end();
  }

  private open(callId: string, name: string, mcpServerSlug: string, input: Record<string, unknown>): void {
    if (this.tools.has(callId) || this.finished.has(callId)) return;
    const parent = trace.setSpan(context.active(), this.span);
    const span = trace.getTracer(TRACER_NAME).startSpan(
      `${OP_EXECUTE_TOOL} ${name}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          [GEN_AI_OPERATION_NAME]: OP_EXECUTE_TOOL,
          [GEN_AI_TOOL_NAME]: name,
          [GEN_AI_TOOL_CALL_ID]: callId,
          ...(mcpServerSlug
            ? { [GEN_AI_TOOL_TYPE]: TOOL_TYPE_EXTENSION, [MCP_METHOD_NAME]: MCP_METHOD_TOOLS_CALL, [STIGMER_MCP_SERVER_NAME]: mcpServerSlug }
            : { [GEN_AI_TOOL_TYPE]: TOOL_TYPE_FUNCTION }),
        },
      },
      parent,
    );
    const exported = this.content ? toolCallContent(name, input) : undefined;
    if (exported !== undefined) span.setAttribute(GEN_AI_TOOL_CALL_ARGUMENTS, exported.arguments);
    this.tools.set(callId, { span, withheld: exported?.withheld ?? false });
  }

  private close(callId: string): OpenTool | undefined {
    const tool = this.tools.get(callId);
    if (tool === undefined) return undefined;
    this.tools.delete(callId);
    this.finished.add(callId);
    return tool;
  }
}
