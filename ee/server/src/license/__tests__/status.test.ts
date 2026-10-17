/**
 * Pins the licensed server's status provider (license/status.ts): it
 * reports the state at the instant the controller hands in, never the wall
 * clock, with the key id and the very claims the key carried.
 */
import { describe, expect, it, vi } from "vitest";

import { LicenseState } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";

import { newLicenseStatusProvider } from "../status.js";
import { goldenVector } from "./test-tickets.js";

const golden = goldenVector();

describe("newLicenseStatusProvider", () => {
  const provider = newLicenseStatusProvider({ keyId: golden.keyId, claims: golden.claims });

  it.each([
    ["inside the term", "2027-01-01T00:00:00Z", LicenseState.valid],
    ["inside the expiring window", "2027-09-01T00:00:00Z", LicenseState.expiring],
    ["inside grace", "2027-10-01T00:00:00Z", LicenseState.grace],
    ["after grace", "2027-11-01T00:00:00Z", LicenseState.expired],
  ])("reports %s with the key id and claims", async (_name, now, state) => {
    expect(await provider.status(new Date(now))).toEqual({
      state,
      keyId: "license-signing-golden:v1",
      claims: golden.claims,
    });
  });

  it("never reads the wall clock", async () => {
    vi.useFakeTimers({ now: new Date("2030-01-01T00:00:00Z") });
    try {
      expect((await provider.status(new Date("2027-01-01T00:00:00Z"))).state).toBe(
        LicenseState.valid,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
