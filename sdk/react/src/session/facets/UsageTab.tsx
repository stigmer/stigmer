"use client";

/**
 * Session Usage facet: the session totals ({@link UsageWidget}), the
 * session's working time and, per run, its tokens, working time and primary
 * model with the tier the runner requested.
 *
 * Usage is tokens, never money. The suite in
 * `session/__tests__/UsageTab.test.tsx` pins the empty state, the per-run
 * rows (tokens, working time, model, tier, "Estimated"), the session's
 * working time, and their absence before the
 * report lists any run.
 */

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { useSessionUsage, type RunUsageEntry } from "../useSessionUsage.js";
import { UsageWidget } from "../../run/UsageWidget.js";
import { formatTokens, formatWorkingTime } from "../../usage/format.js";
import { FacetSection } from "./primitives.js";

export interface UsageTabProps {
  readonly runs: readonly Run[];
}

/**
 * Usage facet for the session panel (a `useSessionRailViews` rail view).
 *
 * Renders the session totals ({@link UsageWidget}) plus the #362 model
 * provenance list: per run, its primary model with its tokens — for a
 * metered Cursor Auto run, the only honest answer to "which model actually
 * ran", since the requested model is empty by definition there — paired
 * with the tier the runner REQUESTED (the streaming summary's audit record
 * that the account default was never left in control). Requested-vs-served
 * divergence is a platform alarm (`stigmer.billing.service_tier.mismatch`),
 * not a per-row UI concern.
 *
 * Rendered in the session panel's shared facet vocabulary (see
 * `./primitives.tsx`). Shows an empty state when no usage data is available.
 */
export function UsageTab({ runs }: UsageTabProps) {
  const usage = useSessionUsage(runs);

  if (!usage.hasUsage) {
    return (
      <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:px-4 stg:py-8 stg:text-center">
        <p className="stg:text-xs stg:text-muted-foreground">
          No usage data yet. Token counts will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-5">
      <UsageWidget runs={runs} />
      <FacetSection heading="Working time">
        <p className="stg:px-2 stg:text-xs stg:tabular-nums stg:text-foreground">
          {formatWorkingTime(usage.workingSeconds)}
        </p>
        <p className="stg:px-2 stg:pt-1 stg:text-2xs stg:text-muted-foreground">
          Time an agent was working on this session; waiting for a person is not counted.
        </p>
      </FacetSection>
      {usage.runBreakdown.length > 0 && (
        <ExecutionModelList
          entries={usage.runBreakdown}
          runs={runs}
        />
      )}
    </div>
  );
}

/**
 * Per-execution model provenance rows, in the report's chronological
 * order: `#N model [tier requested] [Estimated]  18.4k tokens · 4m 12s`.
 */
function ExecutionModelList({
  entries,
  runs,
}: {
  readonly entries: readonly RunUsageEntry[];
  readonly runs: readonly Run[];
}) {
  return (
    <FacetSection heading="Per run">
      <div role="list" aria-label="Per-run tokens, working time, model and tier" className="stg:flex stg:flex-col">
        {entries.map((entry, index) => {
          const requestedTier = requestedTierLabel(runs, entry.runId);
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
              <span className="stg:shrink-0 stg:tabular-nums stg:text-2xs stg:text-muted-foreground">
                {formatTokens(entry.totalTokens)} · {formatWorkingTime(entry.workingSeconds)}
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
    <span className="stg:ml-1 stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:text-2xs stg:font-medium stg:leading-none stg:text-muted-foreground">
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
  executions: readonly Run[],
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
