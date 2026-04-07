/**
 * Federation overview tour — high-level walkthrough of the 4-step
 * federation setup for the guide landing page.
 *
 * Each step maps to one of the guide pages, giving the reader
 * a visual preview of the entire integration before diving into
 * the detailed pages.
 */

import type { ScenarioStep } from "../../engine/ScenarioPlayer";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type OverviewTourStep =
  | { view: "register-idp" }
  | { view: "provision-account" }
  | { view: "grant-access" }
  | { view: "user-login" }
  | { view: "api-call-success" };

// ---------------------------------------------------------------------------
// Fixture data — code snippets
// ---------------------------------------------------------------------------

export const PROVISION_CODE = [
  "// Step 2: Provision a federated account",
  "const account = await stigmer.identityAccount.createFederatedAccount({",
  '  org: "acme",',
  "  identityProviderRef: idpRef,",
  "  externalSub: user.oidcSubject,",
  "  email: user.email,",
  "  firstName: user.firstName,",
  "  lastName: user.lastName,",
  "});",
  "",
  'console.log(`Account: ${account.metadata.id}`);',
];

export const GRANT_CODE = [
  "// Step 3: Grant a role on the Organization",
  "await stigmer.iamPolicy.create({",
  '  principal: { kind: "identity_account", id: accountId },',
  '  resource: { kind: "organization", id: orgId },',
  '  relation: "admin",',
  "});",
  "",
  'console.log("Access granted");',
];

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const overviewTourSteps: ScenarioStep<OverviewTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "register-idp" },
    caption: "1. Register an Identity Provider",
    narration:
      "First, register your auth provider in the Stigmer console. Choose the provider type and Stigmer auto-populates the OIDC configuration.",
  },
  {
    delayMs: 3500,
    data: { view: "provision-account" },
    caption: "2. Provision federated accounts",
    narration:
      "Next, provision federated accounts for your users. This maps each user's OIDC subject to a Stigmer identity.",
  },
  {
    delayMs: 3500,
    data: { view: "grant-access" },
    caption: "3. Grant access via IAM Policies",
    narration:
      "Then grant each account a role on your Organization. Without a policy, authenticated requests return 403 Forbidden.",
  },
  {
    delayMs: 3500,
    data: { view: "user-login" },
    caption: "4. User signs in on your platform",
    narration:
      "At runtime, your user signs in on your platform and gets a JWT. This is standard OIDC — Stigmer is not involved yet.",
  },
  {
    delayMs: 3000,
    data: { view: "api-call-success" },
    caption: "JWT validated — request authorized",
    narration:
      "When the user calls the Stigmer API with that JWT, Stigmer validates the token, resolves the identity, checks the policy, and authorizes the request.",
  },
];
