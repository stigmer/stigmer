/**
 * Multi-tenant JIT playback — walkthrough of JIT provisioning with
 * tenantOrgClaim for multi-tenant platforms.
 *
 * Shows the setup-once pattern: register IdP with JIT + tenantOrgClaim,
 * create tenant orgs, and let Stigmer handle per-user provisioning
 * automatically from a JWT claim.
 *
 * Covers the "JIT provisioning for multi-tenant platforms" section
 * of the multi-tenant setup guide page.
 */

import type { ScenarioStep } from "../../engine/ScenarioPlayer";
import type { StepInteractions } from "../../engine/useStepInteractions";
import type { TerminalLine } from "../../views/TerminalView";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type MultiTenantJitStep =
  | { view: "code-register-idp" }
  | { view: "code-create-org" }
  | { view: "terminal-org-created" }
  | { view: "jwt-auth" }
  | { view: "tenant-resolved" }
  | { view: "success" };

// ---------------------------------------------------------------------------
// Fixture data — code snippets
// ---------------------------------------------------------------------------

export const REGISTER_IDP_JIT_CODE = [
  "// register-idp.ts — IdP with JIT + tenantOrgClaim",
  "const idp = await stigmer.identityProvider.create({",
  '  name: "Acme Cloud Auth",',
  '  org: "acme",',
  '  slug: "acme-cloud-auth",',
  '  jwksUri: "https://acme.us.auth0.com/.well-known/jwks.json",',
  '  allowedIssuers: ["https://acme.us.auth0.com/"],',
  '  expectedAudience: "https://api.stigmer.ai/",',
  "  autoProvisionAccounts: true,",
  "  autoGrantOnOrg: true,",
  '  autoGrantRole: "member",',
  '  tenantOrgClaim: "org_id",',
  "});",
];

export const CREATE_TENANT_ORG_CODE = [
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
  { type: "blank", text: "" },
  { type: "output", text: "No per-user provisioning code needed — JIT handles it." },
];

// ---------------------------------------------------------------------------
// Fixture data — API exchange checks
// ---------------------------------------------------------------------------

export const TENANT_RESOLVE_CHECKS = [
  { label: "Read JWT claim", detail: 'org_id → "acme-tenant-alpha-id"', status: "pass" as const },
  { label: "Tenant org resolved", detail: "tenant-alpha (org_01xyz789)", status: "pass" as const },
  { label: "Account auto-provisioned", detail: "ida_02def456 (JIT)", status: "pass" as const },
  { label: "Role granted", detail: "member on tenant-alpha (JIT)", status: "pass" as const },
];

export const SUCCESS_CHECKS = [
  { label: "Token validated", detail: "signature + claims OK", status: "pass" as const },
  { label: "Tenant: tenant-alpha", detail: "resolved via org_id claim", status: "pass" as const },
  { label: "Access authorized", detail: "member on org_01xyz789", status: "pass" as const },
];

// ---------------------------------------------------------------------------
// Step interactions
// ---------------------------------------------------------------------------

export const MT_JIT_INTERACTIONS: StepInteractions = {
  // Step 4: cursor walks through tenant resolution checks
  4: [
    { atPercent: 0.10, type: "set-cursor", target: "check-0" },
    { atPercent: 0.30, type: "set-cursor", target: "check-1" },
    { atPercent: 0.50, type: "set-cursor", target: "check-2" },
    { atPercent: 0.70, type: "set-cursor", target: "check-3" },
    { atPercent: 0.88, type: "clear-cursor" },
  ],
  // Step 5: cursor walks through success checks
  5: [
    { atPercent: 0.15, type: "set-cursor", target: "check-0" },
    { atPercent: 0.40, type: "set-cursor", target: "check-1" },
    { atPercent: 0.65, type: "set-cursor", target: "check-2" },
    { atPercent: 0.88, type: "clear-cursor" },
  ],
};

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const multiTenantJitSteps: ScenarioStep<MultiTenantJitStep>[] = [
  // ── Setup (one-time) ──────────────────────────────────────────────────
  {
    delayMs: 0,
    data: { view: "code-register-idp" },
    caption: "Register IdP with JIT and tenantOrgClaim",
    narration:
      "Register your Identity Provider with JIT provisioning and tenant org claim. The four fields — auto-provision, auto-grant, auto-grant role, and tenant org claim — eliminate all per-user provisioning code.",
  },
  {
    delayMs: 3500,
    data: { view: "code-create-org" },
    caption: "Create a tenant Organization",
    narration:
      "Create a platform-managed Organization for each tenant. The external org ID is the value Stigmer matches against the JWT claim.",
  },
  {
    delayMs: 4000,
    data: { view: "terminal-org-created" },
    caption: "Tenant org created",
    narration:
      "The tenant Organization is created with the external ID mapping. This is the only per-tenant setup step — no per-user code follows.",
  },
  // ── Runtime (automatic) ───────────────────────────────────────────────
  {
    delayMs: 3500,
    data: { view: "jwt-auth" },
    caption: "User authenticates with tenant JWT",
    narration:
      "Jane signs in on Tenant Alpha's portal. Her JWT includes an org_id claim with the tenant's external ID. Stigmer reads this claim to route her to the right Organization.",
  },
  {
    delayMs: 3500,
    data: { view: "tenant-resolved" },
    caption: "Stigmer resolves tenant and provisions automatically",
    narration:
      "Stigmer reads the org_id claim, finds the matching tenant Organization, creates Jane's account, and grants the member role — all automatically. No backend code needed.",
  },
  {
    delayMs: 3000,
    data: { view: "success" },
    caption: "Request succeeds — user in correct tenant",
    narration:
      "Jane's request succeeds. She has a federated account and a member role scoped to Tenant Alpha. She cannot access Tenant Beta's resources.",
  },
];
