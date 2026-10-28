/**
 * Pins the providerAvailability driver point in the single-instance shape
 * the registry enforces for licenseStatus, and the built-in answer every
 * composition without one gets (provider-availability.ts): what this
 * server's runners were declared to reach, unknown when nothing was
 * declared, missing for a provider left off the list.
 *
 * The controller's and the create chain's use of the resolved provider are
 * pinned in domain/platform/__tests__/platform.test.ts and
 * domain/run/__tests__/require-model-provider.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  runnerProviderAvailability,
  type ProviderAvailabilityProvider,
} from "../provider-availability.js";
import { resolveExtensions } from "../registry.js";

const provider: ProviderAvailabilityProvider = {
  availability: () => Promise.resolve({ state: "served", source: "organization" }),
};

describe("the providerAvailability driver point", () => {
  it("is undefined with no extensions — the built-in runner answer serves", () => {
    expect(resolveExtensions([]).drivers.providerAvailability).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([{ name: "keys", drivers: { providerAvailability: provider } }]);
    expect(resolved.drivers.providerAvailability).toBe(provider);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "keys-a", drivers: { providerAvailability: provider } },
        { name: "keys-b", drivers: { providerAvailability: provider } },
      ]),
    ).toThrowError(/extension 'keys-b' registers a ProviderAvailabilityProvider, but 'keys-a' already did/);
  });
});

describe("runnerProviderAvailability", () => {
  it("answers unknown for every provider when nothing was declared", async () => {
    const built = runnerProviderAvailability(undefined);
    for (const name of ["anthropic", "openai", "cursor"] as const) {
      expect(await built.availability("org-1", name)).toEqual({ state: "unknown" });
    }
  });

  it("serves a declared provider from the runners and reports the others missing from them", async () => {
    const built = runnerProviderAvailability(new Set(["anthropic"]));
    expect(await built.availability("org-1", "anthropic")).toEqual({ state: "served", source: "runners" });
    expect(await built.availability("org-1", "cursor")).toEqual({ state: "missing", scope: "runners" });
  });

  it("reports every provider missing when the runners were declared to reach none", async () => {
    const built = runnerProviderAvailability(new Set());
    expect(await built.availability("org-1", "openai")).toEqual({ state: "missing", scope: "runners" });
  });
});
