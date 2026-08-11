"use client";

// Usage facet for the workflow execution panel's activity rail.
// Domain: workflow (the budget/rollup analog of session/facets/UsageTab).

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import type {
  DerivedCostSummary,
  DerivedTaskState,
} from "../../internal/store/workflow-execution-event-store.js";
import { deriveWorkflowUsageItems } from "../deriveWorkflowUsageItems.js";
import type { WorkflowUsageItem } from "../deriveWorkflowUsageItems.js";
import { formatMicroUsd, formatTokenCount } from "../format-utils.js";

const BIGINT_ZERO = BigInt(0);

/** Props for {@link WorkflowUsageTab}. */
export interface WorkflowUsageTabProps {
  /** Execution-level cost/budget rollup (from `useWorkflowExecutionEventStream`). */
  readonly costSummary: DerivedCostSummary;
  /** Per-task derived states — drives the per-task breakdown list. */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
}

/**
 * Usage facet for the workflow execution panel (a
 * `useWorkflowExecutionRailViews` rail view): the execution-level cost/token
 * rollup with budget context on top, and a per-task breakdown (most expensive
 * first) below — "which task is burning my budget?" at a glance.
 *
 * The aggregate and the breakdown deliberately come from different derived
 * sources and are NEVER reconciled against each other: the aggregate reads
 * `costSummary` (authoritative — the latest `budget_checkpoint` can include
 * mid-task and orchestration usage), while rows read `taskStates` (summed
 * from per-task events). Summing the rows to "fix" the aggregate would
 * under-report; scaling rows to match the aggregate would fabricate data.
 *
 * Model-level detail (per-model breakdown, prompt/completion split) is
 * absent by design: no workflow usage-report data source exists yet — that
 * is a backend-gated later slice, not a frontend omission.
 */
export function WorkflowUsageTab({
  costSummary,
  taskStates,
}: WorkflowUsageTabProps) {
  const items = useMemo(
    () => deriveWorkflowUsageItems(taskStates),
    [taskStates],
  );

  const hasAggregate =
    costSummary.costConsumedMicros > BIGINT_ZERO ||
    costSummary.tokensConsumed > BIGINT_ZERO;

  if (!hasAggregate && items.length === 0) {
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
      <UsageSummary costSummary={costSummary} />

      {items.length > 0 && (
        <div className="stg:flex stg:flex-col stg:gap-1">
          <h3 className="stg:px-2 stg:text-xs stg:font-semibold stg:uppercase stg:tracking-wider stg:text-muted-foreground">
            By task
          </h3>
          <ul role="list" className="stg:flex stg:flex-col">
            {items.map((item) => (
              <UsageRow key={item.taskName} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The execution-level rollup block: consumed cost/tokens with the budget
 * limit when the stream reported one (`remaining >= 0` — `-1` means "no
 * limit known"), a budget progress gauge per known limit (absorbed from the
 * retired sidebar `WorkflowExecutionCostPanel` so the layout consolidation
 * lost no information), plus an explicit threshold-breach notice (text +
 * icon, never color alone).
 */
function UsageSummary({
  costSummary,
}: {
  readonly costSummary: DerivedCostSummary;
}) {
  const costLimit =
    costSummary.costRemainingMicros >= BIGINT_ZERO
      ? costSummary.costConsumedMicros + costSummary.costRemainingMicros
      : undefined;
  const tokenLimit =
    costSummary.tokensRemaining >= BIGINT_ZERO
      ? costSummary.tokensConsumed + costSummary.tokensRemaining
      : undefined;

  return (
    <div
      className="stg:flex stg:flex-col stg:gap-1.5 stg:px-2"
      role="region"
      aria-label="Execution cost summary"
    >
      <div className="stg:flex stg:items-baseline stg:gap-1.5">
        <span className="stg:text-sm stg:font-medium stg:tabular-nums stg:text-foreground">
          {formatMicroUsd(costSummary.costConsumedMicros)}
        </span>
        {costLimit !== undefined && (
          <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
            of {formatMicroUsd(costLimit)} budget
          </span>
        )}
      </div>
      <BudgetGauge
        consumed={costSummary.costConsumedMicros}
        limit={costLimit}
        breached={costSummary.thresholdBreached}
        label="Cost budget"
      />

      <div className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        {formatTokenCount(costSummary.tokensConsumed)} tokens
        {tokenLimit !== undefined && ` of ${formatTokenCount(tokenLimit)}`}
      </div>
      <BudgetGauge
        consumed={costSummary.tokensConsumed}
        limit={tokenLimit}
        breached={costSummary.thresholdBreached}
        label="Token budget"
      />

      {costSummary.thresholdBreached && (
        <p className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-warning">
          <WarningIcon />
          Budget threshold breached
        </p>
      )}
    </div>
  );
}

/**
 * Budget consumption bar + percentage, shown only when a limit is known.
 * The color shift (primary → warning past 80% or on breach) is a secondary
 * channel — the breach notice above carries the accessible signal.
 */
function BudgetGauge({
  consumed,
  limit,
  breached,
  label,
}: {
  readonly consumed: bigint;
  readonly limit: bigint | undefined;
  readonly breached: boolean;
  readonly label: string;
}) {
  if (limit === undefined || limit <= BIGINT_ZERO) return null;
  const percentage = Number((consumed * BigInt(100)) / limit);

  return (
    <div className="stg:flex stg:items-center stg:gap-2" aria-label={label}>
      <div
        role="progressbar"
        aria-valuenow={Math.min(percentage, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="stg:h-1.5 stg:min-w-0 stg:flex-1 stg:overflow-hidden stg:rounded-full stg:bg-muted"
      >
        <div
          className={cn(
            "stg:h-full stg:rounded-full stg:transition-all",
            breached || percentage > 80 ? "stg:bg-warning" : "stg:bg-primary",
          )}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <span className="stg:shrink-0 stg:text-[10px] stg:tabular-nums stg:text-muted-foreground">
        {percentage.toFixed(0)}%
      </span>
    </div>
  );
}

/**
 * One per-task usage row — a static entry: the task's own card in the
 * thread is where its detail lives (T06), so the breakdown reports rather
 * than navigates.
 */
function UsageRow({ item }: { readonly item: WorkflowUsageItem }) {
  return (
    <li className="stg:flex stg:items-stretch">
      <div className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-2 stg:px-2 stg:py-1 stg:text-left stg:text-xs stg:text-muted-foreground">
        <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-foreground">
          {item.taskName}
          <span className="stg:ml-1.5 stg:text-[0.65rem] stg:text-muted-foreground">
            {item.kindLabel}
            {isInFlight(item.status) && ` · ${statusLabel(item.status)}`}
          </span>
        </span>
        <span className="stg:shrink-0 stg:tabular-nums stg:text-foreground">
          {formatMicroUsd(item.costMicros)}
        </span>
        <span className="stg:w-14 stg:shrink-0 stg:text-right stg:tabular-nums stg:text-[0.65rem] stg:text-muted-foreground-faint">
          {formatTokenCount(item.tokensUsed)} tok
        </span>
      </div>
    </li>
  );
}

/** Whether a task is still accruing usage (live tokens keep updating). */
function isInFlight(status: WorkflowUsageItem["status"]): boolean {
  return (
    status === "running" ||
    status === "retrying" ||
    status === "waiting_approval"
  );
}

function statusLabel(status: WorkflowUsageItem["status"]): string {
  return status === "waiting_approval" ? "waiting approval" : status;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function WarningIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
