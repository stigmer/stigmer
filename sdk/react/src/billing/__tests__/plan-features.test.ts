// What a plan shows: only the features Cloud offers today, in contract
// order (a feature listed ahead of its gate is left out), its price and
// usage share, and its managed organizations; every period day in UTC; and
// which plans are offered, cheapest first, with what a switch gives up.

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PlanTermsSchema } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { EntitlementsSchema, Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import {
  buyablePlans,
  explainUsageShare,
  featuresLost,
  formatManagedOrganizations,
  formatMonthlyMinimum,
  formatPeriodDay,
  formatUsageShare,
  lowestPlanWith,
  offeredFeatures,
} from "../plan-features";
import { BUSINESS as BUSINESS_PLAN, RETIRED, TEAM } from "./fixtures";

const USD = 1_000_000n;
const BUSINESS = create(EntitlementsSchema, {
  features: [Feature.byo_provider_keys, Feature.channels, Feature.sharing, Feature.teams, Feature.managed_organizations],
  limits: { includedManagedOrganizations: 5 },
});

describe("offeredFeatures", () => {
  it("lists what Cloud offers, leaving out what names nothing, in contract order", () => {
    const listed = create(EntitlementsSchema, { features: [Feature.teams, Feature.platform_client, ...BUSINESS.features] });
    expect(offeredFeatures(listed).map((f) => f.label)).toEqual([
      "Bring your own provider keys",
      "Channels",
      "Sharing",
      "Teams",
      "Managed organizations",
    ]);
    expect(offeredFeatures(undefined)).toEqual([]);
  });
});

describe("plan terms", () => {
  const terms = create(PlanTermsSchema, {
    monthlyMinimumMicros: 499n * USD,
    usageShareBasisPoints: 1_000,
    perExtraOrganizationMicros: 25n * USD,
  });

  it("reads the minimum and the usage share with the commission rule", () => {
    expect(formatMonthlyMinimum(terms)).toBe("$499.00/month");
    expect(formatUsageShare(terms)).toBe(
      "or 10% of provider cost, whichever is greater; the commission already paid on tokens counts toward it",
    );
    expect(formatUsageShare(create(PlanTermsSchema, { usageShareBasisPoints: 1_250 }))).toMatch(/^or 12\.50%/);
    expect(formatUsageShare(create(PlanTermsSchema))).toBe("");
  });

  it("explains the share to a customer, with the spend from which the plan costs nothing extra", () => {
    expect(explainUsageShare(terms)).toBe(
      "Usage is still paid from credits. The 10% commission on it counts toward the minimum, so from $4990.00 a month in provider costs the plan costs nothing extra.",
    );
    expect(explainUsageShare(create(PlanTermsSchema, { monthlyMinimumMicros: 99n * USD, usageShareBasisPoints: 1_000 }))).toMatch(
      /from \$990\.00 a month/,
    );
    expect(explainUsageShare(create(PlanTermsSchema))).toBe("");
  });

  it("reads the included managed organizations and the fee beyond, only when the plan admits them", () => {
    expect(formatManagedOrganizations(BUSINESS, terms)).toBe("5 managed organizations included, then $25.00/month each");
    expect(formatManagedOrganizations(create(EntitlementsSchema, { features: [Feature.teams] }), terms)).toBe("");
    expect(
      formatManagedOrganizations(create(EntitlementsSchema, { features: [Feature.managed_organizations] }), terms),
    ).toBe("Unlimited managed organizations");
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
    expect(lowestPlanWith([BUSINESS_PLAN, TEAM], Feature.managed_organizations)?.metadata?.name).toBe("Business");
    expect(lowestPlanWith([TEAM], Feature.managed_organizations)).toBeUndefined();
  });

  it("says what a switch stops the organization creating, and nothing for an upgrade", () => {
    expect(featuresLost(BUSINESS_PLAN, TEAM).map((feature) => feature.label)).toEqual([
      "Bring your own provider keys",
      "Managed organizations",
    ]);
    expect(featuresLost(TEAM, BUSINESS_PLAN)).toEqual([]);
  });
});
