// The issue form's arithmetic: the derived name, the UTC calendar presets
// (a renewal continues the coverage it renews), the draft-to-input mapping
// (expiry at 00:00 UTC after the last covered day, the empty org, absent
// limits for unlimited) and the customer id minter's shape. Instants are
// fixed and the arithmetic is UTC-only, so the suite passes in any zone.

import { describe, it, expect } from "vitest";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import {
  coverageStartDay,
  graceDaysOf,
  isPastDay,
  licenseName,
  mintCustomerId,
  parseGraceDays,
  parseLimit,
  presetLastCoveredDay,
  toLicenseInput,
  type LicenseDraft,
} from "../license-draft";
import { license } from "./fixtures";

describe("licenseName", () => {
  it("leads with the term so the derived slug always starts with a letter", () => {
    expect(licenseName(LicenseTerm.paid, "  3M   Company ", "2027-10-23")).toBe(
      "Paid license for 3M Company until 2027-10-23",
    );
    expect(licenseName(LicenseTerm.trial, "ソニー", "2026-10-22")).toBe(
      "Trial license for ソニー until 2026-10-22",
    );
  });
});

describe("presets", () => {
  it("covers 30 days for a trial and one year for paid, inclusive of the start day", () => {
    expect(presetLastCoveredDay(LicenseTerm.trial, "2026-09-23")).toBe("2026-10-22");
    expect(presetLastCoveredDay(LicenseTerm.paid, "2026-09-23")).toBe("2027-09-22");
  });

  it("keeps a leap-day start within one year", () => {
    expect(presetLastCoveredDay(LicenseTerm.paid, "2028-02-29")).toBe("2029-02-28");
  });

  it("starts today, or the day after the renewed license's coverage when later", () => {
    const now = new Date("2026-09-23T22:30:00Z");
    expect(coverageStartDay(now)).toBe("2026-09-23");

    const runningUntilOct = license({
      id: "lic_a",
      issuedAt: "2026-09-22T18:54:57Z",
      expiresAt: "2026-10-22T18:54:57Z",
    });
    expect(coverageStartDay(now, runningUntilOct)).toBe("2026-10-23");

    const midnightExpiry = license({
      id: "lic_b",
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
    });
    expect(coverageStartDay(now, midnightExpiry)).toBe("2027-01-01");

    const lapsed = license({ id: "lic_c", issuedAt: "2025-01-01T00:00:00Z", expiresAt: "2026-01-01T00:00:00Z" });
    expect(coverageStartDay(now, lapsed)).toBe("2026-09-23");
  });

  it("reads a past day against the UTC date, not the host's", () => {
    const now = new Date("2026-09-23T00:30:00Z");
    expect(isPastDay("2026-09-22", now)).toBe(true);
    expect(isPastDay("2026-09-23", now)).toBe(false);
  });
});

describe("toLicenseInput", () => {
  const draft: LicenseDraft = {
    customer: { id: "cus_acme", displayName: " Acme  Corp ", contactEmail: " ops@acme.test ", organization: " " },
    term: LicenseTerm.paid,
    lastCoveredDay: "2027-09-22",
    graceDays: 30,
    maxUsers: 50,
    maxOrganizations: undefined,
    features: [Feature.sso_enforcement, Feature.channels],
    notes: "  PO 4411  ",
  };

  it("sets expiry to 00:00 UTC after the last covered day and grace after that", () => {
    const input = toLicenseInput(draft);
    expect(input.expiresAt).toEqual(new Date("2027-09-23T00:00:00Z"));
    expect(input.graceUntil).toEqual(new Date("2027-10-23T00:00:00Z"));
  });

  it("carries the empty org, the tidied customer, only the limits that are set, and trimmed notes", () => {
    const input = toLicenseInput(draft);
    expect(input.org).toBe("");
    expect(input.name).toBe("Paid license for Acme Corp until 2027-09-22");
    expect(input.customer).toEqual({ id: "cus_acme", displayName: "Acme Corp", contactEmail: "ops@acme.test" });
    expect(input.entitlements).toEqual({
      limits: { maxUsers: 50 },
      features: [Feature.sso_enforcement, Feature.channels],
    });
    expect(input.notes).toBe("PO 4411");
  });

  it("omits the limits entirely when both are unlimited", () => {
    const input = toLicenseInput({ ...draft, maxUsers: undefined, notes: "" });
    expect(input.entitlements).toEqual({ features: [Feature.sso_enforcement, Feature.channels] });
    expect(input.notes).toBeUndefined();
  });
});

describe("free-text fields", () => {
  it("reads an empty limit as unlimited and refuses fractions", () => {
    expect(parseLimit("")).toEqual({ ok: true, value: undefined });
    expect(parseLimit(" 25 ")).toEqual({ ok: true, value: 25 });
    expect(parseLimit("2.5").ok).toBe(false);
    expect(parseLimit("lots").ok).toBe(false);
  });

  it("accepts a grace of 0 to 3650 whole days", () => {
    expect(parseGraceDays("0")).toEqual({ ok: true, value: 0 });
    expect(parseGraceDays("30")).toEqual({ ok: true, value: 30 });
    expect(parseGraceDays("").ok).toBe(false);
    expect(parseGraceDays("-1").ok).toBe(false);
    expect(parseGraceDays("3651").ok).toBe(false);
  });

  it("reads back the whole days of grace a license was issued with", () => {
    expect(
      graceDaysOf(license({ id: "lic_g", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z", graceUntil: "2027-01-31T00:00:00Z" })),
    ).toBe(30);
  });
});

describe("mintCustomerId", () => {
  it("is cus_ and a lowercase 26-character ULID whose prefix encodes the time", () => {
    const id = mintCustomerId(Date.UTC(2026, 8, 23), (bytes) => bytes.fill(0xff));
    expect(id).toMatch(/^cus_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(id.slice(-16)).toBe("zzzzzzzzzzzzzzzz");
    expect(mintCustomerId(0, (bytes) => bytes.fill(0))).toBe(`cus_${"0".repeat(26)}`);
  });

  it("sorts by mint time", () => {
    const zero = (bytes: Uint8Array) => bytes.fill(0);
    expect(mintCustomerId(1_000, zero) < mintCustomerId(2_000, zero)).toBe(true);
  });

  it("draws fresh randomness by default", () => {
    expect(mintCustomerId()).not.toBe(mintCustomerId());
  });
});
