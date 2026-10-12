/**
 * Pins where a verified license stands at an instant (license/state.ts):
 * valid until the expiring window opens 30 days before `expires_at`,
 * expiring until `expires_at`, grace until `grace_until`, expired from
 * then on, each boundary instant belonging to the later state; a missing
 * or earlier grace instant is no grace; only `expired` is a lapse.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { LicenseClaimsSchema, LicenseState } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";

import { EXPIRING_WINDOW_DAYS, isLapsed, licenseStateAt } from "../state.js";

const EXPIRES = new Date("2027-09-22T10:00:00Z");
const GRACE = new Date("2027-10-22T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function claims(graceUntil: Date | null = GRACE) {
  return create(LicenseClaimsSchema, {
    licenseId: "lic_state",
    issuedAt: timestampFromDate(new Date("2026-09-22T10:00:00Z")),
    expiresAt: timestampFromDate(EXPIRES),
    ...(graceUntil === null ? {} : { graceUntil: timestampFromDate(graceUntil) }),
  });
}

function at(ms: number): Date {
  return new Date(ms);
}

describe("licenseStateAt", () => {
  const windowOpens = EXPIRES.getTime() - EXPIRING_WINDOW_DAYS * DAY;

  it.each([
    ["a year before expiry", at(EXPIRES.getTime() - 365 * DAY), LicenseState.valid],
    ["a millisecond before the window opens", at(windowOpens - 1), LicenseState.valid],
    ["the instant the window opens", at(windowOpens), LicenseState.expiring],
    ["a millisecond before expiry", at(EXPIRES.getTime() - 1), LicenseState.expiring],
    ["the instant of expiry", EXPIRES, LicenseState.grace],
    ["a millisecond before grace ends", at(GRACE.getTime() - 1), LicenseState.grace],
    ["the instant grace ends", GRACE, LicenseState.expired],
    ["a year after", at(GRACE.getTime() + 365 * DAY), LicenseState.expired],
  ])("%s", (_name, now, state) => {
    expect(licenseStateAt(claims(), now)).toBe(state);
  });

  it("reads a missing grace instant as no grace", () => {
    expect(licenseStateAt(claims(null), at(EXPIRES.getTime() - 1))).toBe(LicenseState.expiring);
    expect(licenseStateAt(claims(null), EXPIRES)).toBe(LicenseState.expired);
  });

  it("reads a grace instant earlier than expiry as no grace", () => {
    expect(licenseStateAt(claims(at(EXPIRES.getTime() - DAY)), EXPIRES)).toBe(LicenseState.expired);
  });

  it("refuses claims with no expiry", () => {
    expect(() =>
      licenseStateAt(create(LicenseClaimsSchema, { licenseId: "lic_none" }), EXPIRES),
    ).toThrow(/no expires_at/);
  });
});

describe("isLapsed", () => {
  it("is true for expired alone", () => {
    expect(isLapsed(LicenseState.expired)).toBe(true);
    for (const state of [LicenseState.valid, LicenseState.expiring, LicenseState.grace] as const) {
      expect(isLapsed(state)).toBe(false);
    }
  });
});
