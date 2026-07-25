/**
 * Federation overview tour — two-path walkthrough comparing JIT
 * provisioning (3 steps) with manual provisioning (4 steps) for
 * the federation guide landing page.
 *
 * JIT path comes first because the page recommends it. The contrast
 * makes the value proposition self-evident: zero provisioning code
 * vs explicit API calls.
 */

import type { ScenarioStep } from "@scenar/react";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type OverviewTourStep =
  | { view: "jit-register" }
  | { view: "jit-login" }
  | { view: "jit-success" }
  | { view: "manual-register" }
  | { view: "manual-provision" }
  | { view: "manual-grant" }
  | { view: "manual-success" };

// ---------------------------------------------------------------------------
// Fixture data — code snippets (manual path)
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
// Fixture data — API exchange checks
// ---------------------------------------------------------------------------

export const JIT_CHECKS = [
  { label: "Token validated", detail: "signature + claims OK", status: "pass" as const },
  { label: "Account auto-provisioned", detail: "auth0|jane_doe → ida_01abc (JIT)", status: "pass" as const },
  { label: "Role granted: viewer", detail: "on org_acme (JIT)", status: "pass" as const },
  { label: "Access authorized", detail: "viewer on org_acme", status: "pass" as const },
];

export const MANUAL_CHECKS = [
  { label: "Token validated", detail: "signature + claims OK", status: "pass" as const },
  { label: "Identity resolved", detail: "auth0|jane_doe → ida_01abc", status: "pass" as const },
  { label: "Access authorized", detail: "admin on org_acme", status: "pass" as const },
];

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const overviewTourSteps: ScenarioStep<OverviewTourStep>[] = [
  // ── JIT path (steps 0-2) ──────────────────────────────────────────────
  {
    delayMs: 0,
    data: { view: "jit-register" },
    narration:
      "Register your auth provider and enable JIT provisioning. Stigmer will create accounts and grant roles automatically when users authenticate.",
  },
  {
    delayMs: 3500,
    data: { view: "jit-login" },
    narration:
      "Jane signs in on the Acme platform. With JIT enabled, Stigmer creates her account and grants a role the first time she authenticates. No provisioning code needed.",
  },
  {
    delayMs: 3500,
    data: { view: "jit-success" },
    narration:
      "The request succeeds. Stigmer validated the token, auto-provisioned Jane's account, granted the viewer role, and authorized the request — all in one step.",
    interactions: [
      { atPercent: 0.12, type: "set_cursor", target: "check-0" },
      { atPercent: 0.30, type: "set_cursor", target: "check-1" },
      { atPercent: 0.50, type: "set_cursor", target: "check-2" },
      { atPercent: 0.70, type: "set_cursor", target: "check-3" },
      { atPercent: 0.88, type: "clear_cursor" },
    ],
  },
  // ── Manual path (steps 3-6) ───────────────────────────────────────────
  {
    delayMs: 3500,
    data: { view: "manual-register" },
    narration:
      "Alternatively, register the Identity Provider without JIT. You keep full control, but your backend provisions each user explicitly.",
  },
  {
    delayMs: 3500,
    data: { view: "manual-provision" },
    narration:
      "Call create federated account to map each user's OIDC subject to a Stigmer identity. This runs in your backend for every user.",
  },
  {
    delayMs: 3500,
    data: { view: "manual-grant" },
    narration:
      "Then grant a role on the Organization. Without this policy, the user's JWT is valid but Stigmer returns 403 Forbidden.",
  },
  {
    delayMs: 3000,
    data: { view: "manual-success" },
    narration:
      "The request succeeds. The same result as JIT, but your backend handled provisioning and access grants explicitly.",
    interactions: [
      { atPercent: 0.15, type: "set_cursor", target: "check-0" },
      { atPercent: 0.40, type: "set_cursor", target: "check-1" },
      { atPercent: 0.65, type: "set_cursor", target: "check-2" },
      { atPercent: 0.88, type: "clear_cursor" },
    ],
  },
];
