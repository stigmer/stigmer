// License standing: the time state in the contract's words, the
// term-relative Expiring window, the renewal fact, the calendar's order
// and the customer-counting summary. Pins that a 30-day trial is not
// Expiring on its first day, that a renewed license needs no action, and
// that a renewed customer counts once.

import { describe, it, expect } from "vitest";
import { LicenseState, LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import {
  deriveLicenseStandings,
  deriveTimeState,
  sortForCalendar,
  summarizeCalendar,
} from "../license-standing";
import { license } from "./fixtures";

const THIRTY_DAY_TRIAL = license({
  id: "lic_trial",
  term: LicenseTerm.trial,
  issuedAt: "2026-09-23T00:00:00Z",
  expiresAt: "2026-10-23T00:00:00Z",
});

const trial = (now: string) => deriveTimeState(THIRTY_DAY_TRIAL, new Date(now));

describe("deriveTimeState", () => {
  it("keeps a 30-day trial active until its last quarter", () => {
    expect(trial("2026-09-23T00:00:00Z")).toBe(LicenseState.valid);
    // The window is a quarter of 30 days: 7.5 days before expiry.
    expect(trial("2026-10-15T00:00:00Z")).toBe(LicenseState.valid);
    expect(trial("2026-10-16T00:00:00Z")).toBe(LicenseState.expiring);
  });

  it("caps the window at 30 days for a yearly license", () => {
    const paid = license({
      id: "lic_paid",
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
    });
    expect(deriveTimeState(paid, new Date("2026-12-01T00:00:00Z"))).toBe(LicenseState.valid);
    expect(deriveTimeState(paid, new Date("2026-12-02T00:00:00Z"))).toBe(LicenseState.expiring);
  });

  it("is in grace between expiry and the grace end, then expired", () => {
    const paid = license({
      id: "lic_paid",
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      graceUntil: "2027-01-31T00:00:00Z",
    });
    expect(deriveTimeState(paid, new Date("2027-01-01T00:00:00Z"))).toBe(LicenseState.grace);
    expect(deriveTimeState(paid, new Date("2027-01-30T23:59:59Z"))).toBe(LicenseState.grace);
    expect(deriveTimeState(paid, new Date("2027-01-31T00:00:00Z"))).toBe(LicenseState.expired);
  });

  it("goes straight from expiring to expired with no grace", () => {
    expect(trial("2026-10-22T23:59:59Z")).toBe(LicenseState.expiring);
    expect(trial("2026-10-23T00:00:00Z")).toBe(LicenseState.expired);
  });
});

describe("deriveLicenseStandings", () => {
  const first = license({
    id: "lic_first",
    term: LicenseTerm.trial,
    issuedAt: "2026-09-01T00:00:00Z",
    expiresAt: "2026-10-01T00:00:00Z",
  });
  const renewal = license({
    id: "lic_renewal",
    issuedAt: "2026-09-25T00:00:00Z",
    expiresAt: "2027-10-01T00:00:00Z",
  });
  const other = license({
    id: "lic_other",
    customerId: "cus_globex",
    customerName: "Globex",
    issuedAt: "2025-10-01T00:00:00Z",
    expiresAt: "2026-10-01T00:00:00Z",
    graceUntil: "2026-10-31T00:00:00Z",
  });
  const now = new Date("2026-09-28T00:00:00Z");

  it("marks the license a later one covers past as renewed, whatever its own time state", () => {
    const standings = deriveLicenseStandings([first, renewal, other], now);
    expect(standings.get("lic_first")).toMatchObject({
      timeState: LicenseState.expiring,
      renewedBy: "lic_renewal",
      phase: "disabled",
      label: "Renewed",
    });
    expect(standings.get("lic_renewal")).toMatchObject({ renewedBy: undefined, label: "Active", phase: "ready" });
    expect(standings.get("lic_other")).toMatchObject({ label: "Expiring", phase: "degraded" });
    expect(standings.get("lic_first")?.reason).toBe("Renewed by a license covering through 2027-09-30");
  });

  it("orders the calendar: action first, then active, then history", () => {
    const inGrace = license({
      id: "lic_grace",
      customerId: "cus_initech",
      issuedAt: "2025-09-01T00:00:00Z",
      expiresAt: "2026-09-20T00:00:00Z",
      graceUntil: "2026-10-20T00:00:00Z",
    });
    const expired = license({
      id: "lic_expired",
      customerId: "cus_umbrella",
      issuedAt: "2025-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    const all = [expired, first, renewal, other, inGrace];
    const standings = deriveLicenseStandings(all, now);
    expect(sortForCalendar(all, standings).map((l) => l.metadata?.id)).toEqual([
      "lic_grace",
      "lic_other",
      "lic_renewal",
      "lic_expired",
      "lic_first",
    ]);
  });

  it("counts customers by their current license", () => {
    const standings = deriveLicenseStandings([first, renewal, other], now);
    expect(summarizeCalendar(standings)).toEqual({ active: 1, expiring: 1, grace: 0 });
  });
});
