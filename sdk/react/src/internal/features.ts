// The one vocabulary for entitlement features: a label and a line per
// feature, shared by every surface that names one (the licenses console,
// the plan comparison, the upgrade notice), so a feature reads the same
// wherever it appears.
//
// Keyed by every feature that grants something, so a value added to the
// contract fails to compile here until it has words. `platform_client` and
// `byo_provider_keys` are not: they gate nothing (platform/v1/entitlement.proto;
// every plan runs on the organization's own provider keys), so no surface
// names them.

import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";

/** A feature that grants something: every value but the zero value and the ungated ones. */
export type NamedFeature = Exclude<
  Feature,
  Feature.feature_unspecified | Feature.platform_client | Feature.byo_provider_keys
>;

/**
 * Label and one-line explanation per named feature, and whether the label
 * reads as a plural ("Teams are", "SSO enforcement is").
 */
export const FEATURE_COPY: Readonly<
  Record<
    NamedFeature,
    { readonly label: string; readonly description: string; readonly plural: boolean }
  >
> = {
  [Feature.sso_enforcement]: {
    label: "SSO enforcement",
    description: "Require members to sign in through a registered identity provider.",
    plural: false,
  },
  [Feature.channels]: {
    label: "Channels",
    description: "Deliver agents over messaging channels through a channel runtime.",
    plural: true,
  },
  [Feature.sharing]: {
    label: "Sharing",
    description: "Share agents through hosted links, with your organization or with anyone who has the link.",
    plural: false,
  },
  [Feature.teams]: {
    label: "Teams",
    description: "Group members into teams and grant access to a team at once.",
    plural: true,
  },
  [Feature.child_orgs]: {
    label: "Child organizations",
    description: "Create organizations for your own customers under this one.",
    plural: true,
  },
  [Feature.access_history]: {
    label: "Access history",
    description: "Read and export who gave whom access to what, and when.",
    plural: false,
  },
};

/** Whether a stored feature value is one the vocabulary names. */
export function isNamedFeature(feature: number): feature is NamedFeature {
  return feature in FEATURE_COPY;
}
