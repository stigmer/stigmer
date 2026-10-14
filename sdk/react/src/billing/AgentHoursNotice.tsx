"use client";

import { cn } from "@stigmer/theme";
import { getErrorReason, getUserMessage } from "@stigmer/sdk";
import { DEFAULT_BILLING_HREF } from "./UpgradeNotice.js";

/**
 * The reason Stigmer Cloud refuses a new turn when the organization's plan
 * has used the agent hours it includes and new work pauses until they
 * reset. The refusal is FAILED_PRECONDITION with this reason and the
 * metadata `org`, `plan`, `included_hours` and `resets_at`; a guest or a
 * channel user is refused without it.
 */
export const AGENT_HOURS_USED_UP = "AGENT_HOURS_USED_UP";

/** What an `AGENT_HOURS_USED_UP` refusal names. */
export interface AgentHoursUsedUp {
  /** The organization the turn was refused in. */
  readonly org: string;
  /**
   * The plan whose hours are used; empty for a child organization, which is
   * on its parent's plan and cannot change it.
   */
  readonly plan: string;
  /** The hours the plan includes each month, as the refusal states them. */
  readonly includedHours: string;
  /** When the hours reset, an RFC 3339 instant; empty when the refusal names none. */
  readonly resetsAt: string;
}

/**
 * What a refusal names, when `error` is Stigmer Cloud's
 * `AGENT_HOURS_USED_UP`; `null` for any other error.
 */
export function agentHoursUsedUp(error: unknown): AgentHoursUsedUp | null {
  const reason = getErrorReason(error);
  if (reason?.reason !== AGENT_HOURS_USED_UP) {
    return null;
  }
  return {
    org: reason.metadata.org ?? "",
    plan: reason.metadata.plan ?? "",
    includedHours: reason.metadata.included_hours ?? "",
    resetsAt: reason.metadata.resets_at ?? "",
  };
}

/** Props for {@link AgentHoursNotice}. */
export interface AgentHoursNoticeProps {
  /**
   * The refusal: its message is the server's own copy, which names the
   * plan, the hours it includes and the day they reset, worded for the
   * person refused.
   */
  readonly error: Error;
  /** Where the plans are, in the host's routing. Defaults to {@link DEFAULT_BILLING_HREF}. */
  readonly billingHref?: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Says a new turn was not started because the organization's plan has
 * used its agent hours for the month, and where to change the plan, in
 * place of a bare refusal. A child organization's notice offers no plans:
 * its hours are its parent's.
 *
 * @example
 * ```tsx
 * if (agentHoursUsedUp(error) !== null) return <AgentHoursNotice error={error} />;
 * ```
 */
export function AgentHoursNotice({ error, billingHref = DEFAULT_BILLING_HREF, className }: AgentHoursNoticeProps) {
  const plan = agentHoursUsedUp(error)?.plan ?? "";
  return (
    <div
      className={cn(
        "stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-xs",
        className,
      )}
      role="alert"
    >
      <p className="stg:text-foreground">{getUserMessage(error)}</p>
      {plan !== "" && (
        <a href={billingHref} className="stg:mt-1 stg:inline-block stg:font-medium stg:text-primary stg:hover:underline">
          View plans
        </a>
      )}
    </div>
  );
}
