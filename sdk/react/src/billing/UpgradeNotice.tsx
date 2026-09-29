"use client";

import { cn } from "@stigmer/theme";
import { getErrorReason, getUserMessage } from "@stigmer/sdk";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { FEATURE_COPY, isNamedFeature } from "../internal/features.js";

/**
 * The reason Stigmer Cloud refuses an act the organization's plan does not
 * include (iam/team/v1 and tenancy/organization/v1 command.proto).
 */
export const PLAN_UPGRADE_REQUIRED = "PLAN_UPGRADE_REQUIRED";

/** The billing page the notice links to by default: the settings route every client serves. */
export const DEFAULT_BILLING_HREF = "/settings/billing";

/** The wire names the refusal's `feature` metadata carries. */
const FEATURE_BY_WIRE_NAME: Readonly<Record<string, Feature>> = {
  teams: Feature.teams,
  managed_organizations: Feature.managed_organizations,
  byo_provider_keys: Feature.byo_provider_keys,
};

/**
 * The feature a refusal says the organization's plan lacks, when `error`
 * is Stigmer Cloud's `PLAN_UPGRADE_REQUIRED`; `null` for any other error.
 */
export function planUpgradeFeature(error: unknown): Feature | null {
  const reason = getErrorReason(error);
  if (reason?.reason !== PLAN_UPGRADE_REQUIRED) {
    return null;
  }
  return FEATURE_BY_WIRE_NAME[reason.metadata.feature ?? ""] ?? null;
}

/** Props for {@link UpgradeNotice}. */
export interface UpgradeNoticeProps {
  /** The feature the organization's plan lacks. */
  readonly feature: Feature;
  /**
   * The refusal, when there was one: its message is the server's own
   * copy, which names the plan that unlocks the act. Absent, the notice is
   * shown ahead of an attempt.
   */
  readonly error?: Error | null;
  /**
   * The plan that unlocks the feature, named ahead of an attempt, e.g. the
   * cheapest one that includes it (`lowestPlanWith`). With a refusal,
   * the server's copy names it instead.
   */
  readonly unlockingPlanName?: string;
  /** Where the plans are, in the host's routing. Defaults to {@link DEFAULT_BILLING_HREF}. */
  readonly billingHref?: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Says an act needs a plan that includes it, and where to change the plan,
 * in place of a bare refusal. Everything the organization already has keeps
 * working; only creating more is refused.
 *
 * @example
 * ```tsx
 * const feature = planUpgradeFeature(error);
 * if (feature !== null) return <UpgradeNotice feature={feature} error={error} />;
 * ```
 */
export function UpgradeNotice({
  feature,
  error,
  unlockingPlanName,
  billingHref = DEFAULT_BILLING_HREF,
  className,
}: UpgradeNoticeProps) {
  const label = isNamedFeature(feature) ? FEATURE_COPY[feature].label : "This feature";
  const ahead =
    unlockingPlanName === undefined || unlockingPlanName === ""
      ? `${label} are not included in this organization's plan.`
      : `${label} need the ${unlockingPlanName} plan or above.`;
  const message = error ? getUserMessage(error) : ahead;
  return (
    <div
      className={cn(
        "stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-xs",
        className,
      )}
      role="status"
    >
      <p className="stg:text-foreground">{message}</p>
      <a href={billingHref} className="stg:mt-1 stg:inline-block stg:font-medium stg:text-primary stg:hover:underline">
        View plans
      </a>
    </div>
  );
}
