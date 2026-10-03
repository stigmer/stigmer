// The licenses surface's display vocabulary: "covered through" steps back
// from the expiry instant, relative days count UTC days, an absent limit
// reads as unlimited rather than blank, the plan-only and ungated features
// are never offered on a license, and only the offered ones are counted.

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
  it("offers every license feature and never a plan-only or ungated one", () => {
    expect(GRANTABLE_FEATURES).toEqual([Feature.sso_enforcement, Feature.byo_provider_keys]);
    expect(GRANTABLE_FEATURES).not.toContain(Feature.channels);
    expect(GRANTABLE_FEATURES).not.toContain(Feature.sharing);
    expect(GRANTABLE_FEATURES).not.toContain(Feature.teams);
    expect(GRANTABLE_FEATURES).not.toContain(Feature.managed_organizations);
    expect(GRANTABLE_FEATURES).not.toContain(Feature.platform_client);
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
      entitlementParts(create(EntitlementsSchema, { limits: { maxUsers: 5, maxOrgs: 1 }, features: [Feature.byo_provider_keys] })),
    ).toEqual(["5 users", "1 organization", "1 feature"]);
    expect(entitlementParts(create(EntitlementsSchema, {}))).toEqual([
      "Unlimited users",
      "Unlimited organizations",
      "No features",
    ]);
  });

  it("counts only the features the console offers, as the names and the detail list them", () => {
    expect(
      entitlementParts(create(EntitlementsSchema, { features: [Feature.platform_client, Feature.byo_provider_keys] })),
    ).toEqual(["Unlimited users", "Unlimited organizations", "1 feature"]);
    expect(
      entitlementParts(
        create(EntitlementsSchema, { features: [Feature.channels, Feature.sharing, Feature.sso_enforcement] }),
      ),
    ).toEqual(["Unlimited users", "Unlimited organizations", "1 feature"]);
  });
});
