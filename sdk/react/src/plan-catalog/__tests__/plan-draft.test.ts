// The plan form's draft: dollars become exact micros, the first wrong
// field is named, a limit is a whole number above zero, child
// organizations are asked only of a plan that admits them, an hourly price
// for agent hours needs the hours it is charged past, and features are
// deduplicated in contract order.

import { describe, expect, it } from "vitest";
import { PlanInstrument } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { EMPTY_PLAN_DRAFT, parseLimit, parseUsd, planInputFromDraft } from "../plan-draft";

describe("parsing", () => {
  it("reads dollars exactly, to the cent", () => {
    expect(parseUsd("99")).toBe(99_000_000n);
    expect(parseUsd("99.5")).toBe(99_500_000n);
    expect(parseUsd(" 0.07 ")).toBe(70_000n);
    expect(parseUsd("9.999")).toBeNull();
    expect(parseUsd("-1")).toBeNull();
  });

  it("reads a limit as a whole number above zero, since zero is no limit an operator means", () => {
    expect(parseLimit(" 50 ")).toBe(50);
    expect(parseLimit("2147483647")).toBe(2_147_483_647);
    expect(parseLimit("0")).toBeNull();
    expect(parseLimit("-3")).toBeNull();
    expect(parseLimit("2.5")).toBeNull();
    expect(parseLimit("1e3")).toBeNull();
    expect(parseLimit("2147483648")).toBeNull();
  });
});

describe("planInputFromDraft", () => {
  const draft = { ...EMPTY_PLAN_DRAFT, name: "Team 2027", slug: "team-2027", monthlyMinimumUsd: "129" };

  it("builds a subscription plan whose terms are its monthly fee", () => {
    const result = planInputFromDraft({ ...draft, features: [Feature.teams, Feature.channels, Feature.teams] });
    expect(result).toEqual({
      ok: true,
      input: {
        name: "Team 2027",
        slug: "team-2027",
        org: "",
        instrument: PlanInstrument.subscription,
        entitlements: { features: [Feature.channels, Feature.teams] },
        terms: { monthlyMinimumMicros: 129_000_000n },
      },
    });
  });

  it("carries the included child organizations and their fee only for a plan that admits them", () => {
    const result = planInputFromDraft({
      ...draft,
      features: [Feature.child_orgs],
      includedChildOrgs: "5",
      perExtraOrganizationUsd: "25",
    });
    expect(result.ok && result.input.entitlements.limits).toEqual({ includedChildOrgs: 5 });
    expect(result.ok && result.input.terms?.perExtraOrgMicros).toBe(25_000_000n);
    const ignored = planInputFromDraft({ ...draft, includedChildOrgs: "5" });
    expect(ignored.ok && ignored.input.entitlements.limits).toBeUndefined();
  });

  it("carries the agent hours included and the price of each hour over", () => {
    const result = planInputFromDraft({ ...draft, includedAgentHours: "50", perAgentHourUsd: "0.50" });
    expect(result.ok && result.input.entitlements.limits).toEqual({ includedAgentHours: 50 });
    expect(result.ok && result.input.terms?.perAgentHourMicros).toBe(500_000n);
    const pauses = planInputFromDraft({ ...draft, includedAgentHours: "10" });
    expect(pauses.ok && pauses.input.terms).toEqual({ monthlyMinimumMicros: 129_000_000n });
    const both = planInputFromDraft({
      ...draft,
      features: [Feature.child_orgs],
      includedChildOrgs: "5",
      includedAgentHours: "50",
    });
    expect(both.ok && both.input.entitlements.limits).toEqual({ includedChildOrgs: 5, includedAgentHours: 50 });
  });

  it("refuses what the contract refuses: a zero limit, and an hourly price that is zero or has no hours to exceed", () => {
    expect(
      planInputFromDraft({ ...draft, features: [Feature.child_orgs], includedChildOrgs: "0" }),
    ).toMatchObject({ ok: false, field: "includedChildOrgs" });
    expect(planInputFromDraft({ ...draft, includedAgentHours: "0" })).toMatchObject({
      ok: false,
      field: "includedAgentHours",
    });
    expect(planInputFromDraft({ ...draft, perAgentHourUsd: "0.50" })).toMatchObject({
      ok: false,
      field: "perAgentHourUsd",
    });
    expect(planInputFromDraft({ ...draft, includedAgentHours: "50", perAgentHourUsd: "0" })).toMatchObject({
      ok: false,
      field: "perAgentHourUsd",
    });
  });

  it("names the first field that is wrong", () => {
    expect(planInputFromDraft({ ...draft, name: " " })).toMatchObject({ ok: false, field: "name" });
    expect(planInputFromDraft({ ...draft, slug: "Team 2027" })).toMatchObject({ ok: false, field: "slug" });
    expect(planInputFromDraft({ ...draft, monthlyMinimumUsd: "lots" })).toMatchObject({
      ok: false,
      field: "monthlyMinimumUsd",
    });
    expect(
      planInputFromDraft({ ...draft, features: [Feature.child_orgs], includedChildOrgs: "2.5" }),
    ).toMatchObject({ ok: false, field: "includedChildOrgs" });
  });
});
