/**
 * SSO login playback — walkthrough of the admin-to-user SSO journey:
 * Identity Provider detail panel with SSO URL, login page with SSO
 * discovery, external IdP redirect, and console access with automatic
 * provisioning.
 */

import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type SsoLoginStep =
  | { view: "idp-detail" }
  | { view: "sso-login" }
  | { view: "idp-redirect" }
  | { view: "console-welcome" };

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const ssoLoginSteps: ScenarioStep<SsoLoginStep>[] = [
  {
    delayMs: 0,
    data: { view: "idp-detail" },
    caption: "SSO login URL on the Identity Provider panel",
    narration:
      "When SSO is enabled on an Identity Provider, a login URL appears on the detail panel. The admin copies this URL and shares it with the team.",
  },
  {
    delayMs: 3500,
    data: { view: "sso-login" },
    caption: "Team member visits the SSO login URL",
    narration:
      "A team member opens the shared URL. The login page discovers the SSO provider for the organization and shows a Sign in with Acme SSO button.",
  },
  {
    delayMs: 3500,
    data: { view: "idp-redirect" },
    caption: "Redirect to the Identity Provider",
    narration:
      "Clicking the button redirects to the organization's Identity Provider. The user authenticates through their familiar login flow.",
  },
  {
    delayMs: 3000,
    data: { view: "console-welcome" },
    caption: "Signed in — account created automatically",
    narration:
      "After authentication, the user lands in the Stigmer console. On first login, Stigmer creates a federated account and grants the viewer role on the organization.",
  },
];
