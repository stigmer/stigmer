"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import {
  PeriodEstimateLineKind,
  type PeriodEstimate,
  type PeriodEstimateLine,
} from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import { StatusBadge } from "../resource-workbench/components/StatusBadge.js";
import { formatCreditBalance, formatLedgerAmount } from "./format.js";
import { formatDay, formatPeriodDay } from "./plan-features.js";
import type { PlanStanding } from "./plan-state.js";

/** Props for {@link PlanCard}. */
export interface PlanCardProps {
  /** The plan's display name ("Free" when there is none). */
  readonly planName: string;
  /** Where the organization stands on it. */
  readonly standing: PlanStanding;
  /** The current period's estimated invoice, when a plan is live. */
  readonly estimate?: PeriodEstimate | null;
  /** Why the estimate could not be read, shown in its place. */
  readonly estimateError?: Error | null;
  /**
   * The organization is platform-managed: it is on its integrator's plan
   * and has no plan, period or invoice of its own.
   */
  readonly managed?: boolean;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * The organization's plan: its name, its standing (active, payment
 * failed, or ending on a date), the period it is in, and the period's
 * estimated invoice line by line, the way the invoice will read it.
 */
export function PlanCard({ planName, standing, estimate, estimateError, managed, className }: PlanCardProps) {
  return (
    <div
      className={cn(
        "stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-4",
        className,
      )}
    >
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">Plan</h3>
        {!managed && <StandingBadge standing={standing} />}
      </div>
      <p className="stg:mt-2 stg:text-sm stg:font-medium stg:text-foreground">
        {managed ? "Your integrator's plan" : planName}
      </p>

      {managed ? (
        <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
          This organization is managed by its integrator and runs on the integrator&apos;s plan. It has no plan or
          invoice of its own.
        </p>
      ) : (
        <StandingDetail standing={standing} />
      )}

      {!managed && estimate && <EstimateLines planName={planName} estimate={estimate} />}
      {!managed && !estimate && estimateError && (
        <p className="stg:mt-3 stg:text-xs stg:text-destructive" role="alert">
          {getUserMessage(estimateError)}
        </p>
      )}
    </div>
  );
}

function StandingBadge({ standing }: { standing: PlanStanding }) {
  switch (standing.kind) {
    case "active":
      return <StatusBadge phase="ready" label="Active" />;
    case "past-due":
      return <StatusBadge phase="failed" label="Payment failed" />;
    case "ending":
      return <StatusBadge phase="degraded" label={`Ends ${formatDay(standing.endsAt)}`} />;
    case "free":
      return <StatusBadge phase="disabled" label="Free" />;
    default: {
      const exhaustive: never = standing;
      return exhaustive;
    }
  }
}

function StandingDetail({ standing }: { standing: PlanStanding }) {
  switch (standing.kind) {
    case "free":
      return (
        <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
          Channels, sharing and unlimited members. Usage is paid from credits.
        </p>
      );
    case "past-due":
      return (
        <p className="stg:mt-1 stg:text-xs stg:text-destructive" role="status">
          The last period&apos;s payment failed. Stripe retries it; update the card under Payment Method. The plan stays
          in force meanwhile.
        </p>
      );
    case "ending":
      return (
        <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
          Canceled. The plan stays in force until {formatDay(standing.endsAt)}, then this
          organization is on Free. Nothing you built is deleted.
        </p>
      );
    case "active":
      return null;
    default: {
      const exhaustive: never = standing;
      return exhaustive;
    }
  }
}

function EstimateLines({ planName, estimate }: { planName: string; estimate: PeriodEstimate }) {
  return (
    <div className="stg:mt-4 stg:border-t stg:border-border stg:pt-3">
      <div className="stg:flex stg:items-baseline stg:justify-between stg:gap-3">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">
          Estimated invoice on {formatPeriodDay(estimate.periodEnd)}
        </p>
        <p className="stg:text-xs stg:text-muted-foreground">
          Period {formatPeriodDay(estimate.periodStart)} – {formatPeriodDay(estimate.periodEnd)}
        </p>
      </div>
      <dl className="stg:mt-2 stg:space-y-1">
        {estimate.lines.map((line) => (
          <div key={line.kind} className="stg:flex stg:justify-between stg:gap-3 stg:text-xs">
            <dt className="stg:text-muted-foreground">{lineLabel(line, planName, estimate)}</dt>
            <dd className="stg:tabular-nums stg:text-foreground">
              {line.amountMicros < BigInt(0) ? formatLedgerAmount(line.amountMicros) : formatCreditBalance(line.amountMicros)}
            </dd>
          </div>
        ))}
        <div className="stg:flex stg:justify-between stg:gap-3 stg:border-t stg:border-border stg:pt-1 stg:text-xs stg:font-medium">
          <dt className="stg:text-foreground">Total so far</dt>
          <dd className="stg:tabular-nums stg:text-foreground">{formatCreditBalance(estimate.totalMicros)}</dd>
        </div>
      </dl>
      <p className="stg:mt-2 stg:text-xs stg:text-muted-foreground">
        From usage so far. Usage itself is paid from credits; the commission already paid on it counts toward the
        minimum, which covers the whole period.
      </p>
    </div>
  );
}

function lineLabel(line: PeriodEstimateLine, planName: string, estimate: PeriodEstimate): string {
  switch (line.kind) {
    case PeriodEstimateLineKind.plan:
      return `${planName} plan`;
    case PeriodEstimateLineKind.commission_credit:
      return "Commission already paid on tokens";
    case PeriodEstimateLineKind.managed_organizations:
      return `Managed organizations beyond those included (${estimate.managedOrganizationCount} this period)`;
    case PeriodEstimateLineKind.period_estimate_line_kind_unspecified:
      return "Other";
    default: {
      const exhaustive: never = line.kind;
      return String(exhaustive);
    }
  }
}

