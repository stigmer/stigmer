"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { cn } from "@stigmer/theme";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge";
import { isTerminalPhase } from "./execution-phases";
import {
  useElapsedMs,
  hasModelData,
  hasTokenData,
  formatMs,
  formatTimestamp,
  formatCompactNumber,
  formatCost,
} from "./execution-format";

export interface ExecutionSummaryProps {
  /** The execution to display a compact summary for. Renders nothing when null. */
  readonly execution: AgentExecution | null;
  readonly className?: string;
}

/**
 * Compact execution overview showing phase, duration, model, token
 * counts, and estimated cost in a dense, information-rich layout.
 *
 * This is the "at a glance" counterpart to the exhaustive
 * {@link ExecutionDetails} component. Each row renders conditionally —
 * sections with no meaningful data are omitted.
 *
 * Renders its content without card chrome (no border, background, or
 * elevation). The consumer controls the container styling.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const stream = useExecutionStream(executionId);
 *
 * <div className="rounded-lg border border-border bg-card p-3">
 *   <ExecutionSummary execution={stream.execution} />
 * </div>
 * ```
 */
export function ExecutionSummary({
  execution,
  className,
}: ExecutionSummaryProps) {
  if (!execution) return null;

  const status = execution.status;
  const phase = status?.phase;
  const usage = status?.usage;

  if (phase === undefined) return null;

  const terminal = isTerminalPhase(phase);

  return (
    <div
      className={cn("flex flex-col gap-1.5 text-xs", className)}
      role="region"
      aria-label="Execution summary"
    >
      <StatusRow
        phase={phase}
        terminal={terminal}
        startedAt={status?.startedAt}
        completedAt={status?.completedAt}
        totalDurationMs={usage?.totalDurationMs}
      />
      {usage && hasModelData(usage) && (
        <div className="truncate text-muted-foreground">
          <span className="font-mono">{usage.primaryModel}</span>
          {usage.primaryModel && usage.primaryProvider && (
            <Separator />
          )}
          {usage.primaryProvider && (
            <span>{usage.primaryProvider}</span>
          )}
        </div>
      )}
      {usage && (hasTokenData(usage) || usage.estimatedCostUsd > 0) && (
        <div className="flex flex-wrap items-center gap-x-1.5 font-mono text-muted-foreground tabular-nums">
          {hasTokenData(usage) && (
            <span>
              {formatCompactNumber(usage.promptTokens)} in /{" "}
              {formatCompactNumber(usage.completionTokens)} out
            </span>
          )}
          {hasTokenData(usage) && usage.estimatedCostUsd > 0 && (
            <Separator />
          )}
          {usage.estimatedCostUsd > 0 && (
            <span>{formatCost(usage.estimatedCostUsd)}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

function StatusRow({
  phase,
  terminal,
  startedAt,
  completedAt,
  totalDurationMs,
}: {
  phase: ExecutionPhase;
  terminal: boolean;
  startedAt?: string;
  completedAt?: string;
  totalDurationMs?: number;
}) {
  const elapsedMs = useElapsedMs(startedAt, !terminal);

  const durationLabel = (() => {
    if (terminal && totalDurationMs && totalDurationMs > 0) {
      return formatMs(totalDurationMs);
    }
    if (terminal && startedAt && completedAt) {
      const ms =
        new Date(completedAt).getTime() - new Date(startedAt).getTime();
      return ms > 0 ? formatMs(ms) : null;
    }
    if (elapsedMs !== null) return formatMs(elapsedMs);
    return null;
  })();

  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <ExecutionPhaseBadge phase={phase} />
      {durationLabel && (
        <>
          <Separator />
          <span className="font-mono text-muted-foreground tabular-nums">
            {durationLabel}
          </span>
        </>
      )}
      {startedAt && (
        <>
          <Separator />
          <span className="text-muted-foreground">
            {formatTimestamp(startedAt)}
          </span>
        </>
      )}
    </div>
  );
}

function Separator() {
  return (
    <span className="text-muted-foreground/50" aria-hidden="true">
      ·
    </span>
  );
}
