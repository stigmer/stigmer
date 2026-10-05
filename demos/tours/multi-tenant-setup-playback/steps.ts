/**
 * Child organizations playback — walkthrough of the two-phase onboarding
 * flow: a child organization per customer under the integrator's own
 * Organization, followed by per-customer user provisioning and access grant.
 *
 * Covers the "Child organizations" guide page. Ported from the in-repo
 * inline demo; the timeline (steps, narration, interactions) is
 * preserved 1:1. The in-app `cursorTargetFor` helper is converted to explicit
 * `set_cursor` interactions (the packed embed drives the cursor from each
 * step's `interactions`, there is no per-view hook).
 */

import type { ScenarioStep, TerminalLine } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type MultiTenantSetupStep =
  | { view: "tenant-signup" }
  | { view: "code-create-org" }
  | { view: "terminal-org-created" }
  | { view: "user-signup" }
  | { view: "code-lookup-org" }
  | { view: "code-provision-grant" }
  | { view: "terminal-user-onboarded" };

// ---------------------------------------------------------------------------
// Fixture data — code snippets
// ---------------------------------------------------------------------------

export const CREATE_ORG_CODE = [
  "// onboard-tenant.ts — Create a child organization",
  "const tenantOrg = await stigmer.organization.create({",
  '  name: "Tenant Alpha",',
  '  slug: "tenant-alpha",',
  '  description: "Acme Cloud customer: Tenant Alpha",',
  '  parentOrg: "acme",',
  '  externalId: "cust-4411",',
  "});",
  "",
  "console.log(`Created child organization: ${tenantOrg.metadata.id}`);",
];

export const LOOKUP_ORG_CODE = [
  "// onboard-tenant-user.ts — Find the child organization",
  "const tenantOrg = await stigmer.organization.getByExternalId({",
  '  parentOrg: "acme",',
  '  externalId: "cust-4411",',
  "});",
  "",
  "console.log(`Found org: ${tenantOrg.metadata.slug}`);",
];

export const PROVISION_GRANT_CODE = [
  "// onboard-tenant-user.ts — Provision user + grant access",
  "const account = await stigmer.identityAccount.createFederatedAccount({",
  '  org: "acme",  // the Identity Provider\'s own Organization',
  "  identityProviderRef: idpRef,",
  "  externalSub: user.oidcSubject,",
  "  email: user.email,",
  "  firstName: user.firstName,",
  "  lastName: user.lastName,",
  "});",
  "",
  "await stigmer.iamPolicy.create({",
  '  principal: { kind: "identity_account", id: account.metadata.id },',
  '  resource: { kind: "organization", id: tenantOrg.metadata.id },',
  '  relation: "viewer",',
  "});",
];

// ---------------------------------------------------------------------------
// Fixture data — terminal output
// ---------------------------------------------------------------------------

export const ORG_CREATED_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx onboard-tenant.ts --tenant tenant-alpha" },
  { type: "blank", text: "" },
  { type: "output", text: "Creating child organization..." },
  { type: "output", text: "  Parent:      acme" },
  { type: "output", text: "  External ID: cust-4411" },
  { type: "blank", text: "" },
  { type: "success", text: "Created org: tenant-alpha (org_01xyz789)" },
  { type: "output", text: "  Child of acme, external ID cust-4411" },
];

export const USER_ONBOARDED_OUTPUT: readonly TerminalLine[] = [
  {
    type: "prompt",
    text: "npx tsx onboard-tenant-user.ts --tenant cust-4411 --user jane@acme.com",
  },
  { type: "blank", text: "" },
  { type: "output", text: "Looking up org: externalId=cust-4411" },
  { type: "success", text: "Found org:      tenant-alpha (org_01xyz789)" },
  { type: "blank", text: "" },
  { type: "success", text: "Created account: ida_02def456" },
  { type: "success", text: "Granted role:    viewer on org_01xyz789" },
  { type: "blank", text: "" },
  { type: "output", text: "Jane can access tenant-alpha resources." },
  { type: "output", text: "She cannot see tenant-beta." },
];

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const multiTenantSetupSteps: ScenarioStep<MultiTenantSetupStep>[] = [
  // Phase 1 — Tenant onboarding
  {
    delayMs: 0,
    data: { view: "tenant-signup" },
    narration:
      "A new customer, Tenant Alpha, signs up on the Acme Cloud platform. Your backend needs to create an isolated child organization for them on Stigmer, under your own.",
    // Step 0 stays interaction-free: its timers fire under the poster before
    // Play (the toolchain quirk the verify gate enforces); the rendered
    // chrome carries the attention cue instead.
  },
  {
    delayMs: 3000,
    data: { view: "code-create-org" },
    narration:
      "Call organization create with your own Organization as the parent. The external ID records your customer ID for this child organization.",
  },
  {
    delayMs: 4000,
    data: { view: "terminal-org-created" },
    narration:
      "The child organization is created. Your admins manage it, and you can find it later by your own customer ID without storing Stigmer IDs.",
  },
  // Phase 2 — User onboarding within tenant
  {
    delayMs: 3500,
    data: { view: "user-signup" },
    narration:
      "Jane signs up on Tenant Alpha's portal. Your backend now needs to place her in the right child organization on Stigmer.",
    interactions: [{ atPercent: 0.5, type: "set_cursor", target: "signup-btn" }],
  },
  {
    delayMs: 3000,
    data: { view: "code-lookup-org" },
    narration:
      "Use get by external ID to find the child organization from your customer ID. Only your Organization's admins can ask.",
  },
  {
    delayMs: 3500,
    data: { view: "code-provision-grant" },
    narration:
      "Create Jane's federated account under your Identity Provider. Then grant her a viewer role in the child organization. The Organization boundary enforces isolation.",
  },
  {
    delayMs: 4000,
    data: { view: "terminal-user-onboarded" },
    narration:
      "Jane is fully onboarded into Tenant Alpha. She has a federated account and a viewer role in that child organization. She can access Tenant Alpha's resources but cannot see Tenant Beta's.",
  },
];
