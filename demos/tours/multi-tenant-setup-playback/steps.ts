/**
 * Multi-tenant setup playback — walkthrough of the two-phase multi-tenant
 * onboarding flow: tenant org creation followed by per-tenant user
 * provisioning and access grant.
 *
 * Covers the "Multi-tenant platform setup" guide page. Ported from the in-repo
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
  "// onboard-tenant.ts — Create platform-managed Organization",
  "const tenantOrg = await stigmer.organization.create({",
  '  name: "Tenant Alpha",',
  '  slug: "tenant-alpha",',
  '  description: "Acme Cloud customer: Tenant Alpha",',
  '  managementMode: "platform_managed",',
  "  identityProviderRef: {",
  '    org: "acme",',
  '    kind: "identity_provider",',
  '    slug: "acme-cloud-auth",',
  "  },",
  '  externalOrgId: "acme-tenant-alpha-id",',
  "});",
  "",
  "console.log(`Created tenant org: ${tenantOrg.metadata.id}`);",
];

export const LOOKUP_ORG_CODE = [
  "// onboard-tenant-user.ts — Look up tenant org",
  "const tenantOrg = await stigmer.organization.getByExternalOrgId({",
  "  identityProviderRef: {",
  '    org: "acme",',
  '    kind: "identity_provider",',
  '    slug: "acme-cloud-auth",',
  "  },",
  '  externalOrgId: "acme-tenant-alpha-id",',
  "});",
  "",
  "console.log(`Found org: ${tenantOrg.metadata.slug}`);",
];

export const PROVISION_GRANT_CODE = [
  "// onboard-tenant-user.ts — Provision user + grant access",
  "const account = await stigmer.identityAccount.createFederatedAccount({",
  '  org: tenantOrg.metadata.slug,  // "tenant-alpha"',
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
  { type: "output", text: "Creating platform-managed Organization..." },
  { type: "output", text: "  Management mode: platform_managed" },
  { type: "output", text: "  Identity Provider: acme-cloud-auth" },
  { type: "output", text: "  External ID:       acme-tenant-alpha-id" },
  { type: "blank", text: "" },
  { type: "success", text: "Created org: tenant-alpha (org_01xyz789)" },
  { type: "output", text: "  External ID mapped → acme-tenant-alpha-id" },
];

export const USER_ONBOARDED_OUTPUT: readonly TerminalLine[] = [
  {
    type: "prompt",
    text: "npx tsx onboard-tenant-user.ts --tenant acme-tenant-alpha-id --user jane@acme.com",
  },
  { type: "blank", text: "" },
  { type: "output", text: "Looking up org: externalOrgId=acme-tenant-alpha-id" },
  { type: "success", text: "Found org:      tenant-alpha (org_01xyz789)" },
  { type: "blank", text: "" },
  { type: "success", text: "Created account: ida_02def456 in tenant-alpha" },
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
      "A new customer, Tenant Alpha, signs up on the Acme Cloud platform. Your backend needs to create an isolated Organization for them on Stigmer.",
    interactions: [{ atPercent: 0.5, type: "set_cursor", target: "create-tenant-btn" }],
  },
  {
    delayMs: 3000,
    data: { view: "code-create-org" },
    narration:
      "Call organization create with management mode set to platform managed. The external org ID maps your tenant ID to Stigmer's Organization, and the identity provider reference links it to your auth system.",
  },
  {
    delayMs: 4000,
    data: { view: "terminal-org-created" },
    narration:
      "The Organization is created with the external ID mapping. You can now look it up later using your own tenant identifier without storing Stigmer IDs.",
  },
  // Phase 2 — User onboarding within tenant
  {
    delayMs: 3500,
    data: { view: "user-signup" },
    narration:
      "Jane signs up on Tenant Alpha's portal. Your backend now needs to provision her into the correct tenant Organization on Stigmer.",
    interactions: [{ atPercent: 0.5, type: "set_cursor", target: "signup-btn" }],
  },
  {
    delayMs: 3000,
    data: { view: "code-lookup-org" },
    narration:
      "Use get by external org ID to find the Stigmer Organization from your platform's tenant identifier. This is the bridge between your tenant model and Stigmer's.",
  },
  {
    delayMs: 3500,
    data: { view: "code-provision-grant" },
    narration:
      "Create a federated account in the tenant Organization — not in the parent org. Then grant a viewer role scoped to this tenant. The Organization boundary enforces isolation.",
  },
  {
    delayMs: 4000,
    data: { view: "terminal-user-onboarded" },
    narration:
      "Jane is fully onboarded into Tenant Alpha. She has a federated account and a viewer role scoped to that tenant. She can access Tenant Alpha's resources but cannot see Tenant Beta's.",
  },
];
