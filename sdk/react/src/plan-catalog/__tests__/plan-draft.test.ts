// The plan form's draft: dollars become exact micros and a percent basis
// points, the first wrong field is named, managed organizations are asked
// only of a plan that admits them, and features are deduplicated in
// contract order.

import { describe, expect, it } from "vitest";
import { PlanInstrument } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { EMPTY_PLAN_DRAFT, parseBasisPoints, parseUsd, planInputFromDraft } from "../plan-draft";

describe("parsing", () => {
  it("reads dollars exactly, to the cent", () => {
    expect(parseUsd("99")).toBe(99_000_000n);
    expect(parseUsd("99.5")).toBe(99_500_000n);
    expect(parseUsd(" 0.07 ")).toBe(70_000n);
    expect(parseUsd("9.999")).toBeNull();
    expect(parseUsd("-1")).toBeNull();
  });

  it("reads percents as basis points, up to 100%", () => {
    expect(parseBasisPoints("10")).toBe(1_000);
    expect(parseBasisPoints("12.5")).toBe(1_250);
    expect(parseBasisPoints("100")).toBe(10_000);
    expect(parseBasisPoints("101")).toBeNull();
  });
});

describe("planInputFromDraft", () => {
  const draft = { ...EMPTY_PLAN_DRAFT, name: "Team 2027", slug: "team-2027", monthlyMinimumUsd: "129" };

  it("builds a subscription plan", () => {
    const result = planInputFromDraft({ ...draft, features: [Feature.teams, Feature.channels, Feature.teams] });
    expect(result).toEqual({
      ok: true,
      input: {
        name: "Team 2027",
        slug: "team-2027",
        org: "",
        instrument: PlanInstrument.subscription,
        entitlements: { features: [Feature.channels, Feature.teams] },
        terms: { monthlyMinimumMicros: 129_000_000n, usageShareBasisPoints: 1_000 },
      },
    });
  });

  it("carries the included managed organizations and their fee only for a plan that admits them", () => {
    const result = planInputFromDraft({
      ...draft,
      features: [Feature.managed_organizations],
      includedManagedOrganizations: "5",
      perExtraOrganizationUsd: "25",
    });
    expect(result.ok && result.input.entitlements.limits).toEqual({ includedManagedOrganizations: 5 });
    expect(result.ok && result.input.terms?.perExtraOrgMicros).toBe(25_000_000n);
    const ignored = planInputFromDraft({ ...draft, includedManagedOrganizations: "5" });
    expect(ignored.ok && ignored.input.entitlements.limits).toBeUndefined();
  });

  it("names the first field that is wrong", () => {
    expect(planInputFromDraft({ ...draft, name: " " })).toMatchObject({ ok: false, field: "name" });
    expect(planInputFromDraft({ ...draft, slug: "Team 2027" })).toMatchObject({ ok: false, field: "slug" });
    expect(planInputFromDraft({ ...draft, monthlyMinimumUsd: "lots" })).toMatchObject({
      ok: false,
      field: "monthlyMinimumUsd",
    });
    expect(
      planInputFromDraft({ ...draft, features: [Feature.managed_organizations], includedManagedOrganizations: "2.5" }),
    ).toMatchObject({ ok: false, field: "includedManagedOrganizations" });
  });
});
