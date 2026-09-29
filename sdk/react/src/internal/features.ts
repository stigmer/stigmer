// The one vocabulary for entitlement features: a label and a line per
// feature, shared by every surface that names one (the licenses console,
// the plan comparison, the upgrade notice), so a feature reads the same
// wherever it appears.
//
// Keyed by every feature that grants something, so a value added to the
// contract fails to compile here until it has words. `platform_client` is
// not one: it gates nothing (platform/v1/entitlement.proto), so no surface
// names it.

import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";

/** A feature that grants something: every value but the zero value and `platform_client`. */
export type NamedFeature = Exclude<Feature, Feature.feature_unspecified | Feature.platform_client>;

/** Label and one-line explanation per named feature. */
export const FEATURE_COPY: Readonly<
  Record<NamedFeature, { readonly label: string; readonly description: string }>
> = {
  [Feature.sso_enforcement]: {
    label: "SSO enforcement",
    description: "Require members to sign in through a registered identity provider.",
  },
  [Feature.byo_provider_keys]: {
    label: "Bring your own provider keys",
    description: "Run agents on your own Anthropic and OpenAI keys, with no Stigmer commission on those tokens.",
  },
  [Feature.channels]: {
    label: "Channels",
    description: "Deliver agents over messaging channels through a channel runtime.",
  },
  [Feature.sharing]: {
    label: "Sharing",
    description: "Share agents through hosted links, with your organization or with anyone who has the link.",
  },
  [Feature.teams]: {
    label: "Teams",
    description: "Group members into teams and grant access to a team at once.",
  },
  [Feature.managed_organizations]: {
    label: "Managed organizations",
    description: "Run organizations for your own customers under your identity provider.",
  },
};

/** Whether a stored feature value is one the vocabulary names. */
export function isNamedFeature(feature: number): feature is NamedFeature {
  return feature in FEATURE_COPY;
}
