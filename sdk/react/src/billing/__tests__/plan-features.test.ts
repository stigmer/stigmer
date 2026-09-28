// What a plan shows: only the features Cloud offers today, in contract
// order (a feature listed ahead of its gate is left out), its price and
// usage share, and its managed organizations; and every period day in UTC.

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PlanTermsSchema } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { EntitlementsSchema, Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import {
  formatManagedOrganizations,
  formatMonthlyMinimum,
  formatPeriodDay,
  formatUsageShare,
  offeredFeatures,
} from "../plan-features";

const USD = 1_000_000n;
const BUSINESS = create(EntitlementsSchema, {
  features: [Feature.byo_provider_keys, Feature.channels, Feature.sharing, Feature.teams, Feature.managed_organizations],
  limits: { includedManagedOrganizations: 5 },
});

describe("offeredFeatures", () => {
  it("leaves out what Cloud does not offer yet and what names nothing, in contract order", () => {
    const listed = create(EntitlementsSchema, { features: [Feature.teams, Feature.platform_client, ...BUSINESS.features] });
    expect(offeredFeatures(listed).map((f) => f.label)).toEqual([
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
