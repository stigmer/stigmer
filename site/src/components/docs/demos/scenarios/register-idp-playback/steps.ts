/**
 * Register Identity Provider playback — step-by-step walkthrough
 * of gathering OIDC values, selecting a provider type using the
 * real SDK ProviderPicker, configuring it, and verifying the result.
 */

import type { ScenarioStep } from "../../engine/ScenarioPlayer";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type RegisterIdpStep =
  | { view: "auth-dashboard" }
  | { view: "provider-list" }
  | { view: "pick-provider" }
  | { view: "configure-provider" }
  | { view: "provider-registered" };

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const registerIdpSteps: ScenarioStep<RegisterIdpStep>[] = [
  {
    delayMs: 0,
    data: { view: "auth-dashboard" },
    caption: "Gather values from your auth provider",
    narration:
      "Start by gathering the JWKS URI, issuer URL, and audience from your auth provider's dashboard. These three values configure the trust relationship.",
  },
  {
    delayMs: 3500,
    data: { view: "provider-list" },
    caption: "Open Identity Providers in Stigmer",
    narration:
      "In the Stigmer console, navigate to the Identity Providers page. This is where you manage all trusted authentication providers for your organization.",
  },
  {
    delayMs: 3000,
    data: { view: "pick-provider" },
    caption: "Select your provider type",
    narration:
      "Choose your identity provider type. Stigmer supports Auth0, Okta, Microsoft Entra, Google, Amazon Cognito, and any custom OIDC-compliant provider.",
  },
  {
    delayMs: 3500,
    data: { view: "configure-provider" },
    caption: "Fill in the configuration",
    narration:
      "Enter the Auth0 tenant name and region to auto-populate the OIDC endpoints. Then set the display name and expected audience for the trust relationship.",
  },
  {
    delayMs: 4000,
    data: { view: "provider-registered" },
    caption: "Identity Provider registered",
    narration:
      "The Identity Provider is now registered. Stigmer can validate JWTs from your auth provider and resolve them to federated identities. All configuration values are confirmed.",
  },
];
