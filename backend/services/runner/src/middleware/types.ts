/**
 * Shared configuration types for the middleware stack.
 *
 * Each middleware module reads its own slice of MiddlewareStackConfig.
 * The Stigmer harness's turn setup assembles the config from the turn's
 * resolved settings (`status.run_config`) and passes it to
 * buildMiddlewareStack().
 */

import type { ToolMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import type { Command } from "@langchain/langgraph";
import type { AnyBackendProtocol } from "deepagents";

import type { BackgroundCommands, BackgroundOutputPaths } from "../shared/shell/background-commands.js";
import type { TurnInputChannel } from "../harness/turn-input.js";
import type { InputBarriers } from "../activities/execute-deep-agent/input-barrier.js";
import type { McpToolIndex } from "../shared/mcp-tool-names.js";

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
  /** Tools the middleware binds to its graph; langchain registers them beside the agent's own. */
  readonly tools?: readonly unknown[];
  beforeAgent?: (state: Record<string, unknown>, runtime: unknown) => unknown;
  beforeModel?: (state: Record<string, unknown>, runtime: unknown) => unknown;
  /** A hook, or a hook with the targets it may jump to (`jumpTo` in its update). */
  afterModel?:
    | ((state: Record<string, unknown>, runtime: unknown) => unknown)
    | { readonly canJumpTo: readonly ("model" | "tools" | "end")[]; readonly hook: (state: Record<string, unknown>, runtime: unknown) => unknown };
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
  /**
   * The turn's round budget, already clamped (`shared/tool-rounds.ts`
   * `resolveToolRoundLimit`); the middleware ends the turn when it is spent.
   * `null` is unlimited: the advisory still fires, nothing is stopped.
   */
  readonly maxToolRounds: number | null;
  readonly warningPct: number;
  readonly warningInterval: number | null;
  readonly maxWarnings: number;
}

export interface ToolTruncationConfig {
  /** The run's `max_tool_result_chars`; a tool deepagents would offload is cut at no more than its threshold (`tool-truncation.ts`). */
  readonly maxChars: number;
  /**
   * The graph's file backend. A long result is kept whole through it only
   * when it routes the offload root outside the workspace
   * (`platform-route.ts` `routesOffloads`); otherwise, or absent, the result
   * is cut with nothing kept.
   */
  readonly backend?: AnyBackendProtocol;
  readonly onTruncation?: (toolName: string, charsTruncated: number) => void;
}

/** The cap the advisory warns toward; the turn runtime enforces it (`shared/cost-guard.ts`). */
export interface CostAdvisoryConfig {
  readonly maxCostUsd: number;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
  readonly warningPct: number;
}

export interface OtelSpansConfig {
  /** The server and bare tool each MCP engine name stands for: a span names the tool as it does everywhere outside the engine. */
  readonly mcpIndex: McpToolIndex;
}

// Single source of truth lives in approval-gate.ts (the gate consumes it);
// imported as a type (no runtime cycle) and re-exported so existing importers of
// `ApprovalGateConfig` from this module keep working.
import type { ApprovalGateConfig } from "./approval-gate.js";
export type { ApprovalGateConfig };

// Same idiom as ApprovalGateConfig above: the normalization middleware
// consumes it, this module re-exports it for stack-config assembly.
import type { PathNormalizationConfig } from "./path-normalization.js";
export type { PathNormalizationConfig };

// Same idiom: the tool-scope middleware consumes it.
import type { ToolScopeConfig } from "./tool-scope.js";
import type { TurnBoundarySignals } from "./turn-boundary.js";
export type { ToolScopeConfig };

// Same idiom: the folder-instructions middleware consumes it.
import type { FolderInstructionsConfig } from "./folder-instructions.js";
export type { FolderInstructionsConfig };

/**
 * Top-level configuration for buildMiddlewareStack().
 * All sections are optional — the factory applies sensible defaults.
 */
export interface MiddlewareStackConfig {
  /** The turn's stop and yield, taken at the root's model calls (`turn-boundary.ts`); absent, nothing is checked (unit tests). */
  readonly turnBoundary?: TurnBoundarySignals;
  readonly loopDetection?: Partial<LoopDetectionConfig>;
  readonly executionBudget?: Partial<ExecutionBudgetConfig>;
  readonly toolTruncation?: Partial<ToolTruncationConfig>;
  readonly costAdvisory?: CostAdvisoryConfig | null;
  readonly otelSpans?: Partial<OtelSpansConfig>;
  readonly approvalGate?: ApprovalGateConfig | null;
  /**
   * The agent's tool lists (`tool-scope.ts`). Installed whenever the scope
   * carries a list, whether or not the approval gate is.
   */
  readonly toolScope?: ToolScopeConfig | null;
  /**
   * Virtual-dialect path normalization (issues #429/#754). Set on every
   * Stigmer-harness graph: the backends are virtual-rooted, so every graph carries
   * the repair seam that keeps model-supplied paths canonical.
   */
  readonly pathNormalization?: PathNormalizationConfig | null;
  /**
   * A folder's own instruction file on the first read beneath it
   * (`folder-instructions.ts`). Set only on a graph whose tool scope may
   * read the workspace; absent, nothing is attached.
   */
  readonly folderInstructions?: FolderInstructionsConfig | null;
  /**
   * The runner's shell for this graph (`middleware/shell.ts`): the
   * executable `execute` tool every `execute` call runs. Present only on a
   * graph whose backend can run a shell; absent, deepagents binds no
   * `execute` and none is supplied.
   */
  readonly shell?: ShellMiddlewareConfig | null;
  /**
   * The person's messages, for the background middleware's round-end wait
   * to hand on (`background-commands.ts`); the root's alone.
   */
  readonly turnInput?: { readonly channel: TurnInputChannel; readonly barriers?: InputBarriers };
}

export interface ShellMiddlewareConfig {
  /** The graph's `execute` tool (`execute-deep-agent/shell-tool.ts` `createShellTool`). */
  readonly tool: unknown;
  /**
   * Present when `execute` can run a command in the background
   * (`execute-deep-agent/shell-tool.ts` `createShellBinding`): the
   * invocation's commands, where their output goes, and the stop tool bound
   * beside `execute`. The `shell` middleware declares `background` and binds
   * the stop tool, and the background middleware is installed with it
   * (`background-commands.ts`).
   */
  readonly background?: BackgroundShellConfig;
}

export interface BackgroundShellConfig {
  readonly commands: BackgroundCommands;
  readonly outputPaths: BackgroundOutputPaths | undefined;
  /** The `stop_background_command` tool. */
  readonly stopTool: unknown;
}
