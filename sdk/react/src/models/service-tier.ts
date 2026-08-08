import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * String form of the service tier for component props and hook inputs
 * (stigmer/stigmer#357). Mirrors {@link HarnessOption}: components speak
 * strings, execution creation speaks proto.
 *
 * "standard" is the model's base-priced configuration; "fast" is the
 * provider's fast variant at the registry's fast rates — selectable only
 * for models whose {@link ModelInfo.serviceTiers} includes "fast".
 */
export type ServiceTierOption = "standard" | "fast";

/** The tier key a model must price for the fast-tier switch to render. */
export const FAST_SERVICE_TIER = "fast";

/**
 * Convert a {@link ServiceTierOption} string to the proto enum.
 */
export function toProtoServiceTier(tier: ServiceTierOption): ServiceTier {
  switch (tier) {
    case "fast":
      return ServiceTier.FAST;
    case "standard":
    default:
      return ServiceTier.STANDARD;
  }
}

/**
 * Convert a proto {@link ServiceTier} enum to its string form.
 *
 * `UNSPECIFIED` (and any unknown value) maps to `undefined` so callers can
 * decide their own default — matching the proto contract (`UNSPECIFIED`
 * resolves to `SERVICE_TIER_STANDARD` in the runner, never the provider
 * account default).
 */
export function fromProtoServiceTier(
  tier: ServiceTier | undefined,
): ServiceTierOption | undefined {
  switch (tier) {
    case ServiceTier.STANDARD:
      return "standard";
    case ServiceTier.FAST:
      return "fast";
    default:
      return undefined;
  }
}
