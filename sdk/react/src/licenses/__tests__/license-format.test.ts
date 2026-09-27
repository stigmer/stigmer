// The licenses surface's display vocabulary: "covered through" steps back
// from the expiry instant, relative days count UTC days, an absent limit
// reads as unlimited rather than blank, and the plan-only features are
// never offered on a license.

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { EntitlementsSchema, Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import {
  coveredThroughDay,
  entitlementParts,
  formatDayFromToday,
  GRANTABLE_FEATURES,
} from "../license-format";

describe("GRANTABLE_FEATURES", () => {
  it("offers every license feature and never a plan-only one", () => {
    expect(GRANTABLE_FEATURES).toEqual([
      Feature.sso_enforcement,
      Feature.platform_client,
      Feature.byo_provider_keys,
      Feature.channels,
      Feature.sharing,
    ]);
    expect(GRANTABLE_FEATURES).not.toContain(Feature.teams);
    expect(GRANTABLE_FEATURES).not.toContain(Feature.managed_organizations);
  });
});

describe("coveredThroughDay", () => {
  it("is the day before a midnight expiry and the same day for a mid-day one", () => {
    expect(coveredThroughDay(new Date("2027-09-23T00:00:00Z"))).toBe("2027-09-22");
    expect(coveredThroughDay(new Date("2026-10-22T18:54:57Z"))).toBe("2026-10-22");
  });
});

describe("formatDayFromToday", () => {
  const now = new Date("2026-09-23T23:00:00Z");

  it("speaks in days near today and months further out", () => {
    expect(formatDayFromToday("2026-09-23", now)).toBe("today");
    expect(formatDayFromToday("2026-09-24", now)).toBe("tomorrow");
    expect(formatDayFromToday("2026-10-22", now)).toBe("in 29 days");
    expect(formatDayFromToday("2026-09-20", now)).toBe("3 days ago");
    expect(formatDayFromToday("2027-09-22", now)).toBe("in 12 months");
  });
});

describe("entitlementParts", () => {
  it("names each limit, saying unlimited where the contract reads absence as unlimited", () => {
    expect(
      entitlementParts(create(EntitlementsSchema, { limits: { maxUsers: 5, maxOrganizations: 1 }, features: [2] })),
    ).toEqual(["5 users", "1 organization", "1 feature"]);
    expect(entitlementParts(create(EntitlementsSchema, {}))).toEqual([
      "Unlimited users",
      "Unlimited organizations",
      "No features",
    ]);
  });
});
