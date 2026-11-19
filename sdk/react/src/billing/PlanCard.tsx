"use client";

import { cn } from "@stigmer/design-tokens";
import {
  PeriodEstimateLineKind,
  type PeriodEstimate,
  type PeriodEstimateLine,
} from "@stigmer/apis/ai/stigmer/billing/subscription/v1/io_pb";
import type { AgentHours } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/io_pb";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Card } from "../internal/surface/Card.js";
import { Figure, Figures } from "../internal/surface/Figure.js";
import { Section } from "../resource-detail/Section.js";
import { Table, type TableColumn } from "../internal/surface/Table.js";
import { StatusBadge } from "../status/StatusBadge.js";
import { useOrgDisplayName } from "../organization/useOrgDisplayName.js";
import { agentHoursFigure } from "./AgentHoursStanding.js";
import { formatUsd } from "./format.js";
import { formatAgentHours, formatDay, formatPeriodDay } from "./plan-features.js";
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
  /** Where the organization stands against its plan's agent hours, shown above the estimate. */
  readonly agentHours?: AgentHours | null;
  /** Why the agent hours could not be read, shown in their place. */
  readonly agentHoursError?: Error | null;
  /** Reads the estimate again after it failed; its error offers Retry when given. */
  readonly onRetryEstimate?: () => void;
  /** Reads the agent hours again after they failed; their error offers Retry when given. */
  readonly onRetryAgentHours?: () => void;
  /**
   * Set for a child organization, which is on its parent's plan and has no
   * plan, period or invoice of its own: the parent's name, or "" when it
   * cannot be shown. Unset for an organization with no parent.
   */
  readonly billedToParent?: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * The organization's plan: its name, its standing (active, payment
 * failed, or ending on a date), the agent hours it has used of those the
 * plan includes, the period it is in, and the period's estimated invoice
 * line by line, the way the invoice will read it.
 */
export function PlanCard({
  planName,
  standing,
  estimate,
  estimateError,
  agentHours,
  agentHoursError,
  onRetryEstimate,
  onRetryAgentHours,
  billedToParent,
  className,
}: PlanCardProps) {
  if (billedToParent !== undefined) {
    return (
      <Card className={className}>
        <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">Plan</h3>
        <p className="stg:mt-2 stg:text-sm stg:font-medium stg:text-foreground">
          {`Billed to ${billedToParent === "" ? "its parent organization" : billedToParent}`}
        </p>
        <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
          This is a child organization: it runs on its parent organization&apos;s plan, and has no plan or invoice
          of its own.
        </p>
      </Card>
    );
  }

  const hours = agentHours ? agentHoursFigure(agentHours) : null;
  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      {/* The plan, this period's hours and its estimated invoice, at a glance. */}
      <Figures columns={hours ? 3 : 2} aria-label="This period">
        <Figure label="Plan" value={planName} line={<StandingBadge standing={standing} />} />
        {hours && <Figure label={hours.label} value={hours.value} line={hours.line} />}
        <Figure
          label="Estimated invoice"
          value={estimate ? formatUsd(estimate.totalMicros) : "—"}
          line={
            estimate
              ? `On ${formatPeriodDay(estimate.periodEnd)}, for ${formatPeriodDay(estimate.periodStart)} to ${formatPeriodDay(estimate.periodEnd)}.`
              : undefined
          }
        />
      </Figures>
      <StandingDetail standing={standing} />
      {!agentHours && agentHoursError && (
        <ErrorMessage error={agentHoursError} title="Couldn't load the agent hours." retry={onRetryAgentHours} />
      )}
      {hours && !estimate && (
        // With no invoice to sit under, the counting rule is said under the figures.
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
          Agent hours are counted while agents work in Stigmer&apos;s sandboxes, for this organization and its child
          organizations; automatic grading is never counted.
        </p>
      )}
      {estimate && <EstimateLines planName={planName} estimate={estimate} />}
      {!estimate && estimateError && (
        <ErrorMessage error={estimateError} title="Couldn't load this period's estimate." retry={onRetryEstimate} />
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
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
          Chat links, Slack and WhatsApp, and unlimited members.
        </p>
      );
    case "past-due":
      return (
        <p className="stg:m-0 stg:text-xs stg:text-destructive" role="status">
          The last period&apos;s payment failed. Stripe retries it; update the card under Payment method. The plan stays
          in force meanwhile.
        </p>
      );
    case "ending":
      return (
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
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

/** One line of the estimate as the invoice will read it, the total last. */
interface EstimateRow {
  readonly key: string;
  readonly label: string;
  readonly amount: string;
  /** The plan's own line, named at weight 500 as the drawn line names are. */
  readonly plan?: boolean;
  readonly total?: boolean;
}

const ESTIMATE_COLUMNS: readonly TableColumn<EstimateRow>[] = [
  {
    id: "line",
    header: "Line",
    cell: (row) => (
      <span className={row.total ? "stg:font-semibold" : row.plan ? "stg:font-medium" : "stg:font-normal"}>{row.label}</span>
    ),
  },
  {
    id: "amount",
    header: "Amount",
    align: "end",
    cell: (row) => <span className={row.total ? "stg:font-semibold" : undefined}>{row.amount}</span>,
  },
];

function EstimateLines({ planName, estimate }: { planName: string; estimate: PeriodEstimate }) {
  const orgName = useOrgDisplayName();
  const rows: EstimateRow[] = [
    ...estimate.lines.map((line) => ({
      key: String(line.kind),
      label: lineLabel(line, planName, estimate),
      amount: formatUsd(line.amountMicros),
      plan: line.kind === PeriodEstimateLineKind.plan,
    })),
    { key: "total", label: "Total so far", amount: formatUsd(estimate.totalMicros), total: true },
  ];
  return (
    <Section title="This period's invoice, so far">
      <Table aria-label="This period's invoice, so far" columns={ESTIMATE_COLUMNS} rows={rows} rowKey={(row) => row.key} bare />
      <p className="stg:m-0 stg:px-4 stg:py-3 stg:text-xs stg:text-muted-foreground">
        {`Agent hours are counted while agents work in Stigmer's sandboxes, for ${orgName} and its child organizations; automatic grading is never counted. Model usage runs on your own provider keys and is not on this invoice.`}
      </p>
    </Section>
  );
}

function lineLabel(line: PeriodEstimateLine, planName: string, estimate: PeriodEstimate): string {
  switch (line.kind) {
    case PeriodEstimateLineKind.plan:
      return `${planName} plan`;
    case PeriodEstimateLineKind.child_orgs:
      return `Child organizations beyond those included (${estimate.childOrgCount} this period)`;
    case PeriodEstimateLineKind.agent_hours:
      return `Agent hours beyond those included (${formatAgentHours(estimate.workingSeconds)} worked this period)`;
    case PeriodEstimateLineKind.period_estimate_line_kind_unspecified:
      return "Other";
    default: {
      const exhaustive: never = line.kind;
      return String(exhaustive);
    }
  }
}

