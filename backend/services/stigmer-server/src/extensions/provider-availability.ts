/**
 * The provider-availability extension point: which model providers serve
 * an organization's runs?
 *
 * Every edition answers, through PlatformQueryController.getModelReadiness
 * and the run create chain's RequireModelProvider step, which read the same
 * provider so what a client is told and what create refuses cannot
 * disagree. Which provider a run needs is the rule in
 * modelcatalog/provider-need.ts; this point says only whether that
 * provider is there.
 *
 * Stigmer Cloud registers the provider that reads the organization's own
 * keys (its own, else its parent's). Every other composition gets the
 * built-in answer below, installed at the boot/compose.ts consumption site
 * (the default-lives-with-the-consumer doctrine; see drivers.ts): what this
 * server's runners reach, as the operator declared it in
 * STIGMER_RUNNER_PROVIDERS (boot/config.ts). A server whose runners are its
 * own processes cannot see their settings, so with nothing declared it
 * answers unknown, which refuses nothing; on a laptop `stigmer up` declares
 * it from the runner environment it builds.
 *
 * The report is a union keyed on the state, so a parent organization
 * cannot be reported without its name and a missing provider cannot be
 * reported without what is missing it. It carries no key material: key
 * details stay on the provider-key list.
 */
import type { ModelProvider } from "../modelcatalog/provider-need.js";

/** One provider's standing for an organization. */
export type ProviderAvailabilityReport =
  | { readonly state: "served"; readonly source: "organization" | "runners" }
  | { readonly state: "served"; readonly source: "parent"; readonly parentOrg: string }
  | { readonly state: "missing"; readonly scope: "organization" | "runners" }
  | { readonly state: "unknown" };

/** The provider contract (single-instance point, ExtensionDrivers.providerAvailability). */
export interface ProviderAvailabilityProvider {
  /**
   * Where `provider` stands for `org`. A rejection means the answer could
   * not be read (a store or lookup failure): the caller answers
   * UNAVAILABLE rather than guessing either way.
   */
  availability(org: string, provider: ModelProvider): Promise<ProviderAvailabilityReport>;
}

/**
 * The built-in answer: what this server's runners reach, as declared
 * (undefined when nothing was declared, so every provider is unknown).
 */
export function runnerProviderAvailability(
  declared: ReadonlySet<ModelProvider> | undefined,
): ProviderAvailabilityProvider {
  return {
    availability: (_org, provider) =>
      Promise.resolve(
        declared === undefined
          ? { state: "unknown" }
          : declared.has(provider)
            ? { state: "served", source: "runners" }
            : { state: "missing", scope: "runners" },
      ),
  };
}
