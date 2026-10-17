// What a plan shows: only the features Cloud offers today, in contract
// order (a feature listed ahead of its gate is left out), its monthly fee
// its child organizations and its agent hours; every period day in UTC; working agent time
// in tenths of an hour; and which plans are offered, cheapest first, with
// what a switch gives up; and the plan that unlocks a feature, the quoted
// Enterprise Cloud plan when no buyable plan includes it.

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PlanTermsSchema } from "@stigmer/apis/ai/stigmer/billing/plan/v1/spec_pb";
import { EntitlementsSchema, Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import {
  ENTERPRISE_CLOUD_PLAN,
  buyablePlans,
  featuresLost,
  formatAgentHours,
  formatAgentHoursTerms,
  formatChildOrgs,
  formatMonthlyFee,
  formatPeriodDay,
  lowestPlanWith,
  offeredFeatures,
  unlockingPlanName,
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
      "Slack and WhatsApp",
      "Chat links",
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

describe("formatAgentHoursTerms", () => {
  it("says the hours a plan includes and what happens past them, and nothing when it states none", () => {
    const hours = (includedAgentHours: number) => create(EntitlementsSchema, { limits: { includedAgentHours } });
    expect(formatAgentHoursTerms(hours(25), create(PlanTermsSchema, { perAgentHourMicros: USD / 2n }))).toBe(
      "25 agent hours a month, then $0.50 an hour",
    );
    expect(formatAgentHoursTerms(hours(10), create(PlanTermsSchema))).toBe("10 agent hours a month, then new work pauses");
    expect(formatAgentHoursTerms(hours(1), undefined)).toBe("1 agent hour a month, then new work pauses");
    expect(formatAgentHoursTerms(BUSINESS, create(PlanTermsSchema, { perAgentHourMicros: USD }))).toBe("");
    expect(formatAgentHoursTerms(undefined, undefined)).toBe("");
  });
});

describe("formatPeriodDay", () => {
  it("shows a period boundary as its UTC calendar day", () => {
    expect(formatPeriodDay(timestampFromDate(new Date("2027-02-28T23:30:00Z")))).toBe("Feb 28, 2027");
    expect(formatPeriodDay(undefined)).toBe("");
  });
});

describe("formatAgentHours", () => {
  it("shows working time as hours to the tenth the invoice bills by, rounded half up", () => {
    expect(formatAgentHours(0n)).toBe("0.0 h");
    expect(formatAgentHours(112_320n)).toBe("31.2 h");
    expect(formatAgentHours(179n)).toBe("0.0 h");
    expect(formatAgentHours(180n)).toBe("0.1 h");
    expect(formatAgentHours(36_000n)).toBe("10.0 h");
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

  it("names the plan that unlocks a feature, Enterprise Cloud when no buyable plan includes it", () => {
    expect(unlockingPlanName([BUSINESS_PLAN, TEAM], Feature.teams)).toBe("Team");
    expect(unlockingPlanName([BUSINESS_PLAN, TEAM], Feature.access_history)).toBe("Enterprise Cloud");
    expect(unlockingPlanName([], Feature.access_history)).toBe("Enterprise Cloud");
    expect(unlockingPlanName([TEAM], Feature.child_orgs)).toBe("");
  });

  it("lists on Enterprise Cloud only what the contract tiers to it", () => {
    expect(ENTERPRISE_CLOUD_PLAN.name).toBe("Enterprise Cloud");
    expect(ENTERPRISE_CLOUD_PLAN.features).toEqual([Feature.access_history]);
  });

  it("says what a switch stops the organization creating, and nothing for an upgrade", () => {
    expect(featuresLost(BUSINESS_PLAN, TEAM).map((feature) => feature.label)).toEqual(["Child organizations"]);
    expect(featuresLost(TEAM, BUSINESS_PLAN)).toEqual([]);
  });
});
