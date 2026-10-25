"use client";

import { cn } from "@stigmer/design-tokens";
import type { Plan } from "@stigmer/apis/ai/stigmer/billing/plan/v1/api_pb";
import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { Button } from "../button/index.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { FEATURE_COPY } from "../internal/features.js";
import {
  ENTERPRISE_CLOUD_PLAN,
  formatAgentHoursTerms,
  formatAgentsAtOnce,
  formatChildOrgs,
  formatMonthlyFee,
  offeredFeatures,
} from "./plan-features.js";
import { planMove, type PlanMove, type PlanStanding } from "./plan-state.js";

/** Where Enterprise Cloud enquiries go by default. */
export const ENTERPRISE_CONTACT_URL = "https://stigmer.ai/contact-sales";

/** Props for {@link PlanPicker}. */
export interface PlanPickerProps {
  /** The plans that can be bought, cheapest first, as `buyablePlans` orders them. */
  readonly plans: readonly Plan[];
  /** Where the organization stands. */
  readonly standing: PlanStanding;
  /** The live period's end, which a cancel runs to. */
  readonly periodEnd?: Date;
  /**
   * Whether the viewer may change the plan (`can_manage_billing`). Without
   * it the comparison is read-only.
   */
  readonly canManage: boolean;
  /** Called with the move a choice makes; the host confirms it. */
  readonly onChoose: (move: PlanMove) => void;
  /** Disables every choice, e.g. while a change is in flight. */
  readonly disabled?: boolean;
  /** Where "Talk to us" for Enterprise Cloud links. Defaults to {@link ENTERPRISE_CONTACT_URL}. */
  readonly enterpriseHref?: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * The plan comparison: Free, each plan that can be bought, and
 * Enterprise Cloud, each with its price and what it offers today. A choice
 * reports the move it makes (subscribe, switch, resume or cancel) for the
 * host to confirm; the plan in force reads "Current plan".
 */
export function PlanPicker({
  plans,
  standing,
  periodEnd,
  canManage,
  onChoose,
  disabled,
  enterpriseHref = ENTERPRISE_CONTACT_URL,
  className,
}: PlanPickerProps) {
  const freeMove = planMove(standing, "free", periodEnd);
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:grid stg:gap-3 stg:sm:grid-cols-2", className)} aria-label="Plans">
      <PlanOption
        name="Free"
        price="$0/month"
        features={[FEATURE_COPY[Feature.channels].label, FEATURE_COPY[Feature.sharing].label, "Unlimited members"]}
        current={standing.kind === "free"}
        action={canManage && freeMove !== null ? { label: "Move to Free", move: freeMove } : undefined}
        disabled={disabled}
        onChoose={onChoose}
      />
      {plans.map((plan) => {
        const move = planMove(standing, plan, periodEnd);
        const managed = formatChildOrgs(plan.spec?.entitlements, plan.spec?.terms);
        const hours = formatAgentHoursTerms(plan.spec?.entitlements, plan.spec?.terms);
        const atOnce = formatAgentsAtOnce(plan.spec?.entitlements);
        return (
          <PlanOption
            key={plan.metadata?.id ?? plan.metadata?.slug}
            name={plan.metadata?.name ?? ""}
            price={formatMonthlyFee(plan.spec?.terms)}
            features={[
              ...offeredFeatures(plan.spec?.entitlements).map((feature) => feature.label),
              ...(managed === "" ? [] : [managed]),
              ...(hours === "" ? [] : [hours]),
              ...(atOnce === "" ? [] : [atOnce]),
            ]}
            current={move === null && standing.kind !== "free"}
            action={canManage && move !== null ? { label: actionLabel(move), move } : undefined}
            disabled={disabled}
            onChoose={onChoose}
          />
        );
      })}
      <li className="stg:flex stg:flex-col stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4">
        <div className="stg:flex stg:items-baseline stg:justify-between stg:gap-2">
          <p className="stg:text-sm stg:font-medium stg:text-foreground">{ENTERPRISE_CLOUD_PLAN.name}</p>
          <p className="stg:text-xs stg:text-foreground">Quoted</p>
        </div>
        <ul className={cn(UNSTYLED_LIST, "stg:mt-2 stg:space-y-0.5 stg:text-xs stg:text-muted-foreground")}>
          {[
            ENTERPRISE_CLOUD_PLAN.includes,
            ...ENTERPRISE_CLOUD_PLAN.features.map((feature) => FEATURE_COPY[feature].label),
            ENTERPRISE_CLOUD_PLAN.terms,
          ].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <a
          href={enterpriseHref}
          target="_blank"
          rel="noreferrer"
          className="stg:mt-3 stg:self-start stg:text-xs stg:font-medium stg:text-primary stg:hover:underline"
        >
          Talk to us
        </a>
      </li>
    </ul>
  );
}

function PlanOption({
  name,
  price,
  features,
  current,
  action,
  disabled,
  onChoose,
}: {
  readonly name: string;
  readonly price: string;
  readonly features: readonly string[];
  readonly current: boolean;
  readonly action?: { readonly label: string; readonly move: PlanMove };
  readonly disabled?: boolean;
  readonly onChoose: (move: PlanMove) => void;
}) {
  return (
    <li
      className={cn(
        "stg:flex stg:flex-col stg:rounded-lg stg:border stg:bg-card stg:p-4",
        current ? "stg:border-primary" : "stg:border-border",
      )}
      aria-current={current ? "true" : undefined}
    >
      <div className="stg:flex stg:items-baseline stg:justify-between stg:gap-2">
        <p className="stg:text-sm stg:font-medium stg:text-foreground">{name}</p>
        <p className="stg:text-xs stg:tabular-nums stg:text-foreground">{price}</p>
      </div>
      <ul className={cn(UNSTYLED_LIST, "stg:mt-2 stg:space-y-0.5 stg:text-xs stg:text-muted-foreground")}>
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <div className="stg:mt-auto stg:pt-3">
        {current ? (
          <span className="stg:text-xs stg:font-medium stg:text-primary">Current plan</span>
        ) : action ? (
          <Button
            variant={action.move.kind === "cancel" ? "outline" : "primary"}
            size="xs"
            disabled={disabled}
            onClick={() => onChoose(action.move)}
          >
            {action.label}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function actionLabel(move: PlanMove): string {
  switch (move.kind) {
    case "subscribe":
      return "Subscribe";
    case "switch":
      return `Switch to ${move.to.metadata?.name ?? "this plan"}`;
    case "resume":
      return `Keep ${move.to.metadata?.name ?? "this plan"}`;
    case "cancel":
      return "Move to Free";
    default: {
      const exhaustive: never = move;
      return String(exhaustive);
    }
  }
}
