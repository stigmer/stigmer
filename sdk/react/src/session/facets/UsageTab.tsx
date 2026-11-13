"use client";

/**
 * Session Usage facet: the session's total tokens first, as a figure, with
 * its working time under it; then "By turn" (per run, its tokens, primary
 * model, working time and the tier the runner requested) and "By model".
 *
 * Usage is tokens, never money. The suite in
 * `session/__tests__/UsageTab.test.tsx` pins the empty line, the total
 * figure and its "Estimated" tag, the per-turn rows (tokens, working time,
 * model, tier, "Estimated"), the per-model rows, and the per-turn list's
 * absence before the report lists any run.
 */

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { useSessionUsage, type RunUsageEntry } from "@stigmer/react-core";
import { TokenFigure, UsageByModel, UsageTotal } from "../../run/UsageWidget.js";
import { formatWorkingTime } from "../../usage/format.js";
import { EmptyState } from "../../empty-state/EmptyState.js";
import { Tag } from "../../internal/surface/Tag.js";
import { List, ListRow } from "../../internal/surface/List.js";
import { FacetSection } from "./primitives.js";

export interface UsageTabProps {
  readonly runs: readonly Run[];
}

/**
 * Usage facet for the session panel (a `useSessionRailViews` rail view).
 *
 * Renders the session's total ({@link UsageTotal}), then "By turn" — the
 * #362 model provenance list: per run, its primary model with its tokens — what the
 * provider actually served — paired with the tier the runner REQUESTED (the streaming summary's audit record
 * that the account default was never left in control). Requested-vs-served
 * divergence is a platform alarm (`stigmer.billing.service_tier.mismatch`),
 * not a per-row UI concern.
 *
 * Rendered in the session panel's shared facet vocabulary (see
 * `./primitives.tsx`) on the kit's `List`. Shows one inline line, "No usage
 * yet", when no usage data is available.
 */
export function UsageTab({ runs }: UsageTabProps) {
  const usage = useSessionUsage(runs);

  if (!usage.hasUsage) {
    return (
      <EmptyState
        variant="first-use"
        size="inline"
        title="No usage yet"
        description="Tokens and working time appear here once a turn runs."
      />
    );
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-5">
      <UsageTotal usage={usage} />
      {usage.runBreakdown.length > 0 && (
        <UsageByTurn entries={usage.runBreakdown} runs={runs} />
      )}
      <UsageByModel usage={usage} />
    </div>
  );
}

/**
 * "By turn": per run, in the report's chronological order, its tokens at
 * the right and its model and working time under its name, tagged with the
 * tier the runner requested and "Estimated" when it is counted from its
 * runner's own report.
 */
function UsageByTurn({
  entries,
  runs,
}: {
  readonly entries: readonly RunUsageEntry[];
  readonly runs: readonly Run[];
}) {
  return (
    <FacetSection heading="By turn">
      <List aria-label="Tokens by turn">
        {entries.map((entry, index) => {
          const requestedTier = requestedTierLabel(runs, entry.runId);
          const detail = [
            entry.resolvedModel,
            entry.workingSeconds > 0 ? formatWorkingTime(entry.workingSeconds) : "",
          ].filter(Boolean).join(" · ");
          return (
            <ListRow
              key={entry.runId}
              name={`Turn ${index + 1}`}
              nameAdornment={
                requestedTier || entry.isEstimated ? (
                  <>
                    {requestedTier && <Tag>{requestedTier} requested</Tag>}
                    {entry.isEstimated && <Tag>Estimated</Tag>}
                  </>
                ) : undefined
              }
              description={detail || undefined}
              trailing={<TokenFigure count={entry.totalTokens} />}
            />
          );
        })}
      </List>
    </FacetSection>
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
