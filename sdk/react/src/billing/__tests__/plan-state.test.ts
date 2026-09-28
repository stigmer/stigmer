// The plan standing and move rules, pinned against the subscription
// engine's own moves: never subscribed and ended are Free; past due keeps
// the plan; canceled keeps it until its period ends; choosing the plan in
// force is no move, choosing it again while canceling resumes it, another
// plan switches, and Free cancels only a live plan.

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PlanSchema } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { SubscriptionSchema } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/api_pb";
import { SubscriptionState } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/status_pb";
import { planMove, planStanding } from "../plan-state";

const NOW = new Date("2027-02-10T00:00:00Z");
const END = new Date("2027-02-28T10:00:00Z");
const TEAM = create(PlanSchema, { metadata: { id: "pln_team", name: "Team" } });
const BUSINESS = create(PlanSchema, { metadata: { id: "pln_business", name: "Business" } });

function subscription(state: SubscriptionState, end = END) {
  return create(SubscriptionSchema, {
    spec: { planId: "pln_team" },
    status: { state, currentPeriodEnd: timestampFromDate(end) },
  });
}

describe("planStanding", () => {
  it("reads never subscribed, and a canceled period that ended, as Free", () => {
    expect(planStanding(null, NOW)).toEqual({ kind: "free" });
    expect(planStanding(subscription(SubscriptionState.canceled, new Date("2027-02-01T00:00:00Z")), NOW)).toEqual({
      kind: "free",
    });
  });

  it("keeps the plan while active, past due, or canceled before its period ends", () => {
    expect(planStanding(subscription(SubscriptionState.active), NOW)).toEqual({ kind: "active", planId: "pln_team" });
    expect(planStanding(subscription(SubscriptionState.past_due), NOW)).toEqual({ kind: "past-due", planId: "pln_team" });
    expect(planStanding(subscription(SubscriptionState.canceled), NOW)).toEqual({
      kind: "ending",
      planId: "pln_team",
      endsAt: END,
    });
  });
});

describe("planMove", () => {
  it("subscribes from Free, and Free from Free is no move", () => {
    expect(planMove({ kind: "free" }, TEAM, undefined)).toEqual({ kind: "subscribe", to: TEAM });
    expect(planMove({ kind: "free" }, "free", undefined)).toBeNull();
  });

  it("makes no move to the plan in force, switches to another, and cancels a live plan to its period's end", () => {
    const active = { kind: "active", planId: "pln_team" } as const;
    expect(planMove(active, TEAM, END)).toBeNull();
    expect(planMove(active, BUSINESS, END)).toEqual({ kind: "switch", fromPlanId: "pln_team", to: BUSINESS });
    expect(planMove(active, "free", END)).toEqual({ kind: "cancel", fromPlanId: "pln_team", endsAt: END });
    expect(planMove({ kind: "past-due", planId: "pln_team" }, "free", END)?.kind).toBe("cancel");
  });

  it("resumes the plan being canceled, switches to another, and cancels it no further", () => {
    const ending = { kind: "ending", planId: "pln_team", endsAt: END } as const;
    expect(planMove(ending, TEAM, END)).toEqual({ kind: "resume", to: TEAM });
    expect(planMove(ending, BUSINESS, END)?.kind).toBe("switch");
    expect(planMove(ending, "free", END)).toBeNull();
  });
});
