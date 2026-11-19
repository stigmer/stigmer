// The licenses surface's display vocabulary: a day reads as every other
// screen writes a date ("Jun 10, 2027"), "covered through" steps back
// from the expiry instant, relative days count UTC days, an absent limit
// reads as unlimited rather than blank, and a license's features, which no
// server reads, are never counted.

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { EntitlementsSchema, Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { coveredThroughDay, entitlementParts, formatDay, formatDayFromToday } from "../license-format";

describe("formatDay", () => {
  it("writes a UTC day as the console writes a date everywhere else", () => {
    expect(formatDay("2027-06-10")).toBe("Jun 10, 2027");
    expect(formatDay("2026-12-31")).toBe("Dec 31, 2026");
    expect(formatDay("2027-01-01")).toBe("Jan 1, 2027");
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
      entitlementParts(create(EntitlementsSchema, { limits: { maxUsers: 5, maxOrgs: 1 } })),
    ).toEqual(["5 users", "1 organization"]);
    expect(entitlementParts(create(EntitlementsSchema, {}))).toEqual([
      "Unlimited users",
      "Unlimited organizations",
    ]);
  });

  it("names the limits only, even for a license issued with features", () => {
    expect(
      entitlementParts(create(EntitlementsSchema, { features: [Feature.channels] })),
    ).toEqual(["Unlimited users", "Unlimited organizations"]);
  });
});
