/**
 * SSO login playback — walkthrough of the admin-to-user SSO journey:
 * Identity Provider detail panel with SSO URL, login page with SSO discovery,
 * external IdP redirect, and console access with automatic provisioning.
 *
 * Ported from the in-repo inline demo; the timeline is preserved 1:1. The
 * in-app `cursorTargetFor` helper is converted to explicit `set_cursor`
 * interactions (the packed embed drives the cursor from each step's
 * `interactions`, there is no per-view hook).
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
    narration:
      "When SSO is enabled on an Identity Provider, a login URL appears on the detail panel. The admin copies this URL and shares it with the team.",
    interactions: [{ atPercent: 0.6, type: "set_cursor", target: "copy-url-btn" }],
  },
  {
    delayMs: 3500,
    data: { view: "sso-login" },
    narration:
      "A team member opens the shared URL. The login page discovers the SSO provider for the organization and shows a Sign in with Acme SSO button.",
    interactions: [{ atPercent: 0.6, type: "set_cursor", target: "sso-sign-in-btn" }],
  },
  {
    delayMs: 3500,
    data: { view: "idp-redirect" },
    narration:
      "Clicking the button redirects to the organization's Identity Provider. The user authenticates through their familiar login flow.",
  },
  {
    delayMs: 3000,
    data: { view: "console-welcome" },
    narration:
      "After authentication, the user lands in the Stigmer console. On first login, Stigmer creates a federated account and grants the viewer role on the organization.",
  },
];
