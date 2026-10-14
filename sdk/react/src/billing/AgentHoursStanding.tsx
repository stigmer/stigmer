"use client";

// Where an organization stands against its plan's agent hours, as the plan
// card shows it: the hours used of those included over a meter, and what
// the plan does at the allowance, read from the plan's own terms (an
// allowance with no hourly price pauses new work; with one, each hour past
// it is on the period's invoice). A plan that states no allowance shows the
// hours used and no meter. The words "agent hours" are the plan's billed
// unit; the Usage page's working time is the clock behind them.

import { cn } from "@stigmer/theme";
import { AgentHoursWindow, type AgentHours } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import { formatUsd } from "./format.js";
import { formatAgentHours, formatPeriodDay } from "./plan-features.js";

const SECONDS_PER_HOUR = 3600;

/** Props for {@link AgentHoursStanding}. */
export interface AgentHoursStandingProps {
  /** The organization's standing, from {@link useAgentHours}. */
  readonly hours: AgentHours;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * The plan card's agent hours block: "3.2 h of 10 h used this month" over
 * a meter, when the window resets, and what the plan does past its
 * allowance.
 */
export function AgentHoursStanding({ hours, className }: AgentHoursStandingProps) {
  const span = hours.window === AgentHoursWindow.calendar_month ? "this month" : "this period";
  const used = formatAgentHours(hours.workingSeconds);
  const included = hours.includedHours;
  const allowanceSeconds = included === undefined ? undefined : BigInt(included * SECONDS_PER_HOUR);
  const reached = allowanceSeconds !== undefined && hours.workingSeconds >= allowanceSeconds;
  const resets = formatPeriodDay(hours.windowEnd);
  const price = hours.perAgentHourMicros;

  return (
    <div className={cn("stg:mt-4 stg:border-t stg:border-border stg:pt-3", className)}>
      <p className="stg:text-xs stg:font-medium stg:text-foreground">Agent hours</p>
      <p className="stg:mt-1 stg:text-sm stg:tabular-nums stg:text-foreground">
        {included === undefined ? `${used} used ${span}` : `${used} of ${included} h used ${span}`}
      </p>
      {allowanceSeconds !== undefined && (
        <div
          role="meter"
          aria-label="Agent hours used"
          aria-valuemin={0}
          aria-valuemax={Number(allowanceSeconds)}
          aria-valuenow={Math.min(Number(hours.workingSeconds), Number(allowanceSeconds))}
          aria-valuetext={`${used} of ${included} h`}
          className="stg:mt-2 stg:h-1.5 stg:w-full stg:overflow-hidden stg:rounded-full stg:bg-muted"
        >
          <div
            className={cn("stg:h-full stg:rounded-full", reached ? "stg:bg-destructive" : "stg:bg-chart-2")}
            style={{ width: `${meterPercent(hours.workingSeconds, allowanceSeconds)}%` }}
          />
        </div>
      )}
      <p className={cn("stg:mt-2 stg:text-xs", reached && price === undefined ? "stg:text-destructive" : "stg:text-muted-foreground")}>
        {terms(reached, included, price, resets)}
      </p>
      <p className="stg:mt-2 stg:text-xs stg:text-muted-foreground">
        Counted while agents work in Stigmer&apos;s sandboxes, for this organization and its child organizations;
        automatic grading is never counted. The Usage page shows working time by agent.
      </p>
    </div>
  );
}

/** What the plan does at its allowance, in its own terms. */
function terms(reached: boolean, included: number | undefined, price: bigint | undefined, resets: string): string {
  if (included === undefined) {
    return `The count resets ${resets} (UTC).`;
  }
  if (price === undefined) {
    return reached
      ? `The allowance is used: new work is paused until the count resets ${resets} (UTC).`
      : `Resets ${resets} (UTC). New work pauses at the allowance.`;
  }
  return reached
    ? `Past the allowance: each hour is ${formatUsd(price)} on this period's invoice. Resets ${resets} (UTC).`
    : `Resets ${resets} (UTC). Then ${formatUsd(price)} an hour, on this period's invoice.`;
}

/** The meter's fill, whole percent, full at or past the allowance. */
function meterPercent(used: bigint, allowance: bigint): number {
  if (allowance <= BigInt(0) || used >= allowance) {
    return 100;
  }
  return Math.floor((Number(used) / Number(allowance)) * 100);
}
