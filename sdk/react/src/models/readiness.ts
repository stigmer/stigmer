// What the server says about which models can run for an organization, in
// the shape the kit's faces read: one report per provider, and per (engine,
// model) the provider it needs and that provider's state. The server's
// answer (`PlatformQueryController.getModelReadiness`) is read from the same
// rule a run is refused by, so these types carry its verdict and never
// re-derive it; the helpers below only ask it questions.
import type { HarnessOption } from "./harness.js";

/**
 * Where a provider stands for an organization.
 *
 * - `served`: a run that needs it is started. `source` says by what: the
 *   organization's own key, its parent organization's key (`parentOrg`
 *   names it), or the runners this server hands its runs to (a laptop's
 *   `stigmer setup` key, a cloud backend, a gateway).
 * - `missing`: a run that needs it is refused at create. `scope` says what
 *   is missing it: the organization (an admin adds a key) or the runners
 *   (whoever runs them configures one).
 * - `unknown`: the server cannot see its runners' settings; nothing is
 *   refused for it, and the runner's own error is the backstop.
 */
export type ProviderAvailability =
  | {
      readonly state: "served";
      readonly source: "organization" | "parent" | "runners";
      /** The parent organization whose key serves, when `source` is `parent`; empty when the server names none. */
      readonly parentOrg: string;
    }
  | { readonly state: "missing"; readonly scope: "organization" | "runners" }
  | { readonly state: "unknown" };

/** One provider's report, in the server's order. */
export interface ProviderReadiness {
  /** The server's name for the provider: `anthropic`, `openai`. */
  readonly provider: string;
  readonly availability: ProviderAvailability;
}

/** One model on one engine, and whether it can run. */
export interface ModelReadiness {
  readonly harness: HarnessOption;
  readonly modelId: string;
  /** The provider the model needs on this engine; empty when the server judges none. */
  readonly provider: string;
  readonly availability: ProviderAvailability;
}

/** Looks up one model's readiness on one engine; `undefined` while loading or for a model the server did not judge. */
export type ModelReadinessLookup = (harness: HarnessOption, modelId: string) => ModelReadiness | undefined;

/** Whether a run that needs this provider would be refused. Unknown never is. */
export function isMissing(availability: ProviderAvailability): boolean {
  return availability.state === "missing";
}

/**
 * Whether nothing can run at all: the server judged at least one model, and
 * every one it judged is missing its provider. A served or unknown model
 * counts as able to run, so a server that cannot see its runners never
 * reads as "nothing runs".
 */
export function nothingRuns(models: readonly ModelReadiness[] | null): boolean {
  return models !== null && models.length > 0 && models.every((model) => isMissing(model.availability));
}
