"use client";

import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { useSessionUsage, type RunUsageEntry } from "../useSessionUsage.js";
import { UsageWidget, formatCost } from "../../run/UsageWidget.js";
import { FacetSection } from "./primitives.js";

export interface UsageTabProps {
  readonly runs: readonly AgentRun[];
}

/**
 * Usage facet for the session panel (a `useSessionRailViews` rail view).
 *
 * Renders the session totals ({@link UsageWidget}) plus the #362 model
 * provenance list: per run, the billing-RESOLVED model with its
 * cost — for a Cursor Auto run, the only honest answer to "which model
 * actually ran and what did it cost", since the requested model is empty
 * by definition there — paired with the tier the runner REQUESTED (the
 * streaming summary's audit record that the account default was never
 * left in control). Requested-vs-billed divergence is a platform alarm
 * (`stigmer.billing.service_tier.mismatch`), not a per-row UI concern.
 *
 * Rendered in the session panel's shared facet vocabulary (see
 * `./primitives.tsx`). Shows an empty state when no usage data is available.
 */
export function UsageTab({ runs: executions }: UsageTabProps) {
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
    <div className="stg:flex stg:flex-col stg:gap-5">
      <UsageWidget runs={executions} />
      {usage.runBreakdown.length > 0 && (
        <ExecutionModelList
          entries={usage.runBreakdown}
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
  readonly entries: readonly RunUsageEntry[];
  readonly executions: readonly AgentRun[];
}) {
  return (
    <FacetSection heading="Models per run">
      <div role="list" aria-label="Per-run model and tier" className="stg:flex stg:flex-col">
        {entries.map((entry, index) => {
          const requestedTier = requestedTierLabel(executions, entry.runId);
          return (
            <div
              key={entry.runId}
              className="stg:flex stg:items-baseline stg:justify-between stg:gap-2 stg:px-2 stg:py-1 stg:text-xs"
              role="listitem"
            >
              <span className="stg:min-w-0 stg:truncate stg:text-foreground">
                <span className="stg:tabular-nums stg:text-muted-foreground">
                  #{index + 1}
                </span>{" "}
                {entry.resolvedModel || "—"}
                {requestedTier && <RowBadge>{requestedTier} requested</RowBadge>}
                {entry.isEstimated && <RowBadge>Estimated</RowBadge>}
              </span>
              <span className="stg:shrink-0 stg:tabular-nums stg:text-[0.65rem] stg:text-muted-foreground">
                {formatCost(entry.billableCostUsd)}
              </span>
            </div>
          );
        })}
      </div>
    </FacetSection>
  );
}

/** Quiet inline qualifier chip for a provenance row. */
function RowBadge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="stg:ml-1 stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:leading-none stg:text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * The tier the runner requested for one run, from its streaming
 * usage summary — present once the runner has translated the run
 * config, absent for runs that predate the tier attribute. Never
 * "unspecified": the runner records the RESOLVED tier (#357's audit
 * contract).
 */
function requestedTierLabel(
  executions: readonly AgentRun[],
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
