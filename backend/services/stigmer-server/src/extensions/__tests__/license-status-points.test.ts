/**
 * Pins the licenseStatus driver point in the single-instance shape the
 * registry already enforces for organizationDirectory and identityFederation:
 *
 *   - `drivers.licenseStatus` — the provider that answers what license this
 *     server holds (an Enterprise unit registers the one that verifies a
 *     configured ticket); single instance; absent = the built-in `absent`
 *     provider installs at the compose.ts consumption site, so every
 *     edition answers getLicenseStatus and only one ever answers anything
 *     but absent.
 *
 * The controller's use of the resolved provider is pinned in
 * domain/platform/__tests__/platform.test.ts; this file pins the registry.
 */
import { LicenseState } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { describe, expect, it } from "vitest";

import type { LicenseStatusProvider } from "../license-status.js";
import { resolveExtensions } from "../registry.js";

const provider: LicenseStatusProvider = {
  status: () =>
    Promise.resolve({ state: LicenseState.valid, keyId: "lk_test" }),
};

describe("the licenseStatus driver point", () => {
  it("is undefined with no extensions — the built-in absent provider serves", () => {
    expect(resolveExtensions([]).drivers.licenseStatus).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "enterprise-license", drivers: { licenseStatus: provider } },
    ]);
    expect(resolved.drivers.licenseStatus).toBe(provider);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "license-a", drivers: { licenseStatus: provider } },
        { name: "license-b", drivers: { licenseStatus: provider } },
      ]),
    ).toThrowError(
      /extension 'license-b' registers a LicenseStatusProvider, but 'license-a' already did/,
    );
  });
});
