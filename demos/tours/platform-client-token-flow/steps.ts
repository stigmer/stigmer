/**
 * PlatformClient token flow playback — end-to-end visualization of how a
 * platform builder mints user tokens and how Stigmer validates them.
 *
 * Uses three view types (BrowserView, TerminalView, APIExchangeView) to
 * visually distinguish the platform builder's app, the backend call to Stigmer,
 * and Stigmer's internal validation pipeline. Ported from the in-repo inline
 * demo; the timeline is preserved 1:1. The in-app `cursorTargetFor` helper is
 * converted to an explicit `set_cursor` interaction.
 */

import type { ScenarioStep, TerminalLine } from "@scenar/react";
import type { CheckItem } from "../_shared/api-exchange/APIExchangeView";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type TokenFlowStep =
  | { view: "platform-login" }
  | { view: "backend-mint" }
  | { view: "stigmer-validates-credentials" }
  | { view: "token-response" }
  | { view: "frontend-uses-token" }
  | { view: "stigmer-validates-user-token" }
  | { view: "error-unauthenticated" }
  | { view: "error-not-found" };

// ---------------------------------------------------------------------------
// Fixture data — terminal lines
// ---------------------------------------------------------------------------

export const MINT_CALL_LINES: readonly TerminalLine[] = [
  { type: "prompt", text: "# Your backend endpoint calls mintUserToken" },
  {
    type: "output",
    text: "const { accessToken, expiresAt } = await auth.mintUserToken({",
  },
  { type: "output", text: '  userId: "user_abc123",' },
  { type: "output", text: '  userEmail: "jane@acme.com",' },
  { type: "output", text: '  userName: "Jane Doe",' },
  { type: "output", text: "});" },
  { type: "blank", text: "" },
  { type: "output", text: "Calling Stigmer API..." },
];

export const TOKEN_RESPONSE_LINES: readonly TerminalLine[] = [
  { type: "prompt", text: "# Stigmer responds with a signed JWT" },
  { type: "blank", text: "" },
  { type: "success", text: "200 OK" },
  { type: "output", text: "{" },
  {
    type: "output",
    text: '  "accessToken": "eyJhbGciOiJFZDI1NTE5Iiwid...",',
  },
  { type: "output", text: '  "expiresIn": 3600' },
  { type: "output", text: "}" },
  { type: "blank", text: "" },
  { type: "output", text: "Token returned to frontend via /api/stigmer-token" },
];

export const ERROR_UNAUTHENTICATED_LINES: readonly TerminalLine[] = [
  {
    type: "prompt",
    text: "# Invalid client_id or client_secret",
  },
  { type: "blank", text: "" },
  { type: "error", text: "401 Unauthorized" },
  { type: "output", text: "{" },
  { type: "error", text: '  "code": "UNAUTHENTICATED",' },
  {
    type: "error",
    text: '  "message": "Invalid client credentials"',
  },
  { type: "output", text: "}" },
  { type: "blank", text: "" },
  { type: "output", text: "Fix: Verify STIGMER_CLIENT_ID and" },
  { type: "output", text: "STIGMER_CLIENT_SECRET in your environment." },
];

export const ERROR_NOT_FOUND_LINES: readonly TerminalLine[] = [
  {
    type: "prompt",
    text: "# User not found, auto-provisioning disabled",
  },
  { type: "blank", text: "" },
  { type: "error", text: "404 Not Found" },
  { type: "output", text: "{" },
  { type: "error", text: '  "code": "NOT_FOUND",' },
  {
    type: "error",
    text: '  "message": "Identity account not found for',
  },
  { type: "error", text: '    user_id user_abc123"' },
  { type: "output", text: "}" },
  { type: "blank", text: "" },
  { type: "output", text: "Fix: Enable auto_provision_accounts on the" },
  { type: "output", text: "PlatformClient or pre-create the account." },
];

// ---------------------------------------------------------------------------
// Fixture data — API exchange checks
// ---------------------------------------------------------------------------

export const CREDENTIAL_CHECKS: readonly CheckItem[] = [
  {
    label: "Client ID valid",
    detail: "stgm_cid_d3m0kEy...",
    status: "pass",
  },
  {
    label: "Secret verified",
    detail: "SHA-256 hash match",
    status: "pass",
  },
  {
    label: "Secret not expired",
    detail: "never_expires: true",
    status: "pass",
  },
  {
    label: "User resolved",
    detail: "user_abc123 → auto-provisioned (JIT)",
    status: "pass",
  },
];

export const USER_TOKEN_CHECKS: readonly CheckItem[] = [
  {
    label: "Signature verified",
    detail: "Ed25519 via Stigmer signing key",
    status: "pass",
  },
  {
    label: "Issuer matches",
    detail: "stigmer.ai",
    status: "pass",
  },
  {
    label: "Token not expired",
    detail: "exp 2026-04-18T13:00:00Z",
    status: "pass",
  },
  {
    label: "IAM Policy check",
    detail: "viewer on org_acme",
    status: "pass",
  },
];

export const USER_TOKEN_RESULT = {
  label: "Authorized",
  detail: "Jane (JIT-provisioned) → viewer on org_acme",
  status: "pass" as const,
};

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const tokenFlowSteps: ScenarioStep<TokenFlowStep>[] = [
  {
    delayMs: 0,
    data: { view: "platform-login" },
    narration:
      "Jane signs in to the Acme Dashboard using your authentication system. Stigmer is not involved in this step.",
    interactions: [{ atPercent: 0.5, type: "set_cursor", target: "sign-in-btn" }],
  },
  {
    delayMs: 2500,
    data: { view: "backend-mint" },
    narration:
      "Your backend endpoint receives the authenticated request and calls Stigmer's mintUserToken with PlatformClient credentials and Jane's identity.",
  },
  {
    delayMs: 3000,
    data: { view: "stigmer-validates-credentials" },
    narration:
      "Stigmer verifies the client credentials, resolves Jane's identity, and auto-provisions her account if this is her first encounter.",
    interactions: [
      { atPercent: 0.12, type: "set_cursor", target: "check-0" },
      { atPercent: 0.3, type: "set_cursor", target: "check-1" },
      { atPercent: 0.5, type: "set_cursor", target: "check-2" },
      { atPercent: 0.7, type: "set_cursor", target: "check-3" },
      { atPercent: 0.9, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "token-response" },
    narration:
      "Stigmer mints a short-lived JWT scoped to Jane's identity and returns it to your backend.",
  },
  {
    delayMs: 3000,
    data: { view: "frontend-uses-token" },
    narration:
      "Your frontend fetches the token from your backend and passes it to StigmerProvider via getAccessToken. Jane can now use Stigmer components.",
  },
  {
    delayMs: 3000,
    data: { view: "stigmer-validates-user-token" },
    narration:
      "When Jane's browser calls the Stigmer API, the minted token is verified in-process. The signature, issuer, expiry, and IAM policy are all checked.",
    interactions: [
      { atPercent: 0.12, type: "set_cursor", target: "check-0" },
      { atPercent: 0.3, type: "set_cursor", target: "check-1" },
      { atPercent: 0.5, type: "set_cursor", target: "check-2" },
      { atPercent: 0.7, type: "set_cursor", target: "check-3" },
      { atPercent: 0.88, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "error-unauthenticated" },
    narration:
      "If the client ID or secret is wrong, Stigmer returns UNAUTHENTICATED. Check your environment variables.",
  },
  {
    delayMs: 3000,
    data: { view: "error-not-found" },
    narration:
      "If the user doesn't exist and auto-provisioning is disabled, Stigmer returns NOT_FOUND. Enable auto_provision_accounts or create the account first.",
  },
];
