"use client";

import { getUserMessage } from "@stigmer/client";
import { agentHoursUsedUp } from "./refusals.js";
import { Notice } from "../internal/surface/Notice.js";
import { DEFAULT_BILLING_HREF } from "./UpgradeNotice.js";

export { AGENT_HOURS_USED_UP, agentHoursUsedUp, type AgentHoursUsedUp } from "./refusals.js";

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
 * function RunError({ error }: { error: Error }) {
 *   if (agentHoursUsedUp(error) !== null) return <AgentHoursNotice error={error} />;
 *   return <ErrorMessage error={error} />;
 * }
 * ```
 */
export function AgentHoursNotice({ error, billingHref = DEFAULT_BILLING_HREF, className }: AgentHoursNoticeProps) {
  const plan = agentHoursUsedUp(error)?.plan ?? "";
  return (
    <Notice
      tone="paused"
      role="alert"
      // A child organization's hours are its parent's: the server's words say so, and it has no plans to offer.
      headline={plan !== "" ? "Your organization has used this month's agent hours." : getUserMessage(error)}
      link={plan !== "" ? { label: "View plans", href: billingHref } : undefined}
      className={className}
    >
      <p className="stg:m-0">
        {plan !== "" ? "Agents run again when the hours renew, or sooner on a bigger plan. Your message stays in the box." : "Your message stays in the box."}
      </p>
    </Notice>
  );
}
