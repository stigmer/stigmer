// What a plan shows: only the features Cloud offers today, in contract
// order (a feature listed ahead of its gate is left out), its monthly fee
// and its child organizations; every period day in UTC; and
// which plans are offered, cheapest first, with what a switch gives up.

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PlanTermsSchema } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { EntitlementsSchema, Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import {
  buyablePlans,
  featuresLost,
  formatChildOrgs,
  formatMonthlyFee,
  formatPeriodDay,
  lowestPlanWith,
  offeredFeatures,
} from "../plan-features";
import { BUSINESS as BUSINESS_PLAN, RETIRED, TEAM } from "./fixtures";

const USD = 1_000_000n;
const BUSINESS = create(EntitlementsSchema, {
  features: [Feature.byo_provider_keys, Feature.channels, Feature.sharing, Feature.teams, Feature.child_orgs],
  limits: { includedChildOrgs: 5 },
});

describe("offeredFeatures", () => {
  it("lists what Cloud offers, leaving out what names nothing, in contract order", () => {
    const listed = create(EntitlementsSchema, { features: [Feature.teams, Feature.platform_client, ...BUSINESS.features] });
    expect(offeredFeatures(listed).map((f) => f.label)).toEqual([
      "Channels",
      "Sharing",
      "Teams",
      "Child organizations",
    ]);
    expect(offeredFeatures(undefined)).toEqual([]);
  });
});

describe("plan terms", () => {
  const terms = create(PlanTermsSchema, {
    monthlyMinimumMicros: 499n * USD,
    perExtraOrgMicros: 25n * USD,
  });

  it("reads the monthly fee", () => {
    expect(formatMonthlyFee(terms)).toBe("$499.00/month");
    expect(formatMonthlyFee(create(PlanTermsSchema, { monthlyMinimumMicros: 99n * USD }))).toBe("$99.00/month");
    expect(formatMonthlyFee(undefined)).toBe("$0.00/month");
  });

  it("reads the included child organizations and the fee beyond, only when the plan admits them", () => {
    expect(formatChildOrgs(BUSINESS, terms)).toBe("5 child organizations included, then $25.00/month each");
    expect(formatChildOrgs(create(EntitlementsSchema, { features: [Feature.teams] }), terms)).toBe("");
    expect(
      formatChildOrgs(create(EntitlementsSchema, { features: [Feature.child_orgs] }), terms),
    ).toBe("Unlimited child organizations");
  });
});

describe("formatPeriodDay", () => {
  it("shows a period boundary as its UTC calendar day", () => {
    expect(formatPeriodDay(timestampFromDate(new Date("2027-02-28T23:30:00Z")))).toBe("Feb 28, 2027");
    expect(formatPeriodDay(undefined)).toBe("");
  });
});

describe("which plans are offered", () => {
  it("offers the buyable plans cheapest first, whatever the catalog's order, and never a retired one", () => {
    expect(buyablePlans([BUSINESS_PLAN, RETIRED, TEAM]).map((plan) => plan.metadata?.name)).toEqual(["Team", "Business"]);
  });

  it("names the cheapest buyable plan that includes a feature", () => {
    expect(lowestPlanWith([BUSINESS_PLAN, RETIRED, TEAM], Feature.teams)?.metadata?.name).toBe("Team");
    expect(lowestPlanWith([BUSINESS_PLAN, TEAM], Feature.child_orgs)?.metadata?.name).toBe("Business");
    expect(lowestPlanWith([TEAM], Feature.child_orgs)).toBeUndefined();
  });

  it("says what a switch stops the organization creating, and nothing for an upgrade", () => {
    expect(featuresLost(BUSINESS_PLAN, TEAM).map((feature) => feature.label)).toEqual(["Child organizations"]);
    expect(featuresLost(TEAM, BUSINESS_PLAN)).toEqual([]);
  });
});
