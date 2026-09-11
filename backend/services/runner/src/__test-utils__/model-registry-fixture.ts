/**
 * The model registry document a hermetic activity run reads, and the `fetch`
 * stub that serves it and refuses everything else.
 *
 * The activity's only HTTP fetch is the model registry (`shared/model-
 * registry.ts` for vision capability; the Cursor harness's `model-pricing-
 * data.ts` for pricing). Both fail SOFT to defaults with a 60 s failure
 * cache, which would make a golden depend on DEFAULT_PRICING and log a
 * warning on every run, so a hermetic run stubs `fetch` to answer one
 * registry document — and to THROW for any other URL, so a new network
 * dependency on the activity path fails the run instead of leaking.
 *
 * One entry, `composer-2.5`, priced at round numbers so a golden's
 * `estimatedCostUsd` is legible (600 000 input tokens = $0.60). The entry is
 * a Cursor-harness model because that is what the registry lists; the
 * document itself is the control plane's, read by every harness's runtime.
 * `parsePricingTable` wants `harness: "cursor"` + `pricing`; `parseRegistry`
 * wants `id` + `provider` and reads `capabilities.vision`.
 */

import { vi } from "vitest";

/** The pinned model of every hermetic run; in the registry document AND in the Cursor double's catalog. */
export const FIXTURE_MODEL = "composer-2.5";

export const REGISTRY_DOCUMENT = {
  models: [
    {
      id: FIXTURE_MODEL,
      displayName: "Composer 2.5 (hermetic fixture)",
      provider: "cursor",
      harness: "cursor",
      costTier: "standard",
      featured: true,
      capabilities: { vision: true },
      pricing: {
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 4.0,
        cacheWritePricePerMillion: 1.0,
        cacheReadPricePerMillion: 0.1,
      },
      pricingVariants: {
        fast: {
          inputPricePerMillion: 3.0,
          outputPricePerMillion: 12.0,
          cacheWritePricePerMillion: 3.0,
          cacheReadPricePerMillion: 0.3,
        },
      },
    },
  ],
} as const;

/**
 * Stub `fetch` to answer the registry document and refuse everything else.
 * Returns the URLs fetched, for the "no other network" assertion.
 */
export function stubRegistryFetch(): { readonly urls: string[]; restore(): void } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(url);
      if (!url.includes("/model-registry")) {
        throw new Error(`hermetic run attempted a non-registry network call: ${url}`);
      }
      return { ok: true, status: 200, json: async () => REGISTRY_DOCUMENT } as unknown as Response;
    }),
  );
  return { urls, restore: () => vi.unstubAllGlobals() };
}
