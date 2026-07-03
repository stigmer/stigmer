"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { cn } from "@stigmer/theme";
import {
  useSessionUsage,
  type ModelCostEntry,
} from "../session/useSessionUsage.js";

/** Props for {@link UsageWidget}. */
export interface UsageWidgetProps {
  /**
   * All executions for the current session — both completed and
   * actively streaming.  The widget aggregates cost data across
   * every execution's `usageSummary` (proxy-maintained), presenting a
   * session-level total that never resets.
   *
   * Renders nothing when the list is empty or no execution has
   * usage data.
   */
  readonly executions: readonly AgentExecution[];
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Right-sidebar widget that displays session-level cost and token
 * usage aggregated from per-message `LlmCallMetrics`.
 *
 * Usage data is computed purely from messages the frontend already
 * has — no server RPC is required for the real-time widget.
 *
 * Returns `null` when no execution has usage data, matching the
 * conditional-render pattern of {@link ArtifactsWidget} and
 * {@link WriteBacksWidget}.
 *
 * All visual properties flow through `--stgm-*` tokens. Zero
 * Console dependencies.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 *
 * <UsageWidget
 *   executions={[
 *     ...conv.completedExecutions,
 *     ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
 *   ]}
 * />
 * ```
 *
 * @see {@link useSessionUsage} — headless session-level usage aggregation hook
 */
export function UsageWidget({ executions, className }: UsageWidgetProps) {
  const usage = useSessionUsage(executions);

  if (!usage.hasUsage) return null;

  const multiModel = usage.modelBreakdown.length > 1;

  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      role="region"
      aria-label="Session cost summary"
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-medium tabular-nums text-foreground">
          {formatCost(usage.totalCostUsd)}
        </span>
        {usage.isEstimated && (
          <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
            Estimated
          </span>
        )}
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
        prompt {formatTokenCount(usage.inputTokens)} · completion{" "}
        {formatTokenCount(usage.outputTokens)}
      </div>

      {(usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0) && (
        <CacheLine
          readTokens={usage.cacheReadTokens}
          creationTokens={usage.cacheCreationTokens}
        />
      )}
    </div>
  );
}

function ModelBreakdown({
  models,
}: {
  readonly models: readonly ModelCostEntry[];
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
