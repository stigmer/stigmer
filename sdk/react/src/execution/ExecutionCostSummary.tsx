"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { cn } from "@stigmer/theme";
import { useExecutionUsage } from "./useExecutionUsage";

export interface ExecutionCostSummaryProps {
  /** The execution to display cost data for. Renders nothing when null or when usage data has not yet arrived. */
  readonly execution: AgentExecution | null;
  readonly className?: string;
}

/**
 * Displays real-time execution cost and token usage metrics aggregated
 * across the main agent and any sub-agents.
 *
 * The headline shows estimated USD cost. Below it: model identification,
 * total token and LLM call counts, a prompt/completion breakdown, and
 * conditional annotations for cache usage and sub-agent contributions.
 *
 * During active streaming, cost and token numbers update on every
 * progressive status snapshot. Uses `tabular-nums` for stable digit
 * widths so the layout does not shift as numbers grow.
 *
 * When multiple models are used (common in sub-agent executions), the
 * single model line is replaced with a per-model cost breakdown.
 *
 * Renders without card chrome — the consumer provides the container.
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const stream = useExecutionStream(executionId);
 *
 * <div className="rounded-lg border border-border bg-card p-3">
 *   <ExecutionCostSummary execution={stream.execution} />
 * </div>
 * ```
 */
export function ExecutionCostSummary({
  execution,
  className,
}: ExecutionCostSummaryProps) {
  const { usage, hasSubAgentUsage, subAgentUsageCount } =
    useExecutionUsage(execution);

  if (!usage) return null;

  const multiModel = usage.modelBreakdown.length > 1;

  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      role="region"
      aria-label="Execution cost summary"
    >
      <div className="text-sm font-medium tabular-nums text-foreground">
        {formatCost(usage.estimatedCostUsd)}
      </div>

      {multiModel ? (
        <ModelBreakdown models={usage.modelBreakdown} />
      ) : (
        <div className="truncate text-xs text-muted-foreground">
          {usage.primaryModel}
          {usage.primaryProvider && ` · ${usage.primaryProvider}`}
        </div>
      )}

      <div className="text-xs tabular-nums text-muted-foreground">
        {formatTokenCount(usage.totalTokens)} tokens ·{" "}
        {usage.llmCallCount} {usage.llmCallCount === 1 ? "call" : "calls"}
      </div>

      <div className="pl-2 text-xs tabular-nums text-muted-foreground">
        prompt {formatTokenCount(usage.promptTokens)} · completion{" "}
        {formatTokenCount(usage.completionTokens)}
      </div>

      {(usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0) && (
        <CacheLine
          readTokens={usage.cacheReadTokens}
          creationTokens={usage.cacheCreationTokens}
        />
      )}

      {hasSubAgentUsage && (
        <div className="text-xs text-muted-foreground">
          Includes {subAgentUsageCount} sub-agent
          {subAgentUsageCount > 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function ModelBreakdown({
  models,
}: {
  readonly models: readonly ModelUsage[];
}) {
  return (
    <div
      className="flex flex-col gap-0.5"
      role="list"
      aria-label="Model cost breakdown"
    >
      {models.map((entry) => (
        <div
          key={`${entry.model}\0${entry.provider}`}
          className="flex items-baseline justify-between text-xs text-muted-foreground"
          role="listitem"
        >
          <span className="truncate">{entry.model}</span>
          <span className="ml-2 shrink-0 tabular-nums">
            {formatCost(entry.estimatedCostUsd)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CacheLine({
  readTokens,
  creationTokens,
}: {
  readonly readTokens: number;
  readonly creationTokens: number;
}) {
  const parts: string[] = [];
  if (readTokens > 0) parts.push(`${formatTokenCount(readTokens)} read`);
  if (creationTokens > 0)
    parts.push(`${formatTokenCount(creationTokens)} write`);

  return (
    <div className="pl-2 text-xs tabular-nums text-muted-foreground">
      cache {parts.join(" · ")}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/**
 * Formats a USD cost value for display.
 * - Zero: "$0.00"
 * - Under $1: 4 decimal places ("$0.0042")
 * - $1 and above: 2 decimal places ("$1.23")
 */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const tokenFormatter = new Intl.NumberFormat("en-US");

/**
 * Formats an integer token count with comma-separated digit grouping
 * (en-US locale) for deterministic display across environments.
 */
export function formatTokenCount(count: number): string {
  return tokenFormatter.format(count);
}
