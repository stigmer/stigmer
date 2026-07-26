/**
 * Provision & grant playback — walkthrough of the check-then-create
 * provisioning pattern and IAM Policy role grant.
 *
 * Covers both the "Provision federated accounts" and "Grant access" guide
 * pages in a single scenario. Ported from the in-repo inline demo; the timeline
 * is preserved 1:1. The in-app `cursorTargetFor` helper is converted to an
 * explicit `set_cursor` interaction (the packed embed drives the cursor from
 * each step's `interactions`).
 */

import type { ScenarioStep, TerminalLine } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type ProvisionGrantStep =
  | { view: "user-signup" }
  | { view: "code-check" }
  | { view: "terminal-not-found" }
  | { view: "code-create" }
  | { view: "terminal-created" }
  | { view: "code-grant" }
  | { view: "terminal-granted" };

// ---------------------------------------------------------------------------
// Fixture data — code snippets
// ---------------------------------------------------------------------------

export const CHECK_CODE = [
  "// onboard-user.ts — Check for existing account",
  "try {",
  "  const existing = await stigmer.identityAccount.getByExternalSub({",
  '    org: "acme",',
  "    identityProviderRef: idpRef,",
  "    externalSub: user.oidcSubject,",
  "  });",
  "  return existing.metadata.id;",
  "} catch (err) {",
  '  if (err.code !== "NOT_FOUND") throw err;',
  "  // Account doesn't exist — create it below",
  "}",
];

export const CREATE_CODE = [
  "// onboard-user.ts — Create the federated account",
  "const account = await stigmer.identityAccount.createFederatedAccount({",
  '  org: "acme",',
  "  identityProviderRef: idpRef,",
  "  externalSub: user.oidcSubject,",
  "  email: user.email,",
  "  firstName: user.firstName,",
  "  lastName: user.lastName,",
  "  pictureUrl: user.avatarUrl,",
  "});",
  "",
  'console.log(`Created account: ${account.metadata.id}`);',
];

export const GRANT_CODE = [
  "// onboard-user.ts — Grant organization role",
  "await stigmer.iamPolicy.create({",
  "  principal: {",
  '    kind: "identity_account",',
  "    id: account.metadata.id,",
  "  },",
  "  resource: {",
  '    kind: "organization",',
  "    id: organizationId,",
  "  },",
  '  relation: "viewer",',
  "});",
  "",
  'console.log("Onboarding complete");',
];

// ---------------------------------------------------------------------------
// Fixture data — terminal output
// ---------------------------------------------------------------------------

export const NOT_FOUND_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx onboard-user.ts --user jane@acme.com" },
  { type: "blank", text: "" },
  { type: "output", text: 'Looking up: externalSub="auth0|jane_doe_123"' },
  { type: "output", text: "Provider:   acme-cloud-auth" },
  { type: "blank", text: "" },
  { type: "error", text: "NOT_FOUND — No existing account for this subject." },
  { type: "output", text: "Proceeding to create a new federated account..." },
];

export const CREATED_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx onboard-user.ts --user jane@acme.com" },
  { type: "blank", text: "" },
  { type: "output", text: 'Looking up: externalSub="auth0|jane_doe_123"' },
  { type: "error", text: "NOT_FOUND — creating new account..." },
  { type: "blank", text: "" },
  { type: "success", text: "Created account: ida_01abc123" },
  { type: "output", text: "  Email:  jane@acme.com" },
  { type: "output", text: "  Name:   Jane Doe" },
  { type: "output", text: "  Sub:    auth0|jane_doe_123" },
];

export const GRANTED_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx onboard-user.ts --user jane@acme.com" },
  { type: "blank", text: "" },
  { type: "success", text: "Created account: ida_01abc123" },
  { type: "success", text: "Granted role:    viewer on org_acme456" },
  { type: "blank", text: "" },
  { type: "output", text: "Onboarding complete. Jane can now call the" },
  { type: "output", text: "Stigmer API with her Auth0 JWT." },
];

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const provisionGrantSteps: ScenarioStep<ProvisionGrantStep>[] = [
  {
    delayMs: 0,
    data: { view: "user-signup" },
    narration:
      "Jane signs up on the Acme platform. Your backend receives the signup event and starts the Stigmer onboarding flow.",
    // Step 0 stays interaction-free: its timers fire under the poster before
    // Play (the toolchain quirk the verify gate enforces); the rendered
    // chrome carries the attention cue instead.
  },
  {
    delayMs: 3000,
    data: { view: "code-check" },
    narration:
      "First, check if a federated account already exists using get by external sub. This avoids creating duplicates if the user was previously onboarded.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-not-found" },
    narration:
      "The lookup returns NOT_FOUND, which means Jane doesn't have a Stigmer account yet. Time to create one.",
  },
  {
    delayMs: 3000,
    data: { view: "code-create" },
    narration:
      "Call create federated account with the user's OIDC subject, email, and name. The external sub is the key that links this Stigmer account to the auth provider identity.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-created" },
    narration:
      "The account is created with a new Stigmer identity ID. Jane now has a federated account, but she can't access any resources yet.",
  },
  {
    delayMs: 3000,
    data: { view: "code-grant" },
    narration:
      "Create an IAM Policy to grant Jane the viewer role on the organization. This authorizes her to access resources within the org.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-granted" },
    narration:
      "Jane is fully onboarded. She has a federated account and a viewer role on the organization. She can now call the Stigmer API with her Auth0 JWT.",
  },
];
