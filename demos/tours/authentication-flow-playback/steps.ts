/**
 * Authentication flow playback scenario for the Stigmer federation guide.
 *
 * Walks through the end-to-end flow when a federated user calls the Stigmer API:
 * platform login -> JWT issued -> API call -> token validation -> identity
 * resolution -> authorization -> response, plus error scenarios for 401 and 403.
 *
 * Uses three view types (BrowserView, TerminalView, APIExchangeView) to visually
 * distinguish the platform, the network, and the Stigmer API internals.
 */

import type { ScenarioStep, TerminalLine } from "@scenar/react";
import type { CheckItem } from "../_shared/api-exchange/APIExchangeView";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type AuthFlowStep =
  | { view: "browser-login" }
  | { view: "browser-jwt" }
  | { view: "api-call" }
  | { view: "validate-token" }
  | { view: "resolve-authorize" }
  | { view: "success-response" }
  | { view: "error-401" }
  | { view: "error-403" };

// ---------------------------------------------------------------------------
// Fixture data — terminal lines
// ---------------------------------------------------------------------------

export const API_CALL_LINES: readonly TerminalLine[] = [
  { type: "prompt", text: "curl -X POST https://api.stigmer.ai/agentic/v1/sessions \\" },
  { type: "output", text: '  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \\' },
  { type: "output", text: '  -H "Content-Type: application/json" \\' },
  { type: "output", text: "  -d '{\"agentRef\": {\"slug\": \"support-agent\"}}'" },
  { type: "blank", text: "" },
  { type: "output", text: "Sending request..." },
];

export const SUCCESS_LINES: readonly TerminalLine[] = [
  { type: "prompt", text: "curl -X POST https://api.stigmer.ai/agentic/v1/sessions \\" },
  { type: "output", text: '  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \\' },
  { type: "output", text: "  -d '{\"agentRef\": {\"slug\": \"support-agent\"}}'" },
  { type: "blank", text: "" },
  { type: "success", text: "HTTP/1.1 200 OK" },
  { type: "output", text: "{" },
  { type: "output", text: '  "apiVersion": "agentic.stigmer.ai/v1",' },
  { type: "output", text: '  "kind": "Session",' },
  { type: "output", text: '  "metadata": {' },
  { type: "output", text: '    "id": "ses-7f3a2b...",' },
  { type: "output", text: '    "name": "support-session"' },
  { type: "output", text: "  }" },
  { type: "output", text: "}" },
];

export const ERROR_401_LINES: readonly TerminalLine[] = [
  { type: "prompt", text: "curl -X POST https://api.stigmer.ai/agentic/v1/sessions \\" },
  { type: "output", text: '  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."' },
  { type: "blank", text: "" },
  { type: "error", text: "HTTP/1.1 401 Unauthorized" },
  { type: "output", text: "{" },
  { type: "error", text: '  "code": "UNAUTHENTICATED",' },
  { type: "error", text: '  "message": "JWT audience mismatch: expected' },
  { type: "error", text: '    https://api.stigmer.ai/, got https://other-api.com/"' },
  { type: "output", text: "}" },
  { type: "blank", text: "" },
  { type: "output", text: "Fix: Configure your auth provider to include" },
  { type: "output", text: "Stigmer's audience in the token." },
];

export const ERROR_403_LINES: readonly TerminalLine[] = [
  { type: "prompt", text: "curl -X POST https://api.stigmer.ai/agentic/v1/sessions \\" },
  { type: "output", text: '  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."' },
  { type: "blank", text: "" },
  { type: "error", text: "HTTP/1.1 403 Forbidden" },
  { type: "output", text: "{" },
  { type: "error", text: '  "code": "PERMISSION_DENIED",' },
  { type: "error", text: '  "message": "Identity ida_01abc123 lacks permission' },
  { type: "error", text: '    on resource org_acme456"' },
  { type: "output", text: "}" },
  { type: "blank", text: "" },
  { type: "output", text: "Fix: Create an IAM Policy granting this account" },
  { type: "output", text: "the required role on the target resource." },
];

// ---------------------------------------------------------------------------
// Fixture data — API exchange checks
// ---------------------------------------------------------------------------

export const VALIDATION_CHECKS: readonly CheckItem[] = [
  { label: "Signature verified", detail: "RS256 via JWKS", status: "pass" },
  { label: "Issuer matches", detail: "acme.us.auth0.com", status: "pass" },
  { label: "Audience matches", detail: "https://api.stigmer.ai/", status: "pass" },
  { label: "Token not expired", detail: "exp 2026-04-07T12:00:00Z", status: "pass" },
];

export const RESOLVE_CHECKS: readonly CheckItem[] = [
  { label: "Resolve identity", detail: "sub auth0|jane_doe → auto-provisioned", status: "pass" },
  { label: "Auto-grant role", detail: "viewer on org_acme456 (JIT)", status: "pass" },
  { label: "Check IAM Policy", detail: "viewer on org_acme456", status: "pass" },
];

export const RESOLVE_RESULT = {
  label: "Authorized",
  detail: "Jane (auto-provisioned) → viewer on org_acme456",
  status: "pass" as const,
};

// ---------------------------------------------------------------------------
// Step sequence
// ---------------------------------------------------------------------------

export const authFlowSteps: ScenarioStep<AuthFlowStep>[] = [
  {
    delayMs: 0,
    data: { view: "browser-login" },
    narration:
      "Jane signs in to the Acme platform using her existing credentials. This is standard OIDC — Stigmer isn't involved yet.",
    // Was driven by `cursorTargetFor` in the in-app demo; in the packed embed
    // the cursor is interaction-driven, so move it to the sign-in button as the
    // narration describes the login.
    interactions: [
      { atPercent: 0.5, type: "set_cursor", target: "sign-in-btn" },
    ],
  },
  {
    delayMs: 2500,
    data: { view: "browser-jwt" },
    narration:
      "The auth provider authenticates Jane and issues a JWT containing the issuer, subject, and audience claims that Stigmer needs.",
  },
  {
    delayMs: 3000,
    data: { view: "api-call" },
    narration:
      "Jane's app passes the JWT directly to the Stigmer API in the Authorization header. No token exchange is needed.",
  },
  {
    delayMs: 3000,
    data: { view: "validate-token" },
    narration:
      "Stigmer verifies the JWT signature using the JWKS endpoint, then checks the issuer, audience, and expiration claims.",
    interactions: [
      { atPercent: 0.15, type: "set_cursor", target: "check-0" },
      { atPercent: 0.35, type: "set_cursor", target: "check-1" },
      { atPercent: 0.55, type: "set_cursor", target: "check-2" },
      { atPercent: 0.75, type: "set_cursor", target: "check-3" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "resolve-authorize" },
    narration:
      "Stigmer maps the subject claim to Jane's identity. With JIT provisioning, if this is her first authentication, Stigmer creates the account and grants the viewer role automatically.",
    interactions: [
      { atPercent: 0.15, type: "set_cursor", target: "check-0" },
      { atPercent: 0.4, type: "set_cursor", target: "check-1" },
      { atPercent: 0.65, type: "set_cursor", target: "check-2" },
      { atPercent: 0.85, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "success-response" },
    narration:
      "The request succeeds. Jane can use Stigmer agents and sessions through her Acme platform credentials.",
  },
  {
    delayMs: 3000,
    data: { view: "error-401" },
    narration:
      "If the token is invalid — wrong audience, expired, or unknown subject — Stigmer returns 401 Unauthorized.",
  },
  {
    delayMs: 3000,
    data: { view: "error-403" },
    narration:
      "If the token is valid but no IAM Policy grants access to the requested resource, Stigmer returns 403 Forbidden.",
  },
];
