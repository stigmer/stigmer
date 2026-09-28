// Where an organization stands on its plan, and what choosing a plan
// would do, decided the way the server decides it (the subscription
// engine's moves), so the confirm step states the move the server makes.
//
//   subscribe  no live plan: a monthly period opens now on the plan
//   switch     a live plan, another chosen: this period closes early,
//              billed for the time it ran, and a new one opens now
//   resume     the plan being canceled, chosen again: the cancel is
//              withdrawn and the period runs on
//   cancel     Free chosen on a live plan: the plan runs to its period's
//              end, then the organization is on Free
//
// Choosing the plan already in force, or Free while on Free or already
// canceling, is no move at all.

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Plan } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import type { Subscription } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/api_pb";
import { SubscriptionState } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/status_pb";

/** An organization's standing on its plan. */
export type PlanStanding =
  | { readonly kind: "free" }
  | { readonly kind: "active"; readonly planId: string }
  | { readonly kind: "past-due"; readonly planId: string }
  | { readonly kind: "ending"; readonly planId: string; readonly endsAt: Date };

/** What choosing a plan (or Free) would do. */
export type PlanMove =
  | { readonly kind: "subscribe"; readonly to: Plan }
  | { readonly kind: "switch"; readonly fromPlanId: string; readonly to: Plan }
  | { readonly kind: "resume"; readonly to: Plan }
  | { readonly kind: "cancel"; readonly fromPlanId: string; readonly endsAt: Date };

/**
 * The standing a stored subscription gives at `now`: the engine's live
 * rule (active, past due, or canceled but not yet at its period's end),
 * else Free. `null` (never subscribed) is Free.
 */
export function planStanding(subscription: Subscription | null, now: Date): PlanStanding {
  const status = subscription?.status;
  const planId = subscription?.spec?.planId ?? "";
  switch (status?.state) {
    case SubscriptionState.active:
      return { kind: "active", planId };
    case SubscriptionState.past_due:
      return { kind: "past-due", planId };
    case SubscriptionState.canceled: {
      const end = status.currentPeriodEnd === undefined ? undefined : timestampDate(status.currentPeriodEnd);
      return end !== undefined && now.getTime() < end.getTime()
        ? { kind: "ending", planId, endsAt: end }
        : { kind: "free" };
    }
    default:
      return { kind: "free" };
  }
}

/** The move choosing `target` (a plan, or `"free"`) makes from `standing`, or `null` for none. */
export function planMove(
  standing: PlanStanding,
  target: Plan | "free",
  periodEnd: Date | undefined,
): PlanMove | null {
  if (target === "free") {
    if (standing.kind === "active" || standing.kind === "past-due") {
      return periodEnd === undefined ? null : { kind: "cancel", fromPlanId: standing.planId, endsAt: periodEnd };
    }
    return null;
  }
  const targetId = target.metadata?.id ?? "";
  switch (standing.kind) {
    case "free":
      return { kind: "subscribe", to: target };
    case "ending":
      return targetId === standing.planId
        ? { kind: "resume", to: target }
        : { kind: "switch", fromPlanId: standing.planId, to: target };
    case "active":
    case "past-due":
      return targetId === standing.planId ? null : { kind: "switch", fromPlanId: standing.planId, to: target };
    default: {
      const exhaustive: never = standing;
      throw new Error(`unknown plan standing ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The plan id in force for `standing`, or empty on Free. */
export function standingPlanId(standing: PlanStanding): string {
  return standing.kind === "free" ? "" : standing.planId;
}
