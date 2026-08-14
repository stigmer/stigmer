"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useSessionUsage, type ExecutionUsageEntry } from "../useSessionUsage.js";
import { UsageWidget, formatCost } from "../../execution/UsageWidget.js";

export interface UsageTabProps {
  readonly executions: readonly AgentExecution[];
}

/**
 * Usage facet for the session panel (a `useSessionRailViews` rail view).
 *
 * Renders the session totals ({@link UsageWidget}) plus the #362 model
 * provenance list: per execution, the billing-RESOLVED model with its
 * cost — for a Cursor Auto run, the only honest answer to "which model
 * actually ran and what did it cost", since the requested model is empty
 * by definition there — paired with the tier the runner REQUESTED (the
 * streaming summary's audit record that the account default was never
 * left in control). Requested-vs-billed divergence is a platform alarm
 * (`stigmer.billing.service_tier.mismatch`), not a per-row UI concern.
 *
 * Shows an empty state when no usage data is available.
 */
export function UsageTab({ executions }: UsageTabProps) {
  const usage = useSessionUsage(executions);

  if (!usage.hasUsage) {
    return (
      <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:px-4 stg:py-8 stg:text-center">
        <p className="stg:text-xs stg:text-muted-foreground">
          No usage data yet. Cost and token stats will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-4">
      <UsageWidget executions={executions} />
      {usage.executionBreakdown.length > 0 && (
        <ExecutionModelList
          entries={usage.executionBreakdown}
          executions={executions}
        />
      )}
    </div>
  );
}

/**
 * Per-execution model provenance rows, in the report's chronological
 * order: `#N resolved-model [tier requested] [Estimated]  $cost`.
 */
function ExecutionModelList({
  entries,
  executions,
}: {
  readonly entries: readonly ExecutionUsageEntry[];
  readonly executions: readonly AgentExecution[];
}) {
  return (
    <div
      className="stg:flex stg:flex-col stg:gap-1"
      role="list"
      aria-label="Per-execution model and tier"
    >
      <div className="stg:text-xs stg:font-medium stg:text-foreground">
        Models per run
      </div>
      {entries.map((entry, index) => {
        const requestedTier = requestedTierLabel(executions, entry.executionId);
        return (
          <div
            key={entry.executionId}
            className="stg:flex stg:items-baseline stg:justify-between stg:gap-2 stg:text-xs stg:text-muted-foreground"
            role="listitem"
          >
            <span className="stg:truncate">
              <span className="stg:tabular-nums">#{index + 1}</span>{" "}
              {entry.resolvedModel || "—"}
              {requestedTier && (
                <span className="stg:ml-1 stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none">
                  {requestedTier} requested
                </span>
              )}
              {entry.isEstimated && (
                <span className="stg:ml-1 stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none">
                  Estimated
                </span>
              )}
            </span>
            <span className="stg:shrink-0 stg:tabular-nums">
              {formatCost(entry.billableCostUsd)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The tier the runner requested for one execution, from its streaming
 * usage summary — present once the runner has translated the execution
 * config, absent for executions that predate the tier attribute. Never
 * "unspecified": the runner records the RESOLVED tier (#357's audit
 * contract).
 */
function requestedTierLabel(
  executions: readonly AgentExecution[],
  executionId: string,
): string | null {
  const match = executions.find((e) => e.metadata?.id === executionId);
  switch (match?.status?.streamingUsage?.requestedServiceTier) {
    case ServiceTier.FAST:
      return "fast";
    case ServiceTier.STANDARD:
      return "standard";
    default:
      return null;
  }
}
