/**
 * Shared configuration types for the middleware stack.
 *
 * Each middleware module reads its own slice of MiddlewareStackConfig.
 * The factory in index.ts assembles the config from ExecutionConfig
 * proto fields and passes it to buildMiddlewareStack().
 */

import type { ToolMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import type { Command } from "@langchain/langgraph";

export type { ToolMessage, SystemMessage, AIMessage };

/**
 * Minimal AgentMiddleware interface matching the langchain JS contract.
 *
 * The canonical type lives in langchain (nested under deepagents), but
 * is not directly importable from our dependency graph. This structural
 * type is wire-compatible — langchain uses structural typing, not
 * nominal, so any object matching this shape is accepted as middleware.
 */
export interface StigmerMiddleware {
  readonly name: string;
  beforeAgent?: (state: Record<string, unknown>, runtime: unknown) => unknown;
  afterModel?: (state: Record<string, unknown>, runtime: unknown) => unknown;
  wrapToolCall?: (
    request: ToolCallRequest,
    handler: (request: ToolCallRequest) => Promise<ToolMessage | Command> | ToolMessage | Command,
  ) => Promise<ToolMessage | Command> | ToolMessage | Command;
  wrapModelCall?: (
    request: ModelCallRequest,
    handler: (request: ModelCallRequest) => Promise<AIMessage | Command> | AIMessage | Command,
  ) => Promise<AIMessage | Command> | AIMessage | Command;
  afterAgent?: (state: Record<string, unknown>, runtime: unknown) => unknown;
}

/**
 * Tool call request — the shape passed to wrapToolCall.
 * Matches langchain ToolCallRequest structurally.
 */
export interface ToolCallRequest {
  readonly toolCall: {
    readonly id: string;
    readonly name: string;
    readonly args: Record<string, unknown>;
  };
  readonly tool: unknown;
  readonly state: Record<string, unknown> & { messages?: unknown[] };
  readonly runtime: unknown;
}

/**
 * Model call request — the shape passed to wrapModelCall.
 * Matches langchain ModelRequest structurally.
 */
export interface ModelCallRequest {
  readonly model: unknown;
  readonly messages: unknown[];
  readonly systemPrompt?: string;
  readonly systemMessage?: SystemMessage;
  readonly tools?: unknown[];
  readonly state: Record<string, unknown> & { messages?: unknown[] };
  readonly runtime: unknown;
}

export interface LoopDetectionConfig {
  readonly historySize: number;
  readonly consecutiveThreshold: number;
  readonly totalThreshold: number;
  readonly enabled: boolean;
}

export interface ExecutionBudgetConfig {
  readonly recursionLimit: number;
  readonly warningPct: number;
  readonly warningInterval: number | null;
  readonly maxWarnings: number;
}

export interface ToolTruncationConfig {
  readonly maxChars: number;
  readonly onTruncation?: (toolName: string, charsTruncated: number) => void;
}

export interface CostCapConfig {
  readonly maxCostUsd: number;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
  readonly warningPct: number;
}

export interface OtelSpansConfig {
  readonly toolServerMap: ReadonlyMap<string, string>;
}

/**
 * Top-level configuration for buildMiddlewareStack().
 * All sections are optional — the factory applies sensible defaults.
 */
export interface MiddlewareStackConfig {
  readonly loopDetection?: Partial<LoopDetectionConfig>;
  readonly executionBudget?: Partial<ExecutionBudgetConfig>;
  readonly toolTruncation?: Partial<ToolTruncationConfig>;
  readonly costCap?: CostCapConfig | null;
  readonly otelSpans?: Partial<OtelSpansConfig>;
}
